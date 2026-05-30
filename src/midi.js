export async function initMidi({ midiStatusEl, onMidiMessage, onMidiStatusChange }) {
  const setStatus = (text, state) => {
    midiStatusEl.textContent = text;
    if (onMidiStatusChange) onMidiStatusChange(text, state);
  };

  if (!("requestMIDIAccess" in navigator)) {
    setStatus("not supported in this browser", "error");
    return;
  }

  try {
    const midiAccess = await navigator.requestMIDIAccess();
    const bindInput = (input) => {
      input.onmidimessage = onMidiMessage;
    };
    midiAccess.inputs.forEach(bindInput);
    updateMidiStatus(midiAccess, setStatus);

    midiAccess.onstatechange = () => {
      midiAccess.inputs.forEach(bindInput);
      updateMidiStatus(midiAccess, setStatus);
    };
  } catch (_error) {
    setStatus("access denied or unavailable", "error");
  }
}

function updateMidiStatus(midiAccess, setStatus) {
  const names = [];
  midiAccess.inputs.forEach((input) => {
    names.push(input.name || "Unnamed MIDI input");
  });
  if (names.length === 0) {
    setStatus("available, no inputs connected", "stopped");
    return;
  }
  setStatus(`connected (${names.join(", ")})`, "running");
}
