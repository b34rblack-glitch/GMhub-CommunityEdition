# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- **Combat vision focus now follows the combat tracker's active combatant**
  (`combat.combatant.tokenId`) instead of whichever token the GM has
  selected. The GM client routinely controls NPCs, traps, lights, and
  templates that the room shouldn't see through — the combat tracker is
  the correct single source of truth for "whose vision does the TV
  show". `controlToken` is no longer a vision trigger. README and
  `docs/design.md` §3.6 / §4.3 / §6 updated to match.

### Fixed

- **Table User setting now accepts a user name OR a user id.** Previously
  it only worked with the (non-obvious) user id, so entering `Table` —
  the natural thing to type — left the module thinking the Table client
  was offline even when it was connected. `getTableUser()` now falls back
  to `game.users.getName(value)` if the id lookup misses. Setting hint
  and README updated.
- **GM keybindings now show a more specific warning** when dispatch
  can't reach the Table: distinguishes "no Table user configured",
  "configured value doesn't match any user" (new `unknown-table-user`
  i18n key), and "Table user offline".
- **Release workflow now publishes on push to `main`** as well as on
  `v*.*.*` tag pushes. Foundry's manifest-URL install
  (`releases/latest/download/module.json`) now resolves without a
  maintainer first having to push a release tag from a local clone
  (which was blocked by the dev-environment proxy).
- **`module.zip` now wraps its contents in a top-level
  `community-screen/` directory**, so unzipping into Foundry's
  `Data/modules/` tree drops in cleanly with the correct module-id
  folder name. Previously the zip extracted loose files and would have
  required a manual rename to install.

## [0.1.0] — 2026-05-15

### Added

- **Dedicated Table user identity** (`table-user-id` world setting) plus
  helpers `isTableUser` / `isGM` / `isTableOnline`.
- **Body-class UI hiding** on the Table client. Hides sidebar, hotbar, scene
  navigation, controls, players list, top/bottom/left/right toolbars,
  notifications, chat form, and FPS counter.
- **Canvas pan/zoom lock** via `libWrapper` `OVERRIDE` on `Canvas.prototype.pan`
  and `animatePan`, plus a capture-phase wheel listener. Includes a
  `withUnlocked()` helper so programmatic pans can bracket the lock cleanly.
- **Aspect-ratio scene fit**: contain / cover / width / height / native modes,
  world default plus per-scene flag (`flags.community-screen.fitMode`),
  Scene Config tab injection so the GM can pick per scene. Recomputes on
  `canvasReady` and debounced `window.resize`.
- **Auto-grant OWNER** on every actor with a non-Table player owner; warns
  the GM at `ready` if no actor would let the Table see anything. Hooks
  `createActor` for keep-in-sync. All writes routed through a GM client.
- **Combat-aware vision focus**: GM `controlToken` / combat hooks broadcast
  `setVisionFocus({tokenId})` to the Table. Out of combat → release all
  controls so Foundry's native union-vision over OBSERVER actors kicks in.
  Combat end / scene change releases. `deleteToken` on the followed token
  releases.
- **Pop-up rendering** of native Journal, Item, Actor (portrait), and image
  sheets on the Table. Uses namespaced
  `foundry.applications.apps.ImagePopout`. Centers sheets at 900×700.
  `closeAllPopups` socket call hits every tracked popup.
- **Pop-up backdrop** body class adds a 60% dark overlay behind any open
  popup (configurable).
- **Filter native AppV2 pop-out header button** on the Table client.
- **Push to Table** header button on Journal, Item, Actor, and Scene sheets
  (AppV2 and legacy v1 hooks). Right-click context-menu entry on the four
  directory views.
- **GM keybindings**: Ctrl+Shift+U toggles play/setup Table mode; Ctrl+Shift+P
  closes all pop-ups. Both warn if no Table user is connected.
- **Scene follow + level mirror**: GM `canvasReady` mirrors scene id and
  `canvas.viewedLevel` to the Table. Feature-detects `canvas.viewLevel` —
  no-op until v14 ships the API.
- **Active-turn highlight** built on PIXI v7 (`drawCircle` / `lineStyle`).
  Style presets (subtle / default / dramatic), disposition coloring,
  Scene Levels guard. Auto-upgrades to Sequencer + JB2A if both modules
  are active.
- **GM control palette** AppV2 with Table-user online indicator and quick
  actions: Close All, Refit Scene, Toggle Table Mode. Reached via a scene
  control button.
- **Settings UI** covers all 10 settings: Table user id, fit mode, custom
  scale, highlight enabled / style / disposition coloring, table-mode,
  suppress-table-chat, auto-grant-ownership, popup-backdrop.
- **GitHub Actions CI**: ESLint, Prettier check, `node --check`, manifest
  validation, JSON validation on every push and PR.
- **GitHub Actions release**: builds and publishes a `module.zip` whenever
  a `v*.*.*` tag is pushed.

### Known limitations

- Table-user picker is a plain String setting; a dropdown of non-GM users is
  on the v0.2 list.
- Scene Levels API (`canvas.viewLevel`) is feature-detected; no dedicated
  hook yet, so cross-level mirroring relies on `canvasReady`.
- No system-specific compatibility paths; should work everywhere Foundry v14
  works, but PF2e and other late-arriving systems were not validated.
- See `docs/design.md` §8 v0.2/v0.3 for the full roadmap.
