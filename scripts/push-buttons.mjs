// ============================================================================
// scripts/push-buttons.mjs
// ----------------------------------------------------------------------------
// Injects "Push to Table" header buttons on document sheets and adds the
// matching right-click context-menu entry on directory views.
//
// The actual push uses Foundry-native delivery wherever possible (v14):
//   - JournalEntry → `doc.show(true, [tableUser])`
//                    (Foundry's "Show to Players" socket flow)
//   - Item         → `executeAsUser("showImage", tableId, {src, title, caption})`
//                    (Items have no native show; we ship image + caption)
//   - Actor        → `executeAsUser("showImage", tableId, {src, title})`
//                    (Portrait — same socketlib path)
//   - Scene        → `executeAsUser("followScene", tableId, {sceneId})`
//
// `canPush()` gates the buttons so they only appear when there's
// actually somewhere to push to.
// ============================================================================

import { isGM, getTableUserId, isTableOnline, getTableUser } from "./identity.mjs";
import { executeAsUser } from "./sockets.mjs";
import { ensureTableObserver } from "./ownership.mjs";
import { sleep, t } from "./lib/helpers.mjs";
import { logger } from "./lib/logger.mjs";

/** Settle delay after an ownership grant so the update propagates. */
const OWNERSHIP_PROPAGATION_DELAY_MS = 200;

/**
 * @returns {boolean} True if the GM may push to a connected Table user.
 */
function canPush() {
  // All three must hold for a push to actually land somewhere.
  return isGM() && Boolean(getTableUserId()) && isTableOnline();
}

/**
 * Convert a possibly-HTML description string to a short plain-text
 * caption. The DOM API is used since the GM client always has one.
 *
 * @param {string} html
 * @param {number} [max]
 * @returns {string}
 */
function htmlToCaption(html, max = 400) {
  if (!html) return "";
  try {
    // Build a throwaway div so the browser does the HTML→text conversion for us.
    const div = document.createElement("div");
    div.innerHTML = String(html);
    // textContent strips all tags; collapse whitespace runs.
    const text = (div.textContent || "").replace(/\s+/g, " ").trim();
    // Truncate to `max` with an ellipsis so the caption stays one line.
    return text.length > max ? text.slice(0, max - 1) + "…" : text;
  } catch {
    // If parsing fails entirely, at least return a truncated raw string.
    return String(html).slice(0, max);
  }
}

/**
 * Extract a description string from an item across systems.
 *
 * @param {Item} item
 * @returns {string}
 */
function extractItemDescription(item) {
  // Item descriptions live in different places per system; cover the
  // common shapes: plain string, {value}, {unidentified}, {short}.
  const d = item?.system?.description;
  if (typeof d === "string") return d;
  return d?.value ?? d?.unidentified ?? d?.short ?? "";
}

// =====================================================================
// Push dispatcher.
// =====================================================================

/**
 * Push a document to the Table using Foundry's native share APIs where
 * available, falling back to our own socketlib `showImage` path otherwise.
 *
 * @param {ClientDocument} doc
 * @returns {Promise<void>}
 */
