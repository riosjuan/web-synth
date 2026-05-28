import { MIDI_CC_MAP, DEFAULT_PARAMS, TARGET_LABELS } from "./config.js";
import { Synth } from "./synth-engine.js";
import { ccValueToParam } from "./audio-utils.js";
import { initMidi } from "./midi.js";
import { createControlBinder } from "./ui.js";

const params = { ...DEFAULT_PARAMS };
const synth = new Synth(params);

const midiStatus = document.getElementById("midi-status");
const midiClockStatus = document.getElementById("midi-clock-status");
const audioStatus = document.getElementById("audio-status");
const startAudioButton = document.getElementById("start-audio");
const midiChannelSelect = document.getElementById("midi-channel");
let selectedMidiChannel = "all";

const controls = createControlBinder(params, TARGET_LABELS, MIDI_CC_MAP);

function onParamChange(paramName, value) {
  synth.updateParam(paramName, value);
}

async function handleStartAudio() {
  try {
    await synth.init();
    audioStatus.textContent = "Audio: running";
  } catch (_error) {
    audioStatus.textContent = "Audio: failed to start";
  }
}

function updateMidiClockStatus() {
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
        if (synth.midiClockTickTimes.length > 96) synth.midiClockTickTimes.shift();
      }
    }
    synth.lastClockTickAt = nowMs;
    if (synth.midiClockTickTimes.length >= 12) {
      const avgMsPerTick = synth.midiClockTickTimes.reduce((sum, value) => sum + value, 0) /
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
  if (handleMidiRealtime(status)) return;

  const command = status & 0xf0;
  const channel = (status & 0x0f) + 1;
  const voiceId = `${channel}:${data1}`;
  const isSelectedChannel = selectedMidiChannel === "all" || channel === Number(selectedMidiChannel);

  if (command === 0x90) {
    if (!isSelectedChannel) return;
    if (data2 === 0) {
      synth.noteOff(voiceId);
      return;
    }
    synth.noteOn(data1, data2, voiceId);
    return;
  }
  if (command === 0x80) {
    if (!isSelectedChannel) return;
    synth.noteOff(voiceId);
    return;
  }
  if (command === 0xb0) {
    if (!isSelectedChannel) return;
    const ccConfig = MIDI_CC_MAP[data1];
    if (!ccConfig) return;
    if (ccConfig.target === "allSoundOff") return synth.forceAllNotesOff();
    if (ccConfig.target === "allNotesOff") return synth.allNotesOff();
    if (ccConfig.target === "sustainPedal") return synth.handleSustainPedal(data2);
    if (ccConfig.target === "expression") return synth.setExpressionFromCC(data2);
    if (ccConfig.target === "reserved") return;
    if (ccConfig.target === "lfo1Rate" && params.lfo1RateMode === "sync") return;
    if (ccConfig.target === "lfo2Rate" && params.lfo2RateMode === "sync") return;
    const value = ccValueToParam(ccConfig.target, data2);
    controls.syncControl(ccConfig.target, value, onParamChange);
  }
}

function init() {
  controls.bindControls(onParamChange);
  controls.buildCcMapTable();
  controls.bindCcDialog();
  initMidi({ midiStatusEl: midiStatus, onMidiMessage: handleMidiMessage });

  midiChannelSelect.addEventListener("change", () => {
    synth.allNotesOff();
    selectedMidiChannel = midiChannelSelect.value;
  });
  startAudioButton.addEventListener("click", handleStartAudio);
}

init();
