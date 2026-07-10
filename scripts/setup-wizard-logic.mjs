// ============================================================================
// scripts/setup-wizard-logic.mjs
// ----------------------------------------------------------------------------
// FOUNDRY-FREE pure logic for the first-run setup wizard (the H1 testability
// seam — see KD10 in .conclave/spec.md).
//
// scripts/setup-wizard.mjs dereferences `foundry.applications.api.*` at module
// top level, so importing it under `node --test` throws
// `ReferenceError: foundry is not defined`. Every pure helper the wizard needs
// therefore lives HERE — no Foundry globals, no DOM — so test/setup-wizard.test.mjs
// can import ONLY from this module and exercise the logic without a browser.
//
// This file MUST NOT reference `game`, `ui`, `canvas`, `foundry`, `Hooks`, or
// any other Foundry runtime global. Keep it pure.
//
// Starts minimal (the step-order model + a clamp helper); the dependency
// reducer, gate predicates, and settings-bucket classifier are added in the
// steps that need them.
// ============================================================================

/**
 * Canonical ordered list of wizard step keys. The wizard's numeric `step`
 * index maps into this array; the order defines the linear flow.
 *
 * @type {ReadonlyArray<string>}
 */
export const STEPS = Object.freeze([
  "welcome",
  "dependencies",
  "table-user",
  "settings",
  "connectivity",
]);

/** Index of the dependency-gate step. @type {number} */
export const DEPS_STEP = STEPS.indexOf("dependencies");

/** Index of the final (connectivity / Finish) step. @type {number} */
export const LAST_STEP = STEPS.length - 1;

/**
 * Clamp an arbitrary value to a valid step index in `[0, LAST_STEP]`.
 * Non-integers collapse to the first step.
 *
 * @param {number} step - Candidate step index.
 * @returns {number} A valid index within the step range.
 */
export function clampStep(step) {
  if (!Number.isInteger(step)) return 0;
  return Math.max(0, Math.min(step, LAST_STEP));
}
