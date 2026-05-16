// Community Screen — pop-up rendering on the Table: journals, items, portraits, images, close-all.

import { BODY_CLASS_MODAL_BG } from "./module.mjs";
import { isTableUser } from "./identity.mjs";
import { get as getSetting } from "./settings.mjs";
import { setHandler } from "./sockets.mjs";
import { sleep } from "./lib/helpers.mjs";
import { logger } from "./lib/logger.mjs";

/**
 * Resolve a uuid to a document, retrying once after a brief wait if the
 * first attempt returns null. The Table client occasionally races ahead
 * of the ownership-grant update that the GM client just performed; the
 * retry covers that propagation window.
 *
 * @param {string} uuid
 * @param {number} [retryMs] - Wait before the second attempt.
 * @returns {Promise<Document | null>}
 */
async function fromUuidWithRetry(uuid, retryMs = 400) {
  try {
    let doc = await fromUuid(uuid);
    if (doc) return doc;
    await sleep(retryMs);
    doc = await fromUuid(uuid);
    if (doc) {
      logger.info(`fromUuid retry succeeded for ${uuid}.`);
    } else {
      logger.warn(`fromUuid retry still null for ${uuid} — check Table user permissions.`);
    }
    return doc ?? null;
  } catch (err) {
    logger.warn(`fromUuid threw for ${uuid}:`, err);
    return null;
  }
}

/**
 * The communityScreen window-namespace state object — tracks open sheets and images
 * so closeAllPopups can hit everything in one pass.
 */
function getState() {
  if (!window.communityScreen) {
    window.communityScreen = { openSheets: new Set(), openImages: new Set() };
  }
  return window.communityScreen;
}

/**
 * Update the modal-backdrop body class based on whether any popup is open
 * and the popup-backdrop setting is enabled.
 *
 * @returns {void}
 */
function updateBackdrop() {
  if (!isTableUser()) return;
  const enabled = getSetting("popup-backdrop", true);
  const state = getState();
  const anyOpen = state.openSheets.size > 0 || state.openImages.size > 0;
  document.body.classList.toggle(BODY_CLASS_MODAL_BG, Boolean(enabled && anyOpen));
}

/**
 * Center an AppV2 / legacy sheet on the viewport at a reasonable size.
 *
 * @param {object} sheet
 * @returns {void}
 */
function centerSheet(sheet) {
  if (!sheet) return;
  try {
    const width = 900;
    const height = 700;
    const left = Math.max(0, Math.floor((window.innerWidth - width) / 2));
    const top = Math.max(0, Math.floor((window.innerHeight - height) / 2));
    if (typeof sheet.setPosition === "function") {
      sheet.setPosition({ left, top, width, height });
    }
  } catch (err) {
    logger.debug("centerSheet failed (non-fatal):", err);
  }
}

/**
 * Track a sheet's lifecycle so closeAllPopups can clean it up, and so the
 * backdrop turns off when the user manually closes it.
 *
 * @param {object} sheet
 * @returns {void}
 */
function trackSheet(sheet) {
  if (!sheet) return;
  const state = getState();
  state.openSheets.add(sheet);
  updateBackdrop();
  const id = sheet.id ?? `community-screen-sheet-${Math.random().toString(36).slice(2, 9)}`;
  const closeName = `close${sheet.constructor?.name ?? "Application"}`;
  Hooks.once(closeName, (app) => {
    if (app !== sheet) return;
    state.openSheets.delete(sheet);
    updateBackdrop();
  });
  // Fallback: also clean up after a generous timeout if the close hook
  // shape doesn't match (different sheet classes).
  Hooks.once("closeApplication", (app) => {
    if (app !== sheet) return;
    state.openSheets.delete(sheet);
    updateBackdrop();
  });
  logger.debug(`Tracking popup sheet ${id}.`);
}

/**
 * Open a Journal on the Table.
 *
 * @param {{uuid: string, pageId?: string}} payload
 * @returns {Promise<void>}
 */
