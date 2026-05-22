---
name: i18n-extract
description: Find user-visible string literals in scripts/ and move them to lang/en.json under COMMUNITY_SCREEN.*, rewriting the call sites to game.i18n.localize(...). Use when adding a feature with hard-coded UI strings, reviewing a diff for i18n compliance, or when the user asks to "localize these strings", "extract i18n keys", or "move strings to lang/en.json".
---

# i18n-extract

Per `CLAUDE.md`: **all user-visible strings must go through
`game.i18n.localize("COMMUNITY_SCREEN.foo.bar")` with entries in `lang/en.json`.**
This skill audits a target (file, diff, or path) for hard-coded strings and
moves them to the localization file.

## When to use

- After writing or scaffolding a new feature (`new-feature-module` skill).
- Reviewing a diff that touches user-facing call sites.
- The user says "localize these", "extract i18n", "add lang keys", or asks
  about an unlocalized string.

## What counts as user-visible

A string literal passed to any of these call shapes is in scope:

| Call site                                          | Example                                                        |
| -------------------------------------------------- | -------------------------------------------------------------- |
| `ui.notifications.info / warn / error / notify`    | `ui.notifications.warn("Table user is offline");`              |
| AppV2 / Dialog title                               | `new DialogV2({ window: { title: "Confirm push" }, ... })`     |
| AppV2 button labels                                | `buttons: [{ label: "Push", ... }]`                            |
| Sheet header button `label` / `tooltip`            | `buttons.push({ label: "Push to Table", ... })`                |
| Context menu `name`                                | `{ name: "Show on Table", icon: ..., callback: ... }`          |
| Keybinding `name` / `hint`                         | `game.keybindings.register(..., { name: "...", hint: "..." })` |
| Settings `name` / `hint` / enum choice labels      | `game.settings.register(..., { name: "...", hint: "..." })`    |
| Handlebars `{{...}}` rendered text                 | `<button>Push to Table</button>`                               |

## What's NOT in scope

- Logger calls (`logger.info / warn / error / debug`) — those are dev-facing.
- Comments and JSDoc — internal documentation.
- CSS class names, settings keys, socket handler names, module ids.
- Error messages thrown internally that aren't surfaced to the user.

## Workflow

### 1. Scan

Read the target file(s). For each match against the call-site table above,
note `file:line`, the literal, and propose a key.

### 2. Propose keys

Keys are dot-separated, lowercase, kebab-case for multi-word segments,
nested under `COMMUNITY_SCREEN.*`. Use the existing `lang/en.json` structure
as the template — common buckets:

- `COMMUNITY_SCREEN.module.*` — module-wide labels.
- `COMMUNITY_SCREEN.settings.<key>.*` — settings name/hint/choices.
- `COMMUNITY_SCREEN.controls.*` — control palette UI.
- `COMMUNITY_SCREEN.buttons.*` — push-to-table sheet/directory buttons.
- `COMMUNITY_SCREEN.dialogs.<name>.*` — dialog titles, bodies, buttons.
- `COMMUNITY_SCREEN.errors.*` — error toasts.
- `COMMUNITY_SCREEN.notifications.*` — non-error toasts.
- `COMMUNITY_SCREEN.keybindings.<id>.*` — keybinding name/hint.

If a string fits an existing key, **reuse it** — don't add a duplicate.

### 3. Confirm

Before writing, report the proposed key → literal mapping back to the user
in a compact table. If there are more than ~3 entries, ask for approval; for
a single obvious one (a notifications.warn from a fresh handler), proceed.

### 4. Insert into `lang/en.json`

`lang/en.json` is a nested object — preserve indentation (2 spaces) and
trailing-comma style of the existing file. Insert new keys in the
alphabetically/grouped position that matches the surrounding section. Run
`npm run format` after edits to normalise.

### 5. Rewrite call sites

Replace each literal with `game.i18n.localize("COMMUNITY_SCREEN.<key>")`.

For strings that need interpolation, use `game.i18n.format("...", {var})`
and a `{var}` placeholder in the JSON value:

```javascript
ui.notifications.info(game.i18n.format("COMMUNITY_SCREEN.notifications.pushed", { name: actor.name }));
```

```json
"pushed": "Pushed {name} to the Table."
```

### 6. Verify

```bash
npm run check
```

Confirm parse + lint pass. If a hook handler is `renderXyz` and `html` is
jQuery (legacy v1), watch for `html[0]` unwrap requirements when reading
rewritten label text back.

## Things to never do

- Don't move logger strings — they're dev-facing.
- Don't invent keys that don't follow the `COMMUNITY_SCREEN.*` namespace.
- Don't reformat unrelated parts of `lang/en.json` — only touch what's added.
- Don't add other-locale stubs (e.g. `lang/de.json`) unless explicitly asked.
