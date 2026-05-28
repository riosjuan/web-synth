const MIDI_CC_MAP = {
  1: { name: "Mod Wheel", target: "lfo1Depth" },
  2: { name: "Breath Controller", target: "filterQ" },
  7: { name: "Channel Volume", target: "masterVolume" },
  10: { name: "Pan", target: "reserved" },
  11: { name: "Expression", target: "expression" },
  20: { name: "Undefined 20", target: "osc1Level" },
  21: { name: "Undefined 21", target: "osc2Level" },
  22: { name: "Undefined 22", target: "osc1Detune" },
  23: { name: "Undefined 23", target: "osc2Detune" },
  24: { name: "Undefined 24", target: "osc1Octave" },
  25: { name: "Undefined 25", target: "osc2Octave" },
  64: { name: "Sustain Pedal", target: "sustainPedal" },
  71: { name: "Resonance", target: "filterQ" },
  72: { name: "Release Time", target: "release" },
  73: { name: "Attack Time", target: "attack" },
  74: { name: "Brightness", target: "filterCutoff" },
  75: { name: "Decay Time", target: "decay" },
  76: { name: "Vibrato Rate", target: "lfo1Rate" },
  77: { name: "Vibrato Depth", target: "lfo1Depth" },
  78: { name: "Vibrato Delay", target: "reserved" },
  120: { name: "All Sound Off", target: "allSoundOff" },
  123: { name: "All Notes Off", target: "allNotesOff" },
};

const LFO_DIVISION_BEATS = {
  "1/1": 4,
  "1/2": 2,
  "1/4": 1,
  "1/8": 0.5,
  "1/16": 0.25,
  "1/32": 0.125,
  "1/4T": 2 / 3,
  "1/8T": 1 / 3,
  "1/16T": 1 / 6,
  "1/4.": 1.5,
  "1/8.": 0.75,
  "1/16.": 0.375,
};

const PARAM_CONFIG = {
  osc1Octave: { min: -2, max: 2, step: 1, digits: 0 },
  osc2Octave: { min: -2, max: 2, step: 1, digits: 0 },
  osc1Detune: { min: -50, max: 50, step: 1, digits: 0 },
  osc2Detune: { min: -50, max: 50, step: 1, digits: 0 },
  osc1Level: { min: 0, max: 1, step: 0.01, digits: 2 },
  osc2Level: { min: 0, max: 1, step: 0.01, digits: 2 },
  filterCutoff: { min: 0, max: 127, step: 1, digits: 0 },
  filterQ: { min: 0, max: 127, step: 1, digits: 0 },
  attack: { min: 0, max: 127, step: 1, digits: 0 },
  decay: { min: 0, max: 127, step: 1, digits: 0 },
  sustain: { min: 0, max: 127, step: 1, digits: 0 },
  release: { min: 0, max: 127, step: 1, digits: 0 },
  lfo1Rate: { min: 0.01, max: 20, step: 0.01, digits: 2 },
  lfo1Depth: { min: 0, max: 1, step: 0.01, digits: 2 },
  lfo2Rate: { min: 0.01, max: 20, step: 0.01, digits: 2 },
  lfo2Depth: { min: 0, max: 1, step: 0.01, digits: 2 },
  masterVolume: { min: 0, max: 1, step: 0.01, digits: 2 },
};

const params = {
  osc1Wave: "triangle",
  osc1Octave: 0,
  osc1Detune: 0,
  osc1Level: 0.5,
  osc2Wave: "sawtooth",
  osc2Octave: 0,
  osc2Detune: 0,
  osc2Level: 0.5,
  filterCutoff: 109,
  filterQ: 4,
  attack: 1,
  decay: 13,
  sustain: 89,
  release: 12,
  lfo1Wave: "sine",
  lfo1Target: "off",
  lfo1Rate: 4,
  lfo1Depth: 0,
  lfo1RateMode: "free",
  lfo1Division: "1/4",
  lfo2Wave: "triangle",
  lfo2Target: "off",
  lfo2Rate: 0.5,
  lfo2Depth: 0,
  lfo2RateMode: "free",
  lfo2Division: "1/4",
  masterVolume: 0.6,
};

