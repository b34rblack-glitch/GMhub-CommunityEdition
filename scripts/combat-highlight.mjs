// ============================================================================
// scripts/combat-highlight.mjs
// ----------------------------------------------------------------------------
// Active-turn highlight — a rotating, pulsing PIXI overlay drawn UNDER the
// active combatant's token to make "whose turn is it" unmistakable from
// across the room.
//
// Pure PIXI v7 (`drawCircle` / `lineStyle` / `moveTo` / `lineTo`). NOT
// PIXI v8 syntax — Foundry v14 still ships v7. No external module deps.
//
// Four styles (settable in module settings):
//   subtle    — thin ring, 4 spokes, slow rotation
//   default   — mid ring, 8 spokes (recommended)
//   dramatic  — thick ring, 8 spokes, fast/loud
//   ornate    — 3 concentric rings + procedural runic glyphs at each spoke
//                + counter-rotating outer halo + BlurFilter glow
//                (the in-module replacement for the old JB2A rune-circle
//                 sprite that the optional Sequencer integration used to
//                 ship)
//
// Disposition coloring (toggleable): friendly = yellow, hostile = red,
// neutral / secret = cool gray.
// ============================================================================

import { MODULE_ID } from "./module.mjs";
import { isTableUser } from "./identity.mjs";
import { get as getSetting } from "./settings.mjs";
import { logger } from "./lib/logger.mjs";

/**
 * Built-in PIXI v7 overlay for the active combatant. Uses .drawCircle() and
 * .lineStyle() — NOT PIXI v8's .circle() / strokeStyle.
 *
 * Single-instance pattern: at any moment there's either one ring drawn
 * (this.gfx, this.tick, this.tok are all set) or none (all null).
 */
export class ActiveTurnHighlight {
  constructor() {
    /** @type {PIXI.Container | null} The container holding the ring/halo/glyphs. */
    this.gfx = null;
    /** @type {Function | null} The ticker callback (rotation + pulse + token follow). */
    this.tick = null;
    /** @type {Token | null} The token the ring is currently following. */
    this.tok = null;
  }

