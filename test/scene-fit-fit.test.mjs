// ============================================================================
// test/scene-fit-fit.test.mjs
// ----------------------------------------------------------------------------
// The NON-pure side of scene-fit: fitSceneToTable() (scripts/scene-fit.mjs).
// The pure computeFit()/physicalScale() seam is covered by scene-fit.test.mjs;
// this file drives the Foundry-touching orchestration:
//   - the three early bails (no canvas.scene / animatePan-not-a-function /
//     no dimensions) — each asserted via an observable (no pan, no getFlag read);
//   - an aspect mode fitting to the scene CENTER at a 2-decimal-ROUNDED scale
//     while the canvas lock stays disengaged (withUnlocked transparent — the
//     libWrapper OVERRIDE is never registered during a fit);
//   - physical mode raising CONFIG.Canvas.maxZoom when the exact (unrounded)
//     scale exceeds the cap, and warning+notifying when it dips below minZoom;
//   - a FitComputeError from bad physical calibration → ui.notifications.warn
//     and NO pan (never fit a blank canvas).
//
// jsdom (test-setup/dom.mjs) supplies window.innerWidth/innerHeight; the aspect
// assertion derives the expected scale from those live values so it can't drift.
// ============================================================================

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import { installFoundryMock } from "./helpers/foundry-mock.mjs";

let env = installFoundryMock({ as: "table", tableUserId: "table-1" });
const sceneFit = await import("../scripts/scene-fit.mjs");
const canvasLock = await import("../scripts/canvas-lock.mjs");

/** Standard scene dimensions object shape Foundry hands us via scene.dimensions. */
function dims({ w, h, x = 0, y = 0, size = 100 }) {
  return { sceneWidth: w, sceneHeight: h, sceneX: x, sceneY: y, size };
}

beforeEach(() => {
  env.restore();
  env = installFoundryMock({ as: "table", tableUserId: "table-1" });
});

afterEach(() => {
  // Defensively drop the lock if a test left it engaged (it should never).
  if (canvasLock.isLocked()) canvasLock.disengageLock();
  env.restore();
});

// --- early bails ------------------------------------------------------------

test("fitSceneToTable bails when there is no active scene", async () => {
  env.canvas.scene = null;
  let panned = false;
  env.canvas.animatePan = async () => (panned = true);
  await sceneFit.fitSceneToTable();
  assert.equal(panned, false, "no pan without a scene");
});

test("fitSceneToTable bails when animatePan is not a function", async () => {
  let flagRead = false;
  env.canvas.scene = { getFlag: () => (flagRead = true), dimensions: dims({ w: 2000, h: 1000 }) };
  env.canvas.animatePan = undefined; // feature-detect fails closed
  await sceneFit.fitSceneToTable();
  // The bail is BEFORE resolveFitMode()'s getFlag read → observable proof.
  assert.equal(flagRead, false, "returned before touching fit-mode resolution");
});

test("fitSceneToTable bails when the scene has no dimensions", async () => {
  let panned = false;
  env.canvas.scene = { getFlag: () => "contain", dimensions: null };
  env.canvas.animatePan = async () => (panned = true);
  await sceneFit.fitSceneToTable();
  assert.equal(panned, false, "no pan without scene dimensions");
});

// --- aspect mode ------------------------------------------------------------

test("aspect mode pans to the scene center at a 2-decimal-rounded scale; lock stays disengaged", async () => {
  const w = 3000;
  const h = 1536;
  env.canvas.scene = { getFlag: () => "contain", dimensions: dims({ w, h, x: 0, y: 0 }) };
  let panArg = null;
  env.canvas.animatePan = async (arg) => (panArg = arg);

  await sceneFit.fitSceneToTable();

  // Derive the expected rounded scale from the live jsdom viewport.
  const vpW = globalThis.window.innerWidth;
  const vpH = globalThis.window.innerHeight;
  const raw = Math.min(vpW / w, vpH / h);
  const expected = Math.round(raw * 100) / 100;

  assert.ok(panArg, "animatePan was called");
  assert.equal(panArg.scale, expected, "scale snapped to 2 decimals");
  assert.equal(panArg.x, w / 2, "panned to horizontal scene center");
  assert.equal(panArg.y, h / 2, "panned to vertical scene center");
  // withUnlocked is transparent when the lock is off: no OVERRIDE was registered.
  assert.equal(env.libWrapper.registerCalls.length, 0, "canvas lock never engaged during a fit");
  assert.equal(canvasLock.isLocked(), false, "lock left disengaged");
});

