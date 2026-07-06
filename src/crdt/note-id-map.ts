/** Path -> note_id sidecar (Task 4 of the note_id-keyed CRDT rework).
 *
 * The CRDT document is being re-keyed by stable `note_id` instead of vault
 * path, because a rename currently looks like a delete+create to the CRDT
 * layer. This map is the plugin-side bridge: it remembers which note_id a
 * given path was last known to correspond to, and survives renames without
 * losing the id. Persisted in data.json (see main.ts PluginData.noteIds) so
 * it outlives a plugin reload.
 *
 * Later tasks (5, 6) use this to mint ids for new notes, learn ids from
 * pull responses, and key the CRDT manager by note_id.
 */
export class NoteIdMap {
	private readonly byPath = new Map<string, string>();

	get(path: string): string | null {
		return this.byPath.get(path) ?? null;
	}

	set(path: string, id: string): void {
		this.byPath.set(path, id);
	}

	delete(path: string): void {
		this.byPath.delete(path);
	}

	rename(oldPath: string, newPath: string): void {
		const id = this.byPath.get(oldPath);
		if (id === undefined) return;
		this.byPath.delete(oldPath);
		this.byPath.set(newPath, id);
	}

	toJSON(): Record<string, string> {
		return Object.fromEntries(this.byPath);
	}

	static fromJSON(o: Record<string, string> | undefined): NoteIdMap {
		const m = new NoteIdMap();
		for (const [p, id] of Object.entries(o ?? {})) m.set(p, id);
		return m;
	}
}
