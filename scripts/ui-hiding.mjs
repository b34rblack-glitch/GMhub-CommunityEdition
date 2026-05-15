// Community Screen — body-class toggle that hides Foundry chrome on the Table client.

import { BODY_CLASS_HIDDEN } from "./module.mjs";
import { isTableUser } from "./identity.mjs";
import { get as getSetting } from "./settings.mjs";
import { logger } from "./lib/logger.mjs";

/**
 * Apply or remove the body class that hides Foundry's chrome.
 * After toggling, request a renderer resize and re-pan so the canvas
 * stays centered on the scene's view position.
 *
 * @param {boolean} hidden - True to hide chrome; false to reveal.
 * @returns {void}
 */
export function setUiHidden(hidden) {
  document.body.classList.toggle(BODY_CLASS_HIDDEN, Boolean(hidden));
  try {
    canvas?.app?.renderer?.resize?.(window.innerWidth, window.innerHeight);
    const view = canvas?.scene?._viewPosition;
    if (view && typeof canvas.pan === "function") canvas.pan(view);
  } catch (err) {
    logger.warn("Failed to re-fit canvas after UI toggle:", err);
  }
}

/**
 * @returns {boolean} True if the chrome-hidden body class is currently applied.
 */
export function isUiHidden() {
  return document.body.classList.contains(BODY_CLASS_HIDDEN);
}

/**
 * Apply the UI hiding state corresponding to the saved `table-mode` setting
 * on the Table client. Called from `ready` on the Table client.
 *
 * @returns {void}
 */
export function applyFromSettings() {
  if (!isTableUser()) return;
  const mode = getSetting("table-mode", "play");
  setUiHidden(mode === "play");
}

/**
 * Register `ready`-time hook to apply UI hiding on the Table client.
 *
 * @returns {void}
 */
export function init() {
  Hooks.once("ready", () => {
    applyFromSettings();
  });
}