class Synth {
  constructor(initialParams) {
    this.params = initialParams;
    this.audioContext = null;
    this.masterGain = null;
    this.outputLimiter = null;
    this.filter = null;
    this.voices = new Map();
    this.lfoState = {
      lfo1: { osc: null, gain: null, target: "off", depth: 0 },
      lfo2: { osc: null, gain: null, target: "off", depth: 0 },
    };
    this.midiClockBpm = null;
    this.midiClockRunning = false;
    this.midiClockStopped = false;
    this.midiClockTickTimes = [];
    this.lastClockTickAt = 0;
    this.expression = 1;
    this.sustainPedalDown = false;
    this.sustainedVoiceIds = new Set();
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

    this.filter.connect(this.masterGain);
    this.masterGain.connect(this.outputLimiter);
    this.outputLimiter.connect(this.audioContext.destination);

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
      return;
    }

    if (name.startsWith("osc")) {
      this.voices.forEach((voice) => this.applyOscParamsToVoice(voice));
      this.refreshLfoRouting();
      return;
    }

    if (name.startsWith("lfo")) {
      this.updateLfoFromParams(name.slice(0, 4));
    }
  }

  initLfos() {
    this.createLfo("lfo1");
    this.createLfo("lfo2");
    this.updateLfoFromParams("lfo1");
    this.updateLfoFromParams("lfo2");
  }

  createLfo(lfoId) {
    const osc = this.audioContext.createOscillator();
    const gain = this.audioContext.createGain();
    gain.gain.value = 0;
    osc.connect(gain);
    osc.start();

    this.lfoState[lfoId].osc = osc;
    this.lfoState[lfoId].gain = gain;
  }

  updateLfoFromParams(lfoId) {
    if (!this.audioContext) {
      return;
    }

    const lfo = this.lfoState[lfoId];
    if (!lfo || !lfo.osc || !lfo.gain) {
      return;
    }

    const wave = this.params[`${lfoId}Wave`];
    const rate = this.params[`${lfoId}Rate`];
    const rateMode = this.params[`${lfoId}RateMode`];
    const division = this.params[`${lfoId}Division`];
    const depth = this.params[`${lfoId}Depth`];
    const target = this.params[`${lfoId}Target`];
    const now = this.audioContext.currentTime;

    lfo.osc.type = wave;
    lfo.osc.frequency.setTargetAtTime(this.resolveLfoRate(rateMode, rate, division), now, 0.01);
    lfo.depth = depth;
    lfo.target = target;

    const shouldMove = rateMode !== "sync" || this.midiClockRunning;
    const targetDepth = shouldMove ? this.getLfoDepthForTarget(target, depth) : 0;
    lfo.gain.gain.setTargetAtTime(targetDepth, now, 0.01);

    this.routeLfo(lfoId);
  }

  resolveLfoRate(rateMode, freeRate, division) {
    if (rateMode !== "sync") {
      return freeRate;
    }

    if (!this.midiClockBpm) {
      return freeRate;
    }

    const beats = LFO_DIVISION_BEATS[division] || 1;
    return this.midiClockBpm / (60 * beats);
  }

  getLfoDepthForTarget(target, depth) {
    if (target === "pitch") {
      return depth * 100;
    }
    if (target === "filterCutoff") {
      return depth * 4000;
    }
    if (target === "osc1Level" || target === "osc2Level") {
      return depth * 0.5;
    }
    return 0;
  }

  disconnectLfo(lfoId) {
    const lfo = this.lfoState[lfoId];
    if (!lfo || !lfo.gain) {
      return;
    }
    try {
      lfo.gain.disconnect();
    } catch (_error) {
    }
  }

  routeLfo(lfoId) {
    const lfo = this.lfoState[lfoId];
    if (!lfo || !lfo.gain) {
      return;
    }

    this.disconnectLfo(lfoId);

    if (lfo.target === "off") {
      return;
    }

    if (lfo.target === "filterCutoff") {
      lfo.gain.connect(this.filter.frequency);
      return;
    }

    this.voices.forEach((voice) => {
      this.connectLfoToVoice(lfoId, voice);
    });
  }

  connectLfoToVoice(lfoId, voice) {
    const lfo = this.lfoState[lfoId];
    if (!lfo || !lfo.gain) {
      return;
    }

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

  refreshLfoRouting() {
    this.routeLfo("lfo1");
    this.routeLfo("lfo2");
  }

  setMidiClockBpm(bpm) {
    this.midiClockBpm = bpm;
    this.updateSyncedLfoRates();
  }

  updateSyncedLfoRates() {
    if (!this.audioContext) {
      return;
    }

    const now = this.audioContext.currentTime;
    ["lfo1", "lfo2"].forEach((lfoId) => {
      if (this.params[`${lfoId}RateMode`] !== "sync") {
        return;
      }
      const lfo = this.lfoState[lfoId];
      if (!lfo || !lfo.osc) {
        return;
      }
      const rate = this.resolveLfoRate(
        this.params[`${lfoId}RateMode`],
        this.params[`${lfoId}Rate`],
        this.params[`${lfoId}Division`]
      );
      lfo.osc.frequency.setTargetAtTime(rate, now, 0.01);
    });
  }

  setSyncedLfoMovementRunning(isRunning) {
    this.midiClockRunning = isRunning;
    const now = this.audioContext ? this.audioContext.currentTime : 0;

    ["lfo1", "lfo2"].forEach((lfoId) => {
      if (this.params[`${lfoId}RateMode`] !== "sync") {
        return;
      }

      const lfo = this.lfoState[lfoId];
      if (!lfo || !lfo.gain) {
        return;
      }

      const depth = this.getLfoDepthForTarget(lfo.target, lfo.depth);
      lfo.gain.gain.cancelScheduledValues(now);
      lfo.gain.gain.setTargetAtTime(isRunning ? depth : 0, now, 0.01);
    });
  }

  restartSyncedLfoPhase() {
    if (!this.audioContext) {
      return;
    }

    ["lfo1", "lfo2"].forEach((lfoId) => {
      if (this.params[`${lfoId}RateMode`] !== "sync") {
        return;
      }

      const lfo = this.lfoState[lfoId];
      if (!lfo || !lfo.osc || !lfo.gain) {
        return;
      }

      try {
        lfo.osc.stop();
      } catch (_error) {
      }
      try {
        lfo.osc.disconnect();
      } catch (_error) {
      }

      const osc = this.audioContext.createOscillator();
      osc.type = this.params[`${lfoId}Wave`];
      osc.frequency.setValueAtTime(
        this.resolveLfoRate(
          this.params[`${lfoId}RateMode`],
          this.params[`${lfoId}Rate`],
          this.params[`${lfoId}Division`]
        ),
        this.audioContext.currentTime
      );
      osc.connect(lfo.gain);
      osc.start();
      lfo.osc = osc;

      this.routeLfo(lfoId);
    });
  }

  updateMasterGain() {
    if (!this.audioContext || !this.masterGain) {
      return;
    }
    const now = this.audioContext.currentTime;
    const effectiveGain = this.params.masterVolume * this.expression;
    this.masterGain.gain.setTargetAtTime(effectiveGain, now, 0.01);
  }

  setExpressionFromCC(ccValue) {
    this.expression = Math.max(0, Math.min(1, ccValue / 127));
    this.updateMasterGain();
  }

  applyOscParamsToVoice(voice) {
    const f1 = midiToFrequency(voice.note + this.params.osc1Octave * 12);
    const f2 = midiToFrequency(voice.note + this.params.osc2Octave * 12);

    const now = this.audioContext.currentTime;
    voice.osc1.type = this.params.osc1Wave;
    voice.osc2.type = this.params.osc2Wave;

    voice.osc1.frequency.setTargetAtTime(f1, now, 0.01);
    voice.osc2.frequency.setTargetAtTime(f2, now, 0.01);
    voice.osc1.detune.setTargetAtTime(this.params.osc1Detune, now, 0.01);
    voice.osc2.detune.setTargetAtTime(this.params.osc2Detune, now, 0.01);
    voice.osc1Gain.gain.setTargetAtTime(this.params.osc1Level, now, 0.01);
    voice.osc2Gain.gain.setTargetAtTime(this.params.osc2Level, now, 0.01);
  }

  noteOn(note, velocity = 127, voiceId = note) {
    if (!this.audioContext || this.audioContext.state !== "running") {
      return;
    }

    this.noteOff(voiceId);

    const now = this.audioContext.currentTime;
    const velocityGain = Math.max(0, Math.min(1, velocity / 127));

    const osc1 = this.audioContext.createOscillator();
    const osc2 = this.audioContext.createOscillator();
    const osc1Gain = this.audioContext.createGain();
    const osc2Gain = this.audioContext.createGain();
    const amp = this.audioContext.createGain();

    osc1Gain.gain.value = this.params.osc1Level;
    osc2Gain.gain.value = this.params.osc2Level;
    amp.gain.value = 0;

    this.applyOscillatorStartParams(osc1, osc2, note, now);

    osc1.connect(osc1Gain);
    osc2.connect(osc2Gain);
    osc1Gain.connect(amp);
    osc2Gain.connect(amp);
    amp.connect(this.filter);

    const peak = velocityGain * 0.45;
    const sustainLevel = peak * sustainControlToLevel(this.params.sustain);
    const attackEnd = now + envelopeControlToSeconds(this.params.attack, 0.001, 2);
    const decayEnd = attackEnd + envelopeControlToSeconds(this.params.decay, 0.001, 2);

    amp.gain.cancelScheduledValues(now);
    amp.gain.setValueAtTime(0, now);
    amp.gain.linearRampToValueAtTime(peak, attackEnd);
    amp.gain.linearRampToValueAtTime(sustainLevel, decayEnd);

    osc1.start(now);
    osc2.start(now);

    const voice = {
      id: voiceId,
      note,
      osc1,
      osc2,
      osc1Gain,
      osc2Gain,
      amp,
      velocityGain,
      released: false,
    };

    this.voices.set(voiceId, voice);
    this.connectLfoToVoice("lfo1", voice);
    this.connectLfoToVoice("lfo2", voice);
  }

  applyOscillatorStartParams(osc1, osc2, note, now) {
    osc1.type = this.params.osc1Wave;
    osc2.type = this.params.osc2Wave;

    osc1.frequency.setValueAtTime(
      midiToFrequency(note + this.params.osc1Octave * 12),
      now
    );
    osc2.frequency.setValueAtTime(
      midiToFrequency(note + this.params.osc2Octave * 12),
      now
    );

    osc1.detune.setValueAtTime(this.params.osc1Detune, now);
    osc2.detune.setValueAtTime(this.params.osc2Detune, now);
  }

  noteOff(voiceId) {
    if (!this.audioContext) {
      return;
    }

    const voice = this.voices.get(voiceId);
    if (!voice || voice.released) {
      return;
    }

    if (this.sustainPedalDown) {
      this.sustainedVoiceIds.add(voiceId);
      return;
    }

    voice.released = true;

    const now = this.audioContext.currentTime;
    const releaseSeconds = envelopeControlToSeconds(this.params.release, 0.01, 4);
    const releaseEnd = now + releaseSeconds;

    if (typeof voice.amp.gain.cancelAndHoldAtTime === "function") {
      voice.amp.gain.cancelAndHoldAtTime(now);
    } else {
      voice.amp.gain.cancelScheduledValues(now);
      voice.amp.gain.setValueAtTime(voice.amp.gain.value, now);
    }
    voice.amp.gain.linearRampToValueAtTime(0, releaseEnd);

    voice.osc1.stop(releaseEnd + 0.02);
    voice.osc2.stop(releaseEnd + 0.02);

    window.setTimeout(() => {
      voice.osc1.disconnect();
      voice.osc2.disconnect();
      voice.osc1Gain.disconnect();
      voice.osc2Gain.disconnect();
      voice.amp.disconnect();
      if (this.voices.get(voiceId) === voice) {
        this.voices.delete(voiceId);
      }
    }, Math.ceil((releaseSeconds + 0.05) * 1000));
  }

  allNotesOff() {
    const wasSustainDown = this.sustainPedalDown;
    this.sustainPedalDown = false;
    this.sustainedVoiceIds.clear();
    Array.from(this.voices.keys()).forEach((voiceId) => this.noteOff(voiceId));
    this.sustainPedalDown = wasSustainDown;
  }

  forceAllNotesOff() {
    this.sustainPedalDown = false;
    this.sustainedVoiceIds.clear();
    Array.from(this.voices.values()).forEach((voice) => {
      try {
        voice.osc1.stop();
      } catch (_error) {
      }
      try {
        voice.osc2.stop();
      } catch (_error) {
      }
      voice.osc1.disconnect();
      voice.osc2.disconnect();
      voice.osc1Gain.disconnect();
      voice.osc2Gain.disconnect();
      voice.amp.disconnect();
    });
    this.voices.clear();
  }

  handleSustainPedal(ccValue) {
    const pedalDown = ccValue >= 64;
    if (pedalDown) {
      this.sustainPedalDown = true;
      return;
    }

    this.sustainPedalDown = false;
    const heldVoices = Array.from(this.sustainedVoiceIds);
    this.sustainedVoiceIds.clear();
    heldVoices.forEach((voiceId) => this.noteOff(voiceId));
  }
}

