---
name: appv2-hook-shim
description: Generate a correctly-shaped Foundry render-hook handler — knowing whether the second argument is an HTMLElement (AppV2) or a jQuery wrapper (legacy v1) and emitting the right unwrap pattern. Use when adding a renderActorSheet / renderJournalSheet / renderApplicationV2 / renderItemDirectory hook, or when the user asks "is this hook jQuery or HTMLElement?" / "how do I add a header button to X?".
---

# appv2-hook-shim

Foundry's render hooks have an inconsistent signature depending on whether
the rendered application is AppV1 (legacy) or AppV2. This skill emits the
correct handler shape and unwrap pattern.

## When to use

- Adding a new `Hooks.on("render<Something>", ...)` handler.
- Adding a sheet header button (uses `getHeaderButtons` on v1 or
  `_getHeaderControls` / `controls` on AppV2 — and the render hook fires
  with different shapes).
- The user asks "is `html` a jQuery object or an HTMLElement?"
- Refactoring a v1 hook to v14 conventions.

## The rule

| Application base class                       | `html` argument type       | Unwrap needed?             |
| -------------------------------------------- | -------------------------- | -------------------------- |
| `Application` (v1, legacy)                   | `jQuery`                   | Yes — `html[0]` for DOM     |
| `ApplicationV2` (v14 native)                 | `HTMLElement`              | No — use directly           |
| Mixed (system overrides v1 sheet)            | `jQuery`                   | Yes                         |

**How to tell which one a target uses:**

1. If the hook name ends in `V2` (e.g. `renderApplicationV2`), it's AppV2.
2. If the application is from a v14 core class (`JournalEntrySheet`,
   `ItemSheetV2`, `ActorSheetV2`, `Sidebar`), it's AppV2.
3. If you're not sure (system-provided sheet like `dnd5e.ActorSheet5eCharacter`),
   default to v1 / jQuery — it's the safer assumption since systems lag
   core's migration.

## Handler templates

### AppV2 (HTMLElement)

```javascript
import { logger } from "./lib/logger.mjs";

Hooks.on("render<AppV2Name>", (app, html, context) => {
  // `html` is an HTMLElement (Foundry v14 AppV2 convention).
  // Use querySelector/closest/addEventListener directly.
  const button = html.querySelector(".my-button");
  if (!button) return;
  button.addEventListener("click", (ev) => {
    ev.preventDefault();
    // ...
  });
});
```

### Legacy v1 (jQuery)

```javascript
import { logger } from "./lib/logger.mjs";

Hooks.on("render<AppV1Name>", (app, html, data) => {
  // `html` is a jQuery wrapper here. Unwrap to HTMLElement for DOM work,
  // OR use jQuery API — but don't mix.
  const root = html[0]; // HTMLElement of the sheet root.
  const button = root.querySelector(".my-button");
  if (!button) return;
  button.addEventListener("click", (ev) => {
    ev.preventDefault();
    // ...
  });
});
```

Per `CLAUDE.md`: **no jQuery in new AppV2 hook handlers**. For legacy v1
hooks where `html` is jQuery, unwrap with `html[0]` explicitly. Don't use
jQuery chaining (`html.find(...).on(...)`) in new code.

### Sheet header buttons (AppV2)

For AppV2 sheets, prefer `getActorSheetHeaderButtons` / `getJournalSheetHeaderButtons`
or the `controls` array on the application config. The render hook is a
fallback when the dedicated header-button hook isn't available.

```javascript
Hooks.on("getActorSheetHeaderButtons", (app, buttons) => {
  buttons.unshift({
    label: game.i18n.localize("COMMUNITY_SCREEN.buttons.push-to-table"),
    class: "community-screen-push",
    icon: "fas fa-tv",
    onclick: () => pushActorToTable(app.document),
  });
});
```

(Note: `onclick` is the v1-style handler key. AppV2 native buttons use
`action` + a registered action handler; the `getXxxHeaderButtons` hook
intentionally targets the v1 contract since most system sheets still use it.)

### Sheet header buttons (push-buttons.mjs pattern)

The repo's `scripts/push-buttons.mjs` already does this — read it before
adding new buttons to confirm the established style:

```bash
grep -n "Hooks.on" scripts/push-buttons.mjs
```

## Inputs to confirm

1. **Hook name** — full name like `renderJournalSheet` or `renderApplicationV2`.
2. **What the handler does** — one-sentence summary.
3. **Where the hook should live** — existing feature file or new module
   (use `new-feature-module` skill if new).

## Pitfalls

- **Mixing jQuery and DOM on the same hook**: pick one, then commit to it
  for the whole handler.
- **Forgetting `html` is HTMLElement in v14**: `html.find(...)` will throw
  `TypeError: html.find is not a function` — that's the smoking-gun
  symptom that you're treating an AppV2 hook as legacy.
- **Calling `.append(htmlString)`**: AppV2 doesn't have it; use
  `insertAdjacentHTML(...)` instead.
- **Hooking too early**: render hooks fire on every re-render, including
  data updates. Idempotency matters — don't unconditionally append a
  button on every render; query first and bail if it exists.
- **System sheet specificity**: `renderActorSheet` fires for **every** actor
  sheet across **every** system. Filter by `app.constructor.name` or
  `app.document?.type` if you only want a subset.

## Things to never do

- Don't use jQuery API in new AppV2 hook handlers (per `CLAUDE.md`).
- Don't assume the v14 core has migrated every sheet to AppV2 — many
  system sheets are still v1 until system maintainers update.
- Don't hard-code English strings in button labels — go through
  `game.i18n.localize(...)` (see `i18n-extract` skill).
