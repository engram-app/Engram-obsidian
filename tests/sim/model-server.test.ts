// tests/sim/model-server.test.ts
//
// CONTRACT tests for the sim-tier model server. Every frame/endpoint shape is
// asserted against constants + encode helpers COPIED FROM the real plugin
// source (src/channel.ts, src/api.ts, src/crdt/channel.ts) — a drift in the
// real wire protocol breaks a test here, which is the whole point (T1 fidelity).
import { expect, test } from "bun:test";
import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import * as syncProtocol from "y-protocols/sync";
import * as Y from "yjs";
// Real encode helpers — the SAME ones NoteChannel/CrdtChannel put on the wire.
import { encodeUpdateFrame, fromB64, toB64 } from "../../src/crdt/channel";
import { SimClock } from "./clock";
import { ModelServer } from "./model-server";
import { Scheduler } from "./scheduler";

// --- constants copied verbatim from src/channel.ts / src/crdt/channel.ts ---
const PHX_JOIN = "phx_join"; // channel.ts joinChannel()
const PHX_REPLY = "phx_reply"; // channel.ts handleMessage()
const CRDT_MSG = "crdt_msg"; // channel.ts sendCrdt()
const NOTE_YJS_UPDATE = "note_yjs_update"; // channel.ts handleMessage()
const CRDT_DOC_READY = "crdt_doc_ready"; // channel.ts handleMessage()
const HEARTBEAT = "heartbeat"; // channel.ts heartbeatTick()
const JOIN_REF = "1"; // channel.ts this.joinRef
const USER_JOIN_REF = "2"; // channel.ts this.userJoinRef
const CRDT_JOIN_REF = "3"; // channel.ts this.crdtJoinRef
const CRDT_PROTO = 2; // channel.ts joinChannel() phx_join payload
const MESSAGE_SYNC = 0; // crdt/channel.ts MESSAGE_SYNC

const USER = "user-1";
const VAULT = "vault-1";
const SYNC_TOPIC = `sync:${USER}:${VAULT}`; // channel.ts get topic
const USER_TOPIC = `user:${USER}`; // channel.ts get userTopic
const CRDT_TOPIC = `crdt:${USER}:${VAULT}`; // channel.ts get crdtTopic

type Frame = [string | null, string | null, string, string, Record<string, unknown>];

function boot(genesisEmptyDoc?: boolean) {
	const clock = new SimClock();
	const s = new Scheduler(1, clock);
	const server = new ModelServer({ scheduler: s, genesisEmptyDoc });
	return { clock, s, server };
}

function wire(server: ModelServer, id: string) {
	const sock = server.connect(id);
	const recv: Frame[] = [];
	sock.onmessage = (raw) => recv.push(JSON.parse(raw) as Frame);
	return { sock, recv };
}

function framesOf(recv: Frame[], event: string): Frame[] {
	return recv.filter((f) => f[3] === event);
}

// Build a client STEP1 frame the way CrdtChannel.startSync does.
function step1Frame(): string {
	const doc = new Y.Doc();
	const enc = encoding.createEncoder();
	encoding.writeVarUint(enc, MESSAGE_SYNC);
	syncProtocol.writeSyncStep1(enc, doc);
	return toB64(encoding.toUint8Array(enc));
}

// --- HTTP contract ---

test("HTTP GET /health → 200", () => {
	const { server } = boot();
	expect(server.http({ method: "GET", url: "/api/health" }).status).toBe(200);
});

test("HTTP POST /notes returns NoteResponse shape", () => {
	const { server } = boot();
	const res = server.http({
		method: "POST",
		url: "/api/notes",
		body: JSON.stringify({ path: "a.md", content: "hello", mtime: 1, id: "n1" }),
	});
	expect(res.status).toBe(200);
	const j = res.json as { note: Record<string, unknown>; chunks_indexed: number };
	expect(j.note.id).toBe("n1");
	expect(j.note.path).toBe("a.md");
	expect(j.note.title).toBe("a");
	expect(typeof j.note.content_hash).toBe("string");
	expect(typeof j.chunks_indexed).toBe("number");
});