function midiToFrequency(note) {
  return 440 * (2 ** ((note - 69) / 12));
}

function clampToConfig(paramName, value) {
  const config = PARAM_CONFIG[paramName];
  if (!config) {
    return value;
  }
  const clamped = Math.max(config.min, Math.min(config.max, value));
  const precision = Math.max(0, `${config.step}`.split(".")[1]?.length || 0);
  return Number(clamped.toFixed(precision));
}

function ccValueToParam(paramName, ccValue) {
  const config = PARAM_CONFIG[paramName];
  if (!config) {
    return ccValue;
  }

  const ratio = ccValue / 127;
  if (paramName === "filterCutoff") {
    return Math.round(config.min + ratio * (config.max - config.min));
  }

  const raw = config.min + ratio * (config.max - config.min);

  if (config.step >= 1) {
    return Math.round(raw);
  }
  return Number(raw.toFixed(config.digits));
}

function formatParamValue(paramName, value) {
  const config = PARAM_CONFIG[paramName];
  if (!config) {
    return String(value);
  }
  return Number(value).toFixed(config.digits);
}

function cutoffControlToHz(value) {
  const minHz = 80;
  const maxHz = 12000;
  const normalized = Math.max(0, Math.min(127, value)) / 127;
  const minLog = Math.log(minHz);
  const maxLog = Math.log(maxHz);
  return Math.exp(minLog + normalized * (maxLog - minLog));
}

