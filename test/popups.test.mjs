// ============================================================================
// test/popups.test.mjs
// ----------------------------------------------------------------------------
// Close-all across the AppV2 + legacy-v1 registries, plus show-image/portrait
// (seeds AC2 close-all). Drives the REAL handlers reached through
// popups.init() + sockets.register() — proving they are wired handlers, not
// stubs — with `game` stubbed so isTableUser() is true. The jsdom preload's
// synchronous requestAnimationFrame shim keeps the post-close backdrop update
// from throwing.
//
// Fake apps SELF-REMOVE from their registry when closed (as real Foundry apps
// do on close), so countOpenPopouts() can be asserted to drop after close.
// ============================================================================

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import { installFoundryMock } from "./helpers/foundry-mock.mjs";

let env = installFoundryMock({ as: "table", tableUserId: "table-1" });
const popups = await import("../scripts/popups.mjs");
const sockets = await import("../scripts/sockets.mjs");

let appCounter = 0;

/**
 * Build a fake Foundry application and register it in one of the two registries.
 * It self-removes from BOTH registries the moment it is closed by whichever of
 * the three strategies fires, and records which strategy closed it.
 *
 * @param {string} name  Constructor name (drives include/exclude matching).
 * @param {object} opts
 *   - registry: "instances" (AppV2 Map) | "windows" (legacy object). Default instances.
 *   - strategy: "window" | "element" | "close" — which close path SHOULD fire.
 *   - v1: mark as legacy popout (options.popOut === true) instead of AppV2.
 *   - minimized: boolean.
 *   - elementCloseSelector: the selector the element's close button matches
 *     (default 'button[data-action="close"]').
 *   - elementHasNoClose: element present but with NO close-shaped child.
 * @returns {{app: object, record: {closedVia: string|null}, id: string}}
 */
function installApp(name, opts = {}) {
  const {
    registry = "instances",
    strategy = "window",
    v1 = false,
    minimized = false,
    elementCloseSelector = 'button[data-action="close"]',
    elementHasNoClose = false,
  } = opts;
  const id = `${name}-${appCounter++}`;
  const record = { closedVia: null };
  const remove = () => {
    env.foundry.applications.instances.delete(id);
    delete env.ui.windows[id];
  };

  const app = { constructor: { name }, minimized, options: {} };
  // Popout recognition: AppV2 has a truthy `.window`; legacy v1 sets popOut.
  if (v1) app.options.popOut = true;

  if (strategy === "window") {
    const btn = document.createElement("button");
    btn.addEventListener("click", () => {
      record.closedVia = "window";
      remove();
    });
    app.window = { close: btn };
  } else {
    // Non-window strategies still need to read as popout-like. If not v1, give
    // a `.window` WITHOUT a usable close button so strategy 1 is skipped.
    if (!v1) app.window = {};
    if (strategy === "element") {
      const div = document.createElement("div");
      if (!elementHasNoClose) {
        // Render a close-shaped element matching one of the real selectors.
        if (elementCloseSelector === 'button[data-action="close"]') {
          div.innerHTML = '<button data-action="close">x</button>';
        } else if (elementCloseSelector === "a.header-button.close") {
          div.innerHTML = '<a class="header-button close">x</a>';
        } else if (elementCloseSelector === "a.close") {
          div.innerHTML = '<a class="close">x</a>';
        } else {
          // A DELIBERATELY WRONG selector (the abandoned v0.1.9 CSS): the
          // close walk must NOT match this, so it should fall through to close().
          div.innerHTML = '<div class="application" data-application-id="x"></div>';
        }
        const btn = div.querySelector(elementCloseSelector);
        if (btn) {
          btn.addEventListener("click", () => {
            record.closedVia = "element";
            remove();
          });
        }
      }
      app.element = div;
    }
    // Provide a close() method as the strategy-3 fallback (always present).
    app.close = () => {
      // Only count as the close-method path if the earlier strategies didn't.
      if (!record.closedVia) record.closedVia = "close";
      remove();
      return Promise.resolve();
    };
  }
  if (strategy === "window") {
    // Even window-strategy apps expose close() so nothing hangs if reused.
    app.close = () => {
      if (!record.closedVia) record.closedVia = "close";
      remove();
      return Promise.resolve();
    };
  }

  if (registry === "instances") env.foundry.applications.instances.set(id, app);
  else env.ui.windows[id] = app;
  return { app, record, id };
}