async function pushDocument(doc) {
  if (!doc) return;
  // Resolve the configured Table user.
  const tableUser = getTableUser();
  if (!tableUser) {
    ui.notifications?.warn(t("errors.no-table-user"));
    return;
  }
  const tableId = tableUser.id;
  const type = doc.documentName;
  logger.info(`Pushing ${type} "${doc.name ?? doc.id}" to Table (${tableUser.name}).`);

  try {
    if (type === "JournalEntry") {
      // Foundry's native show() emits the "showEntry" socket event to the
      // specified users. The receiving client renders the entry directly
      // through its own sheet — bypasses the document-permission /
      // fromUuid race that the old custom-socket path hit.
      //
      // Foundry requires the receiving user to have the doc in their
      // collection, so ensure at least LIMITED ownership first.
      await ensureTableObserver(doc);
      // Wait for the ownership update to land on the Table before show().
      await sleep(OWNERSHIP_PROPAGATION_DELAY_MS);
      // Feature-detect: doc.show is on JournalEntry in v11+.
      if (typeof doc.show === "function") {
        await doc.show(true, [tableUser]);
      } else {
        logger.warn("JournalEntry.show() unavailable — Foundry v14 expected.");
        return;
      }
    } else if (type === "Item") {
      // Route through our own socketlib handler instead of
      // foundry.applications.apps.ImagePopout.shareImage. shareImage's
      // signature has shifted across v11/v12/v13/v14 and broadcast
      // semantics aren't guaranteed to target a single user, so our
      // own showImage path is more predictable: the Table client opens
      // a local ImagePopout with the URL we send.
      const caption = htmlToCaption(extractItemDescription(doc));
      await executeAsUser("showImage", tableId, {
        src: doc.img,
        title: doc.name ?? "",
        caption,
      });
    } else if (type === "Actor") {
      // Portrait. Fall back through plausible image sources, because
      // depending on the system / actor type / linking mode, any one of
      // these can be the meaningful artwork:
      //   - actor.img is the canonical portrait
      //   - prototypeToken.texture.src is the token art (often the
      //     same image for monsters where there's no separate portrait)
      //   - the scene-token texture is a last resort for tokenized actors
      const src = doc.img || doc.prototypeToken?.texture?.src || doc.token?.texture?.src || "";
      if (!src) {
        // No usable image — surface the failure to the GM rather than
        // silently shipping an empty popup that won't render anything.
        logger.warn(`pushDocument(Actor): no img on "${doc.name}".`);
        ui.notifications?.warn(t("errors.push-failed", { message: "no image" }));
        return;
      }
      logger.info(`pushDocument(Actor): src=${src}`);
      await executeAsUser("showImage", tableId, {
        src,
        title: doc.name ?? "",
      });
    } else if (type === "Scene") {
      // Scene is a different beast — followScene on the Table.
      await executeAsUser("followScene", tableId, { sceneId: doc.id });
    } else {
      // Unsupported document type — log loudly so we know if a future
      // sheet type is unhandled.
      logger.warn(`pushDocument: unsupported document type ${type}`);
      return;
    }
    // Confirmation toast on the GM side.
    ui.notifications?.info(t("notifications.pushed"));
  } catch (err) {
    // Surface failures so the GM knows the push didn't land.
    logger.warn("pushDocument failed:", err);
    ui.notifications?.warn(t("errors.push-failed", { message: err?.message ?? String(err) }));
  }
}

/**
 * Push an arbitrary image URL (used by macros / future drag-to-push).
 *
 * @param {string} src
 * @param {string} [title]
 * @returns {Promise<void>}
 */
export async function pushImage(src, title = "") {
  if (!canPush()) return;
  const tableUser = getTableUser();
  if (!tableUser) return;
  await executeAsUser("showImage", tableUser.id, { src, title });
}

// =====================================================================
// Header-button and directory-context injection.
// =====================================================================

/**
 * Inject "Push to Table" into an AppV2 sheet's header controls.
 *
 * @param {object} app
 * @param {Array<object>} controls
 * @returns {void}
 */
function injectAppV2HeaderControl(app, controls) {
  // Don't show the button if it can't do anything.
  if (!canPush()) return;
  if (!Array.isArray(controls)) return;
  // AppV2 exposes .document; legacy v1 sheets exposed .object.
  const doc = app?.document ?? app?.object;
  if (!doc) return;
  // We support exactly these document types.
  const supported = ["JournalEntry", "Item", "Actor", "Scene"];
  if (!supported.includes(doc.documentName)) return;
  // Dedupe — header hooks can fire multiple times for the same app.
  if (controls.some((c) => c?.action === "community-screen-push")) return;
  // Insert at position 0 so it sits first on the left.
  controls.unshift({
    action: "community-screen-push",
    icon: "fa-solid fa-tv",
    label: t("buttons.push-to-table"),
    onClick: () => pushDocument(doc),
  });
}

/**
 * Inject "Push to Table" into a legacy v1 sheet's header buttons.
 *
 * @param {object} app
 * @param {Array<object>} buttons
 * @returns {void}
 */
