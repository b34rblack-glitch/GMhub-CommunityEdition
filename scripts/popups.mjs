// Community Screen — push display on the Table client.
//
// Design (Foundry v14):
// Previous iterations tried to ship rendered HTML over socketlib and
// render a custom ApplicationV2 on the Table. That worked in principle
// but proved fragile across systems and v14 sheet variants.
//
// This version uses Foundry's NATIVE share mechanisms — the same paths
// the "Show to Players" right-click action uses — and only owns the
// CLOSE side. Pattern adapted from `gsimon2/close-player-art`, which
// has been the de-facto reference for "close shared art across all
// clients" and is v12-verified; the same instance/DOM-walk close
// strategy works just as well in v14 against `foundry.applications.
// instances` and the legacy `ui.windows` collection.
//
// What's native:
//   - Journals  → `JournalEntry.prototype.show(true, [tableUser])`
//   - Items     → `ImagePopout.shareImage({image, title, caption}, [id])`
//                 (Foundry's own ImagePopout, with the description in
//                  the caption; items have no `.show()` in core.)
//   - Portraits → `ImagePopout.shareImage({image: actor.img, title}, [id])`
//   - Raw image → `ImagePopout.shareImage({image: src, title}, [id])`
//
// What's our own:
//   - Close all: socketlib RPC to the Table, which walks
//     `foundry.applications.instances` and closes every active
//     ImagePopout / JournalSheet / JournalEntrySheet. Plus an AppV1
//     `ui.windows` fallback for legacy sheets.

import { MODULE_ID, BODY_CLASS_MODAL_BG } from "./module.mjs";
import { isTableUser } from "./identity.mjs";
import { get as getSetting } from "./settings.mjs";
import { setHandler } from "./sockets.mjs";
import { logger } from "./lib/logger.mjs";

/**
 * Foundry application class names we consider "shareable popouts" for the
 * purposes of close-all. Substring match against the constructor name so
 * we catch system-specific subclasses (e.g. `JournalEntrySheetPF2e`).
 *
 * @type {string[]}
 */
const POPOUT_CLASS_PATTERNS = [
  "ImagePopout",
  "JournalSheet",
  "JournalEntrySheet",
  "JournalEntryPageSheet",
  "JournalTextPageSheet",
  "JournalImagePageSheet",
  "JournalVideoPageSheet",
  "JournalPDFPageSheet",
  "ItemSheet",
  "ActorSheet",
];

/**
 * Class names we will NEVER close even if they match the patterns above
 * (defense-in-depth — the Table client shouldn't have anything besides
 * the canvas open, but if a settings dialog or chat window happens to
 * be open we don't want to nuke it).
 *
 * @type {string[]}
 */
const POPOUT_EXCLUDE_PATTERNS = [
  "Settings",
  "Sidebar",
  "Configure",
  "Notifications",
  "ControlPalette",
];

/**
 * Toggle the canvas-dim body class based on whether any popout is open
 * AND the `popup-backdrop` setting is enabled. Walks Foundry's own
 * application registries — no internal tracking needed.
 *
 * @returns {void}
 */
function updateBackdrop() {
  if (!isTableUser()) return;
  const enabled = getSetting("popup-backdrop", true);
  document.body.classList.toggle(BODY_CLASS_MODAL_BG, Boolean(enabled && countOpenPopouts() > 0));
}

/**
 * @returns {number} Total number of popout-like applications currently open.
 */
function countOpenPopouts() {
  let n = 0;
  // v14 AppV2 instances live here.
  const instances = foundry.applications?.instances;
  if (instances && typeof instances.values === "function") {
    for (const app of instances.values()) {
      if (isPopoutLike(app)) n++;
    }
  }
  // Legacy AppV1 instances live in ui.windows.
  for (const app of Object.values(ui?.windows ?? {})) {
    if (isPopoutLike(app)) n++;
  }
  return n;
}

/**
 * @param {object} app
 * @returns {boolean}
 */
function isPopoutLike(app) {
  const name = app?.constructor?.name ?? "";
  if (!name) return false;
  if (POPOUT_EXCLUDE_PATTERNS.some((p) => name.includes(p))) return false;
  return POPOUT_CLASS_PATTERNS.some((p) => name.includes(p));
}

