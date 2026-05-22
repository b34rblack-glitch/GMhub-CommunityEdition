---
name: pixi-v7-guard
description: Detect PIXI v8 API usage that's incompatible with Foundry v14 (which still ships PIXI v7). Run this before committing PIXI/canvas code, or when reviewing a diff that touches scripts/combat-highlight.mjs or any other PIXI Graphics code. Greps for v8-only patterns (.circle, .rect, .poly, .ellipse, .fill({ chain style) and reports offenders with file:line.
---

# pixi-v7-guard

Foundry v14 still ships PIXI **v7**. PIXI v8 API calls compile but throw at
runtime, often with a cryptic `TypeError: g.circle is not a function`. This
skill catches them before they ship.

## When to use

- After editing any PIXI Graphics code (today that's `scripts/combat-highlight.mjs`).
- Before committing changes that mention "highlight", "overlay", "ring",
  "canvas drawing", "PIXI", or "Graphics".
- As a pre-release check (the `release-cut` skill can invoke this).
- On demand when the user asks to "check for PIXI v8 API" or "audit canvas code".

## Forbidden v8 patterns

PIXI v8 method names that are **not** in v7. If any of these appear on a
`PIXI.Graphics` instance (or any object created via `new PIXI.Graphics()`),
flag them:

| v8 (forbidden)         | v7 equivalent (required)                          |
| ---------------------- | ------------------------------------------------- |
| `.circle(x, y, r)`     | `.drawCircle(x, y, r)`                            |
| `.rect(x, y, w, h)`    | `.drawRect(x, y, w, h)`                           |
| `.roundRect(...)`      | `.drawRoundedRect(...)`                           |
| `.ellipse(...)`        | `.drawEllipse(...)`                               |
| `.poly([...])`         | `.drawPolygon([...])`                             |
| `.star(...)`           | `.drawStar(...)` (still v7-compat, no rename)     |
| `.stroke({ width, color, alpha })` chained after a shape | `.lineStyle(width, color, alpha)` **before** the shape |
| `.fill({ color, alpha })` chained after a shape | `.beginFill(color, alpha)` / `.endFill()` around the shape |

## Detection command

Run this from the repo root (or a path argument the user provides):

```bash
# Match v8-only method names on a likely Graphics receiver.
# Returns file:line:match — empty output means clean.
grep -rn --include='*.mjs' -E '\.(circle|rect|roundRect|ellipse|poly)\s*\(' scripts/ || true
grep -rn --include='*.mjs' -E '\.(stroke|fill)\s*\(\s*\{' scripts/ || true
```

False-positive risk: `.rect`/`.fill` are also CSS-ish names. Inspect each
match before reporting. Confirm the receiver is a PIXI Graphics object (look
for `new PIXI.Graphics()` upstream in the function).

## Reporting

For each real hit, report:

```
<path>:<line> — uses .<method>(...) (PIXI v8 only). Replace with .<v7-equivalent>(...).
```

If multiple hits in one file, group them.

If clean, report a single line: `PIXI v7 guard: clean (N files scanned).`

## Auto-fix policy

**Do not auto-fix.** Replacements are mechanical for the simple cases
(`.circle` → `.drawCircle`) but tricky for the `.fill({...})` chain (v7
needs the fill bracketing the shape call, not chained after). Surface the
findings and let the user decide; offer to fix individually if asked.

## Things to never do

- Don't suggest "upgrade PIXI" — the version is dictated by Foundry, not us.
- Don't rewrite the table above from memory — these are the canonical pairs.