function resonanceControlToQ(value) {
  const minQ = 0.1;
  const maxQ = 20;
  const normalized = Math.max(0, Math.min(127, value)) / 127;
  return minQ + normalized * (maxQ - minQ);
}

function envelopeControlToSeconds(value, minSeconds, maxSeconds) {
  const normalized = Math.max(0, Math.min(127, value)) / 127;
  return minSeconds + normalized * (maxSeconds - minSeconds);
}

function sustainControlToLevel(value) {
  return Math.max(0, Math.min(127, value)) / 127;
}

const synth = new Synth({ ...params });
const midiStatus = document.getElementById("midi-status");
const midiClockStatus = document.getElementById("midi-clock-status");
const audioStatus = document.getElementById("audio-status");
const startAudioButton = document.getElementById("start-audio");
const midiChannelSelect = document.getElementById("midi-channel");
const ccMapBody = document.getElementById("cc-map-body");
const ccMapDialog = document.getElementById("cc-map-dialog");
const openCcMapButton = document.getElementById("open-cc-map");
const closeCcMapButton = document.getElementById("close-cc-map");
const inputByParam = {};
const outputByParam = {};
let selectedMidiChannel = "all";

const TARGET_LABELS = {
  reserved: "Reserved",
  expression: "Expression",
  sustainPedal: "Sustain pedal",
  allSoundOff: "All sound off",
  allNotesOff: "All notes off",
  masterVolume: "Master volume",
  filterQ: "Filter resonance",
  filterCutoff: "Filter cutoff",
  attack: "Attack",
  decay: "Decay",
  release: "Release",
  osc1Level: "Osc 1 level",
  osc2Level: "Osc 2 level",
  osc1Detune: "Osc 1 detune",
  osc2Detune: "Osc 2 detune",
  osc1Octave: "Osc 1 octave",
  osc2Octave: "Osc 2 octave",
  lfo1Rate: "LFO 1 rate",
  lfo1Depth: "LFO 1 depth",
  lfo2Rate: "LFO 2 rate",
  lfo2Depth: "LFO 2 depth",
  lfo1RateMode: "LFO 1 rate mode",
  lfo2RateMode: "LFO 2 rate mode",
  lfo1Division: "LFO 1 division",
  lfo2Division: "LFO 2 division",
};

