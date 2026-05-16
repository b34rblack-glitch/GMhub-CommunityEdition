// ============================================================================
// scripts/module.mjs
// ----------------------------------------------------------------------------
// Module-wide constants and namespace strings.
//
// This file is the single source of truth for the module id, title, i18n
// prefix, body-class names, and scene-flag namespace key. Every other script
// imports from here rather than hard-coding these values, so a future rename
// is a one-file change.
//
// No side effects. No imports. Safe to import from anywhere — including
// during module init before Foundry is fully ready.
// ============================================================================

/** @type {string} The Foundry module id. Must match the folder name and `module.json` `id`. */
export const MODULE_ID = "community-screen";

/** @type {string} The human-readable module title. Shown in init logs and the control palette header. */
export const MODULE_TITLE = "Community Screen";

/** @type {string} Prefix used for every i18n key the module owns. */
export const I18N_PREFIX = "COMMUNITY_SCREEN";

/** @type {string} CSS body class added to the Table client to hide Foundry chrome (sidebar, hotbar, etc). */
export const BODY_CLASS_HIDDEN = "community-screen-hidden";

/** @type {string} CSS body class added to the Table client while the canvas pan/zoom lock is engaged. */
export const BODY_CLASS_LOCKED = "community-screen-locked";

/** @type {string} CSS body class added to the Table client while at least one popup is open AND the popup-backdrop setting is on. */
export const BODY_CLASS_MODAL_BG = "community-screen-modal-bg";

/** @type {string} Scene flag key under our module namespace used to store the per-scene fit-mode override. */
export const SCENE_FLAG_FIT_MODE = "fitMode";