test("HTTP GET /notes/:id/updates returns {update, head} and update reconstructs content", () => {
	const { server } = boot();
	server.http({
		method: "POST",
		url: "/api/notes",
		body: JSON.stringify({ path: "a.md", content: "hello", mtime: 1, id: "n1" }),
	});
	const res = server.http({ method: "GET", url: "/api/notes/n1/updates" });
	const j = res.json as { update: string; head: string };
	expect(typeof j.update).toBe("string");
	expect(typeof j.head).toBe("string");
	const doc = new Y.Doc();
	Y.applyUpdate(doc, fromB64(j.update));
	expect(doc.getText("content").toString()).toBe("hello");
});

test("HTTP GET /vault/heads returns per-note heads", () => {
	const { server } = boot();
	server.http({
		method: "POST",
		url: "/api/notes",
		body: JSON.stringify({ path: "a.md", content: "hi", mtime: 1, id: "n1" }),
	});
	const j = server.http({ method: "GET", url: "/api/vault/heads" }).json as {
		heads: Record<string, string>;
	};
	expect(typeof j.heads.n1).toBe("string");
});

test("HTTP GET /notes/changes returns ChangesResponse shape", () => {
	const { server } = boot();
	server.http({
		method: "POST",
		url: "/api/notes",
		body: JSON.stringify({ path: "a.md", content: "hi", mtime: 1, id: "n1" }),
	});
	const j = server.http({ method: "GET", url: "/api/notes/changes?since=1970-01-01T00:00:00Z" })
		.json as { changes: unknown[]; server_time: string };
	expect(Array.isArray(j.changes)).toBe(true);
	expect(typeof j.server_time).toBe("string");
});

test("HTTP POST /logs is a 200 no-op", () => {
	const { server } = boot();
	expect(server.http({ method: "POST", url: "/api/logs", body: "{}" }).status).toBe(200);
});

// --- WS join contract ---

test("WS sync phx_join → phx_reply ok on same topic+ref", async () => {
	const { s, server } = boot();
	const { sock, recv } = wire(server, "c1");
	sock.send(JSON.stringify([JOIN_REF, "10", SYNC_TOPIC, PHX_JOIN, {}]));
	await s.drain();
	const reply = framesOf(recv, PHX_REPLY).find((f) => f[2] === SYNC_TOPIC);
	expect(reply).toBeDefined();
	expect(reply?.[1]).toBe("10");
	expect((reply?.[4] as { status: string }).status).toBe("ok");
});

test("WS crdt phx_join {crdt_proto:2} → phx_reply ok on crdt topic", async () => {
	const { s, server } = boot();
	const { sock, recv } = wire(server, "c1");
	sock.send(
		JSON.stringify([CRDT_JOIN_REF, "11", CRDT_TOPIC, PHX_JOIN, { crdt_proto: CRDT_PROTO }]),
	);
	await s.drain();
	const reply = framesOf(recv, PHX_REPLY).find((f) => f[2] === CRDT_TOPIC);
	expect((reply?.[4] as { status: string }).status).toBe("ok");
});

test("WS user phx_join → phx_reply ok on user topic", async () => {
	const { s, server } = boot();
	const { sock, recv } = wire(server, "c1");
	sock.send(JSON.stringify([USER_JOIN_REF, "12", USER_TOPIC, PHX_JOIN, {}]));
	await s.drain();
	const reply = framesOf(recv, PHX_REPLY).find((f) => f[2] === USER_TOPIC);
	expect((reply?.[4] as { status: string }).status).toBe("ok");
});

test("WS heartbeat → phoenix phx_reply", async () => {
	const { s, server } = boot();
	const { sock, recv } = wire(server, "c1");
	sock.send(JSON.stringify([null, "20", "phoenix", HEARTBEAT, {}]));
	await s.drain();
	const reply = framesOf(recv, PHX_REPLY).find((f) => f[2] === "phoenix");
	expect(reply?.[1]).toBe("20");
	expect((reply?.[4] as { status: string }).status).toBe("ok");
});

// --- WS CRDT request/response + fan-out contract ---

async function joinCrdt(server: ModelServer, s: Scheduler, id: string) {
	const w = wire(server, id);
	w.sock.send(JSON.stringify([JOIN_REF, "1", SYNC_TOPIC, PHX_JOIN, {}]));
	w.sock.send(
		JSON.stringify([CRDT_JOIN_REF, "2", CRDT_TOPIC, PHX_JOIN, { crdt_proto: CRDT_PROTO }]),
	);
	await s.drain();
	w.recv.length = 0;
	return w;
}

