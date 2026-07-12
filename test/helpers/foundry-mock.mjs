// ============================================================================
// test/helpers/foundry-mock.mjs
// ----------------------------------------------------------------------------
// Shared Foundry/DOM mock harness for the reliability test suite (KD3 in
// .conclave/spec.md).
//
// The modules under test read Foundry globals LAZILY inside functions, so they
// are import-safe under bare Node once the globals are stubbed on `globalThis`
// BEFORE invocation. Two modules (control-palette.mjs, setup-wizard.mjs) DO
// dereference `foundry.applications.api.*` at class-definition (import) time —
// so `installFoundryMock()` must run before those modules are (dynamically)
// imported. Test files therefore call `installFoundryMock()` at top level and
// then `await import(...)` the module under test.
//
// install/restore snapshot a FIXED `MANAGED_KEYS` list. That list deliberately
// EXCLUDES the DOM globals (document/window/HTMLElement/Event/rAF) so the mock
// never fights the jsdom preload in test-setup/dom.mjs.
//
// Every builder is a plain recording spy — no external test-double library.
// ============================================================================

// The globalThis keys this harness owns. DOM keys are intentionally absent —
// jsdom (test-setup/dom.mjs) owns those for the whole process.
const MANAGED_KEYS = [
  "game",
  "ui",
  "canvas",
  "foundry",
  "Hooks",
  "socketlib",
  "libWrapper",
  "fromUuid",
  "fromUuidSync",
  "CONFIG",
  "CONST",
];

/**
 * Recording socketlib spy. `registerModule(id)` returns a per-module socket
 * handle that records every `register(name, fn)` (so tests can assert handler
 * identity / real-vs-stub) and every `executeAsUser` / `executeAsGM` dispatch.
 *
 * @returns {object} A socketlib-shaped object with a `sockets` array and a
 *   `lastSocket` getter for the most-recently registered module handle.
 */
export function makeSocketlib() {
  const sockets = [];
  return {
    sockets,
    get lastSocket() {
      return sockets[sockets.length - 1];
    },
    registerModule(id) {
      const registered = new Map();
      const executeCalls = [];
      const executeGMCalls = [];
      const socket = {
        moduleId: id,
        registered,
        executeCalls,
        executeGMCalls,
        register(name, fn) {
          registered.set(name, fn);
        },
        executeAsUser(name, userId, ...args) {
          executeCalls.push({ name, userId, args });
          return Promise.resolve(undefined);
        },
        executeAsGM(name, ...args) {
          executeGMCalls.push({ name, args });
          return Promise.resolve(undefined);
        },
      };
      sockets.push(socket);
      return socket;
    },
  };
}

/**
 * Recording libWrapper spy. Records `register`/`unregister` targets so tests
 * can assert the EXACT namespaced target strings and the OVERRIDE type.
 *
 * @returns {object}
 */
export function makeLibWrapper() {
  const registerCalls = [];
  const unregisterCalls = [];
  return {
    registerCalls,
    unregisterCalls,
    register(id, target, fn, type) {
      registerCalls.push({ id, target, fn, type });
    },
    unregister(id, target) {
      // Real libWrapper throws when the name isn't registered; canvas-lock
      // wraps unregister in try/catch, so a non-throwing spy is faithful.
      unregisterCalls.push({ id, target });
    },
  };
}

/**
 * Recording Hooks spy. Records `on`/`once` registrations and can synchronously
 * `call` them. Exposes helpers to fetch the callback(s) for a given hook name.
 *
 * @returns {object}
 */
export function makeHooks() {
  const records = { on: [], once: [] };
  const hooks = {
    records,
    on(name, fn) {
      records.on.push({ name, fn });
      return records.on.length;
    },
    once(name, fn) {
      records.once.push({ name, fn });
      return records.once.length;
    },
    off() {},
    call(name, ...args) {
      for (const r of records.on) if (r.name === name) r.fn(...args);
      for (const r of records.once) if (r.name === name) r.fn(...args);
      return true;
    },
    callAll(name, ...args) {
      return hooks.call(name, ...args);
    },
    /** @returns {Function[]} All on+once callbacks registered for `name` (registration order, on before once). */
    handlers(name) {
      return [...records.on, ...records.once].filter((r) => r.name === name).map((r) => r.fn);
    },
    /** @returns {Function|undefined} The first `once` callback registered for `name`. */
    onceHandler(name) {
      return records.once.find((r) => r.name === name)?.fn;
    },
    /** @returns {Function|undefined} The first `on` callback registered for `name`. */
    onHandler(name) {
      return records.on.find((r) => r.name === name)?.fn;
    },
    /** @returns {boolean} Whether any on/once was registered for `name`. */
    has(name) {
      return records.on.some((r) => r.name === name) || records.once.some((r) => r.name === name);
    },
  };
  return hooks;
}

