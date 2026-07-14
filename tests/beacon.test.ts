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
});
