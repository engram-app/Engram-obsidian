/**
 * Liveness errors for torn-down CRDT docs.
 *
 * Ported from Relay (`src/DestroyedError.ts` + `src/DocumentDestroyedError.ts`),
 * whose contract we adopt wholesale: touching a destroyed doc is an ERROR, not
 * a get-or-create. Our registry previously answered "give me the doc for this
 * note" by silently constructing a fresh one, so a late frame for a DELETED
 * note rebuilt its room, completed an empty handshake, and materialized an
 * empty file at the deleted path. Relay makes that state unrepresentable: the
 * doc is dead, the access throws, and the caller decides explicitly.
 *
 * Callers that legitimately race a delete catch it (see `isDestroyedError`) —
 * mirroring Relay's LiveViews/SharedFolder call sites, which swallow exactly
 * this error and nothing else.
 */

export class DestroyedError extends Error {
	constructor(
		public readonly owner: string,
		public readonly detail?: string,
	) {
		super(detail ? `${owner} was destroyed: ${detail}` : `${owner} was destroyed`);
		this.name = "DestroyedError";
	}
}

export class NoteDestroyedError extends DestroyedError {
	constructor(
		public readonly noteId: string,
		public readonly path?: string,
	) {
		super("Note", path ? `${path} (${noteId})` : noteId);
		this.name = "NoteDestroyedError";
	}
}

export function isDestroyedError(error: unknown): error is DestroyedError {
	return error instanceof DestroyedError;
}

export function isNoteDestroyedError(error: unknown): error is NoteDestroyedError {
	return error instanceof NoteDestroyedError;
}
