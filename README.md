# Community Screen

**Drive the shared TV at your gaming table from the GM laptop.** Community
Screen is a Foundry VTT v14 module that turns a dedicated player-role user
named "Table" into a clean, chrome-free display: the GM clicks a button on
their own machine and a journal, item card, or character portrait appears
centered on the TV. Vision adapts automatically — out of combat the Table
shows the union of the party's sight; in combat it follows whichever token
the combat tracker says is currently up. A glowing ring marks the active combatant. The map
fits the TV's aspect ratio. The canvas can't be panned or zoomed by a passing
player elbow, but tokens still drag freely so players can walk up and play.

<!-- TODO: add screenshots -->

## Features

### At the Table

- **UI-hidden chrome.** Sidebar, hotbar, scene navigation, scene controls,
  player list, notifications, and chat input all disappear on the Table
  client. The map fills the screen.
- **Canvas lock.** Scroll-wheel zoom and click-drag pan are disabled — bumps
  and elbow nudges don't disturb the view. Tokens still drag for players who
  walk up.
- **Aspect-ratio fit.** Each scene auto-fits the TV with five modes
  (contain / cover / width / height / native), settable as a world default
  and overridable per scene from Scene Config.

### GM Controls

- **Push to Table** button on every Journal, Item, Actor, and Scene sheet,
  plus a right-click "Push to Table" entry in the directory.
- **Hotkeys** (GM-only): `Ctrl+Shift+U` toggles Table play/setup mode;
  `Ctrl+Shift+P` closes every pop-up on the Table.
- **Control palette** reachable from the scene controls — shows whether the
  Table is online, with quick buttons for Close All, Refit Scene, and Toggle
  Table Mode.

### Vision

