// ============================================================================
// test/canvas-lock.test.mjs
// ----------------------------------------------------------------------------
// Canvas-lock libWrapper OVERRIDE targets + idempotency + withUnlocked. Seeds
// the v0.1.11 retarget regression: the overrides MUST target the v14 namespaced
// paths `foundry.canvas.Canvas.prototype.{pan,animatePan}` (a revert to the
// deprecated `Canvas.prototype.*` fails), with type OVERRIDE and id
// community-screen.
//
// The libWrapper spy records every register/unregister; the jsdom preload
// provides #board and document.body for the wheel-listener + body-class checks.
// The module-level `locked` singleton is reset in afterEach.
// ============================================================================

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import { installFoundryMock, captureLogs } from "./helpers/foundry-mock.mjs";

let env = installFoundryMock();
const canvasLock = await import("../scripts/canvas-lock.mjs");

const PAN_TARGET = "foundry.canvas.Canvas.prototype.pan";
const ANIMATE_TARGET = "foundry.canvas.Canvas.prototype.animatePan";
const LOCKED_CLASS = "community-screen-locked";

/** Spy on the #board element's add/removeEventListener; returns records + a restore(). */
function spyBoardListeners() {
  const board = document.getElementById("board");
  const addCalls = [];
  const removeCalls = [];
  const origAdd = board.addEventListener.bind(board);
  const origRemove = board.removeEventListener.bind(board);
  board.addEventListener = (type, fn, opts) => {
    addCalls.push({ type, fn, opts });
    return origAdd(type, fn, opts);
  };
  board.removeEventListener = (type, fn, opts) => {
    removeCalls.push({ type, fn, opts });
    return origRemove(type, fn, opts);
  };
  return {
    addCalls,
    removeCalls,
    restore() {
      board.addEventListener = origAdd;
      board.removeEventListener = origRemove;
    },
  };
}

beforeEach(() => {
  env.restore();
  env = installFoundryMock();
});

afterEach(() => {
  // Reset the `locked` singleton so it can't leak into the next test.
  if (canvasLock.isLocked()) canvasLock.disengageLock();
  document.body.classList.remove(LOCKED_CLASS);
  env.restore();
});

test("engageLock registers OVERRIDES on the EXACT v14 namespaced targets", () => {
  canvasLock.engageLock();
  const calls = env.libWrapper.registerCalls;
  assert.equal(calls.length, 2, "exactly pan + animatePan");
  const pan = calls.find((c) => c.target === PAN_TARGET);
  const animate = calls.find((c) => c.target === ANIMATE_TARGET);
  assert.ok(pan, `registered ${PAN_TARGET} (NOT the deprecated Canvas.prototype.pan)`);
  assert.ok(animate, `registered ${ANIMATE_TARGET}`);
  for (const c of [pan, animate]) {
    assert.equal(c.id, "community-screen");
    assert.equal(c.type, "OVERRIDE");
  }
  // Guard the exact regression: no non-namespaced target string.
  assert.ok(!calls.some((c) => c.target === "Canvas.prototype.pan"));
});

test("the pan override is a no-op and animatePan resolves", async () => {
  canvasLock.engageLock();
  const pan = env.libWrapper.registerCalls.find((c) => c.target === PAN_TARGET);
  const animate = env.libWrapper.registerCalls.find((c) => c.target === ANIMATE_TARGET);
  assert.equal(pan.fn(), undefined, "pan override returns nothing (no-op)");
  await assert.doesNotReject(Promise.resolve(animate.fn()), "animatePan override resolves");
});

test("engage adds a capture-phase, non-passive wheel listener on #board + the locked body class", () => {
  const spy = spyBoardListeners();
  try {
    canvasLock.engageLock();
  } finally {
    spy.restore();
  }
  const wheel = spy.addCalls.find((c) => c.type === "wheel");
  assert.ok(wheel, "a wheel listener was added on #board");
  assert.equal(wheel.opts.capture, true, "capture-phase");
  assert.equal(wheel.opts.passive, false, "non-passive (so preventDefault works)");
  assert.ok(document.body.classList.contains(LOCKED_CLASS), "locked body class added");
  assert.equal(canvasLock.isLocked(), true);
});

test("disengage removes the wheel listener + body class and unregisters BOTH wrappers", () => {
  canvasLock.engageLock();
  const spy = spyBoardListeners();
  try {
    canvasLock.disengageLock();
  } finally {
    spy.restore();
  }
  const wheelRemoved = spy.removeCalls.find((c) => c.type === "wheel");
  assert.ok(wheelRemoved, "wheel listener removed");
  assert.equal(wheelRemoved.opts.capture, true, "removed with matching capture flag");
  assert.ok(!document.body.classList.contains(LOCKED_CLASS), "locked body class removed");
  const targets = env.libWrapper.unregisterCalls.map((c) => c.target);
  assert.deepEqual(new Set(targets), new Set([PAN_TARGET, ANIMATE_TARGET]));
  assert.equal(canvasLock.isLocked(), false);
});

test("double-engage is idempotent (zero new register calls)", () => {
  canvasLock.engageLock();
  const after1 = env.libWrapper.registerCalls.length;
  canvasLock.engageLock();
  assert.equal(env.libWrapper.registerCalls.length, after1, "second engage registers nothing");
  assert.equal(after1, 2);
});

test("withUnlocked: disengages → runs fn (unlocked) → re-engages", async () => {
  canvasLock.engageLock();
  let insideLocked = null;
  const result = await canvasLock.withUnlocked(() => {
    insideLocked = canvasLock.isLocked();
    return "done";
  });
  assert.equal(insideLocked, false, "the lock is disengaged while fn runs");
  assert.equal(result, "done", "returns fn's value");
  assert.equal(canvasLock.isLocked(), true, "re-engaged afterward");
});

test("withUnlocked: re-engages even when fn throws, and re-throws", async () => {
  canvasLock.engageLock();
  await assert.rejects(
    canvasLock.withUnlocked(() => {
      throw new Error("boom");
    }),
    /boom/,
  );
  assert.equal(canvasLock.isLocked(), true, "re-engaged despite the throw");
});

test("withUnlocked: transparent no-op when the lock was never engaged", async () => {
  assert.equal(canvasLock.isLocked(), false);
  let ran = false;
  const result = await canvasLock.withUnlocked(() => {
    ran = true;
    return 42;
  });
  assert.equal(ran, true);
  assert.equal(result, 42);
  assert.equal(canvasLock.isLocked(), false, "still not locked");
  // The lock was never engaged, so libWrapper was never touched.
  assert.equal(env.libWrapper.registerCalls.length, 0);
  assert.equal(env.libWrapper.unregisterCalls.length, 0);
});

test("engageLock bails + logs an error when libWrapper is absent", () => {
  const saved = globalThis.libWrapper;
  delete globalThis.libWrapper;
  const logs = captureLogs();
  try {
    canvasLock.engageLock();
  } finally {
    logs.restore();
    globalThis.libWrapper = saved;
  }
  assert.ok(logs.text().includes("libWrapper is not available"), "logs the missing-dep error");
  assert.equal(canvasLock.isLocked(), false, "does not mark itself locked");
});
