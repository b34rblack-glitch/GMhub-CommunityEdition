// ============================================================================
// scripts/scene-fit.mjs
// ----------------------------------------------------------------------------
// Aspect-ratio scene fit for the Table screen, plus a Scene Config tab
// injection so the GM can override fit mode per-scene.
//
// The "fit modes":
//   contain — whole map visible, letterbox if needed
//   cover   — map fills viewport, edges may be cropped
//   width   — fit to viewport width
//   height  — fit to viewport height
//   native  — pixel-for-pixel, no scaling
//
// Source of truth (per scene): `flags.community-screen.fitMode`. World
// default lives in the `fit-mode` setting. `resolveFitMode()` returns
// the per-scene flag if it's set to anything other than "default", else
// the world default.
//
// fitSceneToTable() is bracketed by `withUnlocked()` so the canvas lock
// can stay engaged in the user-facing sense while we do our own
// programmatic pan.
// ============================================================================

import { MODULE_ID, SCENE_FLAG_FIT_MODE } from "./module.mjs";
import { isTableUser } from "./identity.mjs";
import { get as getSetting } from "./settings.mjs";
import { withUnlocked } from "./canvas-lock.mjs";
import { debounce, t } from "./lib/helpers.mjs";
import { logger } from "./lib/logger.mjs";

/**
 * Compute the zoom scale required to fit a scene rect into a viewport,
 * given a chosen fit mode. Pure function — no Foundry deps, unit-testable.
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
  // Per-axis scale needed to make the scene cover one axis exactly.
  const sx = vpW / sceneW;
  const sy = vpH / sceneH;
  switch (mode) {
    case "contain":
      // Smaller axis wins — whole scene visible.
      return Math.min(sx, sy);
    case "cover":
      // Larger axis wins — viewport filled, scene edges may crop.
      return Math.max(sx, sy);
    case "width":
      return sx;
    case "height":
      return sy;
    case "native":
      // No scaling — useful for screen mirrors that are exactly scene-sized.
      return 1.0;
    default:
      // Unknown mode → behave like "contain".
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
  // Per-scene flag overrides the world setting.
  const flag = canvas?.scene?.getFlag?.(MODULE_ID, SCENE_FLAG_FIT_MODE);
  if (flag && flag !== "default") return flag;
  // Fall back to the world default setting.
  return getSetting("fit-mode", "contain");
}

/**
 * Compute and apply the appropriate zoom/pan for the Table client.
 * Brackets the move with disengage/engage so the canvas lock can stay on.
 *
 * @returns {Promise<void>}
 */
export async function fitSceneToTable() {
  // Bail if the canvas isn't on a scene.
  if (!canvas?.scene) return;
  // Bail if Foundry's animatePan isn't available (would no-op anyway).
  if (typeof canvas.animatePan !== "function") return;

  // Foundry computes these dims based on the scene's grid + padding settings.
  const dims = canvas.scene.dimensions;
  if (!dims) return;

  // What mode are we fitting in?
  const mode = resolveFitMode();
  // Raw mathematical scale (could be 0.4173… etc.).
  const rawScale = computeFit({
    sceneW: dims.sceneWidth,
    sceneH: dims.sceneHeight,
    vpW: window.innerWidth,
    vpH: window.innerHeight,
    mode,
  });
  // Round to 2 decimals: non-integer scales shimmer grid lines in PIXI.
  const scale = Math.round(rawScale * 100) / 100;

  // Bracket the programmatic pan so the user-facing lock can stay engaged.
  await withUnlocked(async () => {
    // Pan to the scene's center at our computed scale.
    await canvas.animatePan({
      x: dims.sceneX + dims.sceneWidth / 2,
      y: dims.sceneY + dims.sceneHeight / 2,
      scale,
      duration: 250,
    });
  });
  logger.debug(`Fit scene to Table: mode=${mode} scale=${scale}`);
}

// Debounced fit for the `window.resize` listener — bursts of resize
// events during drag should only trigger one fit at the end.
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
    // Unwrap jQuery if we got one (legacy v1 sheets).
    const root = html instanceof HTMLElement ? html : html?.[0];
    if (!root) return;
    // Scene Config exposes its scene via `.object` (legacy) or `.document` (v2).
    const scene = app?.object ?? app?.document;
    // Pre-select the current value in the dropdown, defaulting to "default".
    const current = scene?.getFlag?.(MODULE_ID, SCENE_FLAG_FIT_MODE) ?? "default";

    // Build the fieldset purely via DOM APIs (no innerHTML — safer than
    // splicing into unknown template structure).
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

    // The select; name is the standard Foundry flag-update path so the
    // form-submit handler writes it without any custom JS.
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
    // Non-fatal — Scene Config still renders without our tab.
    logger.warn("Failed to inject Scene Config tab:", err);
  }
}

/**
 * Register hooks for scene fit. Idempotent.
 *
 * @returns {void}
 */
export function init() {
  // Re-fit every time the canvas comes up (scene switch, reload, edit save).
  Hooks.on("canvasReady", () => {
    if (!isTableUser()) return;
    // Defer one tick so canvas dimensions are settled.
    setTimeout(() => fitSceneToTable(), 50);
  });

  // Re-fit on viewport resize (browser resize, fullscreen toggle, etc.).
  window.addEventListener("resize", () => {
    debouncedFit();
  });

  // Inject our fit-mode dropdown into every Scene Config render (GM only).
  Hooks.on("renderSceneConfig", (app, html) => {
    if (!game.user?.isGM) return;
    injectSceneConfig(app, html);
  });
}
