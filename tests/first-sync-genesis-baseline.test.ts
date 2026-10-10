/**
 * First sync of an existing vault: the create-ack baseline must be what DISK
 * holds after the genesis apply, not the raw pre-create bytes.
 *
 * Prod 2026-10-10 (new signup, 245 notes): the genesis `applyRemoteUpdate`
 * flushed the plugin's frontmatter projection over each file (flow list ->
 * block list, quotes dropped, comments gone), then `adoptCreateAck` stamped
 * the baseline as `hash(genesisContent)` — the RAW bytes no file holds any
 * more. The next catch-up saw disk != baseline != row, took the
 * "local+remote both diverged" branch, and wrote 54 `(conflict)` copies.
 */
import { describe, expect, mock, test } from "bun:test";
import "fake-indexeddb/auto";
import { ProviderRegistry } from "../src/crdt/provider-registry";
import { SyncEngine } from "../src/sync";
import { DEFAULT_SETTINGS } from "../src/types";

type AnyEngine = Record<string, any>;

const PATH = "Notes/a.md";
// Ordinary Obsidian frontmatter: a quoted wikilink and an empty property.
// The backend projects this as `up: '[[Home]]'` / `key:`, so disk != row and
// the bad baseline lands in the drift-copy branch rather than a clean backfill.
const RAW = '---\nup: "[[Home]]"\nkey:\n---\nbody\n';

/** What the REAL registry flushes to disk when it applies RAW's genesis update. */
async function realProjection(raw: string): Promise<string> {
	let out: string | undefined;
	const reg = new ProviderRegistry({
		dbPrefix: `genesis-baseline-${Math.random()}`,
		send: () => true,
		onFlushToDisk: (_id: string, content: string) => {
			out = content;
			return undefined;
		},
	} as any);
	await reg.applyRemoteUpdate("probe", reg.encodeGenesisUpdate(raw));
	if (out === undefined) throw new Error("genesis apply flushed nothing");
	return out;
}

function makeEngine(projected: string) {
	let disk = RAW;
	const engine = new SyncEngine(
		{ vault: { cachedRead: mock(async () => disk) } } as any,
		{} as any,
		{ ...DEFAULT_SETTINGS },
		mock().mockResolvedValue(undefined),
	) as unknown as AnyEngine;

	engine.crdt = {
		hasAnyHistory: async () => false,
		// Real registry: applying the genesis update projects the doc and
		// flushes it to disk via onFlushToDisk -> flushFromCrdt.
		applyRemoteUpdate: async () => {
			disk = projected;
			return true;
		},
		applyLocalEdit: async (_id: string, text: string) => text,
		// After the apply the doc holds the genesis lineage, so it projects
		// exactly what the flush wrote.
		projectedText: async () => projected,
		isCrdtEligible: () => true,
	};
	return { engine, readDisk: () => disk };
}

describe("first-sync genesis baseline", () => {
	test("baseline matches disk after the genesis apply rewrites frontmatter", async () => {
		const projected = await realProjection(RAW);
		// Precondition: the codec really does rewrite this frontmatter.
		expect(projected).not.toBe(RAW);
		const { engine, readDisk } = makeEngine(projected);

		const consumed = await engine.seedBodyAfterCreate({
			effectiveId: "note-1",
			normalized: PATH,
			file: { path: PATH },
			seeded: true,
			sameId: true,
			genesisOutcome: "stored",
			genesisUpdate: new Uint8Array([1]),
			genesisContent: RAW,
		});
		await engine.adoptCreateAck("note-1", PATH, consumed, { flushHeld: false });

		expect(readDisk()).toBe(projected);
		// Disk is untouched since the apply, so it must read as synced.
		// Fails today: baseline = hash(RAW), disk = the projection -> catch-up
		// treats every such note as locally edited and drift-copies it.
		expect(engine.isUnchangedSynced(PATH, readDisk())).toBe(true);
	});
});