/** Freshly wire popups + sockets against a Table-user env, returning handles. */
function setup() {
  popups.init();
  sockets.register();
  // Fire the popups ready hook to expose mod.api.countOpenPopouts.
  env.hooks.onceHandler("ready")();
  const socket = env.getSocket();
  const api = env.game.modules.get("community-screen").api;
  return {
    closeAll: socket.registered.get("closeAllPopups"),
    showImage: socket.registered.get("showImage"),
    showPortrait: socket.registered.get("showPortrait"),
    countOpenPopouts: api.countOpenPopouts,
  };
}

beforeEach(() => {
  env.restore();
  env = installFoundryMock({ as: "table", tableUserId: "table-1" });
  appCounter = 0;
});

afterEach(() => {
  env.restore();
});

test("close-all walks BOTH registries: an app in only instances AND one in only ui.windows both close", async () => {
  const a = installApp("JournalSheet", { registry: "instances", strategy: "window" });
  const b = installApp("ItemSheetPF2e", { registry: "windows", strategy: "close", v1: true });
  const { closeAll } = setup();
  await closeAll();
  assert.equal(a.record.closedVia, "window", "instances-only app closed");
  assert.ok(b.record.closedVia, "ui.windows-only app closed");
});

test("the three close strategies run in order (window → element → close())", async () => {
  const s1 = installApp("SheetA", { strategy: "window" });
  const s2 = installApp("SheetB", { strategy: "element" });
  const s3 = installApp("SheetC", { strategy: "close" });
  const { closeAll } = setup();
  await closeAll();
  // Strategy 1 wins when window.close exists.
  assert.equal(s1.record.closedVia, "window");
  // Strategy 2 (element querySelector) wins when there's no window.close button.
  assert.equal(s2.record.closedVia, "element");
  // Strategy 3 (app.close) is the last resort.
  assert.equal(s3.record.closedVia, "close");
});

test("the close walk does NOT depend on the abandoned v0.1.9 CSS selectors", async () => {
  // An element whose only match is the OLD selector (.application[data-application-id])
  // must NOT be treated as a close button — it falls through to close().
  const legacy = installApp("SheetOld", { strategy: "element", elementCloseSelector: "WRONG" });
  // Sanity: the three CURRENT selectors DO match and click.
  const cur1 = installApp("SheetCur1", {
    strategy: "element",
    elementCloseSelector: "a.header-button.close",
  });
  const cur2 = installApp("SheetCur2", { strategy: "element", elementCloseSelector: "a.close" });
  const { closeAll } = setup();
  await closeAll();
  assert.equal(legacy.record.closedVia, "close", "old selector is NOT matched (falls to close())");
  assert.equal(cur1.record.closedVia, "element", "a.header-button.close is matched");
  assert.equal(cur2.record.closedVia, "element", "a.close is matched");
});

test("exclude list is honored: ControlPalette/Settings/Combat survive; minimized skipped", async () => {
  const palette = installApp("ControlPalette", { strategy: "close" });
  const settings = installApp("SettingsConfig", { strategy: "close" });
  const combat = installApp("CombatTracker", { strategy: "close" });
  const notif = installApp("Notifications", { strategy: "close" });
  const minimized = installApp("JournalSheet", { strategy: "close", minimized: true });
  const normal = installApp("ActorSheet", { strategy: "close" });
  const { closeAll } = setup();
  await closeAll();
  assert.equal(palette.record.closedVia, null, "ControlPalette survives");
  assert.equal(settings.record.closedVia, null, "Settings survives");
  assert.equal(combat.record.closedVia, null, "Combat survives");
  assert.equal(notif.record.closedVia, null, "Notifications survives");
  assert.equal(minimized.record.closedVia, null, "minimized app skipped");
  assert.ok(normal.record.closedVia, "a normal sheet still closes");
});

