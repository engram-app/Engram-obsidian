// The Relay-model replacement for CrdtManager + CrdtChannel + CrdtEnrollment:
// one persistent NoteProvider (+ IndexeddbPersistence) per note, keyed by the
// bare note_id. The registry OUTLIVES the socket — a reconnect calls
// setConnected(true), which re-advertises every resident doc via syncStep1 (a
// state-vector diff, never a full re-push). Convergence is the provider's
// readSyncMessage; there is NO text-verify gate, NO staged commit-deferred.
//
// Two doc listeners, one per direction (mirrors Relay + the old manager):
//   - NoteProvider's own update handler forwards LOCAL edits to the wire.
//   - the registry's flush listener writes REMOTE merges (origin === provider)
//     back to disk.
import { IndexeddbPersistence } from "y-indexeddb";
import * as Y from "yjs";
import { diffIntoYText, seedOnce } from "./bridge";
import { projectCanvas, seedCanvasInto } from "./canvas-codec";
import { CONTENT_KEY, frontmatterOf, projectNote, rawFrontmatterOf } from "./frontmatter-codec";
import { NoteProvider } from "./note-provider";

export type DocKind = "note" | "canvas";

interface Entry {
	doc: Y.Doc;
	provider: NoteProvider;
	persistence: IndexeddbPersistence;
	text: Y.Text;
	kind: DocKind;
	ready: Promise<void>;
}

export interface ProviderRegistryOpts {
	/** IndexedDB store namespace (vault id) — keeps two vaults' stores apart. */
	dbPrefix?: string;
	/** Transport: hand a base64 frame to the wire for `noteId`. Returns false
	 *  when the socket isn't joined so the provider buffers + flushes on rejoin.
	 *  Reads the CURRENT socket at call time (indirect) so a reconnect is
	 *  transparent — the registry never rebuilds. */
	send: (noteId: string, frame: string) => boolean;
	/** Write a REMOTE-merged doc back to disk (echo-suppressed: never re-sent). */
	onFlushToDisk: (noteId: string, content: string) => Promise<void> | void;
	/** Fired on the first inbound syncStep2 for a note (op-level "has content"). */
	onSynced?: (noteId: string) => void;
	/** Markdown vs canvas, resolved once per doc at creation. */
	docKind?: (noteId: string) => DocKind;
	/** Surface IndexedDB quota / persistence errors (sync continues in-memory). */
	onPersistError?: (noteId: string, err: unknown) => void;
}

export class ProviderRegistry {
	private readonly entries = new Map<string, Entry>();
	private connected = false;

	constructor(private readonly opts: ProviderRegistryOpts) {}

	private storeName(noteId: string): string {
		return this.opts.dbPrefix ? `${this.opts.dbPrefix}/${noteId}` : noteId;
	}

	private project(entry: Entry): string {
		if (entry.kind === "canvas") return projectCanvas(entry.doc);
		const { order, values } = frontmatterOf(entry.doc);
		return projectNote(order, values, entry.text.toJSON(), rawFrontmatterOf(entry.doc));
	}

	/** Open (or return the cached) provider for `noteId`, IndexedDB-hydrated. */
	private async entry(noteId: string): Promise<Entry> {
		const cached = this.entries.get(noteId);
		if (cached) {
			await cached.ready;
			return cached;
		}
		const doc = new Y.Doc();
		const persistence = new IndexeddbPersistence(this.storeName(noteId), doc);
		const kind = this.opts.docKind?.(noteId) ?? "note";
		const text = doc.getText(CONTENT_KEY);
		const provider = new NoteProvider(doc, {
			send: (frame) => this.opts.send(noteId, frame),
			onSynced: () => this.opts.onSynced?.(noteId),
		});
		persistence.on("error", (err: unknown) => this.opts.onPersistError?.(noteId, err));
		// Disk-flush listener: a REMOTE merge (origin === provider, stamped by
		// readSyncMessage) writes back to disk. Local edits (editor origin) and
		// IndexedDB replay (persistence origin) do NOT flush here.
		doc.on("update", (_u: Uint8Array, origin: unknown) => {
			if (origin !== provider) return;
			void this.opts.onFlushToDisk(
				noteId,
				this.project({ doc, provider, persistence, text, kind, ready }),
			);
		});
		const ready: Promise<void> = persistence.whenSynced.then(() => {
			// Advertise state as soon as IndexedDB has rehydrated, if the socket is
			// already up (syncStep1 → server replies syncStep2 with the diff).
			if (this.connected) provider.setConnected(true);
		});
		const entry: Entry = { doc, provider, persistence, text, kind, ready };
		this.entries.set(noteId, entry);
		await ready;
		return entry;
	}

	/** The doc's body Y.Text — the editor binds to this. Mints + hydrates on first
	 *  access, exactly like opening a note. */
	async getText(noteId: string): Promise<Y.Text> {
		return (await this.entry(noteId)).text;
	}

	async getDoc(noteId: string): Promise<Y.Doc> {
		return (await this.entry(noteId)).doc;
	}

	/** True once the doc holds shared history (server content adopted or seeded). */
	async hasHistory(noteId: string): Promise<boolean> {
		return (await this.entry(noteId)).text.length > 0;
	}

	/** Route an inbound wire frame to its provider (creating it if a fan-out
	 *  announced a note this device hasn't opened yet). */
	async receive(noteId: string, frameB64: string): Promise<void> {
		const e = await this.entry(noteId);
		e.provider.receive(frameB64);
	}

	/** Socket (re)connected/dropped: fan out to every resident provider. On
	 *  connect each re-advertises via syncStep1 — the whole reason the doc layer
	 *  outlives the socket. */
	setConnected(connected: boolean): void {
		this.connected = connected;
		for (const e of this.entries.values()) e.provider.setConnected(connected);
	}

	/** Seed a brand-new note's disk content into the doc — ONLY when the doc has
	 *  no shared history yet (genesis). A note the server already knows adopts its
	 *  lineage via syncStep2 instead (never re-seeded → never doubled). Returns
	 *  the content the doc now holds. Mirrors the adopt-first gate, minus the
	 *  bespoke convergence machinery. */
	async seedFromDisk(noteId: string, diskContent: string, adoptFirst: boolean): Promise<void> {
		const e = await this.entry(noteId);
		if (e.text.length > 0) {
			// Already has history: diff the change in (an edit to a synced note).
			if (e.kind === "note") diffIntoYText(e.text, diskContent);
			return;
		}
		// Genesis. adoptFirst = "the server already holds this exact content on its
		// own lineage" → do NOT seed (that would fork a second lineage); wait for
		// syncStep2 to deliver it. Otherwise this device is the origin: seed.
		if (adoptFirst) return;
		if (e.kind === "canvas") seedCanvasInto(e.doc, diskContent);
		else seedOnce(e.text, diskContent, false);
	}

	hasDoc(noteId: string): boolean {
		return this.entries.has(noteId);
	}

	/** Tear a note's provider + doc down. Call ONLY on note delete / rename / true
	 *  close — NEVER on a transport reconnect (that's the doubling bug). */
	async destroy(noteId: string, clearData = false): Promise<void> {
		const e = this.entries.get(noteId);
		if (!e) return;
		this.entries.delete(noteId);
		e.provider.destroy();
		e.doc.destroy();
		if (clearData) await e.persistence.clearData();
		await e.persistence.destroy();
	}

	async destroyAll(): Promise<void> {
		for (const noteId of [...this.entries.keys()]) await this.destroy(noteId);
	}
}
