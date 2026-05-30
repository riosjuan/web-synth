import { buildCcMapTable as renderCcMapTable, bindCcDialog as attachCcDialog } from "./cc-map.js";
import { updateLfoUiState as applyLfoUiState } from "./lfo-ui.js";
import { setupEnvelopeEditor as initEnvelopeEditor } from "./envelope-editor.js";
import { createParamControls } from "./param-controls.js";

export function createControlBinder(params, targetLabels, ccMap) {
  const inputByParam = {};
  const outputByParam = {};
  const paramControls = createParamControls(params, inputByParam, outputByParam, applyLfoUiState);

  function bindControls(onParamChange) {
    paramControls.bindControls(onParamChange);
    const redrawEnvelope = initEnvelopeEditor(params, paramControls.updateParamFromUI, onParamChange);
    paramControls.setEnvelopeRedraw(redrawEnvelope);
  }

  function syncControl(paramName, value, onParamChange) {
    paramControls.syncControl(paramName, value, onParamChange);
  }

  function buildCcMapTable() {
    renderCcMapTable(ccMap, targetLabels);
  }

  function bindCcDialog() {
    attachCcDialog();
  }

  return { bindControls, syncControl, buildCcMapTable, bindCcDialog };
}
