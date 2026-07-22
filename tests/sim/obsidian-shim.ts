// tests/sim/obsidian-shim.ts
/** Obsidian module shim for the sim tier. Re-exports the real identities from
 *  tests/__mocks__/obsidian.ts (TFile/TFolder/normalizePath/Notice/... — the
 *  SAME classes the engine's `instanceof` checks use, per trap T1) and swaps
 *  only `requestUrl` for a per-run injectable handler (Task 4's model server
 *  plugs in here via setRequestUrlHandler).
 *
 *  Preserves requestUrl()'s real non-abortable semantics: it never rejects on
 *  its own, it just settles whenever the injected handler settles — same
 *  shape src/api.ts:46-60 (withTimeout) already races against. */
export * from "../__mocks__/obsidian";

import type { RequestUrlParam, RequestUrlResponse } from "obsidian";

type RequestUrlHandler = (opts: RequestUrlParam) => Promise<RequestUrlResponse>;

let handler: RequestUrlHandler = async () => {
	throw new Error("sim requestUrl handler not set — call setRequestUrlHandler() first");
};

/** Per-run injection point. Call once per sim run before booting a Replica. */
export function setRequestUrlHandler(fn: RequestUrlHandler): void {
	handler = fn;
}

export async function requestUrl(opts: RequestUrlParam): Promise<RequestUrlResponse> {
	return handler(opts);
}