/**
 * Permissive fallback — treat anything that looks like a floating window
 * (has a position and a constructor whose name doesn't match the exclude
 * list) as closable. Only used after the strict match returns zero hits.
 *
 * @param {object} app
 * @returns {boolean}
 */
function isAnyWindowApp(app) {
  const name = app?.constructor?.name ?? "";
  if (!name) return false;
  if (POPOUT_EXCLUDE_PATTERNS.some((p) => name.includes(p))) return false;
  // AppV2 always has a .window object; AppV1 has .options.popOut.
  const isAppV2 = !!app?.window;
  const isAppV1Popout = app?.options?.popOut === true;
  return isAppV2 || isAppV1Popout;
}

/**
 * Schedule a re-evaluation of the backdrop on the next animation frame.
 * Called by hook listeners that fire when popouts open/close — we don't
 * know the exact state synchronously so just re-walk the registries.
 */
function scheduleBackdropUpdate() {
  if (!isTableUser()) return;
  requestAnimationFrame(updateBackdrop);
}

// =====================================================================
// Socket handlers. The Table client is the receiver for closeAllPopups;
// the other push handlers exist for backwards compatibility but route to
// Foundry's native share when invoked.
// =====================================================================

/**
 * Close every shareable popout currently rendered on the Table client.
 *
 * @returns {Promise<void>}
 */
async function _closeAllPopups() {
  if (!isTableUser()) return;
  logger.info("closeAllPopups — walking foundry.applications.instances + ui.windows");

  const allApps = [];
  const instances = foundry.applications?.instances;
  if (instances && typeof instances.values === "function") {
    for (const app of instances.values()) allApps.push(app);
  }
  for (const app of Object.values(ui?.windows ?? {})) allApps.push(app);

  // Dump every candidate's constructor name so close failures are
  // diagnosable from the Table console.
  logger.info(
    "closeAllPopups candidates:",
    allApps.map((a) => a?.constructor?.name).filter(Boolean),
  );

  // Strict pass: anything matching the known popout patterns.
  let toClose = allApps.filter(isPopoutLike);

  // Permissive fallback: if the strict pass found nothing, close any
  // floating window. Better to close a stray sheet than to leave the
  // Table screen with an open popup the GM can't get rid of.
  if (toClose.length === 0) {
    toClose = allApps.filter(isAnyWindowApp);
    if (toClose.length > 0) {
      logger.info(
        `closeAllPopups: strict match found 0; using permissive fallback (${toClose.length}).`,
      );
    }
  }

  let closed = 0;
  for (const app of toClose) {
    try {
      await app.close({ animate: false });
      closed++;
    } catch (err) {
      logger.warn(`close failed for ${app?.constructor?.name}:`, err);
    }
  }

  scheduleBackdropUpdate();
  logger.info(`closeAllPopups: closed ${closed} of ${toClose.length} popout(s).`);
}

/**
 * Render an image via Foundry's native ImagePopout. URL-based, no document
 * dependency, no permission check on the Table side.
 *
 * @param {{src: string, caption?: string, title?: string}} payload
 * @returns {Promise<void>}
 */
async function _showImage({ src, caption, title } = {}) {
  if (!isTableUser()) return;
  if (!src) return;
  logger.info(`showImage: ${src}`);
  try {
    const ImagePopoutCls = foundry?.applications?.apps?.ImagePopout ?? globalThis.ImagePopout;
    if (!ImagePopoutCls) {
      logger.error("No ImagePopout class available on Table client.");
      return;
    }
    const ip = new ImagePopoutCls(src, { title: title ?? caption ?? "", shareable: false });
    await ip.render(true);
    scheduleBackdropUpdate();
  } catch (err) {
    logger.warn("showImage failed:", err);
  }
}

/**
 * Backwards-compat: older push payloads sent `actorUuid` and expected the
 * Table to resolve it. New GM-side code ships the image URL directly via
 * `showImage`. This handler is kept so a mid-update GM client still works.
 *
 * @param {{src?: string, caption?: string, actorUuid?: string}} payload
 * @returns {Promise<void>}
 */
