---
name: socket-handler-add
description: Add a new socketlib RPC handler to the Community Screen module. Use when the user asks to "add a socket handler", "wire up a new socket call", "add an RPC for X", or when a feature needs cross-client communication (GM ↔ Table). Generates the camelCase handler name, the GM-side try/catch wrapper with localized notification, and the registration in either scripts/sockets.mjs or the feature's own init().
---

# socket-handler-add

Adds a new socketlib handler — the inter-client RPC mechanism the module
uses for GM ↔ Table communication.

## When to use

The user wants a new RPC. Triggers:

- "Add a socket handler for X"
- "I need to send data from the GM to the Table"
- "Add an RPC for resetting the highlight"
- A new feature needs to invoke something on the Table client

## Background (read once, then act)

The protocol is defined in `scripts/sockets.mjs`. Two registration paths:

1. **Built-in handlers** — defined directly in `sockets.mjs` (e.g.
   `_setTableMode`, `_refitScene`). Used for cross-cutting concerns that
   don't belong to any one feature.
2. **Feature-owned handlers** — defined in the feature file
   (e.g. `popups.mjs`, `vision.mjs`) and registered via `setHandler(name, fn)`
   during that feature's `init()`. **This is the preferred path** for
   anything feature-specific.

Either way, the **name** must be in the `names` array near the bottom of
`register()` in `sockets.mjs`, otherwise socketlib won't expose it.

## Inputs to confirm

1. **Handler name** — camelCase (per `CLAUDE.md` convention), verb-first.
   Examples: `showJournal`, `setVisionFocus`, `refitScene`, `clearHighlight`.
2. **Direction** — GM-only (`executeAsGM`) or specific user (`executeAsUser`,
   typically the Table). Most handlers are Table-targeted.
3. **Payload shape** — JSDoc the object literal that the handler receives.
4. **Owner file** — built-in (sockets.mjs) or feature-owned (default).

## Steps

### 1. Add the handler name to the `names` array

Open `scripts/sockets.mjs`. In `register()` near the bottom there's a list:

```javascript
const names = [
  "showJournal",
  "showItem",
  // ...
];
```

Append the new name. Keep the order grouped — show/close/set/follow buckets.

### 2. Write the handler

**Feature-owned path** (preferred). In the feature file (e.g. `scripts/<feature>.mjs`):

```javascript
import { setHandler } from "./sockets.mjs";
import { isTableUser } from "./identity.mjs";
import { logger } from "./lib/logger.mjs";

/**
 * <One-sentence description of what this handler does on the receiver.>
 *
 * @param {{<field>: <type>}} payload - Description of payload fields.
 * @returns {Promise<void>}
 */
async function _<handlerName>({ <fields> } = {}) {
  // Guard: this handler runs on the Table client only.
  if (!isTableUser()) return;
  try {
    // ...real work...
  } catch (err) {
    logger.error("<handlerName> failed:", err);
  }
}

export function init() {
  // ...existing init wiring...
  setHandler("<handlerName>", _<handlerName>);
}
```

**Built-in path**. In `scripts/sockets.mjs`, add the function next to the
existing `_setTableMode` / `_refitScene` definitions, then add a
`handlers.set("<handlerName>", _<handlerName>);` line inside `register()`
near the existing `handlers.set(...)` block.

### 3. Add the GM-side caller

Where the GM triggers the RPC (control palette, push button, hook), wrap
the call with try/catch and a localized user-visible warning on failure
(per `CLAUDE.md`):

```javascript
import { executeAsUser } from "./sockets.mjs";
import { getTableUserId } from "./identity.mjs";

async function pushSomething(data) {
  const tableId = getTableUserId();
  if (!tableId) {
    ui.notifications.warn(game.i18n.localize("COMMUNITY_SCREEN.errors.no-table-user"));
    return;
  }
  try {
    await executeAsUser("<handlerName>", tableId, data);
  } catch (err) {
    // executeAsUser already toasts on failure via its own catch;
    // any rethrow lands here for caller-specific handling.
    logger.warn("Push failed:", err);
  }
}
```

`executeAsUser` already wraps its socketlib call with try/catch + a
localized `ui.notifications.warn` of `COMMUNITY_SCREEN.errors.table-offline`,
so the outer try/catch only needs to handle caller-specific cleanup.

### 4. Add i18n entries if the handler surfaces new error/notification strings

Invoke the `i18n-extract` skill if you wrote any new user-visible strings.

### 5. Verify

```bash
npm run check
```

Smoke-test in Foundry if the user is set up for it.

## Things to never do

- **Never call `setHandler()` after `register()` has run.** socketlib refuses
  to rebind a name once it's been pushed. `setHandler` is effectively an
  init-time-only API — call it inside the feature's `init()`, which runs
  during `Hooks.once("init", ...)` before `register()` fires on `ready`.
- **Never bypass `executeAsUser` / `executeAsGM`** — don't call `cs.executeAsUser`
  directly. Routing through the wrapper gives you the localized error toast.
- **Don't add a handler name to the `names` array but forget to bind a real
  function.** The stub will silently no-op and the failure mode is invisible.
- **Don't use snake_case or kebab-case for handler names** — names are
  camelCase per `CLAUDE.md`.
