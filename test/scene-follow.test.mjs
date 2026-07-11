// ============================================================================
// test/scene-follow.test.mjs
// ----------------------------------------------------------------------------
// GM→Table scene + Scene-Levels mirroring (scripts/scene-follow.mjs). Exercises
// the fragile paths:
//   - the receiver handlers (followScene / followLevel) reached through the REAL
//     socket registration so we never assert on a stub;
//   - _followScene's off-Table guard and its "already on that scene" skip (the
//     redundant-render guard that keeps the Table from re-viewing itself);
//   - _followLevel's scene-mismatch bail, non-number guard, and the
//     canvas.viewLevel FEATURE-DETECT (present → call, absent → graceful skip);
//   - broadcastSceneAndLevel's per-level debounce (lastBroadcastLevel): a
//     repeated level emits followScene again but NOT a duplicate followLevel.
//
// Every behavioral test either drives the real registered handler (retrieved
// from the recording mock socket) or asserts an observable dispatch on that
// socket — never a "did not throw" false-green. The GM-side broadcast is
// triggered through the real canvasReady hook the module registers.
// ============================================================================

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import { installFoundryMock, captureLogs } from "./helpers/foundry-mock.mjs";

let env = installFoundryMock({ as: "gm", tableUserId: "table-1" });
const sceneFollow = await import("../scripts/scene-follow.mjs");
const sockets = await import("../scripts/sockets.mjs");

/**
 * Run scene-follow's init() + sockets.register() so the REAL handlers land on
 * the recording mock socket. Returns the socket plus the two registered fns.
 */
function wire() {
  sceneFollow.init();
  sockets.register();
  const socket = env.getSocket();
  return {
    socket,
    followScene: socket.registered.get("followScene"),
    followLevel: socket.registered.get("followLevel"),
  };
}

/** Dispatches of `name` recorded on the mock socket. */
function dispatches(socket, name) {
  return socket.executeCalls.filter((c) => c.name === name);
}

/**
 * The canvasReady hook fires broadcastSceneAndLevel() WITHOUT awaiting it, so
 * its socket dispatches land across a couple of microtask turns. Flush them.
 */
const flush = () => new Promise((r) => setImmediate(r));

beforeEach(() => {
  env.restore();
  env = installFoundryMock({ as: "gm", tableUserId: "table-1" });
});

afterEach(() => {
  env.restore();
});

// --- init / registration ----------------------------------------------------

test("init registers the REAL followScene / followLevel handlers (not stubs)", async () => {
  // Run as the Table so the real receiver bodies actually act (off-Table they
  // guard out immediately, which a stub would too — no discrimination).
  env.restore();
  env = installFoundryMock({ as: "table", tableUserId: "table-1" });
  const { followScene, followLevel } = wire();
  assert.equal(typeof followScene, "function");
  assert.equal(typeof followLevel, "function");

  // followScene → the real handler calls scene.view() for a not-yet-viewed scene.
  let viewed = false;
  env.canvas.scene = { id: "current" };
  env.game.scenes = {
    get: (id) => (id === "s1" ? { id: "s1", view: async () => (viewed = true) } : undefined),
  };
  const logs = captureLogs();
  try {
    await followScene({ sceneId: "s1" });
  } finally {
    logs.restore();
  }
  assert.ok(viewed, "real followScene viewed the target scene");
  assert.ok(!logs.text().includes("stub:"), "not the placeholder stub");
});

// --- _followScene (Table side) ----------------------------------------------

test("_followScene is a no-op off the Table", async () => {
  // Client is the GM → isTableUser() false → early return before any view().
  const { followScene } = wire();
  let viewed = false;
  env.canvas.scene = { id: "current" };
  env.game.scenes = { get: () => ({ id: "s1", view: async () => (viewed = true) }) };
  await followScene({ sceneId: "s1" });
  assert.equal(viewed, false, "off-Table client did not view the scene");
});

test("_followScene skips the redundant view when already on the target scene", async () => {
  env.restore();
  env = installFoundryMock({ as: "table", tableUserId: "table-1" });
  const { followScene } = wire();
  let viewed = false;
  env.canvas.scene = { id: "s1" };
  env.game.scenes = { get: () => ({ id: "s1", view: async () => (viewed = true) }) };
  await followScene({ sceneId: "s1" });
  assert.equal(viewed, false, "did not re-view the scene already displayed");
});

test("_followScene views the scene when it differs from the current one", async () => {
  env.restore();
  env = installFoundryMock({ as: "table", tableUserId: "table-1" });
  const { followScene } = wire();
  let viewedId = null;
  env.canvas.scene = { id: "other" };
  env.game.scenes = { get: (id) => ({ id, view: async () => (viewedId = id) }) };
  await followScene({ sceneId: "s1" });
  assert.equal(viewedId, "s1", "viewed the newly-selected scene");
});

