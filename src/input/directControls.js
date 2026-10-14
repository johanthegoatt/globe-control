// Mouse, touch and keyboard control for the globe, next to hand tracking.
// Without them the globe only moved for people with a webcam who allowed
// it; WCAG 2.1.1 asks for keyboard operation, and 2.5.1 for a single-pointer
// way to do anything that takes a multi-point gesture (the pinch).

// A drag across the whole globe area turns it by about half a turn, so the
// point under the finger roughly follows it.
export function dragToOrbit(dxPx, dyPx, widthPx, heightPx) {
  const span = Math.max(1, Math.min(widthPx || 1, heightPx || 1));
  return { dx: (dxPx / span) * Math.PI * 0.5, dy: (dyPx / span) * Math.PI * 0.5 };
}

// Wheel deltas come in pixels, lines or pages depending on the device.
export function wheelToZoom(deltaY, deltaMode = 0) {
  const px = deltaMode === 1 ? deltaY * 16 : deltaMode === 2 ? deltaY * 400 : deltaY;
  return Math.max(-0.6, Math.min(0.6, px * 0.0025));
}

// Two fingers: zoom by how much the gap between them changed.
export function pinchToZoom(prevGap, gap, zoom) {
  if (!(prevGap > 0 && gap > 0)) return 0;
  return zoom * (prevGap / gap - 1);
}

export const KEY_STEPS = {
  ArrowLeft: { dx: 0.12, dy: 0 },
  ArrowRight: { dx: -0.12, dy: 0 },
  ArrowUp: { dx: 0, dy: 0.1 },
  ArrowDown: { dx: 0, dy: -0.1 },
  "+": { zoom: -0.35 },
  "=": { zoom: -0.35 },
  "-": { zoom: 0.35 },
  _: { zoom: 0.35 },
};

export function bindDirectControls(el, scene, { onUse } = {}) {
  const pointers = new Map();
  let gap = 0;
  let idleTimer = null;

  el.tabIndex = 0;
  el.setAttribute("role", "application");
  el.setAttribute(
    "aria-label",
    "Globe. Drag or use the arrow keys to turn it, scroll, pinch or press plus and minus to zoom, 0 to reset."
  );
  el.style.touchAction = "none";

  function active() {
    // Full confidence while a person drives it directly, and no auto-rotate
    // fighting the drag; auto-rotate comes back a moment after letting go.
    scene.setPrecisionState({ interacting: true, confidence: 1 });
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => scene.setPrecisionState({ interacting: false, confidence: 1 }), 1200);
    if (onUse) onUse();
  }

  function orbit(dx, dy) {
    // setOrbitDelta multiplies by the orbit sensitivity slider; undo it so
    // a drag keeps the globe under the finger whatever the slider says.
    const sens = Math.max(0.05, scene.getOrbitSensitivity ? scene.getOrbitSensitivity() : 1);
    scene.setOrbitDelta(dx / sens, dy / sens);
  }

  function spread() {
    const [a, b] = [...pointers.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  }

  el.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 && event.pointerType === "mouse") return;
    el.setPointerCapture(event.pointerId);
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    gap = spread();
    active();
  });

  el.addEventListener("pointermove", (event) => {
    const prev = pointers.get(event.pointerId);
    if (!prev) return;
    const now = { x: event.clientX, y: event.clientY };
    pointers.set(event.pointerId, now);
    const rect = el.getBoundingClientRect();
    if (pointers.size === 1) {
      const turn = dragToOrbit(now.x - prev.x, now.y - prev.y, rect.width, rect.height);
      orbit(-turn.dx, turn.dy);
    } else if (pointers.size === 2) {
      const next = spread();
      const zoom = scene.getZoom();
      scene.setZoomTarget(zoom + pinchToZoom(gap, next, zoom));
      gap = next;
    }
    active();
  });

  const release = (event) => {
    pointers.delete(event.pointerId);
    gap = spread();
  };
  el.addEventListener("pointerup", release);
  el.addEventListener("pointercancel", release);

  el.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      scene.setZoomTarget(scene.getZoom() + wheelToZoom(event.deltaY, event.deltaMode));
      active();
    },
    { passive: false }
  );

  el.addEventListener("keydown", (event) => {
    if (event.key === "0") {
      scene.resetView();
      active();
      return;
    }
    const step = KEY_STEPS[event.key];
    if (!step) return;
    event.preventDefault();
    if (step.zoom) scene.setZoomTarget(scene.getZoom() + step.zoom);
    else orbit(step.dx, step.dy);
    active();
  });

}
