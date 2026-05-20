// ============================================================================
// scripts/popups.mjs
// ----------------------------------------------------------------------------
// Push-display receiver on the Table client.
//
// What's native:
//   - Journals  → `JournalEntry.prototype.show(true, [tableUser])` (GM-side
//                 in push-buttons.mjs)
//   - Items     → `executeAsUser("showImage", tableId, {src, title, caption})`
//                 (GM-side ships the item's image + plain-text description
//                 caption; we open ImagePopout locally)
//   - Portraits → same `showImage` socket path
//   - Raw image → same `showImage` socket path
//
// What's our own — Close All:
//   socketlib RPC to the Table iterates `foundry.applications.instances`
//   (v14 AppV2 registry) and `ui.windows` (legacy v1 registry), and for
//   each non-excluded popout tries three close strategies in order:
//
//     1. Click `app.window.close` — Foundry's own HTMLButtonElement
//        reference to the X button in the window header. This is the
//        most reliable path on v14 because it goes through Foundry's
//        normal click handler.
//     2. querySelector inside `app.element` for any close-shaped
//        button (covers legacy v1 sheets and any AppV2 variant that
//        doesn't expose `.window.close` for some reason).
//     3. Fall back to `app.close({ animate: false })`.
//
//   Excluded apps (the GM control palette, settings/configuration
//   dialogs, notification toasts, sidebar tabs) are skipped by
//   constructor-name pattern. Every closed / skipped / failed app is
//   logged at info level so a GM can paste the Table console output
//   when something doesn't close.
// ============================================================================

import { MODULE_ID, BODY_CLASS_MODAL_BG } from "./module.mjs";
import { isTableUser } from "./identity.mjs";
import { get as getSetting } from "./settings.mjs";
import { setHandler } from "./sockets.mjs";
import { logger } from "./lib/logger.mjs";

/**
 * Class-name substrings we will NEVER auto-close — even if the
 * registry walk picks them up. Used by both the close-all walk and
 * the backdrop tracker. Substring match against `app.constructor.name`
 * so we catch system subclasses.
 *
 * @type {string[]}
 */
const POPOUT_EXCLUDE_PATTERNS = [
  "Settings",
  "Sidebar",
  "Configure",
  "Notifications",
  "ControlPalette",
  // Combat tracker (sidebar + popout variants).
  "Combat",
  // Toast notifications.
  "Notification",
];

/**
 * Toggle the canvas-dim body class based on whether any popout is open
 * AND the `popup-backdrop` setting is enabled. Walks Foundry's own
 * application registries — no internal tracking needed.
 *
 * @returns {void}
 */
function updateBackdrop() {
  // Only the Table client renders the dim overlay.
  if (!isTableUser()) return;
  // Honor the world setting.
  const enabled = getSetting("popup-backdrop", true);
  // Toggle (don't add/remove conditionally — toggle is one DOM op).
  document.body.classList.toggle(BODY_CLASS_MODAL_BG, Boolean(enabled && countOpenPopouts() > 0));
}

/**
 * @returns {number} Total number of popout-like applications currently open.
 */
function countOpenPopouts() {
  let n = 0;
  // v14 AppV2 instances live in this Map (keyed by app id).
  const instances = foundry.applications?.instances;
  if (instances && typeof instances.values === "function") {
    for (const app of instances.values()) {
      if (isPopoutLike(app)) n++;
    }
  }
  // Legacy AppV1 instances live in ui.windows (keyed by app id).
  for (const app of Object.values(ui?.windows ?? {})) {
    if (isPopoutLike(app)) n++;
  }
  return n;
}

/**
 * Permissive popout test. Returns true for any rendered, floating
 * window-app on the client whose constructor name doesn't match the
 * exclude list. We deliberately avoid class-name include matching —
 * Foundry / system subclasses can name sheets anything they like
 * (`JournalEntrySheet`, `JournalEntrySheetPF2e`, future sheet variants),
 * and any include list will drift out of date.
 *
 * AppV2 always has a `.window` object; legacy AppV1 popouts have
 * `options.popOut === true`. Either is sufficient.
 *
 * @param {object} app
 * @returns {boolean}
 */
function isPopoutLike(app) {
  if (!app) return false;
  const name = app.constructor?.name ?? "";
  // Defensive: minified or anonymous classes may lack a name.
  if (!name) return false;
  if (POPOUT_EXCLUDE_PATTERNS.some((p) => name.includes(p))) return false;
  const isAppV2 = !!app.window;
  const isAppV1Popout = app.options?.popOut === true;
  return isAppV2 || isAppV1Popout;
}

