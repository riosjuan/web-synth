import {
  cutoffControlToHz,
  resonanceControlToQ,
  midiToFrequency,
  envelopeControlToSeconds,
  sustainControlToLevel,
  controlToUnit,
  mapControl,
  createReverbImpulse,
  makeDistortionCurve,
} from "./audio-utils.js";
import { LFO_DIVISION_BEATS } from "./config.js";

export class Synth {
  constructor(initialParams) {
    this.params = initialParams;
    this.audioContext = null;
    this.masterGain = null;
    this.outputLimiter = null;
    this.filter = null;
    this.fxInputGain = null;
    this.fxDryGain = null;
    this.fxWetGain = null;
    this.delayNode = null;
    this.delayFeedbackGain = null;
    this.delaySendGain = null;
    this.delayReturnGain = null;
    this.chorusDelay = null;
    this.chorusLfo = null;
    this.chorusLfoDepthGain = null;
    this.chorusSendGain = null;
    this.chorusReturnGain = null;
    this.reverbConvolver = null;
    this.reverbSendGain = null;
    this.reverbReturnGain = null;
    this.distShaper = null;
    this.distToneFilter = null;
    this.distSendGain = null;
    this.distReturnGain = null;
    this.voices = new Map();
    this.lfoState = {
      lfo1: { osc: null, gain: null, target: "off", depth: 0 },
      lfo2: { osc: null, gain: null, target: "off", depth: 0 },
    };
    this.clockBpm = null;
    this.isClockRunning = false;
    this.isClockExplicitlyStopped = false;
    this.clockTickIntervalsMs = [];
    this.lastClockTickMs = 0;
    this.expression = 1;
    this.sustainPedalDown = false;
    this.sustainedVoiceIds = new Set();
    this.isSourceMuted = false;
  }

  async init() {
    if (this.audioContext) {
      if (this.audioContext.state === "suspended") {
        await this.audioContext.resume();
      }
      return;
    }

    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    this.audioContext = new AudioCtx();
    this.masterGain = this.audioContext.createGain();
    this.masterGain.gain.value = this.params.masterVolume * this.expression;
    this.outputLimiter = this.audioContext.createDynamicsCompressor();
    this.outputLimiter.threshold.setValueAtTime(-12, this.audioContext.currentTime);
    this.outputLimiter.knee.setValueAtTime(18, this.audioContext.currentTime);
    this.outputLimiter.ratio.setValueAtTime(6, this.audioContext.currentTime);
    this.outputLimiter.attack.setValueAtTime(0.003, this.audioContext.currentTime);
    this.outputLimiter.release.setValueAtTime(0.12, this.audioContext.currentTime);

    this.filter = this.audioContext.createBiquadFilter();
    this.filter.type = "lowpass";
    this.filter.frequency.value = cutoffControlToHz(this.params.filterCutoff);
    this.filter.Q.value = resonanceControlToQ(this.params.filterQ);

    this.fxInputGain = this.audioContext.createGain();
    this.fxDryGain = this.audioContext.createGain();
    this.fxWetGain = this.audioContext.createGain();
    this.delayNode = this.audioContext.createDelay(1.2);
    this.delayFeedbackGain = this.audioContext.createGain();
    this.delaySendGain = this.audioContext.createGain();
    this.delayReturnGain = this.audioContext.createGain();
    this.chorusDelay = this.audioContext.createDelay(0.05);
    this.chorusLfo = this.audioContext.createOscillator();
    this.chorusLfoDepthGain = this.audioContext.createGain();
    this.chorusSendGain = this.audioContext.createGain();
    this.chorusReturnGain = this.audioContext.createGain();
    this.reverbConvolver = this.audioContext.createConvolver();
    this.reverbSendGain = this.audioContext.createGain();
    this.reverbReturnGain = this.audioContext.createGain();
    this.distShaper = this.audioContext.createWaveShaper();
    this.distToneFilter = this.audioContext.createBiquadFilter();
    this.distToneFilter.type = "lowpass";
    this.distToneFilter.frequency.value = 9000;
    this.distSendGain = this.audioContext.createGain();
    this.distReturnGain = this.audioContext.createGain();

    this.filter.connect(this.fxInputGain);
    this.fxInputGain.connect(this.fxDryGain);
    this.fxInputGain.connect(this.delaySendGain);
    this.fxInputGain.connect(this.chorusSendGain);
    this.fxInputGain.connect(this.reverbSendGain);
    this.fxInputGain.connect(this.distSendGain);
    this.delaySendGain.connect(this.delayNode);
    this.delayNode.connect(this.delayFeedbackGain);
    this.delayFeedbackGain.connect(this.delayNode);
    this.delayNode.connect(this.delayReturnGain);
    this.delayReturnGain.connect(this.fxWetGain);
    this.chorusSendGain.connect(this.chorusDelay);
    this.chorusDelay.connect(this.chorusReturnGain);
    this.chorusReturnGain.connect(this.fxWetGain);
    this.chorusLfo.connect(this.chorusLfoDepthGain);
    this.chorusLfoDepthGain.connect(this.chorusDelay.delayTime);
    this.chorusLfo.start();
    this.reverbSendGain.connect(this.reverbConvolver);
    this.reverbConvolver.connect(this.reverbReturnGain);
    this.reverbReturnGain.connect(this.fxWetGain);
    this.distSendGain.connect(this.distShaper);
    this.distShaper.connect(this.distToneFilter);
    this.distToneFilter.connect(this.distReturnGain);
    this.distReturnGain.connect(this.fxWetGain);
    this.fxDryGain.connect(this.masterGain);
    this.fxWetGain.connect(this.masterGain);
    this.masterGain.connect(this.outputLimiter);
    this.outputLimiter.connect(this.audioContext.destination);

    this.updateEffectsFromParams();
    this.applySourceMuteState();
    this.initLfos();

    if (this.audioContext.state === "suspended") {
      await this.audioContext.resume();
    }
  }