function bindControls() {
  const controls = document.querySelectorAll("[data-param]");
  controls.forEach((el) => {
    const paramName = el.dataset.param;
    if (!paramName) {
      return;
    }

    if (el.type === "radio") {
      if (!Array.isArray(inputByParam[paramName])) {
        inputByParam[paramName] = [];
      }
      inputByParam[paramName].push(el);
    } else {
      inputByParam[paramName] = el;
    }

    const output = document.getElementById(`${el.id}-value`);
    if (output) {
      outputByParam[paramName] = output;
      output.textContent = formatParamValue(paramName, params[paramName]);
    }

    el.addEventListener("input", () => {
      const isSelect = el.tagName.toLowerCase() === "select";
      const isRadio = el.type === "radio";
      const value = isSelect || isRadio ? el.value : Number(el.value);
      updateParamFromUI(paramName, value);
    });
  });

  updateLfoUiState();
}

function updateParamFromUI(paramName, value) {
  const normalized = typeof value === "number" ? clampToConfig(paramName, value) : value;
  params[paramName] = normalized;
  synth.updateParam(paramName, normalized);

  const output = outputByParam[paramName];
  if (output && typeof normalized === "number") {
    output.textContent = formatParamValue(paramName, normalized);
  }

  if (paramName.startsWith("lfo")) {
    updateLfoUiState();
  }
}

