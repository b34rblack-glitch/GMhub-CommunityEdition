// Community Screen — aspect-ratio scene fit for the Table screen plus Scene Config tab override.

import { MODULE_ID, SCENE_FLAG_FIT_MODE } from "./module.mjs";
import { isTableUser } from "./identity.mjs";
import { get as getSetting } from "./settings.mjs";
import { withUnlocked } from "./canvas-lock.mjs";
import { debounce, t } from "./lib/helpers.mjs";
import { logger } from "./lib/logger.mjs";

/**
 * Compute the zoom scale required to fit a scene rect into a viewport,
 * given a chosen fit mode.
 *
 * @param {object} args
 * @param {number} args.sceneW - Scene playable width in canvas pixels.
 * @param {number} args.sceneH - Scene playable height in canvas pixels.
 * @param {number} args.vpW   - Viewport width in CSS pixels.
 * @param {number} args.vpH   - Viewport height in CSS pixels.
 * @param {string} args.mode  - One of contain/cover/width/height/native.
 * @returns {number} Scale factor (1.0 = native).
 */
export function computeFit({ sceneW, sceneH, vpW, vpH, mode }) {
  const sx = vpW / sceneW;
  const sy = vpH / sceneH;
  switch (mode) {
    case "contain":
      return Math.min(sx, sy);
    case "cover":
      return Math.max(sx, sy);
    case "width":
      return sx;
    case "height":
      return sy;
    case "native":
      return 1.0;
    default:
      return Math.min(sx, sy);
  }
}

/**
 * Resolve the fit mode to use for the current scene: per-scene flag if set,
 * else world default.
 *
 * @returns {string}
 */
function resolveFitMode() {
  const flag = canvas?.scene?.getFlag?.(MODULE_ID, SCENE_FLAG_FIT_MODE);
  if (flag && flag !== "default") return flag;
  return getSetting("fit-mode", "contain");
}

/**
 * Compute and apply the appropriate zoom/pan for the Table client.
 * Brackets the move with disengage/engage so the canvas lock can stay on.
 *
 * @returns {Promise<void>}
 */
export async function fitSceneToTable() {
  if (!canvas?.scene) return;
  if (typeof canvas.animatePan !== "function") return;

  const dims = canvas.scene.dimensions;
  if (!dims) return;

  const mode = resolveFitMode();
  const rawScale = computeFit({
    sceneW: dims.sceneWidth,
    sceneH: dims.sceneHeight,
    vpW: window.innerWidth,
    vpH: window.innerHeight,
    mode,
  });
  // Round to 2 decimals: non-integer scales shimmer grid lines.
  const scale = Math.round(rawScale * 100) / 100;

  await withUnlocked(async () => {
    await canvas.animatePan({
      x: dims.sceneX + dims.sceneWidth / 2,
      y: dims.sceneY + dims.sceneHeight / 2,
      scale,
      duration: 250,
    });
  });
  logger.debug(`Fit scene to Table: mode=${mode} scale=${scale}`);
}

const debouncedFit = debounce(() => {
  if (isTableUser()) fitSceneToTable();
}, 200);

/**
 * Inject a Community Screen fieldset into Scene Config so the GM can override
 * fit mode per-scene. Works for both AppV2 (HTMLElement) and legacy (jQuery).
 *
 * @param {object} app - The Scene Config application.
 * @param {HTMLElement | object} html - Root element or jQuery wrapper.
 * @returns {void}
 */
function injectSceneConfig(app, html) {
  try {
    const root = html instanceof HTMLElement ? html : html?.[0];
    if (!root) return;
    const scene = app?.object ?? app?.document;
    const current = scene?.getFlag?.(MODULE_ID, SCENE_FLAG_FIT_MODE) ?? "default";

    const fieldset = document.createElement("fieldset");
    fieldset.classList.add("community-screen-scene-fit");
    const legend = document.createElement("legend");
    legend.textContent = t("scene-config.fieldset");
    fieldset.appendChild(legend);

    const group = document.createElement("div");
    group.className = "form-group";
    const label = document.createElement("label");
    label.textContent = t("scene-config.fit-mode-label");
    group.appendChild(label);

    const select = document.createElement("select");
    select.name = `flags.${MODULE_ID}.${SCENE_FLAG_FIT_MODE}`;
    const options = [
      ["default", t("scene-config.fit-mode-default")],
      ["contain", t("settings.fit-mode.contain")],
      ["cover", t("settings.fit-mode.cover")],
      ["width", t("settings.fit-mode.width")],
      ["height", t("settings.fit-mode.height")],
      ["native", t("settings.fit-mode.native")],
    ];
    for (const [value, text] of options) {
      const opt = document.createElement("option");
      opt.value = value;
      opt.textContent = text;
      if (value === current) opt.selected = true;
      select.appendChild(opt);
    }
    group.appendChild(select);
    fieldset.appendChild(group);

    // Try to insert next to the basic tab; fall back to appending to the form.
    const basicTab = root.querySelector?.(".tab[data-tab='basic']");
    const form = root.querySelector?.("form") ?? root;
    (basicTab ?? form)?.appendChild(fieldset);
  } catch (err) {
    logger.warn("Failed to inject Scene Config tab:", err);
  }
}

/**
 * Register hooks for scene fit. Idempotent.
 *
 * @returns {void}
 */
export function init() {
  Hooks.on("canvasReady", () => {
    if (!isTableUser()) return;
    // Defer one tick so canvas dimensions are settled.
    setTimeout(() => fitSceneToTable(), 50);
  });

  window.addEventListener("resize", () => {
    debouncedFit();
  });

  Hooks.on("renderSceneConfig", (app, html) => {
    if (!game.user?.isGM) return;
    injectSceneConfig(app, html);
  });
}
