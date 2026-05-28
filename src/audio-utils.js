import { PARAM_CONFIG } from "./config.js";

export function midiToFrequency(note) {
  return 440 * (2 ** ((note - 69) / 12));
}

export function clampToConfig(paramName, value) {
  const config = PARAM_CONFIG[paramName];
  if (!config) {
    return value;
  }
  const clamped = Math.max(config.min, Math.min(config.max, value));
  const precision = Math.max(0, `${config.step}`.split(".")[1]?.length || 0);
  return Number(clamped.toFixed(precision));
}

export function formatParamValue(paramName, value) {
  const config = PARAM_CONFIG[paramName];
  if (!config) {
    return String(value);
  }
  return Number(value).toFixed(config.digits);
}

export function ccValueToParam(paramName, ccValue) {
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

export function cutoffControlToHz(value) {
  const minHz = 80;
  const maxHz = 12000;
  const normalized = Math.max(0, Math.min(127, value)) / 127;
  const minLog = Math.log(minHz);
  const maxLog = Math.log(maxHz);
  return Math.exp(minLog + normalized * (maxLog - minLog));
}

export function resonanceControlToQ(value) {
  const minQ = 0.1;
  const maxQ = 20;
  const normalized = Math.max(0, Math.min(127, value)) / 127;
  return minQ + normalized * (maxQ - minQ);
}

export function envelopeControlToSeconds(value, minSeconds, maxSeconds) {
  const normalized = Math.max(0, Math.min(127, value)) / 127;
  return minSeconds + normalized * (maxSeconds - minSeconds);
}

export function sustainControlToLevel(value) {
  return Math.max(0, Math.min(127, value)) / 127;
}

export function controlToUnit(value) {
  return Math.max(0, Math.min(127, value)) / 127;
}

export function mapControl(value, min, max) {
  return min + controlToUnit(value) * (max - min);
}

export function createReverbImpulse(audioContext, seconds) {
  const length = Math.max(1, Math.floor(audioContext.sampleRate * seconds));
  const impulse = audioContext.createBuffer(2, length, audioContext.sampleRate);
  for (let channel = 0; channel < impulse.numberOfChannels; channel += 1) {
    const data = impulse.getChannelData(channel);
    for (let i = 0; i < length; i += 1) {
      const decay = Math.pow(1 - i / length, 2);
      data[i] = (Math.random() * 2 - 1) * decay;
    }
  }
  return impulse;
}

export function makeDistortionCurve(amount) {
  const samples = 2048;
  const curve = new Float32Array(samples);
  const k = Math.max(1, amount);
  for (let i = 0; i < samples; i += 1) {
    const x = (i * 2) / samples - 1;
    curve[i] = ((3 + k) * x * 20 * (Math.PI / 180)) / (Math.PI + k * Math.abs(x));
  }
  return curve;
}
