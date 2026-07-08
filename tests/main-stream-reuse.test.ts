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
 * the stream to have CONNECTED at least once (sync: topic joined).
 *
 * Final review IMPORTANT-3: the second parameter must be `everConnected` —
 * sticky true once a stream connects for the first time — NOT the raw
 * currently-connected flag, which flips false on every transient disconnect.
 * Gating reuse on raw current-connectedness tore down the entire CRDT stack
 * on any saveSettings() during a blip (the #169 churn + live-doc clobber
 * family). The swap-bug case stays covered either way: a fresh doomed channel
 * has everConnected=false (it never connected at all), same as it had
 * liveConnected=false.
 */
import { describe, expect, test } from "bun:test";
import { shouldReuseLiveStream } from "../src/main";

describe("shouldReuseLiveStream", () => {
	test("reuses a connected stream whose connection key matches (the #169 churn guard)", () => {
		expect(shouldReuseLiveStream(true, true, "url|me|v1", "url|me|v1")).toBe(true);
	});

	test("does NOT reuse a stream that exists but never connected (test_48 doomed channel)", () => {
		// Key matches — the doomed channel was built from the same (new)
		// settings — but its sync: join was refused, so everConnected is false.
		// Reusing it strands the plugin on a channel bound to the wrong user.
		expect(shouldReuseLiveStream(true, false, "url|me|v1", "url|me|v1")).toBe(false);
	});

	test("STILL reuses a stream that has since transiently disconnected, once it ever connected (IMPORTANT-3)", () => {
		// A healthy stream that connected once, then dropped mid-blip
		// (everConnected stays true — only the raw live-status flag would
		// have flipped false). saveSettings() during the blip must not tear
		// down the whole CRDT stack; the connection key still matches.
		expect(shouldReuseLiveStream(true, true, "url|me|v1", "url|me|v1")).toBe(true);
	});

	test("does NOT reuse when the connection identity changed", () => {
		expect(shouldReuseLiveStream(true, true, "url|me|v2", "url|me|v1")).toBe(false);
	});

	test("does NOT reuse when no stream exists", () => {
		expect(shouldReuseLiveStream(false, true, "url|me|v1", "url|me|v1")).toBe(false);
		expect(shouldReuseLiveStream(false, false, "url|me|v1", null)).toBe(false);
	});
});
