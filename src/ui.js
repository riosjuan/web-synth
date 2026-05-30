import { formatParamValue, clampToConfig } from "./audio-utils.js";
import { buildCcMapTable as renderCcMapTable, bindCcDialog as attachCcDialog } from "./ui/cc-map.js";
import { syncRangeStyleForParam } from "./ui/range-styles.js";
import { updateLfoUiState as applyLfoUiState } from "./ui/lfo-ui.js";
import { setupEnvelopeEditor as initEnvelopeEditor } from "./ui/envelope-editor.js";

export function createControlBinder(params, targetLabels, ccMap) {
  const inputByParam = {};
  const outputByParam = {};
  let redrawEnvelope = null;

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
    redrawEnvelope = initEnvelopeEditor(params, updateParamFromUI, onParamChange);
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
    if (redrawEnvelope && ["attack", "decay", "sustain", "release"].includes(paramName)) {
      redrawEnvelope();
    }
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

  function buildCcMapTable() {
    renderCcMapTable(ccMap, targetLabels);
  }

  function bindCcDialog() {
    attachCcDialog();
  }

  return { bindControls, syncControl, buildCcMapTable, bindCcDialog };
}
