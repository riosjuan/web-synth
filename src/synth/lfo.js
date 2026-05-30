import { LFO_DIVISION_BEATS } from "../config.js";

export function initLfos(synth) {
  createLfo(synth, "lfo1");
  createLfo(synth, "lfo2");
  updateLfoFromParams(synth, "lfo1");
  updateLfoFromParams(synth, "lfo2");
}

export function createLfo(synth, lfoId) {
  const osc = synth.audioContext.createOscillator();
  const gain = synth.audioContext.createGain();
  gain.gain.value = 0;
  osc.connect(gain);
  osc.start();
  synth.lfoState[lfoId].osc = osc;
  synth.lfoState[lfoId].gain = gain;
}

export function updateLfoFromParams(synth, lfoId) {
  if (!synth.audioContext) return;
  const lfo = synth.lfoState[lfoId];
  if (!lfo || !lfo.osc || !lfo.gain) return;

  const wave = synth.params[`${lfoId}Wave`];
  const rate = synth.params[`${lfoId}Rate`];
  const rateMode = synth.params[`${lfoId}RateMode`];
  const division = synth.params[`${lfoId}Division`];
  const depth = synth.params[`${lfoId}Depth`];
  const target = synth.params[`${lfoId}Target`];
  const now = synth.audioContext.currentTime;

  lfo.osc.type = wave;
  lfo.osc.frequency.setTargetAtTime(resolveLfoRate(synth, rateMode, rate, division), now, 0.01);
  lfo.depth = depth;
  lfo.target = target;

  const shouldMove = rateMode !== "sync" || synth.isClockRunning;
  lfo.gain.gain.setTargetAtTime(shouldMove ? getLfoDepthForTarget(target, depth) : 0, now, 0.01);
  routeLfo(synth, lfoId);
}

export function resolveLfoRate(synth, rateMode, freeRate, division) {
  if (rateMode !== "sync") return freeRate;
  if (!synth.clockBpm) return freeRate;
  const beats = LFO_DIVISION_BEATS[division] || 1;
  return synth.clockBpm / (60 * beats);
}

export function getLfoDepthForTarget(target, depth) {
  if (target === "pitch") return depth * 100;
  if (target === "filterCutoff") return depth * 4000;
  if (target === "osc1Level" || target === "osc2Level") return depth * 0.5;
  return 0;
}

export function disconnectLfo(synth, lfoId) {
  const lfo = synth.lfoState[lfoId];
  if (!lfo || !lfo.gain) return;
  try {
    lfo.gain.disconnect();
  } catch (_e) {}
}

export function routeLfo(synth, lfoId) {
  const lfo = synth.lfoState[lfoId];
  if (!lfo || !lfo.gain) return;
  disconnectLfo(synth, lfoId);
  if (lfo.target === "off") return;
  if (lfo.target === "filterCutoff") {
    lfo.gain.connect(synth.filter.frequency);
    return;
  }
  synth.voices.forEach((voice) => connectLfoToVoice(synth, lfoId, voice));
}

export function connectLfoToVoice(synth, lfoId, voice) {
  const lfo = synth.lfoState[lfoId];
  if (!lfo || !lfo.gain) return;
  if (lfo.target === "pitch") {
    lfo.gain.connect(voice.osc1.detune);
    lfo.gain.connect(voice.osc2.detune);
    return;
  }
  if (lfo.target === "osc1Level") {
    lfo.gain.connect(voice.osc1Gain.gain);
    return;
  }
  if (lfo.target === "osc2Level") {
    lfo.gain.connect(voice.osc2Gain.gain);
  }
}

export function refreshLfoRouting(synth) {
  routeLfo(synth, "lfo1");
  routeLfo(synth, "lfo2");
}

export function setClockBpm(synth, bpm) {
  synth.clockBpm = bpm;
  updateSyncedLfoRates(synth);
}

export function updateSyncedLfoRates(synth) {
  if (!synth.audioContext) return;
  const now = synth.audioContext.currentTime;
  ["lfo1", "lfo2"].forEach((lfoId) => {
    if (synth.params[`${lfoId}RateMode`] !== "sync") return;
    const lfo = synth.lfoState[lfoId];
    if (!lfo || !lfo.osc) return;
    const rate = resolveLfoRate(
      synth,
      synth.params[`${lfoId}RateMode`],
      synth.params[`${lfoId}Rate`],
      synth.params[`${lfoId}Division`]
    );
    lfo.osc.frequency.setTargetAtTime(rate, now, 0.01);
  });
}

export function setSyncedLfoMotionEnabled(synth, isRunning) {
  synth.isClockRunning = isRunning;
  const now = synth.audioContext ? synth.audioContext.currentTime : 0;
  ["lfo1", "lfo2"].forEach((lfoId) => {
    if (synth.params[`${lfoId}RateMode`] !== "sync") return;
    const lfo = synth.lfoState[lfoId];
    if (!lfo || !lfo.gain) return;
    const depth = getLfoDepthForTarget(lfo.target, lfo.depth);
    lfo.gain.gain.cancelScheduledValues(now);
    lfo.gain.gain.setTargetAtTime(isRunning ? depth : 0, now, 0.01);
  });
}

export function restartSyncedLfoPhase(synth) {
  if (!synth.audioContext) return;
  ["lfo1", "lfo2"].forEach((lfoId) => {
    if (synth.params[`${lfoId}RateMode`] !== "sync") return;
    const lfo = synth.lfoState[lfoId];
    if (!lfo || !lfo.osc || !lfo.gain) return;
    try {
      lfo.osc.stop();
    } catch (_e) {}
    try {
      lfo.osc.disconnect();
    } catch (_e) {}
    const osc = synth.audioContext.createOscillator();
    osc.type = synth.params[`${lfoId}Wave`];
    osc.frequency.setValueAtTime(
      resolveLfoRate(
        synth,
        synth.params[`${lfoId}RateMode`],
        synth.params[`${lfoId}Rate`],
        synth.params[`${lfoId}Division`]
      ),
      synth.audioContext.currentTime
    );
    osc.connect(lfo.gain);
    osc.start();
    lfo.osc = osc;
    routeLfo(synth, lfoId);
  });
}
