// Community Screen — mirrors GM scene changes and Scene Levels view changes to the Table client.

import { isGM, isTableUser, getTableUserId, isTableOnline } from "./identity.mjs";
import { executeAsUser, setHandler } from "./sockets.mjs";
import { logger } from "./lib/logger.mjs";

/** @type {number | null} */
let lastBroadcastLevel = null;

/**
 * Table-side: open a scene by id.
 *
 * @param {{sceneId: string}} payload
 * @returns {Promise<void>}
 */
async function _followScene({ sceneId } = {}) {
  if (!isTableUser()) return;
  try {
    const scene = game.scenes?.get(sceneId);
    if (!scene) return;
    if (scene.id === canvas?.scene?.id) return;
    await scene.view();
  } catch (err) {
    logger.warn("followScene failed:", err);
  }
}

/**
 * Table-side: switch viewed level inside the current scene.
 *
 * @param {{sceneId: string, level: number}} payload
 * @returns {Promise<void>}
 */
async function _followLevel({ sceneId, level } = {}) {
  if (!isTableUser()) return;
  if (canvas?.scene?.id !== sceneId) return;
  if (typeof level !== "number") return;
  try {
    if (typeof canvas.viewLevel === "function") {
      await canvas.viewLevel(level);
    } else {
      logger.debug("canvas.viewLevel not available; skipping level mirror.");
    }
  } catch (err) {
    logger.warn("followLevel failed:", err);
  }
}

/**
 * GM-side: mirror current scene/level to the Table.
 *
 * @returns {Promise<void>}
 */
async function broadcastSceneAndLevel() {
  if (!isGM()) return;
  if (!isTableOnline()) return;
  const tableId = getTableUserId();
  if (!tableId) return;
  const sceneId = canvas?.scene?.id;
  if (!sceneId) return;
  try {
    await executeAsUser("followScene", tableId, { sceneId });
  } catch (err) {
    logger.debug("broadcast followScene failed:", err);
  }
  const level = canvas?.viewedLevel;
  if (typeof level === "number" && level !== lastBroadcastLevel) {
    lastBroadcastLevel = level;
    try {
      await executeAsUser("followLevel", tableId, { sceneId, level });
    } catch (err) {
      logger.debug("broadcast followLevel failed:", err);
    }
  }
}

/**
 * Register socket handlers and GM-side canvasReady hook.
 *
 * @returns {void}
 */
export function init() {
  setHandler("followScene", _followScene);
  setHandler("followLevel", _followLevel);

  Hooks.on("canvasReady", () => {
    if (!isGM()) return;
    broadcastSceneAndLevel();
  });
}
