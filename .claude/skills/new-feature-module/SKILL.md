---
name: new-feature-module
description: Scaffold a new feature module under scripts/<name>.mjs following Community Screen conventions. Use when the user asks to add a new feature, hook, or scripts/*.mjs file (e.g. "add an ambient sounds feature", "scaffold a new module for X", "wire up a new feature script"). Generates the file with the standard banner comment, logger import, exported init()/ready() with JSDoc, and adds the import + invocation to main.mjs.
---

# new-feature-module

Create a new feature module file under `scripts/` that matches the repo's
one-file-per-concern layout (per `CLAUDE.md` and `docs/design.md` §7).

## When to use

The user wants to add a new feature that:

- Owns its own state and Foundry hooks (`Hooks.on(...)`)
- Should expose `init()` (and optionally `ready()`) called from `main.mjs`
- Slots in alongside files like `vision.mjs`, `popups.mjs`, `combat-highlight.mjs`

Do **not** use this for one-off helpers (those belong in `scripts/lib/helpers.mjs`)
or for socket handler additions to an existing feature (use the
`socket-handler-add` skill instead).

## Inputs to confirm

Before writing:

1. **Feature name** — kebab-case for the filename, e.g. `ambient-sound`.
   Derive camelCase identifier (e.g. `ambientSound`) for the `main.mjs` import.
2. **Needs `ready()`?** — does it depend on world data, `game.user`, or settings
   reads that must wait until after `init`? If unsure, default to `init()` only.
3. **Table-only / GM-only / both?** — informs the early-return guard inside `init()`.

If any of these are ambiguous, ask once via `AskUserQuestion` rather than guessing.

## Template

Write `scripts/<kebab-name>.mjs` with this exact shape:

```javascript
// ============================================================================
// scripts/<kebab-name>.mjs
// ----------------------------------------------------------------------------
// <One-sentence summary of what this feature does.>
//
// <Optional paragraph: why it exists, what hook(s) it owns, any cross-file
// contracts (e.g. "publishes via socketlib handler 'foo'", "reads setting
// 'bar'"). Keep it tight — the goal is for a future reader to know whether
// this file is the right place to edit before they open it.>
// ============================================================================

import { logger } from "./lib/logger.mjs";
// import { isTableUser, isGM } from "./identity.mjs";
// import { get as getSetting } from "./settings.mjs";
// import { setHandler } from "./sockets.mjs";

/**
 * Wire this feature's Foundry hooks. Called from `main.mjs` during the
 * `init` lifecycle stage.
 *
 * @returns {void}
 */
export function init() {
  logger.debug("<feature-name> init");
  // Hooks.on(...)
}

// /**
//  * Wire anything that must wait until world data is loaded. Called from
//  * `main.mjs` during the `ready` lifecycle stage.
//  *
//  * @returns {void}
//  */
// export function ready() {
//   logger.debug("<feature-name> ready");
// }
```

Strip the `ready()` block entirely if the feature doesn't need it (don't ship
commented-out scaffolding). Strip unused imports.

## Wiring into main.mjs

Two edits to `scripts/main.mjs`:

1. **Import** — add alongside the other feature imports (alphabetical order
   isn't enforced; match the existing group near line 36):

   ```javascript
   import * as <camelName> from "./<kebab-name>.mjs";
   ```

2. **Invoke** — inside the `Hooks.once("init", ...)` body, add a one-line
   comment summarising the feature plus the `init()` call. If the feature
   has a `ready()`, add a matching call inside `Hooks.once("ready", ...)`
   **after** the `sockets.register()` line.

   ```javascript
   // <One-line summary of what the feature does.>
   <camelName>.init();
   ```

## After writing

Run `npm run check` and report the result. If lint/parse fails, fix and re-run.

## Things to never do

- Don't add `Hooks.once("init"/"ready")` inside the feature file — `main.mjs`
  is the **only** place those are allowed.
- Don't use bare `console.log` — always go through the logger.
- Don't hard-code user-visible strings — use `game.i18n.localize(...)` with
  entries in `lang/en.json` (see the `i18n-extract` skill if needed).
- Don't introduce a new top-level directory under `scripts/` — sub-modules go
  in `scripts/lib/`.
