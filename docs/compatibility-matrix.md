# Foundry compatibility matrix — fragile API surfaces

**Captured at:** module `v0.1.15` · 2026-07-11.

This table enumerates the Foundry VTT API surfaces that broke and were re-fixed
repeatedly across `v0.1.3 → v0.1.15` (socket registration ordering, push
journal/item/actor/image, close-all across AppV2 + legacy windows, canvas-lock,
combat vision, scene follow). Each is now guarded by a unit test that exercises
it against a **mocked** Foundry environment (`test/helpers/foundry-mock.mjs`,
jsdom via `test-setup/dom.mjs`).

## Honesty flag — read this first

Every row is **mock-emulated — NOT real-install-verified.** The "Emulated shape"
column documents which Foundry API *shape* the mocks reproduce (e.g. AppV2's
`foundry.applications.instances` Map vs the legacy `ui.windows` object). These
tests prove our code handles those shapes as coded; they do **not** run against a
real Foundry v13 or v14 install, and they cannot catch an API whose real shape
differs from what the mock reproduces. The matrix is a map of *what is guarded and
how*, not a certificate of live multi-version compatibility.

## The matrix

| # | Fragile API surface | Foundry versions spanned | Emulated shape (in the mocks) | Encoding test file(s) | Verification |
|---|---|---|---|---|---|
| 1 | socketlib module registration + `socketlib.ready` timing (the v0.1.7–v0.1.10 ordering bug) | v13–v14 | `makeSocketlib` records every `register(name, fn)` + `executeAsUser`; `register()` is driven from Foundry's `ready` hook, **not** the synchronous `socketlib.ready` | `test/sockets.test.mjs`, `test/main-lifecycle.test.mjs` | mock-emulated (not real-install-verified) |
| 2 | Open-window registries: `foundry.applications.instances` (AppV2 `Map`) **and** `ui.windows` (legacy object) | v13 AppV2 / v1 legacy | both registries populated; close-all must walk both | `test/popups.test.mjs` | mock-emulated (not real-install-verified) |
| 3 | Popout close surface: `app.window.close()` (AppV2) vs `options.popOut` (v1) | v13 AppV2 / v1 legacy | `isPopoutLike`/`countOpenPopouts` recognize `.window` **and** `options.popOut`; three close strategies run in order | `test/popups.test.mjs` | mock-emulated (not real-install-verified) |
| 4 | `ImagePopout(src, {title, shareable})` under `foundry.applications.apps` | v13–v14 (namespaced) | `makeImagePopout` records ctor `(src, options)`; asserts `shareable:false` | `test/popups.test.mjs` | mock-emulated (not real-install-verified) |
| 5 | `JournalEntry#show(force, users)` native share | v13–v14 | `doc.show` spy; asserts `force===true` and Table user targeted | `test/push-buttons.test.mjs` | mock-emulated (not real-install-verified) |
| 6 | Header-control hooks: `getHeaderControls<AppV2>` (HTMLElement) vs `get<Sheet>HeaderButtons` (v1 jQuery array) | v13 AppV2 / v1 legacy | Hooks spy records both registrations | `test/push-buttons.test.mjs` (dispatch only — see gap **G1**) | mock-emulated (not real-install-verified) |
| 7 | Directory context-menu entry: `target instanceof HTMLElement` unwrap + `dataset.entryId`/`documentId` | v13 HTMLElement / v1 jQuery | jsdom supplies `HTMLElement`/`dataset` | not directly asserted — see gap **G1** | mock-emulated (not real-install-verified) |
| 8 | `Token#control({releaseOthers})` return value (`false` = permission denied) | v13–v14 | `tok.control` returns boolean; denied path warns, not throws | `test/vision.test.mjs` | mock-emulated (not real-install-verified) |
| 9 | Combatant token-id shape: `combatant.tokenId` vs `combatant.token.id` | v13–v14 | both shapes emulated; fallback chain asserted | `test/vision.test.mjs` | mock-emulated (not real-install-verified) |
| 10 | Scene Levels: `canvas.viewLevel(level)` + `canvas.viewedLevel` (feature-detected) | v14 | present → called; absent → graceful skip | `test/scene-follow.test.mjs` | mock-emulated (not real-install-verified) |
| 11 | libWrapper target path: `foundry.canvas.Canvas.prototype.pan`/`animatePan` (v14 namespaced, no deprecation warning) vs plain `Canvas.prototype.*` (deprecated shim) | v13–v14 | `makeLibWrapper` records exact target strings + `OVERRIDE` type | `test/canvas-lock.test.mjs` | mock-emulated (not real-install-verified) |
| 12 | `CONST.DOCUMENT_OWNERSHIP_LEVELS` (`OBSERVER`/`OWNER`) | v13–v14 | `CONST` stub with numeric levels; `ensureTableObserver` grant asserted | `test/vision.test.mjs`, `test/push-buttons.test.mjs` | mock-emulated (not real-install-verified) |
| 13 | `fitSceneToTable` orchestration: `canvas.animatePan`, `canvas.scene.dimensions`, `CONFIG.Canvas.maxZoom`/`minZoom` clamp | v13–v14 | animatePan spy; physical-mode cap raise + clamp warn; `FitComputeError` caught | `test/scene-fit-fit.test.mjs` | mock-emulated (not real-install-verified) |
| 14 | Control-palette action dispatch: `refitScene` (NOT `followScene`), `closeAllPopups`, `toggleTableMode` | v13–v14 | AppV2 mixin stub; recording `executeAsUser` | `test/control-palette.test.mjs` | mock-emulated (not real-install-verified) |

