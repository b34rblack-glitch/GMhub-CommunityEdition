// ============================================================================
// scripts/scene-follow.mjs
// ----------------------------------------------------------------------------
// Mirror GM scene changes and Scene Levels view changes to the Table client.
//
// Foundry doesn't auto-broadcast "the GM looked at a different scene" to
// other clients — the GM's nav-bar click only switches their own view. We
// hook canvasReady on the GM client and socket the new scene id to the
// Table so the Table follows along.
//
// Scene Levels (v14 feature) is handled the same way but via canvas.viewedLevel
// + canvas.viewLevel() — feature-detected because v14's level-changing API
// has been evolving across point releases.
// ============================================================================

import { isGM, isTableUser, getTableUserId, isTableOnline } from "./identity.mjs";
import { executeAsUser, setHandler } from "./sockets.mjs";
import { logger } from "./lib/logger.mjs";

/** @type {number | null} Last level we broadcast; used to debounce duplicate follow-level emits. */
let lastBroadcastLevel = null;

/**
 * Table-side: open a scene by id.
 *
 * @param {{sceneId: string}} payload
 * @returns {Promise<void>}
 */
async function _followScene({ sceneId } = {}) {
  // Only the Table client should react.
  if (!isTableUser()) return;
  try {
    // Look up the scene in this client's local collection.
    const scene = game.scenes?.get(sceneId);
    if (!scene) return;
    // Avoid the redundant render if we're already viewing the target scene.
    if (scene.id === canvas?.scene?.id) return;
    // scene.view() is async — await so callers can sequence properly.
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
  // Don't follow a level change if we're not on the right scene (e.g.
  // followLevel arrived before followScene).
  if (canvas?.scene?.id !== sceneId) return;
  // Defensive: ignore bad payloads.
  if (typeof level !== "number") return;
  try {
    // canvas.viewLevel is the v14 API; not present in older Foundry.
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
  // Don't waste socket traffic if the Table isn't connected.
  if (!isTableOnline()) return;
  const tableId = getTableUserId();
  if (!tableId) return;
  const sceneId = canvas?.scene?.id;
  // Bail if the canvas isn't ready (no active scene).
  if (!sceneId) return;
  try {
    // Always send followScene — the Table-side handler is idempotent.
    await executeAsUser("followScene", tableId, { sceneId });
  } catch (err) {
    logger.debug("broadcast followScene failed:", err);
  }
  // Scene Levels: only re-emit when the level actually changed (debounce).
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
  // Receiver-side handlers (every client; only the Table actually acts).
  setHandler("followScene", _followScene);
  setHandler("followLevel", _followLevel);

  // GM-side trigger: any time the canvas comes up (scene change, reload,
  // scene-edit save) we re-mirror to the Table. No dedicated v14 levelChange
  // hook exists yet, so canvasReady doubles as our level-change detector.
  Hooks.on("canvasReady", () => {
    if (!isGM()) return;
    broadcastSceneAndLevel();
  });
}
