// tests/sim/oracle.ts
//
// The convergence sim's assertion engine. Every later scenario (Tasks 7, 8)
// calls `assertConverged` as its quiescence barrier + strict equality check.
// A weak oracle here would silently pass divergent runs, so this file trades
// terseness for exhaustive failure messages: every mismatch throws a full
// per-replica table plus the replay seed, because a convergence bug caught
// once and not reproducible is worse than not caught at all.
import * as fs from "node:fs";
import * as path from "node:path";
import { toB64 } from "../../src/crdt/wire";
import type { ModelServer } from "./model-server";
import type { Replica } from "./replica";
import type { Scheduler } from "./scheduler";

/** Recursively list every file under `dir`, as paths relative to `dir`
 *  (posix-separated, matching vault path conventions). Mirrors vault-fs's
 *  own walkFiles — duplicated rather than imported since that one is a
 *  private closure over a specific vault's index, not a reusable export. */
function listFiles(dir: string, rel = ""): string[] {
	const base = rel ? path.join(dir, rel) : dir;
	if (!fs.existsSync(base)) return [];
	const out: string[] = [];
	for (const entry of fs.readdirSync(base, { withFileTypes: true })) {
		const childRel = rel ? `${rel}/${entry.name}` : entry.name;
		if (entry.isDirectory()) out.push(...listFiles(dir, childRel));
		else out.push(childRel);
	}
	return out;
}

function replayCmd(seed: number): string {
	return `SIM_SEED=${seed} bun test tests/sim/oracle.test.ts`;
}

interface ReplicaRow {
	replicaId: string;
	disk: string | null;
	docText: string | null;
	id: string | null;
	head: string | null;
}

interface PendingRow {
	notePath: string;
	replicaId: string;
	disk: string | null;
	id: string | null;
	docTextP: Promise<string> | null;
	headP: Promise<Uint8Array> | null;
}

/**
 * Read every replica's disk content, Y.Doc projected text, and noteIdMap id
 * for every note path, keyed by path.
 *
 * A note the oracle has never touched (e.g. its content arrived via a REST
 * catchup pull, not a live CRDT enrollment — see CrdtManager.hasHistory's
 * docstring) has no cached Y.Doc entry: reading it opens a fresh
 * IndexeddbPersistence, whose readiness resolves only through the sim's
 * virtualized setImmediate/setTimeout (SimClock) — a timer only
 * Scheduler.drain() fires.
 *
 * Every read for the whole batch is kicked off SYNCHRONOUSLY first (no
 * `await` between them), then driven by exactly ONE `scheduler.drain()`
 * call. Calling drain() concurrently from multiple in-flight reads (e.g. one
 * per replica via `Promise.all` of independent pump loops) corrupts
 * fake-indexeddb's transaction sequencing — `TransactionInactiveError` was
 * observed reproducibly that way. `Scheduler.drain()` is not reentrant, so
 * every read in a batch must share one driving call.
 */
async function readAllRows(
	scheduler: Scheduler,
	replicas: Replica[],
	notePaths: string[],
): Promise<Map<string, ReplicaRow[]>> {
	const pending: PendingRow[] = [];
	for (const notePath of notePaths) {
		for (const r of replicas) {
			const diskPath = path.join(r.vaultDir, notePath);
			const disk = fs.existsSync(diskPath) ? fs.readFileSync(diskPath, "utf8") : null;
			const id = r.noteIdMap.get(notePath);
			pending.push({
				notePath,
				replicaId: r.id,
				disk,
				id,
				docTextP: id ? r.crdtManager.projectedText(id) : null,
				headP: id ? r.crdtManager.encodeStateVector(id) : null,
			});
		}
	}

	let settled = pending.length === 0;
	Promise.allSettled(
		pending.flatMap((p) =>
			[p.docTextP, p.headP].filter((x): x is Promise<unknown> => x != null),
		),
	).then(() => {
		settled = true;
	});
	for (let i = 0; i < 20 && !settled; i++) await scheduler.drain();
	if (!settled) {
		throw new Error(
			"readAllRows: CRDT reads did not settle after draining the scheduler — livelock?",
		);
	}

	const out = new Map<string, ReplicaRow[]>();
	for (const p of pending) {
		let docText: string | null = null;
		let head: string | null = null;
		try {
			if (p.docTextP) docText = await p.docTextP;
			if (p.headP) head = toB64(await p.headP);
		} catch (e) {
			docText = `<error reading Y.Doc: ${e instanceof Error ? e.message : String(e)}>`;
		}
		const row: ReplicaRow = { replicaId: p.replicaId, disk: p.disk, docText, id: p.id, head };
		const arr = out.get(p.notePath) ?? [];
		arr.push(row);
		out.set(p.notePath, arr);
	}
	return out;
}

