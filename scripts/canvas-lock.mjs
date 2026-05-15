// Community Screen — canvas pan/zoom lock for the Table client via libWrapper and capture wheel.

import { MODULE_ID, BODY_CLASS_LOCKED } from "./module.mjs";
import { logger } from "./lib/logger.mjs";

/** @type {boolean} */
let locked = false;

/** @type {{x:number,y:number,scale:number} | null} */
let target = null;

/**
 * Capture-phase wheel handler that swallows scroll-zoom on the Table.
 *
 * @param {WheelEvent} e
 * @returns {void}
 */
function blockWheel(e) {
  e.stopPropagation();
  e.preventDefault();
}

/**
 * @returns {boolean} True if the lock is engaged.
 */
export function isLocked() {
  return locked;
}

/**
 * Engage the canvas lock: block wheel events, override Canvas.pan and
 * Canvas.animatePan via libWrapper, and add the locked body class.
 *
 * Idempotent — calling while already engaged is a no-op.
 *
 * @returns {void}
 */
export function engageLock() {
  if (locked) return;
  if (!globalThis.libWrapper) {
    logger.error("libWrapper is not available — canvas lock cannot engage.");
    return;
  }
  try {
    target = {
      x: canvas?.stage?.pivot?.x ?? 0,
      y: canvas?.stage?.pivot?.y ?? 0,
      scale: canvas?.stage?.scale?.x ?? 1,
    };
    document
      .getElementById("board")
      ?.addEventListener("wheel", blockWheel, { capture: true, passive: false });
    libWrapper.register(MODULE_ID, "Canvas.prototype.pan", () => {}, "OVERRIDE");
    libWrapper.register(
      MODULE_ID,
      "Canvas.prototype.animatePan",
      () => Promise.resolve(),
      "OVERRIDE",
    );
    document.body.classList.add(BODY_CLASS_LOCKED);
    locked = true;
    logger.debug("Canvas lock engaged.", target);
  } catch (err) {
    logger.error("engageLock failed:", err);
  }
}

/**
 * Disengage the canvas lock: remove wheel listener, unregister libWrapper
 * overrides, and remove the locked body class.
 *
 * Idempotent — calling while not engaged is a no-op.
 *
 * @returns {void}
 */
export function disengageLock() {
  if (!locked) return;
  try {
    document.getElementById("board")?.removeEventListener("wheel", blockWheel, { capture: true });
    if (globalThis.libWrapper) {
      try {
        libWrapper.unregister(MODULE_ID, "Canvas.prototype.pan");
      } catch {
        // already unregistered
      }
      try {
        libWrapper.unregister(MODULE_ID, "Canvas.prototype.animatePan");
      } catch {
        // already unregistered
      }
    }
    document.body.classList.remove(BODY_CLASS_LOCKED);
    locked = false;
    logger.debug("Canvas lock disengaged.");
  } catch (err) {
    logger.error("disengageLock failed:", err);
  }
}

/**
 * Run a function while the lock is temporarily disengaged, then re-engage
 * (only if it was engaged before). Use this to bracket programmatic pans.
 *
 * @template T
 * @param {() => Promise<T> | T} fn - Work to perform while unlocked.
 * @returns {Promise<T>}
 */
export async function withUnlocked(fn) {
  const wasLocked = locked;
  if (wasLocked) disengageLock();
  try {
    return await fn();
  } finally {
    if (wasLocked) engageLock();
  }
}
