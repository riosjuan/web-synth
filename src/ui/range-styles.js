function isSingleInput(input) {
  return input && !Array.isArray(input);
}

export function syncLevelRangeStyle(input, value) {
  if (!isSingleInput(input)) return;
  const levelPct = `${Math.round(Number(value) * 100)}%`;
  input.style.setProperty("--level-pct", levelPct);
  const levelWrap = input.closest(".level-wrap");
  if (levelWrap) {
    levelWrap.style.setProperty("--level-pct", levelPct);
  }
}

export function syncDetuneRangeStyle(input, value) {
  if (!isSingleInput(input)) return;
  const detune = Number(value);
  const magnitude = `${Math.round((Math.abs(detune) / 50) * 50)}%`;
  const left = detune < 0 ? magnitude : "0%";
  const right = detune > 0 ? magnitude : "0%";
  const thumb = `${Math.round(((detune + 50) / 100) * 100)}%`;

  input.style.setProperty("--detune-left", left);
  input.style.setProperty("--detune-right", right);
  input.style.setProperty("--detune-thumb", thumb);

  const wrap = input.closest(".detune-wrap");
  if (wrap) {
    wrap.style.setProperty("--detune-left", left);
    wrap.style.setProperty("--detune-right", right);
    wrap.style.setProperty("--detune-thumb", thumb);
  }
}

export function syncFilterRangeStyle(input, value) {
  if (!isSingleInput(input)) return;
  const filterPct = `${Math.round((Number(value) / 127) * 100)}%`;
  input.style.setProperty("--filter-pct", filterPct);

  const wrap = input.closest(".filter-wrap");
  if (wrap) {
    wrap.style.setProperty("--filter-pct", filterPct);
  }
}

export function syncMasterRangeStyle(input, value) {
  if (!isSingleInput(input)) return;
  const masterPct = `${Math.round(Number(value) * 100)}%`;
  input.style.setProperty("--master-pct", masterPct);

  const wrap = input.closest(".master-volume-wrap");
  if (wrap) {
    wrap.style.setProperty("--master-pct", masterPct);
  }
}

export function syncRangeStyleForParam(paramName, input, value) {
  if (paramName === "osc1Level" || paramName === "osc2Level") {
    syncLevelRangeStyle(input, value);
    return;
  }
  if (paramName === "masterVolume") {
    syncMasterRangeStyle(input, value);
    return;
  }
  if (paramName === "osc1Detune" || paramName === "osc2Detune") {
    syncDetuneRangeStyle(input, value);
    return;
  }
  if (paramName === "filterCutoff" || paramName === "filterQ") {
    syncFilterRangeStyle(input, value);
  }
}
