// Community Screen — push display on the Table client.
//
// Design notes (Foundry v14):
// Previous versions tried to push a document `uuid` from the GM and have the
// Table client `fromUuid()` it and render the system's own sheet. That path
// is fragile: it depends on the Table-Player user having OBSERVER ownership
// on the document, which has to be granted just-in-time and races with the
// socket message. It also depends on each system's sheet renderer behaving
// the same for non-owners, which is not portable.
//
// The robust pattern other "show to players" modules use (Monk's Common
// Display, Theatre Inserts, Foundry core's own `JournalEntry.show()`):
//   GM builds the renderable content (HTML + image URL) and ships THAT
//   over the socket. The receiving client renders a generic window with
//   the inline data — no document lookup, no permission dependency.
//
// That's what this module now does. The display window is a small
// ApplicationV2 that just takes `{title, subtitle?, html}` and renders the
// pre-built HTML inside it. ImagePopout is still used for portraits and
// raw images because it already takes a URL and has no document dep.

import { MODULE_ID, BODY_CLASS_MODAL_BG } from "./module.mjs";
import { isTableUser } from "./identity.mjs";
import { get as getSetting } from "./settings.mjs";
import { setHandler } from "./sockets.mjs";
import { logger } from "./lib/logger.mjs";

/**
 * State container for tracked popups. Stored on `window` so the Table
 * client can introspect open popups from the dev console.
 */
function getState() {
  if (!window.communityScreen) {
    window.communityScreen = { openDisplays: new Set(), openImages: new Set() };
  }
  // Migrate older property names if a stale state object exists.
  if (!window.communityScreen.openDisplays) window.communityScreen.openDisplays = new Set();
  if (!window.communityScreen.openImages) window.communityScreen.openImages = new Set();
  return window.communityScreen;
}

/**
 * Toggle the canvas-dim body class based on whether any popup is open AND
 * the `popup-backdrop` setting is enabled.
 *
 * @returns {void}
 */
function updateBackdrop() {
  if (!isTableUser()) return;
  const enabled = getSetting("popup-backdrop", true);
  const s = getState();
  const anyOpen = s.openDisplays.size > 0 || s.openImages.size > 0;
  document.body.classList.toggle(BODY_CLASS_MODAL_BG, Boolean(enabled && anyOpen));
}

/**
 * Custom ApplicationV2 that renders pre-built HTML inline. No document
 * dependency — the GM client builds and ships the HTML.
 */
class TableDisplay extends foundry.applications.api.HandlebarsApplicationMixin(
  foundry.applications.api.ApplicationV2,
) {
  static DEFAULT_OPTIONS = {
    id: "community-screen-display-{id}",
    classes: ["community-screen", "community-screen-display"],
    tag: "section",
    window: {
      icon: "fa-solid fa-tv",
      resizable: true,
      minimizable: false,
    },
    position: { width: 900, height: 700 },
  };

  static PARTS = {
    main: { template: `modules/${MODULE_ID}/templates/popup-display.hbs` },
  };

  /**
   * @param {{title: string, subtitle?: string, html: string}} data
   * @param {object} [options]
   */
  constructor(data, options = {}) {
    const merged = foundry.utils.mergeObject(
      { window: { title: data.title || "Community Screen" } },
      options,
    );
    super(merged);
    this._csData = data;
  }

  /** @override */
  async _prepareContext() {
    return {
      title: this._csData.title || "",
      subtitle: this._csData.subtitle || "",
      html: this._csData.html || "",
    };
  }
}

/**
 * Position a window centered on the viewport at a comfortable size.
 *
 * @param {object} app
 * @returns {void}
 */
function centerWindow(app) {
  if (!app) return;
  try {
    const width = Math.min(900, Math.max(640, Math.floor(window.innerWidth * 0.6)));
    const height = Math.min(720, Math.max(480, Math.floor(window.innerHeight * 0.75)));
    const left = Math.max(0, Math.floor((window.innerWidth - width) / 2));
    const top = Math.max(0, Math.floor((window.innerHeight - height) / 2));
    if (typeof app.setPosition === "function") {
      app.setPosition({ left, top, width, height });
    }
  } catch (err) {
    logger.debug("centerWindow failed (non-fatal):", err);
  }
}

/**
 * Track a TableDisplay so closeAllPopups can clean it up, and so the
 * modal backdrop turns off when the last popup closes.
 *
 * @param {TableDisplay} app
 * @returns {void}
 */
function trackDisplay(app) {
  if (!app) return;
  const s = getState();
  s.openDisplays.add(app);
  updateBackdrop();
  // Foundry fires `close<ClassName>` on AppV2 close.
  const cleanup = (closed) => {
    if (closed !== app) return;
    s.openDisplays.delete(app);
    updateBackdrop();
  };
  Hooks.once("closeTableDisplay", cleanup);
  Hooks.once("closeApplicationV2", cleanup);
}

/**
 * Track an ImagePopout instance.
 *
 * @param {object} ip
 * @returns {void}
 */