function updateLfoUiState() {
  ["lfo1", "lfo2"].forEach((lfoId) => {
    const rateInput = inputByParam[`${lfoId}Rate`];
    const divisionInput = inputByParam[`${lfoId}Division`];
    const rateMode = params[`${lfoId}RateMode`];
    const isSync = rateMode === "sync";

    if (rateInput) {
      rateInput.disabled = isSync;
    }
    if (divisionInput) {
      divisionInput.disabled = !isSync;
    }
  });
}

function syncControl(paramName, value) {
  const input = inputByParam[paramName];
  if (!input) {
    return;
  }

  if (Array.isArray(input)) {
    input.forEach((radio) => {
      radio.checked = radio.value === String(value);
    });
    updateParamFromUI(paramName, String(value));
    return;
  }

  input.value = String(value);
  updateParamFromUI(paramName, typeof value === "number" ? value : input.value);
}

function buildCcMapTable() {
  if (!ccMapBody) {
    return;
  }

  const rows = Object.entries(MIDI_CC_MAP)
    .map(([cc, config]) => ({ cc: Number(cc), ...config }))
    .sort((a, b) => a.cc - b.cc);

  ccMapBody.innerHTML = "";

  rows.forEach((row) => {
    const tr = document.createElement("tr");
    const ccCell = document.createElement("td");
    const nameCell = document.createElement("td");
    const targetCell = document.createElement("td");

    ccCell.textContent = String(row.cc);
    nameCell.textContent = row.name;
    targetCell.textContent = TARGET_LABELS[row.target] || row.target;

    tr.appendChild(ccCell);
    tr.appendChild(nameCell);
    tr.appendChild(targetCell);
    ccMapBody.appendChild(tr);
  });
}

async function handleStartAudio() {
  try {
    await synth.init();
    audioStatus.textContent = "Audio: running";
  } catch (error) {
    audioStatus.textContent = "Audio: failed to start";
    console.error(error);
  }
}

function updateMidiClockStatus() {
  if (!midiClockStatus) {
    return;
  }

  if (!synth.midiClockBpm) {
    midiClockStatus.textContent = "MIDI Clock: waiting";
    return;
  }

  const state = synth.midiClockRunning ? "running" : "stopped";
  midiClockStatus.textContent = `MIDI Clock: ${synth.midiClockBpm.toFixed(1)} BPM (${state})`;
}

function handleMidiRealtime(status) {
  if (status === 0xf8) {
    const nowMs = performance.now();
    if (synth.lastClockTickAt > 0) {
      const delta = nowMs - synth.lastClockTickAt;
      if (delta > 0 && delta < 1000) {
        synth.midiClockTickTimes.push(delta);
        if (synth.midiClockTickTimes.length > 96) {
          synth.midiClockTickTimes.shift();
        }
      }
    }
    synth.lastClockTickAt = nowMs;

    if (synth.midiClockTickTimes.length >= 12) {
      const avgMsPerTick =
        synth.midiClockTickTimes.reduce((sum, value) => sum + value, 0) /
        synth.midiClockTickTimes.length;
      const bpm = 60000 / (avgMsPerTick * 24);
      synth.setMidiClockBpm(Math.max(20, Math.min(300, bpm)));
      if (!synth.midiClockStopped && !synth.midiClockRunning) {
        synth.setSyncedLfoMovementRunning(true);
      }
      updateMidiClockStatus();
    }
    return true;
  }

  if (status === 0xfa) {
    synth.midiClockStopped = false;
    synth.midiClockTickTimes = [];
    synth.lastClockTickAt = 0;
    synth.setSyncedLfoMovementRunning(true);
    synth.restartSyncedLfoPhase();
    updateMidiClockStatus();
    return true;
  }

  if (status === 0xfb) {
    synth.midiClockStopped = false;
    synth.midiClockTickTimes = [];
    synth.lastClockTickAt = 0;
    synth.setSyncedLfoMovementRunning(true);
    updateMidiClockStatus();
    return true;
  }

  if (status === 0xfc) {
    synth.midiClockStopped = true;
    synth.setSyncedLfoMovementRunning(false);
    updateMidiClockStatus();
    return true;
  }

  return false;
}

