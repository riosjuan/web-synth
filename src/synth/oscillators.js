import { midiToFrequency } from "../audio-utils.js";

export function applyOscillatorStartParams(osc1, osc2, params, note, now) {
  osc1.type = params.osc1Wave;
  osc2.type = params.osc2Wave;
  osc1.frequency.setValueAtTime(midiToFrequency(note + params.osc1Octave * 12), now);
  osc2.frequency.setValueAtTime(midiToFrequency(note + params.osc2Octave * 12), now);
  osc1.detune.setValueAtTime(params.osc1Detune, now);
  osc2.detune.setValueAtTime(params.osc2Detune, now);
}

export function applyOscParamsToVoice(voice, params, now) {
  const f1 = midiToFrequency(voice.note + params.osc1Octave * 12);
  const f2 = midiToFrequency(voice.note + params.osc2Octave * 12);

  voice.osc1.type = params.osc1Wave;
  voice.osc2.type = params.osc2Wave;
  voice.osc1.frequency.setTargetAtTime(f1, now, 0.01);
  voice.osc2.frequency.setTargetAtTime(f2, now, 0.01);
  voice.osc1.detune.setTargetAtTime(params.osc1Detune, now, 0.01);
  voice.osc2.detune.setTargetAtTime(params.osc2Detune, now, 0.01);
  voice.osc1Gain.gain.setTargetAtTime(params.osc1Level, now, 0.01);
  voice.osc2Gain.gain.setTargetAtTime(params.osc2Level, now, 0.01);
}