  /**
   * Draw the highlight ring under a token.
   *
   * @param {Token} token
   * @param {{color?: number, large?: boolean, style?: string}} [opts]
   * @returns {void}
   */
  show(token, { color = 0xffd24a, large = false, style = "default" } = {}) {
    // Always clear any previous highlight before drawing a new one.
    this.hide();
    if (!token || !canvas?.tokens) return;

    // Base radius scales with token size. `large=true` is used for the
    // outer-radius variant (default for combat highlights).
    const baseRadius = Math.max(token.w, token.h) * (large ? 0.85 : 0.65);
    // Style-parameterized rendering knobs (filled in by the switch below).
    let radius;
    let lineWidth;
    let innerWidth;
    let spokes;
    let rotSpeed;
    let pulseAmp;
    let pulsePeriod;
    let glowBlur;
    let haloEnabled = false;

    // Each style is just a parameter bundle — the rest of show() is shared.
    switch (style) {
      case "subtle":
        radius = baseRadius * 0.85;
        lineWidth = 4;
        innerWidth = 2;
        spokes = 4;
        rotSpeed = 0.006;
        pulseAmp = 0.02;
        pulsePeriod = 600;
        glowBlur = 0;
        break;
      case "dramatic":
        radius = baseRadius * 1.1;
        lineWidth = 8;
        innerWidth = 4;
        spokes = 8;
        rotSpeed = 0.02;
        pulseAmp = 0.06;
        pulsePeriod = 300;
        glowBlur = 0;
        break;
      case "ornate":
        radius = baseRadius * 1.15;
        lineWidth = 7;
        innerWidth = 3;
        spokes = 12;
        rotSpeed = 0.014;
        pulseAmp = 0.05;
        pulsePeriod = 400;
        glowBlur = 6;
        haloEnabled = true;
        break;
      case "default":
      default:
        radius = baseRadius;
        lineWidth = 6;
        innerWidth = 3;
        spokes = 8;
        rotSpeed = 0.012;
        pulseAmp = 0.04;
        pulsePeriod = 350;
        glowBlur = 0;
        break;
    }

    // Parent container — everything we draw will live inside this.
    const g = new PIXI.Container();

    // Optional outer halo (ornate). Drawn first so the ring stacks on top.
    let halo = null;
    if (haloEnabled) {
      halo = new PIXI.Graphics();
      // Two concentric soft circles — the outer one extra-translucent.
      halo.lineStyle(14, color, 0.25).drawCircle(0, 0, radius * 1.12);
      halo.lineStyle(8, 0xffffff, 0.18).drawCircle(0, 0, radius * 1.18);
      g.addChild(halo);
    }

    // The main ring + inner ring + radial spokes.
    const ring = new PIXI.Graphics();
    ring.lineStyle(lineWidth, color, 0.9).drawCircle(0, 0, radius);
    ring.lineStyle(innerWidth, 0xffffff, 0.45).drawCircle(0, 0, radius * 0.86);
    // Draw `spokes` evenly-spaced radial line segments.
    for (let i = 0; i < spokes; i++) {
      const a = (i / spokes) * Math.PI * 2;
      ring
        .moveTo(Math.cos(a) * radius, Math.sin(a) * radius)
        .lineTo(Math.cos(a) * (radius - 14), Math.sin(a) * (radius - 14));
    }
    g.addChild(ring);

    // Ornate-only: a third concentric ring and procedural "runic" glyph
    // marks at each spoke, plus a counter-rotating glyph-decoration layer.
    // Replaces what the optional JB2A rune-circle asset used to provide,
    // entirely in native PIXI v7.
    let glyphLayer = null;
    if (style === "ornate") {
      // Two extra inner rings (a colored bold + a thin white).
      ring
        .lineStyle(2, color, 0.5)
        .drawCircle(0, 0, radius * 0.72)
        .lineStyle(1, 0xffffff, 0.3)
        .drawCircle(0, 0, radius * 0.66);

      // Separate Graphics for the glyphs so we can counter-rotate them.
      glyphLayer = new PIXI.Graphics();
      const glyphRadius = radius * 0.93;
      for (let i = 0; i < spokes; i++) {
        const a = (i / spokes) * Math.PI * 2;
        const cx = Math.cos(a) * glyphRadius;
        const cy = Math.sin(a) * glyphRadius;
        // drawGlyph picks one of 4 shapes based on the angle seed.
        drawGlyph(glyphLayer, cx, cy, a, 10, color);
      }
      g.addChild(glyphLayer);
    }

    // Apply a BlurFilter to the ring for the ornate "glow" feel.
    if (glowBlur > 0) {
      try {
        const blur = new PIXI.BlurFilter(glowBlur, 4);
        ring.filters = [blur];
      } catch (err) {
        // BlurFilter is part of the bundled PIXI build; if it's gone, fall back to no glow.
        logger.debug("PIXI.BlurFilter unavailable; skipping glow:", err);
      }
    }

    // Position the container under the token's center.
    g.position.set(token.center.x, token.center.y);
    // zIndex -1 + sortableChildren places us below the token sprite.
    g.zIndex = -1;
    canvas.tokens.sortableChildren = true;
    canvas.tokens.addChild(g);
    canvas.tokens.sortChildren?.();

    // Stash refs so the ticker callback and hide() can find them.
    this.gfx = g;
    this.tok = token;

    // The animation tick — rotates the ring, pulses the scale, follows
    // the token's center every frame.
    this.tick = (delta) => {
      // Defensive: if hide() ran between frames, do nothing.
      if (!this.gfx) return;
      // Apply rotation in radians per delta-tick.
      this.gfx.rotation += rotSpeed * delta;
      // Pulse via a sine wave on wall-clock time so multiple highlights stay in phase.
      const s = 1 + Math.sin(performance.now() / pulsePeriod) * pulseAmp;
      this.gfx.scale.set(s, s);
      if (halo) {
        // Counter-rotate the halo for a richer feel.
        halo.rotation -= rotSpeed * 0.5 * delta;
      }
      if (glyphLayer) {
        // Counter-rotate the runic glyph layer relative to the parent,
        // and gently pulse its alpha so the glyphs feel "alive".
        glyphLayer.rotation -= rotSpeed * 1.2 * delta;
        glyphLayer.alpha = 0.65 + Math.sin(performance.now() / 220) * 0.25;
      }
      // Track the token if it moves.
      if (this.tok?.center) this.gfx.position.set(this.tok.center.x, this.tok.center.y);
    };
    canvas.app?.ticker?.add(this.tick);
  }

