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
// LINEAR multi-step flow driven by an internal `this.step` index over a single
// Handlebars PART (NOT native AppV2 TABS — later steps gate on earlier
// answers). Pure, Foundry-free logic (step model, dependency reducer, gate
// predicates, settings-bucket classifier) lives in
// scripts/setup-wizard-logic.mjs so it can be unit-tested under `node --test`.
//
// Form-state persistence: `tag: "form"` + `submitOnChange`. The change handler
// MERGES the edited fields into `this.data`; `_prepareContext` re-emits
// `this.data` so re-rendered inputs stay pre-filled across Next/Back. The
// handler NEVER calls `this.render()` (that would steal focus mid-edit), and
// navigation buttons are `type="button"` + `data-action` so they don't submit
// the form.
// ============================================================================

import { MODULE_ID } from "./module.mjs";
import { isGM, getTableUser, getTableUserSetting } from "./identity.mjs";
import { set as setSetting, get as getSetting } from "./settings.mjs";
import { syncAll } from "./ownership.mjs";
import { t } from "./lib/helpers.mjs";
import { logger } from "./lib/logger.mjs";
import {
  STEPS,
  LAST_STEP,
  REQUIRED_MODULES,
  clampStep,
  evaluateDependencies,
  canAdvance,
  canFinish,
  selectableUsers,
  findReusableTableUser,
  DEFAULT_TABLE_USER_NAME,
  FIT_MODES,
  SETTINGS_BUCKETS,
  shouldAutoOpen,
} from "./setup-wizard-logic.mjs";

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
    // `actions` maps data-action attributes to handler methods. All navigation
    // buttons are `type="button"` in the template so they never submit.
    actions: {
      next: SetupWizard._onNext,
      back: SetupWizard._onBack,
      finish: SetupWizard._onFinish,
      dismiss: SetupWizard._onDismiss,
      "reuse-table-user": SetupWizard._onReuseTableUser,
    },
  };

  // AppV2 PARTS: a single Handlebars part; the linear step flow is driven by
  // `this.step` inside it, not by multiple parts or native TABS.
  static PARTS = {
    main: { template: `modules/${MODULE_ID}/templates/setup-wizard.hbs` },
  };

  /**
   * Reset to the first step with freshly-seeded state. Called on every open()
   * so "Run setup" always starts at the beginning rather than wherever the
   * previous (un-destroyed singleton) session left off.
   *
   * @returns {void}
   */
  reset() {
    /** @type {number} Current step index into STEPS. */
    this.step = 0;
    /** @type {object} Cross-step captured form state (merged by the change handler). */
    this.data = this._seedData();
    /** @type {number | null} Last-rendered step, for scroll-reset on navigation. */
    this._lastRenderedStep = null;
  }

  /**
   * Build the initial `this.data`. Seeds only framework defaults here; later
   * steps pre-fill it from the current settings and the resolved Table user.
   *
   * @returns {object}
   */
  _seedData() {
    // Pre-select the currently-configured Table user (by id OR name) so
    // re-running the wizard shows the existing choice rather than defaulting to
    // "create". Falls back to "create" on a fresh world.
    const current = getTableUser();
    const tableUser = current?.id
      ? { tableUserMode: "select", tableUserId: current.id }
      : { tableUserMode: "create" };
    // Bucket-A editable settings, pre-filled from the CURRENT values so the
    // controls open at the live state. The form handler overwrites these as the
    // GM edits; Finish persists whatever ends up here. Seeding them up front
    // means Finish commits the right values even if the GM never touches them.
    return {
      ...tableUser,
      fitMode: getSetting("fit-mode", "contain"),
      popupBackdrop: getSetting("popup-backdrop", true) === true,
      autoGrantOwnership: getSetting("auto-grant-ownership", true) === true,
    };
  }

  /**
   * Format a setting's CURRENT value for the read-only "described-with-current-
   * value" rows. Booleans → localized On/Off; choice settings → the localized
   * choice label; everything else → its string form.
   *
   * @param {string} key - Setting key.
   * @param {"boolean" | "choice" | "raw"} kind - How to render the value.
   * @returns {string} A localized, display-ready value string.
   */
  _describedValue(key, kind) {
    const value = getSetting(key);
    if (kind === "boolean") {
      return value === true
        ? t("setup-wizard.settings.value-on")
        : t("setup-wizard.settings.value-off");
    }
    if (kind === "choice") {
      // Choice values are themselves i18n keys under settings.<key>.<value>.
      return t(`settings.${key}.${value}`);
    }
    return value === undefined || value === null ? "" : String(value);
  }

  /**
   * Build one read-only walk-through row: localized name + hint (reusing the
   * setting's own i18n keys) plus the formatted current value.
   *
   * @param {string} key - Setting key.
   * @param {"boolean" | "choice" | "raw"} kind - Value formatting.
   * @returns {{ key: string, name: string, hint: string, value: string }}
   */
  _describedRow(key, kind) {
    return {
      key,
      name: t(`settings.${key}.name`),
      hint: t(`settings.${key}.hint`),
      value: this._describedValue(key, kind),
    };
  }

  /**
   * Snapshot every user as a plain `{ id, name, isGM }` for the Foundry-free
   * user helpers (candidate list + duplicate guard).
   *
   * @returns {Array<{ id: string, name: string, isGM: boolean }>}
   */
  _allUsers() {
    return Array.from(game.users ?? []).map((u) => ({
      id: u.id,
      name: u.name,
      isGM: u.isGM,
    }));
  }

  /**
   * Read the live active-state of the required modules and reduce it through
   * the pure `evaluateDependencies`. `.active` is the only real signal —
   * presence in `game.modules` means *installed*, not *active*.
   *
   * @returns {{ ok: boolean, modules: Array<{ id: string, active: boolean }> }}
   */
  _dependencyState() {
    const activeById = {};
    for (const id of REQUIRED_MODULES) {
      activeById[id] = game.modules?.get?.(id)?.active === true;
    }
    return evaluateDependencies(activeById);
  }

  /**
   * Resolve what the connectivity step reports — mirroring what Finish will
   * actually do. In `select` mode it live-checks the chosen user. In `create`
   * mode it mirrors the Finish duplicate-guard: if a reusable "Table" already
   * exists, report that user's live state; otherwise the user does not exist
   * yet, so report `pending` (Finish will create it). Report-only — never gates
   * Finish.
   *
   * @returns {{ pending: boolean, online: boolean, name: string }}
   */
  _connectivityState() {
    const data = this.data ?? {};
    const mode = data.tableUserMode ?? "create";
    if (mode === "select") {
      const u = game.users?.get?.(data.tableUserId);
      return { pending: false, online: u?.active === true, name: u?.name ?? "" };
    }
    // create mode — Finish reuses an existing non-GM "Table" rather than
    // making a duplicate, so connectivity reflects that same resolution.
    const reusable = findReusableTableUser(this._allUsers());
    if (reusable) {
      const u = game.users?.get?.(reusable.id);
      return { pending: false, online: u?.active === true, name: reusable.name };
    }
    return { pending: true, online: false, name: DEFAULT_TABLE_USER_NAME };
  }

  /**
   * AppV2 first-render hook. `open()` calls `reset()` before rendering, so
   * this is a defensive fallback for a bare `render()` with no prior reset.
   *
   * @override
   * @param {object} context
   * @param {object} options
   * @returns {void}
   */
  _onFirstRender(context, options) {
    super._onFirstRender?.(context, options);
    if (this.step === undefined) this.reset();
  }

  /**
   * AppV2's data prep hook — returns the context passed to the template, with
   * all copy pre-localized and per-step flags computed so the template needs
   * no i18n or comparison helpers.
   *
   * @override
   * @returns {Promise<object>}
   */
  async _prepareContext() {
    const step = clampStep(this.step ?? 0);
    const key = STEPS[step];
    const data = this.data ?? {};
    const mode = data.tableUserMode ?? "create";
    // Live dependency status for the dependency step + the advance/Finish gate.
    const deps = this._dependencyState();
    // Table-user step: candidate users (non-GM) + the duplicate guard.
    const users = this._allUsers();
    const options = selectableUsers(users);
    const reusable = findReusableTableUser(users);
    // Effective dropdown selection: keep a valid captured id, else default to
    // the first candidate. In select mode, capture it back into `this.data` so
    // Finish commits exactly what the GM saw selected.
    let selectedId = data.tableUserId ?? "";
    if (mode === "select") {
      if (!options.some((u) => u.id === selectedId)) selectedId = options[0]?.id ?? "";
      this.data.tableUserId = selectedId;
    }
    // Offer to reuse an existing "Table" user — unless it is already the one the
    // GM has selected (then the offer would be redundant noise).
    const showReuseOffer = reusable !== null && !(mode === "select" && selectedId === reusable.id);

    // Settings walk-through (aware-and-adjust). Editable core-three come from
    // `this.data` (seeded from current values, overwritten as the GM edits);
    // the described/informational buckets read the CURRENT values live.
    const fitModeValue = data.fitMode ?? getSetting("fit-mode", "contain");
    const fitModeOptions = FIT_MODES.map((v) => ({
      value: v,
      label: t(`settings.fit-mode.${v}`),
      selected: v === fitModeValue,
    }));
    // Per-setting value formatting for the read-only rows.
    const kinds = {
      "custom-scale": "raw",
      "physical-target-unit": "choice",
      "display-diagonal-in": "raw",
      "highlight-style": "choice",
      "highlight-use-disposition": "boolean",
      "suppress-table-chat": "boolean",
      "spotlight-enabled": "boolean",
    };
    const physicalSettings = SETTINGS_BUCKETS.physical.map((k) => this._describedRow(k, kinds[k]));
    const describedSettings = SETTINGS_BUCKETS.described.map((k) =>
      this._describedRow(k, kinds[k]),
    );
    // Client-scoped rows are informational only — no current value shown (a
    // GM-laptop read is not the Table TV's value; the wizard never writes them).
    const clientSettings = SETTINGS_BUCKETS.clientInfo.map((k) => ({
      key: k,
      name: t(`settings.${k}.name`),
      hint: t(`settings.${k}.hint`),
    }));

    // Connectivity step: report-only online/offline (or pending-create) state.
    const conn = this._connectivityState();
    const connectivityStatusText = conn.pending
      ? t("setup-wizard.connectivity.pending", { name: conn.name })
      : conn.online
        ? t("setup-wizard.connectivity.status-online", { name: conn.name })
        : t("setup-wizard.connectivity.status-offline", { name: conn.name });
    return {
      step,
      stepKey: key,
      isFirst: step === 0,
      isLast: step === LAST_STEP,
      canBack: step > 0,
      // Per-step render flags — exactly one is true.
      isWelcome: key === "welcome",
      isDependencies: key === "dependencies",
      isTableUser: key === "table-user",
      isSettings: key === "settings",
      isConnectivity: key === "connectivity",
      // Re-emitted captured state so inputs stay pre-filled across Next/Back.
      data,
      tableUserModeCreate: mode === "create",
      tableUserModeSelect: mode === "select",
      // Table-user step: candidate <option>s (marking the effective selection),
      // empty-state flag, and the reuse offer when a "Table" user already exists.
      userOptions: options.map((u) => ({
        id: u.id,
        name: u.name,
        selected: u.id === selectedId,
      })),
      hasUserOptions: options.length > 0,
      reusableTableUser: reusable,
      showReuseOffer,
      // Settings step: editable core-three (pre-filled) + read-only buckets +
      // the physical-mini reveal flag.
      fitModeOptions,
      isPhysical: fitModeValue === "physical",
      popupBackdrop: data.popupBackdrop === true,
      autoGrantOwnership: data.autoGrantOwnership === true,
      physicalSettings,
      clientSettings,
      describedSettings,
      // Connectivity step: report-only state (pending-create vs online/offline).
      connectivityPending: conn.pending,
      connectivityOnline: conn.online,
      connectivityStatusText,
      // Dependency-step status: per-module rows + whether all are active.
      depsOk: deps.ok,
      dependencies: deps.modules.map((m) => ({
        id: m.id,
        active: m.active,
        statusText: m.active
          ? t("setup-wizard.dependencies.active")
          : t("setup-wizard.dependencies.inactive"),
      })),
      // All copy pre-localized.
      labels: {
        progress: t("setup-wizard.progress", {
          number: String(step + 1),
          total: String(STEPS.length),
        }),
        back: t("setup-wizard.nav.back"),
        next: t("setup-wizard.nav.next"),
        finish: t("setup-wizard.nav.finish"),
        dismiss: t("setup-wizard.nav.dismiss"),
        welcomeTitle: t("setup-wizard.welcome.title"),
        welcomeBody: t("setup-wizard.welcome.body"),
        dependenciesTitle: t("setup-wizard.dependencies.title"),
        dependenciesBody: t("setup-wizard.dependencies.body"),
        dependenciesInstruction: t("setup-wizard.dependencies.instruction"),
        tableUserTitle: t("setup-wizard.table-user.title"),
        tableUserBody: t("setup-wizard.table-user.body"),
        modeCreate: t("setup-wizard.table-user.mode-create"),
        modeSelect: t("setup-wizard.table-user.mode-select"),
        tableUserCreateHint: t("setup-wizard.table-user.create-hint"),
        tableUserSelectLabel: t("setup-wizard.table-user.select-label"),
        tableUserEmpty: t("setup-wizard.table-user.empty"),
        tableUserReuse: t("setup-wizard.table-user.reuse", {
          name: reusable?.name ?? "",
        }),
        tableUserReuseAction: t("setup-wizard.table-user.reuse-action"),
        settingsTitle: t("setup-wizard.settings.title"),
        settingsBody: t("setup-wizard.settings.body"),
        settingsEditableTitle: t("setup-wizard.settings.editable-title"),
        settingsPhysicalTitle: t("setup-wizard.settings.physical-title"),
        settingsPhysicalResInfo: t("setup-wizard.settings.physical-res-info"),
        settingsClientTitle: t("setup-wizard.settings.client-title"),
        settingsClientNote: t("setup-wizard.settings.client-note"),
        settingsDescribedTitle: t("setup-wizard.settings.described-title"),
        // Editable core-three: reuse each setting's own name/hint i18n keys.
        fitModeName: t("settings.fit-mode.name"),
        fitModeHint: t("settings.fit-mode.hint"),
        popupBackdropName: t("settings.popup-backdrop.name"),
        popupBackdropHint: t("settings.popup-backdrop.hint"),
        autoGrantName: t("settings.auto-grant-ownership.name"),
        autoGrantHint: t("settings.auto-grant-ownership.hint"),
        connectivityTitle: t("setup-wizard.connectivity.title"),
        connectivityBody: t("setup-wizard.connectivity.body"),
      },
    };
  }

  /**
   * AppV2 render hook. Resets the scrollable body to the top whenever a NEW
   * step has just rendered (so a long step doesn't leave the next one scrolled
   * mid-way). Later steps add their conditional-reveal listeners here.
   *
   * @override
   * @param {object} context
   * @param {object} options
   * @returns {Promise<void>}
   */
  async _onRender(context, options) {
    await super._onRender(context, options);
    if (this._lastRenderedStep !== this.step) {
      const body = this.element?.querySelector?.(".community-screen-setup-wizard-body");
      if (body) body.scrollTop = 0;
      this._lastRenderedStep = this.step;
    }
    // Table-user step: toggle the create/select sub-blocks live on the mode
    // radio WITHOUT a full re-render (which would fight the form handler).
    this._bindTableUserReveal();
    // Settings step: reveal the physical-mini block only for fit-mode=physical.
    this._bindSettingsReveal();
  }

  /**
   * Settings step: reveal the physical-mini block only when `fit-mode` is
   * `physical`, toggling `.is-hidden` on a `change` listener over the fit-mode
   * select. Same rationale as `_bindTableUserReveal` — no full re-render, so the
   * form handler keeps ownership of the captured value. No-op off the settings
   * step.
   *
   * @returns {void}
   */
  _bindSettingsReveal() {
    const root = this.element;
    const select = root?.querySelector?.('select[name="fitMode"]');
    const block = root?.querySelector?.("[data-physical-block]");
    if (!select || !block) return;
    const apply = () => block.classList.toggle("is-hidden", select.value !== "physical");
    select.addEventListener("change", apply);
    apply();
  }

  /**
   * Table-user step: reveal exactly the create-mode or select-mode sub-block
   * for the currently-checked `tableUserMode` radio, toggling a CSS class on a
   * `change` listener. This mirrors the physical-mini reveal pattern: the form
   * handler captures the radio value into `this.data`; this listener only
   * flips visibility, so there is no re-render and no focus loss. No-op on any
   * step that lacks the mode radios.
   *
   * @returns {void}
   */
  _bindTableUserReveal() {
    const root = this.element;
    const radios = root?.querySelectorAll?.('input[name="tableUserMode"]') ?? [];
    if (!radios.length) return;
    const apply = () => {
      const mode = root.querySelector('input[name="tableUserMode"]:checked')?.value ?? "create";
      for (const el of root.querySelectorAll("[data-mode-block]")) {
        el.classList.toggle("is-hidden", el.dataset.modeBlock !== mode);
      }
    };
    for (const r of radios) r.addEventListener("change", apply);
    apply();
  }

  /**
   * AppV2 form-change handler. MERGES the edited fields into `this.data` so
   * they survive the full re-render that Next/Back triggers. MUST NOT call
   * `this.render()` — `submitOnChange` deliberately does not re-render, which
   * is what preserves focus/cursor while the GM edits a field.
   *
   * @this {SetupWizard}
   * @param {Event} _event - The submit/change event.
   * @param {HTMLFormElement} _form - The wizard's form element.
   * @param {object} formData - AppV2's parsed form data (`.object` is expanded).
   * @returns {void}
   */
  static _onFormChange(_event, _form, formData) {
    Object.assign(this.data, formData.object);
  }

  /**
   * "Next" — advance one step. The dependency gate is layered on in the
   * dependency-verification step so the wizard can't step past an unmet
   * requirement.
   *
   * @this {SetupWizard}
   * @param {Event} _event
   * @returns {Promise<void>}
   */
  static async _onNext(_event) {
    // Consult the pure gate: the dependency step blocks forward navigation
    // until both required modules are active.
    const state = { depsOk: this._dependencyState().ok };
    if (!canAdvance(this.step, state)) {
      ui.notifications?.warn(t("setup-wizard.dependencies.blocked"));
      return;
    }
    this.step = clampStep(this.step + 1);
    await this.render();
  }

  /**
   * "Back" — retreat one step.
   *
   * @this {SetupWizard}
   * @param {Event} _event
   * @returns {Promise<void>}
   */
  static async _onBack(_event) {
    this.step = clampStep(this.step - 1);
    await this.render();
  }

  /**
   * "Reuse this user" — the duplicate-guard shortcut. When a non-GM user named
   * "Table" already exists, switch the decision to select-existing and
   * pre-select that user (still committed only on Finish), then re-render so the
   * dropdown reflects it. Unlike the form handler, an action handler MAY render.
   *
   * @this {SetupWizard}
   * @param {Event} _event
   * @returns {Promise<void>}
   */
  static async _onReuseTableUser(_event) {
    const reusable = findReusableTableUser(this._allUsers());
    if (!reusable) return;
    this.data.tableUserMode = "select";
    this.data.tableUserId = reusable.id;
    await this.render();
  }

  /**
   * "Finish" — commit the captured decisions and close. The ordered commit
   * (Table user → settings → ownership sync → setup-complete flag) is
   * implemented in the connectivity/Finish step; here it just closes.
   *
   * @this {SetupWizard}
   * @param {Event} _event
   * @returns {Promise<void>}
   */
  static async _onFinish(_event) {
    // Belt-and-suspenders: refuse Finish if a required module is inactive.
    if (!canFinish({ depsOk: this._dependencyState().ok })) {
      ui.notifications?.warn(t("setup-wizard.dependencies.blocked"));
      return;
    }
    await this._commitAndClose();
  }

  /**
   * "Don't show again" — explicitly suppress the one-time auto-open without
   * completing setup, then close. Sets the hidden `setup-complete` flag so the
   * wizard won't auto-open next load; the palette "Run setup" button still
   * reopens it regardless.
   *
   * @this {SetupWizard}
   * @param {Event} _event
   * @returns {Promise<void>}
   */
  static async _onDismiss(_event) {
    try {
      await setSetting("setup-complete", true);
    } catch (err) {
      logger.warn("Failed to persist setup-complete on dismiss:", err);
    }
    await this.close();
  }

  /**
   * Resolve the Table user's id for Finish, mirroring `_connectivityState`:
   *   - `select` mode → the captured `tableUserId`.
   *   - `create` mode → reuse an existing non-GM "Table" (duplicate guard) if
   *     one exists, otherwise `User.create` a fresh player-role "Table".
   * May throw if `User.create` is rejected server-side (e.g. an assistant GM);
   * the caller handles that.
   *
   * @returns {Promise<string>} The resolved user id ("" if none could be resolved).
   */
  async _resolveTableUserId() {
    const data = this.data ?? {};
    const mode = data.tableUserMode ?? "create";
    if (mode === "select") {
      return data.tableUserId ?? "";
    }
    // create mode — reuse before creating so a second, name-ambiguous "Table"
    // is never made (Wave 2 M4).
    const reusable = findReusableTableUser(this._allUsers());
    if (reusable) return reusable.id;
    // Minimal creation: default name, player role, no forced password/avatar.
    const UserClass = globalThis.getDocumentClass?.("User") ?? globalThis.User;
    const role = globalThis.CONST?.USER_ROLES?.PLAYER ?? 1;
    const created = await UserClass.create({ name: DEFAULT_TABLE_USER_NAME, role });
    return created?.id ?? "";
  }

  /**
   * Perform the ordered Finish commit and close (spec KD8). Order matters:
   *   (a) resolve/commit the Table-user decision → persist `table-user-id`;
   *   (b) persist each editable Bucket-A setting;
   *   (c) `ownership.syncAll()` (now reads the fresh `table-user-id` +
   *       `auto-grant-ownership`);
   *   (d) set the hidden `setup-complete` flag;
   *   (e) close.
   * On a `User.create` failure the wizard notifies, leaves `setup-complete`
   * unset, and stays OPEN so the GM can retry (spec KD4).
   *
   * @returns {Promise<void>}
   */
  async _commitAndClose() {
    const data = this.data ?? {};
    // (a) Resolve the Table user (may create). Failure aborts without closing.
    let tableUserId;
    try {
      tableUserId = await this._resolveTableUserId();
    } catch (err) {
      logger.error("Setup wizard: failed to create the Table user:", err);
      ui.notifications?.error(t("setup-wizard.finish.create-failed"));
      return;
    }
    if (!tableUserId) {
      // Nothing resolved (e.g. select mode with no candidate). Keep the wizard
      // open and the flag unset so auto-open re-fires next load.
      ui.notifications?.warn(t("setup-wizard.finish.no-user"));
      return;
    }
    await setSetting("table-user-id", tableUserId);
    // (b) Persist the editable Bucket-A settings.
    await setSetting("fit-mode", data.fitMode ?? getSetting("fit-mode", "contain"));
    await setSetting("popup-backdrop", data.popupBackdrop === true);
    await setSetting("auto-grant-ownership", data.autoGrantOwnership === true);
    // (c) Grant the Table user OWNER on PCs now that the id is persisted.
    //     GM-guarded + idempotent, and a no-op when auto-grant-ownership is off.
    try {
      await syncAll();
    } catch (err) {
      logger.warn("Setup wizard: ownership.syncAll failed:", err);
    }
    // (d) Suppress the one-time auto-open now that setup is complete.
    await setSetting("setup-complete", true);
    // (e) Done.
    ui.notifications?.info(t("setup-wizard.finish.done"));
    await this.close();
  }
}

