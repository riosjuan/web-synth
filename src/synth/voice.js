import { scheduleAttackDecay, scheduleRelease } from "./envelope.js";
import { applyOscillatorStartParams } from "./oscillators.js";

function disconnectVoice(voice) {
  voice.osc1.disconnect();
  voice.osc2.disconnect();
  voice.osc1Gain.disconnect();
  voice.osc2Gain.disconnect();
  voice.amp.disconnect();
}

export function stopVoiceImmediately(synth, voiceId) {
  const voice = synth.voices.get(voiceId);
  if (!voice) return;
  try {
    voice.osc1.stop();
  } catch (_e) {}
  try {
    voice.osc2.stop();
  } catch (_e) {}
  disconnectVoice(voice);
  synth.voices.delete(voiceId);
  synth.sustainedVoiceIds.delete(voiceId);
}

export function noteOn(synth, note, velocity = 127, voiceId = note, connectLfoToVoice) {
  if (!synth.audioContext || synth.audioContext.state !== "running") return;
  if (!synth.hasAudibleSource()) return;

  stopVoiceImmediately(synth, voiceId);
  const now = synth.audioContext.currentTime;
  const velocityGain = Math.max(0, Math.min(1, velocity / 127));

  const osc1 = synth.audioContext.createOscillator();
  const osc2 = synth.audioContext.createOscillator();
  const osc1Gain = synth.audioContext.createGain();
  const osc2Gain = synth.audioContext.createGain();
  const amp = synth.audioContext.createGain();

  osc1Gain.gain.value = synth.params.osc1Level;
  osc2Gain.gain.value = synth.params.osc2Level;
  amp.gain.value = 0;

  applyOscillatorStartParams(osc1, osc2, synth.params, note, now);
  osc1.connect(osc1Gain);
  osc2.connect(osc2Gain);
  osc1Gain.connect(amp);
  osc2Gain.connect(amp);
  amp.connect(synth.filter);

  scheduleAttackDecay(amp.gain, synth.params, velocity, now);
  osc1.start(now);
  osc2.start(now);

  const voice = { id: voiceId, note, osc1, osc2, osc1Gain, osc2Gain, amp, velocityGain, released: false };
  synth.voices.set(voiceId, voice);
  connectLfoToVoice("lfo1", voice);
  connectLfoToVoice("lfo2", voice);
}

export function noteOff(synth, voiceId) {
  if (!synth.audioContext) return;
  const voice = synth.voices.get(voiceId);
  if (!voice || voice.released) return;
  if (synth.sustainPedalDown) {
    synth.sustainedVoiceIds.add(voiceId);
    return;
  }

  voice.released = true;
  const now = synth.audioContext.currentTime;
  const releaseEnd = scheduleRelease(voice.amp.gain, synth.params.release, now);
  const releaseSeconds = releaseEnd - now;

  voice.osc1.stop(releaseEnd + 0.02);
  voice.osc2.stop(releaseEnd + 0.02);
  window.setTimeout(() => {
    disconnectVoice(voice);
    if (synth.voices.get(voiceId) === voice) {
      synth.voices.delete(voiceId);
    }
  }, Math.ceil((releaseSeconds + 0.05) * 1000));
}

export function allNotesOff(synth) {
  const wasSustainDown = synth.sustainPedalDown;
  synth.sustainPedalDown = false;
  synth.sustainedVoiceIds.clear();
  Array.from(synth.voices.keys()).forEach((voiceId) => noteOff(synth, voiceId));
  synth.sustainPedalDown = wasSustainDown;
}

export function forceAllNotesOff(synth) {
  synth.sustainPedalDown = false;
  synth.sustainedVoiceIds.clear();
  Array.from(synth.voices.values()).forEach((voice) => {
    try {
      voice.osc1.stop();
    } catch (_e) {}
    try {
      voice.osc2.stop();
    } catch (_e) {}
    disconnectVoice(voice);
  });
  synth.voices.clear();
}

export function handleSustainPedal(synth, ccValue) {
  const pedalDown = ccValue >= 64;
  if (pedalDown) {
    synth.sustainPedalDown = true;
    return;
  }
  synth.sustainPedalDown = false;
  const heldVoices = Array.from(synth.sustainedVoiceIds);
  synth.sustainedVoiceIds.clear();
  heldVoices.forEach((voiceId) => noteOff(synth, voiceId));
}
