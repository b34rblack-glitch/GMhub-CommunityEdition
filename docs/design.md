# Community Screen — Foundry VTT v14 Module Design

> Canonical design document for the **Community Screen** Foundry VTT module.
> Target version: Foundry VTT v14 stable (14.359+, shipped April 2026).
> Last revised: May 2026.

---

## Contents

1. Executive summary
2. Landscape of existing modules
3. Foundry API reference cheatsheet
4. Recommended architecture
5. v14-specific considerations
6. Open design decisions
7. Module.json and file layout
8. MVP and stretch goals
9. Known risks and gotchas

---

## 1. Executive Summary

The Community Screen module turns a Foundry VTT session into a shared-screen experience for in-person tables. A dedicated player-role user named "Table" drives a TV at the table, showing only maps and tokens. The GM pushes journal entries, item cards, and portraits from their laptop. Players walk up to the TV and drag their own tokens. Vision adapts automatically to whether you're in or out of combat. A glowing ring highlights whose turn it is.

The module is **entirely feasible** on Foundry VTT v14 stable using documented public APIs. Every individual feature has prior art in existing modules — but no single module bundles them into the specific workflow this module targets.

### Recommended high-level approach

1. A single ESModule that runs on every client, branches on `game.user` identity, and uses **socketlib** as its RPC transport.
2. **libWrapper** for safely overriding canvas pan/zoom and other core methods.
3. **CSS body classes** for hiding chrome on the Table client (matching the pattern used by Minimal UI, Monk's Common Display, Stream View).
4. **Programmatic token control** on the Table client during combat to drive vision off the GM-selected token; **OBSERVER ownership on all party actors** out of combat to leverage Foundry's native union-vision behavior.
5. **`Actor.ownership`-managed extension** of the Table user to OWNER on every player-owned actor at module init.
6. **Native pop-out renders** of existing `JournalEntry`, `Item`, and `Actor` sheets via socketlib RPC, plus `ImagePopout` for portraits and handouts. No custom ApplicationV2 is needed for MVP.
7. **`game.keybindings.register`** for GM-only hotkeys.
8. **libWrapper-managed canvas lock** with disengage/reposition/engage pattern bracketing all programmatic pans.
9. **Per-scene aspect-ratio fit** via an injected Scene Config tab; scale computed from `canvas.scene.dimensions` against viewport size.
10. **Custom PIXI v7 overlay** for the active-turn highlight, with optional auto-upgrade to Sequencer + JB2A when those modules are installed.

### Single biggest concern

**Scene Levels** (v14's flagship feature) means the active combatant might be on a level the Table isn't viewing. Highlight visibility and vision focus both need a `canvas.viewedLevel` guard. Most other v14 changes (namespaced APIs, native pop-out applications, Shared Fog of War, Active Effects V2, removed Measured Templates) are tangential to this module.

**Important note about PIXI:** Foundry v14 still ships PIXI v7. PIXI v8 was deferred past v14 per the Foundry team's published roadmap. Use the v7 Graphics API (`.drawCircle()`, `lineStyle()`), not the v8 stateless API.

---

## 2. Landscape of Existing Modules

The table below summarizes every relevant module identified as of May 2026, with what each does well and which gaps remain for this module to fill.

| Module | Status (May 2026) | What it does well | Gap for our use case |
|---|---|---|---|
| **Monk's Common Display** (`ironmonk108/monks-common-display`) | Actively maintained, verified Foundry v14 | The closest existing module. Designates one player as the common display; hides their UI; provides a toolbar to push images/journals; auto-clears popouts on a timer; mirrors or focuses on a GM-controlled token. GPLv3 + Commons Clause. | No "union of party vision out of combat / selected token vision in combat" automation. Manual token ownership extension. Pop-up management is image/journal-centric, not generic for items/portraits. No remote UI-toggle hotkey. No canvas lock or aspect-ratio fit. No combat-turn highlight. **Best module to study — clone and read `monks-common-display.js` for patterns to borrow.** |
| **Stream View** (`sPOiDar/fvtt-module-stream-view`) | Stale (verified Foundry v11) | Pioneered the "dedicated non-player user, auto-strip UI, auto-camera" pattern. Uses Observer permissions on actors for union vision. | Designed for OBS streaming, read-only. No GM pop-ups. No combat-aware vision swap. Not v14 compatible. Useful for camera-tracking and CSS-stripping patterns. |
| **OBS Utils** | Maintained, v13+ | Spiritual successor to Stream View. Detects OBS browser source; follows tokens by permission level; supports custom `/stream` overlays. | Still streaming-oriented, read-only. No interactive workflow. |
| **Display Mode** (`syl3r86/displaymode`) | Older but functional | One-click toggle hides sidebar, scene nav, controls, player list, macro hotbar via CSS. | Per-user manual toggle only. No remote control, no pop-up push. Good minimal reference for CSS approach. |
| **Minimal UI** (`saif-ellafi/foundryvtt-minimal-ui`) | Maintained | Granular hide/collapse/auto-hide of every UI region. CSS-variable theming. | Configuration-driven cosmetics, not a per-client mode. No socket/remote behavior. Useful as a CSS reference for selectors. |
| **Lock View** | Maintained | Locks pan/zoom on a designated view (essential for physical-mini play so grid stays at fixed cm/inch). Has auto-scaling to physical grid. | Tangential but commonly paired with Common Display. Document compatibility, don't duplicate. |
| **TouchVTT** | Actively maintained | Adds proper touch gestures (drag tokens with finger, two-finger pan/zoom, long-press for right-click). | Pure input adapter. Pair with our module on touch-enabled Table screens. List as soft dependency in docs. |
| **PopOut!** (`Posnet/popout`) | Maintained, verified v13.345 | Adds "pop out into separate browser window" to most sheets. Largely obsoleted by v14's native pop-out. | A pop-out paradigm, not modal display. Doesn't solve the "GM clicks, appears centered on Table" workflow. |
| **Theatre Inserts** (League of Foundry Developers) | Maintained | Visual-novel portraits + chat inserts. | Different problem domain, but good code reference for socketlib-based push-to-client patterns and keybindings. |
| **Pull To Display / Go-to-or-pull-player** | Maintained | Pulls all players to a specific scene. Uses socketlib. | Pattern reference for cross-client commands. |
| **socketlib** (`farling42/foundryvtt-socketlib`) | Maintained, near-universal dependency | Easy `socket.executeAsUser(userId, ...)` / `executeAsGM` / `executeForOthers` / `executeForEveryone` with await/return values. | **Hard dependency for our module.** |
| **libWrapper** (`ruipin/fvtt-lib-wrapper`) | Maintained, near-universal dependency | Safe monkey-patching of core methods with conflict resolution. | **Hard dependency for our module** (canvas lock). |
| **Sequencer + JB2A** | Maintained, very popular | Rich animated effects via API. | Soft recommend for upgraded active-turn highlight. |

**Bottom line:** Monk's Common Display is the closest competitor and a great starting reference. Stream View established the dedicated-user pattern. Minimal UI / Display Mode established the CSS hiding pattern. socketlib and libWrapper are the canonical RPC and patching layers. The differentiators for Community Screen are the **combat-aware vision swap**, **automated ownership management**, **canvas lock + aspect-ratio fit**, **active-turn highlight**, and **single-keystroke remote UI toggle** — none bundled together today.

---

## 3. Foundry API Reference Cheatsheet

All examples target Foundry v14 stable. Where v13 differs significantly, it's noted. v12 is not a target.

### 3.1 Module manifest (`module.json`)

```json
{
  "id": "community-screen",
  "title": "Community Screen",
  "description": "Drive a shared TV at the table from the GM laptop.",
  "version": "0.1.0",
  "compatibility": {
    "minimum": "13",
    "verified": "14",
    "maximum": ""
  },
  "authors": [{ "name": "Your Name" }],
  "esmodules": ["scripts/main.mjs"],
  "styles": ["styles/community-screen.css"],
  "languages": [
    { "lang": "en", "name": "English", "path": "lang/en.json" }
  ],
  "socket": true,
  "relationships": {
    "requires": [
      {
        "id": "socketlib",
        "type": "module",
        "manifest": "https://github.com/farling42/foundryvtt-socketlib/releases/latest/download/module.json"
      },
      {
        "id": "lib-wrapper",
        "type": "module",
        "manifest": "https://github.com/ruipin/fvtt-lib-wrapper/releases/latest/download/module.json"
      }
    ],
    "recommends": [
      { "id": "sequencer", "type": "module" },
      { "id": "jb2a_patreon", "type": "module" }
    ]
  },
  "url": "https://github.com/you/community-screen",
  "manifest": "https://github.com/you/community-screen/releases/latest/download/module.json",
  "download": "https://github.com/you/community-screen/releases/download/0.1.0/module.zip"
}
```

Key facts: `id` must be lowercase, hyphen-separated, and match the folder name. `compatibility.minimum`/`maximum` are hard-enforced. Leave `maximum` empty to forward-allow. `"socket": true` is required for any socket use.

### 3.2 Per-client identity and branching

```js
Hooks.once("init", () => {
  game.settings.register("community-screen", "tableUserId", {
    name: "Table User",
    scope: "world",
    config: true,
    type: String,
    default: ""
  });
});

function isTableUser() {
  return game.user.id === game.settings.get("community-screen", "tableUserId");
}
function isGM() { return game.user.isGM; }
```

Use `scope: "world"` for the Table user ID (same across all clients), `scope: "client"` for things like "is the Table UI hidden" (per-browser).

### 3.3 Hiding UI elements via CSS body class

In v13+, main DOM regions are named: `#interface`, `#ui-left`, `#ui-right`, `#ui-top`, `#ui-bottom`, `#sidebar`, `#hotbar`, `#players`, `#scene-navigation`, `#controls`, `#logo`, `#notifications`. Add a class to `<body>` and let CSS hide everything:

```js
if (isTableUser()) document.body.classList.add("community-screen-hidden");
```

```css
body.community-screen-hidden #sidebar,
body.community-screen-hidden #hotbar,
body.community-screen-hidden #players,
body.community-screen-hidden #scene-navigation,
body.community-screen-hidden #controls,
body.community-screen-hidden #logo,
body.community-screen-hidden #navigation,
body.community-screen-hidden #ui-top,
body.community-screen-hidden #ui-bottom,
body.community-screen-hidden #notifications {
  display: none !important;
}
body.community-screen-hidden #board { cursor: default; }
```

**v13+ caveat:** CSS Layers are used for styling precedence. If module CSS doesn't apply, wrap overrides in `@layer modules { … }` or use `!important`.

### 3.4 Socket communication via socketlib

```js
let cs;

Hooks.once("socketlib.ready", () => {
  cs = socketlib.registerModule("community-screen");
  cs.register("showJournal", _showJournal);
  cs.register("showItem", _showItem);
  cs.register("showImage", _showImage);
  cs.register("showPortrait", _showPortrait);
  cs.register("closeAllPopups", _closeAllPopups);
  cs.register("setUiHidden", _setUiHidden);
  cs.register("setVisionFocus", _setVisionFocus);
  cs.register("followScene", _followScene);
  cs.register("followLevel", _followLevel);
});

async function pushJournalToTable(journalUuid) {
  const tableUserId = game.settings.get("community-screen", "tableUserId");
  await cs.executeAsUser("showJournal", tableUserId, { uuid: journalUuid });
}
```

Key socketlib methods: `executeAsUser(handlerName, userId, ...args)`, `executeAsGM(...)`, `executeForOthers(...)`, `executeForEveryone(...)`. All return promises and propagate values. Since this module fundamentally targets one specific user, `executeAsUser` is the workhorse.

Alternative: v13+ added `CONFIG.queries` for inter-client RPC. Less ergonomic but dependency-free. Use socketlib for MVP.

### 3.5 Pop-up dialogs and remote rendering

You almost never need a new ApplicationV2 — Foundry's existing sheets do everything needed. A `render(true)` call on the Table client puts them on screen.

```js
// Runs on the Table client.
async function _showJournal({ uuid, pageId }) {
  const doc = await fromUuid(uuid);
  if (!doc) return;
  const sheet = doc.sheet;
  await sheet.render(true);
  window.communityScreen.openSheets.add(sheet);
  if (pageId) sheet.goToPage?.(pageId);
}

async function _showItem({ uuid }) {
  const item = await fromUuid(uuid);
  await item?.sheet?.render(true);
  window.communityScreen.openSheets.add(item.sheet);
}

async function _showImage({ src, caption }) {
  // v14 namespaced — use foundry.applications.apps.ImagePopout
  const ip = new foundry.applications.apps.ImagePopout(src, {
    title: caption,
    shareable: false
  });
  await ip.render(true);
  window.communityScreen.openImages.add(ip);
}

async function _showPortrait({ actorUuid }) {
  const actor = await fromUuid(actorUuid);
  const img = actor?.img;
  if (img) return _showImage({ src: img, caption: actor.name });
}

async function _closeAllPopups() {
  for (const s of window.communityScreen.openSheets) {
    try { await s.close({ animate: false }); } catch (e) {}
  }
  for (const ip of window.communityScreen.openImages) {
    try { await ip.close({ animate: false }); } catch (e) {}
  }
  window.communityScreen.openSheets.clear();
  window.communityScreen.openImages.clear();
}
```

Notes:

- `ImagePopout` extends ApplicationV2 in v14 and lives at `foundry.applications.apps.ImagePopout`. Set `shareable: false` so the Table user can't accidentally re-share back.
- For centering sheets, pass `{ position: { left, top, width, height } }` to `render`, or use `sheet.setPosition(...)` after render.
- **v14 native pop-out button:** AppV2 sheets get a "pop out" header control by default. Filter it off on the Table client (see §4.2).
- `DialogV2` lives at `foundry.applications.api.DialogV2`. Old `Dialog` still works but deprecated.

### 3.6 Vision and perception

The pieces:

- `Token.control({releaseOthers: true})` / `Token.release()` — programmatically select/deselect a token on the current client. Changing the controlled token automatically re-binds the visibility layer to that token's vision sources.
- `canvas.tokens.controlled` — array of currently controlled tokens.
- `canvas.perception.update({ refreshVision: true, refreshLighting: true })` — request a vision/lighting refresh on next frame.
- `canvas.visibility` (v13+: `CanvasVisibility` group) — owns the fog and visibility texture. Don't override directly.
- `TokenDocument.sight` — per-token vision configuration. Don't write from this module.
- `PointVisionSource#level` (v14) — vision sources now have level awareness.
- **Native union vision:** A user with OBSERVER or OWNER on multiple actors automatically sees the union of all those tokens' vision in the current scene. Stream View relies on exactly this trick. Granting the Table user OBSERVER on every player actor produces union party vision for free when no token is controlled.

```js
// Table client receives a "follow this token" command from the GM:
async function _setVisionFocus({ tokenId }) {
  if (!tokenId) {
    // Release everything → Foundry falls back to union of OBSERVER actors.
    canvas.tokens.controlled.forEach(t => t.release());
  } else {
    const tok = canvas.tokens.get(tokenId);
    tok?.control({ releaseOthers: true });
  }
  canvas.perception.update({
    refreshVision: true,
    refreshLighting: true,
    refreshSounds: true
  });
}
```

**v14.360 change:** Token-control auto-pan is suppressed when controlling a token on a different level than the current view. Good news for our canvas lock — one less auto-pan to fight.

### 3.7 Combat tracker hooks

Names unchanged from v10 through v14:

```js
Hooks.on("combatStart",  (combat, updateData) => { /* … */ });
Hooks.on("combatTurn",   (combat, updateData, updateOptions) => { /* … */ });
Hooks.on("combatRound",  (combat, updateData, updateOptions) => { /* … */ });
Hooks.on("updateCombat", (combat, changes, options, userId) => { /* … */ });
Hooks.on("deleteCombat", (combat, options, userId) => { /* … */ });
```

`game.combat` / `game.combats.active` give you the currently running combat on any client. `combat.started` is true when an encounter is active. Known quirk: in `combatStart` the value of `game.combat.started` is briefly still `false`; rely on the hook firing.

```js
function anyCombatActive() {
  return game.combats.some(c => c.active && c.started);
}
```

The GM client is the source of truth for "is combat active" and "what is selected" — broadcast a single high-level `setVisionFocus({tokenId})` socket call rather than having the Table client recompute combat state.

### 3.8 Token / Actor ownership

Constants (stable since v10):

```js
CONST.DOCUMENT_OWNERSHIP_LEVELS = {
  INHERIT:  -1,
  NONE:      0,
  LIMITED:   1,
  OBSERVER:  2,
  OWNER:     3
};
```

**Actor vs Token ownership.** Ownership is stored on the Actor; a placed `TokenDocument` inherits its actor's ownership unless it's an "unlinked" token (typical for monsters), in which case the token has its own ownership. For linked PCs, manage ownership on the Actor.

```js
async function grantTableOwnership(actor, level = CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER) {
  const tableId = game.settings.get("community-screen", "tableUserId");
  if (!tableId) return;
  if (actor.ownership[tableId] === level) return;
  const ownership = foundry.utils.deepClone(actor.ownership);
  ownership[tableId] = level;
  // Must be called by a GM client.
  await actor.update({ ownership });
}

Hooks.on("ready", async () => {
  if (!game.user.isGM) return;
  for (const actor of game.actors) {
    if (actor.hasPlayerOwner) await grantTableOwnership(actor);
  }
});
Hooks.on("createActor", (actor) => {
  if (!game.user.isGM) return;
  if (actor.hasPlayerOwner) grantTableOwnership(actor);
});
```

Choose **OBSERVER** for see-through-only; **OWNER** if the Table client should drag the token. This module uses OWNER on PCs (so players can walk up and drag).

Note: `actor.hasPlayerOwner` becomes true once the Table user has ownership, since Table is a Player role. Guard with `actor.ownership[someNonTableUserId] >= 2` to be precise about "real" player ownership.

### 3.9 Keybindings

`game.keybindings.register` is stable from v9 through v14. Must be called inside the `init` hook.

```js
Hooks.once("init", () => {
  game.keybindings.register("community-screen", "toggleTableMode", {
    name: "Toggle Table Screen UI",
    hint: "Show/hide UI and unlock/lock the canvas on the Table client.",
    editable: [{ key: "KeyU", modifiers: ["Control", "Shift"] }],
    onDown: () => {
      if (!game.user.isGM) return false;
      cs.executeAsUser("toggleTableMode", game.settings.get("community-screen", "tableUserId"));
      return true;
    },
    restricted: true,
    precedence: CONST.KEYBINDING_PRECEDENCE.NORMAL
  });

  game.keybindings.register("community-screen", "closeAllPopups", {
    name: "Close All Table Pop-ups",
    editable: [{ key: "KeyP", modifiers: ["Control", "Shift"] }],
    onDown: () => {
      if (!game.user.isGM) return false;
      cs.executeAsUser("closeAllPopups", game.settings.get("community-screen", "tableUserId"));
      return true;
    },
    restricted: true
  });
});
```

`restricted: true` makes it GM-only. Return `true` from `onDown` to consume the event.

### 3.10 GM-only vs client-specific code

```js
game.user.isGM           // true for GM and Assistant GM
game.user.role           // CONST.USER_ROLES.{NONE, PLAYER, TRUSTED, ASSISTANT, GAMEMASTER}
game.user.id             // unique per user
```

Settings scope:
- `"world"` — stored on server, same for all clients (use for tableUserId, fit-mode).
- `"client"` — stored in localStorage per browser (use for table-mode, last-vision-focus).

Pattern: register settings and hooks on all clients in `init`, guard runtime branches with `isTableUser()` / `isGM()`. The Table client should never `update()` ownership itself (it's a Player); route ownership writes through `executeAsGM`.

### 3.11 The official "stream view" feature

Foundry core supports a `/stream` URL route on the server. Browsing to `/stream` gives a stripped-down read-only view with chat overlay, primarily for OBS browser sources. A `streamReady` hook exists for stream-specific initialization.

**Why `/stream` is not sufficient:**

1. Read-only — no token interaction, no controls. Players can't drag tokens.
2. Automatic camera; can't programmatically pop up sheets.
3. Vision shows the connected user's vision but doesn't expose the `Token.control` interactivity.
4. Can't bind keys or render arbitrary Applications inside it.

The **Stream View module** simulates `/stream`-like UI in a normal game session by hiding chrome via CSS when logged in as a designated user. That's the right paradigm — the difference is we also want input and we want GM push.

### 3.12 Locking the canvas (no pan / no zoom)

The Table screen should not zoom or pan once the map is staged — physical minis don't move when the GM rolls a wheel. Foundry has no built-in "locked canvas" flag, but several hooks/methods let you enforce one. The robust pattern (which Lock View uses):

1. Capture-phase `wheel` listener on `#board` that calls `preventDefault()` and `stopPropagation()`.
2. **libWrapper** `OVERRIDE` on `Canvas.prototype.pan` and `Canvas.prototype.animatePan` while locked.
3. `canvasPan` hook as a defensive fallback that snaps back to the locked position if anything slips through.

```js
let locked = false;
let target = null;  // { x, y, scale } — the locked viewport state

function blockWheel(e) { e.stopPropagation(); e.preventDefault(); }

function engageLock() {
  if (locked) return;
  target = {
    x: canvas.stage.pivot.x,
    y: canvas.stage.pivot.y,
    scale: canvas.stage.scale.x
  };
  document.getElementById("board")
    ?.addEventListener("wheel", blockWheel, { capture: true, passive: false });
  libWrapper.register("community-screen", "Canvas.prototype.pan", () => {}, "OVERRIDE");
  libWrapper.register("community-screen", "Canvas.prototype.animatePan", () => Promise.resolve(), "OVERRIDE");
  document.body.classList.add("community-screen-locked");
  locked = true;
}

function disengageLock() {
  if (!locked) return;
  document.getElementById("board")
    ?.removeEventListener("wheel", blockWheel, { capture: true });
  libWrapper.unregister("community-screen", "Canvas.prototype.pan");
  libWrapper.unregister("community-screen", "Canvas.prototype.animatePan");
  document.body.classList.remove("community-screen-locked");
  locked = false;
}
```

**Pattern: disengage → reposition → engage.** Any time your code needs to pan/zoom (scene fit, manual GM-driven spotlight), unlock, do the move, relock.

Caveats:

- **Token drag still works.** Token input is handled by the tokens layer's interaction manager, not the canvas pan handler.
- **Auto-pan on `Token.control()`.** Selecting a token can trigger an auto-pan; v14.360 suppresses this for cross-level controls. For same-level controls, rely on the lock catching it.
- **`Scene.view()` calls `animatePan` internally.** Unlock before scene switches, relock after.
- **libWrapper** is a near-universal community library. Hard dependency for this module.

### 3.13 Scene fit and aspect ratio

Different Table screens have different aspect ratios — 16:9 TV, 21:9 ultrawide, wall-mounted vertical 9:16. Foundry centers scenes at 100% zoom by default. To make every scene look right on your Table, compute scale and pan once per scene.

```js
const dims = canvas.scene.dimensions;
// dims.sceneX, sceneY, sceneWidth, sceneHeight — playable area
// dims.width, height                            — total canvas
// dims.size                                     — grid size in px
```

Five fit modes:

```js
function computeFit({ sceneW, sceneH, vpW, vpH, mode }) {
  const sx = vpW / sceneW;
  const sy = vpH / sceneH;
  switch (mode) {
    case "contain": return Math.min(sx, sy);   // whole map visible, letterboxed
    case "cover":   return Math.max(sx, sy);   // map fills screen, edges cropped
    case "width":   return sx;                  // fit to width
    case "height":  return sy;                  // fit to height
    case "native":  return 1.0;                 // pixel-for-pixel
  }
}

async function fitSceneToTable() {
  if (!canvas.scene) return;
  const dims = canvas.scene.dimensions;
  const sceneFit = canvas.scene.getFlag("community-screen", "fitMode");
  const mode = sceneFit && sceneFit !== "default"
    ? sceneFit
    : game.settings.get("community-screen", "fitMode");

  const rawScale = computeFit({
    sceneW: dims.sceneWidth, sceneH: dims.sceneHeight,
    vpW: window.innerWidth, vpH: window.innerHeight, mode
  });
  // Round to 2 decimals — sub-pixel scales shimmer grid lines in PIXI.
  const scale = Math.round(rawScale * 100) / 100;

  disengageLock();
  await canvas.animatePan({
    x: dims.sceneX + dims.sceneWidth / 2,
    y: dims.sceneY + dims.sceneHeight / 2,
    scale,
    duration: 250
  });
  engageLock();
}

Hooks.on("canvasReady", () => { if (isTableUser()) fitSceneToTable(); });

let resizeTimer;
window.addEventListener("resize", () => {
  if (!isTableUser()) return;
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(fitSceneToTable, 200);
});
```

Inject a Scene Config section so the GM picks fit mode per-scene:

```js
Hooks.on("renderSceneConfig", (app, html, data) => {
  if (!game.user.isGM) return;
  const mode = app.object.getFlag("community-screen", "fitMode") ?? "default";
  const $section = $(`
    <fieldset>
      <legend>Community Screen</legend>
      <div class="form-group">
        <label>Fit mode for the Table</label>
        <select name="flags.community-screen.fitMode">
          <option value="default" ${mode==="default"?"selected":""}>Use world default</option>
          <option value="contain" ${mode==="contain"?"selected":""}>Contain (letterbox)</option>
          <option value="cover"   ${mode==="cover"  ?"selected":""}>Cover (crop)</option>
          <option value="width"   ${mode==="width"  ?"selected":""}>Fit width</option>
          <option value="height"  ${mode==="height" ?"selected":""}>Fit height</option>
          <option value="native"  ${mode==="native" ?"selected":""}>Native (1:1)</option>
        </select>
      </div>
    </fieldset>
  `);
  html.find(".tab[data-tab='basic']").append($section);
});
```

Caveats:

- **Map aspect ratio ≠ scene aspect ratio.** Foundry fits the scene rect, not the underlying image. If a map has black margins baked in or extends past the scene rect, it won't fit cleanly — fix by trimming the scene rect.
- **`contain` letterboxing.** A 4096×2048 map on 1920×1080 in `contain` mode gets black bars top/bottom. Pick `cover` if you'd rather lose some map than have bars.
- **Vision/fog cover the scene rect**, not the image. If the map extends past the scene rect, those pixels are visible only if your fit mode shows them.
- **Sub-pixel scale shimmer.** Non-integer zooms shimmer grid lines. The 2-decimal rounding handles this.

### 3.14 Custom PIXI overlays (active-turn highlight)

The Foundry canvas is a **PIXI.js v7** stage. (PIXI v8 was deferred past v14; do not use v8 syntax.) Attach any `PIXI.Container` to a canvas layer and animate via `canvas.app.ticker`. Two clean attachment points:

- **`canvas.tokens`** — same layer as tokens. Set `zIndex: -1` and `sortableChildren = true` to render behind tokens. Recommended.
- **`canvas.interface`** — UI-overlay layer, always above lighting/effects/fog. Use this if the highlight must be visible through fog.

```js
class ActiveTurnHighlight {
  constructor() { this.gfx = null; this.tick = null; this.tok = null; }

  show(token, { color = 0xffd24a, large = false } = {}) {
    this.hide();
    if (!token || !canvas.tokens) return;

    const radius = Math.max(token.w, token.h) * (large ? 0.85 : 0.65);
    const g = new PIXI.Container();

    const ring = new PIXI.Graphics();
    // PIXI v7 API — drawCircle and lineStyle, NOT v8's .circle()
    ring.lineStyle(6, color, 0.9).drawCircle(0, 0, radius);
    ring.lineStyle(3, 0xffffff, 0.45).drawCircle(0, 0, radius * 0.86);
    // Spokes — make the rotation visible.
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      ring.moveTo(Math.cos(a) * radius, Math.sin(a) * radius)
          .lineTo(Math.cos(a) * (radius - 14), Math.sin(a) * (radius - 14));
    }
    g.addChild(ring);
    g.position.set(token.center.x, token.center.y);
    g.zIndex = -1;
    canvas.tokens.sortableChildren = true;
    canvas.tokens.addChild(g);
    canvas.tokens.sortChildren();

    this.gfx = g; this.tok = token;
    this.tick = (delta) => {
      if (!this.gfx) return;
      this.gfx.rotation += 0.012 * delta;
      const s = 1 + Math.sin(performance.now() / 350) * 0.04;
      this.gfx.scale.set(s, s);
      if (this.tok?.center) this.gfx.position.set(this.tok.center.x, this.tok.center.y);
    };
    canvas.app.ticker.add(this.tick);
  }

  hide() {
    if (this.gfx) {
      this.gfx.parent?.removeChild(this.gfx);
      this.gfx.destroy({ children: true });
      this.gfx = null;
    }
    if (this.tick) {
      canvas.app.ticker.remove(this.tick);
      this.tick = null;
    }
    this.tok = null;
  }
}

const highlight = new ActiveTurnHighlight();

function activeCombatToken() {
  const c = game.combats.active;
  if (!c?.started) return null;
  return canvas.tokens.get(c.combatant?.tokenId);
}

function refresh() {
  if (!isTableUser()) return;
  const tok = activeCombatToken();
  if (!tok || tok.document.hidden) return highlight.hide();
  // v14 Scene Levels guard:
  if (tok.document.level !== undefined && tok.document.level !== canvas.viewedLevel) {
    return highlight.hide();
  }
  const color = tok.document.disposition < 0 ? 0xc94c4c
              : tok.document.disposition > 0 ? 0xffd24a
              : 0x88aabb;
  highlight.show(tok, { color, large: true });
}

["updateCombat","combatStart","combatTurn","combatRound","canvasReady"]
  .forEach(h => Hooks.on(h, refresh));
["combatEnd","deleteCombat"].forEach(h => Hooks.on(h, () => highlight.hide()));
Hooks.on("deleteToken", (doc) => {
  if (doc.id === game.combats.active?.combatant?.tokenId) highlight.hide();
});
```

Useful PIXI v7 patterns:

- **Glow:** `new PIXI.BlurFilter()` (cheap) or `OutlineFilter` from `@pixi/filter-outline` (bundled with Foundry's PIXI build). Apply via `g.filters = [filter]`.
- **Animated texture:** prefer a pre-rendered animated WebP/sprite over per-frame drawing for richer effects. `PIXI.Sprite.from("modules/community-screen/assets/turn-glow.webp")`.
- **Disposition color:** the snippet keys off `token.document.disposition` (`-1`/`0`/`1`). Some tables consider this metagaming — expose a "single neutral color" setting.
- **Size scaling:** large/huge tokens have `token.w === gridSize * N`. Basing radius on `Math.max(token.w, token.h)` scales correctly.

**Optional Sequencer + JB2A integration.** If both modules are active, swap the custom graphics for a Sequencer effect:

```js
new Sequence()
  .effect()
    .file("jb2a.template_circle.symbol.normal.runes.yellow")
    .attachTo(token, { followRotation: false })
    .scale(0.7)
    .belowTokens()
    .persist()
    .name(`community-screen.activeTurn.${token.id}`)
  .play();
// Clear:
Sequencer.EffectManager.endEffects({ name: `community-screen.activeTurn.${token.id}` });
```

Feature-detect with `game.modules.get("sequencer")?.active && game.modules.get("jb2a_patreon")?.active`. List as `recommends` in `module.json`, not `requires`.

---

## 4. Recommended Architecture

### 4.1 "Which client is the Table?"

**Recommendation: one world setting (`tableUserId`).** Reasons:

- Persistent: the Table user always knows it's the Table user, even after reload.
- Single source of truth: socketlib's `executeAsUser(handler, userId)` needs a user id.
- Mirrors Stream View / Common Display, which players understand.

Don't expose a per-client toggle; users accidentally enabling "Table mode" on their laptop will be mystified by missing UI.

Pick the user from a dropdown in module settings (`type: String` populated at render time, listing `game.users` minus GMs). A right-click context-menu entry on the player list ("Set as Community Screen") is a nice v0.2 addition.

### 4.2 Pop-ups: own ApplicationV2 vs render existing sheets

**Recommendation: render the existing sheets.** Reasons:

- Zero system-specific code. D&D 5e item sheet, PF2e item sheet, OSE journal sheet all render correctly because they're the system's own code.
- Pages, tabs, drag-to-create, link-handling — already wired.
- Less code to maintain across v13/v14/v15.

The module's only owned UI components should be:

1. A small **"Push to Table"** header button injected into JournalEntry, Item, Actor, and Scene sheets (via `getHeaderControlsApplicationV2` for AppV2, or `getApplicationHeaderControls` / `_getHeaderButtons` for legacy v1 sheets).
2. A **GM control palette** (small ApplicationV2 window) with recent pushes, "Close All" button, vision-mode toggle, UI-toggle button. Thin convenience wrapper around socketlib calls.

For "centered modal" presentation on the Table, render the sheet then `sheet.setPosition({ left, top, width: 900, height: 700 })`. Add a CSS rule `body.community-screen-modal-bg::before { content:''; position:fixed; inset:0; background:rgba(0,0,0,0.6); z-index:99; }` toggled when any push is open.

**Filter native pop-out button on Table client.** v14 AppV2 sheets get a "pop out" header control by default. On the Table this would launch a new browser window the players can't see on the TV.

```js
Hooks.on("getHeaderControlsApplicationV2", (app, controls) => {
  if (!isTableUser()) return;
  const idx = controls.findIndex(c => c.action === "popout");
  if (idx >= 0) controls.splice(idx, 1);
});
```

### 4.3 Vision switching

**Recommendation: programmatically control which token is "controlled" on the Table client; default to no control (union vision) when out of combat.**

Workflow:

1. **GM init:** ensure the Table user has OBSERVER or OWNER on every PC actor. Without this, none of the vision logic works.
2. **GM hooks** `controlToken`: if `game.combat?.started`, socket the selected token's id to the Table; if GM releases, socket `null`.
3. **GM hooks** `combatStart` / `combatEnd` / `updateCombat`: on `combatStart`, send GM's currently controlled token; on `combatEnd`, send `null`.
4. **Table client** receives `setVisionFocus({tokenId})`, calls `Token.get(id)?.control({releaseOthers: true})` or releases all, then `canvas.perception.update({refreshVision: true, refreshLighting: true})`.

Why not swap a built-in `VisionMode`? VisionMode is a visual filter (Basic Sight, Darkvision) on the active POV — it doesn't change *which* tokens contribute. The cleanest semantics are Foundry's own native rule: "controlled-token-vision when one is controlled, union-of-observed-tokens otherwise."

**Edge cases:**

- *No PC actor has OBSERVER on the Table user:* the Table sees nothing. Detect at `ready` and `ui.notifications.warn` the GM client.
- *Scene without vision:* nothing to do; the canvas shows the whole map. Module is a no-op.
- *Token deleted mid-combat while Table is following it:* listen to `deleteToken` on Table and release.

### 4.4 UI hiding

**Recommendation: body class + CSS.** Avoid suppressing `render*` hooks — they don't actually cancel render in AppV2; you'd need libWrapper monkey-patches, which is fragile. CSS `display: none` on elements is what Monk's Common Display, Display Mode, and Minimal UI all do, and it's robust against v14 AppV2 changes.

```js
function setUiHidden(hidden) {
  document.body.classList.toggle("community-screen-hidden", hidden);
  canvas?.app?.renderer.resize(window.innerWidth, window.innerHeight);
  canvas?.stage && canvas.pan(canvas.scene._viewPosition ?? {});
}
```

Reveal the UI temporarily by removing the body class. The Table user's client settings persist "last hidden state" across reload.

### 4.5 Concurrency / race conditions

- **GM closes all popups while one is mid-render:** wrap `sheet.close()` in try/catch and `await sheet.render()` before tracking. socketlib calls are awaited end-to-end. Mark sheets `pending` until `render` resolves.
- **Combat ends while a token is selected:** on `deleteCombat`/`combatEnd`, always send `setVisionFocus({tokenId: null})`. Idempotent.
- **GM controls multiple tokens at once:** `controlToken` fires per token; debounce on the GM side (50ms) and send the first selected, or send array and let Table pick first.
- **Table user not connected when GM pushes:** `executeAsUser` rejects. Catch and `ui.notifications.warn(game.user, "Table client is not connected.")`.

### 4.6 Multi-scene and multi-level behavior

When the GM switches scenes via `Scene.view()`, other clients don't automatically follow — only the GM is taken there. To make the Table follow, mirror by socket:

```js
Hooks.on("canvasReady", () => {
  if (!isGM()) return;
  cs.executeAsUser("followScene", tableUserId, { sceneId: canvas.scene.id });
});

async function _followScene({ sceneId }) {
  const scene = game.scenes.get(sceneId);
  if (scene && scene.id !== canvas.scene?.id) await scene.view();
}
```

Caveats:

- `Scene.view()` is async; await on the Table side.
- Table user needs at least LIMITED permission on the scene. Either keep scenes at world-default LIMITED for players, or grant the Table user OBSERVER on all scenes.
- After scene change, re-apply your vision focus (controlled-token gets cleared on scene change).

**v14 Scene Levels mirroring.** When the GM switches level on their own client, the Table doesn't automatically follow. Mirror via socket:

```js
function onLevelChange() {
  if (!isGM()) return;
  cs.executeAsUser("followLevel", tableUserId, {
    sceneId: canvas.scene.id,
    level: canvas.viewedLevel
  });
}

async function _followLevel({ sceneId, level }) {
  if (canvas.scene?.id !== sceneId) return;
  if (typeof canvas.viewLevel === "function") {
    await canvas.viewLevel(level);
  }
}
```

Caveats:

- **Level-switching API is new** and may still evolve through v14.36x. Wrap in try/catch and feature-detect.
- **No dedicated `levelChange` hook yet.** Detect via `canvasReady` or poll `canvas.viewedLevel`.
- **Combat across levels:** active combatant might flip levels mid-combat. The highlight follows on the viewed level only; switch levels manually to keep up.

### 4.7 Canvas lock on the Table client

**Recommendation: a `locked` state on the Table client, defaulting to ON, with the same hotkey that toggles the UI also temporarily unlocking the canvas.** Three reasons:

1. UI-hidden state and canvas-locked state are conceptually paired ("play mode" vs "setup mode"). One toggle controls both.
2. A GM walking up to the Table to adjust something needs both controls visible and canvas pannable.
3. Programmatic pans from your own module bracket their work with `disengageLock()` / `engageLock()` regardless of user-facing state.

State machine on the Table client:

- **Play mode (default):** UI hidden, canvas locked. Tokens can be dragged (drag is a separate input path). Players walk up, grab their token, move it.
- **Setup mode (toggled):** UI visible, canvas unlocked. Used for scene staging, troubleshooting, or letting a player do something complex.

Tie state to a single client setting (`tableMode: "play" | "setup"`) so a Table-browser reload preserves state.

### 4.8 Map fit on scene change

**Recommendation: a world default fit mode plus a per-scene override.** Most scenes look right with `contain`. The exceptions (tall vertical battlemap, extreme-aspect overland map) get an override via the Scene Config tab the module injects.

Recompute and re-fit on three triggers:

1. **`canvasReady`** — every scene change. Fit happens before `engageLock()`.
2. **`window.resize`** (debounced 200ms) — handles fullscreen toggle, OS taskbar, browser resizing.
3. **Explicit "Refit" button** in GM control palette — escape hatch.

Avoid: `renderSceneNavigation` (fires too often) or `updateScene` (fires for unrelated edits like lighting changes).

### 4.9 Active-turn highlight

**Recommendation: built-in PIXI v7 overlay by default; auto-upgrade to Sequencer + JB2A if installed; Table-only by default with opt-in for other clients.**

Why Table-only by default:

- The GM's combat tracker UI already makes the active combatant obvious.
- Players' own laptops are usually showing character sheets, not the map.
- The Table screen is the one place where a strong visual cue is genuinely useful — it's what the room is looking at.

Configuration surface:

- **`highlight-enabled`** (client setting, default `true` on Table / `false` elsewhere) — show/hide on this client.
- **`highlight-style`** (world setting) — `subtle` / `default` / `dramatic` / `sequencer` (auto if available).
- **`highlight-use-disposition`** (world setting, default `true`) — color by disposition or single neutral color.

Edge cases:

- **No token on current scene** (stale combat tracker entry). Hide; don't error.
- **Hidden combatants** (`token.document.hidden === true`). Default: hide highlight too — broadcasting a hidden creature's turn defeats the purpose.
- **Token moves during turn.** Ticker callback follows `token.center`.
- **Two simultaneous combats.** Use `game.combats.active`; ignore others.
- **Active combatant on non-viewed level.** Hide (v14 Scene Levels guard).

---

## 5. v14-Specific Considerations

### 5.1 Scene Levels

v14's flagship feature. Scenes can have multiple vertically stacked map images, each at a defined elevation. Tokens, vision sources, walls, lights all live at a specific level. The GM picks the "viewed" level via scene nav; this propagates as `canvas.viewedLevel`.

Affects four parts of this module:

**Fit-to-screen.** Unchanged — scene dimensions are level-independent.

**Active-turn highlight.** Hide if active token is on a non-viewed level (see §3.14 / §4.9 guard).

**Vision focus.** When the GM switches level, the Table doesn't auto-follow — mirror via `followLevel` socket call (see §4.6).

**Canvas lock.** Unchanged — level changes don't trigger canvas re-creation, just swap textures.

### 5.2 Shared Fog of War

v14 added a per-scene "Fog Exploration" setting:

- **Disabled** — no fog tracking.
- **Individual** (default, v13 behavior) — per-player fog state.
- **Shared** — all players see the same explored fog; one player exploring reveals for everyone.

**Important:** "Shared" unions explored fog state, *not* live vision. Our OBSERVER-ownership trick for live union vision is still required. The two systems compose naturally — set Shared exploration on every scene the party uses for a cleaner UX, and let our ownership trick handle live vision.

Recommendation: settings toggle "Auto-set Shared Fog on new scenes" that flips `scene.fog.exploration = "shared"` on `createScene`.

### 5.3 Native pop-out applications

v14 lets any AppV2 application pop out into a separate browser window via a default header control. This is what the PopOut! module pioneered, now in core.

For our use case:

- **Cross-client push is still socket-based.** Native pop-out pops on the *same* user's client; can't push to a different user. socketlib RPC stays.
- **On the Table client**, native pop-out is *worse* than rendered-in-place — pop-ups go to separate OS windows the players can't see on the TV.
- **On the GM client**, native pop-out is useful for the GM's own workflow (e.g. dragging an NPC sheet onto a second monitor). Free win, no code needed.

Disable the pop-out button on Table-rendered sheets (see §4.2 code).

### 5.4 Namespace migration

All client classes live under the `foundry.*` namespace in v14. Old globals still work as deprecation shims, but new code should use namespaces:

| Old global | v14 namespace |
|---|---|
| `Canvas` | `foundry.canvas.Canvas` |
| `Application` | `foundry.applications.api.ApplicationV2` |
| `Dialog` | `foundry.applications.api.DialogV2` |
| `FormApplication` | `foundry.applications.api.HandlebarsApplicationMixin(ApplicationV2)` |
| `ImagePopout` | `foundry.applications.apps.ImagePopout` |
| `JournalSheet` | `foundry.applications.sheets.journal.JournalEntrySheet` (mostly) |
| `CONST`, `Hooks`, `game`, `canvas`, `ui`, `CONFIG` | unchanged, still globals |

Practical advice: import the namespaces you actually touch; rely on shims for the rest. Most module code uses globals that haven't moved.

Sheet header buttons: use `getHeaderControlsApplicationV2` for AppV2; legacy `getApplicationHeaderControls` for v1 sheets. Foundry systems are mid-migration — D&D 5e mostly AppV2; PF2e partially; older systems mostly still V1.

### 5.5 System compatibility

At v14.359 launch (April 2026), confirmed compatible systems:

- **D&D 5e** ✓
- **Crucible** (Foundry's own) ✓
- **Universal Tabletop System** ✓
- **PF2e** — *not ready at launch*; community team caught up by mid-May 2026.

By mid-May 2026, most major systems work on v14 (check each system's package page before recommending). **This module is system-agnostic** — no code paths touch system data — so it works wherever core Foundry v14 works. Document in README: "If your system isn't v14-compatible yet, this module won't help."

---

## 6. Open Design Decisions

Real tradeoffs to pick consciously:

1. **OBSERVER or OWNER on PCs for the Table user?**
   - OBSERVER is minimum for vision-through. Can't drag tokens with OBSERVER.
   - OWNER lets Table drag tokens, but the Table user now also "owns" PCs for chat-speaking-as. Mitigation: override speaker on `preCreateChatMessage` to use original owner when `game.user.id === tableUserId`.
   - **Recommendation:** OWNER on PCs, OBSERVER on NPC/hostile (rarely). Document the chat speaker quirk; provide a setting.

2. **Single keystroke vs toolbar button for "Close all popups"?**
   - Both. Keystroke is fast; toolbar button is discoverable.

3. **Push from sheet header vs separate macro/palette?**
   - Sheet headers are most discoverable. Add `getHeaderControlsApplicationV2` for AppV2 sheets and legacy header hook for v1. Also add to right-click context menu on directory entries.

4. **Should the Table client be allowed to talk in chat?**
   - No. Add setting "Suppress chat input on Table client" (default on) and CSS-hide `#chat-form`.

5. **Auto-clear popups on a timer?**
   - Useful for image/portrait pushes (default 30s). Painful for journals the GM wants left open. Per-push-type configurable.

6. **GM selection outside combat?**
   - Spec says: "out of combat → party union vision." GM's selection ignored out of combat. Correct because GM often selects NPCs/traps/walls/lights. Only override: manual "Spotlight this token on the Table" toolbar button.

7. **Multiple active combats?**
   - Use `game.combats.active`; ignore others.

8. **socketlib hard-dependency, or fall back to `CONFIG.queries`?**
   - For MVP, hard-depend. socketlib is already a transitive dependency of dozens of modules. Document fallback to `CONFIG.queries` as v0.3 goal.

9. **Lock + UI toggle: one hotkey or two?**
   - One (paired play/setup mode). Reasons: same conceptual state, GM at the Table needs both unlocked simultaneously. Two hotkeys if you ever want "canvas locked, UI visible" — not the common case.

---

## 7. Module.json and File Layout

```
community-screen/
├── module.json
├── README.md
├── LICENSE
├── CHANGELOG.md
├── CLAUDE.md                        # Claude Code context
├── .gitignore
├── .editorconfig
├── package.json                     # prettier/eslint dev deps only
├── eslint.config.js
├── .prettierrc.json
├── docs/
│   └── design.md                    # this document
├── lang/
│   └── en.json
├── styles/
│   ├── community-screen.css         # body-class UI hiding
│   ├── popups.css                   # centered/modal popup styling
│   └── push-buttons.css             # styles for injected header buttons
├── templates/
│   ├── control-palette.hbs          # GM's AppV2 control window
│   └── settings-helper.hbs          # custom user-picker for tableUserId
└── scripts/
    ├── main.mjs                     # entry point: init/ready hooks, branching
    ├── module.mjs                   # module-wide constants and namespace
    ├── settings.mjs                 # all game.settings.register calls
    ├── identity.mjs                 # isTableUser, isGM, tableUserId helpers
    ├── sockets.mjs                  # socketlib registration + handler dispatch
    ├── ui-hiding.mjs                # body-class toggle, setUiHidden
    ├── canvas-lock.mjs              # libWrapper pan/zoom block
    ├── scene-fit.mjs                # aspect-ratio fit; renderSceneConfig hook
    ├── ownership.mjs                # auto-grant Table user OWNER on PCs
    ├── vision.mjs                   # controlToken/combat → Table token control
    ├── popups.mjs                   # showJournal/Item/Image/Portrait/closeAll
    ├── push-buttons.mjs             # sheet header injection + directory CSM
    ├── keybindings.mjs              # game.keybindings.register
    ├── scene-follow.mjs             # canvasReady → followScene; level mirror
    ├── combat-highlight.mjs         # active-turn PIXI overlay
    ├── control-palette.mjs          # GM's AppV2 control window
    └── lib/
        ├── logger.mjs               # consistent module-prefixed logging
        └── helpers.mjs              # shared utilities
```

The module.json from §3.1 plus this layout gets you to "hello world" cleanly. No build step. Optional TypeScript via `@league-of-foundry-developers/foundry-vtt-types` is widely used but adds tooling complexity — vanilla ESM is recommended for MVP.

---

## 8. MVP and Stretch Goals

### MVP (v0.1 — ship this and play with it)

1. `tableUserId` world setting + picker UI.
2. Body-class CSS UI hiding on Table client.
3. socketlib registration + handlers: `showJournal`, `showItem`, `showImage`, `showPortrait`, `closeAllPopups`, `setVisionFocus`, `setUiHidden`, `setTableMode`, `followScene`, `followLevel`, `toggleUi`.
4. GM-only keybindings: "Toggle Table Mode" (UI + lock paired) and "Close All Pop-ups."
5. Sheet header "Push to Table" button on Journal, Item, Actor sheets.
6. Right-click context menu "Push to Table" on Journal, Actor, Item directory entries and Scene navigation.
7. Auto-grant OWNER on PC actors to Table user at `ready` and on `createActor`.
8. Vision-focus mirroring: GM `controlToken` + combat hooks → Table `Token.control`.
9. Scene-follow: mirror GM's `canvasReady` to Table; also `followLevel` for v14 Scene Levels.
10. **Canvas lock on Table client** — wheel/drag blocked; programmatic pans bracketed by unlock/relock. libWrapper hard dependency.
11. **Auto-fit map to Table screen** — on `canvasReady` and `window.resize`. World-default fit mode + per-scene override via injected Scene Config tab.
12. **Active-turn highlight** — built-in PIXI v7 rotating-glow overlay under active combatant. Table-only by default. Color by disposition. `canvas.viewedLevel` guard.
13. Simple Settings UI with all toggles (auto-clear timer, chat suppression, fit mode, highlight style, paired lock/UI, etc.).

### v0.2 — Stretch

14. Small GM-side **ApplicationV2 control palette** docked in canvas controls (extra button via `getSceneControlButtons`).
15. Push-history (last 10 pushes, repush button) stored as client setting.
16. Center/zoom-to-token button: "Spotlight this token on the Table" (non-vision-changing pan via `canvas.animatePan`, brackets the lock).
17. Per-push auto-close timers (Common Display parity).
18. Drag-and-drop pushing: drag a Journal entry from sidebar onto control-palette button to push.
19. TouchVTT compatibility checks + recommended-pairing notice.
20. **Sequencer + JB2A integration** for highlight — auto-upgrade visual when detected.
21. Per-disposition highlight color overrides + "single neutral color" mode.
22. Animated WebP sprite assets shipped with module for richer built-in highlight (no Sequencer/JB2A needed).
23. **OBS / `/stream` parity:** allow same controls when Table client is a `/stream` URL (advanced).

### v0.3 — Polish

24. Migrate from socketlib hard-dep to `CONFIG.queries` with socketlib as soft-dep fallback.
25. Lock View interop (gracefully cede canvas-lock duties if installed).
26. Speaker override so Table user's chats attribute to real owner.
27. Multi-table support (two Tables in one session — unusual but possible).
28. Physical-mini scale mode: auto-compute zoom so 1 grid square = N cm on the physical TV.
29. Auto-set Shared Fog of War on new scenes (settings toggle).
30. Per-scene override for highlight enabled/disabled (boss fights only, say).

---

## 9. Known Risks and Gotchas

### Version-specific (v14)

- **PIXI is still v7 in v14.** Earlier docs may have claimed v8 — that was wrong. PIXI v8 was explicitly deferred past v14 per the Foundry team's roadmap. Don't pre-migrate to v8 syntax (no `.circle()`, keep using `.drawCircle()` / `lineStyle()`).
- **Scene Levels affect vision and highlight.** `canvas.viewedLevel` guard on active-turn highlight; mirror level changes from GM to Table via socket.
- **Level changes have no dedicated hook yet.** Use `canvasReady` or poll `canvas.viewedLevel`. Foundry team likely to add `viewLevel` hook in v14.36x — check changelogs.
- **v14.360 changed token-control auto-pan** — cross-level controls no longer auto-center. Good for our lock.
- **Shared Fog of War unions fog, not live vision.** Don't conflate in README.
- **Native pop-out button** appears on every AppV2 sheet. Filter it on Table client.
- **PF2e and some older systems** lagged v14 compat at launch. Document the system-compat dependency.
- **Token disposition added a "Secret" value** in some v14 contexts. If highlight colors strictly by disposition, decide handling (treat as hostile? hide?).

### Namespace migration

- **Old globals deprecate quietly.** `new ImagePopout(...)` works but logs deprecation. Use `foundry.applications.apps.ImagePopout` to be quiet.
- **AppV2 vs AppV1 sheets vary by system.** Push-to-Table works on both (Foundry's `.render(true)` is unified), but header-button injection needs both `getHeaderControlsApplicationV2` and legacy `getApplicationHeaderControls`.

### Canvas, PIXI, and overlay gotchas

- **`canvas.animatePan` collides with the lock.** Always `disengageLock()` before any programmatic pan and `engageLock()` after.
- **Token drag near canvas edge triggers auto-pan internally.** With lock engaged this fights briefly; drag finishes correctly but canvas snaps back. Acceptable, document.
- **`canvas.tokens.sortableChildren` defaults to `false`.** Set it to `true` and call `sortChildren()` before adding the highlight; otherwise it renders above tokens.
- **`canvas.app.ticker` callbacks leak across scenes** unless removed on `canvasReady` / scene tear-down.
- **Fit-mode rounding.** Non-integer scales shimmer grid lines. Round to 2 decimals before `animatePan`.
- **Hidden combatants and highlight.** Default to hiding — don't broadcast invisible creatures' turns.
- **Map aspect mismatch.** A 4:3 map on 16:9 in `contain` mode gets pillarboxed. Correct behavior; switch to `cover` per-scene if unwanted.

### Foundry general gotchas

- **Permissions are server-checked.** Even with OWNER granted, Foundry server validates. Updating ownership from Table client (Player role) fails. Always route ownership writes via `socketlib.executeAsGM`.
- **`actor.update({ownership})` triggers `updateActor` hook everywhere.** Watch for infinite loops — guard with `actor.ownership[tableUserId] === level` check before issuing.
- **`Token.control()` on undrawn token** silently no-ops. Defer to `canvasReady`.
- **`fromUuid` is async.** Don't await in hot loops; cache resolved documents per push.
- **`ImagePopout` from unreachable path** 404s. Use Foundry-relative paths (`actor.img` is canonical).
- **Multiple GMs:** `executeAsGM` picks one. If a GM disconnects, ownership writes continue from another GM. Document "one human GM with the laptop" assumption.
- **Browser tab inactivity throttling** — Chrome/Firefox throttle background tabs' `requestAnimationFrame`. Make Table browser fullscreen (F11) and avoid focus theft.
- **socketlib RPC failures silent unless awaited.** Always `await` GM-side calls.

### System-specific gotchas

- **Unlinked tokens** (most NPCs) have ownership on `tokenDocument.ownership`, separate from actor's. If you grant ownership only on Actor, pre-existing unlinked tokens keep old ownership. Run one-time sync after granting.
- **D&D 5e** has token vision config on the token; PF2e has a Sight tab. Don't touch — respect them.
- **PF2e GM Vision** conflicts with some Less Fog behavior. Non-issue for us; document known-good config.
- **Theatre Inserts, MidiQOL, other heavy modules** render overlays which may persist when UI hidden on Table. Test combinations; provide "force-hide these selectors" setting.

### Workflow gotchas

- **GM forgets to log the Table user in.** Detect on GM client (`game.users.get(tableUserId)?.active === false`) and show banner.
- **Players log in as Table user from own laptops.** Password the Table account or rely on social convention. Document.
- **Spectator chat noise:** Table receives all whispers it's party to. With OWNER on every PC, that's most whispers. Mute `game.audio` on init.
- **Canvas resize on UI toggle:** flipping body class changes viewport. Call `canvas.app.renderer.resize(window.innerWidth, window.innerHeight)` and `canvas.pan(canvas.scene._viewPosition)` to avoid mis-centered map.

---

## Final pointers

Clone these three repos before writing code, in order:

1. **`ironmonk108/monks-common-display`** — direct reference for nearly every feature. Read `monks-common-display.js` end-to-end. Study how it identifies the common-display player, the toolbar, socket pushes, auto-clear of popouts. GPLv3 + Commons Clause — read and learn freely, but copying code makes your module GPL+CC too.
2. **`farling42/foundryvtt-socketlib`** — README and example. Stable for years.
3. **`sPOiDar/fvtt-module-stream-view`** — for "dedicated user, strip UI, follow camera" lineage. Code is v11-era; don't copy verbatim, but architecture is instructive.

For ongoing reference: the **Foundry community wiki** (foundryvtt.wiki) is consistently more useful than official API docs for "how do I actually do this" questions, especially ApplicationV2, DialogV2, Sockets, and v12→v13 / v13→v14 conversion guides. The **#module-development channel on the Foundry Discord** is where real-time debugging happens (paid Foundry license required to join). The **Foundry release notes** (foundryvtt.com/releases/) are the canonical source of breaking changes — read 13.0, 14.0, and the most recent 14.36x notes before starting.

Once you have an MVP, expect GM ergonomics and the "where do players actually walk up and interact" details to dominate playtest feedback. The technical scaffolding is straightforward; the design challenge is making "GM clicks one thing, the right thing happens on the TV" feel effortless.

Good luck.
