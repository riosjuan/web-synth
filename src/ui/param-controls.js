import { formatParamValue, clampToConfig } from "../audio-utils.js";
import { syncRangeStyleForParam } from "./range-styles.js";

const ENVELOPE_PARAMS = ["attack", "decay", "sustain", "release"];

export function createParamControls(params, inputByParam, outputByParam, applyLfoUiState) {
  let redrawEnvelope = null;

  function setEnvelopeRedraw(fn) {
    redrawEnvelope = typeof fn === "function" ? fn : null;
  }

  function updateParamFromUI(paramName, value, onParamChange) {
    const normalized = typeof value === "number" ? clampToConfig(paramName, value) : value;
    params[paramName] = normalized;
    const input = inputByParam[paramName];
    if (input && !Array.isArray(input) && typeof normalized === "number") {
      input.value = String(normalized);
    }

    onParamChange(paramName, normalized);

    const output = outputByParam[paramName];
    if (output && typeof normalized === "number") {
      output.textContent = formatParamValue(paramName, normalized);
    }

    syncRangeStyleForParam(paramName, input, normalized);
    if (paramName.startsWith("lfo")) applyLfoUiState(params, inputByParam);
    if (redrawEnvelope && ENVELOPE_PARAMS.includes(paramName)) {
      redrawEnvelope();
    }
  }

  function bindControls(onParamChange) {
    const controls = document.querySelectorAll("[data-param]");
    controls.forEach((el) => {
      const paramName = el.dataset.param;
      if (!paramName) return;
      if (el.type === "radio") {
        if (!Array.isArray(inputByParam[paramName])) inputByParam[paramName] = [];
        inputByParam[paramName].push(el);
      } else {
        inputByParam[paramName] = el;
      }

      const output = document.getElementById(`${el.id}-value`);
      if (output) {
        outputByParam[paramName] = output;
        output.textContent = formatParamValue(paramName, params[paramName]);
      }

      syncRangeStyleForParam(paramName, inputByParam[paramName], params[paramName]);
      el.addEventListener("input", () => {
        const isSelect = el.tagName.toLowerCase() === "select";
        const isRadio = el.type === "radio";
        const expectsNumber = typeof params[paramName] === "number";
        let value;
        if (isRadio) {
          value = expectsNumber ? Number(el.value) : el.value;
        } else {
          value = isSelect ? el.value : Number(el.value);
        }
        updateParamFromUI(paramName, value, onParamChange);
      });
    });
    applyLfoUiState(params, inputByParam);
  }

  function syncControl(paramName, value, onParamChange) {
    const input = inputByParam[paramName];
    if (!input) return;
    if (Array.isArray(input)) {
      input.forEach((radio) => {
        radio.checked = radio.value === String(value);
      });
      const normalizedValue = typeof params[paramName] === "number" ? Number(value) : String(value);
      updateParamFromUI(paramName, normalizedValue, onParamChange);
      return;
    }
    input.value = String(value);
    updateParamFromUI(paramName, typeof value === "number" ? value : input.value, onParamChange);
  }

  return {
    bindControls,
    updateParamFromUI,
    syncControl,
    setEnvelopeRedraw,
  };
}
