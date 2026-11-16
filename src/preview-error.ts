/** Why the first-sync preview could not read the server's state. Carried by
 *  PreviewUnavailableError so the modal can say what actually went wrong
 *  instead of blaming the connection for every failure. Anything that is NOT
 *  one of these (a dropped fetch mid-walk) is a genuine network-class error. */
export type PreviewFailReason =
	| "join_rejected" // the crdt: topic join was refused (plan, old plugin, backend)
	| "no_vault" // no vault selected, so there is no room to join
	| "identity_mismatch" // the socket belongs to a different vault than the settings
	| "timeout"; // the live socket never became enumerable within the wait budget

export class PreviewUnavailableError extends Error {
	constructor(
		readonly reason: PreviewFailReason,
		detail?: string,
	) {
		super(`Sync preview needs the live socket (${reason}${detail ? `: ${detail}` : ""})`);
		this.name = "PreviewUnavailableError";
	}
}
