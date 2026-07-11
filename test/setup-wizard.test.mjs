// ============================================================================
// test/setup-wizard.test.mjs
// ----------------------------------------------------------------------------
// Unit tests for the FOUNDRY-FREE setup-wizard logic, run under the Node
// built-in test runner (`node --test`) — zero new dependencies, no build step.
//
// CRITICAL: this file imports ONLY from scripts/setup-wizard-logic.mjs, NEVER
// from scripts/setup-wizard.mjs. The wizard module dereferences
// `foundry.applications.api.*` at top level, so importing it here would throw
// `ReferenceError: foundry is not defined` and abort the whole test run. The
// logic seam (KD10 in .conclave/spec.md) exists precisely so this stays pure.
//
// CI runs `npm run test` (the validate job) in addition to lint/format/JSON
// validation, so these — and the whole node --test suite — gate merges as well
// as the operator's local `npm run check`.
//
// Covered:
//   - evaluateDependencies reducer: both-active / one-missing / both-missing,
//     and the strict-`true` rule (installed ≠ active)
//   - the gate predicates: canAdvance() blocks past the dependency step and
//     canFinish() is refused until deps are ok
//   - the step model invariants (order + clampStep bounds)
// ============================================================================

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  STEPS,
  DEPS_STEP,
  LAST_STEP,
  clampStep,
  REQUIRED_MODULES,
  evaluateDependencies,
  canAdvance,
  canFinish,
  DEFAULT_TABLE_USER_NAME,
  selectableUsers,
  findReusableTableUser,
  FIT_MODES,
  SETTINGS_BUCKETS,
  classifySetting,
  shouldAutoOpen,
} from "../scripts/setup-wizard-logic.mjs";

test("step model: canonical order + indices", () => {
  assert.deepEqual(STEPS, ["welcome", "dependencies", "table-user", "settings", "connectivity"]);
  assert.equal(DEPS_STEP, 1);
  assert.equal(LAST_STEP, 4);
  assert.deepEqual([...REQUIRED_MODULES], ["socketlib", "lib-wrapper"]);
});

test("clampStep: bounds and non-integer collapse", () => {
  assert.equal(clampStep(-5), 0);
  assert.equal(clampStep(0), 0);
  assert.equal(clampStep(2), 2);
  assert.equal(clampStep(99), LAST_STEP);
  assert.equal(clampStep(1.5), 0);
  assert.equal(clampStep(Number.NaN), 0);
  assert.equal(clampStep(undefined), 0);
});

test("evaluateDependencies: both active → ok", () => {
  const r = evaluateDependencies({ socketlib: true, "lib-wrapper": true });
  assert.equal(r.ok, true);
  assert.equal(r.modules.length, 2);
  assert.ok(r.modules.every((m) => m.active));
  // Reported in REQUIRED_MODULES order.
  assert.deepEqual(
    r.modules.map((m) => m.id),
    ["socketlib", "lib-wrapper"],
  );
});

test("evaluateDependencies: one missing → not ok", () => {
  const r = evaluateDependencies({ socketlib: true, "lib-wrapper": false });
  assert.equal(r.ok, false);
  assert.equal(r.modules.find((m) => m.id === "socketlib").active, true);
  assert.equal(r.modules.find((m) => m.id === "lib-wrapper").active, false);
});

test("evaluateDependencies: both missing / empty / no arg → not ok", () => {
  assert.equal(evaluateDependencies({ socketlib: false, "lib-wrapper": false }).ok, false);
  assert.equal(evaluateDependencies({}).ok, false);
  assert.equal(evaluateDependencies().ok, false);
  assert.ok(evaluateDependencies({}).modules.every((m) => !m.active));
});

test("evaluateDependencies: installed-but-not-active (non-true) counts as inactive", () => {
  // Only strict `true` is active — a truthy-but-not-true value must NOT pass.
  assert.equal(evaluateDependencies({ socketlib: 1, "lib-wrapper": "yes" }).ok, false);
  assert.equal(evaluateDependencies({ socketlib: {}, "lib-wrapper": true }).ok, false);
});

test("canAdvance: blocks past the dependency step until deps ok", () => {
  assert.equal(canAdvance(DEPS_STEP, { depsOk: false }), false);
  assert.equal(canAdvance(DEPS_STEP, {}), false);
  assert.equal(canAdvance(DEPS_STEP, { depsOk: true }), true);
  // Non-dependency steps are never gated by the dependency check.
  assert.equal(canAdvance(0, { depsOk: false }), true);
  assert.equal(canAdvance(LAST_STEP, { depsOk: false }), true);
});

test("canFinish: refused until deps ok", () => {
  assert.equal(canFinish({ depsOk: false }), false);
  assert.equal(canFinish({}), false);
  assert.equal(canFinish(), false);
  assert.equal(canFinish({ depsOk: true }), true);
});

test("selectableUsers: keeps only non-GM users, preserves order, projects id+name", () => {
  const users = [
    { id: "gm1", name: "Gamemaster", isGM: true },
    { id: "p1", name: "Alice", isGM: false },
    { id: "p2", name: "Table", isGM: false },
  ];
  assert.deepEqual(selectableUsers(users), [
    { id: "p1", name: "Alice" },
    { id: "p2", name: "Table" },
  ]);
  // Defensive: no arg, empty, and null entries never throw.
  assert.deepEqual(selectableUsers(), []);
  assert.deepEqual(selectableUsers([]), []);
  assert.deepEqual(selectableUsers([null, { id: "p3", name: "Bob", isGM: false }]), [
    { id: "p3", name: "Bob" },
  ]);
});

