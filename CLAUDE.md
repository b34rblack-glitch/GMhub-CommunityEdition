# CLAUDE.md — Community Screen

Context for Claude Code sessions working on this repo.

## What this is

**Community Screen** is a Foundry VTT v14 add-on module. It turns a shared TV
at the gaming table into a player-facing display, driven by a dedicated "Table"
player-role user, controlled remotely from the GM laptop.

Canonical source of truth: **`docs/design.md`** — read it before touching
anything non-trivial. Every architectural decision (vision mirroring, canvas
lock, scene fit, active-turn highlight, ownership management, namespaced APIs,
PIXI v7 vs v8) is decided there.

## Tech stack

- **Foundry VTT v14 stable** target. `compatibility.minimum: "13"`, `verified: "14"`.
- **PIXI v7** (still v7 in v14 — PIXI v8 deferred past v14). Use
  `.drawCircle()` / `lineStyle()`, **never** v8's `.circle()`.
- **ESM only.** No build step. No TypeScript. No bundler.
- **Hard dependencies (other Foundry modules):** `socketlib`, `lib-wrapper`.
- **Soft recommends:** `sequencer`, `jb2a_patreon` (feature-detect, fall back).
- **Dev tooling:** Prettier + ESLint flat config. Nothing heavier. Dev deps only.
- **No runtime npm packages.** Module ships as plain files.

## File layout (per design §7)

```
module.json                       Foundry manifest
scripts/
  main.mjs                        Single entry point. Owns init/ready/setup hooks.
  module.mjs                      MODULE_ID + module-wide constants.
  settings.mjs                    All game.settings.register() calls.
  identity.mjs                    isTableUser / isGM / getTableUserId helpers.
  sockets.mjs                     socketlib registration + handler dispatch.
  ui-hiding.mjs                   Body-class toggle for hiding chrome.
  canvas-lock.mjs                 libWrapper pan/zoom block + capture wheel.
  scene-fit.mjs                   Aspect-ratio fit + renderSceneConfig hook.
  ownership.mjs                   Auto-grant OWNER on PCs to Table user.
  vision.mjs                      controlToken/combat → Table token control.
  popups.mjs                      showJournal/Item/Image/Portrait/closeAll.
  push-buttons.mjs                Sheet header buttons + directory CSM entries.
  keybindings.mjs                 game.keybindings.register() (GM-only).
  scene-follow.mjs                canvasReady → followScene; level mirror.
  combat-highlight.mjs            Active-turn PIXI v7 overlay.
  control-palette.mjs             GM AppV2 control window.
  lib/
    logger.mjs                    Module-prefixed logging.
    helpers.mjs                   Shared utilities.
styles/                           CSS — community-screen, popups, push-buttons.
templates/                        Handlebars templates.
lang/en.json                      i18n strings.
docs/design.md                    Canonical design.
```

## Coding conventions

- **One file per concern.** Each feature module exports an `init()` and/or
  `ready()`; `main.mjs` is the only file that calls `Hooks.once("init"/"ready")`.
- **Module-prefixed logging via `lib/logger.mjs`.** Never bare `console.log`.
- **All user-visible strings via `game.i18n.localize("COMMUNITY_SCREEN.foo.bar")`**
  with entries in `lang/en.json`.
- **Namespaced APIs** in new code (`foundry.applications.apps.ImagePopout`,
  `foundry.applications.api.DialogV2`).
- **Settings keys: kebab-case.** Socket handler names: camelCase.
- **CSS classes: kebab-case, prefixed `community-screen-*`.**
- **JSDoc on every exported function** with `@param`/`@returns`.
- **No jQuery in new AppV2 hook handlers.** `html` is `HTMLElement`. For
  legacy v1 hooks where `html` is jQuery, unwrap with `html[0]` explicitly.
- **Wrap GM-side socket calls in try/catch**; on rejection, warn via
  `ui.notifications.warn(...)` with a localized message.
- **Never silently swallow errors** — `logger.error(...)` plus
  `ui.notifications.error/warn(...)`.

## Git workflow

- Conventional Commits: `feat:`, `fix:`, `chore:`, `docs:`.
- Phased build commits push at end of each phase to the working branch.
- Tag releases with `v<semver>` and push the tag.
- **Never force-push. Never rewrite history.**

## Useful commands

```
npm run lint            # ESLint over scripts/
npm run format          # Prettier write
npm run format:check    # Prettier check (CI)
npm run check:manifest  # Validate module.json has required fields
npm run check:syntax    # node --check all scripts (parse-only)
npm run check           # Manifest + syntax + lint
```

## Current focus

Building MVP v0.1.0 per `docs/design.md` §8 across 7 phases. See `CHANGELOG.md`
for what's landed.

## Things to never do

- TypeScript or a build step.
- PIXI v8 syntax (Foundry v14 is still PIXI v7).
- Custom rich-text editor, file uploader, or anything outside MVP.
- Touching system-specific data paths.
- Bundling Sequencer or JB2A.
- Force-pushing or rewriting history.
- Runtime npm dependencies.
