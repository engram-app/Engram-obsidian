/**
 * Replay a recorded sync timeline into a fresh ProviderRegistry and report where
 * behaviour diverged.
 *
 * Lives in `tests/`, not `src/`: capture has to run inside a user's session, but
 * replay is purely a harness concern and has no business in the shipped bundle.
 * (Relay puts both in `src/merge-hsm/recording/`; we do not need to.)
 *
 * The workflow this exists for:
 *   1. an e2e run fails, and its recorder timeline is uploaded as a CI artifact
 *   2. `replayTimeline(JSON.parse(artifact))` reproduces it deterministically
 *   3. fix the bug, keep the timeline as a regression fixture
 *
 * Only wire-driven events are replayable. A `send` is an OUTPUT of the system
 * under test, so replay asserts against it rather than performing it — that
 * comparison is the actual test.
 */

import { ProviderRegistry } from "../../src/crdt/provider-registry";
import { fromB64 } from "../../src/crdt/wire";
import type { SyncEvent } from "../../src/sync-recorder";

export interface ReplayDivergence {
	seq: number;
	noteId: string | null;
	/** What the recording said happened. */
	expected: string;
	/** What this replay produced. */
	actual: string;
}

export interface ReplayResult {
	divergences: ReplayDivergence[];
	/** Final projected text per note, for a caller that wants to assert content. */
	finalText: Record<string, string>;
	/** Events the harness could not act on, by kind. */
	skipped: Record<string, number>;
}

export interface ReplayOpts {
	/** IndexedDB namespace. Give each replay its own so runs cannot bleed. */
	dbPrefix?: string;
	/** Stop at the first divergence rather than collecting all of them. */
	stopOnDivergence?: boolean;
	/** Disk content a `localEdit` should feed in, keyed by the recorded hash.
	 *  Timelines carry hashes rather than note bodies, so a caller replaying a
	 *  content-sensitive scenario has to supply the text. Unknown hashes make the
	 *  localEdit a skip instead of a silent empty write. */
	contentByHash?: Record<string, string>;
}

const settle = () => new Promise<void>((r) => setTimeout(r, 15));

export async function replayTimeline(
	events: SyncEvent[],
	opts: ReplayOpts = {},
): Promise<ReplayResult> {
	const divergences: ReplayDivergence[] = [];
	const skipped: Record<string, number> = {};
	const sends: { noteId: string; kind: string }[] = [];
	const flushed: Record<string, string> = {};

	const registry = new ProviderRegistry({
		dbPrefix: opts.dbPrefix ?? "replay",
		// Capture rather than transmit: outbound frames are the output being
		// checked, and there is no peer in a replay.
		send: (noteId, _frame, kind) => {
			sends.push({ noteId, kind });
			return true;
		},
		onFlushToDisk: (noteId, content) => {
			flushed[noteId] = content;
		},
	});

	const skip = (kind: string) => {
		skipped[kind] = (skipped[kind] ?? 0) + 1;
	};

	try {
		for (const event of events) {
			const { noteId } = event;
			switch (event.kind) {
				case "receive":
					if (noteId && typeof event.data.frame === "string") {
						await registry.receive(noteId, event.data.frame);
					} else skip(event.kind);
					break;

				case "remoteUpdate":
					// Raw bytes are not in the timeline (only a length), so this is
					// replayable only when a caller supplied the frame.
					if (noteId && typeof event.data.frame === "string") {
						await registry.applyRemoteUpdate(noteId, fromB64(event.data.frame));
					} else skip(event.kind);
					break;

				case "localEdit": {
					const hash = event.data.hash as string | undefined;
					const content = hash ? opts.contentByHash?.[hash] : undefined;
					if (noteId && content !== undefined) {
						await registry.applyLocalEdit(noteId, content);
					} else skip(event.kind);
					break;
				}

				case "enroll":
					if (noteId) await registry.startSync(noteId);
					else skip(event.kind);
					break;

				case "reset":
					if (noteId) registry.reset(noteId);
					else skip(event.kind);
					break;

				case "connection":
					registry.setConnected(event.data.connected === true);
					break;

				case "send": {
					// An assertion point, not an action. The recorded frame should have
					// been produced by the events replayed so far.
					await settle();
					const actual = sends.shift();
					const expectedKind = String(event.data.kind);
					if (!actual) {
						divergences.push({
							seq: event.seq,
							noteId,
							expected: `send ${expectedKind}`,
							actual: "no frame sent",
						});
					} else if (actual.noteId !== noteId || actual.kind !== expectedKind) {
						divergences.push({
							seq: event.seq,
							noteId,
							expected: `send ${expectedKind} for ${noteId}`,
							actual: `send ${actual.kind} for ${actual.noteId}`,
						});
					}
					break;
				}

				case "flush": {
					await settle();
					const expectedLength = event.data.length as number | undefined;
					const actualContent = noteId ? flushed[noteId] : undefined;
					if (actualContent === undefined) {
						divergences.push({
							seq: event.seq,
							noteId,
							expected: `flush of ${expectedLength} chars`,
							actual: "no flush",
						});
					} else if (
						expectedLength !== undefined &&
						actualContent.length !== expectedLength
					) {
						divergences.push({
							seq: event.seq,
							noteId,
							expected: `flush of ${expectedLength} chars`,
							actual: `flush of ${actualContent.length} chars`,
						});
					}
					break;
				}

				default:
					skip(event.kind);
			}

			if (opts.stopOnDivergence && divergences.length > 0) break;
		}

		await settle();

		const finalText: Record<string, string> = {};
		for (const noteId of registry.docs.keys()) {
			finalText[noteId] = await registry.projectedText(noteId);
		}
		return { divergences, finalText, skipped };
	} finally {
		await registry.destroyAll();
	}
}
