import { formatParamValue, clampToConfig } from "./audio-utils.js";

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
    const maxTimeWidth = logicalWidth - pad * 2 - 12;
    const maxX = logicalWidth - pad;
    const minGap = 1.5;
    const hitRadius = 5;
    const nodeRadius = 1;
    let activeNode = null;
    let activePointerId = null;

    function timeToX(value) {
      return (clampMidi(value) / 127) * maxTimeWidth;
    }

    function xToTime(x) {
      return clampMidi((Math.max(0, Math.min(maxTimeWidth, x)) / maxTimeWidth) * 127);
    }

    function sustainToX(value) {
      return (clampMidi(value) / 127) * maxTimeWidth;
    }

    function xToSustain(x) {
      return clampMidi((Math.max(0, Math.min(maxTimeWidth, x)) / maxTimeWidth) * 127);
    }

    function decayToY(value) {
      return bottomY - (clampMidi(value) / 127) * (bottomY - topY);
    }

    function yToDecay(y) {
      const clampedY = Math.max(topY, Math.min(bottomY, y));
      return clampMidi(((bottomY - clampedY) / (bottomY - topY)) * 127);
    }

    function calculatePoints() {
      const attackX = Math.min(maxTimeWidth, timeToX(params.attack));
      const decayX = Math.min(maxTimeWidth, sustainToX(params.sustain));
      const sustainY = decayToY(params.decay);
      const releaseX = Math.max(decayX + minGap, Math.min(maxX, decayX + timeToX(params.release)));
      return {
        attack: { x: Math.max(pad, Math.min(maxX - nodeRadius, attackX + pad)), y: topY },
        decaySustain: { x: Math.max(pad, Math.min(maxX - nodeRadius, decayX + pad)), y: sustainY },
        release: { x: Math.max(pad, Math.min(maxX - nodeRadius, releaseX + pad)), y: sustainY },
        sustainY,
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
      const names = ["attack", "decaySustain", "release"];
      let best = null;
      names.forEach((name) => {
        const point = points[name];
        const distance = Math.hypot(point.x - x, point.y - y);
        if (distance <= hitRadius && (!best || distance < best.distance)) {
          best = { name, distance };
        }
      });
      return best?.name || null;
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
      ctx.moveTo(pad, bottomY);
      ctx.lineTo(points.attack.x, points.attack.y);
      ctx.lineTo(points.decaySustain.x, points.sustainY);
      ctx.lineTo(points.release.x, points.sustainY);
      ctx.lineTo(logicalWidth - pad, bottomY);
      ctx.lineWidth = 0.6;
      ctx.strokeStyle = "#111";
      ctx.stroke();
      drawNode(points.attack);
      drawNode(points.decaySustain);
      drawNode(points.release);
    }

    function applyFromPointer(event) {
      if (!activeNode) return;
      const { x, y } = getCanvasPosition(event);
      if (activeNode === "attack") {
        updateParamFromUI("attack", xToTime(Math.min(Math.max(0, x - pad), maxTimeWidth)), onParamChange);
      }
      if (activeNode === "decaySustain") {
        updateParamFromUI("sustain", xToSustain(Math.min(Math.max(0, x - pad), maxTimeWidth)), onParamChange);
        updateParamFromUI("decay", yToDecay(y), onParamChange);
      }
      if (activeNode === "release") {
        const decayX = sustainToX(params.sustain);
        updateParamFromUI("release", xToTime(Math.max(0, Math.min(maxTimeWidth, x - pad - decayX))), onParamChange);
      }
    }

    canvas.addEventListener("pointerdown", (event) => {
      const { x, y } = getCanvasPosition(event);
      const node = pickNode(x, y);
      if (!node) return;
      activeNode = node;
      activePointerId = event.pointerId;
      if (canvas.setPointerCapture) {
        try { canvas.setPointerCapture(event.pointerId); } catch (_error) {}
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
        try { canvas.releasePointerCapture(event.pointerId); } catch (_error) {}
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
      el.addEventListener("input", () => {
        const isSelect = el.tagName.toLowerCase() === "select";
        const isRadio = el.type === "radio";
        const value = isSelect || isRadio ? el.value : Number(el.value);
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
