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
import { ProviderRegistry } from "../../src/crdt/provider-registry";
import { MAX_CRDT_NOTE_BYTES, SyncEngine } from "../../src/sync";
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

/** The doc's OWN state — what a device with lineage must send instead of a
 *  throwaway-doc encoding. Distinguishable from `genesisUpdateFor` by content. */
const OWN_STATE = new Uint8Array([9, 9, 9, 9]);

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
		encodeStateAsUpdate: async () => OWN_STATE,
		hasAnyHistoryTransient: async () => hasAnyHistory,
	} as never);
	// The selector asks `hasAnyHistoryTransient(noteId)`, so the path must resolve to an
	// id — an unmapped path has no state to encode either, covered separately.
	const map = new NoteIdMap();
	map.getOrMint("Note.md");
	engine.setNoteIdMap(map);
	engine.setReady();
	return engine;
}

const ID_A = "01a02100-0000-7000-8000-00000000000a";
const ID_B = "01a02100-0000-7000-8000-00000000000b";

test("buildGenesisFrame returns a frame when this device has NO lineage yet", async () => {
	const frame = await engineWith(false).buildGenesisFrame("Note.md", ID_A);
	expect(frame).toBeDefined();
	expect(frame?.content).toBe(BODY);
});

test("with local history it sends the doc's OWN state, never a throwaway lineage", async () => {
	// The whole fix. A throwaway-doc encoding here is the second lineage the two
	// tests above prove will double the body. The doc's own state cannot double:
	// there is only one lineage, so there is nothing to union.
	const frame = await engineWith(true).buildGenesisFrame("Note.md", ID_B);
	expect(frame?.update).toEqual(OWN_STATE);
});

test("declining outright would leave the server row EMPTY — so it does not decline", async () => {
	// Measured on the real ProviderRegistry: re-ingesting identical content emits
	// ZERO ops (state vector unchanged), so a bodyless create's follow-up
	// routeModify sends nothing and a fresh server row stays empty. An earlier
	// revision of this fix declined here, trading doubled content for no content.
	const frame = await engineWith(true).buildGenesisFrame("Note.md", ID_B);
	expect(frame).toBeDefined();
});

test("a doc whose own state exceeds the cap declines rather than sending it", async () => {
	const engine = engineWith(true);
	engine.setCrdtManager({
		encodeGenesisUpdate: () => genesisUpdateFor(BODY),
		encodeStateAsUpdate: async () => new Uint8Array(MAX_CRDT_NOTE_BYTES + 1),
		hasAnyHistoryTransient: async () => true,
	} as never);
	expect(await engine.buildGenesisFrame("Note.md", ID_B)).toBeUndefined();
});

test("unknown history is treated as history — own state, not a throwaway lineage", async () => {
	// A port without `hasAnyHistoryTransient` cannot rule out the rival-lineage hazard.
	const engine = engineWith(false);
	engine.setCrdtManager({
		encodeGenesisUpdate: () => genesisUpdateFor(BODY),
		encodeStateAsUpdate: async () => OWN_STATE,
	} as never);
	const frame = await engine.buildGenesisFrame("Note.md", ID_B);
	expect(frame?.update).toEqual(OWN_STATE);
});

test("the gate asks about the id being CREATED, not whatever the path maps to", async () => {
	// Adversarial review 1. `buildGenesisFrame` used to resolve the id itself via
	// `noteIdMap.get(path)`, but the create is made under the caller's op.docId.
	// A rename or map reconcile between enqueue and replay makes those disagree,
	// and the gate would then clear a note whose REAL doc holds lineage — the
	// doubling bug, on the retry path.
	const asked: string[] = [];
	const engine = engineWith(false);
	engine.setCrdtManager({
		encodeGenesisUpdate: () => genesisUpdateFor(BODY),
		encodeStateAsUpdate: async () => OWN_STATE,
		hasAnyHistoryTransient: async (id: string) => {
			asked.push(id);
			return false;
		},
	} as never);

	await engine.buildGenesisFrame("Note.md", ID_B);

	// The map holds a DIFFERENT id for "Note.md" (minted in engineWith).
	expect(asked).toEqual([ID_B]);
});

test("the real ProviderRegistry reports history after an actual local edit", async () => {
	// The two gate tests above stub `hasAnyHistoryTransient`, so they pin the WIRING but
	// not the truth of it. Without this, a change that made the real
	// implementation always return false would sail through them and silently
	// re-enable the doubling.
	const registry = new ProviderRegistry({
		dbPrefix: `doubling-real-${ID_A}`,
		send: () => true,
		onFlushToDisk: async () => {},
		docKind: () => "note",
	} as never);

	expect(await registry.hasAnyHistoryTransient(ID_A)).toBe(false);
	await registry.applyLocalEdit(ID_A, BODY);
	expect(await registry.hasAnyHistoryTransient(ID_A)).toBe(true);
});
