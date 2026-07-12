// ============================================================================
// test/main-lifecycle.test.mjs
// ----------------------------------------------------------------------------
// The ORDERING guard for AC1, proven where the guarantee actually lives:
// scripts/main.mjs. A sockets-only test (test/sockets.test.mjs) controls its
// own call order, so it CANNOT catch a regression that moves register() back
// to `socketlib.ready`. This test reproduces the v0.1.7–v0.1.10 bug directly.
//
// main.mjs registers its `init` and `ready` lifecycle hooks at IMPORT time
// (top-level Hooks.once calls). We therefore install the mock ONCE, import
// main.mjs, and inspect the SAME Hooks object main registered into — we never
// swap globalThis.Hooks afterward (that would orphan main's registrations).
//
// The feature-module inits and sockets' handlers map are singletons that
// persist across tests in this file (fresh process per file under node --test).
// We exploit that monotonically: the first test runs `ready` BEFORE `init`
// (empty handler map → stubs, the bug), the second runs `init` THEN `ready`
// (populated map → real handlers, the fix).
// ============================================================================

import { test } from "node:test";
import assert from "node:assert/strict";

import { installFoundryMock, captureLogs } from "./helpers/foundry-mock.mjs";

// Install BEFORE importing main.mjs. main.mjs statically imports the whole
// feature graph (two modules build AppV2 subclasses at import time) and reads
// no globals at import beyond that — but its hook callbacks read them at call
// time, so the env must exist first. We keep this single env for the file.
const env = installFoundryMock();
await import("../scripts/main.mjs");

// The four feature-owned handlers whose real-vs-stub status proves the ordering.
const FEATURE_HANDLERS = ["showImage", "closeAllPopups", "setVisionFocus", "followScene"];

const CANONICAL_NAMES = [
  "showJournal",
  "showItem",
  "showImage",
  "showPortrait",
  "closeAllPopups",
  "setVisionFocus",
  "setUiHidden",
  "setTableMode",
  "followScene",
  "followLevel",
  "toggleTableMode",
  "refitScene",
];

/** Invoke a registered handler and report whether it emitted the stub marker. */
function isStub(fn, name) {
  const logs = captureLogs();
  try {
    fn({});
  } finally {
    logs.restore();
  }
  return logs.text().includes(`stub: ${name} called`);
}

test("main.mjs wires register() to the `ready` hook and NOT to `socketlib.ready`", () => {
  // main registered exactly these lifecycle hooks at import.
  assert.ok(env.hooks.has("init"), "main registered an init hook");
  assert.ok(env.hooks.has("ready"), "main registered a ready hook");
  // The regression we guard against: registering on socketlib.ready (which
  // fires before our init has populated the handler map). Nothing must use it.
  assert.ok(
    !env.hooks.has("socketlib.ready"),
    "register() must NOT be wired to socketlib.ready (the v0.1.7–v0.1.10 bug)",
  );
});

test("REPRODUCTION: running `ready` BEFORE `init` registers STUBS for feature handlers", () => {
  // At file start the sockets handlers map is empty (feature inits haven't run).
  // main's ready callback calls sockets.register() — so registering now, before
  // init, binds the placeholder stub for every feature-owned name. This is
  // exactly the v0.1.7–v0.1.10 failure.
  const readyCb = env.hooks.onceHandler("ready");
  assert.equal(typeof readyCb, "function");
  readyCb();

  const socket = env.getSocket();
  assert.ok(socket, "register() acquired a socketlib module handle");
  for (const name of FEATURE_HANDLERS) {
    const fn = socket.registered.get(name);
    assert.ok(isStub(fn, name), `"${name}" is a STUB when register() runs before init`);
  }
});

test("FIX: running `init` THEN `ready` yields REAL handlers for the feature names", () => {
  // Run main's init callback — invokes every feature module's init(), which
  // populates the sockets handlers map via setHandler().
  const initCb = env.hooks.onceHandler("init");
  assert.equal(typeof initCb, "function");
  initCb();

  // Now re-run ready → register() prefers the real handlers over stubs.
  const readyCb = env.hooks.onceHandler("ready");
  readyCb();

  const socket = env.getSocket();
  for (const name of FEATURE_HANDLERS) {
    const fn = socket.registered.get(name);
    assert.equal(typeof fn, "function", `"${name}" registered`);
    assert.ok(!isStub(fn, name), `"${name}" is the REAL handler after init→ready`);
  }
});

test("all 12 canonical names are registered exactly once after init→ready", () => {
  // The prior test already ran init+ready on the shared singletons; re-running
  // ready is idempotent for the name set. Assert the full set + no extras.
  env.hooks.onceHandler("ready")();
  const socket = env.getSocket();
  for (const name of CANONICAL_NAMES) {
    assert.ok(socket.registered.has(name), `registered "${name}"`);
  }
  assert.equal(socket.registered.size, CANONICAL_NAMES.length);
});
