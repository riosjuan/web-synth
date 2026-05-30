export function updateLfoUiState(params, inputByParam) {
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
