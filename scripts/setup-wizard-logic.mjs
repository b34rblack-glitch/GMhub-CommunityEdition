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

/**
 * The hard-dependency module ids the wizard verifies. Mirrors
 * module.json `relationships.requires`. `lib-wrapper` and `socketlib` must both
 * be ACTIVE for the module to function.
 *
 * @type {ReadonlyArray<string>}
 */
export const REQUIRED_MODULES = Object.freeze(["socketlib", "lib-wrapper"]);

/**
 * Pure dependency-status reducer. Given a map of module-id → is-active boolean
 * (the wizard supplies `game.modules.get(id)?.active === true` for each), report
 * the per-module active state and whether ALL required deps are satisfied.
 *
 * A value is treated as active ONLY when strictly `true` — presence in the
 * collection means *installed*, not *active*, so anything non-`true` is
 * inactive. This is the sole real signal (see KD5 in .conclave/spec.md).
 *
 * @param {Record<string, boolean>} [activeById] - module id → active flag.
 * @returns {{ ok: boolean, modules: Array<{ id: string, active: boolean }> }}
 *   `ok` is true iff every required module is active; `modules` is the
 *   per-dependency breakdown in `REQUIRED_MODULES` order.
 */
export function evaluateDependencies(activeById = {}) {
  const modules = REQUIRED_MODULES.map((id) => ({
    id,
    active: activeById[id] === true,
  }));
  const ok = modules.every((m) => m.active);
  return { ok, modules };
}

/**
 * Gate predicate: may the wizard advance PAST `step`? The dependency step
 * blocks forward navigation until both required modules are active; every other
 * step is freely advanceable (later gating, if any, is additive here).
 *
 * @param {number} step - The step the GM is trying to advance past.
 * @param {{ depsOk?: boolean }} [state] - Captured wizard state.
 * @returns {boolean}
 */
export function canAdvance(step, state = {}) {
  if (step === DEPS_STEP) return state.depsOk === true;
  return true;
}

/**
 * Gate predicate: is Finish permitted? Refused until both required modules are
 * active (belt-and-suspenders — the GM cannot normally reach the final step
 * without passing the dependency gate, but a dep could be toggled meanwhile).
 *
 * @param {{ depsOk?: boolean }} [state] - Captured wizard state.
 * @returns {boolean}
 */
export function canFinish(state = {}) {
  return state.depsOk === true;
}
