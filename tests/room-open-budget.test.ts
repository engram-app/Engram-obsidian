/**
 * #658 end to end: the REAL NoteProvider + ProviderRegistry + SyncEngine
 * against a server double that behaves like y_ex where it matters:
 *
 *  - every `crdt_msg` lands in a room, and a frame for a doc with no room
 *    starts one (crdt_channel.ex `ensure_room`), which is what the
 *    `room_start` surge alert counts;
 *  - a STEP1 is answered with the server's STEP2 and then its own STEP1, as
 *    two frames (`encode_sync_step1_response_v1`);
 *  - `crdt_release` drops the room.
 *
 * `up = false` models a half-open socket: the send "succeeds" and the frame
 * vanishes, so nothing is buffered or queued for it.
 */
import { describe, expect, mock, test } from "bun:test";
import "fake-indexeddb/auto";
import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import * as syncProtocol from "y-protocols/sync";
import * as Y from "yjs";
import type { EngramApi } from "../src/api";
import { isDestroyedError } from "../src/crdt/destroyed-error";
import { CONTENT_KEY } from "../src/crdt/frontmatter-codec";
import { NoteIdMap } from "../src/crdt/note-id-map";
import { ProviderRegistry } from "../src/crdt/provider-registry";
import { fromB64, MESSAGE_SYNC, toB64 } from "../src/crdt/wire";
import { SyncEngine } from "../src/sync";
import { ManualTimeProvider } from "../src/time-provider";
import { DEFAULT_SETTINGS } from "../src/types";

const mockApp = {
	vault: {
		configDir: ".obsidian",
		read: mock().mockResolvedValue("body"),
		cachedRead: mock().mockResolvedValue("body"),
		getMarkdownFiles: mock().mockReturnValue([]),
		getFiles: mock().mockReturnValue([]),
		getAbstractFileByPath: mock().mockReturnValue(null),
		getFileByPath: mock().mockReturnValue(null),
		getName: mock().mockReturnValue("Test Vault"),
	},
	workspace: { getActiveViewOfType: mock().mockReturnValue(null) },
} as any;

let stack = 0;

function setup(notes: string[]) {
	const server = {
		docs: new Map<string, Y.Doc>(),
		rooms: new Set<string>(),
		starts: 0,
		up: true,
		/** Client STEP1s received, per note. */
		step1s: new Map<string, number>(),
	};
	const serverDoc = (id: string) => {
		let d = server.docs.get(id);
		if (!d) {
			d = new Y.Doc();
			server.docs.set(id, d);
		}
		return d;
	};
	const frame = (write: (e: encoding.Encoder) => void) => {
		const e = encoding.createEncoder();
		encoding.writeVarUint(e, MESSAGE_SYNC);
		write(e);
		return toB64(encoding.toUint8Array(e));
	};
	let reg: ProviderRegistry;
	const toClient = (id: string, b64: string) =>
		setTimeout(() => {
			void reg.receive(id, b64).catch((e: unknown) => {
				if (!isDestroyedError(e)) throw e;
			});
		}, 0);
	const onFrame = (id: string, b64: string): boolean => {
		if (!server.up) return true; // half-open: accepted, then lost
		if (!server.rooms.has(id)) {
			server.rooms.add(id);
			server.starts++;
		}
		const dec = decoding.createDecoder(fromB64(b64));
		decoding.readVarUint(dec);
		const reply = encoding.createEncoder();
		encoding.writeVarUint(reply, MESSAGE_SYNC);
		const t = syncProtocol.readSyncMessage(dec, reply, serverDoc(id), "server");
		if (t === syncProtocol.messageYjsSyncStep1) {
			server.step1s.set(id, (server.step1s.get(id) ?? 0) + 1);
			toClient(id, toB64(encoding.toUint8Array(reply)));
			toClient(
				id,
				frame((e) => syncProtocol.writeSyncStep1(e, serverDoc(id))),
			);
		}
		return true;
	};

	const time = new ManualTimeProvider(1_000_000);
	const engine = new SyncEngine(
		mockApp,
		{} as unknown as EngramApi,
		{ ...DEFAULT_SETTINGS, debounceMs: 1 },
		mock().mockResolvedValue(undefined),
		time,
	);
	reg = new ProviderRegistry({
		dbPrefix: `roomBudget${stack++}`,
		send: (id, b64) => onFrame(id, b64),
		onFlushToDisk: () => true,
		onSynced: (id) => void engine.commitCrdtConvergence(id),
	});
	engine.setCrdtManager(reg);
	engine.setCrdtEnrollment(reg);
	const liveBound = new Set<string>();
	engine.setCrdtPorts({
		release: (id: string) => {
			server.rooms.delete(id);
		},
		liveBound: (p: string) => liveBound.has(p),
	});
	engine.setReady();
	const map = new NoteIdMap();
	const state: Record<string, { hash: number; serverHash: string }> = {};
	for (const n of notes) {
		map.set(`${n}.md`, n);
		state[`${n}.md`] = { hash: 1, serverHash: "H1" };
	}
	engine.setNoteIdMap(map);
	engine.importSyncState(state);
	reg.setConnected(true);

	const settle = async (done: () => boolean, label: string) => {
		for (let i = 0; i < 400 && !done(); i++) {
			await new Promise((r) => setTimeout(r, 2));
		}
		if (!done()) throw new Error(`settle timed out: ${label}`);
	};
	/** The socket dropped and a new one joined: the server holds no rooms for it. */
	const reconnect = (openIds: string[]) => {
		reg.setConnected(false);
		server.rooms.clear();
		server.up = true;
		engine.reopenRoomsOnRejoin(openIds);
		reg.setConnected(true);
	};
	return { engine, reg, server, serverDoc, liveBound, settle, reconnect };
}