  updateParam(name, value) {
    this.params[name] = value;
    if (!this.audioContext) {
      return;
    }
    const now = this.audioContext.currentTime;
    if (name === "masterVolume") {
      this.updateMasterGain();
      return;
    }
    if (name === "filterCutoff") {
      this.filter.frequency.setTargetAtTime(cutoffControlToHz(value), now, 0.01);
      return;
    }
    if (name === "filterQ") {
      this.filter.Q.setTargetAtTime(resonanceControlToQ(value), now, 0.01);
      return;
    }
    if (name === "osc1Level" || name === "osc2Level") {
      this.voices.forEach((voice) => {
        voice[`${name.slice(0, 4)}Gain`].gain.setTargetAtTime(value, now, 0.01);
      });
      this.applySourceMuteState();
      return;
    }
    if (name.startsWith("osc")) {
      this.voices.forEach((voice) => this.applyOscParamsToVoice(voice));
      this.refreshLfoRouting();
      return;
    }
    if (name.startsWith("lfo")) {
      this.updateLfoFromParams(name.slice(0, 4));
      return;
    }
    if (name.startsWith("fx")) {
      this.updateEffectsFromParams();
    }
  }

  hasAudibleSource() {
    return this.params.osc1Level > 0 || this.params.osc2Level > 0;
  }

  applySourceMuteState() {
    if (!this.audioContext) return;
    const now = this.audioContext.currentTime;
    const shouldMute = !this.hasAudibleSource();
    if (shouldMute) {
      if (!this.isSourceMuted) {
        this.forceAllNotesOff();
      }
      this.isSourceMuted = true;
      this.delaySendGain.gain.setTargetAtTime(0, now, 0.005);
      this.chorusSendGain.gain.setTargetAtTime(0, now, 0.005);
      this.reverbSendGain.gain.setTargetAtTime(0, now, 0.005);
      this.distSendGain.gain.setTargetAtTime(0, now, 0.005);
      this.fxWetGain.gain.setTargetAtTime(0, now, 0.005);
      this.fxDryGain.gain.setTargetAtTime(1, now, 0.005);
      return;
    }

    if (this.isSourceMuted) {
      this.isSourceMuted = false;
      this.updateEffectsFromParams();
    }
  }

