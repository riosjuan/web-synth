const MIDI_CC_MAP = {
  1: { name: "Mod Wheel", target: "reserved" },
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
  120: { name: "All Sound Off", target: "allSoundOff" },
  123: { name: "All Notes Off", target: "allNotesOff" },
};

const PARAM_CONFIG = {
  osc1Octave: { min: -2, max: 2, step: 1, digits: 0 },
  osc2Octave: { min: -2, max: 2, step: 1, digits: 0 },
  osc1Detune: { min: -50, max: 50, step: 1, digits: 0 },
  osc2Detune: { min: -50, max: 50, step: 1, digits: 0 },
  osc1Level: { min: 0, max: 1, step: 0.01, digits: 2 },
  osc2Level: { min: 0, max: 1, step: 0.01, digits: 2 },
  filterCutoff: { min: 80, max: 12000, step: 1, digits: 0 },
  filterQ: { min: 0.1, max: 20, step: 0.1, digits: 1 },
  attack: { min: 0.001, max: 2, step: 0.001, digits: 3 },
  decay: { min: 0.001, max: 2, step: 0.001, digits: 3 },
  sustain: { min: 0, max: 1, step: 0.01, digits: 2 },
  release: { min: 0.01, max: 4, step: 0.01, digits: 2 },
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
  filterCutoff: 6000,
  filterQ: 0.8,
  attack: 0.02,
  decay: 0.2,
  sustain: 0.7,
  release: 0.4,
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
    this.filter.frequency.value = this.params.filterCutoff;
    this.filter.Q.value = this.params.filterQ;

    this.filter.connect(this.masterGain);
    this.masterGain.connect(this.outputLimiter);
    this.outputLimiter.connect(this.audioContext.destination);

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
      this.filter.frequency.setTargetAtTime(value, now, 0.01);
      return;
    }

    if (name === "filterQ") {
      this.filter.Q.setTargetAtTime(value, now, 0.01);
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
    }
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
    const sustainLevel = peak * this.params.sustain;
    const attackEnd = now + this.params.attack;
    const decayEnd = attackEnd + this.params.decay;

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
    const releaseEnd = now + this.params.release;

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
    }, Math.ceil((this.params.release + 0.05) * 1000));
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
    const minLog = Math.log(config.min);
    const maxLog = Math.log(config.max);
    return Math.round(Math.exp(minLog + ratio * (maxLog - minLog)));
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

const synth = new Synth({ ...params });
const midiStatus = document.getElementById("midi-status");
const audioStatus = document.getElementById("audio-status");
const startAudioButton = document.getElementById("start-audio");
const midiChannelSelect = document.getElementById("midi-channel");
const ccMapBody = document.getElementById("cc-map-body");
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
};

function bindControls() {
  const controls = document.querySelectorAll("[data-param]");
  controls.forEach((el) => {
    const paramName = el.dataset.param;
    if (!paramName) {
      return;
    }

    inputByParam[paramName] = el;
    const output = document.getElementById(`${el.id}-value`);
    if (output) {
      outputByParam[paramName] = output;
      output.textContent = formatParamValue(paramName, params[paramName]);
    }

    el.addEventListener("input", () => {
      const isSelect = el.tagName.toLowerCase() === "select";
      const value = isSelect ? el.value : Number(el.value);
      updateParamFromUI(paramName, value);
    });
  });
}

function updateParamFromUI(paramName, value) {
  const normalized = typeof value === "number" ? clampToConfig(paramName, value) : value;
  params[paramName] = normalized;
  synth.updateParam(paramName, normalized);

  const output = outputByParam[paramName];
  if (output && typeof normalized === "number") {
    output.textContent = formatParamValue(paramName, normalized);
  }
}

function syncControl(paramName, value) {
  const input = inputByParam[paramName];
  if (!input) {
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

function handleMidiMessage(event) {
  const [status, data1, data2] = event.data;
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

  startAudioButton.addEventListener("click", handleStartAudio);
}

init();
