export async function initMidi({ midiStatusEl, onMidiMessage }) {
  if (!("requestMIDIAccess" in navigator)) {
    midiStatusEl.textContent = "MIDI: not supported in this browser";
    return;
  }

  try {
    const midiAccess = await navigator.requestMIDIAccess();
    const bindInput = (input) => {
      input.onmidimessage = onMidiMessage;
    };
    midiAccess.inputs.forEach(bindInput);
    updateMidiStatus(midiAccess, midiStatusEl);

    midiAccess.onstatechange = () => {
      midiAccess.inputs.forEach(bindInput);
      updateMidiStatus(midiAccess, midiStatusEl);
    };
  } catch (_error) {
    midiStatusEl.textContent = "MIDI: access denied or unavailable";
  }
}

function updateMidiStatus(midiAccess, midiStatusEl) {
  const names = [];
  midiAccess.inputs.forEach((input) => {
    names.push(input.name || "Unnamed MIDI input");
  });
  if (names.length === 0) {
    midiStatusEl.textContent = "MIDI: available, no inputs connected";
    return;
  }
  midiStatusEl.textContent = `MIDI: connected (${names.join(", ")})`;
}
