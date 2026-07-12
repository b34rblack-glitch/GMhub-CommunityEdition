// ============================================================================
// test/vision.test.mjs
// ----------------------------------------------------------------------------
// Combat-aware vision focus (scripts/vision.mjs). Exercises the fragile paths
// that broke and were re-fixed across v0.1.3 → v0.1.15:
//   - the Table-side setVisionFocus handler (release-all, control, denied,
//     perception refresh) reached through the REAL socket registration so we
//     never assert on a stub;
//   - the GM-side combat broadcast reading the HOOK-supplied combat (not the
//     possibly-stale game.combats.active) with the combatant.token.id fallback;
//   - the just-in-time ensureTableObserver(actor) grant landing BEFORE the
//     socket dispatch on an NPC turn (200ms settle driven by mock timers);
//   - the manual spotlight override (flag set before broadcast, broadcastFocus
//     early-returns while set, clearSpotlight nulls the flag before restoring).
//
// The handler is retrieved from the recording mock socket (KD5) so a regression
// that leaves it a stub — or drops the perception refresh / control call — is
// observable, never a "did not throw" false-green. The module-level
// `spotlightTokenId` singleton is defensively cleared in afterEach.
// ============================================================================

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import { installFoundryMock, captureLogs } from "./helpers/foundry-mock.mjs";

let env = installFoundryMock({ as: "gm", tableUserId: "table-1" });
const vision = await import("../scripts/vision.mjs");
const sockets = await import("../scripts/sockets.mjs");

const PERCEPTION_FLAGS = { refreshVision: true, refreshLighting: true, refreshSounds: true };

/**
 * Wire vision's handlers onto a recording socket. vision.init() calls
 * setHandler("setVisionFocus", …); sockets.register() then pushes the REAL
 * handler (not a stub) to the mock socketlib. Returns the registered handler
 * plus the recording socket so tests can observe dispatch.
 */
function wire() {
  vision.init();
  sockets.register();
  const socket = env.getSocket();
  return { handler: socket.registered.get("setVisionFocus"), socket };
}

/** Fire vision's `ready` once-hook as the GM so the combat hooks get bound. */
function fireReady() {
  env.hooks.onceHandler("ready")();
}

beforeEach(() => {
  env.restore();
  env = installFoundryMock({ as: "gm", tableUserId: "table-1" });
});

afterEach(() => {
  // Defensively clear the module-level spotlight singleton so it can't leak.
  // clearSpotlight() nulls it synchronously on its first line (needs a GM env).
  if (vision.getSpotlightTokenId()) {
    if (!env.game.user?.isGM) {
      env.restore();
      env = installFoundryMock({ as: "gm", tableUserId: "table-1" });
      sockets.register();
    }
    vision.clearSpotlight();
  }
  env.restore();
});

// --- init / registration ----------------------------------------------------

test("init registers the REAL setVisionFocus handler (not a stub)", () => {
  // Run as the Table so the REAL handler runs its body (off-Table it guards out
  // BEFORE logging, which would be indistinguishable from a silent stub).
  env.restore();
  env = installFoundryMock({ as: "table", tableUserId: "table-1" });
  const { handler } = wire();
  assert.equal(typeof handler, "function");
  const perceptionCalls = [];
  env.canvas.perception.update = (flags) => perceptionCalls.push(flags);
  const logs = captureLogs();
  try {
    // The real handler logs "setVisionFocus(...)" and refreshes perception;
    // the stub logs "stub: …" and does nothing.
    handler({ tokenId: null });
  } finally {
    logs.restore();
  }
  assert.ok(logs.text().includes("setVisionFocus"), "real handler ran");
  assert.ok(!logs.text().includes("stub:"), "not the placeholder stub");
  assert.deepEqual(perceptionCalls, [PERCEPTION_FLAGS], "real handler refreshed perception");
});

// --- _setVisionFocus (Table side) -------------------------------------------

