/**
 * #1409: the server holds a room open for `idle_exit_ms` (5 minutes) after the
 * last frame, because a room is `auto_exit: true` and the ONLY thing that ever
 * released the channel's observation was the room's own idle drain.
 *
 * That is right for an open editor and wrong for a bulk first sync, where each
 * note needs its room for milliseconds. A 2,000-note import held 2,000 rooms
 * for five minutes past their last frame, bounded only by the LRU force-evicting
 * them.
 *
 * `releaseHealRoom` already did the CLIENT half — reset enrollment, close the
 * local doc — and said nothing on the wire, so the server kept observing. These
 * pin the missing half: the same gate that decides the client is done must also
 * tell the server.
 */
import { describe, expect, mock, test } from "bun:test";
import "fake-indexeddb/auto";
import { SyncEngine } from "../src/sync";
import { DEFAULT_SETTINGS } from "../src/types";

type AnyEngine = Record<string, any>;

function makeEngine(opts: { liveBound?: boolean } = {}) {
	const released: string[] = [];
	const engine = new SyncEngine(
		{ vault: { cachedRead: mock().mockResolvedValue(""), getFileByPath: () => null } } as any,
		{} as any,
		{ ...DEFAULT_SETTINGS },
		mock().mockResolvedValue(undefined),
	) as unknown as AnyEngine;

	engine.setCrdtPorts({
		manager: { closeDoc: mock() } as any,
		enrollment: { reset: mock(), enroll: mock() } as any,
		liveBound: () => opts.liveBound === true,
		release: (docId: string) => released.push(docId),
	});
	engine.noteIdMap = { pathForId: (_id: string) => "Notes/a.md" } as any;
	return { engine, released };
}

describe("a released note tells the SERVER, not just itself (#1409)", () => {
	test("an idle note's room is released on the wire", async () => {
		const { engine, released } = makeEngine();

		engine.releaseHealRoom("note-1", "Notes/a.md");

		expect(released).toEqual(["note-1"]);
	});

	test("a LIVE-BOUND note keeps its room — 5 minutes is correct for an open editor", async () => {
		// The whole point of the split: interactive editing keeps the warm room,
		// only import-shaped traffic releases early. Releasing here would make
		// every keystroke pay a re-handshake.
		const { engine, released } = makeEngine({ liveBound: true });

		engine.releaseHealRoom("note-1", "Notes/a.md");

		expect(released).toEqual([]);
	});

	test("a note whose id is unmapped is still released", async () => {
		// Deleted since staging: it cannot be live-bound, and a deleted note must
		// not keep holding a room.
		const { engine, released } = makeEngine();
		engine.noteIdMap = { pathForId: (_id: string) => null } as any;

		engine.releaseHealRoom("note-1", null);

		expect(released).toEqual(["note-1"]);
	});

	test("a missing release port is a no-op, never a throw", async () => {
		// Older backend / no socket: the local half must still run.
		const { engine } = makeEngine();
		engine.setCrdtPorts({ release: null });

		expect(() => engine.releaseHealRoom("note-1", "Notes/a.md")).not.toThrow();
	});
});
