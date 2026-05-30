import { MIDI_CC_MAP, DEFAULT_PARAMS, TARGET_LABELS } from "./config.js";
import { Synth } from "./synth-engine.js";
import { ccValueToParam } from "./audio-utils.js";
import { initMidi } from "./midi.js";
import { createControlBinder } from "./ui.js";

const params = { ...DEFAULT_PARAMS };
const synth = new Synth(params);

const MIDI_REALTIME = {
  CLOCK_TICK: 0xf8,
  START: 0xfa,
  CONTINUE: 0xfb,
  STOP: 0xfc,
};

const midiStatus = document.getElementById("midi-status");
const midiClockStatus = document.getElementById("midi-clock-status");
const midiClockBpm = document.getElementById("midi-clock-bpm");
const audioStatus = document.getElementById("audio-status");
const startAudioButton = document.getElementById("start-audio");
const midiChannelSelect = document.getElementById("midi-channel");
const themeToggleButton = document.getElementById("theme-toggle");
let selectedMidiChannel = "all";

const STATUS_STATES = ["is-locked", "is-running", "is-error", "is-waiting", "is-playing", "is-stopped"];

const controls = createControlBinder(params, TARGET_LABELS, MIDI_CC_MAP);

function onParamChange(paramName, value) {
  synth.updateParam(paramName, value);
}

async function handleStartAudio() {
  try {
    await synth.init();
    setStatus(audioStatus, "running", "running");
  } catch (_error) {
    setStatus(audioStatus, "failed to start", "error");
  }
}

function updateClockStatusText() {
  if (!synth.clockBpm) {
    setStatus(midiClockBpm, "--.- BPM", "waiting");
    setStatus(midiClockStatus, "waiting", "waiting");
    return;
  }
  const state = synth.isClockRunning ? "playing" : "stopped";
  setStatus(midiClockBpm, `${synth.clockBpm.toFixed(1)} BPM`, state);
  setStatus(midiClockStatus, state, state);
}

function setStatus(element, text, state) {
  if (!element) return;
  element.textContent = text;
  element.classList.remove(...STATUS_STATES);
  if (state) {
    element.classList.add(`is-${state}`);
  }
}

function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  if (!themeToggleButton) return;
  const isDark = theme === "dark";
  themeToggleButton.textContent = isDark ? "Light mode" : "Dark mode";
  themeToggleButton.setAttribute("aria-label", isDark ? "Switch to light theme" : "Switch to dark theme");
  window.dispatchEvent(new CustomEvent("themechange"));
}

function initThemeToggle() {
  if (!themeToggleButton) return;

  const storedTheme = window.localStorage.getItem("theme-preference");
  const initialTheme = storedTheme === "light" || storedTheme === "dark"
    ? storedTheme
    : (document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light");
  applyTheme(initialTheme);

  themeToggleButton.addEventListener("click", () => {
    const currentTheme = document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
    const nextTheme = currentTheme === "dark" ? "light" : "dark";
    applyTheme(nextTheme);
    window.localStorage.setItem("theme-preference", nextTheme);
  });
}

function handleMidiRealtimeStatus(status) {
  if (status === MIDI_REALTIME.CLOCK_TICK) {
    const nowMs = performance.now();
    if (synth.lastClockTickMs > 0) {
      const tickDeltaMs = nowMs - synth.lastClockTickMs;
      if (tickDeltaMs > 0 && tickDeltaMs < 1000) {
        synth.clockTickIntervalsMs.push(tickDeltaMs);
        if (synth.clockTickIntervalsMs.length > 96) synth.clockTickIntervalsMs.shift();
      }
    }
    synth.lastClockTickMs = nowMs;
    if (synth.clockTickIntervalsMs.length >= 12) {
      const avgMsPerTick = synth.clockTickIntervalsMs.reduce((sum, value) => sum + value, 0) /
        synth.clockTickIntervalsMs.length;
      const bpm = 60000 / (avgMsPerTick * 24);
      synth.setClockBpm(Math.max(20, Math.min(300, bpm)));
      if (!synth.isClockExplicitlyStopped && !synth.isClockRunning) {
        synth.setSyncedLfoMotionEnabled(true);
      }
      updateClockStatusText();
    }
    return true;
  }
  if (status === MIDI_REALTIME.START) {
    synth.isClockExplicitlyStopped = false;
    synth.clockTickIntervalsMs = [];
    synth.lastClockTickMs = 0;
    synth.setSyncedLfoMotionEnabled(true);
    synth.restartSyncedLfoPhase();
    updateClockStatusText();
    return true;
  }
  if (status === MIDI_REALTIME.CONTINUE) {
    synth.isClockExplicitlyStopped = false;
    synth.clockTickIntervalsMs = [];
    synth.lastClockTickMs = 0;
    synth.setSyncedLfoMotionEnabled(true);
    updateClockStatusText();
    return true;
  }
  if (status === MIDI_REALTIME.STOP) {
    synth.isClockExplicitlyStopped = true;
    synth.setSyncedLfoMotionEnabled(false);
    updateClockStatusText();
    return true;
  }
  return false;
}

function handleMidiMessage(event) {
  const [status, data1, data2] = event.data;
  if (handleMidiRealtimeStatus(status)) return;

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
  initThemeToggle();
  setStatus(audioStatus, "locked", "locked");
  setStatus(midiStatus, "checking...", "waiting");
  setStatus(midiClockBpm, "--.- BPM", "waiting");
  setStatus(midiClockStatus, "waiting", "waiting");
  controls.bindControls(onParamChange);
  controls.buildCcMapTable();
  controls.bindCcDialog();
  initMidi({
    midiStatusEl: midiStatus,
    onMidiMessage: handleMidiMessage,
    onMidiStatusChange: (text, state) => setStatus(midiStatus, text, state),
  });

  midiChannelSelect.addEventListener("change", () => {
    synth.allNotesOff();
    selectedMidiChannel = midiChannelSelect.value;
  });
  startAudioButton.addEventListener("click", handleStartAudio);
}

init();