  updateEffectsFromParams() { /* unchanged behavior */
    if (!this.audioContext) return;
    const now = this.audioContext.currentTime;
    const delayMix = controlToUnit(this.params.fxDelayMix);
    const chorusMix = controlToUnit(this.params.fxChorusMix);
    const reverbMix = controlToUnit(this.params.fxReverbMix);
    const distMix = controlToUnit(this.params.fxDistMix);
    const totalWet = Math.min(0.95, delayMix + chorusMix + reverbMix + distMix);
    this.fxDryGain.gain.setTargetAtTime(1 - totalWet, now, 0.01);
    this.delaySendGain.gain.setTargetAtTime(delayMix, now, 0.01);
    this.chorusSendGain.gain.setTargetAtTime(chorusMix, now, 0.01);
    this.reverbSendGain.gain.setTargetAtTime(reverbMix, now, 0.01);
    this.distSendGain.gain.setTargetAtTime(distMix, now, 0.01);
    this.delayNode.delayTime.setTargetAtTime(mapControl(this.params.fxDelayTime, 0.02, 0.8), now, 0.01);
    this.delayFeedbackGain.gain.setTargetAtTime(mapControl(this.params.fxDelayFeedback, 0, 0.85), now, 0.01);
    this.delayReturnGain.gain.setTargetAtTime(0.8, now, 0.01);
    this.chorusLfo.frequency.setTargetAtTime(mapControl(this.params.fxChorusRate, 0.05, 8), now, 0.01);
    this.chorusLfoDepthGain.gain.setTargetAtTime(mapControl(this.params.fxChorusDepth, 0, 0.02), now, 0.01);
    this.chorusDelay.delayTime.setTargetAtTime(0.012, now, 0.01);
    this.chorusReturnGain.gain.setTargetAtTime(0.9, now, 0.01);
    this.reverbConvolver.buffer = createReverbImpulse(this.audioContext, mapControl(this.params.fxReverbSize, 0.2, 6));
    this.reverbReturnGain.gain.setTargetAtTime(0.9, now, 0.01);
    this.distShaper.curve = makeDistortionCurve(mapControl(this.params.fxDistDrive, 1, 400));
    this.distShaper.oversample = "4x";
    this.distReturnGain.gain.setTargetAtTime(0.8, now, 0.01);
  }

