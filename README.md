# Community Screen

**Turn the TV at your gaming table into a live, player-facing game board —
controlled entirely from the GM's laptop.**

Community Screen is a [Foundry VTT](https://foundryvtt.com) module for
in-person tables that play with a shared screen. Log a dedicated "Table"
account into the browser on your TV, and Community Screen turns it into a
clean, clutter-free display: no sidebar, no toolbars, just the map. From your
own laptop you can push journals, item cards, portraits, and images straight
to the TV with one click. The view follows the party's eyes — and in combat,
whoever's turn it is — with a glowing ring marking the active combatant.
Players can still walk up and drag their own tokens, but a stray elbow can't
pan or zoom the map.

## Features

### A clean display for your players

- **No screen clutter.** Sidebars, toolbars, chat, and notifications are all
  hidden on the TV. The map fills the screen.
- **Bump-proof.** Panning and zooming are locked on the TV, so an accidental
  touch or scroll can't disturb the view — but players can still drag their
  own tokens.
- **Fits any TV.** Six fit modes (contain, cover, width, height, native, and
  physical mini) make sure every scene looks right on your screen, with
  per-scene overrides available in each scene's settings.
- **Physical-mini scale.** Playing with real miniatures on top of the TV?
  The physical fit mode renders each grid square at a real-world size you
  choose — for example, exactly one inch — so your minis line up with the map.

### Share anything with one click

- **Push to Table.** Every journal, item, actor, and scene gets a "Push to
  Table" button — click it and the content appears centered on the TV. Also
  available by right-clicking entries in the sidebar directories.
- **Spotlight on the content.** While something is on screen, the map behind
  it dims so all eyes go to what you're sharing. One click (or hotkey)
  clears everything off the TV again.

### The view follows the action

- **Party vision.** Out of combat, the TV shows what the party can
  collectively see — no spoilers, no unexplored corners.
- **Combat focus.** In combat, the view automatically follows whoever's turn
  it is in the combat tracker, switching as the turn advances.
- **Active-turn ring.** A glowing, animated ring marks the active combatant.
  Choose from four styles — subtle, default, dramatic, or ornate — with
  optional color-coding for friend and foe. No extra modules needed.
- **Combat HUD.** An optional overlay shows the room whose turn it is, who's
  up next, and the current round. Combatants you've hidden stay hidden.
- **Spotlight.** Want to force the TV onto a specific token — dramatic
  reveal, cutscene, boss entrance? Enable the optional Spotlight control and
  point the room's eyes wherever you like until you clear it.

### It just stays in sync

- **Scene follow.** When you switch scenes, the TV follows automatically —
  including the map level you're viewing, on games that use scene levels.
- **Automatic permissions.** The module keeps the Table account's
  permissions in sync so player characters are always visible and draggable
  on the TV, without you managing user permissions by hand.
- **GM control palette.** A small control window on your laptop shows
  whether the TV is connected and gives you quick buttons: close all
  pop-ups, refit the scene, toggle setup mode, and re-run the setup wizard.

## Requirements

- **Foundry VTT v13 or v14** (verified on v14).
- Two required library modules, **installed automatically** with this one:
  [socketlib](https://github.com/farling42/foundryvtt-socketlib) and
  [libWrapper](https://github.com/ruipin/fvtt-lib-wrapper).

That's it — everything else, including all visual effects, ships with the
module itself.

## Installation

1. In Foundry's **Add-on Modules** tab, click **Install Module**.
2. Paste this manifest URL and click **Install**:

   ```
   https://github.com/b34rblack-glitch/GMhub-CommunityScreen/releases/latest/download/module.json
   ```

Prefer a manual install? Download `module.zip` from the
[latest release](https://github.com/b34rblack-glitch/GMhub-CommunityScreen/releases),
unzip it into your Foundry `Data/modules/` directory, and restart Foundry.

Updates arrive through Foundry's normal **Check for Updates** button — no
extra steps.

## Getting started

The first time you enable the module in a world, a **setup wizard** opens
and walks you through everything — it can even create the Table user account
for you. You can re-run it anytime from the Community Screen control palette.

If you'd rather set things up by hand:

1. **Create a Table user** in **Game Settings → Configure Players** with the
   **Player** role. "Table" is a fine name.
2. **Point the module at it**: in **Game Settings → Configure Settings →
   Community Screen**, set **Table User** to that account (the name or the
   user ID — both work).
3. **Log the TV in**: open your world's URL in a browser on the TV (or any
   second device/browser profile) and log in as the Table user.
4. **Go full screen** (`F11`) and walk away. The map should fill the screen
   with no UI clutter.

## Everyday use

- **Push a journal, item card, or portrait** — click the **Push to Table**
  button in the sheet's header, or right-click the entry in the sidebar.
- **Clear the TV** — press `Ctrl+Shift+P` or click **Close All Pop-ups** in
  the control palette.
- **Stage the next scene** — press `Ctrl+Shift+U` to flip the TV into setup
  mode (UI back, map pannable) while you arrange things; press it again to
  return to play mode.
- **Run combat as usual** — start an encounter and the TV takes care of
  itself: the view and the highlight ring follow the turn order
  automatically as you advance turns.

## Settings

Find these under **Game Settings → Configure Settings → Community Screen**.

| Setting                         | Default   | What it does                                                              |
| ------------------------------- | --------- | ------------------------------------------------------------------------- |
| Table User                      | _(empty)_ | The account that drives the TV. Accepts a user name or user ID.           |
| Default Scene Fit Mode          | contain   | How scenes fit the TV. Override per scene in Scene Config.                |
| Physical grid-square size       | 1.0       | For physical-mini mode: the real-world size of one grid square on the TV. |
| Physical size unit              | inch      | Inches or centimeters, for the setting above.                             |
| Table display diagonal (inches) | 0         | Your TV's diagonal size — needed only for physical-mini mode.             |
| Table display width / height    | 0 (auto)  | Your TV's native resolution. Leave at 0 to auto-detect.                   |
| Show Active-Turn Highlight      | off       | Draw the highlight ring on this device (turn on for the TV).              |
| Active-Turn Highlight Style     | default   | Subtle, default, dramatic, or ornate.                                     |
| Color Highlight by Disposition  | on        | Different ring colors for friendly, neutral, and hostile combatants.      |
| Show Combat HUD                 | off       | Text overlay with current/next combatant and round (turn on for the TV).  |
| Suppress Chat Input on Table    | on        | Hides the chat box on the TV so spectators can't type.                    |
| Auto-grant OWNER on PCs         | on        | Keeps permissions in sync so players can drag their tokens on the TV.     |
| Dim Canvas Behind Pop-ups       | on        | Darkens the map while shared content is on screen.                        |
| Enable Spotlight Token Control  | off       | Adds Spotlight buttons to the GM control palette.                         |

## Keyboard shortcuts

| Action                       | Default        |
| ---------------------------- | -------------- |
| Toggle Table play/setup mode | `Ctrl+Shift+U` |
| Close all pop-ups on the TV  | `Ctrl+Shift+P` |

Both are GM-only and can be re-bound in **Configure Controls → Community
Screen**.

## Works with your game system

Community Screen is **system-agnostic** — it doesn't depend on any
particular game system's data, so if your system runs on Foundry v13/v14, it
works. If you hit a system-specific issue, please report it on the
[issue tracker](https://github.com/b34rblack-glitch/GMhub-CommunityScreen/issues).

## Troubleshooting

**The TV shows a black screen.**
The Table user can't see through anyone's eyes yet. Make sure **Auto-grant
OWNER on PCs** is enabled (it is by default), or manually grant the Table
user Observer permission on your player characters.

**Nothing appears on the TV when I push.**
Check that the TV's browser is open, connected, and logged in as the Table
user — the control palette's indicator shows whether it's online. Then
confirm the **Table User** setting matches that account.

**The map still pans or zooms on the TV.**
Make sure the **libWrapper** module is installed and enabled — the canvas
lock depends on it.

**Players can't drag their tokens on the TV.**
Make sure **Auto-grant OWNER on PCs** is enabled and the Table user is
logged in. Note this covers players' own linked characters; unlinked NPC
tokens aren't included.

**The highlight ring doesn't show.**
Turn on **Show Active-Turn Highlight** on the TV's browser — it's a
per-device setting and is off everywhere by default.

**A scene doesn't fit the TV well.**
Open the scene's configuration and look for the **Community Screen** fit
mode option — try a different mode for that scene. The world-wide default
lives in the module settings.

Still stuck? Open the browser console on the TV (`F12`) and look for
`[Community Screen]` messages, then include them in a report on the
[issue tracker](https://github.com/b34rblack-glitch/GMhub-CommunityScreen/issues)
— bug reports and feature requests are always welcome.

## Good to know

- **One GM at the helm.** The module assumes one GM is running the table
  from their laptop. Worlds with multiple GMs logged in should work, but
  that setup sees less testing.
- **Level changes mirror on scene load.** On maps with multiple levels, the
  TV matches your level when a scene loads; mid-scene level hops may need a
  scene refresh.

## Credits & inspiration

Community Screen stands on the shoulders of some excellent community
modules:

- [Monk's Common Display](https://github.com/ironmonk108/monks-common-display)
  — the closest existing module and the primary reference for the
  dedicated-user push workflow.
- [Stream View](https://github.com/sPOiDar/fvtt-module-stream-view) — the
  pioneer of the dedicated-user, clean-display, follow-camera idea.
- [Lock View](https://foundryvtt.com/packages/LockView) — canvas-lock prior
  art; pairs well with this module if you want even finer lock controls.
- [Minimal UI](https://foundryvtt.com/packages/minimal-ui) and
  [Display Mode](https://foundryvtt.com/packages/displaymode) — UI-hiding
  inspiration.
- [socketlib](https://github.com/farling42/foundryvtt-socketlib) and
  [libWrapper](https://github.com/ruipin/fvtt-lib-wrapper) — the foundational
  libraries this module is built on.
- [Sequencer](https://foundryvtt.com/packages/sequencer) and
  [JB2A](https://www.jb2a.com/) — visual inspiration for the ornate
  highlight style.

## License

[MIT](LICENSE). Copyright © 2026 b34rblack-glitch.
