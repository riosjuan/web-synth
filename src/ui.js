import { formatParamValue, clampToConfig } from "./audio-utils.js";

export function createControlBinder(params, targetLabels, ccMap) {
  const inputByParam = {};
  const outputByParam = {};

  function updateLfoUiState() {
    ["lfo1", "lfo2"].forEach((lfoId) => {
      const rateInput = inputByParam[`${lfoId}Rate`];
      const divisionInput = inputByParam[`${lfoId}Division`];
      const rateMode = params[`${lfoId}RateMode`];
      const isSync = rateMode === "sync";
      if (rateInput && !Array.isArray(rateInput)) {
        rateInput.disabled = isSync;
      }
      if (divisionInput && !Array.isArray(divisionInput)) {
        divisionInput.disabled = !isSync;
      }
    });
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
      el.addEventListener("input", () => {
        const isSelect = el.tagName.toLowerCase() === "select";
        const isRadio = el.type === "radio";
        const value = isSelect || isRadio ? el.value : Number(el.value);
        updateParamFromUI(paramName, value, onParamChange);
      });
    });
    updateLfoUiState();
  }

  function updateParamFromUI(paramName, value, onParamChange) {
    const normalized = typeof value === "number" ? clampToConfig(paramName, value) : value;
    params[paramName] = normalized;
    onParamChange(paramName, normalized);
    const output = outputByParam[paramName];
    if (output && typeof normalized === "number") {
      output.textContent = formatParamValue(paramName, normalized);
    }
    if (paramName.startsWith("lfo")) updateLfoUiState();
  }

  function syncControl(paramName, value, onParamChange) {
    const input = inputByParam[paramName];
    if (!input) return;
    if (Array.isArray(input)) {
      input.forEach((radio) => {
        radio.checked = radio.value === String(value);
      });
      updateParamFromUI(paramName, String(value), onParamChange);
      return;
    }
    input.value = String(value);
    updateParamFromUI(paramName, typeof value === "number" ? value : input.value, onParamChange);
  }

  function buildCcMapTable() {
    const body = document.getElementById("cc-map-body");
    if (!body) return;
    const rows = Object.entries(ccMap)
      .map(([cc, config]) => ({ cc: Number(cc), ...config }))
      .sort((a, b) => a.cc - b.cc);
    body.innerHTML = "";
    rows.forEach((row) => {
      const tr = document.createElement("tr");
      const ccCell = document.createElement("td");
      const nameCell = document.createElement("td");
      const targetCell = document.createElement("td");
      ccCell.textContent = String(row.cc);
      nameCell.textContent = row.name;
      targetCell.textContent = targetLabels[row.target] || row.target;
      tr.appendChild(ccCell);
      tr.appendChild(nameCell);
      tr.appendChild(targetCell);
      body.appendChild(tr);
    });
  }

  function bindCcDialog() {
    const dialog = document.getElementById("cc-map-dialog");
    const openBtn = document.getElementById("open-cc-map");
    const closeBtn = document.getElementById("close-cc-map");
    openBtn.addEventListener("click", () => dialog.setAttribute("aria-hidden", "false"));
    closeBtn.addEventListener("click", () => dialog.setAttribute("aria-hidden", "true"));
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) dialog.setAttribute("aria-hidden", "true");
    });
    window.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && dialog.getAttribute("aria-hidden") === "false") {
        dialog.setAttribute("aria-hidden", "true");
      }
    });
  }

  return { bindControls, syncControl, buildCcMapTable, bindCcDialog };
}
