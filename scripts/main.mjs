// Community Screen — entry point: registers init/ready/setup hooks and dispatches to feature modules.

import { MODULE_ID, MODULE_TITLE } from "./module.mjs";
import { logger } from "./lib/logger.mjs";
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
import { isTableUser } from "./identity.mjs";
import { engageLock } from "./canvas-lock.mjs";
import { get as getSetting } from "./settings.mjs";

Hooks.once("init", () => {
  logger.info(`Initializing ${MODULE_TITLE}.`);
  settings.init();
  uiHiding.init();
  sceneFit.init();
  ownership.init();
  vision.init();
  popups.init();
  pushButtons.init();
  keybindings.init();
  sceneFollow.init();
  combatHighlight.init();
});

Hooks.once("ready", () => {
  const version = game.modules.get(MODULE_ID)?.version ?? "unknown";
  logger.info(`Ready. Version ${version}.`);

  // On the Table client, engage the canvas lock once the canvas is up.
  if (isTableUser()) {
    Hooks.once("canvasReady", () => {
      if (getSetting("table-mode", "play") === "play") engageLock();
    });
  }
});

Hooks.once("socketlib.ready", () => {
  sockets.register();
});
