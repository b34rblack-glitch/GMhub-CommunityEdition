// ============================================================================
// test/control-palette.test.mjs
// ----------------------------------------------------------------------------
// GM control-palette action dispatch (scripts/control-palette.mjs). Closes the
// named "Refit Scene" regression: the refit button must dispatch the dedicated
// `refitScene` socket to the Table — NOT `followScene` (which is a no-op when
// the Table is already on the current scene, so a mis-wire silently does
// nothing on the TV).
//
// ControlPalette is a non-exported ApplicationV2 subclass; we reach it — and,
// more importantly, its data-action → static-handler map — by capturing the
// instance `open()` renders (the harness AppV2 stub is what makes that class
// import/instantiate without a ReferenceError). Handlers are then invoked
// THROUGH the DEFAULT_OPTIONS.actions map so the test exercises the real
// template wiring, with a RECORDING socket (via sockets.register()) so the
// executeAsUser dispatch is observed — never a "did not throw" false-green.
// ============================================================================

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import { installFoundryMock } from "./helpers/foundry-mock.mjs";

let env = installFoundryMock({ as: "gm", tableUserId: "table-1" });
const controlPalette = await import("../scripts/control-palette.mjs");
const sockets = await import("../scripts/sockets.mjs");

/**
 * The (non-exported) ControlPalette's `data-action` → static-handler map,
 * captured ONCE under the import-time env. ControlPalette inherits render()
 * from the AppV2 stub whose prototype is bound at import; a later
 * installFoundryMock builds a FRESH ApplicationV2, so we must grab the class
 * before beforeEach swaps the env. Wrapping render lets us capture `this`
 * (the palette) without exporting anything from the module. The handlers close
 * over module imports (getTableUserId / executeAsUser), not the env, so they
 * dispatch against whichever env is live when a test invokes them.
 *
 * @type {Record<string, Function>}
 */
const ACTIONS = (() => {
  const proto = env.foundry.applications.api.ApplicationV2.prototype;
  const orig = proto.render;
  let captured = null;
  proto.render = function (...args) {
    captured = this;
    return orig.apply(this, args);
  };
  try {
    controlPalette.open(); // GM env → instantiates + renders the palette singleton
  } finally {
    proto.render = orig;
  }
  if (!captured) throw new Error("failed to capture the ControlPalette instance via open()");
  return captured.constructor.DEFAULT_OPTIONS.actions;
})();

/** Install a recording socket so executeAsUser dispatches are observable. */
function wire() {
  sockets.register();
  return env.getSocket();
}

/** Dispatches of `name` recorded on the mock socket. */
function dispatches(socket, name) {
  return socket.executeCalls.filter((c) => c.name === name);
}

beforeEach(() => {
  env.restore();
  env = installFoundryMock({ as: "gm", tableUserId: "table-1" });
});

afterEach(() => {
  env.restore();
});

// --- action wiring ----------------------------------------------------------

test("DEFAULT_OPTIONS.actions wires the three quick-action keys to distinct handlers", () => {
  for (const key of ["close-all", "refit-scene", "toggle-table-mode"]) {
    assert.equal(typeof ACTIONS[key], "function", `action "${key}" is wired to a handler`);
  }
  // The refit and close handlers must not be the same function (a copy-paste
  // mis-wire would collapse them).
  assert.notEqual(ACTIONS["refit-scene"], ACTIONS["close-all"], "refit ≠ close-all handler");
  assert.notEqual(ACTIONS["refit-scene"], ACTIONS["toggle-table-mode"], "refit ≠ toggle handler");
});

// --- refit (the regression) -------------------------------------------------

test("the 'refit-scene' action dispatches refitScene to the Table — NOT followScene (regression guard)", async () => {
  const socket = wire();

  await ACTIONS["refit-scene"]({});

  const refit = dispatches(socket, "refitScene");
  assert.equal(refit.length, 1, "dispatched exactly one refitScene");
  assert.equal(refit[0].userId, "table-1", "targeted the Table user");
  assert.equal(
    dispatches(socket, "followScene").length,
    0,
    "did NOT dispatch followScene (the named regression)",
  );
});

// --- close-all --------------------------------------------------------------

test("the 'close-all' action dispatches closeAllPopups to the Table", async () => {
  const socket = wire();

  await ACTIONS["close-all"]({});

  const close = dispatches(socket, "closeAllPopups");
  assert.equal(close.length, 1, "dispatched exactly one closeAllPopups");
  assert.equal(close[0].userId, "table-1", "targeted the Table user");
});

// --- toggle table mode ------------------------------------------------------

test("the 'toggle-table-mode' action dispatches toggleTableMode to the Table", async () => {
  const socket = wire();

  await ACTIONS["toggle-table-mode"]({});

  const toggle = dispatches(socket, "toggleTableMode");
  assert.equal(toggle.length, 1, "dispatched exactly one toggleTableMode");
  assert.equal(toggle[0].userId, "table-1", "targeted the Table user");
});