async function _showPortrait({ src, caption, actorUuid } = {}) {
  if (!isTableUser()) return;
  if (src) return _showImage({ src, caption });
  // Fallback for legacy callers.
  try {
    const actor = actorUuid ? await fromUuid(actorUuid) : null;
    const img = actor?.img;
    if (!img) {
      logger.warn(`showPortrait: no src and ${actorUuid} not resolvable.`);
      return;
    }
    await _showImage({ src: img, caption: actor.name });
  } catch (err) {
    logger.warn("showPortrait failed:", err);
  }
}

/**
 * Backwards-compat journal/item handlers.
 *
 * In v0.1.5+, the GM client uses Foundry's native `JournalEntry.show()`
 * and `ImagePopout.shareImage()` to push journals and items respectively
 * — those go through Foundry's own socket plumbing, NOT through socketlib
 * to these handlers. These remain registered so a GM client running an
 * older module version against a Table client running the new code still
 * sees something happen.
 *
 * @param {{title?: string, html?: string}} payload
 * @returns {Promise<void>}
 */
async function _showJournal({ title, html } = {}) {
  if (!isTableUser()) return;
  logger.info(`showJournal (legacy compat path): "${title}"`);
  await _renderInlineHtml({ title, html });
}

/**
 * @param {{title?: string, html?: string}} payload
 * @returns {Promise<void>}
 */
async function _showItem({ title, html } = {}) {
  if (!isTableUser()) return;
  logger.info(`showItem (legacy compat path): "${title}"`);
  await _renderInlineHtml({ title, html });
}

/**
 * Render a generic ApplicationV2 with inline HTML — used only for the
 * legacy push payloads above.
 *
 * @param {{title?: string, html?: string}} data
 * @returns {Promise<void>}
 */
async function _renderInlineHtml(data) {
  try {
    const cls = makeInlineHtmlClass();
    const app = new cls(data);
    await app.render(true);
    scheduleBackdropUpdate();
  } catch (err) {
    logger.warn("inline HTML render failed:", err);
  }
}

let _inlineHtmlClass = null;
function makeInlineHtmlClass() {
  if (_inlineHtmlClass) return _inlineHtmlClass;
  _inlineHtmlClass = class CommunityScreenInlineHtml extends (
    foundry.applications.api.HandlebarsApplicationMixin(foundry.applications.api.ApplicationV2)
  ) {
    static DEFAULT_OPTIONS = {
      classes: ["community-screen", "community-screen-display"],
      tag: "section",
      window: { icon: "fa-solid fa-tv", resizable: true, minimizable: false },
      position: { width: 900, height: 700 },
    };
    static PARTS = {
      main: { template: `modules/${MODULE_ID}/templates/popup-display.hbs` },
    };
    constructor(data, options = {}) {
      super(
        foundry.utils.mergeObject(
          { window: { title: data?.title || "Community Screen" } },
          options,
        ),
      );
      this._csData = data ?? {};
    }
    async _prepareContext() {
      return {
        title: this._csData.title || "",
        subtitle: this._csData.subtitle || "",
        html: this._csData.html || "",
      };
    }
  };
  return _inlineHtmlClass;
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
 * Wire socket handlers and popout-tracking hooks.
 *
 * @returns {void}
 */
export function init() {
  setHandler("showJournal", _showJournal);
  setHandler("showItem", _showItem);
  setHandler("showImage", _showImage);
  setHandler("showPortrait", _showPortrait);
  setHandler("closeAllPopups", _closeAllPopups);

  Hooks.on("getHeaderControlsApplicationV2", filterPopoutHeaderControl);

  // Update the backdrop when any AppV2 / AppV1 renders or closes — covers
  // both Foundry-native shares and the inline-HTML fallback path. Same
  // detection (isPopoutLike) is used inside updateBackdrop so we don't
  // re-class anything here.
  Hooks.on("renderApplicationV2", scheduleBackdropUpdate);
  Hooks.on("closeApplicationV2", scheduleBackdropUpdate);
  Hooks.on("renderApplication", scheduleBackdropUpdate); // legacy AppV1
  Hooks.on("closeApplication", scheduleBackdropUpdate);

  // Console fallbacks.
  Hooks.once("ready", () => {
    const mod = game.modules?.get?.(MODULE_ID);
    if (mod) {
      mod.api = mod.api ?? {};
      mod.api.closeAllPopups = () => _closeAllPopups();
      mod.api.countOpenPopouts = () => countOpenPopouts();
    }
  });
}
