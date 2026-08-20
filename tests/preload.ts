import { mock } from "bun:test";
import * as obsidianMock from "./__mocks__/obsidian";

// Obsidian plugin code uses window.setInterval/setTimeout/clearInterval/clearTimeout
// (required by obsidianmd/prefer-window-timers for popout window compat). Bun's test
// runtime is Node-like and lacks `window`, so shim it to the global timer functions.
const g = globalThis as unknown as {
	window?: typeof globalThis;
	activeDocument?: typeof globalThis.document;
	document?: typeof globalThis.document;
};
if (!g.window) g.window = globalThis;
if (!g.activeDocument && g.document) g.activeDocument = g.document;
// Obsidian exposes `activeDocument` — the document of the focused window, so
// plugin code stays correct inside a popout. Bun's runtime has no DOM at all,
// so anything registering a lifecycle listener on it (device-flow modal,
// main.ts) would throw here. An inert stand-in is enough; tests that care
// about the events replace it with their own fake.
if (!g.activeDocument) {
	g.activeDocument = {
		visibilityState: "visible",
		addEventListener: () => {},
		removeEventListener: () => {},
		body: { classList: { add() {}, remove() {} } },
	} as unknown as typeof globalThis.document;
}

mock.module("obsidian", () => ({
	...obsidianMock,
	requestUrl: mock(obsidianMock.requestUrl),
}));
