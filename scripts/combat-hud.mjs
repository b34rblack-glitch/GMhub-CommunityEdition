// ============================================================================
// scripts/combat-hud.mjs
// ----------------------------------------------------------------------------
// Player-facing combat HUD — a chrome-free, TEXT-ONLY overlay pinned top-center
// on the Table client showing the current combatant, the next combatant, and
// the round number. Mirrors the active-turn highlight's job ("whose turn is
// it?") in words for anyone who can't read the ring from across the room.
//
// SECURITY — redaction is the SOLE load-bearing control (see KD7 in
// .conclave/spec.md). Hidden Combatant documents ARE synced to the Table
// (player-role) client with their real name + initiative in memory; Foundry
// only filters hidden combatants at its own render layer, which we don't use.
// So THIS render path is the only thing between a hidden NPC and the TV, and it
// must FAIL CLOSED: for each slot independently we emit "?" (no name, no
// initiative, no image, nothing in any attribute) whenever the combatant is
// hidden OR can't be read. Only already-redacted values ever reach the DOM.
//
//   The ONLY redaction trigger is `combatant.hidden || token.hidden`.
//   Token displayName masking, secret/neutral disposition, and core's
//   "hide NPC initiative" setting are DELIBERATELY IGNORED — a visible
//   combatant shows its name + initiative to the room. To keep an NPC off
//   the Table, mark the combatant/token HIDDEN; a masked name or secret
//   disposition is NOT a shield here.
//
// DOM-only overlay — no PIXI, so no PIXI v7/v8 concerns. The node is a custom
// id/class appended to document.body, so it survives `body.community-screen-
// hidden` (which only targets Foundry's own element IDs).
// ============================================================================

import { MODULE_ID } from "./module.mjs";
import { isTableUser } from "./identity.mjs";
import { get as getSetting } from "./settings.mjs";
import { t } from "./lib/helpers.mjs";
import { logger } from "./lib/logger.mjs";

/** @type {string} The overlay's element id AND class (custom, never matched by chrome-hide CSS). */
const HUD_ID = "community-screen-combat-hud";

/**
 * @returns {HTMLElement | null} The existing HUD node, if any.
 */
function existingHud() {
  return document.getElementById(HUD_ID);
}

/**
 * Remove the HUD overlay from the DOM if present.
 *
 * @returns {void}
 */
function removeHud() {
  existingHud()?.remove();
}

/**
 * Reduce a combatant to a DISPLAY-SAFE `{ label, init }` pair, failing closed.
 *
 * Fail-closed means: any hidden signal, any off-level combatant, a missing
 * combatant, or ANY error reading it, yields `{ label: "?", init: "" }` with
 * no real name or initiative. The real name/initiative are only read AFTER the
 * hidden checks pass, so they can never be built into a row and blanked later.
 *
 * @param {Combatant | null | undefined} combatant
 * @returns {{ label: string, init: string }} Redacted, DOM-safe values.
 */
function redact(combatant) {
  // Sentinel used for every fail-closed path below.
  const REDACTED = { label: "?", init: "" };
  try {
    // Missing / empty slot (e.g. no next combatant) → redact.
    if (!combatant) return REDACTED;

    // The sole redaction trigger: the combatant OR its token is hidden.
    if (combatant.hidden || combatant.token?.hidden) return REDACTED;

    // v14 Scene-Levels guard: a combatant on another level isn't "shown" here
    // (mirrors combat-highlight.mjs). Treat off-level as not-shown → "?".
    const level = combatant.token?.level;
    if (level !== undefined && level !== canvas?.viewedLevel) return REDACTED;

    // Only now, past every gate, do we read the real identity.
    const name = combatant.name;
    const init = combatant.initiative;
    return {
      label: typeof name === "string" && name.length ? name : "?",
      init: init === null || init === undefined ? "" : String(init),
    };
  } catch (err) {
    // Any read failure fails closed — never leak on an unexpected shape.
    logger.warn("Combat HUD redaction failed; failing closed to '?':", err);
    return REDACTED;
  }
}

