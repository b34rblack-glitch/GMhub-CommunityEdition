// ============================================================================
// scripts/popups.mjs
// ----------------------------------------------------------------------------
// Push-display receiver on the Table client.
//
// Design (Foundry v14):
// Previous iterations tried to ship rendered HTML over socketlib and render
// a custom ApplicationV2 on the Table. That worked in principle but proved
// fragile across systems and v14 sheet variants.
//
// This version uses Foundry's NATIVE share mechanisms — the same paths the
// "Show to Players" right-click action uses — and only OWNS the close side.
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
// What's our own — Close All (DOM-click strategy):
//   socketlib RPC to the Table runs a DOM walk over every visible
//   window-app and synthesizes a click on each one's close button. This
//   is the same brute-force approach `gsimon2/close-player-art` uses,
//   and it's MORE reliable than calling `app.close()` on the application
//   instance because:
//
//     (a) it bypasses any quirk where `_showEntry`-rendered sheets
//         aren't reachable through `foundry.applications.instances`,
//     (b) it goes through Foundry's normal close handler exactly as if
//         the user pressed the X — animations, hooks, document
//         dereferencing all fire the way they should,
//     (c) it's class-name agnostic — works for `JournalEntrySheet`,
//         system subclasses like `JournalEntrySheetPF2e`, ImagePopout,
//         ItemSheet, and anything else that has a header close button.
//
//   Previous strategies (document-collection walking +
//   `foundry.applications.instances` walking) consistently failed to
//   close journals shown via `JournalEntry.show()` on v14 even when
//   they looked correct in code. The DOM click works.
// ============================================================================

import { MODULE_ID, BODY_CLASS_MODAL_BG } from "./module.mjs";
import { isTableUser } from "./identity.mjs";
import { get as getSetting } from "./settings.mjs";
import { setHandler } from "./sockets.mjs";
import { logger } from "./lib/logger.mjs";

/**
 * CSS selectors that match the ROOT element of a window we should
 * NEVER auto-close, even if we find a close button inside it.
 *
 * @type {string[]}
 */
const EXCLUDED_ROOT_SELECTORS = [
  // Our own GM control palette. Shouldn't normally be open on the Table,
  // but defensive: a GM could pop it open via the console.
  "#community-screen-control-palette",
  // Core configuration dialogs.
  ".settings-config",
  ".configure-application",
  // The combat tracker, if popped out (rare on the Table).
  "#combat-popout",
];

/**
 * Class-name substrings we will NEVER count as a "popout open" for
 * backdrop purposes. Defense-in-depth for the dim-overlay tracker.
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
 * Close every shareable popout currently rendered on the Table client
 * by walking the DOM and clicking each window's close button.
 *
 * This is the same approach `gsimon2/close-player-art` takes, and it
 * sidesteps a class of failures we hit calling `app.close()` directly
 * — chiefly journal sheets shown via `JournalEntry.show()` not
 * actually closing despite being reachable via
 * `foundry.applications.instances`.
 *
 * Detection:
 *   AppV2 (v14): root element matches `.application[data-application-id]`;
 *                close button is `<button data-action="close">` inside
 *                the window's `<header>`.
 *   AppV1 (legacy): root element matches `.app.window-app`; close button
 *                is `<a class="header-button close">` or `<a class="close">`.
 *
 * Excluded windows (the GM control palette, settings/configuration
 * dialogs, the combat-popout) are skipped by root-selector match.
 *
 * @returns {Promise<void>}
 */
async function _closeAllPopups() {
  if (!isTableUser()) return;
  logger.info("closeAllPopups: DOM-click strategy on Table client.");

  // Find every top-level window-app root in the DOM. Use a Set so
  // elements that match both selectors (rare; some AppV2 sheets add
  // .window-app for backwards-compatible styling) are deduped.
  const appRoots = new Set();
  for (const el of document.querySelectorAll(".application[data-application-id]")) {
    appRoots.add(el);
  }
  for (const el of document.querySelectorAll(".app.window-app")) {
    appRoots.add(el);
  }

  // Selectors for the close button, scoped to the window's header so
  // we don't accidentally fire a "close"-named button inside content.
  const CLOSE_BTN_SELECTOR = [
    'header button[data-action="close"]',
    '.window-header button[data-action="close"]',
    "header a.header-button.close",
    ".window-header a.header-button.close",
    "header a.close",
    ".window-header a.close",
  ].join(", ");

  let clicked = 0;
  const clickedLabels = [];

  for (const root of appRoots) {
    // Skip windows on the excluded list (control palette, settings, etc.).
    if (EXCLUDED_ROOT_SELECTORS.some((sel) => root.matches(sel))) continue;

    // Skip minimized windows — clicking close on them sometimes triggers
    // a "are you sure?" path in v1 sheets.
    if (root.classList.contains("minimized")) continue;

    const btn = root.querySelector(CLOSE_BTN_SELECTOR);
    if (!btn) continue;

    try {
      // Simulate the user pressing the X. Goes through Foundry's normal
      // close handler regardless of whether the app instance is reachable
      // through the application registries.
      btn.click();
      clicked++;
      // Identifier for the log — id is set for AppV2 with options.id,
      // otherwise fall back to a short class string.
      clickedLabels.push(root.id || root.className.split(" ").slice(0, 3).join("."));
    } catch (err) {
      logger.warn("close-button click failed on", root.id || root.className, err);
    }
  }

  logger.info(`closeAllPopups: clicked ${clicked} close button(s):`, clickedLabels);
  // Foundry's close handler is async; give it a frame to remove the
  // DOM before we recompute the backdrop.
  scheduleBackdropUpdate();
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
  // Defensive: src is the only thing we actually need.
  if (!src) return;
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
