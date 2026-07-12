// ============================================================================
// test/push-buttons.test.mjs
// ----------------------------------------------------------------------------
// Push dispatch by document type + the actor-image fallback chain (seeds AC2
// push). Reached through the real dispatcher: push-buttons.init() populates
// mod.api.pushDocument on the ready hook, and sockets.register() installs a
// RECORDING cs so the executeAsUser dispatch is actually observed — defeating
// the cs===null "silent success" false-green (KD5).
//
// The client is a GM with a configured, online Table user so canPush() and the
// getTableUser() guard both pass. htmlToCaption runs through jsdom
// createElement + innerHTML.
// ============================================================================

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import { installFoundryMock } from "./helpers/foundry-mock.mjs";

let env = installFoundryMock({ as: "gm", tableUserId: "table-1" });
const pushButtons = await import("../scripts/push-buttons.mjs");
const sockets = await import("../scripts/sockets.mjs");

/** Wire push-buttons + a recording cs; return the diagnostic api + socket. */
function setup() {
  pushButtons.init();
  sockets.register();
  env.hooks.onceHandler("ready")();
  const api = env.game.modules.get("community-screen").api;
  return { api, socket: env.getSocket() };
}

/** The showImage/followScene dispatches recorded on the mock socket. */
function dispatches(socket, name) {
  return socket.executeCalls.filter((c) => c.name === name);
}

beforeEach(() => {
  env.restore();
  env = installFoundryMock({ as: "gm", tableUserId: "table-1" });
});

afterEach(() => {
  env.restore();
});

test("JournalEntry: ensureTableObserver BEFORE doc.show(true, [tableUser])", async () => {
  const order = [];
  const doc = {
    documentName: "JournalEntry",
    id: "j1",
    name: "Lore",
    ownership: {}, // current level 0 < OBSERVER → ensureTableObserver writes
    update: async () => {
      order.push("update");
    },
    show: async (force, users) => {
      order.push("show");
      assert.equal(force, true);
      assert.equal(users[0].id, "table-1", "show() targets the Table user");
    },
  };
  const { api } = setup();
  await api.pushDocument(doc);
  // ensureTableObserver's ownership write must land BEFORE show().
  assert.deepEqual(order, ["update", "show"]);
  // Success toast fired.
  assert.ok(env.notifications.calls.info.length >= 1);
});

test("Item: dispatches showImage {src,title,caption}; caption is plain text from HTML", async () => {
  const doc = {
    documentName: "Item",
    id: "i1",
    name: "Sword",
    img: "items/sword.webp",
    system: { description: "<p>A <b>fine</b> blade</p>" },
  };
  const { api, socket } = setup();
  await api.pushDocument(doc);
  const calls = dispatches(socket, "showImage");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].userId, "table-1");
  assert.deepEqual(calls[0].args[0], {
    src: "items/sword.webp",
    title: "Sword",
    caption: "A fine blade",
  });
});

test("Item description extraction covers string / {value} / {unidentified} / {short}", async () => {
  const cases = [
    { description: "<b>S</b>", expected: "S" },
    { description: { value: "<i>V</i>" }, expected: "V" },
    { description: { unidentified: "U" }, expected: "U" },
    { description: { short: "Sh" }, expected: "Sh" },
    // Precedence: value wins over unidentified/short.
    { description: { value: "V", unidentified: "U", short: "Sh" }, expected: "V" },
  ];
  for (const c of cases) {
    env.restore();
    env = installFoundryMock({ as: "gm", tableUserId: "table-1" });
    const { api, socket } = setup();
    await api.pushDocument({
      documentName: "Item",
      id: "i",
      name: "X",
      img: "x.webp",
      system: { description: c.description },
    });
    const calls = dispatches(socket, "showImage");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].args[0].caption, c.expected, JSON.stringify(c.description));
  }
});

test("Actor img fallback order: actor.img → prototypeToken.texture.src → token.texture.src", async () => {
  const scenarios = [
    {
      doc: {
        img: "a.webp",
        prototypeToken: { texture: { src: "p.webp" } },
        token: { texture: { src: "t.webp" } },
      },
      expected: "a.webp",
    },
    {
      doc: {
        img: "",
        prototypeToken: { texture: { src: "p.webp" } },
        token: { texture: { src: "t.webp" } },
      },
      expected: "p.webp",
    },
    {
      doc: {
        img: "",
        prototypeToken: { texture: { src: "" } },
        token: { texture: { src: "t.webp" } },
      },
      expected: "t.webp",
    },
  ];
  for (const s of scenarios) {
    env.restore();
    env = installFoundryMock({ as: "gm", tableUserId: "table-1" });
    const { api, socket } = setup();
    await api.pushDocument({ documentName: "Actor", id: "a", name: "Hero", ...s.doc });
    const calls = dispatches(socket, "showImage");
    assert.equal(calls.length, 1, s.expected);
    assert.equal(calls[0].args[0].src, s.expected);
    assert.equal(calls[0].args[0].title, "Hero");
  }
});

test("Actor with NO usable image: warn AND no showImage dispatch AND no success toast", async () => {
  const { api, socket } = setup();
  await api.pushDocument({
    documentName: "Actor",
    id: "a",
    name: "Faceless",
    img: "",
    prototypeToken: { texture: { src: "" } },
    token: { texture: { src: "" } },
  });
  assert.equal(dispatches(socket, "showImage").length, 0, "no dispatch on empty image");
  assert.ok(env.notifications.calls.warn.length >= 1, "warns the GM");
  assert.equal(env.notifications.calls.info.length, 0, "NOT a silent success — no pushed toast");
});

test("Scene: dispatches followScene {sceneId}", async () => {
  const { api, socket } = setup();
  await api.pushDocument({ documentName: "Scene", id: "scene-9", name: "Crypt" });
  const calls = dispatches(socket, "followScene");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].userId, "table-1");
  assert.deepEqual(calls[0].args[0], { sceneId: "scene-9" });
});

test("Unsupported document type: warn + return, no dispatch", async () => {
  const { api, socket } = setup();
  await api.pushDocument({ documentName: "Macro", id: "m1", name: "Blast" });
  assert.equal(socket.executeCalls.length, 0, "no dispatch for unsupported type");
  // No success toast for an unsupported type.
  assert.equal(env.notifications.calls.info.length, 0);
});

test("pushImage(src, title) is gated by canPush()", async () => {
  // canPush() true: GM + Table user configured + online.
  const { socket } = setup();
  await pushButtons.pushImage("macro.webp", "From Macro");
  const calls = dispatches(socket, "showImage");
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].args[0], { src: "macro.webp", title: "From Macro" });

  // Now make the Table OFFLINE → canPush() false → no dispatch.
  env.restore();
  env = installFoundryMock({
    as: "gm",
    users: [{ id: "table-1", name: "Table", active: false, isGM: false }],
    settings: { "table-user-id": "table-1" },
  });
  const { socket: socket2 } = setup();
  await pushButtons.pushImage("macro.webp", "Blocked");
  assert.equal(dispatches(socket2, "showImage").length, 0, "offline Table blocks pushImage");
});

test("no Table user configured: warn + return (getTableUser guard)", async () => {
  env.restore();
  env = installFoundryMock({ as: "gm" }); // no tableUserId → getTableUser() undefined
  const { api, socket } = setup();
  await api.pushDocument({ documentName: "Scene", id: "s", name: "X" });
  assert.equal(socket.executeCalls.length, 0);
  assert.ok(env.notifications.calls.warn.length >= 1, "warns there is no Table user");
});
