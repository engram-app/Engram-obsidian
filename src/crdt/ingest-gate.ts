/**
 * Replay decision for the CRDT ingest gate: a pending local edit may enter a
 * note's Y.Doc only once the doc holds the server's lineage. This is the pure
 * rule set deciding what to do with the local text against server text `S`.
 */
import { fnv1a } from "../content-hash";
import { merge3, onlyInserts } from "./lca-merge";

export type ReplayInput = {
	server: string;
	text: string;
	base: string | null;
	baselineHash: number | undefined;
	kind: "note" | "canvas";
};
export type ReplayDecision = { kind: "apply"; text: string } | { kind: "keep-both" };

export function decideReplay(i: ReplayInput, canon: (t: string) => string): ReplayDecision {
	const { server, text, base, baselineHash } = i;
	const serverHash = fnv1a(server);
	// 1. Server unchanged since the baseline. The second form covers a server
	//    that only canonicalized the base's frontmatter (#1928).
	const unchanged =
		serverHash === baselineHash ||
		(base !== null && fnv1a(base) === baselineHash && serverHash === fnv1a(canon(base)));
	if (unchanged) return { kind: "apply", text };
	// Canvas JSON never merges textually.
	if (i.kind === "canvas") return { kind: "keep-both" };
	// 2. Base known: three-way merge.
	if (base !== null) {
		const m = merge3(base, text, server);
		return m.clean ? { kind: "apply", text: m.text } : { kind: "keep-both" };
	}
	// 3. No base: only if the edit deletes nothing the server holds.
	return onlyInserts(server, text) ? { kind: "apply", text } : { kind: "keep-both" };
}
