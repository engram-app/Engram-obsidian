/**
 * Tests: a genesis frame must never be built for a note this device already
 * holds lineage for (#1409 follow-up — content doubling).
 *
 * Measured against a real vault on 2026-08-20: max note size went
 * 263 KB -> 548 KB -> 1.09 MB -> 2.19 MB -> 4.38 MB across five syncs, each an
 * exact 2x, until it pinned at a size cap. The opening 100 characters of a
 * sampled note appeared 128 times (2^7).
 *
 * Mechanism: `encodeGenesisUpdate` builds the body in a THROWAWAY Y.Doc, so the
 * update carries a lineage independent of this device's own doc for that note.
 * `qualifiesForGenesisFrame` gated on markdown / not-live-bound / in-cap, but
 * NOT on whether the local doc already had history — so a re-sync shipped a
 * second, independent lineage carrying the same text. On convergence Yjs unions
 * them and the text appears twice; the union is flushed to disk, so the next
 * round doubles the doubled body.
 */
import { expect, mock, test } from "bun:test";
import "fake-indexeddb/auto";
import { TFile } from "obsidian";
import * as Y from "yjs";
import type { EngramApi } from "../../src/api";
import { CONTENT_KEY } from "../../src/crdt/frontmatter-codec";
import { NoteIdMap } from "../../src/crdt/note-id-map";
import { seedContentInto } from "../../src/crdt/note-seed";
import { SyncEngine } from "../../src/sync";
import { DEFAULT_SETTINGS } from "../../src/types";

const BODY = "# Title\n\nsome body text that must appear exactly once\n";
const MARKER = "some body text that must appear exactly once";

const textOf = (doc: Y.Doc) => doc.getText(CONTENT_KEY).toString();
const count = (s: string) => s.split(MARKER).length - 1;

function docWithHistory(content: string): Y.Doc {
	const doc = new Y.Doc();
	seedContentInto(doc, doc.getText(CONTENT_KEY), content, false);
	return doc;
}

/** Exactly what `ProviderRegistry.encodeGenesisUpdate` produces. */
function genesisUpdateFor(content: string): Uint8Array {
	const throwaway = new Y.Doc();
	seedContentInto(throwaway, throwaway.getText(CONTENT_KEY), content, false);
	const update = Y.encodeStateAsUpdate(throwaway);
	throwaway.destroy();
	return update;
}

// --- Why the gate has to exist (Yjs property, not our code) ------------------
// These pin the hazard, so nobody "simplifies" the gate away later believing
// Yjs would dedupe identical text. It does not — CRDTs merge by identity, and
// two independent lineages have no shared identity to merge on.

test("two independent lineages carrying the same text union to DOUBLED text", () => {
	const local = docWithHistory(BODY);
	Y.applyUpdate(local, genesisUpdateFor(BODY));
	expect(count(textOf(local))).toBe(2);
});

test("the doubling compounds once the union is flushed back to disk", () => {
	let doc = docWithHistory(BODY);
	for (let round = 0; round < 3; round++) {
		Y.applyUpdate(doc, genesisUpdateFor(textOf(doc)));
		doc = docWithHistory(textOf(doc)); // disk rewritten from the merged doc
	}
	expect(count(textOf(doc))).toBe(8); // 2^3 — extrapolates to the observed 2^7
});

// --- The gate itself ---------------------------------------------------------

function engineWith(hasAnyHistory: boolean) {
	const file = new TFile("Note.md");
	const app = {
		vault: {
			getAbstractFileByPath: mock().mockReturnValue(file),
			cachedRead: mock().mockResolvedValue(BODY),
			getName: mock().mockReturnValue("Test Vault"),
			on: mock(),
		},
		fileManager: { trashFile: mock() },
		workspace: { getActiveViewOfType: mock().mockReturnValue(null) },
	};
	const engine = new SyncEngine(
		app as never,
		{ health: mock().mockResolvedValue(true) } as unknown as EngramApi,
		{ ...DEFAULT_SETTINGS, debounceMs: 1 },
		mock().mockResolvedValue(undefined),
	);
	engine.setCrdtManager({
		encodeGenesisUpdate: () => genesisUpdateFor(BODY),
		hasAnyHistory: async () => hasAnyHistory,
	} as never);
	// The gate asks `hasAnyHistory(noteId)`, so the path must resolve to an id —
	// an unmapped path is treated as "history unknown" and covered separately.
	const map = new NoteIdMap();
	map.getOrMint("Note.md");
	engine.setNoteIdMap(map);
	engine.setReady();
	return engine;
}

test("buildGenesisFrame returns a frame when this device has NO lineage yet", async () => {
	const frame = await engineWith(false).buildGenesisFrame("Note.md");
	expect(frame).toBeDefined();
	expect(frame?.content).toBe(BODY);
});

test("buildGenesisFrame returns undefined when the local doc already has history", async () => {
	// The whole fix. Shipping a frame here creates the second lineage that the
	// two tests above prove will double the body. Falling back to the bodyless
	// create is slower (it opens a room) but correct — and correctness of the
	// user's content is not tradeable against room count.
	const frame = await engineWith(true).buildGenesisFrame("Note.md");
	expect(frame).toBeUndefined();
});
