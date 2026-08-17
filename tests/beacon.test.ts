import { describe, expect, test } from "bun:test";
import { BeaconBuffer, type BeaconEntry } from "../src/observability/beacon";

const entry = (): BeaconEntry => ({
	trace_id: "1".repeat(32),
	parent_span_id: "2".repeat(16),
	name: "obsidian.push",
	start_us: 1,
	end_us: 2,
	attributes: {},
});

describe("BeaconBuffer", () => {
	test("flush batches all queued spans into one request", () => {
		const calls: any[] = [];
		(global as any).fetch = (url: string, opts: any) => {
			calls.push({ url, opts });
			return Promise.resolve();
		};
		const buf = new BeaconBuffer(() => ({
			baseUrl: "https://api.example/api",
			token: "t",
			vaultId: "v",
			deviceId: "d",
		}));
		buf.enqueue(entry());
		buf.enqueue(entry());
		buf.flush();
		expect(calls).toHaveLength(1);
		expect(calls[0].url).toBe("https://api.example/api/telemetry/spans");
		expect(JSON.parse(calls[0].opts.body).spans).toHaveLength(2);
		expect(calls[0].opts.keepalive).toBe(true);
	});

	test("null transport (disabled) issues no request", () => {
		const calls: any[] = [];
		(global as any).fetch = (url: string, opts: any) => {
			calls.push({ url, opts });
			return Promise.resolve();
		};
		const buf = new BeaconBuffer(() => null);
		buf.enqueue(entry());
		buf.flush();
		expect(calls).toHaveLength(0);
	});

	test("never throws when fetch rejects", () => {
		(global as any).fetch = () => Promise.reject(new Error("network"));
		const buf = new BeaconBuffer(() => ({
			baseUrl: "https://api.example/api",
			token: "t",
			vaultId: "v",
			deviceId: "d",
		}));
		expect(() => {
			buf.enqueue(entry());
			buf.flush();
		}).not.toThrow();
	});

	test("enqueue does not touch the network (only flush does)", () => {
		const calls: any[] = [];
		(global as any).fetch = (url: string, opts: any) => {
			calls.push({ url, opts });
			return Promise.resolve();
		};
		const buf = new BeaconBuffer(() => ({
			baseUrl: "https://api.example/api",
			token: "t",
			vaultId: "v",
			deviceId: "d",
		}));
		buf.enqueue(entry());
		expect(calls).toHaveLength(0);
	});

	test("auto-flushes at the 20-span cap without waiting for the timer", () => {
		const calls: any[] = [];
		(global as any).fetch = (url: string, opts: any) => {
			calls.push({ url, opts });
			return Promise.resolve();
		};
		const buf = new BeaconBuffer(() => ({
			baseUrl: "https://api.example/api",
			token: "t",
			vaultId: "v",
			deviceId: "d",
		}));
		for (let i = 0; i < 20; i++) buf.enqueue(entry());
		expect(calls).toHaveLength(1);
		expect(JSON.parse(calls[0].opts.body).spans).toHaveLength(20);
	});
});

describe("beacon path attributes (2026-07-14 deaf-note observability)", () => {
	const { beaconNoteId, beaconRoute } = require("../src/api");

	test("beaconNoteId extracts the first UUID from a request path", () => {
		expect(beaconNoteId("/notes/019f45c5-7818-771b-9242-9ae8c7fd214f/updates")).toBe(
			"019f45c5-7818-771b-9242-9ae8c7fd214f",
		);
		expect(beaconNoteId("/sync/changes")).toBeNull();
	});

	test("beaconRoute collapses UUIDs to :id and drops the query", () => {
		expect(beaconRoute("/notes/019f45c5-7818-771b-9242-9ae8c7fd214f/updates?since=abc")).toBe(
			"/notes/:id/updates",
		);
		expect(beaconRoute("/vault/heads")).toBe("/vault/heads");
	});

	test("beaconRoute stays within the 64-byte sanitizer bound", () => {
		expect(beaconRoute(`/x/${"a".repeat(100)}`).length).toBeLessThanOrEqual(64);
	});

	// The reason this function was rewritten. deleteNote/deleteAttachment build
	// the request path from the vault-relative NOTE PATH, so collapsing UUIDs
	// alone sent `/notes/Medical/Divorce settlement draft.md` out whole. The
	// server's BeaconSanitizer rejects a path in `engram.note_id` but admits
	// `engram.route` on length alone, so it landed as an OTel span attribute.
	test("beaconRoute never emits a vault path segment", () => {
		const route = beaconRoute("/notes/Medical/Divorce%20settlement%20draft.md");

		expect(route).toBe("/notes/:seg/:seg");
		expect(route).not.toContain("Medical");
		expect(route).not.toContain("Divorce");
	});

	test("beaconRoute keeps segments that are ours", () => {
		expect(beaconRoute("/api/notes/sync/changes")).toBe("/api/notes/sync/changes");
		expect(beaconRoute("/folders/explicit")).toBe("/folders/explicit");
	});

	// Allowlist, not denylist: an unregistered route reads :seg, which costs one
	// unhelpful label. The other direction costs a folder name.
	test("an unregistered route segment fails closed", () => {
		expect(beaconRoute("/notes/brandnewthing")).toBe("/notes/:seg");
	});
});
