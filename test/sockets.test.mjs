// ============================================================================
// test/sockets.test.mjs
// ----------------------------------------------------------------------------
// The highest-value target (AC1): socketlib registration ordering + the
// real-handler-vs-stub distinction that was the v0.1.7–v0.1.10 root cause.
//
// This file drives scripts/sockets.mjs directly:
//   - setHandler(name, fn) BEFORE register() => the fn socketlib received for
//     `name` is IDENTICALLY that fn (real handler wins over stub).
//   - an UNSET name => a logging-no-op stub (distinct from a real handler; the
//     stub emits a "stub: <name> called" line, which nothing else does).
//   - register() bails + logs an error when globalThis.socketlib is absent.
//   - the four self-registered handlers (setTableMode/toggleTableMode/
//     setUiHidden/refitScene) are real (behavioral, not stubs).
//
// The COMPANION guard for the *ordering* — that main.mjs wires register() to
// Foundry's `ready` (not `socketlib.ready`) AFTER feature inits — lives in
// test/main-lifecycle.test.mjs, because a sockets-only test controls its own
// call order and so cannot catch a revert to socketlib.ready.
//
// Isolation: sockets.mjs holds module singletons (`handlers` map, `cs`). We
// import it ONCE and reset the relevant surface per test (a fresh mock env +
// fresh setHandler calls); ESM cache-busting is deliberately NOT used (it does
// not reset the dependency subgraph — see KD6).
// ============================================================================

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import { installFoundryMock, captureLogs } from "./helpers/foundry-mock.mjs";

// Install the mock before importing sockets.mjs (import-safe, but the module's
// functions read globals at call time, so globals must exist first).
let env = installFoundryMock();
const sockets = await import("../scripts/sockets.mjs");

// The 12 canonical names sockets.register() pushes to socketlib.
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

// The four handlers sockets.mjs wires itself inside register().
const SELF_REGISTERED = ["setTableMode", "toggleTableMode", "setUiHidden", "refitScene"];

beforeEach(() => {
  // Fresh env each test so the socketlib spy + settings/user state don't leak.
  env.restore();
  env = installFoundryMock();
});

afterEach(() => {
  env.restore();
});

test("register() pushes all 12 canonical names exactly once", () => {
  sockets.register();
  const socket = env.getSocket();
  assert.ok(socket, "socketlib.registerModule was called");
  // Every canonical name is present.
  for (const name of CANONICAL_NAMES) {
    assert.ok(socket.registered.has(name), `registered "${name}"`);
  }
  // Exactly 12, and no duplicates (Map keys are unique; assert the count).
  assert.equal(socket.registered.size, CANONICAL_NAMES.length);
});

test("register() registers the module under the correct MODULE_ID", () => {
  sockets.register();
  assert.equal(env.getSocket().moduleId, "community-screen");
});

test("setHandler(name, sentinel) BEFORE register() => registered fn IS the sentinel (identity)", () => {
  // A unique sentinel we can identity-compare against what socketlib received.
  const sentinel = () => "SENTINEL";
  sockets.setHandler("showImage", sentinel);
  sockets.register();
  const registered = env.getSocket().registered.get("showImage");
  // Not merely equal — the SAME function reference. A stub would be a fresh fn.
  assert.equal(registered, sentinel);
});

test("an UNSET name => a logging-no-op stub, NOT a real handler", () => {
  // showJournal/showItem are legacy names no feature wires in THIS isolated
  // test (popups.init not run), so register() gives them a stub.
  sockets.register();
  const stub = env.getSocket().registered.get("showJournal");
  assert.equal(typeof stub, "function");

  // The stub's defining behavior: it logs "stub: showJournal called" and
  // returns undefined. Capture console to prove that's what we got.
  const logs = captureLogs();
  let result;
  try {
    result = stub("arg1", "arg2");
  } finally {
    logs.restore();
  }
  assert.equal(result, undefined);
  assert.ok(
    logs.text().includes("stub: showJournal called"),
    "an unset name resolves to the logging-no-op stub",
  );
});

test("a real handler is DISTINCT from a stub: setHandler wins and does not log 'stub:'", () => {
  let called = false;
  sockets.setHandler("showImage", () => {
    called = true;
  });
  sockets.register();
  const fn = env.getSocket().registered.get("showImage");

  const logs = captureLogs();
  try {
    fn();
  } finally {
    logs.restore();
  }
  assert.equal(called, true, "the real handler ran");
  assert.ok(!logs.text().includes("stub:"), "the real handler is not the stub");
});

test("the four self-registered handlers are REAL (behavioral), not stubs", () => {
  sockets.register();
  const socket = env.getSocket();
  // Calling each self-registered handler must NOT emit the stub marker. They
  // early-return off-Table (default env is a GM, isTableUser() false) so they
  // are side-effect-free here — but a stub would log "stub:".
  for (const name of SELF_REGISTERED) {
    const fn = socket.registered.get(name);
    assert.equal(typeof fn, "function", `${name} registered`);
    const logs = captureLogs();
    try {
      fn({}); // off-Table => real handler returns immediately
    } finally {
      logs.restore();
    }
    assert.ok(!logs.text().includes(`stub: ${name} called`), `${name} is real, not a stub`);
  }
});

test("register() bails + logs an error when globalThis.socketlib is absent", () => {
  // Remove socketlib for this test only.
  const saved = globalThis.socketlib;
  delete globalThis.socketlib;
  const logs = captureLogs();
  try {
    sockets.register();
  } finally {
    logs.restore();
    globalThis.socketlib = saved;
  }
  assert.ok(
    logs.text().includes("socketlib is not available"),
    "register() logs the missing-dependency error",
  );
  // Nothing was registered on the (fresh, per-test) mock socketlib: register()
  // bailed before ever calling registerModule. (We assert this on the env's own
  // socketlib rather than the leaky module-level `cs` singleton.)
  assert.equal(env.getSocket(), undefined);
});

test("getSocket() returns the freshly-acquired module handle after register()", () => {
  // The module-level `cs` singleton persists across tests, but register()
  // re-acquires from the CURRENT (per-test) mock socketlib, so the handle we
  // read back must be exactly the one THIS env produced.
  sockets.register();
  assert.equal(sockets.getSocket(), env.getSocket());
});
