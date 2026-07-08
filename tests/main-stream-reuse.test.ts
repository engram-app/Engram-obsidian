/**
 * Tests: shouldReuseLiveStream (main.ts) — the setupNoteStream() short-circuit
 * decision.
 *
 * Root cause (e2e test_48, CI run 28919928915): an auth swap mutates settings
 * BEFORE the auth provider is rebuilt. saveSettings() then runs
 * setupNoteStream() #1 with the NEW settings but the OLD authProvider — its
 * connectChannel getMe() resolves as the OLD user, constructing a NoteChannel
 * bound to old-user + new-vault, whose sync:/crdt: joins the server refuses
 * (vault_not_found) with no retry. The swap's own setupNoteStream() #2 then
 * SHORT-CIRCUITED: the connection key (computed from settings alone) matched
 * liveChannelKey set by #1, and this.noteStream was already assigned — so the
 * doomed channel survived as the live stream and check_stream_connected hung
 * for the full 60s. The short-circuit exists only to protect a HEALTHY socket
 * from unrelated saveSettings churn (#169), so it must additionally require
 * the stream to actually be CONNECTED (sync: topic joined).
 */
import { describe, expect, test } from "bun:test";
import { shouldReuseLiveStream } from "../src/main";

describe("shouldReuseLiveStream", () => {
	test("reuses a connected stream whose connection key matches (the #169 churn guard)", () => {
		expect(shouldReuseLiveStream(true, true, "url|me|v1", "url|me|v1")).toBe(true);
	});

	test("does NOT reuse a stream that exists but never connected (test_48 doomed channel)", () => {
		// Key matches — the doomed channel was built from the same (new)
		// settings — but its sync: join was refused, so liveConnected is false.
		// Reusing it strands the plugin on a channel bound to the wrong user.
		expect(shouldReuseLiveStream(true, false, "url|me|v1", "url|me|v1")).toBe(false);
	});

	test("does NOT reuse when the connection identity changed", () => {
		expect(shouldReuseLiveStream(true, true, "url|me|v2", "url|me|v1")).toBe(false);
	});

	test("does NOT reuse when no stream exists", () => {
		expect(shouldReuseLiveStream(false, true, "url|me|v1", "url|me|v1")).toBe(false);
		expect(shouldReuseLiveStream(false, false, "url|me|v1", null)).toBe(false);
	});
});