test("findReusableTableUser: finds a non-GM 'Table', ignores GM/other names", () => {
  assert.equal(DEFAULT_TABLE_USER_NAME, "Table");
  // A non-GM user named "Table" is reusable.
  assert.deepEqual(
    findReusableTableUser([
      { id: "gm1", name: "Gamemaster", isGM: true },
      { id: "p2", name: "Table", isGM: false },
    ]),
    { id: "p2", name: "Table" },
  );
  // A GM named "Table" must NOT be offered (Table user must be player-role).
  assert.equal(findReusableTableUser([{ id: "gm1", name: "Table", isGM: true }]), null);
  // No "Table" at all → null; no arg → null.
  assert.equal(findReusableTableUser([{ id: "p1", name: "Alice", isGM: false }]), null);
  assert.equal(findReusableTableUser(), null);
  // Custom name match.
  assert.deepEqual(findReusableTableUser([{ id: "p9", name: "TV", isGM: false }], "TV"), {
    id: "p9",
    name: "TV",
  });
});

test("FIT_MODES: canonical fit-mode choices in registration order", () => {
  assert.deepEqual([...FIT_MODES], ["contain", "cover", "width", "height", "native", "physical"]);
});

test("classifySetting: known keys land in the right bucket; unknown → null", () => {
  assert.equal(classifySetting("fit-mode"), "editable");
  assert.equal(classifySetting("popup-backdrop"), "editable");
  assert.equal(classifySetting("auto-grant-ownership"), "editable");
  assert.equal(classifySetting("custom-scale"), "physical");
  assert.equal(classifySetting("physical-target-unit"), "physical");
  assert.equal(classifySetting("display-diagonal-in"), "physical");
  assert.equal(classifySetting("highlight-enabled"), "clientInfo");
  assert.equal(classifySetting("combat-hud-enabled"), "clientInfo");
  assert.equal(classifySetting("highlight-style"), "described");
  assert.equal(classifySetting("spotlight-enabled"), "described");
  assert.equal(classifySetting("display-res-width"), "resolution");
  assert.equal(classifySetting("display-res-height"), "resolution");
  assert.equal(classifySetting("table-user-id"), "handledElsewhere");
  assert.equal(classifySetting("table-mode"), "hidden");
  assert.equal(classifySetting("setup-complete"), "hidden");
  assert.equal(classifySetting("does-not-exist"), null);
});

test("SETTINGS_BUCKETS: partition (no key in two buckets)", () => {
  const seen = new Set();
  for (const keys of Object.values(SETTINGS_BUCKETS)) {
    for (const k of keys) {
      assert.ok(!seen.has(k), `duplicate bucket membership for "${k}"`);
      seen.add(k);
    }
  }
});

test("aware-and-adjust: every config:true setting is surfaced (not null, not hidden)", () => {
  // The full config:true set from settings.mjs. Each must classify to a
  // surfaced or interview-excluded bucket — never `null` (unaccounted) and
  // never `hidden` (which is reserved for config:false settings).
  const configTrue = [
    "table-user-id",
    "fit-mode",
    "custom-scale",
    "physical-target-unit",
    "display-diagonal-in",
    "display-res-width",
    "display-res-height",
    "highlight-enabled",
    "combat-hud-enabled",
    "highlight-style",
    "highlight-use-disposition",
    "suppress-table-chat",
    "auto-grant-ownership",
    "spotlight-enabled",
    "popup-backdrop",
  ];
  for (const k of configTrue) {
    const bucket = classifySetting(k);
    assert.ok(bucket !== null, `"${k}" is unaccounted for (classifies to null)`);
    assert.notEqual(bucket, "hidden", `"${k}" is config:true but classified hidden`);
  }
});

test("shouldAutoOpen: only GM + no Table user + flag unset auto-opens", () => {
  // The one case that auto-opens.
  assert.equal(shouldAutoOpen({ isGM: true, tableUserSetting: "", setupComplete: false }), true);
  // An unset (undefined) flag is still "not complete" → auto-opens.
  assert.equal(
    shouldAutoOpen({ isGM: true, tableUserSetting: "", setupComplete: undefined }),
    true,
  );
  // Non-GM / Table client never auto-opens.
  assert.equal(shouldAutoOpen({ isGM: false, tableUserSetting: "", setupComplete: false }), false);
  // A Table user is already configured → don't auto-open.
  assert.equal(
    shouldAutoOpen({ isGM: true, tableUserSetting: "someUserId", setupComplete: false }),
    false,
  );
  // Flag set (finished or dismissed) → don't auto-open.
  assert.equal(shouldAutoOpen({ isGM: true, tableUserSetting: "", setupComplete: true }), false);
  // Defaults / no arg → false (never auto-open on missing state).
  assert.equal(shouldAutoOpen(), false);
  assert.equal(shouldAutoOpen({}), false);
});