const text = (d: Y.Doc) => d.getText(CONTENT_KEY).toString();

describe("room opens against a y_ex-shaped server (#658)", () => {
	test("one idle heal = ONE server room start, and the room is closed after", async () => {
		const { engine, reg, server, serverDoc, settle } = setup(["a"]);
		serverDoc("a").getText(CONTENT_KEY).insert(0, "server body");

		(engine as any).socketConverge("a.md", "a", "other");
		await settle(() => server.starts === 1 && server.rooms.size === 0, "heal released");
		await new Promise((r) => setTimeout(r, 20));

		expect(server.starts).toBe(1);
		expect(server.rooms.size).toBe(0);
		expect(reg.enrolled.has("a")).toBe(false);
		await reg.destroyAll();
	});

	test("an op lost on a half-open socket reaches the server after the rejoin, editor closed meanwhile", async () => {
		const { reg, server, serverDoc, liveBound, settle, reconnect } = setup(["a"]);
		liveBound.add("a.md");
		reg.enroll("a"); // the editor opened it
		await settle(() => reg.isSynced("a"), "first handshake");

		server.up = false; // the socket is dead but still reports OPEN
		await reg.applyLocalEdit("a", "typed while half-open");
		liveBound.delete("a.md"); // the user closed the tab
		expect(text(serverDoc("a"))).toBe("");

		reconnect([]);
		await settle(() => text(serverDoc("a")) === "typed while half-open", "lost op resent");
		await reg.destroyAll();
	});

	test("rejoin: one STEP1 per open note, none for a note closed since it was enrolled", async () => {
		const { reg, server, settle, reconnect } = setup(["open", "closed"]);
		reg.enroll("open");
		reg.enroll("closed");
		await settle(() => reg.isSynced("open") && reg.isSynced("closed"), "both handshook");
		server.step1s.clear();

		reconnect(["open"]);
		await settle(() => (server.step1s.get("open") ?? 0) > 0, "open re-advertised");
		await new Promise((r) => setTimeout(r, 20));

		expect(server.step1s.get("open")).toBe(1);
		expect(server.step1s.get("closed")).toBeUndefined();
		expect([...reg.enrolled]).toEqual(["open"]);
		await reg.destroyAll();
	});
});