test("isPopoutLike/countOpenPopouts recognize AppV2 (.window) AND v1 (options.popOut); count drops to baseline after close", async () => {
  installApp("JournalSheet", { registry: "instances", strategy: "window" }); // AppV2, closeable
  installApp("LegacyItemSheet", { registry: "windows", strategy: "close", v1: true }); // v1, closeable
  // A minimized (non-excluded) popout is SKIPPED by close-all but is still
  // popout-like, so it is the residual "baseline" the count settles to.
  const minimized = installApp("ActorSheet", {
    registry: "instances",
    strategy: "close",
    minimized: true,
  });
  // An excluded app (ControlPalette) is NOT popout-like at all → never counted.
  const excluded = installApp("ControlPalette", { registry: "instances", strategy: "close" });
  const { closeAll, countOpenPopouts } = setup();
  // Journal (AppV2) + Legacy (v1) + minimized ActorSheet = 3; ControlPalette excluded.
  assert.equal(
    countOpenPopouts(),
    3,
    "counts AppV2 + v1 + minimized popout-like; excludes ControlPalette",
  );
  await closeAll();
  // The two closeable popouts self-removed; the minimized one remains → baseline 1.
  assert.equal(
    countOpenPopouts(),
    1,
    "count drops to the exclude/skip baseline (handler really ran)",
  );
  assert.equal(minimized.record.closedVia, null, "minimized app was skipped, not closed");
  assert.equal(excluded.record.closedVia, null, "ControlPalette survives");
});

test("_showImage builds ImagePopout(src, {title, shareable:false}) and warns+returns on empty src", async () => {
  const { showImage } = setup();
  await showImage({ src: "worlds/x/art.webp", title: "Gilded Map" });
  assert.equal(env.imagePopout.instances.length, 1, "one ImagePopout constructed");
  const ip = env.imagePopout.instances[0];
  assert.equal(ip.src, "worlds/x/art.webp");
  assert.equal(ip.options.title, "Gilded Map");
  assert.equal(ip.options.shareable, false);
  assert.equal(ip.rendered, true, "render(true) was called");

  // Empty src → warn + no new popup.
  await showImage({ src: "", title: "nope" });
  assert.equal(env.imagePopout.instances.length, 1, "empty src does NOT construct a popup");
  assert.ok(
    env.notifications.calls.warn.length === 0,
    "empty src logs (not a ui warn) — no user toast expected",
  );
});

test("_showPortrait routes src → _showImage, and resolves legacy actorUuid → fromUuid → actor.img", async () => {
  const { showPortrait } = setup();
  // Modern path: src provided → straight to ImagePopout.
  await showPortrait({ src: "tokens/hero.webp", caption: "Sir Aldric" });
  assert.equal(env.imagePopout.instances.length, 1);
  assert.equal(env.imagePopout.instances[0].src, "tokens/hero.webp");

  // Legacy path: only actorUuid → fromUuid → actor.img.
  globalThis.fromUuid = async (uuid) => {
    assert.equal(uuid, "Actor.abc");
    return { img: "portraits/aldric.webp", name: "Sir Aldric" };
  };
  await showPortrait({ actorUuid: "Actor.abc" });
  assert.equal(env.imagePopout.instances.length, 2, "legacy actorUuid resolved to a popup");
  assert.equal(env.imagePopout.instances[1].src, "portraits/aldric.webp");
});

test("handlers no-op off the Table client (isTableUser() false)", async () => {
  // Re-install as a NON-table (GM) client for this test only.
  env.restore();
  env = installFoundryMock({ as: "gm", tableUserId: "table-1" });
  const { showImage, closeAll } = setup();
  const a = installApp("JournalSheet", { strategy: "close" });
  await showImage({ src: "x.webp" });
  await closeAll();
  assert.equal(env.imagePopout.instances.length, 0, "off-Table showImage is a no-op");
  assert.equal(a.record.closedVia, null, "off-Table closeAll is a no-op");
});