test("_setVisionFocus is a no-op off the Table (guarded, no perception refresh)", () => {
  // Client is the GM here → isTableUser() is false → early return.
  const { handler } = wire();
  const perceptionCalls = [];
  env.canvas.perception.update = (flags) => perceptionCalls.push(flags);
  env.canvas.tokens.get = () => ({ control: () => true });
  handler({ tokenId: "t1" });
  assert.equal(perceptionCalls.length, 0, "did not touch perception off-Table");
});

test("_setVisionFocus releases all controlled tokens on tokenId:null", () => {
  env.restore();
  env = installFoundryMock({ as: "table", tableUserId: "table-1" });
  const { handler } = wire();
  const released = [];
  env.canvas.tokens.controlled = [
    { id: "a", release: () => released.push("a") },
    { id: "b", release: () => released.push("b") },
  ];
  const perceptionCalls = [];
  env.canvas.perception.update = (flags) => perceptionCalls.push(flags);

  handler({ tokenId: null });

  assert.deepEqual(released, ["a", "b"], "released every controlled token");
  assert.deepEqual(perceptionCalls, [PERCEPTION_FLAGS], "refreshed vision/lighting/sounds");
});

test("_setVisionFocus controls the named token with releaseOthers + refreshes perception", () => {
  env.restore();
  env = installFoundryMock({ as: "table", tableUserId: "table-1" });
  const { handler } = wire();
  let controlOpts = null;
  const tok = {
    actor: { name: "Hero" },
    control: (opts) => {
      controlOpts = opts;
      return true;
    },
  };
  env.canvas.tokens.get = (id) => (id === "t1" ? tok : undefined);
  const perceptionCalls = [];
  env.canvas.perception.update = (flags) => perceptionCalls.push(flags);

  handler({ tokenId: "t1" });

  assert.deepEqual(controlOpts, { releaseOthers: true }, "controlled with releaseOthers");
  assert.deepEqual(perceptionCalls, [PERCEPTION_FLAGS]);
});

test("_setVisionFocus warns (does not throw) when Token.control() is denied", () => {
  env.restore();
  env = installFoundryMock({ as: "table", tableUserId: "table-1" });
  const { handler } = wire();
  const tok = { actor: { name: "Goblin" }, control: () => false };
  env.canvas.tokens.get = () => tok;
  const perceptionCalls = [];
  env.canvas.perception.update = (flags) => perceptionCalls.push(flags);

  const logs = captureLogs();
  try {
    assert.doesNotThrow(() => handler({ tokenId: "t1" }));
  } finally {
    logs.restore();
  }
  assert.ok(logs.text().includes("denied"), "warned about the denied control");
  // Even on a denied control, perception is still refreshed (union fallback).
  assert.deepEqual(perceptionCalls, [PERCEPTION_FLAGS]);
});

// --- broadcastFocus / activeCombatantTokenId (GM side) ----------------------

test("broadcastFocus reads the HOOK-supplied combat, not game.combats.active", async () => {
  wire();
  fireReady();
  const socket = env.getSocket();
  socket.executeCalls.length = 0; // drop the initial ready broadcast

  // The global lags with a different combatant than the hook-supplied combat.
  env.game.combats.active = { started: true, combatant: { tokenId: "GLOBAL" } };
  const supplied = { started: true, combatant: { tokenId: "SUPPLIED" } };

  await env.hooks.onHandler("combatTurn")(supplied);

  const calls = socket.executeCalls.filter((c) => c.name === "setVisionFocus");
  assert.equal(calls.length, 1, "broadcast exactly once");
  assert.equal(calls[0].userId, "table-1", "targeted the Table user");
  assert.equal(calls[0].args[0].tokenId, "SUPPLIED", "used the hook combat, not the global");
});

