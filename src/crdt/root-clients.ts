// Root-insert ownership of a note body. A ROOT insert is a `content` item with
// no origin and no rightOrigin (inserted into an empty sequence); two clients
// owning one = a rival lineage (a doubled note). Deleted items stay in the list
// and still count: a root insert later deleted is still a root.
import * as Y from "yjs";
import { seedCanvasInto } from "./canvas-codec";
import { CONTENT_KEY } from "./frontmatter-codec";
import { projectDoc, seedContentInto } from "./note-seed";

export function rootClients(doc: Y.Doc): Set<number> {
	const clients = new Set<number>();
	// ponytail: Yjs internals (_start/.right); no public API exposes origins.
	type RawItem = {
		origin: unknown;
		rightOrigin: unknown;
		id: { client: number };
		right: RawItem | null;
	};
	let item = (doc.getText(CONTENT_KEY) as unknown as { _start: RawItem | null })._start;
	for (; item; item = item.right) {
		if (item.origin === null && item.rightOrigin === null) clients.add(item.id.client);
	}
	return clients;
}

/** What the plugin's own codec projects after seeding `text` into a fresh doc. */
export function canonText(text: string, kind: "note" | "canvas"): string {
	const doc = new Y.Doc();
	if (kind === "canvas") seedCanvasInto(doc, text);
	else seedContentInto(doc, doc.getText(CONTENT_KEY), text, false);
	return projectDoc(doc, kind);
}
