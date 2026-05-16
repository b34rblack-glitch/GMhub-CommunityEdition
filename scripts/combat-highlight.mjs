// Community Screen — active-turn highlight PIXI v7 overlay. No external module deps.

import { MODULE_ID } from "./module.mjs";
import { isTableUser } from "./identity.mjs";
import { get as getSetting } from "./settings.mjs";
import { logger } from "./lib/logger.mjs";

/**
 * Built-in PIXI v7 overlay for the active combatant. Uses .drawCircle() and
 * .lineStyle() — NOT PIXI v8's .circle() / strokeStyle.
 *
 * Four styles share the same shape vocabulary (outer ring + inner ring +
 * radial spokes) with different parameters; the `ornate` style adds an
 * outer pulse halo and a PIXI.BlurFilter glow for a richer effect without
 * needing Sequencer or JB2A.
 */
export class ActiveTurnHighlight {
  constructor() {
    /** @type {PIXI.Container | null} */
    this.gfx = null;
    /** @type {Function | null} */
    this.tick = null;
    /** @type {Token | null} */
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
    this.hide();
    if (!token || !canvas?.tokens) return;

    const baseRadius = Math.max(token.w, token.h) * (large ? 0.85 : 0.65);
    let radius;
    let lineWidth;
    let innerWidth;
    let spokes;
    let rotSpeed;
    let pulseAmp;
    let pulsePeriod;
    let glowBlur;
    let haloEnabled = false;

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

    const g = new PIXI.Container();

    // Optional outer halo (ornate). Drawn first so the ring stacks on top.
    let halo = null;
    if (haloEnabled) {
      halo = new PIXI.Graphics();
      halo.lineStyle(14, color, 0.25).drawCircle(0, 0, radius * 1.12);
      halo.lineStyle(8, 0xffffff, 0.18).drawCircle(0, 0, radius * 1.18);
      g.addChild(halo);
    }

    const ring = new PIXI.Graphics();
    ring.lineStyle(lineWidth, color, 0.9).drawCircle(0, 0, radius);
    ring.lineStyle(innerWidth, 0xffffff, 0.45).drawCircle(0, 0, radius * 0.86);
    for (let i = 0; i < spokes; i++) {
      const a = (i / spokes) * Math.PI * 2;
      ring
        .moveTo(Math.cos(a) * radius, Math.sin(a) * radius)
        .lineTo(Math.cos(a) * (radius - 14), Math.sin(a) * (radius - 14));
    }
    g.addChild(ring);

    if (glowBlur > 0) {
      try {
        const blur = new PIXI.BlurFilter(glowBlur, 4);
        ring.filters = [blur];
      } catch (err) {
        logger.debug("PIXI.BlurFilter unavailable; skipping glow:", err);
      }
    }

    g.position.set(token.center.x, token.center.y);
    g.zIndex = -1;
    canvas.tokens.sortableChildren = true;
    canvas.tokens.addChild(g);
    canvas.tokens.sortChildren?.();

    this.gfx = g;
    this.tok = token;

    this.tick = (delta) => {
      if (!this.gfx) return;
      this.gfx.rotation += rotSpeed * delta;
      const s = 1 + Math.sin(performance.now() / pulsePeriod) * pulseAmp;
      this.gfx.scale.set(s, s);
      if (halo) {
        // Counter-rotate the halo for a richer feel.
        halo.rotation -= rotSpeed * 0.5 * delta;
      }
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
      this.gfx.parent?.removeChild(this.gfx);
      try {
        this.gfx.destroy({ children: true });
      } catch {
        // ignore
      }
      this.gfx = null;
    }
    if (this.tick) {
      canvas.app?.ticker?.remove(this.tick);
      this.tick = null;
    }
    this.tok = null;
  }
}

const highlight = new ActiveTurnHighlight();

/**
 * @returns {Token | null} The token for the active combatant on the current scene.
 */
function activeCombatToken() {
  const c = game.combats?.active;
  if (!c?.started) return null;
  const tokenId = c.combatant?.tokenId;
  if (!tokenId) return null;
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
  if (!getSetting("highlight-use-disposition", true)) return 0xffd24a;
  const d = token.document?.disposition ?? 0;
  if (d < 0) return 0xc94c4c; // hostile
  if (d > 0) return 0xffd24a; // friendly
  return 0x88aabb; // neutral / secret
}

/**
 * Refresh the highlight: show on the active combatant if appropriate,
 * else hide.
 *
 * @returns {void}
 */
function refresh() {
  if (!getSetting("highlight-enabled", isTableUser())) {
    highlight.hide();
    return;
  }
  const tok = activeCombatToken();
  if (!tok) {
    highlight.hide();
    return;
  }
  if (tok.document?.hidden) {
    highlight.hide();
    return;
  }
  // v14 Scene Levels guard.
  const tokenLevel = tok.document?.level;
  if (tokenLevel !== undefined && tokenLevel !== canvas?.viewedLevel) {
    highlight.hide();
    return;
  }
  const style = getSetting("highlight-style", "default");
  highlight.show(tok, { color: pickColor(tok), large: true, style });
}

/**
 * Register hooks.
 *
 * @returns {void}
 */
export function init() {
  for (const h of ["updateCombat", "combatStart", "combatTurn", "combatRound", "canvasReady"]) {
    Hooks.on(h, () => refresh());
  }
  for (const h of ["combatEnd", "deleteCombat"]) {
    Hooks.on(h, () => highlight.hide());
  }
  Hooks.on("deleteToken", (doc) => {
    if (doc?.id === game.combats?.active?.combatant?.tokenId) {
      highlight.hide();
    }
  });
  Hooks.on("updateToken", () => refresh());

  // React to setting changes (style toggle, disposition toggle).
  Hooks.on("clientSettingChanged", (key) => {
    if (key?.startsWith?.(`${MODULE_ID}.highlight-`)) refresh();
  });
}
