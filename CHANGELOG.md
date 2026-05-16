# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- **Push to Table now ships rendered HTML, not a document uuid.** The
  previous "send uuid, have Table `fromUuid` it, render the system's own
  sheet" approach was fragile: it depended on a just-in-time OBSERVER
  ownership grant racing the socket message, and on each system's sheet
  rendering correctly for non-owners. The new approach mirrors what
  Monk's Common Display / Theatre Inserts / Foundry's own
  `JournalEntry.show()` flow do — the GM client builds the renderable
  content (HTML for journal pages, item description, image URL for
  portraits) and ships THAT over the socket. The Table renders the
  inline content in a small `community-screen` `ApplicationV2` window
  (`TableDisplay`), with no document lookup and no permission
  dependency.
- Portrait pushes now go through `showImage` with the actor's `img` URL
  directly (the previous `showPortrait` handler is kept as a backwards-
  compatible fallback).
- `closeAllPopups` now walks both the open `TableDisplay` instances and
  open `ImagePopout` instances. Console fallback exposed at
  `game.modules.get("community-screen").api.closeAllPopups()`.

### Changed (prior unreleased entries)

- **Dropped optional Sequencer and JB2A integration; baked the visual
  in.** The module is now fully self-contained. The previous "auto-
  upgrade to Sequencer + JB2A" code path used JB2A's rune-circle sprite
  as a richer alternative to the built-in ring. That visual is now
  reproduced natively in PIXI v7 by the new **`ornate`** highlight
  style: three concentric rings, procedurally drawn rune-like glyphs
  at each spoke position (four glyph patterns, deterministic per
  spoke), a counter-rotating outer halo, a counter-rotating glyph
  layer with pulsing alpha, and a `PIXI.BlurFilter` glow. No external
  modules, no bundled assets. Existing `subtle` / `default` /
  `dramatic` styles unchanged.
- `module.json.relationships.recommends` is now empty. The only
  module dependencies are `socketlib` and `lib-wrapper` (both required).

### Fixed

- **Push to Table reliability.** Added a 200ms settle delay between the
  GM-side `ensureTableObserver()` write and the immediately-following
  `executeAsUser()` socket call so the ownership update has time to
  propagate to the Table client's local cache. Table-side `_show*`
  handlers retry `fromUuid` once with a 400ms wait if the first attempt
  returns null. Portraits now ship the actor's `img` URL inline so the
  Table never has to `fromUuid` the actor at all. Prominent
  `[Community Screen]` info-level logging on both sides for diagnosis.
- **Combat vision reliability.** Same propagation-delay pattern in
  `broadcastFocus()` when a just-in-time `ensureTableObserver()` grant
  was actually applied. The Table-side `_setVisionFocus` now warns
  loudly when `Token.control()` is denied (the symptom of a
  not-yet-propagated permission grant).
- **`sleep()` helper** added to `scripts/lib/helpers.mjs`.

### Fixed (previous)

- **Refit Scene button now actually refits.** The control palette
  previously dispatched `followScene`, which is a no-op when the Table
  is already on the current scene. Added a dedicated `refitScene`
  socket handler that calls `fitSceneToTable()` on the Table client.
- **Push to Table now displays content even on docs the Table user
  has no permission on.** Player-role users default to no access on
  most journals/items, so `fromUuid()` was returning null on the Table
  client and the sheet never rendered. The GM client now just-in-time
  grants OBSERVER on the document before dispatching the push (via a
  new `ensureTableObserver()` helper in `ownership.mjs`).
- **Combat vision now switches on NPC turns too.** `Token.control()`
  silently no-ops when the user lacks OBSERVER on the underlying
  actor, so vision was sticking to the last PC token whenever the
  tracker advanced to an NPC. The GM-side `broadcastFocus()` now
  calls `ensureTableObserver(combatant.actor)` before sending the
  focus to the Table, mirroring the PC auto-grant pattern for ad-hoc
  NPC combatants.

### Added

- **Auto-release on PR merge.** A new workflow
  (`.github/workflows/release-on-merge.yml`) inspects merged PRs and
  publishes a release with an appropriately bumped version. Labels
  control the bump level: `release:major`, `release:minor`,
  `release:none` (skip); default is patch. Bumps `module.json` +
  `package.json`, commits the bump to `main`, builds the zip, and
  publishes the GitHub Release in one shot. Foundry's "Check for
  Updates" then picks up the new version automatically — no manual
  tag push or version edit required.
- **`workflow_dispatch` re-publish.** The existing `release.yml` is
  retained as an escape hatch for re-publishing the current version or
  cutting a release from an explicit `v*.*.*` tag push, but its
  push-to-main trigger has been removed to avoid colliding with the
  auto-release workflow.

### Changed

- **Combat vision focus now follows the combat tracker's active combatant**
  (`combat.combatant.tokenId`) instead of whichever token the GM has
  selected. The GM client routinely controls NPCs, traps, lights, and
  templates that the room shouldn't see through — the combat tracker is
  the correct single source of truth for "whose vision does the TV
  show". `controlToken` is no longer a vision trigger. README and
  `docs/design.md` §3.6 / §4.3 / §6 updated to match.

### Fixed

- **Control palette button now appears in v14 scene controls.** The
  `getSceneControlButtons` hook payload changed from an array of group
  objects to an object map keyed by group name; the old `controls.find()`
  silently no-op'd. Now handles both shapes (and both array-tools and
  object-tools shapes) defensively.
- **Console fallback for the control palette.** If scene-control
  injection ever fails on a particular setup, GMs can run
  `game.modules.get("community-screen").api.openPalette()` from dev
  tools to surface the palette.
- **Combat vision hooks read the supplied `combat` document directly**
  instead of `game.combats.active`. Avoids a race where `active` lags
  behind the in-flight update and the broadcast snapshots the
  pre-update combatant. Also falls back to `combatant.token.id`
  alongside `combatant.tokenId` to be tolerant of the v14 Combatant
  shape.
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
