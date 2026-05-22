---
name: foundry-docs-lookup
description: Resolve a Foundry VTT v13/v14 API reference (class, method, hook, or namespace) to its canonical docs URL and fetch the relevant section. Use when the user asks "what's the signature of X?", "where's the docs for foundry.applications.Y?", "is there a v14 hook for Z?", or when writing new code that uses an unfamiliar Foundry API.
---

# foundry-docs-lookup

Look up Foundry VTT API references against the official v13/v14 documentation.

## When to use

- The user asks for a method signature, hook name, or class location.
- New code uses an unfamiliar `foundry.*` namespaced API and the calling
  shape isn't obvious from existing scripts.
- A reviewer flagged an API as deprecated or wrong-namespaced.

## Known canonical URLs (v13 — current published series)

Foundry's docs URL pattern:

```
https://foundryvtt.com/api/v13/<namespace-path>/<ClassName>.html
```

Common namespaces in this codebase:

| Symbol                                      | URL fragment                                       |
| ------------------------------------------- | -------------------------------------------------- |
| `foundry.applications.api.ApplicationV2`    | `classes/foundry.applications.api.ApplicationV2`   |
| `foundry.applications.api.HandlebarsApplicationMixin` | `functions/foundry.applications.api.HandlebarsApplicationMixin` |
| `foundry.applications.api.DialogV2`         | `classes/foundry.applications.api.DialogV2`        |
| `foundry.applications.apps.ImagePopout`     | `classes/foundry.applications.apps.ImagePopout`    |
| `foundry.applications.sheets.*`             | `classes/foundry.applications.sheets.<X>`          |
| `foundry.documents.*`                       | `classes/foundry.documents.<X>`                    |
| `foundry.canvas.placeables.*`               | `classes/foundry.canvas.placeables.<X>`            |
| `Hooks`                                     | `classes/foundry.helpers.Hooks`                    |
| `socketlib`                                 | (external — https://github.com/manuelVo/foundryvtt-socketlib) |
| `libWrapper`                                | (external — https://github.com/ruipin/fvtt-lib-wrapper) |

Hooks reference (separate page, lists every emitted hook):

```
https://foundryvtt.com/api/v13/index.html
```

## Workflow

### 1. Identify the symbol

Parse out the user's question into a fully-qualified name. If they say
"ImagePopout", expand to `foundry.applications.apps.ImagePopout`.

### 2. Build the URL

Use the table above. If the namespace path isn't listed, default to:

```
https://foundryvtt.com/api/v13/classes/<dotted.fully.qualified.Name>.html
```

(Replace each `.` with `.` in the URL — Foundry's URL scheme keeps the dots.)

### 3. Fetch and summarise

Use `WebFetch` to retrieve the page. Extract:

- Constructor signature
- Public methods relevant to the user's question
- Hooks emitted (look for the **"Fires:"** annotation)
- Deprecation warnings (look for `@deprecated` or "Deprecated since")

Report a focused summary (5–15 lines), not the full page dump.

### 4. Cite the URL

Always include the URL in the response so the user can read further. Quote
exact signature strings — paraphrasing API shapes leads to subtle bugs.

## Version note

Foundry v14 is the module target (`compatibility.verified: "14"`), but at
time of writing the published docs are still on v13. The v14 docs URL
pattern when they ship will be `https://foundryvtt.com/api/v14/...` —
swap the path segment if the user explicitly asks for v14 docs and they're
available. Most v13 APIs are still current in v14; deprecations are called
out in v14 release notes.

If the v13 docs page is missing for a symbol the user asked about, fall
back to:

- `https://foundryvtt.wiki/` — community wiki, often has v12/v13 examples.
- The GitHub source mirror linked from the foundryvtt.com docs header.

## Things to never do

- **Don't guess signatures from memory.** Foundry's API changes between
  majors — the v11/v12/v13 differences are non-trivial. Always fetch.
- **Don't link to v9/v10/v11 docs URLs** — those exist but are stale.
- **Don't recommend `Application` (v1)** for new code — use `ApplicationV2`
  per the repo's namespaced-API convention.
- **Don't recommend `Dialog` (v1)** — use `foundry.applications.api.DialogV2`.