test("activeCombatantTokenId falls back to combatant.token.id when tokenId is absent", async () => {
  wire();
  fireReady();
  const socket = env.getSocket();
  socket.executeCalls.length = 0;

  const supplied = { started: true, combatant: { token: { id: "TID" } } };
  await env.hooks.onHandler("combatTurn")(supplied);

  const calls = socket.executeCalls.filter((c) => c.name === "setVisionFocus");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].args[0].tokenId, "TID", "resolved via the token document");
});

test("NPC turn grants ensureTableObserver(actor) BEFORE the socket dispatch", async () => {
  const { mock } = await import("node:test");
  wire();
  fireReady();
  const socket = env.getSocket();
  socket.executeCalls.length = 0;

  const order = [];
  // A real ownership write so broadcastFocus sees grantedNow=true → 200ms sleep.
  const actor = {
    name: "Ogre",
    documentName: "Actor",
    ownership: {},
    update: async ({ ownership }) => {
      order.push("grant");
      actor.ownership = ownership;
    },
  };
  const origExec = socket.executeAsUser.bind(socket);
  socket.executeAsUser = (...a) => {
    order.push("dispatch");
    return origExec(...a);
  };

  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    // The combatant needs a tokenId (or token.id) — that is what makes
    // broadcastFocus run the just-in-time ensureTableObserver(actor) grant
    // before dispatching setVisionFocus for that token.
    const p = env.hooks.onHandler("combatTurn")({
      started: true,
      combatant: { tokenId: "npc-tok", actor },
    });
    // Flush microtasks so the ownership write + grantedNow check schedule the sleep.
    await new Promise((r) => setImmediate(r));
    mock.timers.tick(200); // fire the ownership-propagation settle
    await p;
  } finally {
    mock.timers.reset();
  }

  assert.deepEqual(order, ["grant", "dispatch"], "ownership grant landed before dispatch");
});

// --- spotlight override -----------------------------------------------------

test("setSpotlight sets the flag before broadcasting and dispatches setVisionFocus", async () => {
  wire();
  const socket = env.getSocket();
  // No token/actor on canvas → skips the ownership grant, straight to dispatch.
  env.canvas.tokens.get = () => undefined;

  await vision.setSpotlight("spot-1");

  assert.equal(vision.getSpotlightTokenId(), "spot-1", "flag reflects the spotlight token");
  const calls = socket.executeCalls.filter((c) => c.name === "setVisionFocus");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].args[0].tokenId, "spot-1");
});

test("broadcastFocus early-returns while a spotlight is set (a stray updateCombat can't stomp it)", async () => {
  wire();
  fireReady();
  const socket = env.getSocket();
  env.canvas.tokens.get = () => undefined;

  await vision.setSpotlight("spot-1");
  socket.executeCalls.length = 0; // drop the spotlight's own dispatch

  // updateCombat does NOT clear the spotlight → broadcastFocus must bail.
  await env.hooks.onHandler("updateCombat")({ started: true, combatant: { tokenId: "other" } });

  assert.equal(
    socket.executeCalls.filter((c) => c.name === "setVisionFocus").length,
    0,
    "spotlight suppressed the combat broadcast",
  );
  assert.equal(vision.getSpotlightTokenId(), "spot-1", "spotlight survived the stray hook");
});

test("clearSpotlight nulls the flag BEFORE restoring vision (restore isn't suppressed)", async () => {
  wire();
  const socket = env.getSocket();
  env.canvas.tokens.get = () => undefined;
  // Out of combat → clearSpotlight restores via releaseTable() (tokenId:null).
  env.game.combats.active = null;

  await vision.setSpotlight("spot-1");
  socket.executeCalls.length = 0;

  await vision.clearSpotlight();

  assert.equal(vision.getSpotlightTokenId(), null, "flag cleared");
  const calls = socket.executeCalls.filter((c) => c.name === "setVisionFocus");
  assert.equal(calls.length, 1, "restore broadcast fired (not suppressed by the early-return)");
  assert.equal(calls[0].args[0].tokenId, null, "released the Table to union vision");
});