// --- _followLevel (Table side) ----------------------------------------------

test("_followLevel is a no-op when the Table is on a different scene", async () => {
  env.restore();
  env = installFoundryMock({ as: "table", tableUserId: "table-1" });
  const { followLevel } = wire();
  let called = false;
  env.canvas.scene = { id: "s1" };
  env.canvas.viewLevel = () => (called = true);
  await followLevel({ sceneId: "s2", level: 1 });
  assert.equal(called, false, "did not change level on a scene mismatch");
});

test("_followLevel ignores a non-number level", async () => {
  env.restore();
  env = installFoundryMock({ as: "table", tableUserId: "table-1" });
  const { followLevel } = wire();
  let called = false;
  env.canvas.scene = { id: "s1" };
  env.canvas.viewLevel = () => (called = true);
  await followLevel({ sceneId: "s1", level: "not-a-number" });
  assert.equal(called, false, "rejected the malformed level payload");
});

test("_followLevel calls canvas.viewLevel when it exists (feature-detect hit)", async () => {
  env.restore();
  env = installFoundryMock({ as: "table", tableUserId: "table-1" });
  const { followLevel } = wire();
  let arg = null;
  env.canvas.scene = { id: "s1" };
  env.canvas.viewLevel = async (lvl) => (arg = lvl);
  await followLevel({ sceneId: "s1", level: 2 });
  assert.equal(arg, 2, "drove the v14 canvas.viewLevel API with the level");
});

test("_followLevel skips gracefully when canvas.viewLevel is absent (feature-detect miss)", async () => {
  env.restore();
  env = installFoundryMock({ as: "table", tableUserId: "table-1" });
  const { followLevel } = wire();
  env.canvas.scene = { id: "s1" };
  // viewLevel intentionally absent (makeCanvas leaves it undefined).
  // Opt in to debug output so the feature-detect-miss log line is observable.
  env.CONFIG.debug.modules.push("community-screen");
  const logs = captureLogs();
  try {
    await followLevel({ sceneId: "s1", level: 2 });
  } finally {
    logs.restore();
  }
  assert.ok(
    logs.text().includes("viewLevel not available"),
    "took the feature-detect-miss branch (real handler, not a stub)",
  );
});

// --- broadcastSceneAndLevel (GM side, via canvasReady) ----------------------

test("broadcast emits followScene every canvasReady and debounces followLevel by level", async () => {
  wire();
  const socket = env.getSocket();
  const canvasReady = env.hooks.onHandler("canvasReady");
  assert.equal(typeof canvasReady, "function", "GM canvasReady hook registered");

  env.canvas.scene = { id: "s1" };
  env.canvas.viewedLevel = 3;

  // First view of level 3.
  canvasReady();
  await flush();
  const sceneAfter1 = dispatches(socket, "followScene").length;
  const levelAfter1 = dispatches(socket, "followLevel").length;
  assert.equal(sceneAfter1, 1, "followScene emitted on the first canvasReady");
  assert.equal(levelAfter1, 1, "followLevel emitted for the new level");
  assert.equal(dispatches(socket, "followLevel")[0].args[0].level, 3, "carried level=3");

  // Same level 3 → followScene emits again, followLevel is debounced.
  canvasReady();
  await flush();
  assert.equal(dispatches(socket, "followScene").length, 2, "followScene re-emitted");
  assert.equal(
    dispatches(socket, "followLevel").length,
    levelAfter1,
    "duplicate level did NOT re-emit followLevel (debounced by lastBroadcastLevel)",
  );

  // Change to level 4 → followLevel emits once more.
  env.canvas.viewedLevel = 4;
  canvasReady();
  await flush();
  assert.equal(dispatches(socket, "followScene").length, 3, "followScene re-emitted");
  assert.equal(
    dispatches(socket, "followLevel").length,
    levelAfter1 + 1,
    "a changed level emitted a fresh followLevel",
  );
  assert.equal(dispatches(socket, "followLevel").at(-1).args[0].level, 4, "carried level=4");
});

test("broadcast is a no-op when the Table user is offline", async () => {
  wire();
  const socket = env.getSocket();
  // Table user configured but not connected → isTableOnline() false.
  env.game.users.get("table-1").active = false;
  env.canvas.scene = { id: "s1" };
  env.canvas.viewedLevel = 1;

  env.hooks.onHandler("canvasReady")();
  await flush();

  assert.equal(socket.executeCalls.length, 0, "no socket traffic while the Table is offline");
});
