import test from "node:test";
import assert from "node:assert/strict";
import { dragToOrbit, wheelToZoom, pinchToZoom, KEY_STEPS } from "../src/input/directControls.js";

test("dragging across the globe area turns it about half a turn", () => {
  const t = dragToOrbit(800, 0, 800, 600);
  assert.ok(Math.abs(t.dx - (800 / 600) * Math.PI * 0.5) < 1e-9);
  assert.equal(t.dy, 0);
});

test("wheel zoom treats pixel, line and page deltas alike and is capped", () => {
  assert.ok(Math.abs(wheelToZoom(100, 0) - 0.25) < 1e-9);
  assert.ok(Math.abs(wheelToZoom(3, 1) - 0.12) < 1e-9);
  assert.equal(wheelToZoom(5, 2), 0.6);
  assert.ok(wheelToZoom(-100) < 0);
});

test("spreading two fingers zooms in, pinching them zooms out", () => {
  assert.ok(pinchToZoom(100, 200, 3) < 0);
  assert.ok(pinchToZoom(200, 100, 3) > 0);
  assert.equal(pinchToZoom(0, 100, 3), 0);
});

test("every arrow key and plus/minus does something", () => {
  for (const key of ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "+", "-"]) assert.ok(KEY_STEPS[key]);
});