function handleMidiMessage(event) {
  const [status, data1, data2] = event.data;
  if (handleMidiRealtime(status)) {
    return;
  }

  const command = status & 0xf0;
  const channel = (status & 0x0f) + 1;
  const voiceId = `${channel}:${data1}`;
  const isSelectedChannel =
    selectedMidiChannel === "all" || channel === Number(selectedMidiChannel);

  if (command === 0x90) {
    if (!isSelectedChannel) {
      return;
    }
    if (data2 === 0) {
      synth.noteOff(voiceId);
      return;
    }
    synth.noteOn(data1, data2, voiceId);
    return;
  }

  if (command === 0x80) {
    if (!isSelectedChannel) {
      return;
    }
    synth.noteOff(voiceId);
    return;
  }

  if (command === 0xb0) {
    const ccConfig = MIDI_CC_MAP[data1];
    if (!isSelectedChannel) {
      return;
    }

    if (!ccConfig) {
      return;
    }

    if (ccConfig.target === "allSoundOff") {
      synth.forceAllNotesOff();
      return;
    }

    if (ccConfig.target === "allNotesOff") {
      synth.allNotesOff();
      return;
    }

    if (ccConfig.target === "sustainPedal") {
      synth.handleSustainPedal(data2);
      return;
    }

    if (ccConfig.target === "expression") {
      synth.setExpressionFromCC(data2);
      return;
    }

    if (ccConfig.target === "reserved") {
      return;
    }

    if (ccConfig.target === "lfo1Rate" && params.lfo1RateMode === "sync") {
      return;
    }

    if (ccConfig.target === "lfo2Rate" && params.lfo2RateMode === "sync") {
      return;
    }

    const value = ccValueToParam(ccConfig.target, data2);
    syncControl(ccConfig.target, value);
  }
}

function updateMidiStatus(midiAccess) {
  const names = [];
  midiAccess.inputs.forEach((input) => {
    names.push(input.name || "Unnamed MIDI input");
  });

  if (names.length === 0) {
    midiStatus.textContent = "MIDI: available, no inputs connected";
    return;
  }

  midiStatus.textContent = `MIDI: connected (${names.join(", ")})`;
}

async function initMidi() {
  if (!("requestMIDIAccess" in navigator)) {
    midiStatus.textContent = "MIDI: not supported in this browser";
    return;
  }

  try {
    const midiAccess = await navigator.requestMIDIAccess();

    const bindInput = (input) => {
      input.onmidimessage = handleMidiMessage;
    };

    midiAccess.inputs.forEach(bindInput);
    updateMidiStatus(midiAccess);

    midiAccess.onstatechange = () => {
      midiAccess.inputs.forEach(bindInput);
      updateMidiStatus(midiAccess);
    };
  } catch (error) {
    midiStatus.textContent = "MIDI: access denied or unavailable";
    console.error(error);
  }
}

function init() {
  bindControls();
  buildCcMapTable();
  initMidi();

  midiChannelSelect.addEventListener("change", () => {
    synth.allNotesOff();
    selectedMidiChannel = midiChannelSelect.value;
  });

  openCcMapButton.addEventListener("click", () => {
    ccMapDialog.setAttribute("aria-hidden", "false");
  });

  closeCcMapButton.addEventListener("click", () => {
    ccMapDialog.setAttribute("aria-hidden", "true");
  });

  ccMapDialog.addEventListener("click", (event) => {
    if (event.target === ccMapDialog) {
      ccMapDialog.setAttribute("aria-hidden", "true");
    }
  });

  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && ccMapDialog.getAttribute("aria-hidden") === "false") {
      ccMapDialog.setAttribute("aria-hidden", "true");
    }
  });

  startAudioButton.addEventListener("click", handleStartAudio);
}

init();
