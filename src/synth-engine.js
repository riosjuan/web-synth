import {
  cutoffControlToHz,
  resonanceControlToQ,
} from "./audio-utils.js";
import { applyOscParamsToVoice } from "./synth/oscillators.js";
import {
  createEffectsNodes,
  connectEffectsGraph,
  updateEffectsFromParams as applyEffectsFromParams,
} from "./synth/effects.js";
import {
  initLfos as initLfoState,
  createLfo as createLfoNode,
  updateLfoFromParams as applyLfoFromParams,
  resolveLfoRate as getResolvedLfoRate,
  getLfoDepthForTarget,
  disconnectLfo as disconnectLfoNode,
  routeLfo as routeLfoNode,
  connectLfoToVoice as connectLfoVoice,
  refreshLfoRouting as refreshLfoRoutes,
  setClockBpm as setLfoClockBpm,
  updateSyncedLfoRates as syncLfoRates,
  setSyncedLfoMotionEnabled as setLfoMotionEnabled,
  restartSyncedLfoPhase as restartLfoPhase,
} from "./synth/lfo.js";
import {
  stopVoiceImmediately as stopVoiceNow,
  noteOn as startNote,
  noteOff as releaseNote,
  allNotesOff as releaseAllNotes,
  forceAllNotesOff as panicAllNotes,
  handleSustainPedal as applySustainPedal,
} from "./synth/voice.js";

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

    const effectsNodes = createEffectsNodes(this.audioContext);
    Object.assign(this, effectsNodes);

    this.filter.connect(this.fxInputGain);
    connectEffectsGraph(this, this.masterGain);
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
      this.voices.forEach((voice) => applyOscParamsToVoice(voice, this.params, now));
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

  updateEffectsFromParams() {
    if (!this.audioContext) return;
    applyEffectsFromParams(this.audioContext, this, this.params);
  }

  initLfos() {
    initLfoState(this);
  }

  createLfo(lfoId) {
    createLfoNode(this, lfoId);
  }

  updateLfoFromParams(lfoId) {
    applyLfoFromParams(this, lfoId);
  }

  resolveLfoRate(rateMode, freeRate, division) {
    return getResolvedLfoRate(this, rateMode, freeRate, division);
  }

  getLfoDepthForTarget(target, depth) {
    return getLfoDepthForTarget(target, depth);
  }

  disconnectLfo(lfoId) {
    disconnectLfoNode(this, lfoId);
  }

  routeLfo(lfoId) {
    routeLfoNode(this, lfoId);
  }

  connectLfoToVoice(lfoId, voice) {
    connectLfoVoice(this, lfoId, voice);
  }

  refreshLfoRouting() {
    refreshLfoRoutes(this);
  }

  setClockBpm(bpm) {
    setLfoClockBpm(this, bpm);
  }

  updateSyncedLfoRates() {
    syncLfoRates(this);
  }

  setSyncedLfoMotionEnabled(isRunning) {
    setLfoMotionEnabled(this, isRunning);
  }

  restartSyncedLfoPhase() {
    restartLfoPhase(this);
  }

  updateMasterGain() {
    if (!this.audioContext || !this.masterGain) return;
    const now = this.audioContext.currentTime;
    this.masterGain.gain.setTargetAtTime(this.params.masterVolume * this.expression, now, 0.01);
  }

  setExpressionFromCC(ccValue) {
    this.expression = Math.max(0, Math.min(1, ccValue / 127));
    this.updateMasterGain();
  }

  stopVoiceImmediately(voiceId) {
    stopVoiceNow(this, voiceId);
  }
  noteOn(note, velocity = 127, voiceId = note) {
    startNote(this, note, velocity, voiceId, this.connectLfoToVoice.bind(this));
  }
  noteOff(voiceId) {
    releaseNote(this, voiceId);
  }

  allNotesOff() {
    releaseAllNotes(this);
  }

  forceAllNotesOff() {
    panicAllNotes(this);
  }

  handleSustainPedal(ccValue) {
    applySustainPedal(this, ccValue);
  }
}