function injectV1HeaderButton(app, buttons) {
  if (!canPush()) return;
  if (!Array.isArray(buttons)) return;
  const doc = app?.document ?? app?.object;
  if (!doc) return;
  const supported = ["JournalEntry", "Item", "Actor", "Scene"];
  if (!supported.includes(doc.documentName)) return;
  if (buttons.some((b) => b?.class === "community-screen-push")) return;
  // v1 button shape uses `class` and `onclick` (lowercase).
  buttons.unshift({
    label: t("buttons.push-to-table"),
    class: "community-screen-push",
    icon: "fa-solid fa-tv",
    onclick: () => pushDocument(doc),
  });
}

/**
 * Factory for directory-context-menu injectors. Each directory has its
 * own context-menu hook, so we build a small per-directory injector that
 * knows which collection to look the document up in.
 *
 * @param {string} collection
 * @returns {(html: any, entries: Array<object>) => void}
 */
function makeDirectoryInjector(collection) {
  return (_html, entries) => {
    if (!canPush()) return;
    if (!Array.isArray(entries)) return;
    // _csm is our own marker for dedupe; works around the fact that
    // some directories call the context hook multiple times.
    if (entries.some((e) => e?._csm === `community-screen-push-${collection}`)) return;
    entries.push({
      name: t("context.push-to-table"),
      icon: '<i class="fa-solid fa-tv"></i>',
      condition: () => canPush(),
      _csm: `community-screen-push-${collection}`,
      callback: async (target) => {
        // `target` is either an HTMLLIElement (v14) or a jQuery wrapper (legacy).
        const el = target instanceof HTMLElement ? target : target?.[0];
        // Different directories use different data attribute names.
        const id = el?.dataset?.entryId ?? el?.dataset?.documentId;
        if (!id) return;
        // Look up the document by id in the appropriate collection.
        const docName = collectionToDocName(collection);
        const coll = game.collections?.get?.(docName);
        const doc = coll?.get?.(id);
        if (doc) await pushDocument(doc);
      },
    });
  };
}

/**
 * Translate a directory collection nickname to a Document class name.
 *
 * @param {string} nick
 * @returns {string}
 */
function collectionToDocName(nick) {
  switch (nick) {
    case "journal":
      return "JournalEntry";
    case "actors":
      return "Actor";
    case "items":
      return "Item";
    case "scenes":
      return "Scene";
    default:
      return nick;
  }
}

/**
 * Register every push-button hook.
 *
 * @returns {void}
 */
export function init() {
  // AppV2 header buttons — generic + class-specific names. Foundry's
  // hook namer dispatches both, depending on the sheet.
  Hooks.on("getHeaderControlsApplicationV2", injectAppV2HeaderControl);
  Hooks.on("getApplicationHeaderControls", injectAppV2HeaderControl);
  const v2DocClasses = [
    "JournalEntrySheet",
    "JournalSheet",
    "ItemSheet",
    "ActorSheet",
    "SceneConfig",
  ];
  for (const cls of v2DocClasses) {
    Hooks.on(`getHeaderControls${cls}`, injectAppV2HeaderControl);
  }

  // Legacy v1 sheet header buttons (still used by some systems).
  Hooks.on("getJournalSheetHeaderButtons", injectV1HeaderButton);
  Hooks.on("getItemSheetHeaderButtons", injectV1HeaderButton);
  Hooks.on("getActorSheetHeaderButtons", injectV1HeaderButton);
  Hooks.on("getSceneConfigHeaderButtons", injectV1HeaderButton);

  // Directory context menus (right-click on a directory entry in sidebar).
  Hooks.on("getJournalDirectoryEntryContext", makeDirectoryInjector("journal"));
  Hooks.on("getActorDirectoryEntryContext", makeDirectoryInjector("actors"));
  Hooks.on("getItemDirectoryEntryContext", makeDirectoryInjector("items"));
  Hooks.on("getSceneDirectoryEntryContext", makeDirectoryInjector("scenes"));

  // Console fallback for diagnostics / macros.
  Hooks.once("ready", () => {
    const mod = game.modules?.get?.("community-screen");
    if (mod) {
      mod.api = mod.api ?? {};
      mod.api.pushDocument = (doc) => pushDocument(doc);
      mod.api.pushImage = (src, title) => pushImage(src, title);
    }
  });
}