function trackImage(ip) {
  if (!ip) return;
  const s = getState();
  s.openImages.add(ip);
  updateBackdrop();
  const cleanup = (closed) => {
    if (closed !== ip) return;
    s.openImages.delete(ip);
    updateBackdrop();
  };
  Hooks.once("closeImagePopout", cleanup);
  Hooks.once("closeApplicationV2", cleanup);
}

// =====================================================================
// Socket handlers — invoked on the Table client by the GM via socketlib.
// =====================================================================

/**
 * Render a journal-style display window with pre-built HTML.
 *
 * @param {{title: string, subtitle?: string, html: string}} payload
 * @returns {Promise<void>}
 */
async function _showJournal({ title, subtitle, html } = {}) {
  if (!isTableUser()) return;
  logger.info(`showJournal: "${title}"`);
  try {
    const app = new TableDisplay({ title, subtitle, html });
    await app.render(true);
    centerWindow(app);
    trackDisplay(app);
  } catch (err) {
    logger.warn("showJournal failed:", err);
  }
}

/**
 * Render an item-style display window with pre-built HTML.
 *
 * @param {{title: string, subtitle?: string, html: string}} payload
 * @returns {Promise<void>}
 */
async function _showItem({ title, subtitle, html } = {}) {
  if (!isTableUser()) return;
  logger.info(`showItem: "${title}"`);
  try {
    const app = new TableDisplay({ title, subtitle, html });
    await app.render(true);
    centerWindow(app);
    trackDisplay(app);
  } catch (err) {
    logger.warn("showItem failed:", err);
  }
}

/**
 * Show an image via Foundry's native ImagePopout. Takes a URL — no
 * document permission needed.
 *
 * @param {{src: string, caption?: string}} payload
 * @returns {Promise<void>}
 */
async function _showImage({ src, caption } = {}) {
  if (!isTableUser()) return;
  if (!src) return;
  logger.info(`showImage: ${src}`);
  try {
    const ImagePopoutCls = foundry?.applications?.apps?.ImagePopout ?? globalThis.ImagePopout;
    if (!ImagePopoutCls) {
      logger.error("No ImagePopout class available.");
      return;
    }
    const ip = new ImagePopoutCls(src, { title: caption ?? "", shareable: false });
    await ip.render(true);
    trackImage(ip);
  } catch (err) {
    logger.warn("showImage failed:", err);
  }
}

/**
 * Backwards-compatible portrait handler: the GM now ships the image URL
 * directly via `showImage` (so the Table never has to resolve the actor),
 * but we still register this so older callers don't break.
 *
 * @param {{src?: string, caption?: string, actorUuid?: string}} payload
 * @returns {Promise<void>}
 */
async function _showPortrait({ src, caption, actorUuid } = {}) {
  if (!isTableUser()) return;
  if (src) return _showImage({ src, caption });
  // Fallback: try fromUuid on Table side (will only work if Table has perms).
  try {
    const actor = actorUuid ? await fromUuid(actorUuid) : null;
    const img = actor?.img;
    if (!img) {
      logger.warn(`showPortrait: no src and ${actorUuid} not resolvable on Table.`);
      return;
    }
    await _showImage({ src: img, caption: actor.name });
  } catch (err) {
    logger.warn("showPortrait failed:", err);
  }
}

/**
 * Close every popup currently open on the Table.
 *
 * @returns {Promise<void>}
 */
async function _closeAllPopups() {
  if (!isTableUser()) return;
  logger.info("closeAllPopups");
  const s = getState();
  for (const app of [...s.openDisplays]) {
    try {
      await app.close({ animate: false });
    } catch (err) {
      logger.debug("Closing display failed:", err);
    }
  }
  for (const ip of [...s.openImages]) {
    try {
      await ip.close({ animate: false });
    } catch (err) {
      logger.debug("Closing image failed:", err);
    }
  }
  s.openDisplays.clear();
  s.openImages.clear();
  updateBackdrop();
}

// =====================================================================
// Hook registration.
// =====================================================================

/**
 * Filter the AppV2 "pop out" header control on the Table client.
 *
 * @param {object} app
 * @param {Array<{action: string}>} controls
 * @returns {void}
 */
function filterPopoutHeaderControl(app, controls) {
  if (!isTableUser()) return;
  if (!Array.isArray(controls)) return;
  for (let i = controls.length - 1; i >= 0; i--) {
    if (controls[i]?.action === "popout") controls.splice(i, 1);
  }
}

/**
 * Wire socket handlers and the pop-out filter hook.
 *
 * @returns {void}
 */
export function init() {
  getState();
  setHandler("showJournal", _showJournal);
  setHandler("showItem", _showItem);
  setHandler("showImage", _showImage);
  setHandler("showPortrait", _showPortrait);
  setHandler("closeAllPopups", _closeAllPopups);

  Hooks.on("getHeaderControlsApplicationV2", filterPopoutHeaderControl);

  // Expose for console debugging.
  Hooks.once("ready", () => {
    const mod = game.modules?.get?.(MODULE_ID);
    if (mod) {
      mod.api = mod.api ?? {};
      mod.api.openDisplays = () => getState().openDisplays;
      mod.api.openImages = () => getState().openImages;
      mod.api.closeAllPopups = () => _closeAllPopups();
    }
  });
}
