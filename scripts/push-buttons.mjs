// Community Screen — injects "Push to Table" header buttons and directory
// context-menu entries, and builds the renderable HTML on the GM side so
// the Table client doesn't need permission to resolve the document.

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

// =====================================================================
// HTML builders — GM-side. Each returns either an HTML string or null
// (skip), plus optional subtitle / image for portraits.
// =====================================================================

/**
 * Build a rendered HTML fragment for one journal page (text or image).
 *
 * @param {JournalEntryPage} page
 * @returns {string}
 */
function buildJournalPageHtml(page) {
  if (!page) return "";
  const name = foundry.utils.escapeHTML?.(page.name ?? "") ?? page.name ?? "";
  let body = "";
  if (page.type === "image" && page.src) {
    body = `<img class="community-screen-page-image" src="${page.src}" alt="${name}">`;
    if (page.image?.caption) {
      const cap = foundry.utils.escapeHTML?.(page.image.caption) ?? page.image.caption;
      body += `<p class="community-screen-page-caption">${cap}</p>`;
    }
  } else if (page.type === "video" && page.src) {
    body = `<video class="community-screen-page-video" src="${page.src}" controls loop></video>`;
  } else if (page.type === "pdf" && page.src) {
    body = `<a class="community-screen-page-pdf" href="${page.src}" target="_blank" rel="noopener">${name}</a>`;
  } else {
    // text page (or unknown — fall back to text.content)
    body = page.text?.content ?? "";
  }
  return `<section class="community-screen-journal-page">
    <h2 class="community-screen-page-name">${name}</h2>
    <div class="community-screen-page-body">${body}</div>
  </section>`;
}

/**
 * Build an HTML fragment that displays a JournalEntry's pages stacked.
 *
 * @param {JournalEntry} journal
 * @returns {string}
 */
function buildJournalHtml(journal) {
  const pages = journal.pages?.contents ?? [];
  if (pages.length === 0) {
    return `<p class="community-screen-empty">${t("notifications.empty-journal") || "Empty journal."}</p>`;
  }
  // Honor manual sort if any.
  const sorted = [...pages].sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));
  return sorted.map(buildJournalPageHtml).join("\n");
}

/**
 * Build an HTML fragment for an item — image + description + simple
 * key/value list of common system fields. System-agnostic.
 *
 * @param {Item} item
 * @returns {string}
 */
function buildItemHtml(item) {
  const name = foundry.utils.escapeHTML?.(item.name ?? "") ?? item.name ?? "";
  const img = item.img ?? "";
  // Description is system-specific. Try common D&D-style paths first.
  const desc =
    item.system?.description?.value ??
    item.system?.description?.unidentified ??
    item.system?.description ??
    "";
  let imgTag = "";
  if (img) imgTag = `<img class="community-screen-item-image" src="${img}" alt="${name}">`;
  return `<div class="community-screen-item">
    <header class="community-screen-item-header">
      ${imgTag}
      <h2 class="community-screen-item-name">${name}</h2>
    </header>
    <div class="community-screen-item-description">${typeof desc === "string" ? desc : ""}</div>
  </div>`;
}

// =====================================================================
// Push dispatcher.
// =====================================================================

/**
 * Send the renderable representation of a document to the Table.
 *
 * @param {ClientDocument} doc
 * @returns {Promise<void>}
 */
async function pushDocument(doc) {
  if (!doc) return;
  const tableId = getTableUserId();
  if (!tableId) {
    ui.notifications?.warn(t("errors.no-table-user"));
    return;
  }
  const type = doc.documentName;
  logger.info(`Pushing ${type} "${doc.name ?? doc.id}" to Table.`);
  try {
    if (type === "JournalEntry") {
      const html = buildJournalHtml(doc);
      await executeAsUser("showJournal", tableId, { title: doc.name ?? "", html });
    } else if (type === "Item") {
      const html = buildItemHtml(doc);
      await executeAsUser("showItem", tableId, { title: doc.name ?? "", html });
    } else if (type === "Actor") {
      // Portrait via image URL — no document lookup on Table side.
      const src = doc.img;
      if (src) {
        await executeAsUser("showImage", tableId, { src, caption: doc.name });
      } else {
        logger.warn(`pushDocument: actor "${doc.name}" has no img.`);
        return;
      }
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
 * Directory-specific context-menu injector that knows which collection to
 * look the id up in.
 *
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
 * Register every push-button hook.
 *
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
}
