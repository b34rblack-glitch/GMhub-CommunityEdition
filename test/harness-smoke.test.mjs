// ============================================================================
// test/harness-smoke.test.mjs
// ----------------------------------------------------------------------------
// Proves the Step-1 harness foundation: with the Foundry mock installed on
// globalThis (and the jsdom preload supplying the DOM), the WHOLE module import
// graph — including main.mjs and the two modules that dereference
// `foundry.applications.api.*` at class-definition time (control-palette.mjs,
// setup-wizard.mjs) — loads with NO top-level ReferenceError. Also confirms
// jsdom resolved and the DOM globals are present.
// ============================================================================

import { test } from "node:test";
import assert from "node:assert/strict";

import { installFoundryMock } from "./helpers/foundry-mock.mjs";

// Install BEFORE the dynamic imports below: control-palette.mjs and
// setup-wizard.mjs evaluate `class extends
// foundry.applications.api.HandlebarsApplicationMixin(...)` at import time.
const env = installFoundryMock();

test("jsdom preload resolves and supplies DOM globals", async () => {
  const { JSDOM } = await import("jsdom");
  assert.equal(typeof JSDOM, "function");
  // The preload (test-setup/dom.mjs) put these on globalThis.
  assert.equal(typeof document, "object");
  assert.equal(typeof HTMLElement, "function");
  assert.equal(typeof Event, "function");
  assert.ok(document.getElementById("board"), "#board element exists for canvas-lock");
  // The synchronous rAF shim runs its callback inline.
  let ran = false;
  requestAnimationFrame(() => {
    ran = true;
  });
  assert.equal(ran, true, "requestAnimationFrame shim is synchronous");
});

test("the full module import graph loads with no top-level ReferenceError", async () => {
  // Each of these is import-safe ONLY because the mock is installed. Two of
  // them build AppV2 subclasses at import time.
  const targets = [
    "../scripts/main.mjs",
    "../scripts/sockets.mjs",
    "../scripts/popups.mjs",
    "../scripts/push-buttons.mjs",
    "../scripts/canvas-lock.mjs",
    "../scripts/vision.mjs",
    "../scripts/scene-follow.mjs",
    "../scripts/scene-fit.mjs",
    "../scripts/control-palette.mjs",
    "../scripts/setup-wizard.mjs",
    "../scripts/ownership.mjs",
    "../scripts/identity.mjs",
  ];
  for (const spec of targets) {
    const mod = await import(spec);
    assert.equal(typeof mod, "object", `${spec} imported to a namespace object`);
  }
});

test("the mock exposes the surfaces later steps rely on", () => {
  assert.equal(typeof env.game.settings.get, "function");
  assert.equal(typeof env.foundry.applications.api.ApplicationV2, "function");
  assert.equal(typeof env.foundry.applications.api.HandlebarsApplicationMixin, "function");
  assert.ok(env.foundry.applications.instances instanceof Map);
  assert.equal(typeof env.socketlib.registerModule, "function");
  assert.equal(typeof env.libWrapper.register, "function");
  assert.equal(env.CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER, 3);
});
