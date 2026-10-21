/**
 * Per-note body that catch-up discovery wrote to disk: the merge base for a
 * later local edit. Plain IndexedDB `engram-discovery-base/<vaultId>`, one
 * object store keyed by noteId.
 */
const STORE = "bases";

const wrap = <T>(req: IDBRequest<T>): Promise<T> =>
	new Promise((resolve, reject) => {
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error);
	});

export class DiscoveryBaseStore {
	private db: Promise<IDBDatabase> | null = null;

	constructor(private readonly vaultId: string) {}

	private open(): Promise<IDBDatabase> {
		this.db ??= new Promise((resolve, reject) => {
			const req = indexedDB.open(`engram-discovery-base/${this.vaultId}`, 1);
			req.onupgradeneeded = () => req.result.createObjectStore(STORE);
			req.onsuccess = () => resolve(req.result);
			req.onerror = () => {
				this.db = null; // allow a retry after a failed open
				reject(req.error);
			};
		});
		return this.db;
	}

	private async run<T>(
		mode: IDBTransactionMode,
		fn: (s: IDBObjectStore) => IDBRequest<T>,
	): Promise<T> {
		const db = await this.open();
		const tx = db.transaction(STORE, mode);
		const done = new Promise<void>((resolve, reject) => {
			tx.oncomplete = () => resolve();
			tx.onerror = () => reject(tx.error);
			tx.onabort = () => reject(tx.error);
		});
		const result = await wrap(fn(tx.objectStore(STORE)));
		await done; // durable before resolving
		return result;
	}

	async put(noteId: string, text: string): Promise<void> {
		await this.run("readwrite", (s) => s.put(text, noteId));
	}

	async get(noteId: string): Promise<string | null> {
		return ((await this.run("readonly", (s) => s.get(noteId))) as string | undefined) ?? null;
	}

	async delete(noteId: string): Promise<void> {
		await this.run("readwrite", (s) => s.delete(noteId));
	}
}