  initLfos() { this.createLfo("lfo1"); this.createLfo("lfo2"); this.updateLfoFromParams("lfo1"); this.updateLfoFromParams("lfo2"); }
  createLfo(lfoId) { const osc = this.audioContext.createOscillator(); const gain = this.audioContext.createGain(); gain.gain.value = 0; osc.connect(gain); osc.start(); this.lfoState[lfoId].osc = osc; this.lfoState[lfoId].gain = gain; }
  updateLfoFromParams(lfoId) {
    if (!this.audioContext) return;
    const lfo = this.lfoState[lfoId]; if (!lfo || !lfo.osc || !lfo.gain) return;
    const wave = this.params[`${lfoId}Wave`]; const rate = this.params[`${lfoId}Rate`];
    const rateMode = this.params[`${lfoId}RateMode`]; const division = this.params[`${lfoId}Division`];
    const depth = this.params[`${lfoId}Depth`]; const target = this.params[`${lfoId}Target`]; const now = this.audioContext.currentTime;
    lfo.osc.type = wave;
    lfo.osc.frequency.setTargetAtTime(this.resolveLfoRate(rateMode, rate, division), now, 0.01);
    lfo.depth = depth; lfo.target = target;
    const shouldMove = rateMode !== "sync" || this.isClockRunning;
    lfo.gain.gain.setTargetAtTime(shouldMove ? this.getLfoDepthForTarget(target, depth) : 0, now, 0.01);
    this.routeLfo(lfoId);
  }
  resolveLfoRate(rateMode, freeRate, division) { if (rateMode !== "sync") return freeRate; if (!this.clockBpm) return freeRate; const beats = LFO_DIVISION_BEATS[division] || 1; return this.clockBpm / (60 * beats); }
  getLfoDepthForTarget(target, depth) { if (target === "pitch") return depth * 100; if (target === "filterCutoff") return depth * 4000; if (target === "osc1Level" || target === "osc2Level") return depth * 0.5; return 0; }
  disconnectLfo(lfoId) { const lfo = this.lfoState[lfoId]; if (!lfo || !lfo.gain) return; try { lfo.gain.disconnect(); } catch (_e) {} }
  routeLfo(lfoId) { const lfo = this.lfoState[lfoId]; if (!lfo || !lfo.gain) return; this.disconnectLfo(lfoId); if (lfo.target === "off") return; if (lfo.target === "filterCutoff") { lfo.gain.connect(this.filter.frequency); return; } this.voices.forEach((voice) => this.connectLfoToVoice(lfoId, voice)); }
  connectLfoToVoice(lfoId, voice) { const lfo = this.lfoState[lfoId]; if (!lfo || !lfo.gain) return; if (lfo.target === "pitch") { lfo.gain.connect(voice.osc1.detune); lfo.gain.connect(voice.osc2.detune); return; } if (lfo.target === "osc1Level") { lfo.gain.connect(voice.osc1Gain.gain); return; } if (lfo.target === "osc2Level") lfo.gain.connect(voice.osc2Gain.gain); }
  refreshLfoRouting() { this.routeLfo("lfo1"); this.routeLfo("lfo2"); }
  setClockBpm(bpm) { this.clockBpm = bpm; this.updateSyncedLfoRates(); }
  updateSyncedLfoRates() { if (!this.audioContext) return; const now = this.audioContext.currentTime; ["lfo1", "lfo2"].forEach((lfoId) => { if (this.params[`${lfoId}RateMode`] !== "sync") return; const lfo = this.lfoState[lfoId]; if (!lfo || !lfo.osc) return; const rate = this.resolveLfoRate(this.params[`${lfoId}RateMode`], this.params[`${lfoId}Rate`], this.params[`${lfoId}Division`]); lfo.osc.frequency.setTargetAtTime(rate, now, 0.01); }); }
  setSyncedLfoMotionEnabled(isRunning) { this.isClockRunning = isRunning; const now = this.audioContext ? this.audioContext.currentTime : 0; ["lfo1", "lfo2"].forEach((lfoId) => { if (this.params[`${lfoId}RateMode`] !== "sync") return; const lfo = this.lfoState[lfoId]; if (!lfo || !lfo.gain) return; const depth = this.getLfoDepthForTarget(lfo.target, lfo.depth); lfo.gain.gain.cancelScheduledValues(now); lfo.gain.gain.setTargetAtTime(isRunning ? depth : 0, now, 0.01); }); }
  restartSyncedLfoPhase() { if (!this.audioContext) return; ["lfo1", "lfo2"].forEach((lfoId) => { if (this.params[`${lfoId}RateMode`] !== "sync") return; const lfo = this.lfoState[lfoId]; if (!lfo || !lfo.osc || !lfo.gain) return; try { lfo.osc.stop(); } catch (_e) {} try { lfo.osc.disconnect(); } catch (_e) {} const osc = this.audioContext.createOscillator(); osc.type = this.params[`${lfoId}Wave`]; osc.frequency.setValueAtTime(this.resolveLfoRate(this.params[`${lfoId}RateMode`], this.params[`${lfoId}Rate`], this.params[`${lfoId}Division`]), this.audioContext.currentTime); osc.connect(lfo.gain); osc.start(); lfo.osc = osc; this.routeLfo(lfoId); }); }
  updateMasterGain() { if (!this.audioContext || !this.masterGain) return; const now = this.audioContext.currentTime; this.masterGain.gain.setTargetAtTime(this.params.masterVolume * this.expression, now, 0.01); }
  setExpressionFromCC(ccValue) { this.expression = Math.max(0, Math.min(1, ccValue / 127)); this.updateMasterGain(); }
  applyOscParamsToVoice(voice) { const f1 = midiToFrequency(voice.note + this.params.osc1Octave * 12); const f2 = midiToFrequency(voice.note + this.params.osc2Octave * 12); const now = this.audioContext.currentTime; voice.osc1.type = this.params.osc1Wave; voice.osc2.type = this.params.osc2Wave; voice.osc1.frequency.setTargetAtTime(f1, now, 0.01); voice.osc2.frequency.setTargetAtTime(f2, now, 0.01); voice.osc1.detune.setTargetAtTime(this.params.osc1Detune, now, 0.01); voice.osc2.detune.setTargetAtTime(this.params.osc2Detune, now, 0.01); voice.osc1Gain.gain.setTargetAtTime(this.params.osc1Level, now, 0.01); voice.osc2Gain.gain.setTargetAtTime(this.params.osc2Level, now, 0.01); }
  stopVoiceImmediately(voiceId) {
    const voice = this.voices.get(voiceId);
    if (!voice) return;
    try { voice.osc1.stop(); } catch (_e) {}
    try { voice.osc2.stop(); } catch (_e) {}
    voice.osc1.disconnect(); voice.osc2.disconnect(); voice.osc1Gain.disconnect(); voice.osc2Gain.disconnect(); voice.amp.disconnect();
    this.voices.delete(voiceId);
    this.sustainedVoiceIds.delete(voiceId);
  }
  noteOn(note, velocity = 127, voiceId = note) {
    if (!this.audioContext || this.audioContext.state !== "running") return;
    if (!this.hasAudibleSource()) return;
    this.stopVoiceImmediately(voiceId);
    const now = this.audioContext.currentTime; const velocityGain = Math.max(0, Math.min(1, velocity / 127));
    const osc1 = this.audioContext.createOscillator(); const osc2 = this.audioContext.createOscillator();
    const osc1Gain = this.audioContext.createGain(); const osc2Gain = this.audioContext.createGain(); const amp = this.audioContext.createGain();
    osc1Gain.gain.value = this.params.osc1Level; osc2Gain.gain.value = this.params.osc2Level; amp.gain.value = 0;
    this.applyOscillatorStartParams(osc1, osc2, note, now);
    osc1.connect(osc1Gain); osc2.connect(osc2Gain); osc1Gain.connect(amp); osc2Gain.connect(amp); amp.connect(this.filter);
    const peak = velocityGain * 0.45;
    const sustainLevel = peak * sustainControlToLevel(this.params.sustain);
    const attackEnd = now + envelopeControlToSeconds(this.params.attack, 0.001, 2);
    const decayEnd = attackEnd + envelopeControlToSeconds(this.params.decay, 0.001, 2);
    amp.gain.cancelScheduledValues(now); amp.gain.setValueAtTime(0, now); amp.gain.linearRampToValueAtTime(peak, attackEnd); amp.gain.linearRampToValueAtTime(sustainLevel, decayEnd);
    osc1.start(now); osc2.start(now);
    const voice = { id: voiceId, note, osc1, osc2, osc1Gain, osc2Gain, amp, velocityGain, released: false };
    this.voices.set(voiceId, voice); this.connectLfoToVoice("lfo1", voice); this.connectLfoToVoice("lfo2", voice);
  }
  applyOscillatorStartParams(osc1, osc2, note, now) { osc1.type = this.params.osc1Wave; osc2.type = this.params.osc2Wave; osc1.frequency.setValueAtTime(midiToFrequency(note + this.params.osc1Octave * 12), now); osc2.frequency.setValueAtTime(midiToFrequency(note + this.params.osc2Octave * 12), now); osc1.detune.setValueAtTime(this.params.osc1Detune, now); osc2.detune.setValueAtTime(this.params.osc2Detune, now); }
  noteOff(voiceId) {
    if (!this.audioContext) return;
    const voice = this.voices.get(voiceId); if (!voice || voice.released) return;
    if (this.sustainPedalDown) { this.sustainedVoiceIds.add(voiceId); return; }
    voice.released = true;
    const now = this.audioContext.currentTime;
    const releaseSeconds = envelopeControlToSeconds(this.params.release, 0.01, 4);
    const releaseEnd = now + releaseSeconds;
    if (typeof voice.amp.gain.cancelAndHoldAtTime === "function") voice.amp.gain.cancelAndHoldAtTime(now);
    else { voice.amp.gain.cancelScheduledValues(now); voice.amp.gain.setValueAtTime(voice.amp.gain.value, now); }
    voice.amp.gain.linearRampToValueAtTime(0, releaseEnd);
    voice.osc1.stop(releaseEnd + 0.02); voice.osc2.stop(releaseEnd + 0.02);
    window.setTimeout(() => { voice.osc1.disconnect(); voice.osc2.disconnect(); voice.osc1Gain.disconnect(); voice.osc2Gain.disconnect(); voice.amp.disconnect(); if (this.voices.get(voiceId) === voice) this.voices.delete(voiceId); }, Math.ceil((releaseSeconds + 0.05) * 1000));
  }
  allNotesOff() { const wasSustainDown = this.sustainPedalDown; this.sustainPedalDown = false; this.sustainedVoiceIds.clear(); Array.from(this.voices.keys()).forEach((voiceId) => this.noteOff(voiceId)); this.sustainPedalDown = wasSustainDown; }
  forceAllNotesOff() { this.sustainPedalDown = false; this.sustainedVoiceIds.clear(); Array.from(this.voices.values()).forEach((voice) => { try { voice.osc1.stop(); } catch (_e) {} try { voice.osc2.stop(); } catch (_e) {} voice.osc1.disconnect(); voice.osc2.disconnect(); voice.osc1Gain.disconnect(); voice.osc2Gain.disconnect(); voice.amp.disconnect(); }); this.voices.clear(); }
  handleSustainPedal(ccValue) { const pedalDown = ccValue >= 64; if (pedalDown) { this.sustainPedalDown = true; return; } this.sustainPedalDown = false; const heldVoices = Array.from(this.sustainedVoiceIds); this.sustainedVoiceIds.clear(); heldVoices.forEach((voiceId) => this.noteOff(voiceId)); }
}