async function _showJournal({ uuid, pageId } = {}) {
  if (!isTableUser()) return;
  logger.info(`showJournal: rendering ${uuid}`);
  try {
    const doc = await fromUuidWithRetry(uuid);
    if (!doc) {
      logger.warn(`showJournal: could not resolve ${uuid} on Table client.`);
      return;
    }
    const sheet = doc.sheet;
    if (!sheet) {
      logger.warn(
        `showJournal: ${doc.documentName} "${doc.name}" has no sheet on Table client (permission?).`,
      );
      return;
    }
    await sheet.render(true);
    centerSheet(sheet);
    trackSheet(sheet);
    if (pageId && typeof sheet.goToPage === "function") {
      try {
        sheet.goToPage(pageId);
      } catch {
        // page not found; ignore
      }
    }
    logger.info(`showJournal: rendered "${doc.name}".`);
  } catch (err) {
    logger.warn("showJournal failed:", err);
  }
}

/**
 * Open an Item sheet on the Table.
 *
 * @param {{uuid: string}} payload
 * @returns {Promise<void>}
 */
async function _showItem({ uuid } = {}) {
  if (!isTableUser()) return;
  logger.info(`showItem: rendering ${uuid}`);
  try {
    const item = await fromUuidWithRetry(uuid);
    const sheet = item?.sheet;
    if (!sheet) {
      logger.warn(`showItem: ${uuid} not resolvable on Table client (permission?).`);
      return;
    }
    await sheet.render(true);
    centerSheet(sheet);
    trackSheet(sheet);
    logger.info(`showItem: rendered "${item.name}".`);
  } catch (err) {
    logger.warn("showItem failed:", err);
  }
}

/**
 * Open an ImagePopout on the Table.
 *
 * @param {{src: string, caption?: string}} payload
 * @returns {Promise<void>}
 */
async function _showImage({ src, caption } = {}) {
  if (!isTableUser()) return;
  if (!src) return;
  try {
    const ImagePopoutCls = foundry?.applications?.apps?.ImagePopout ?? globalThis.ImagePopout;
    if (!ImagePopoutCls) {
      logger.error("No ImagePopout class available.");
      return;
    }
    const ip = new ImagePopoutCls(src, {
      title: caption ?? "",
      shareable: false,
    });
    await ip.render(true);
    const state = getState();
    state.openImages.add(ip);
    updateBackdrop();

    // Track close
    const cleanup = (app) => {
      if (app !== ip) return;
      state.openImages.delete(ip);
      updateBackdrop();
    };
    Hooks.once("closeImagePopout", cleanup);
    Hooks.once("closeApplication", cleanup);
  } catch (err) {
    logger.warn("showImage failed:", err);
  }
}

/**
 * Open an actor's portrait image on the Table.
 *
 * @param {{actorUuid: string}} payload
 * @returns {Promise<void>}
 */
async function _showPortrait({ actorUuid } = {}) {
  if (!isTableUser()) return;
  logger.info(`showPortrait: ${actorUuid}`);
  try {
    const actor = await fromUuidWithRetry(actorUuid);
    const img = actor?.img;
    if (!img) {
      logger.warn(`showPortrait: ${actorUuid} has no img or actor not resolvable.`);
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
  const state = getState();
  for (const sheet of [...state.openSheets]) {
    try {
      await sheet.close({ animate: false });
    } catch (err) {
      logger.debug("Closing sheet failed:", err);
    }
  }
  for (const img of [...state.openImages]) {
    try {
      await img.close({ animate: false });
    } catch (err) {
      logger.debug("Closing image failed:", err);
    }
  }
  state.openSheets.clear();
  state.openImages.clear();
  updateBackdrop();
}

/**
 * Filter the AppV2 "pop out" header button on the Table client.
 *
 * @param {object} app - The application.
 * @param {Array<{action: string}>} controls - Header controls array (mutable).
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
}
