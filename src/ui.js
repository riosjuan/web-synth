import { formatParamValue, clampToConfig } from "./audio-utils.js";
import { buildCcMapTable as renderCcMapTable, bindCcDialog as attachCcDialog } from "./ui/cc-map.js";

export function createControlBinder(params, targetLabels, ccMap) {
  const inputByParam = {};
  const outputByParam = {};
  let redrawEnvelope = null;

  function clampMidi(value) {
    return Math.max(0, Math.min(127, Math.round(value)));
  }

  function setupEnvelopeEditor(onParamChange) {
    const canvas = document.getElementById("envelope-canvas");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const logicalWidth = 100;
    const logicalHeight = 60;
    const pad = 3;
    const topY = pad;
    const bottomY = logicalHeight - pad;
    const innerWidth = logicalWidth - pad * 2;
    const sectionWidth = innerWidth / 4;
    const sustainStartX = pad + sectionWidth * 2;
    const sustainEndX = pad + sectionWidth * 3;
    const minSectionWidth = 0.8;
    const hitRadius = 4.5;
    const sustainHitDistance = 3;
    const nodeRadius = 1;
    let activeNode = null;
    let activePointerId = null;

    function controlToX(value, minX, maxX) {
      const clampedMin = Math.min(minX, maxX);
      const clampedMax = Math.max(minX, maxX);
      return clampedMin + (clampMidi(value) / 127) * (clampedMax - clampedMin);
    }

    function xToControl(x, minX, maxX) {
      const clampedMin = Math.min(minX, maxX);
      const clampedMax = Math.max(minX, maxX);
      const width = Math.max(0.0001, clampedMax - clampedMin);
      return clampMidi(((x - clampedMin) / width) * 127);
    }

    function sustainControlToY(value) {
      return bottomY - (clampMidi(value) / 127) * (bottomY - topY);
    }

    function yToSustainControl(y) {
      const clampedY = Math.max(topY, Math.min(bottomY, y));
      return clampMidi(((bottomY - clampedY) / (bottomY - topY)) * 127);
    }

    function distanceToSegment(point, a, b) {
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const lenSq = dx * dx + dy * dy;
      if (lenSq === 0) return Math.hypot(point.x - a.x, point.y - a.y);
      const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lenSq));
      const px = a.x + t * dx;
      const py = a.y + t * dy;
      return Math.hypot(point.x - px, point.y - py);
    }

    function calculatePoints() {
      const attackX = controlToX(params.attack, pad, pad + sectionWidth);
      const decayX = controlToX(params.decay, pad + sectionWidth, sustainStartX - minSectionWidth);
      const sustainY = sustainControlToY(params.sustain);
      const releaseX = controlToX(
        params.release,
        sustainEndX + minSectionWidth,
        logicalWidth - pad,
      );
      return {
        start: { x: pad, y: bottomY },
        attack: { x: attackX, y: topY },
        decay: { x: decayX, y: sustainY },
        sustainEnd: { x: sustainEndX, y: sustainY },
        release: { x: releaseX, y: bottomY },
      };
    }

    function getCanvasPosition(event) {
      const rect = canvas.getBoundingClientRect();
      return {
        x: ((event.clientX - rect.left) / rect.width) * logicalWidth,
        y: ((event.clientY - rect.top) / rect.height) * logicalHeight,
      };
    }

    function pickNode(x, y) {
      const points = calculatePoints();
      const pointer = { x, y };
      const names = ["attack", "decay", "release"];
      let best = null;
      names.forEach((name) => {
        const point = points[name];
        const distance = Math.hypot(point.x - x, point.y - y);
        if (distance <= hitRadius && (!best || distance < best.distance)) {
          best = { name, distance };
        }
      });
      if (best) return best.name;
      const sustainDistance = distanceToSegment(pointer, points.decay, points.sustainEnd);
      if (sustainDistance <= sustainHitDistance) return "sustain";
      return null;
    }

    function resizeCanvas() {
      const rect = canvas.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) return false;
      const dpr = window.devicePixelRatio || 1;
      const widthPx = Math.max(1, Math.round(rect.width * dpr));
      const heightPx = Math.max(1, Math.round(rect.height * dpr));
      if (canvas.width !== widthPx || canvas.height !== heightPx) {
        canvas.width = widthPx;
        canvas.height = heightPx;
      }
      ctx.setTransform(widthPx / logicalWidth, 0, 0, heightPx / logicalHeight, 0, 0);
      return true;
    }

    function drawNode(point) {
      ctx.beginPath();
      ctx.arc(point.x, point.y, nodeRadius, 0, Math.PI * 2);
      ctx.fillStyle = "#111";
      ctx.fill();
    }

    function draw() {
      if (!resizeCanvas()) return;
      ctx.clearRect(0, 0, logicalWidth, logicalHeight);
      const points = calculatePoints();
      ctx.beginPath();
      ctx.moveTo(points.start.x, points.start.y);
      ctx.lineTo(points.attack.x, points.attack.y);
      ctx.lineTo(points.decay.x, points.decay.y);
      ctx.lineTo(points.sustainEnd.x, points.sustainEnd.y);
      ctx.lineTo(points.release.x, points.release.y);
      ctx.lineWidth = 0.25;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.strokeStyle = "#111";
      ctx.stroke();
      drawNode(points.attack);
      drawNode(points.decay);
      drawNode(points.release);
    }

    function applyFromPointer(event) {
      if (!activeNode) return;
      const { x, y } = getCanvasPosition(event);
      const points = calculatePoints();
      if (activeNode === "attack") {
        const minX = pad;
        const maxX = pad + sectionWidth;
        const clampedX = Math.max(minX, Math.min(maxX, x));
        updateParamFromUI("attack", xToControl(clampedX, minX, maxX), onParamChange);
        return;
      }
      if (activeNode === "decay") {
        const minX = pad + sectionWidth;
        const maxX = sustainStartX - minSectionWidth;
        const clampedX = Math.max(minX, Math.min(maxX, x));
        updateParamFromUI("decay", xToControl(clampedX, minX, maxX), onParamChange);
        return;
      }
      if (activeNode === "sustain") {
        updateParamFromUI("sustain", yToSustainControl(y), onParamChange);
        return;
      }
      if (activeNode === "release") {
        const minX = sustainEndX + minSectionWidth;
        const maxReleaseX = logicalWidth - pad;
        const clampedX = Math.max(minX, Math.min(maxReleaseX, x));
        updateParamFromUI("release", xToControl(clampedX, minX, maxReleaseX), onParamChange);
      }
    }

    canvas.addEventListener("pointerdown", (event) => {
      const { x, y } = getCanvasPosition(event);
      const node = pickNode(x, y);
      if (!node) return;
      activeNode = node;
      activePointerId = event.pointerId;
      if (canvas.setPointerCapture) {
        try {
          canvas.setPointerCapture(event.pointerId);
        } catch (_error) {}
      }
      applyFromPointer(event);
      draw();
    });

    canvas.addEventListener("pointermove", (event) => {
      if (activePointerId !== null && event.pointerId !== activePointerId) return;
      if (!activeNode) return;
      applyFromPointer(event);
    });

    function releasePointer(event) {
      if (activePointerId !== null && event.pointerId !== activePointerId) return;
      if (canvas.releasePointerCapture) {
        try {
          canvas.releasePointerCapture(event.pointerId);
        } catch (_error) {}
      }
      activeNode = null;
      activePointerId = null;
      draw();
    }

    canvas.addEventListener("pointerup", releasePointer);
    canvas.addEventListener("pointercancel", releasePointer);
    window.addEventListener("resize", draw);
    if (typeof ResizeObserver !== "undefined") {
      const resizeObserver = new ResizeObserver(() => draw());
      resizeObserver.observe(canvas);
    }

    requestAnimationFrame(draw);
    redrawEnvelope = draw;
  }

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
      if ((paramName === "osc1Level" || paramName === "osc2Level") && !Array.isArray(inputByParam[paramName])) {
        const levelPct = `${Math.round(Number(params[paramName]) * 100)}%`;
        el.style.setProperty("--level-pct", levelPct);
        const levelWrap = el.closest(".level-wrap");
        if (levelWrap) levelWrap.style.setProperty("--level-pct", levelPct);
      }
      if ((paramName === "osc1Detune" || paramName === "osc2Detune") && !Array.isArray(inputByParam[paramName])) {
        const detune = Number(params[paramName]);
        const magnitude = `${Math.round((Math.abs(detune) / 50) * 50)}%`;
        el.style.setProperty("--detune-left", detune < 0 ? magnitude : "0%");
        el.style.setProperty("--detune-right", detune > 0 ? magnitude : "0%");
        const thumb = `${Math.round(((detune + 50) / 100) * 100)}%`;
        el.style.setProperty("--detune-thumb", thumb);
        const wrap = el.closest(".detune-wrap");
        if (wrap) {
          wrap.style.setProperty("--detune-left", detune < 0 ? magnitude : "0%");
          wrap.style.setProperty("--detune-right", detune > 0 ? magnitude : "0%");
          wrap.style.setProperty("--detune-thumb", thumb);
        }
      }
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
    updateLfoUiState();
    setupEnvelopeEditor(onParamChange);
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
    if ((paramName === "osc1Level" || paramName === "osc2Level") && input && !Array.isArray(input)) {
      const levelPct = `${Math.round(Number(normalized) * 100)}%`;
      input.style.setProperty("--level-pct", levelPct);
      const levelWrap = input.closest(".level-wrap");
      if (levelWrap) levelWrap.style.setProperty("--level-pct", levelPct);
    }
    if ((paramName === "osc1Detune" || paramName === "osc2Detune") && input && !Array.isArray(input)) {
      const detune = Number(normalized);
      const magnitude = `${Math.round((Math.abs(detune) / 50) * 50)}%`;
      input.style.setProperty("--detune-left", detune < 0 ? magnitude : "0%");
      input.style.setProperty("--detune-right", detune > 0 ? magnitude : "0%");
      const thumb = `${Math.round(((detune + 50) / 100) * 100)}%`;
      input.style.setProperty("--detune-thumb", thumb);
      const wrap = input.closest(".detune-wrap");
      if (wrap) {
        wrap.style.setProperty("--detune-left", detune < 0 ? magnitude : "0%");
        wrap.style.setProperty("--detune-right", detune > 0 ? magnitude : "0%");
        wrap.style.setProperty("--detune-thumb", thumb);
      }
    }
    if (paramName.startsWith("lfo")) updateLfoUiState();
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
