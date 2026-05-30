function clampMidi(value) {
  return Math.max(0, Math.min(127, Math.round(value)));
}

export function setupEnvelopeEditor(params, updateParamFromUI, onParamChange) {
  const canvas = document.getElementById("envelope-canvas");
  if (!canvas) return null;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

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
    const releaseX = controlToX(params.release, sustainEndX + minSectionWidth, logicalWidth - pad);
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
  return draw;
}