test("WS crdt_create → phx_reply {doc_id} to sender + crdt_doc_ready to others", async () => {
	const { s, server } = boot();
	const a = await joinCrdt(server, s, "a");
	const b = await joinCrdt(server, s, "b");
	a.sock.send(
		JSON.stringify([
			CRDT_JOIN_REF,
			"30",
			CRDT_TOPIC,
			"crdt_create",
			{ doc_id: "n1", path: "a.md" },
		]),
	);
	await s.drain();
	const reply = a.recv.find((f) => f[3] === PHX_REPLY && f[1] === "30");
	expect((reply?.[4] as { response: { doc_id: string } }).response.doc_id).toBe("n1");
	const ready = framesOf(b.recv, CRDT_DOC_READY)[0];
	expect((ready?.[4] as { doc_id: string }).doc_id).toBe("n1");
	expect((ready?.[4] as { path: string }).path).toBe("a.md");
	// sender must NOT get its own doc_ready echo
	expect(framesOf(a.recv, CRDT_DOC_READY).length).toBe(0);
});

test("WS crdt_msg STEP1 → sender gets a STEP2 that materializes server content", async () => {
	const { s, server } = boot();
	const a = await joinCrdt(server, s, "a");
	// give the server content via REST push (legacy first-content path)
	server.http({
		method: "POST",
		url: "/api/notes",
		body: JSON.stringify({ path: "a.md", content: "server-body", mtime: 1, id: "n1" }),
	});
	a.recv.length = 0;
	a.sock.send(
		JSON.stringify([
			CRDT_JOIN_REF,
			"31",
			CRDT_TOPIC,
			CRDT_MSG,
			{ doc_id: "n1", b64: step1Frame() },
		]),
	);
	await s.drain();
	const step2 = framesOf(a.recv, CRDT_MSG)[0];
	expect(step2).toBeDefined();
	// decode + apply the STEP2 the way CrdtChannel.handleFrame does
	const doc = new Y.Doc();
	const dec = decoding.createDecoder(fromB64((step2?.[4] as { b64: string }).b64));
	expect(decoding.readVarUint(dec)).toBe(MESSAGE_SYNC);
	const reply = encoding.createEncoder();
	encoding.writeVarUint(reply, MESSAGE_SYNC);
	syncProtocol.readSyncMessage(dec, reply, doc, "test");
	expect(doc.getText("content").toString()).toBe("server-body");
});

test("WS crdt_msg UPDATE (seed) → OTHER client gets note_yjs_update with raw update + head + seq", async () => {
	const { s, server } = boot();
	const a = await joinCrdt(server, s, "a");
	const b = await joinCrdt(server, s, "b");
	a.sock.send(
		JSON.stringify([
			CRDT_JOIN_REF,
			"1",
			CRDT_TOPIC,
			"crdt_create",
			{ doc_id: "n1", path: "a.md" },
		]),
	);
	await s.drain();
	a.recv.length = 0;
	b.recv.length = 0;
	// build an UPDATE frame the way CrdtChannel.sendUpdateRaw does
	const doc = new Y.Doc();
	doc.getText("content").insert(0, "hello");
	const frame = encodeUpdateFrame(Y.encodeStateAsUpdate(doc));
	a.sock.send(
		JSON.stringify([CRDT_JOIN_REF, "40", CRDT_TOPIC, CRDT_MSG, { doc_id: "n1", b64: frame }]),
	);
	await s.drain();
	const fan = framesOf(b.recv, NOTE_YJS_UPDATE)[0];
	expect(fan).toBeDefined();
	const p = fan?.[4] as { note_id: string; b64: string; head: string; seq?: number };
	expect(p.note_id).toBe("n1");
	expect(typeof p.head).toBe("string");
	expect(typeof p.seq).toBe("number");
	// b64 is a RAW update (not messageSync) — applyUpdate directly (wiring.ts fromB64→applyRemoteUpdate)
	const bd = new Y.Doc();
	Y.applyUpdate(bd, fromB64(p.b64));
	expect(bd.getText("content").toString()).toBe("hello");
	// Originator DOES get its own fan-out echo (#282 seq-echo fidelity): the real
	// backend's update_v1/4 broadcasts note_yjs_update to the vault topic
	// INCLUDING the pusher ("Self-echo is harmless", crdt_persistence.ex:166-168),
	// which is what advances the pusher's per-path high-water via
	// applyLiveOpWithSeq. The echo carries the same note_id + seq.
	const selfEcho = framesOf(a.recv, NOTE_YJS_UPDATE)[0];
	expect(selfEcho).toBeDefined();
	expect((selfEcho?.[4] as { note_id: string }).note_id).toBe("n1");
});