/**
 * Open (or re-render) the wizard, starting fresh at the first step. GM-only; a
 * no-op on a non-GM/Table client. Ignores the `setup-complete` flag — the
 * palette "Run setup" button always reopens (the one-time auto-open gating
 * lives in the ready hook, added in the Finish step).
 *
 * @returns {void}
 */
export function open() {
  // Only GMs configure the module; never surface this to the Table/player client.
  if (!isGM()) return;
  // Lazy-instantiate the singleton on first open.
  if (!wizard) wizard = new SetupWizard();
  // Always start at the beginning with freshly-seeded state.
  wizard.reset();
  wizard.render(true);
}

/**
 * Register wizard hooks and the console-callable opener.
 *
 * @returns {void}
 */
export function init() {
  // Live-refresh the connectivity indicator when any user connects/disconnects.
  // ONE module-level guarded listener (like control-palette.mjs) — registering
  // it per-render (_onRender) would leak one registration on every Next/Back.
  Hooks.on("userConnected", () => {
    if (wizard?.rendered) wizard.render(false);
  });

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

    // One-time auto-open on first run: GM client only, no Table user configured
    // yet, and the hidden flag unset. The palette "Run setup" button bypasses
    // this gate entirely, so a GM can always reopen the wizard afterward.
    if (
      shouldAutoOpen({
        isGM: isGM(),
        tableUserSetting: getTableUserSetting(),
        setupComplete: getSetting("setup-complete", false),
      })
    ) {
      open();
    }
  });
}
