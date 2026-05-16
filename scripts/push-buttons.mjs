// Community Screen — injects "Push to Table" header buttons and directory context-menu entries.

import { isGM, getTableUserId, isTableOnline } from "./identity.mjs";
import { executeAsUser } from "./sockets.mjs";
import { t } from "./lib/helpers.mjs";
import { logger } from "./lib/logger.mjs";

/**
 * @returns {boolean} True if the GM may push to a connected Table user.
 */
function canPush() {
  return isGM() && Boolean(getTableUserId()) && isTableOnline();
}

/**
 * Send a document push to the Table. Picks the right handler based on
 * document type.
 *
 * @param {ClientDocument} doc - JournalEntry, Item, Actor, etc.
 * @returns {Promise<void>}
 */
async function pushDocument(doc) {
  if (!doc) return;
  const tableId = getTableUserId();
  if (!tableId) {
    ui.notifications?.warn(t("errors.no-table-user"));
    return;
  }
  const uuid = doc.uuid;
  const type = doc.documentName;
  try {
    if (type === "JournalEntry") {
      await executeAsUser("showJournal", tableId, { uuid });
    } else if (type === "Item") {
      await executeAsUser("showItem", tableId, { uuid });
    } else if (type === "Actor") {
      await executeAsUser("showPortrait", tableId, { actorUuid: uuid });
    } else if (type === "Scene") {
      await executeAsUser("followScene", tableId, { sceneId: doc.id });
    } else {
      logger.warn(`pushDocument: unsupported document type ${type}`);
      return;
    }
    ui.notifications?.info(t("notifications.pushed"));
  } catch (err) {
    ui.notifications?.warn(t("errors.push-failed", { message: err?.message ?? String(err) }));
  }
}

/**
 * Inject "Push to Table" into an AppV2 sheet's header controls. Idempotent —
 * skipped if the action already exists.
 *
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
  buttons.unshift({
    label: t("buttons.push-to-table"),
    class: "community-screen-push",
    icon: "fa-solid fa-tv",
    onclick: () => pushDocument(doc),
  });
}

/**
 * Inject a "Push to Table" entry into a directory context menu.
 *
 * @param {HTMLElement | object} _html
 * @param {Array<object>} entries
 * @returns {void}
 */
function injectDirectoryContextEntry(_html, entries) {
  if (!canPush()) return;
  if (!Array.isArray(entries)) return;
  if (entries.some((e) => e?.name === "community-screen-push")) return;
  entries.push({
    name: t("context.push-to-table"),
    icon: '<i class="fa-solid fa-tv"></i>',
    condition: () => canPush(),
    callback: async (target) => {
      // `target` is either an HTMLLIElement (legacy) or already the doc id.
      const id =
        target?.dataset?.entryId ??
        target?.dataset?.documentId ??
        target?.[0]?.dataset?.entryId ??
        target?.[0]?.dataset?.documentId;
      if (!id) return;
      // Decide collection by directory: we don't have it here; let the call
      // site figure it out via the directory hook variant below.
      logger.warn("Directory CSM fallback hit without a specific collection.");
    },
  });
}

/**
 * Factory for directory-specific context-menu injectors that already know
 * which collection to look up the id in.
 *
 * @param {string} collection - e.g. "journal", "actors", "items", "scenes".
 * @returns {(html: any, entries: Array<object>) => void}
 */
function makeDirectoryInjector(collection) {
  return (_html, entries) => {
    if (!canPush()) return;
    if (!Array.isArray(entries)) return;
    if (entries.some((e) => e?.name === `community-screen-push-${collection}`)) return;
    entries.push({
      name: t("context.push-to-table"),
      icon: '<i class="fa-solid fa-tv"></i>',
      condition: () => canPush(),
      // Internal marker to skip duplicate injection.
      _csm: `community-screen-push-${collection}`,
      callback: async (target) => {
        const el = target instanceof HTMLElement ? target : target?.[0];
        const id = el?.dataset?.entryId ?? el?.dataset?.documentId;
        if (!id) return;
        const coll = game.collections?.get?.(collectionToDocName(collection));
        const doc = coll?.get?.(id);
        if (doc) await pushDocument(doc);
      },
    });
    // Mirror our marker into the name so the dedupe check sees it.
    const last = entries[entries.length - 1];
    if (last) last.name = t("context.push-to-table");
  };
}

/**
 * Map a directory collection nickname → Document class name.
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
  // AppV2 header controls. Foundry's hook namer dispatches both a generic
  // (getHeaderControlsApplicationV2) and class-specific names depending on
  // the system's sheet class — listen broadly.
  Hooks.on("getHeaderControlsApplicationV2", injectAppV2HeaderControl);
  Hooks.on("getApplicationHeaderControls", injectAppV2HeaderControl);
  // Some sheets fire class-specific variants — register the common ones.
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

  // Legacy v1 sheet header buttons (some systems still use these).
  Hooks.on("getJournalSheetHeaderButtons", injectV1HeaderButton);
  Hooks.on("getItemSheetHeaderButtons", injectV1HeaderButton);
  Hooks.on("getActorSheetHeaderButtons", injectV1HeaderButton);
  Hooks.on("getSceneConfigHeaderButtons", injectV1HeaderButton);

  // Directory context menus (right-click in sidebar).
  Hooks.on("getJournalDirectoryEntryContext", makeDirectoryInjector("journal"));
  Hooks.on("getActorDirectoryEntryContext", makeDirectoryInjector("actors"));
  Hooks.on("getItemDirectoryEntryContext", makeDirectoryInjector("items"));
  Hooks.on("getSceneDirectoryEntryContext", makeDirectoryInjector("scenes"));
  // Fallback generic registration (unused unless wired).
  void injectDirectoryContextEntry;
}
