// ============================================================================
// scripts/setup-wizard.mjs
// ----------------------------------------------------------------------------
// First-run setup wizard — a GM-only, guided ApplicationV2 window that removes
// the module's biggest adoption barrier: a new GM otherwise has to hand-create
// a player-role "Table" user, find its id, and point the `table-user-id` world
// setting at it before anything works.
//
// Built on ApplicationV2 + HandlebarsApplicationMixin (v14 idiom), mirroring
// scripts/control-palette.mjs. It is a module-level singleton so re-opening
// re-renders the same instance rather than allocating a new window.
//
// The wizard is a LINEAR multi-step flow driven by an internal `this.step`
// index over a single Handlebars PART (NOT native AppV2 TABS — later steps gate
// on earlier answers). Pure, Foundry-free logic (step model, dependency
// reducer, gate predicates, settings-bucket classifier) lives in
// scripts/setup-wizard-logic.mjs so it can be unit-tested under `node --test`.
//
// This scaffold establishes the singleton, the open()/init() surface, and the
// `api.openWizard()` console hook; the step framework, dependency gate,
// Table-user capture, settings walk-through, connectivity report, and Finish
// commit are layered on in the following steps.
// ============================================================================

import { MODULE_ID } from "./module.mjs";
import { isGM } from "./identity.mjs";
import { t } from "./lib/helpers.mjs";
import { logger } from "./lib/logger.mjs";

/**
 * The singleton wizard instance. Kept around so re-opening just re-renders
 * rather than allocating a new window each time.
 *
 * @type {SetupWizard | null}
 */
let wizard = null;

/**
 * GM-only first-run setup wizard built on ApplicationV2 with
 * HandlebarsApplicationMixin. Renders templates/setup-wizard.hbs.
 */
class SetupWizard extends foundry.applications.api.HandlebarsApplicationMixin(
  foundry.applications.api.ApplicationV2,
) {
  // AppV2's static options govern window chrome and behavior.
  static DEFAULT_OPTIONS = {
    id: "community-screen-setup-wizard",
    classes: ["community-screen", "community-screen-setup-wizard"],
    // `tag: "form"` so field edits flow through the AppV2 form handler; the
    // handler MERGES changes into `this.data` for cross-step persistence.
    tag: "form",
    window: {
      title: "COMMUNITY_SCREEN.setup-wizard.title",
      icon: "fa-solid fa-wand-magic-sparkles",
      resizable: false,
    },
    // Fixed height + a scrollable body (see styles/setup-wizard.css) so the
    // window doesn't jitter as steps of different heights render.
    position: { width: 560, height: 640 },
    // `submitOnChange` calls the handler on every field edit but does NOT
    // itself re-render, so there is no focus/cursor loss; `closeOnSubmit:false`
    // keeps an accidental Enter/submit from closing the wizard.
    form: {
      handler: SetupWizard._onFormChange,
      submitOnChange: true,
      closeOnSubmit: false,
    },
    // `actions` maps data-action attributes to handler methods. Navigation
    // (next/back/finish/dismiss) is wired in the step-framework step.
    actions: {},
  };

  // AppV2 PARTS: a single Handlebars part; the linear step flow is driven by
  // `this.step` inside it, not by multiple parts or native TABS.
  static PARTS = {
    main: { template: `modules/${MODULE_ID}/templates/setup-wizard.hbs` },
  };

  /**
   * AppV2's data prep hook — returns the context passed to the template.
   * The full per-step context is built in the step-framework step; this
   * scaffold renders a localized welcome placeholder.
   *
   * @override
   * @returns {Promise<object>}
   */
  async _prepareContext() {
    return {
      labels: {
        title: t("setup-wizard.title"),
        welcomeTitle: t("setup-wizard.welcome.title"),
        welcomeBody: t("setup-wizard.welcome.body"),
      },
    };
  }

  /**
   * AppV2 form-change handler. Wired now (so `submitOnChange` has a target)
   * but a no-op until the step framework adds cross-step form persistence.
   * MUST NOT call `this.render()` — that would steal focus mid-edit.
   *
   * @this {SetupWizard}
   * @param {Event} _event - The submit/change event.
   * @param {HTMLFormElement} _form - The wizard's form element.
   * @param {object} _formData - AppV2's parsed form data wrapper.
   * @returns {void}
   */
  static _onFormChange(_event, _form, _formData) {
    // Cross-step form-state persistence is implemented in the step framework.
  }
}

/**
 * Open (or re-render) the wizard. GM-only; a no-op on a non-GM/Table client.
 * Ignores the `setup-complete` flag — the palette "Run setup" button always
 * reopens (the one-time auto-open gating lives in the ready hook, added later).
 *
 * @returns {void}
 */
export function open() {
  // Only GMs configure the module; never surface this to the Table/player client.
  if (!isGM()) return;
  // Lazy-instantiate the singleton on first open.
  if (!wizard) wizard = new SetupWizard();
  wizard.render(true);
}

/**
 * Register wizard hooks and the console-callable opener. Live-refresh on
 * `userConnected` and the one-time auto-open are added in the connectivity /
 * Finish step.
 *
 * @returns {void}
 */
export function init() {
  // Expose a console-callable opener, MERGING into the existing module api so
  // we don't clobber openPalette/pushDocument/etc:
  //   game.modules.get("community-screen").api.openWizard()
  Hooks.once("ready", () => {
    const mod = game.modules?.get?.(MODULE_ID);
    if (mod) {
      mod.api = mod.api ?? {};
      mod.api.openWizard = () => open();
    }
    logger.debug("Setup wizard initialized.");
  });
}
