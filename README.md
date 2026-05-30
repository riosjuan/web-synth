# Web Synth

A browser-based polyphonic synthesizer built with the Web Audio API and plain ES modules.

## Features

- Dual oscillators with waveform, octave, detune, and level controls
- Filter and ADSR envelope shaping
- Two LFOs with free/sync rate modes and MIDI clock sync support
- Built-in FX section: delay, chorus, reverb, and distortion
- MIDI input support with configurable channel filtering
- MIDI CC map dialog for control reference

## Requirements

- A modern browser with Web Audio and Web MIDI support (Chrome/Edge recommended)
- A MIDI controller or virtual MIDI source (optional)

## Run locally

Serve the project from a local HTTP server:

```bash
python3 -m http.server 8000
```

Then open:

`http://localhost:8000`

Notes:

- Click `Start Audio` once to unlock audio output.
- Browser MIDI permission prompts may appear the first time.

## Project structure

- `index.html` - UI markup
- `styles.css` - UI styling
- `src/main.js` - app bootstrap and event wiring
- `src/synth-engine.js` - synth voice, modulation, and FX engine
- `src/midi.js` - MIDI setup and message handling
- `src/ui.js` - UI binding and CC map rendering
- `src/config.js` - defaults, ranges, and MIDI CC map
- `src/audio-utils.js` - audio and parameter conversion helpers
