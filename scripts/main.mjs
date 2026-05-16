// ============================================================================
// scripts/main.mjs
// ----------------------------------------------------------------------------
// Entry point. The ONLY file that registers Foundry lifecycle hooks
// (`Hooks.once("init"/"ready")` etc.). Every feature module exports an
// `init()` function; this file invokes them in dependency order.
//
// The split is deliberate: feature files stay tiny and pure (they just
// register their own hooks inside their `init()`), and this file is the
// single place to see "what runs at what lifecycle stage and in what order".
//
// Hook flow:
//   init       → register settings, then wire every feature
//   ready      → log version banner; on the Table client engage the lock
//   socketlib  → wait for socketlib to be ready, then register handlers
// ============================================================================

// Module-wide constants for the version log.
import { MODULE_ID, MODULE_TITLE } from "./module.mjs";
// Prefixed logger for the init banner.
import { logger } from "./lib/logger.mjs";

// Feature modules — each exports `init()` and is invoked below.
import * as settings from "./settings.mjs";
import * as sockets from "./sockets.mjs";
import * as uiHiding from "./ui-hiding.mjs";
import * as sceneFit from "./scene-fit.mjs";
import * as ownership from "./ownership.mjs";
import * as vision from "./vision.mjs";
import * as popups from "./popups.mjs";
import * as pushButtons from "./push-buttons.mjs";
import * as keybindings from "./keybindings.mjs";
import * as sceneFollow from "./scene-follow.mjs";
import * as combatHighlight from "./combat-highlight.mjs";
import * as controlPalette from "./control-palette.mjs";

// Helpers used only inside the lifecycle hook bodies below.
import { isTableUser } from "./identity.mjs";
import { engageLock } from "./canvas-lock.mjs";
import { get as getSetting } from "./settings.mjs";

// Foundry's `init` hook: world data is loaded but the canvas isn't drawn
// yet. Safe place to register settings, keybindings, and hooks-on-hooks.
Hooks.once("init", () => {
  // Banner so a GM grepping the dev tools console can spot us loading.
  logger.info(`Initializing ${MODULE_TITLE}.`);
  // Settings MUST be registered first — every other init reads from them.
  settings.init();
  // Body-class UI hiding for the Table client.
  uiHiding.init();
  // Scene-fit calculator + Scene Config tab injection.
  sceneFit.init();
  // Auto-grant OWNER on PCs to the Table user (GM-side only).
  ownership.init();
  // Combat-aware vision focus broadcasting.
  vision.init();
  // Push display popups on the Table.
  popups.init();
  // "Push to Table" header buttons + directory context entries.
  pushButtons.init();
  // GM-only Ctrl+Shift+U / Ctrl+Shift+P keybindings.
  keybindings.init();
  // Scene + Scene-Level follow broadcasting.
  sceneFollow.init();
  // Active-turn highlight PIXI overlay.
  combatHighlight.init();
  // GM control palette (ApplicationV2 window).
  controlPalette.init();
});

// Foundry's `ready` hook: world is fully loaded, all settings/users
// available, all other modules' init has run. Final wiring goes here.
Hooks.once("ready", () => {
  // Look up the manifest version for the banner.
  const version = game.modules.get(MODULE_ID)?.version ?? "unknown";
  logger.info(`Ready. Version ${version}.`);

  // On the Table client, engage the canvas lock once the canvas is up.
  // We wait for canvasReady (not just ready) because the lock needs a
  // populated canvas.stage to capture the initial pivot/scale.
  if (isTableUser()) {
    Hooks.once("canvasReady", () => {
      // Only auto-engage if the persisted table-mode setting says "play".
      if (getSetting("table-mode", "play") === "play") engageLock();
    });
  }
});

// `socketlib.ready` is emitted by the socketlib hard-dependency module
// once it has finished its own init. We register our handlers AFTER that
// so the socket module is guaranteed to be available.
Hooks.once("socketlib.ready", () => {
  sockets.register();
});