- **Combat-aware focus.** When combat is active, the Table follows the
  current combatant in the combat tracker — whoever's turn it is. When
  combat ends, the Table falls back to the union of every actor it has
  OBSERVER or OWNER on — Foundry's native party-vision behavior. GM
  selection is intentionally ignored (the GM often selects NPCs, traps,
  or lights that shouldn't change what the room sees).
- **Automatic ownership** management: every actor with a non-Table player
  owner gets the Table user added at OWNER level so players can walk up and
  drag their own token.

### Combat

- **Active-turn highlight.** A rotating, pulsing ring marks whose turn it
  is. Styles: subtle / default / dramatic. Disposition coloring
  (friendly = yellow, hostile = red, neutral = cool gray) optional.
  Auto-upgrades to a richer Sequencer + JB2A effect if both modules are
  active.

### Ergonomics

- **Scene follow** mirrors GM scene changes to the Table.
- **Scene Levels follow** (v14 feature) keeps the Table on the same level
  the GM is viewing, when the API supports it.
- **Pop-up backdrop**: a 60% dark dim behind open pop-ups so the focus
  stays on the content. Configurable.

## Requirements

- **Foundry VTT v14** (verified). Compatibility minimum is v13.
- **Required modules** (auto-installed via manifest dependencies):
  - [socketlib](https://github.com/farling42/foundryvtt-socketlib)
  - [lib-wrapper](https://github.com/ruipin/fvtt-lib-wrapper)
- **Recommended (soft) modules** for visual polish:
  - [Sequencer](https://foundryvtt.com/packages/sequencer)
  - [JB2A Patreon](https://foundryvtt.com/packages/jb2a_patreon) (or the
    free version — feature-detect handles either)

## Installation

### Via manifest URL

1. In Foundry's **Add-on Modules** tab, click **Install Module**.
2. Paste this manifest URL:

   ```
   https://github.com/b34rblack-glitch/GMhub-CommunityEdition/releases/latest/download/module.json
   ```

3. Click **Install**. Foundry will fetch the latest release and its
   dependencies.

### Manual install

Download the latest `module.zip` from the
[Releases](https://github.com/b34rblack-glitch/GMhub-CommunityEdition/releases)
page, unzip into your Foundry `Data/modules/community-screen/` directory,
and restart Foundry.

## Setup (one-time per world)

1. **Create a Table user** in **Game Settings → Configure Players**. Role:
   Player. Pick a memorable name and a password (or none — see Troubleshooting).
2. **Note the world URL** Foundry shows in the join screen.
3. **Open module settings** (GM laptop): **Game Settings → Configure Settings →
   Module Settings → Community Screen**. Set **Table User** to the new
   account. **You can enter either the user's name (e.g. `Table`) or the
   user ID** — both work.
4. **Launch a second browser session** (separate browser, separate profile,
   or another device) on the world URL and log in as the Table user.
5. **Full-screen the Table browser** (`F11`), drag it to the TV, and walk
   away. The map should now fill the screen with no UI clutter.

## Usage

- **Push a journal.** Open the journal on the GM laptop, click the **Push to
  Table** header button. The journal renders centered on the TV.
- **Push an item card.** Same pattern from any item sheet.
- **Push a portrait.** From an actor sheet or by right-clicking the actor in
  the Actors directory.
- **Close everything.** Hit `Ctrl+Shift+P` or click "Close All Pop-ups" in
  the Control Palette.
- **Switch into setup mode** (UI back, canvas pannable) for staging:
  `Ctrl+Shift+U`. Hit it again to return to play mode.
- **Run combat.** Start a combat encounter. Whoever the tracker shows as
  up will drive the Table's vision and the active-turn ring; advancing
  the turn on the GM client swaps both automatically.

## Settings reference

| Setting                        | Scope  | Default | What it does                                                                |
| ------------------------------ | ------ | ------- | --------------------------------------------------------------------------- |
| Table User                     | world  | ""      | The user account that drives the Table TV. Accepts a user name or id.       |
| Default Scene Fit Mode         | world  | contain | Fit mode applied when a scene has no per-scene override.                    |
| Custom Scale Override          | world  | 1.0     | Force a specific zoom (currently informational; auto-fit takes precedence). |
| Show Active-Turn Highlight     | client | false   | Draw the highlight ring on this client (default on for the Table).          |
| Active-Turn Highlight Style    | world  | default | subtle / default / dramatic / sequencer (auto if installed).                |
| Color Highlight by Disposition | world  | true    | Yellow / red / gray ring per disposition. Off → single yellow.              |
| Suppress Chat Input on Table   | world  | true    | Hides chat input on the Table client.                                       |
| Auto-grant OWNER on PCs        | world  | true    | Grant the Table user OWNER on every player-owned actor at ready.            |
| Dim Canvas Behind Pop-ups      | world  | true    | 60% dark overlay behind open pop-ups on the Table.                          |

## Keybindings reference

| Action                  | Default        | Scope |
| ----------------------- | -------------- | ----- |
| Toggle Table Mode       | `Ctrl+Shift+U` | GM    |
| Close All Table Pop-ups | `Ctrl+Shift+P` | GM    |

Re-bind in **Configure Controls → Community Screen**.

## System compatibility

The module is **system-agnostic**: it never touches system-specific data
paths. If your system runs on Foundry v14, Community Screen works. PF2e and
other systems that arrived after v14 launch should work as soon as the
system itself is v14-compatible; please report regressions on the
[issue tracker](https://github.com/b34rblack-glitch/GMhub-CommunityEdition/issues).

## Known limitations

- **Table-user picker** is a plain text input for the user id in v0.1 — a
  dropdown of non-GM users arrives in v0.2.
- **Scene Levels mirroring** uses `canvas.viewLevel` if available. v14
  shipped Scene Levels without a dedicated `levelChange` hook; cross-level
  changes are mirrored at `canvasReady`. A polling fallback is on the
  roadmap.
- **No system-specific Push to Table** for compendium types (e.g. a roll
  table from a journal cell). v0.2.
- **Multiple GMs** — `executeAsGM` picks one GM, and ownership writes route
  through it. Assumes one human is "the GM with the laptop"; multi-GM
  setups should still work but haven't been stress-tested.

## Troubleshooting

**The Table sees a black screen.**
The Table user has no actors with OBSERVER or OWNER ownership. The module
warns about this at ready. Solutions: (a) enable Auto-grant OWNER (default
on); (b) manually grant OBSERVER on every player actor on the GM client.

**Pop-ups don't appear on the Table when I push.**

1. Check the Table user is logged in (browser tab open and connected). The
   Control Palette indicator shows their state.
2. Check the Table user id in settings matches the actual user.
3. Open the browser console on the Table — look for `[Community Screen]`
   messages.

**The canvas pans on the Table anyway.**
Confirm `libWrapper` is installed and active. Run `libWrapper.LIBWRAPPER`
in the console — it should be defined. Without it the lock can't engage.

**Players can't drag their tokens.**
Auto-grant OWNER must be on, the Table user must be configured, and they
must be logged in. Token ownership is per Actor — unlinked NPC tokens need
ownership granted on the Token Document, which v0.1 doesn't sync (players
usually only drag their own linked PC tokens).

**Active-turn ring doesn't appear.**
Set **Show Active-Turn Highlight** to true on the Table client. The
default is off on every client except the Table.

**My TV's aspect ratio looks wrong.**
Open a scene config from the GM laptop. There's a "Community Screen → Fit
mode for the Table" select — pick contain / cover / width / height /
native for that scene. World default is in module settings.

## Roadmap

See [`docs/design.md`](docs/design.md) §8 for the full plan. Highlights:

- **v0.2** — User-picker dropdown, push history, per-push auto-close
  timers, drag-to-push, animated WebP highlight assets, OBS / `/stream`
  parity, single-neutral-color highlight mode.
- **v0.3** — `CONFIG.queries` fallback when socketlib isn't available,
  Lock View interop, speaker override for Table chat, multi-Table support,
  physical-mini scale mode (1 grid = N cm on the TV), per-scene
  highlight enable/disable.

## Credits & inspiration

This module stands on the shoulders of giants. Studied, borrowed patterns
from, or otherwise admired:

- [Monk's Common Display](https://github.com/ironmonk108/monks-common-display)
  — the closest existing module; primary reference for the dedicated-user
  push workflow.
- [Stream View](https://github.com/sPOiDar/fvtt-module-stream-view) — the
  pioneer of the dedicated-user, strip-UI, follow-camera lineage.
- [Lock View](https://foundryvtt.com/packages/LockView) — canvas-lock prior
  art; ship alongside this module if you want even more fine-grained lock
  controls.
- [Minimal UI](https://foundryvtt.com/packages/minimal-ui) and
  [Display Mode](https://foundryvtt.com/packages/displaymode) — CSS-hiding
  patterns and selector references.
- [socketlib](https://github.com/farling42/foundryvtt-socketlib) and
  [lib-wrapper](https://github.com/ruipin/fvtt-lib-wrapper) — hard
  dependencies; both are foundational community libraries.
- [Sequencer](https://foundryvtt.com/packages/sequencer) and
  [JB2A](https://www.jb2a.com/) — optional auto-upgrade target for the
  active-turn highlight.

## License

[MIT](LICENSE). Copyright © 2026 b34rblack-glitch.
