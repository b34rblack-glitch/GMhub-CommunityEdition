// ============================================================================
// test-setup/dom.mjs
// ----------------------------------------------------------------------------
// jsdom preload for the unit-test suite. Loaded via
//   node --import ./test-setup/dom.mjs --test
// (see the "test" script in package.json).
//
// WHY THIS LIVES OUTSIDE test/ (KD2 in .conclave/spec.md): `node --test`
// default discovery treats EVERY `**/test/**/*.mjs` file as a test file and
// runs it. A preload placed under test/ would therefore be executed a SECOND
// time as a "test" (a double jsdom build, and stray describe-less output).
// Keeping it at test-setup/ keeps it a pure --import preload, never a test.
//
// It installs the browser DOM globals the modules-under-test dereference:
//   - popups.mjs           document.body.classList, app.element instanceof
//                          HTMLElement, querySelector
//   - push-buttons.mjs     document.createElement + innerHTML (htmlToCaption)
//   - canvas-lock.mjs      document.getElementById("board") + wheel listeners
//   - scene-fit.mjs        window.innerWidth/innerHeight, window.screen,
//                          window.devicePixelRatio, window.addEventListener
//
// It also installs a SYNCHRONOUS requestAnimationFrame shim so
// popups.scheduleBackdropUpdate() runs its callback deterministically in the
// same tick (jsdom's own rAF is a real ~16ms timer, which would make the
// backdrop assertions flaky). These DOM keys are DELIBERATELY excluded from
// the Foundry-mock harness's MANAGED_KEYS so install/restore never fights
// this preload.
// ============================================================================

import { JSDOM } from "jsdom";

// A minimal document with the #board element canvas-lock attaches its
// capture-phase wheel listener to.
const dom = new JSDOM('<!DOCTYPE html><html><body><div id="board"></div></body></html>', {
  url: "http://localhost/",
  pretendToBeVisual: true,
});

const { window } = dom;

// Expose the DOM globals. We intentionally do NOT null these out later —
// jsdom owns them for the whole process, and the Foundry mock's MANAGED_KEYS
// list excludes them.
globalThis.window = window;
globalThis.document = window.document;
// NB: `navigator` is a read-only global in Node 22 — do not reassign it.
globalThis.HTMLElement = window.HTMLElement;
globalThis.HTMLButtonElement = window.HTMLButtonElement;
globalThis.HTMLLIElement = window.HTMLLIElement;
globalThis.Node = window.Node;
globalThis.Event = window.Event;
globalThis.CustomEvent = window.CustomEvent;
globalThis.MouseEvent = window.MouseEvent;
globalThis.getComputedStyle = window.getComputedStyle.bind(window);

// Synchronous rAF/cAF: invoke the callback immediately so the popups backdrop
// update is deterministic under test. Return a fake handle.
globalThis.requestAnimationFrame = (cb) => {
  cb();
  return 0;
};
globalThis.cancelAnimationFrame = () => {};
