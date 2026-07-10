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

/**
 * The default name the wizard gives a freshly-created Table user (design.md
 * §1136; also what `identity.mjs` resolves by name as a fallback).
 *
 * @type {string}
 */
export const DEFAULT_TABLE_USER_NAME = "Table";

/**
 * Pure filter: the users a GM may point the Table at — every NON-GM user. GMs
 * are excluded because the Table user must be a player-role account.
 *
 * @param {Array<{ id: string, name: string, isGM: boolean }>} [users]
 * @returns {Array<{ id: string, name: string }>} Non-GM candidates, order preserved.
 */
export function selectableUsers(users = []) {
  return users.filter((u) => u && !u.isGM).map((u) => ({ id: u.id, name: u.name }));
}

/**
 * Duplicate guard (Wave 2 M4). Foundry does NOT enforce unique `User.name`, and
 * `identity.mjs` resolves the Table user by name as a fallback — so blindly
 * creating a second user named "Table" would make name resolution ambiguous.
 * Detect an existing NON-GM user with the default name so the wizard can offer
 * to REUSE it instead of creating a duplicate.
 *
 * @param {Array<{ id: string, name: string, isGM: boolean }>} [users]
 * @param {string} [name] - The name to match (defaults to "Table").
 * @returns {{ id: string, name: string } | null} The reusable user, or null.
 */
export function findReusableTableUser(users = [], name = DEFAULT_TABLE_USER_NAME) {
  const match = users.find((u) => u && !u.isGM && u.name === name);
  return match ? { id: match.id, name: match.name } : null;
}

/**
 * The `fit-mode` choices, in the settings.mjs registration order. Drives the
 * wizard's fit-mode <select> so it stays in sync with the real choices; each
 * value maps to the localized label `settings.fit-mode.<value>`.
 *
 * @type {ReadonlyArray<string>}
 */
export const FIT_MODES = Object.freeze([
  "contain",
  "cover",
  "width",
  "height",
  "native",
  "physical",
]);

/**
 * The AWARE-AND-ADJUST settings walk-through taxonomy (spec KD7). Every module
 * setting is bucketed so the wizard can render the right treatment and so a test
 * can assert exhaustiveness — no `config:true` setting is silently dropped.
 *
 *  - `editable`     Bucket A: editable controls, committed on Finish.
 *  - `physical`     Bucket B: physical-mini, described-with-current-value,
 *                   revealed only when `fit-mode = physical`.
 *  - `clientInfo`   Bucket D: client-scoped, INFORMATIONAL ONLY — never written
 *                   (a GM-laptop write lands in the GM's localStorage, not the
 *                   Table TV's — spec C7).
 *  - `described`    Bucket C: other world settings, described-with-current-value.
 *  - `resolution`   Interview-excluded: auto-detects on the Table (info line only).
 *  - `handledElsewhere` Surfaced in the Table-user step / Finish, not here.
 *  - `hidden`       `config:false` — never surfaced anywhere.
 *
 * @type {Readonly<Record<string, ReadonlyArray<string>>>}
 */
export const SETTINGS_BUCKETS = Object.freeze({
  editable: Object.freeze(["fit-mode", "popup-backdrop", "auto-grant-ownership"]),
  physical: Object.freeze(["custom-scale", "physical-target-unit", "display-diagonal-in"]),
  clientInfo: Object.freeze(["highlight-enabled", "combat-hud-enabled"]),
  described: Object.freeze([
    "highlight-style",
    "highlight-use-disposition",
    "suppress-table-chat",
    "spotlight-enabled",
  ]),
  resolution: Object.freeze(["display-res-width", "display-res-height"]),
  handledElsewhere: Object.freeze(["table-user-id"]),
  hidden: Object.freeze(["table-mode", "setup-complete"]),
});

/**
 * Pure classifier: which walk-through bucket a setting key belongs to.
 *
 * @param {string} key - A module setting key (kebab-case).
 * @returns {string | null} The bucket name from `SETTINGS_BUCKETS`, or `null`
 *   for an unknown key.
 */
export function classifySetting(key) {
  for (const [bucket, keys] of Object.entries(SETTINGS_BUCKETS)) {
    if (keys.includes(key)) return bucket;
  }
  return null;
}

/**
 * Pure predicate for the ONE-TIME auto-open (spec KD3). The wizard auto-opens
 * only on a GM client, only when no Table user is configured yet, and only
 * while the hidden `setup-complete` flag is unset. Any other combination — a
 * non-GM/Table client, an already-configured Table user, or a set flag — must
 * NOT auto-open (the palette "Run setup" button bypasses this and always opens).
 *
 * @param {{ isGM?: boolean, tableUserSetting?: string, setupComplete?: boolean }} [state]
 *   `tableUserSetting` is the RAW `table-user-id` value ("" when unconfigured);
 *   `setupComplete` is the hidden flag.
 * @returns {boolean} True iff the wizard should auto-open.
 */
export function shouldAutoOpen(state = {}) {
  return state.isGM === true && state.tableUserSetting === "" && state.setupComplete !== true;
}