  /**
   * Remove the highlight and stop the ticker callback.
   *
   * @returns {void}
   */
  hide() {
    if (this.gfx) {
      // Detach from parent so PIXI stops rendering it.
      this.gfx.parent?.removeChild(this.gfx);
      try {
        // Free GPU resources (children: true recurses into halo/ring/glyph).
        this.gfx.destroy({ children: true });
      } catch {
        // Already-destroyed (e.g. scene tore down) — safe to ignore.
      }
      this.gfx = null;
    }
    if (this.tick) {
      // Unregister the ticker callback so PIXI's frame loop stops calling it.
      canvas.app?.ticker?.remove(this.tick);
      this.tick = null;
    }
    this.tok = null;
  }
}

/**
 * Draw a small procedural "rune" glyph at (cx, cy) on the given PIXI.Graphics,
 * oriented along `tangentAngle` (so the glyph points outward from the ring
 * center). Uses a deterministic shape seed derived from the position so each
 * spoke has a distinct-looking mark without needing bundled assets.
 *
 * Pure PIXI v7 line drawing. Replaces the visual that JB2A's rune-circle
 * sprite used to provide via Sequencer.
 *
 * @param {PIXI.Graphics} g
 * @param {number} cx
 * @param {number} cy
 * @param {number} tangentAngle - Radians; the angle from the ring center to (cx, cy).
 * @param {number} size - Approximate glyph size in canvas pixels.
 * @param {number} color
 * @returns {void}
 */
function drawGlyph(g, cx, cy, tangentAngle, size, color) {
  // Pick one of four glyph patterns based on a stable seed from the position.
  const seed = Math.abs(Math.round(Math.cos(tangentAngle * 7.3) * 1000)) % 4;
  const cos = Math.cos(tangentAngle);
  const sin = Math.sin(tangentAngle);
  // Local axes: along = outward from ring center; across = tangent.
  const ax = cos;
  const ay = sin;
  const bx = -sin;
  const by = cos;
  // Helper that converts (along, across) local coords to absolute (x, y).
  const point = (a, b) => [cx + a * ax + b * bx, cy + a * ay + b * by];
  g.lineStyle(1.5, color, 0.9);

  switch (seed) {
    case 0: {
      // Vertical bar with crossbar (rune-like "T")
      const [x1, y1] = point(-size / 2, 0);
      const [x2, y2] = point(size / 2, 0);
      const [x3, y3] = point(size / 2 - 2, -size / 3);
      const [x4, y4] = point(size / 2 - 2, size / 3);
      g.moveTo(x1, y1).lineTo(x2, y2);
      g.moveTo(x3, y3).lineTo(x4, y4);
      break;
    }
    case 1: {
      // Triangle pointing outward
      const [x1, y1] = point(size / 2, 0);
      const [x2, y2] = point(-size / 2, size / 3);
      const [x3, y3] = point(-size / 2, -size / 3);
      g.moveTo(x1, y1).lineTo(x2, y2).lineTo(x3, y3).lineTo(x1, y1);
      break;
    }
    case 2: {
      // Diamond
      const [x1, y1] = point(size / 2, 0);
      const [x2, y2] = point(0, size / 2);
      const [x3, y3] = point(-size / 2, 0);
      const [x4, y4] = point(0, -size / 2);
      g.moveTo(x1, y1).lineTo(x2, y2).lineTo(x3, y3).lineTo(x4, y4).lineTo(x1, y1);
      break;
    }
    default: {
      // Two short parallel strokes (rune-like "II")
      const [x1, y1] = point(-size / 3, -size / 3);
      const [x2, y2] = point(size / 3, -size / 3);
      const [x3, y3] = point(-size / 3, size / 3);
      const [x4, y4] = point(size / 3, size / 3);
      g.moveTo(x1, y1).lineTo(x2, y2);
      g.moveTo(x3, y3).lineTo(x4, y4);
      break;
    }
  }
}

