// Community Screen — injects "Push to Table" header buttons and directory
// context-menu entries.
//
// The actual push goes through Foundry's native share mechanisms (v14):
//   - JournalEntry.prototype.show(true, [tableUser])
//   - foundry.applications.apps.ImagePopout.shareImage(data, [userId])
//
// These bypass the document-permission / fromUuid path that previous
// versions struggled with. Items have no native share so they ride
// the ImagePopout path with the item description in the caption.

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
    const div = document.createElement("div");
    div.innerHTML = String(html);
    const text = (div.textContent || "").replace(/\s+/g, " ").trim();
    return text.length > max ? text.slice(0, max - 1) + "…" : text;
  } catch {
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
  const d = item?.system?.description;
  if (typeof d === "string") return d;
  return d?.value ?? d?.unidentified ?? d?.short ?? "";
}

// =====================================================================
// Push dispatcher.
// =====================================================================

/**
 * Push a document to the Table using Foundry's native share APIs.
 *
 * @param {ClientDocument} doc
 * @returns {Promise<void>}
 */
async function pushDocument(doc) {
  if (!doc) return;
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
      await sleep(OWNERSHIP_PROPAGATION_DELAY_MS);
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
      // Portrait — same socketlib path.
      await executeAsUser("showImage", tableId, {
        src: doc.img,
        title: doc.name ?? "",
      });
    } else if (type === "Scene") {
      // Scene is a different beast — followScene on the Table.
      await executeAsUser("followScene", tableId, { sceneId: doc.id });
    } else {
      logger.warn(`pushDocument: unsupported document type ${type}`);
      return;
    }
    ui.notifications?.info(t("notifications.pushed"));
  } catch (err) {
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
 * @param {object} app
 * @param {Array<object>} controls
 * @returns {void}
 */
function injectAppV2HeaderControl(app, controls) {
  if (!canPush()) return;
  if (!Array.isArray(controls)) return;
  const doc = app?.document ?? app?.object;
  if (!doc) return;
  const supported = ["JournalEntry", "Item", "Actor", "Scene"];
  if (!supported.includes(doc.documentName)) return;
  if (controls.some((c) => c?.action === "community-screen-push")) return;
  controls.unshift({
    action: "community-screen-push",
    icon: "fa-solid fa-tv",
    label: t("buttons.push-to-table"),
    onClick: () => pushDocument(doc),
  });
}

/**
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
  buttons.unshift({
    label: t("buttons.push-to-table"),
    class: "community-screen-push",
    icon: "fa-solid fa-tv",
    onclick: () => pushDocument(doc),
  });
}

/**
 * @param {string} collection
 * @returns {(html: any, entries: Array<object>) => void}
 */
function makeDirectoryInjector(collection) {
  return (_html, entries) => {
    if (!canPush()) return;
    if (!Array.isArray(entries)) return;
    if (entries.some((e) => e?._csm === `community-screen-push-${collection}`)) return;
    entries.push({
      name: t("context.push-to-table"),
      icon: '<i class="fa-solid fa-tv"></i>',
      condition: () => canPush(),
      _csm: `community-screen-push-${collection}`,
      callback: async (target) => {
        const el = target instanceof HTMLElement ? target : target?.[0];
        const id = el?.dataset?.entryId ?? el?.dataset?.documentId;
        if (!id) return;
        const docName = collectionToDocName(collection);
        const coll = game.collections?.get?.(docName);
        const doc = coll?.get?.(id);
        if (doc) await pushDocument(doc);
      },
    });
  };
}

/**
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
 * @returns {void}
 */
export function init() {
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

  // Legacy v1 sheet header buttons.
  Hooks.on("getJournalSheetHeaderButtons", injectV1HeaderButton);
  Hooks.on("getItemSheetHeaderButtons", injectV1HeaderButton);
  Hooks.on("getActorSheetHeaderButtons", injectV1HeaderButton);
  Hooks.on("getSceneConfigHeaderButtons", injectV1HeaderButton);

  // Directory context menus.
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
