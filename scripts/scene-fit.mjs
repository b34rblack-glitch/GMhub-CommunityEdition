// ============================================================================
// scripts/scene-fit.mjs
// ----------------------------------------------------------------------------
// Aspect-ratio scene fit for the Table screen, plus a Scene Config tab
// injection so the GM can override fit mode per-scene.
//
// The "fit modes":
//   contain  — whole map visible, letterbox if needed
//   cover    — map fills viewport, edges may be cropped
//   width    — fit to viewport width
//   height   — fit to viewport height
//   native   — pixel-for-pixel, no scaling
//   physical — physical-mini mode: zoom so one grid square renders at a
//              fixed real-world size (cm/inch) on the specific TV, using the
//              display's diagonal + native resolution to derive pixels-per-inch
//
// The aspect modes (contain/cover/width/height/native) depend only on the
// scene rect and the viewport. The `physical` mode ignores the viewport
// entirely: its scale is dictated by the physical display calibration
// (`custom-scale` target size, `physical-target-unit`, `display-diagonal-in`,
// `display-res-width/height`) and the live renderer resolution. See KD3 in
// .conclave/spec.md for the derivation of S = (T_inch · PPI) / (G · R).
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
 * Typed error thrown by `computeFit` when physical-mode calibration inputs
 * are missing or invalid (e.g. an unconfigured diagonal, or the `resW/resH=0`
 * auto-detect sentinel reaching the pure function unresolved). Callers catch
 * this and surface a localized warning rather than fitting a blank canvas —
 * per the repo's "never silently swallow errors" rule.
 */
export class FitComputeError extends Error {
  /**
   * @param {string} message - Human-readable reason the physical fit failed.
   */
  constructor(message) {
    super(message);
    this.name = "FitComputeError";
  }
}

/**
 * Compute the physical-mini scale: the zoom that renders one grid square at
 * a fixed real-world size on the target display. Pure and Foundry-free — the
 * live renderer resolution `R` and the resolved (non-sentinel) display
 * resolution are passed in by `fitSceneToTable`.
 *
 *   S = (T_inch · PPI) / (G · R),  PPI = sqrt(resW² + resH²) / diagonalIn
 *
 * `R` sits in the denominator because Foundry's `animatePan` scale maps
 * scene-pixels → CSS-pixels while PPI is physical-pixels/inch. Reading `R`
 * live (while resW/resH/diagonalIn stay stored panel facts) makes the
 * on-glass size self-correct under browser zoom.
 *
 * @param {object} p
 * @param {number} p.grid - Grid square size in scene pixels (`dims.size`).
 * @param {number} p.targetPhysical - Target grid-square size, in `targetUnit`.
 * @param {string} p.targetUnit - "inch" or "cm".
 * @param {number} p.diagonalIn - Display diagonal in inches.
 * @param {number} p.resW - Display native width in device pixels (resolved, non-zero).
 * @param {number} p.resH - Display native height in device pixels (resolved, non-zero).
 * @param {number} p.resolution - Live renderer device-pixel ratio (R).
 * @returns {number} Raw scale factor (NOT rounded).
 * @throws {FitComputeError} On unknown unit or non-finite/≤0 numeric input.
 */
function physicalScale({ grid, targetPhysical, targetUnit, diagonalIn, resW, resH, resolution }) {
  // Convert the target size to inches. Unknown unit → fail closed.
  let tInch;
  if (targetUnit === "inch") tInch = targetPhysical;
  else if (targetUnit === "cm") tInch = targetPhysical / 2.54;
  else throw new FitComputeError(`Physical fit: unknown target unit "${targetUnit}".`);

  // Guard every numeric input: a 0/NaN/negative here (e.g. the unresolved
  // resW/resH=0 auto-detect sentinel, or an unconfigured diagonal) would
  // otherwise yield PPI=0 → S=0 → a blank canvas.
  const guarded = {
    targetPhysical,
    diagonalIn,
    resW,
    resH,
    resolution,
    grid,
  };
  for (const [name, value] of Object.entries(guarded)) {
    if (!Number.isFinite(value) || value <= 0) {
      throw new FitComputeError(
        `Physical fit: ${name} must be a positive finite number (got ${value}).`,
      );
    }
  }

  // Pixels-per-inch of the physical panel, then the scene→display scale.
  const ppi = Math.sqrt(resW * resW + resH * resH) / diagonalIn;
  const scale = (tInch * ppi) / (grid * resolution);
  if (!Number.isFinite(scale) || scale <= 0) {
    throw new FitComputeError(`Physical fit: computed a non-usable scale (${scale}).`);
  }
  return scale;
}