/**
 * Build one HUD slot (`current` / `next`) from ALREADY-REDACTED values. Sets
 * only `textContent` and static class names — no name/initiative is placed in
 * any attribute (title/aria-label/data-*), and no image is rendered.
 *
 * @param {string} kind - "current" or "next" (used only for the CSS modifier).
 * @param {string} capText - The localized slot caption ("Now" / "Next").
 * @param {{ label: string, init: string }} redacted - Display-safe values.
 * @returns {HTMLElement}
 */
function buildSlot(kind, capText, redacted) {
  const slot = document.createElement("div");
  slot.className = `${HUD_ID}-slot ${HUD_ID}-${kind}`;

  const cap = document.createElement("span");
  cap.className = `${HUD_ID}-cap`;
  cap.textContent = capText;
  slot.appendChild(cap);

  const name = document.createElement("span");
  name.className = `${HUD_ID}-name`;
  name.textContent = redacted.label;
  slot.appendChild(name);

  // Initiative is optional — omitted entirely when blank/redacted.
  if (redacted.init !== "") {
    const init = document.createElement("span");
    init.className = `${HUD_ID}-init`;
    init.textContent = redacted.init;
    slot.appendChild(init);
  }
  return slot;
}

/**
 * (Re)render the HUD. Reads the enable state at RENDER time (not init time) so
 * the `clientSettingChanged` live-toggle works. Removes the overlay whenever
 * it shouldn't be shown; rebuilds its contents from redacted values otherwise.
 *
 * @returns {void}
 */
function render() {
  // Gate on Table-user AND the client toggle, read live.
  if (!isTableUser() || !getSetting("combat-hud-enabled", false)) {
    removeHud();
    return;
  }

  // Only show for a started combat.
  const combat = game.combats?.active;
  if (!combat?.started) {
    removeHud();
    return;
  }

  // Redact BOTH slots independently and fail-closed BEFORE touching the DOM.
  const current = redact(combat.combatant);
  const next = redact(combat.nextCombatant);
  const round = Number.isFinite(combat.round) ? combat.round : 0;

  // Singleton node — reuse if present, else create and attach to <body>.
  let hud = existingHud();
  if (!hud) {
    hud = document.createElement("div");
    hud.id = HUD_ID;
    hud.className = HUD_ID;
    document.body.appendChild(hud);
  }
  // Rebuild from scratch each render, from redacted values only.
  hud.replaceChildren();

  const roundBadge = document.createElement("span");
  roundBadge.className = `${HUD_ID}-round`;
  roundBadge.textContent = t("combat-hud.round", { round: String(round) });
  hud.appendChild(roundBadge);

  hud.appendChild(buildSlot("current", t("combat-hud.current"), current));
  hud.appendChild(buildSlot("next", t("combat-hud.next"), next));
}

/**
 * Safe render wrapper — never lets a render error leave a stale (possibly
 * leaking) overlay on screen.
 *
 * @returns {void}
 */
function safeRender() {
  try {
    render();
  } catch (err) {
    logger.error("Combat HUD render failed; removing overlay:", err);
    removeHud();
  }
}

/**
 * Register combat-HUD hooks. Idempotent.
 *
 * @returns {void}
 */
export function init() {
  // Re-render on anything that can change current/next/round OR a combatant's
  // hidden flag. `updateCombatant` is CRITICAL: toggling a combatant hidden
  // mid-combat WITHOUT advancing the turn fires only this hook — without it a
  // just-hidden combatant's name would keep leaking. create/deleteCombatant
  // keep the slots correct and clear a deleted combatant's row.
  for (const h of [
    "updateCombat",
    "combatTurnChange",
    "updateCombatant",
    "createCombatant",
    "deleteCombatant",
    "canvasReady",
  ]) {
    Hooks.on(h, () => {
      if (isTableUser()) safeRender();
    });
  }

  // End of combat → tear the overlay down unconditionally.
  for (const h of ["combatEnd", "deleteCombat"]) {
    Hooks.on(h, () => removeHud());
  }

  // Live-toggle: adding/removing the client setting shows/hides immediately.
  Hooks.on("clientSettingChanged", (key) => {
    if (key?.startsWith?.(`${MODULE_ID}.combat-hud-`)) safeRender();
  });
}
