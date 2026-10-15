import test from "node:test";
import assert from "node:assert/strict";
import { createOfflineGate } from "../src/api/client.js";

test("the gate closes after an unreachable call and reopens after the cool-down", () => {
  let t = 0;
  const gate = createOfflineGate({ cooldownMs: 1000, now: () => t });
  assert.equal(gate.blocked(), false);
  gate.markUnreachable();
  assert.equal(gate.blocked(), true);
  t = 999;
  assert.equal(gate.blocked(), true);
  t = 1000;
  assert.equal(gate.blocked(), false);
});

test("a reachable answer opens the gate at once", () => {
  const gate = createOfflineGate({ cooldownMs: 1000, now: () => 0 });
  gate.markUnreachable();
  gate.markReachable();
  assert.equal(gate.blocked(), false);
});