## Manifest posture

| `module.json` field | Value | Rationale |
|---|---|---|
| `compatibility.minimum` | `"13"` | unchanged |
| `compatibility.verified` | `"14"` | unchanged |
| `compatibility.maximum` | `""` (unset) | **Left untouched by deliberate choice.** This harness is mock-emulated and does not real-install-verify any version, so it provides no basis to assert (or cap) a maximum. Setting a maximum would falsely imply live-tested breakage at a known version. |

## Known gaps (documented, not silent)

- **G1 — header-control hook shape + directory-context `dataset` unwrap are not
  directly asserted.** `push-buttons.mjs` registers both AppV2
  (`getHeaderControls*`) and v1 (`get*SheetHeaderButtons`) hooks and unwraps
  `target instanceof HTMLElement` / `dataset.entryId` in the directory injector.
  The **dispatch** those buttons ultimately trigger IS covered
  (`test/push-buttons.test.mjs`), but the injection-shape handling itself has no
  dedicated test yet. Rows 6–7 reflect this.
- **G2 — `identity.getTableUser` name-or-id fallback** (`game.users.get(id)` →
  `game.users.getName(name)`) is a named historical regression but falls outside
  the operator-approved scope for this harness; not encoded.
- **G3 — `control-palette` `getSceneControlButtons` dual-shape handling**
  (array-of-groups vs object-map, and `tools` array vs object) is a named
  regression outside scope; not encoded. Note: the palette's **refit dispatch**
  (the more commonly-broken path) IS covered — see row 14.

## CI gate — what "blocks merge" actually requires

The `validate` job in `.github/workflows/ci.yml` runs `npm run test` (alongside
manifest/syntax/lint/format/JSON checks) on every push and pull request. A failing
test **fails the job**.

For a failure to actually **block a merge**, the `validate` job must be configured
as a **required status check** in the repository's branch-protection rules for
`main` — that is a GitHub repo *setting*, not something this file (or any file in
the repo) can enforce. Until an admin sets it, CI failure is advisory: red, but
merge is still physically possible.

### Residual release-path leaks (documented, not fixed here)

- `release-on-merge.yml` publishes on PR **merge** and relies on the PR's
  `validate` check having passed; it is **left ungated** by design (per the
  operator). It also exposes a manual **`workflow_dispatch`** trigger that
  re-publishes **without** re-running `validate`.
- `release.yml` cuts a release on a pushed `v*.*.*` tag or via
  **`workflow_dispatch`**, again without gating on `validate`.
- A repository **admin can bypass** required status checks (unless "Do not allow
  bypassing the above settings" is enabled in branch protection).

These are the paths by which code could ship without a green `validate`; they are
recorded here so the gate's real coverage is not overstated.