test("WS crdt_catchup_since → {changes, has_more, next_seq} with SyncNoteChange rows", async () => {
	const { s, server } = boot();
	const a = await joinCrdt(server, s, "a");
	server.http({
		method: "POST",
		url: "/api/notes",
		body: JSON.stringify({ path: "a.md", content: "hi", mtime: 1, id: "n1" }),
	});
	a.recv.length = 0;
	a.sock.send(
		JSON.stringify([CRDT_JOIN_REF, "50", CRDT_TOPIC, "crdt_catchup_since", { cursor_seq: 0 }]),
	);
	await s.drain();
	const reply = a.recv.find((f) => f[3] === PHX_REPLY && f[1] === "50");
	const resp = (
		reply?.[4] as {
			response: {
				changes: Record<string, unknown>[];
				has_more: boolean;
				next_seq: number | null;
			};
		}
	).response;
	expect(resp.has_more).toBe(false);
	const row = resp.changes[0];
	expect(row?.type).toBe("note");
	expect(row?.id).toBe("n1");
	expect(row?.path).toBe("a.md");
	expect(typeof row?.seq).toBe("number");
	expect(row?.content).toBe("hi");
});

// --- genesis-empty behaviour (#288/#285 exploit) ---

test("genesisEmptyDoc default true → crdt_create leaves an EMPTY server doc", async () => {
	const { s, server } = boot();
	const a = await joinCrdt(server, s, "a");
	a.sock.send(
		JSON.stringify([
			CRDT_JOIN_REF,
			"60",
			CRDT_TOPIC,
			"crdt_create",
			{ doc_id: "n1", path: "a.md" },
		]),
	);
	await s.drain();
	const st = server.state();
	expect(st.notes.get("a.md")?.content).toBe("");
	// a STEP1 against the empty genesis yields an empty STEP2 (textLen stays 0)
	a.recv.length = 0;
	a.sock.send(
		JSON.stringify([
			CRDT_JOIN_REF,
			"61",
			CRDT_TOPIC,
			CRDT_MSG,
			{ doc_id: "n1", b64: step1Frame() },
		]),
	);
	await s.drain();
	const doc = new Y.Doc();
	const step2 = framesOf(a.recv, CRDT_MSG)[0];
	if (step2) {
		const dec = decoding.createDecoder(fromB64((step2[4] as { b64: string }).b64));
		decoding.readVarUint(dec);
		const reply = encoding.createEncoder();
		encoding.writeVarUint(reply, MESSAGE_SYNC);
		syncProtocol.readSyncMessage(dec, reply, doc, "test");
	}
	expect(doc.getText("content").toString()).toBe("");
});

// --- state() + head derivation ---

test("state() exposes notes-by-path and heads-by-id; head changes iff content changes", () => {
	const { server } = boot();
	server.http({
		method: "POST",
		url: "/api/notes",
		body: JSON.stringify({ path: "a.md", content: "one", mtime: 1, id: "n1" }),
	});
	const st1 = server.state();
	expect(st1.notes.get("a.md")?.id).toBe("n1");
	expect(st1.notes.get("a.md")?.content).toBe("one");
	const head1 = st1.heads.get("n1");
	// same content again → head unchanged
	server.http({
		method: "POST",
		url: "/api/notes",
		body: JSON.stringify({ path: "a.md", content: "one", mtime: 2, id: "n1" }),
	});
	expect(server.state().heads.get("n1")).toBe(head1);
	// content change → head changes
	server.http({
		method: "POST",
		url: "/api/notes",
		body: JSON.stringify({ path: "a.md", content: "two", mtime: 3, id: "n1" }),
	});
	expect(server.state().heads.get("n1")).not.toBe(head1);
});

// --- fault injection ---

test("dropNext(clientId) drops the next server→client send", async () => {
	const { s, server } = boot();
	const { sock, recv } = wire(server, "c1");
	server.dropNext("c1");
	sock.send(JSON.stringify([JOIN_REF, "70", SYNC_TOPIC, PHX_JOIN, {}]));
	await s.drain();
	// the join reply was the next send → dropped
	expect(recv.length).toBe(0);
	// subsequent sends resume
	sock.send(JSON.stringify([USER_JOIN_REF, "71", USER_TOPIC, PHX_JOIN, {}]));
	await s.drain();
	expect(recv.length).toBe(1);
});