/**
 * Compute the zoom scale required to fit a scene rect into a viewport,
 * given a chosen fit mode. Pure function — no Foundry deps, unit-testable.
 *
 * For `mode === "physical"` the viewport is ignored and the scale is derived
 * from the physical-display calibration fields instead (see `physicalScale`).
 *
 * @param {object} args
 * @param {number} args.sceneW - Scene playable width in canvas pixels.
 * @param {number} args.sceneH - Scene playable height in canvas pixels.
 * @param {number} args.vpW   - Viewport width in CSS pixels.
 * @param {number} args.vpH   - Viewport height in CSS pixels.
 * @param {string} args.mode  - One of contain/cover/width/height/native/physical.
 * @param {number} [args.grid] - Grid square size in scene px (physical mode).
 * @param {number} [args.targetPhysical] - Target grid-square size (physical mode).
 * @param {string} [args.targetUnit] - "inch" | "cm" (physical mode).
 * @param {number} [args.diagonalIn] - Display diagonal in inches (physical mode).
 * @param {number} [args.resW] - Resolved display width in device px (physical mode).
 * @param {number} [args.resH] - Resolved display height in device px (physical mode).
 * @param {number} [args.resolution] - Live renderer device-pixel ratio (physical mode).
 * @returns {number} Scale factor (1.0 = native).
 * @throws {FitComputeError} From physical mode on invalid calibration input.
 */
export function computeFit({
  sceneW,
  sceneH,
  vpW,
  vpH,
  mode,
  grid,
  targetPhysical,
  targetUnit,
  diagonalIn,
  resW,
  resH,
  resolution,
}) {
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
    case "physical":
      // Physical-mini: viewport-independent, driven by display calibration.
      return physicalScale({
        grid,
        targetPhysical,
        targetUnit,
        diagonalIn,
        resW,
        resH,
        resolution,
      });
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

  // Assemble the computeFit args. The aspect modes only need the scene/
  // viewport rects; physical mode additionally needs the display calibration,
  // the live renderer resolution, and the RESOLVED (non-sentinel) display
  // resolution.
  const args = {
    sceneW: dims.sceneWidth,
    sceneH: dims.sceneHeight,
    vpW: window.innerWidth,
    vpH: window.innerHeight,
    mode,
  };

  if (mode === "physical") {
    // R maps scene-scale → device px; read LIVE (renderer resolution is the
    // authoritative value, devicePixelRatio the fallback) so the physical
    // size self-corrects under browser zoom.
    const R = canvas.app?.renderer?.resolution || window.devicePixelRatio || 1;
    // Stored native resolution, or the sentinel 0 = auto-detect on THIS
    // client. Auto-detect MUST happen here on the Table client — screen.* /
    // devicePixelRatio describe the machine reading them, and the world-scoped
    // calibration must describe the TV, not the GM laptop that saved it.
    let resW = getSetting("display-res-width", 0);
    let resH = getSetting("display-res-height", 0);
    if (!resW || !resH) {
      resW = (window.screen?.width || window.innerWidth) * R;
      resH = (window.screen?.height || window.innerHeight) * R;
    }
    args.grid = dims.size;
    args.targetPhysical = getSetting("custom-scale", 1.0);
    args.targetUnit = getSetting("physical-target-unit", "inch");
    args.diagonalIn = getSetting("display-diagonal-in", 0);
    args.resW = resW;
    args.resH = resH;
    args.resolution = R;
  }

  // Raw mathematical scale (could be 0.4173… etc.). Physical mode can throw a
  // typed FitComputeError on bad calibration — surface it, never fit blank.
  let rawScale;
  try {
    rawScale = computeFit(args);
  } catch (err) {
    logger.error("Physical fit computation failed:", err);
    ui.notifications?.warn(t("notifications.physical-fit-failed"));
    return;
  }

  // Physical mode keeps the EXACT scale — the canvas is pan/zoom-locked so
  // there's no interactive grid shimmer to guard against, and rounding would
  // throw off the calibrated physical size. Every other mode snaps to 2
  // decimals: non-integer scales shimmer grid lines in PIXI.
  const scale = mode === "physical" ? rawScale : Math.round(rawScale * 100) / 100;

  // Foundry's animatePan clamps scale to [CONFIG.Canvas.minZoom,
  // CONFIG.Canvas.maxZoom] (default max 3.0). In physical mode an exact scale
  // above the ceiling would be SILENTLY clamped (minis rendered subtly small,
  // no error). Raise the ceiling to accommodate; warn on the dynamic floor
  // (which we can't safely lower). Never fail silently.
  if (mode === "physical") {
    const cap = CONFIG?.Canvas?.maxZoom;
    if (typeof cap === "number" && scale > cap) {
      CONFIG.Canvas.maxZoom = Math.ceil(scale);
      logger.warn(`Physical fit scale ${scale} exceeds maxZoom ${cap}; raised the ceiling.`);
    }
    const floor = CONFIG?.Canvas?.minZoom;
    if (typeof floor === "number" && scale < floor) {
      logger.warn(`Physical fit scale ${scale} is below minZoom ${floor}; may be clamped.`);
      ui.notifications?.warn(t("notifications.physical-fit-clamped"));
    }
  }

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
      ["physical", t("settings.fit-mode.physical")],
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