/**
 * Schedule a re-evaluation of the backdrop on the next animation frame.
 * Called by hook listeners that fire when popouts open/close — we don't
 * know the exact state synchronously so just re-walk the registries.
 */
function scheduleBackdropUpdate() {
  if (!isTableUser()) return;
  // RAF coalesces multiple hook fires in the same frame into one update.
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
 * Approach (Foundry v14):
 *   AppV2 instances expose `.window.close` — a direct reference to the
 *   close button HTMLButtonElement. We iterate
 *   `foundry.applications.instances` and synthesize a `.click()` on
 *   each app's own close-button reference. This goes through Foundry's
 *   regular close handler exactly as if the user pressed the X, and
 *   doesn't depend on:
 *     - guessing CSS selectors (different across v13/v14/system mods)
 *     - the application's `.close()` method actually closing the DOM
 *       (which is the failure mode we hit in v0.1.7 / v0.1.8)
 *
 *   For each app, we fall back through three close strategies in order:
 *     1. Click `app.window.close` (AppV2 button reference)
 *     2. Click any close-shaped button inside `app.element` (covers v1
 *        sheets and odd AppV2 variants that don't expose `.window.close`)
 *     3. Call `await app.close({ animate: false })` (last resort)
 *
 *   Excluded apps (the GM control palette, settings/configuration
 *   dialogs, notification toasts) are skipped by constructor-name match.
 *
 *   Every closed/skipped/failed app is logged so failures are diagnosable
 *   from the Table console.
 *
 * @returns {Promise<void>}
 */
async function _closeAllPopups() {
  if (!isTableUser()) return;
  logger.info("closeAllPopups: starting on Table client.");

  // Collect every app instance from both registries. Use a Set to dedupe
  // in case an app shows up in both for some reason.
  const allApps = new Set();
  const instances = foundry.applications?.instances;
  if (instances && typeof instances.values === "function") {
    for (const app of instances.values()) allApps.add(app);
  }
  for (const app of Object.values(ui?.windows ?? {})) allApps.add(app);

  let closed = 0;
  const closedNames = [];
  const skippedNames = [];
  const failedNames = [];

  for (const app of allApps) {
    if (!app) continue;
    const name = app.constructor?.name ?? "(anonymous)";

    // Skip excluded apps — control palette, settings, etc.
    if (POPOUT_EXCLUDE_PATTERNS.some((p) => name.includes(p))) {
      skippedNames.push(name);
      continue;
    }

    // Skip apps that are explicitly minimized — closing those can trigger
    // confirmation paths in some legacy v1 sheets.
    if (app.minimized === true) {
      skippedNames.push(`${name}(min)`);
      continue;
    }

    const ok = await closeOneApp(app, name);
    if (ok) {
      closed++;
      closedNames.push(name);
    } else {
      failedNames.push(name);
    }
  }

  logger.info(`closeAllPopups: closed ${closed}/${allApps.size}.`, {
    closed: closedNames,
    skipped: skippedNames,
    failed: failedNames,
  });
  // Recompute the backdrop after Foundry's async close handlers run.
  scheduleBackdropUpdate();
}

/**
 * Try to close a single Foundry application via the most reliable
 * strategy that applies. Returns true on apparent success.
 *
 * @param {object} app  - Foundry ApplicationV1 or V2 instance.
 * @param {string} name - Constructor name, for logging.
 * @returns {Promise<boolean>}
 */
async function closeOneApp(app, name) {
  // Strategy 1: AppV2 stores its close-button HTMLButtonElement at
  // `app.window.close`. Clicking it triggers Foundry's own close
  // handler — the most reliable path on v14.
  const btn = app.window?.close;
  if (btn && typeof btn.click === "function") {
    try {
      btn.click();
      return true;
    } catch (err) {
      logger.warn(`window.close.click() failed for ${name}:`, err);
    }
  }

  // Strategy 2: try to find a close button in the app's DOM tree
  // ourselves. Covers legacy AppV1 (.close link) and any AppV2 variant
  // that doesn't expose `.window.close`.
  const root = app.element instanceof HTMLElement ? app.element : app.element?.[0];
  if (root) {
    const fallbackBtn = root.querySelector(
      'button[data-action="close"], a.header-button.close, a.close',
    );
    if (fallbackBtn) {
      try {
        fallbackBtn.click();
        return true;
      } catch (err) {
        logger.warn(`element close-button click failed for ${name}:`, err);
      }
    }
  }

  // Strategy 3: fall back to the app's `.close()` method.
  try {
    await app.close({ animate: false });
    return true;
  } catch (err) {
    logger.warn(`close() failed for ${name}:`, err);
    return false;
  }
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
  // Defensive: src is the only thing we actually need. If a push
  // arrived without one, log loudly — that's a sender-side bug we'd
  // rather surface than hide.
  if (!src) {
    logger.warn(`showImage: ignoring push with empty src (title="${title}")`);
    return;
  }
  logger.info(`showImage: ${src}`);
  try {
    // v14 namespace; fall back to legacy global for resilience.
    const ImagePopoutCls = foundry?.applications?.apps?.ImagePopout ?? globalThis.ImagePopout;
    if (!ImagePopoutCls) {
      logger.error("No ImagePopout class available on Table client.");
      return;
    }
    // shareable=false hides the "share with others" header button — this
    // popup is already a share; we don't want re-share buttons.
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
  // Modern callers send src directly — route to _showImage.
  if (src) return _showImage({ src, caption });
  // Fallback for legacy callers that only sent actorUuid.
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
 * and our `showImage` socket path for items respectively — those go
 * through Foundry's own socket plumbing or our `showImage`, NOT through
 * socketlib to these handlers. These remain registered so a GM client
 * running an older module version against a Table client running the
 * new code still sees something happen.
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
    // Lazy-class so we only touch foundry.applications.* when actually used.
    const cls = makeInlineHtmlClass();
    const app = new cls(data);
    await app.render(true);
    scheduleBackdropUpdate();
  } catch (err) {
    logger.warn("inline HTML render failed:", err);
  }
}

/** Lazy-instantiated inline-HTML AppV2 class. Built only on first use. */
let _inlineHtmlClass = null;

/**
 * Construct the inline-HTML display class on demand. Defined lazily so
 * importing this module before Foundry's init doesn't dereference
 * `foundry.applications.api.*` (which is undefined at that point).
 *
 * @returns {Function}
 */
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
      // Merge the title from the payload into the standard AppV2 options.
      super(
        foundry.utils.mergeObject(
          { window: { title: data?.title || "Community Screen" } },
          options,
        ),
      );
      // Stash the payload so _prepareContext can hand it to the template.
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
 * Filter the AppV2 "pop out" header control on the Table client. We
 * don't want the Table to be able to pop a sheet into its own OS-level
 * window (players watching the TV would lose sight of it).
 *
 * @param {object} app
 * @param {Array<{action: string}>} controls
 * @returns {void}
 */
function filterPopoutHeaderControl(app, controls) {
  if (!isTableUser()) return;
  if (!Array.isArray(controls)) return;
  // Walk backwards because we're mutating the array during iteration.
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
  // Register every push handler — even the legacy ones, for backwards compat.
  setHandler("showJournal", _showJournal);
  setHandler("showItem", _showItem);
  setHandler("showImage", _showImage);
  setHandler("showPortrait", _showPortrait);
  setHandler("closeAllPopups", _closeAllPopups);

  // Strip the native-popout header button on the Table.
  Hooks.on("getHeaderControlsApplicationV2", filterPopoutHeaderControl);

  // Update the backdrop when any AppV2 / AppV1 renders or closes — covers
  // both Foundry-native shares and the inline-HTML fallback path. Same
  // detection (isPopoutLike) is used inside updateBackdrop so we don't
  // re-class anything here.
  Hooks.on("renderApplicationV2", scheduleBackdropUpdate);
  Hooks.on("closeApplicationV2", scheduleBackdropUpdate);
  Hooks.on("renderApplication", scheduleBackdropUpdate); // legacy AppV1
  Hooks.on("closeApplication", scheduleBackdropUpdate);

  // Console fallbacks for diagnostics — usable from the Table dev tools.
  Hooks.once("ready", () => {
    const mod = game.modules?.get?.(MODULE_ID);
    if (mod) {
      mod.api = mod.api ?? {};
      mod.api.closeAllPopups = () => _closeAllPopups();
      mod.api.countOpenPopouts = () => countOpenPopouts();
    }
  });
}
