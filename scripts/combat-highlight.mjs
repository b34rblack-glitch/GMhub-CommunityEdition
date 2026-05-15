// Community Screen — active-turn highlight PIXI v7 overlay, with optional Sequencer/JB2A upgrade.

import { MODULE_ID } from "./module.mjs";
import { isTableUser } from "./identity.mjs";
import { get as getSetting } from "./settings.mjs";
import { logger } from "./lib/logger.mjs";

/**
 * Built-in PIXI v7 overlay for the active combatant. Uses .drawCircle() and
 * .lineStyle() — NOT PIXI v8's .circle() / strokeStyle.
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
    const radius =
      style === "dramatic" ? baseRadius * 1.1 : style === "subtle" ? baseRadius * 0.85 : baseRadius;
    const lineWidth = style === "dramatic" ? 8 : style === "subtle" ? 4 : 6;
    const innerWidth = style === "dramatic" ? 4 : style === "subtle" ? 2 : 3;

    const g = new PIXI.Container();
    const ring = new PIXI.Graphics();
    ring.lineStyle(lineWidth, color, 0.9).drawCircle(0, 0, radius);
    ring.lineStyle(innerWidth, 0xffffff, 0.45).drawCircle(0, 0, radius * 0.86);
    // Spokes
    const spokes = style === "subtle" ? 4 : 8;
    for (let i = 0; i < spokes; i++) {
      const a = (i / spokes) * Math.PI * 2;
      ring
        .moveTo(Math.cos(a) * radius, Math.sin(a) * radius)
        .lineTo(Math.cos(a) * (radius - 14), Math.sin(a) * (radius - 14));
    }
    g.addChild(ring);
    g.position.set(token.center.x, token.center.y);
    g.zIndex = -1;
    canvas.tokens.sortableChildren = true;
    canvas.tokens.addChild(g);
    canvas.tokens.sortChildren?.();

    this.gfx = g;
    this.tok = token;

    const rotSpeed = style === "dramatic" ? 0.02 : style === "subtle" ? 0.006 : 0.012;
    const pulseAmp = style === "dramatic" ? 0.06 : style === "subtle" ? 0.02 : 0.04;

    this.tick = (delta) => {
      if (!this.gfx) return;
      this.gfx.rotation += rotSpeed * delta;
      const s = 1 + Math.sin(performance.now() / 350) * pulseAmp;
      this.gfx.scale.set(s, s);
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
 * Determine if Sequencer + JB2A are available for an upgraded highlight.
 *
 * @returns {boolean}
 */
function canUseSequencer() {
  return Boolean(
    game.modules?.get?.("sequencer")?.active &&
    game.modules?.get?.("jb2a_patreon")?.active &&
    globalThis.Sequencer,
  );
}

/**
 * Show a Sequencer-driven highlight when available.
 *
 * @param {Token} token
 * @returns {boolean} True if Sequencer effect was started.
 */
function tryShowSequencer(token) {
  if (!canUseSequencer()) return false;
  try {
    new Sequencer.Sequence()
      .effect()
      .file("jb2a.template_circle.symbol.normal.runes.yellow")
      .attachTo(token, { followRotation: false })
      .scale(0.7)
      .belowTokens()
      .persist()
      .name(`community-screen.activeTurn.${token.id}`)
      .play();
    return true;
  } catch (err) {
    logger.debug("Sequencer highlight failed; falling back:", err);
    return false;
  }
}

/**
 * Clean up Sequencer effects we created.
 *
 * @returns {void}
 */
function clearSequencer() {
  if (!globalThis.Sequencer?.EffectManager) return;
  try {
    Sequencer.EffectManager.endEffects({ name: /^community-screen\.activeTurn\./ });
  } catch {
    // ignore
  }
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
    clearSequencer();
    return;
  }
  const tok = activeCombatToken();
  if (!tok) {
    highlight.hide();
    clearSequencer();
    return;
  }
  if (tok.document?.hidden) {
    highlight.hide();
    clearSequencer();
    return;
  }
  // v14 Scene Levels guard.
  const tokenLevel = tok.document?.level;
  if (tokenLevel !== undefined && tokenLevel !== canvas?.viewedLevel) {
    highlight.hide();
    clearSequencer();
    return;
  }
  const style = getSetting("highlight-style", "default");
  if (style === "sequencer" || (style === "default" && canUseSequencer())) {
    if (tryShowSequencer(tok)) {
      highlight.hide(); // ensure built-in is gone
      return;
    }
  }
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
    Hooks.on(h, () => {
      highlight.hide();
      clearSequencer();
    });
  }
  Hooks.on("deleteToken", (doc) => {
    if (doc?.id === game.combats?.active?.combatant?.tokenId) {
      highlight.hide();
      clearSequencer();
    }
  });
  Hooks.on("updateToken", () => refresh());

  // React to setting changes (style toggle, disposition toggle).
  Hooks.on("clientSettingChanged", (key) => {
    if (key?.startsWith?.(`${MODULE_ID}.highlight-`)) refresh();
  });
}