/**
 * Recording `ui.notifications` spy.
 *
 * @returns {object}
 */
export function makeNotifications() {
  const calls = { info: [], warn: [], error: [] };
  return {
    calls,
    info: (msg) => calls.info.push(msg),
    warn: (msg) => calls.warn.push(msg),
    error: (msg) => calls.error.push(msg),
  };
}

/**
 * Spy ImagePopout class. Records constructor `(src, options)` per instance and
 * resolves `render(true)` synchronously.
 *
 * @returns {Function} A class with a static `instances` array.
 */
export function makeImagePopout() {
  const instances = [];
  const cls = class ImagePopout {
    constructor(src, options) {
      this.src = src;
      this.options = options;
      this.rendered = false;
      instances.push(this);
    }
    render() {
      this.rendered = true;
      return Promise.resolve(this);
    }
  };
  cls.instances = instances;
  return cls;
}

/**
 * Minimal `game` mock. Settings are backed by a Map keyed by bare setting key;
 * `game.settings.get` THROWS for an unregistered key (as real Foundry does) so
 * the settings.mjs `get(key, fallback)` wrapper exercises its catch path.
 *
 * @param {object} [opts]
 * @returns {object}
 */
function makeGame(opts = {}) {
  const store = new Map(Object.entries(opts.settings ?? {}));
  const usersArr = opts.users ? [...opts.users] : [];
  const users = {
    contents: usersArr,
    get: (id) => usersArr.find((u) => u.id === id),
    getName: (name) => usersArr.find((u) => u.name === name),
    [Symbol.iterator]() {
      return usersArr[Symbol.iterator]();
    },
  };
  const moduleMap = new Map();
  return {
    user: opts.user ?? { id: "gm", isGM: true, name: "Gamemaster" },
    get userId() {
      return this.user?.id;
    },
    users,
    settings: {
      store,
      register() {},
      get(module, key) {
        if (!store.has(key)) throw new Error(`Setting ${module}.${key} not registered`);
        return store.get(key);
      },
      set(module, key, value) {
        store.set(key, value);
        return Promise.resolve(value);
      },
    },
    i18n: {
      // Identity localizer: return the key so tests assert on keys, and echo
      // format() to the key too (data is irrelevant to key-based assertions).
      localize: (k) => k,
      format: (k) => k,
    },
    modules: {
      map: moduleMap,
      get(id) {
        if (!moduleMap.has(id)) moduleMap.set(id, { id, version: opts.version ?? "test", api: {} });
        return moduleMap.get(id);
      },
    },
    keybindings: { register() {} },
    combats: opts.combats ?? { active: null },
    scenes: opts.scenes ?? { get: () => undefined },
    collections: opts.collections ?? { get: () => undefined },
    actors: opts.actors ?? [],
  };
}

/**
 * Minimal `canvas` mock. Deliberately conservative: `animatePan` is undefined
 * and `viewLevel` is absent so feature-detects fail closed unless a test opts
 * in. Tests mutate the returned object (or `globalThis.canvas`) per case.
 *
 * @returns {object}
 */
function makeCanvas() {
  return {
    scene: null,
    // animatePan intentionally absent (fitSceneToTable feature-detects it).
    tokens: { get: () => undefined, controlled: [], placeables: [] },
    perception: { update: () => {} },
    stage: { pivot: { x: 0, y: 0 }, scale: { x: 1 } },
    app: { renderer: { resolution: 1 } },
    viewedLevel: undefined,
    // viewLevel intentionally absent (scene-follow feature-detects it).
  };
}

/**
 * Build the `foundry` global stub, including the AppV2 class + Handlebars mixin
 * (so control-palette.mjs / setup-wizard.mjs load without a ReferenceError),
 * the ImagePopout spy, a DialogV2 stub, the `instances` Map, and `utils`.
 *
 * @param {Function} imagePopout
 * @returns {object}
 */
function makeFoundry(imagePopout) {
  class ApplicationV2 {
    constructor(options = {}) {
      this.options = options;
    }
    render() {
      return Promise.resolve(this);
    }
    close() {
      return Promise.resolve();
    }
  }
  const HandlebarsApplicationMixin = (Base) => class extends Base {};
  return {
    applications: {
      instances: new Map(),
      apps: { ImagePopout: imagePopout },
      api: {
        ApplicationV2,
        HandlebarsApplicationMixin,
        DialogV2: { prompt: () => Promise.resolve(null) },
      },
    },
    utils: {
      mergeObject: (a, b) => ({ ...(a ?? {}), ...(b ?? {}) }),
      deepClone: (o) => (o == null ? o : JSON.parse(JSON.stringify(o))),
    },
  };
}