// --- physical mode ----------------------------------------------------------

/** Seed the physical-calibration settings scene-fit reads via getSetting. */
function seedPhysical(env, { customScale = 1, unit = "inch", diagonalIn, resW, resH }) {
  env.setSetting("custom-scale", customScale);
  env.setSetting("physical-target-unit", unit);
  env.setSetting("display-diagonal-in", diagonalIn);
  env.setSetting("display-res-width", resW);
  env.setSetting("display-res-height", resH);
}

test("physical mode raises CONFIG.Canvas.maxZoom when the exact scale exceeds the cap", async () => {
  // PPI = sqrt(8000²+6000²)/10 = 1000; scale = (1·1000)/(100·1) = 10 > maxZoom 3.
  env.canvas.scene = {
    getFlag: () => "physical",
    dimensions: dims({ w: 4000, h: 3000, size: 100 }),
  };
  env.canvas.app = { renderer: { resolution: 1 } };
  seedPhysical(env, { customScale: 1, unit: "inch", diagonalIn: 10, resW: 8000, resH: 6000 });
  let panArg = null;
  env.canvas.animatePan = async (arg) => (panArg = arg);

  assert.equal(env.CONFIG.Canvas.maxZoom, 3.0, "precondition: default cap");
  await sceneFit.fitSceneToTable();

  assert.ok(panArg, "animatePan was called");
  assert.equal(panArg.scale, 10, "physical scale kept EXACT (unrounded)");
  assert.equal(env.CONFIG.Canvas.maxZoom, 10, "raised the ceiling to ceil(scale)");
});

test("physical mode warns and notifies when the scale falls below minZoom", async () => {
  // PPI = sqrt(100²+100²)/10 ≈ 14.14; scale = (1·14.14)/(1000·1) ≈ 0.0141 < minZoom 0.1.
  env.canvas.scene = {
    getFlag: () => "physical",
    dimensions: dims({ w: 4000, h: 3000, size: 1000 }),
  };
  env.canvas.app = { renderer: { resolution: 1 } };
  seedPhysical(env, { customScale: 1, unit: "inch", diagonalIn: 10, resW: 100, resH: 100 });
  let panned = false;
  env.canvas.animatePan = async () => (panned = true);

  await sceneFit.fitSceneToTable();

  assert.equal(panned, true, "still pans at the (small) computed scale");
  assert.ok(
    env.notifications.calls.warn.some((m) => String(m).includes("physical-fit-clamped")),
    "notified the operator about the min-zoom clamp",
  );
});

test("a FitComputeError from bad physical calibration warns and skips the pan", async () => {
  // diagonalIn = 0 → physicalScale guard throws FitComputeError.
  env.canvas.scene = {
    getFlag: () => "physical",
    dimensions: dims({ w: 4000, h: 3000, size: 100 }),
  };
  env.canvas.app = { renderer: { resolution: 1 } };
  seedPhysical(env, { customScale: 1, unit: "inch", diagonalIn: 0, resW: 8000, resH: 6000 });
  let panned = false;
  env.canvas.animatePan = async () => (panned = true);

  await sceneFit.fitSceneToTable();

  assert.equal(panned, false, "never fit a blank canvas on a compute failure");
  assert.ok(
    env.notifications.calls.warn.some((m) => String(m).includes("physical-fit-failed")),
    "surfaced the failure to the operator",
  );
});