function fmt(v: string | null): string {
	return v === null ? "<missing>" : JSON.stringify(v);
}

/** Every note on the server: every replica's disk content, Y.Doc projected
 *  text, and noteIdMap entry must equal each other AND the server's
 *  authoritative content/id. A note absent from a replica (no file, no
 *  noteIdMap entry) is a mismatch, never a skip. Also asserts no replica
 *  holds a file the server doesn't know about, and (via findWipes) that no
 *  file silently emptied out without an explicit delete (#288). */
export async function assertConverged(
	replicas: Replica[],
	server: ModelServer,
	scheduler: Scheduler,
): Promise<void> {
	await scheduler.drain();
	// Reconnect any offline replica — connect() is a no-op if already online
	// (src/channel.ts: `if (this.ws) return`), so this is safe to call
	// unconditionally regardless of which replicas were offline.
	for (const r of replicas) await r.goOnline();
	await scheduler.drain();

	const { notes } = server.state();
	const rowsByPath = await readAllRows(scheduler, replicas, [...notes.keys()]);
	const blocks: string[] = [];

	for (const [notePath, srv] of notes) {
		const rows = rowsByPath.get(notePath) ?? [];
		const mismatch = rows.some(
			(row) => row.disk !== srv.content || row.docText !== srv.content || row.id !== srv.id,
		);
		if (!mismatch) continue;

		const lines = [
			`Note ${JSON.stringify(notePath)}:`,
			`  SERVER  id=${srv.id} content=${fmt(srv.content)}`,
			...rows.map(
				(row) =>
					`  ${row.replicaId}  disk=${fmt(row.disk)} doc=${fmt(row.docText)} id=${row.id ?? "<missing>"} head=${row.head ?? "<missing>"}`,
			),
		];
		blocks.push(lines.join("\n"));
	}

	// No-extra-notes: any file on a replica's disk whose path isn't a live
	// server note is a stray (created locally but never reached — or should
	// have been — the server's authoritative set).
	const livePaths = new Set(notes.keys());
	for (const r of replicas) {
		const extra = listFiles(r.vaultDir).filter((p) => !livePaths.has(p));
		if (extra.length > 0) {
			blocks.push(`Replica ${r.id} has extra note(s) not on the server: ${extra.join(", ")}`);
		}
	}

	if (blocks.length > 0) {
		throw new Error(
			[
				"assertConverged: replicas diverged from the server.",
				"",
				...blocks,
				"",
				`seed=${scheduler.seed}`,
				`replay: ${replayCmd(scheduler.seed)}`,
			].join("\n"),
		);
	}

	const wipes = findWipes(replicas);
	if (wipes.length > 0) {
		throw new Error(
			[
				"assertConverged: #288 wipe detected — file(s) went non-empty -> empty",
				"without an explicit delete op:",
				...wipes.map((p) => `  ${p}`),
				"",
				`seed=${scheduler.seed}`,
				`replay: ${replayCmd(scheduler.seed)}`,
			].join("\n"),
		);
	}
}

/** The #288 detector: any path that, per any replica's write journal
 *  (create/modify/process — see vault-fs.ts), transitioned from a non-empty
 *  write to a zero-length write. A delete goes through fileManager.trashFile,
 *  which never appends to the journal, so any such entry here is — by
 *  construction — not an explicit delete. */
export function findWipes(replicas: Replica[]): string[] {
	const wiped = new Set<string>();
	for (const r of replicas) {
		for (const entry of r.writeJournal()) {
			if (entry.prevLen > 0 && entry.newLen === 0) wiped.add(entry.path);
		}
	}
	return [...wiped];
}
