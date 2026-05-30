import { controlToUnit, createReverbImpulse, makeDistortionCurve, mapControl } from "../audio-utils.js";

export function createEffectsNodes(audioContext) {
  const fxInputGain = audioContext.createGain();
  const fxDryGain = audioContext.createGain();
  const fxWetGain = audioContext.createGain();
  const delayNode = audioContext.createDelay(1.2);
  const delayFeedbackGain = audioContext.createGain();
  const delaySendGain = audioContext.createGain();
  const delayReturnGain = audioContext.createGain();
  const chorusDelay = audioContext.createDelay(0.05);
  const chorusLfo = audioContext.createOscillator();
  const chorusLfoDepthGain = audioContext.createGain();
  const chorusSendGain = audioContext.createGain();
  const chorusReturnGain = audioContext.createGain();
  const reverbConvolver = audioContext.createConvolver();
  const reverbSendGain = audioContext.createGain();
  const reverbReturnGain = audioContext.createGain();
  const distShaper = audioContext.createWaveShaper();
  const distToneFilter = audioContext.createBiquadFilter();
  distToneFilter.type = "lowpass";
  distToneFilter.frequency.value = 9000;
  const distSendGain = audioContext.createGain();
  const distReturnGain = audioContext.createGain();

  return {
    fxInputGain,
    fxDryGain,
    fxWetGain,
    delayNode,
    delayFeedbackGain,
    delaySendGain,
    delayReturnGain,
    chorusDelay,
    chorusLfo,
    chorusLfoDepthGain,
    chorusSendGain,
    chorusReturnGain,
    reverbConvolver,
    reverbSendGain,
    reverbReturnGain,
    distShaper,
    distToneFilter,
    distSendGain,
    distReturnGain,
  };
}

export function connectEffectsGraph(nodes, masterGain) {
  nodes.fxInputGain.connect(nodes.fxDryGain);
  nodes.fxInputGain.connect(nodes.delaySendGain);
  nodes.fxInputGain.connect(nodes.chorusSendGain);
  nodes.fxInputGain.connect(nodes.reverbSendGain);
  nodes.fxInputGain.connect(nodes.distSendGain);

  nodes.delaySendGain.connect(nodes.delayNode);
  nodes.delayNode.connect(nodes.delayFeedbackGain);
  nodes.delayFeedbackGain.connect(nodes.delayNode);
  nodes.delayNode.connect(nodes.delayReturnGain);
  nodes.delayReturnGain.connect(nodes.fxWetGain);

  nodes.chorusSendGain.connect(nodes.chorusDelay);
  nodes.chorusDelay.connect(nodes.chorusReturnGain);
  nodes.chorusReturnGain.connect(nodes.fxWetGain);
  nodes.chorusLfo.connect(nodes.chorusLfoDepthGain);
  nodes.chorusLfoDepthGain.connect(nodes.chorusDelay.delayTime);
  nodes.chorusLfo.start();

  nodes.reverbSendGain.connect(nodes.reverbConvolver);
  nodes.reverbConvolver.connect(nodes.reverbReturnGain);
  nodes.reverbReturnGain.connect(nodes.fxWetGain);

  nodes.distSendGain.connect(nodes.distShaper);
  nodes.distShaper.connect(nodes.distToneFilter);
  nodes.distToneFilter.connect(nodes.distReturnGain);
  nodes.distReturnGain.connect(nodes.fxWetGain);

  nodes.fxDryGain.connect(masterGain);
  nodes.fxWetGain.connect(masterGain);
}

export function updateEffectsFromParams(audioContext, nodes, params) {
  const now = audioContext.currentTime;
  const delayMix = controlToUnit(params.fxDelayMix);
  const chorusMix = controlToUnit(params.fxChorusMix);
  const reverbMix = controlToUnit(params.fxReverbMix);
  const distMix = controlToUnit(params.fxDistMix);
  const totalWet = Math.min(0.95, delayMix + chorusMix + reverbMix + distMix);

  nodes.fxDryGain.gain.setTargetAtTime(1 - totalWet, now, 0.01);
  nodes.delaySendGain.gain.setTargetAtTime(delayMix, now, 0.01);
  nodes.chorusSendGain.gain.setTargetAtTime(chorusMix, now, 0.01);
  nodes.reverbSendGain.gain.setTargetAtTime(reverbMix, now, 0.01);
  nodes.distSendGain.gain.setTargetAtTime(distMix, now, 0.01);
  nodes.fxWetGain.gain.setTargetAtTime(totalWet, now, 0.01);
  nodes.delayNode.delayTime.setTargetAtTime(mapControl(params.fxDelayTime, 0.02, 0.8), now, 0.01);
  nodes.delayFeedbackGain.gain.setTargetAtTime(mapControl(params.fxDelayFeedback, 0, 0.85), now, 0.01);
  nodes.delayReturnGain.gain.setTargetAtTime(0.8, now, 0.01);
  nodes.chorusLfo.frequency.setTargetAtTime(mapControl(params.fxChorusRate, 0.05, 8), now, 0.01);
  nodes.chorusLfoDepthGain.gain.setTargetAtTime(mapControl(params.fxChorusDepth, 0, 0.02), now, 0.01);
  nodes.chorusDelay.delayTime.setTargetAtTime(0.012, now, 0.01);
  nodes.chorusReturnGain.gain.setTargetAtTime(0.9, now, 0.01);
  nodes.reverbConvolver.buffer = createReverbImpulse(audioContext, mapControl(params.fxReverbSize, 0.2, 6));
  nodes.reverbReturnGain.gain.setTargetAtTime(0.9, now, 0.01);
  nodes.distShaper.curve = makeDistortionCurve(mapControl(params.fxDistDrive, 1, 400));
  nodes.distShaper.oversample = "4x";
  nodes.distReturnGain.gain.setTargetAtTime(0.8, now, 0.01);
}
