import type * as Y from "yjs";

/** Root maps of `filemeta_v1` in the per-vault index doc (Engram#2523): a note
 *  holds its folder id plus its own name, a folder its parent plus its name,
 *  so a folder move is ONE entry. They live beside `filemeta_v0` in the same
 *  Y.Doc; a server that does not project them keeps them inert. */
export const NOTES_V1 = "notes_v1";
export const FOLDERS_V1 = "folders_v1";

/** Writes `filemeta_v1`, only while the vault advertises `index_v1` (the
 *  server stamps that per vault once its v1 seed is in, S5). Before then a v1
 *  written here would be stale against every web, MCP and old-plugin write
 *  that touches only v0, and projecting a stale map reverts renames. */
export class FileMetaV1Writer {
	constructor(
		private readonly doc: () => Y.Doc | null,
		private readonly enabled: () => boolean,
	) {}

	note(noteId: string, folderId: string | null, name: string): void {
		if (this.enabled()) this.doc()?.getMap(NOTES_V1).set(noteId, { folder_id: folderId, name });
	}

	folder(folderId: string, parentId: string | null, name: string): void {
		if (this.enabled()) {
			this.doc()?.getMap(FOLDERS_V1).set(folderId, { parent_id: parentId, name });
		}
	}
}
