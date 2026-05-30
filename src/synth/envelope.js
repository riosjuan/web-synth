import { envelopeControlToSeconds, sustainControlToLevel } from "../audio-utils.js";

export function scheduleAttackDecay(ampGainParam, params, velocity, now) {
  const velocityGain = Math.max(0, Math.min(1, velocity / 127));
  const peak = velocityGain * 0.45;
  const sustainLevel = peak * sustainControlToLevel(params.sustain);
  const attackEnd = now + envelopeControlToSeconds(params.attack, 0.001, 2);
  const decayEnd = attackEnd + envelopeControlToSeconds(params.decay, 0.001, 2);

  ampGainParam.cancelScheduledValues(now);
  ampGainParam.setValueAtTime(0, now);
  ampGainParam.linearRampToValueAtTime(peak, attackEnd);
  ampGainParam.linearRampToValueAtTime(sustainLevel, decayEnd);
}

export function scheduleRelease(ampGainParam, releaseControl, now) {
  const releaseSeconds = envelopeControlToSeconds(releaseControl, 0.01, 4);
  const releaseEnd = now + releaseSeconds;

  if (typeof ampGainParam.cancelAndHoldAtTime === "function") {
    ampGainParam.cancelAndHoldAtTime(now);
  } else {
    ampGainParam.cancelScheduledValues(now);
    ampGainParam.setValueAtTime(ampGainParam.value, now);
  }

  ampGainParam.linearRampToValueAtTime(0, releaseEnd);
  return releaseEnd;
}