/**
 * Install a fresh mocked Foundry environment on `globalThis`. Returns a handle
 * with references to every mock plus a `restore()` that puts globalThis back.
 *
 * Options (all optional):
 *   - user           {object}  game.user ({id, isGM, name}).
 *   - users          {object[]} game.users contents.
 *   - settings       {object}  Seed for the settings store (bare-key → value).
 *   - version        {string}  Reported module version.
 *   - combats/scenes/collections/actors — override the matching game.* member.
 *   - tableUserId    {string}  Convenience: seed `table-user-id` + a matching
 *                              active player user; combine with `as`.
 *   - tableUserName  {string}  Name for that user (default "Table").
 *   - as             {"gm"|"table"} Who this client is logged in as. With
 *                              "table" + tableUserId, isTableUser() is true.
 *
 * @param {object} [opts]
 * @returns {object} Env handle.
 */
export function installFoundryMock(opts = {}) {
  const snapshot = new Map();
  for (const k of MANAGED_KEYS) {
    snapshot.set(
      k,
      Object.prototype.hasOwnProperty.call(globalThis, k)
        ? { present: true, value: globalThis[k] }
        : { present: false },
    );
  }

  // Resolve the convenience table-user options into concrete settings/users.
  const settings = { ...(opts.settings ?? {}) };
  const users = opts.users ? [...opts.users] : [];
  if (opts.tableUserId) {
    settings["table-user-id"] = settings["table-user-id"] ?? opts.tableUserId;
    if (!users.find((u) => u.id === opts.tableUserId)) {
      users.push({
        id: opts.tableUserId,
        name: opts.tableUserName ?? "Table",
        active: true,
        isGM: false,
      });
    }
  }
  let user = opts.user;
  if (!user) {
    if (opts.as === "table" && opts.tableUserId) {
      user = { id: opts.tableUserId, name: opts.tableUserName ?? "Table", isGM: false };
    } else {
      user = { id: "gm", isGM: true, name: "Gamemaster" };
    }
  }

  const imagePopout = makeImagePopout();
  const notifications = makeNotifications();
  const hooks = makeHooks();
  const socketlib = makeSocketlib();
  const libWrapper = makeLibWrapper();

  const game = makeGame({
    ...opts,
    settings,
    users,
    user,
  });
  const ui = { notifications, windows: {} };
  const canvas = makeCanvas();
  const foundry = makeFoundry(imagePopout);
  const CONFIG = { Canvas: { maxZoom: 3.0, minZoom: 0.1 }, debug: { modules: [] } };
  const CONST = {
    DOCUMENT_OWNERSHIP_LEVELS: { NONE: 0, LIMITED: 1, OBSERVER: 2, OWNER: 3 },
    // keybindings.mjs reads CONST.KEYBINDING_PRECEDENCE.NORMAL at init time.
    KEYBINDING_PRECEDENCE: { PRIORITY: 0, NORMAL: 1, DEFERRED: 2 },
  };
  const fromUuid = async () => null;

  globalThis.game = game;
  globalThis.ui = ui;
  globalThis.canvas = canvas;
  globalThis.foundry = foundry;
  globalThis.Hooks = hooks;
  globalThis.socketlib = socketlib;
  globalThis.libWrapper = libWrapper;
  globalThis.fromUuid = fromUuid;
  globalThis.CONFIG = CONFIG;
  globalThis.CONST = CONST;

  return {
    game,
    ui,
    notifications,
    canvas,
    foundry,
    imagePopout,
    hooks,
    Hooks: hooks,
    socketlib,
    libWrapper,
    CONFIG,
    CONST,
    /** @returns {object|undefined} The most-recent socketlib module handle. */
    getSocket() {
      return socketlib.lastSocket;
    },
    /** Seed / overwrite a setting value. */
    setSetting(key, value) {
      game.settings.store.set(key, value);
    },
    restore() {
      for (const k of MANAGED_KEYS) {
        const s = snapshot.get(k);
        if (s.present) globalThis[k] = s.value;
        else delete globalThis[k];
      }
    },
  };
}

/**
 * Capture console output for the duration of a test. `logger.mjs` writes to the
 * bare `console.*`, so patching these lets tests assert on log lines — notably
 * the stub's "stub: <name> called" marker (real-vs-stub discrimination).
 *
 * @returns {{lines: string[], restore: () => void, text: () => string}}
 */
export function captureLogs() {
  const lines = [];
  const original = {
    log: console.log,
    info: console.info,
    warn: console.warn,
    error: console.error,
  };
  const record =
    (level) =>
    (...args) => {
      lines.push(`${level} ${args.map((a) => (typeof a === "string" ? a : "")).join(" ")}`);
    };
  console.log = record("log");
  console.info = record("info");
  console.warn = record("warn");
  console.error = record("error");
  return {
    lines,
    text: () => lines.join("\n"),
    restore() {
      console.log = original.log;
      console.info = original.info;
      console.warn = original.warn;
      console.error = original.error;
    },
  };
}
