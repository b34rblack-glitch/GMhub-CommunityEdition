// ============================================================================
// scripts/canvas-lock.mjs
// ----------------------------------------------------------------------------
// Canvas pan/zoom lock for the Table client.
//
// Three layers of defense against the canvas being moved:
//   1. A capture-phase `wheel` listener on `#board` that swallows scroll
//      events before they reach PIXI's mousewheel handler.
//   2. libWrapper OVERRIDE on `Canvas.prototype.pan` and `animatePan` so
//      programmatic pans from other code (including Foundry core's own
//      auto-pan on Token.control()) become no-ops.
//   3. The `community-screen-locked` body class for any CSS-level hooks
//      (we use it to neutralize cursor changes).
//
// The lock is INTENDED to be temporarily disengaged for the module's own
// programmatic pans — see `withUnlocked()` which brackets a function call
// with disengage/engage. Always use that helper rather than calling
// `engageLock` / `disengageLock` manually.
//
// libWrapper is a hard dependency (declared in module.json relationships).
// ============================================================================

import { MODULE_ID, BODY_CLASS_LOCKED } from "./module.mjs";
import { logger } from "./lib/logger.mjs";

/** @type {boolean} Whether the lock is currently engaged. */
let locked = false;

/** @type {{x:number,y:number,scale:number} | null} Captured pivot/scale at engage time. */
let target = null;

/**
 * Capture-phase wheel handler that swallows scroll-zoom on the Table.
 * Returning nothing isn't enough — we need preventDefault to stop the
 * browser-level zoom and stopPropagation to keep PIXI from seeing it.
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
  // No-op if already locked.
  if (locked) return;
  // libWrapper is a hard dep but module load order edge cases happen.
  if (!globalThis.libWrapper) {
    logger.error("libWrapper is not available — canvas lock cannot engage.");
    return;
  }
  try {
    // Snapshot the current viewport state so a future disengage can
    // restore it if needed (currently informational; not yet restored).
    target = {
      x: canvas?.stage?.pivot?.x ?? 0,
      y: canvas?.stage?.pivot?.y ?? 0,
      scale: canvas?.stage?.scale?.x ?? 1,
    };
    // Capture-phase listener so we see wheel events before PIXI does.
    document
      .getElementById("board")
      ?.addEventListener("wheel", blockWheel, { capture: true, passive: false });
    // Replace Canvas.pan with a no-op so any caller's pan attempt fails silently.
    libWrapper.register(MODULE_ID, "Canvas.prototype.pan", () => {}, "OVERRIDE");
    // Replace animatePan with a resolved promise so awaiters don't hang.
    libWrapper.register(
      MODULE_ID,
      "Canvas.prototype.animatePan",
      () => Promise.resolve(),
      "OVERRIDE",
    );
    // CSS hook: lets stylesheets target the locked state.
    document.body.classList.add(BODY_CLASS_LOCKED);
    locked = true;
    logger.debug("Canvas lock engaged.", target);
  } catch (err) {
    // Don't leave half-engaged state lying around — the next attempt will retry.
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
  // No-op if already unlocked.
  if (!locked) return;
  try {
    // Remove our capture-phase listener so wheel events flow normally again.
    document.getElementById("board")?.removeEventListener("wheel", blockWheel, { capture: true });
    if (globalThis.libWrapper) {
      // Unregister both overrides — wrap in try/catch since libWrapper
      // throws if the name isn't registered (which can happen if engage
      // partially failed).
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
    // Drop the CSS marker.
    document.body.classList.remove(BODY_CLASS_LOCKED);
    locked = false;
    logger.debug("Canvas lock disengaged.");
  } catch (err) {
    logger.error("disengageLock failed:", err);
  }
}

/**
 * Run a function while the lock is temporarily disengaged, then re-engage
 * (only if it was engaged before). Use this to bracket programmatic pans
 * so the lock doesn't fight your own code.
 *
 * @template T
 * @param {() => Promise<T> | T} fn - Work to perform while unlocked.
 * @returns {Promise<T>} Whatever `fn` returned.
 */
export async function withUnlocked(fn) {
  // Remember the pre-call state so a no-op disengage is correctly skipped.
  const wasLocked = locked;
  if (wasLocked) disengageLock();
  try {
    // Await so async work finishes BEFORE we re-engage the lock.
    return await fn();
  } finally {
    // Always re-engage, even if fn threw — symmetry matters here.
    if (wasLocked) engageLock();
  }
}