// Module-scoped singleton — only ever one highlight on screen at a time.
const highlight = new ActiveTurnHighlight();

/**
 * @returns {Token | null} The token for the active combatant on the current scene.
 */
function activeCombatToken() {
  // The "active" combat is whichever the GM has expanded in the tracker.
  const c = game.combats?.active;
  if (!c?.started) return null;
  // The "active combatant" is whoever's turn it is right now.
  const tokenId = c.combatant?.tokenId;
  if (!tokenId) return null;
  // Resolve the token from the LOCAL canvas (might not be present on the Table).
  return canvas?.tokens?.get(tokenId) ?? null;
}

/**
 * Compute the ring color for a token based on disposition and the
 * `highlight-use-disposition` setting.
 *
 * @param {Token} token
 * @returns {number}
 */
function pickColor(token) {
  // When disposition coloring is off, every highlight is friendly-yellow.
  if (!getSetting("highlight-use-disposition", true)) return 0xffd24a;
  // Foundry's CONST.TOKEN_DISPOSITIONS: -1 hostile, 0 neutral, 1 friendly.
  const d = token.document?.disposition ?? 0;
  if (d < 0) return 0xc94c4c; // hostile (warm red)
  if (d > 0) return 0xffd24a; // friendly (warm yellow)
  return 0x88aabb; // neutral / secret (cool gray)
}

/**
 * Refresh the highlight: show on the active combatant if appropriate,
 * else hide. Called by every hook that could change "whose turn is it"
 * or "should the highlight be drawn at all".
 *
 * @returns {void}
 */
function refresh() {
  // Per-client toggle (default off everywhere except the Table).
  if (!getSetting("highlight-enabled", isTableUser())) {
    highlight.hide();
    return;
  }
  // No active token → nothing to highlight.
  const tok = activeCombatToken();
  if (!tok) {
    highlight.hide();
    return;
  }
  // Don't broadcast the existence of a hidden combatant via the ring.
  if (tok.document?.hidden) {
    highlight.hide();
    return;
  }
  // v14 Scene Levels guard: skip if the combatant is on another level.
  const tokenLevel = tok.document?.level;
  if (tokenLevel !== undefined && tokenLevel !== canvas?.viewedLevel) {
    highlight.hide();
    return;
  }
  // Read the style choice each refresh so settings changes take effect immediately.
  const style = getSetting("highlight-style", "default");
  highlight.show(tok, { color: pickColor(tok), large: true, style });
}

/**
 * Register hooks.
 *
 * @returns {void}
 */
export function init() {
  // Any of these hooks could mean "the highlight should update".
  for (const h of ["updateCombat", "combatStart", "combatTurn", "combatRound", "canvasReady"]) {
    Hooks.on(h, () => refresh());
  }
  // End-of-combat = hide unconditionally.
  for (const h of ["combatEnd", "deleteCombat"]) {
    Hooks.on(h, () => highlight.hide());
  }
  // If the token being highlighted is deleted, hide so we don't crash following it.
  Hooks.on("deleteToken", (doc) => {
    if (doc?.id === game.combats?.active?.combatant?.tokenId) {
      highlight.hide();
    }
  });
  // Token moves / size changes — refresh so the ring stays aligned.
  Hooks.on("updateToken", () => refresh());

  // React to setting changes (style toggle, disposition toggle).
  Hooks.on("clientSettingChanged", (key) => {
    if (key?.startsWith?.(`${MODULE_ID}.highlight-`)) refresh();
  });
}
