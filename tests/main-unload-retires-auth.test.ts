/**
 * Tests: onunload (main.ts) retires the auth provider (#420).
 *
 * A plugin update/reload replaces the whole plugin instance. If the outgoing
 * instance's OAuthAuth is left undisposed, a refresh in flight at unload time
 * resolves afterward, persists over the NEW instance's data.json, and forks
 * the rotating refresh-token chain — the server's reuse detection then
 * revokes the whole token family (prod incident 2026-08-12).
 *
 * Isolated in its own file: onunload tears down module-level loggers
 * (destroyDevLog / setLogSink), which would pollute sibling tests.
 */
import { describe, expect, mock, spyOn, test } from "bun:test";
import { OAuthAuth } from "../src/auth";
import EngramSyncPlugin from "../src/main";

// onunload touches the Obsidian renderer global `activeDocument`, which the
// preload only shims when a DOM `document` exists (it doesn't under bun).
(globalThis as unknown as { activeDocument?: unknown }).activeDocument ??= {
	body: { classList: { remove() {} } },
};
// DEV_MODE is an esbuild-injected define; bun test loads sources directly.
(globalThis as unknown as { DEV_MODE?: boolean }).DEV_MODE ??= false;

describe("onunload auth-provider retirement", () => {
	test("disposes the OAuthAuth so a post-unload refresh cannot persist", () => {
		const old = new OAuthAuth("engram_rt_old", "vault-1", "u@test.com", mock());
		const disposeSpy = spyOn(old, "dispose");
		const fake = Object.assign(Object.create(EngramSyncPlugin.prototype), {
			authProvider: old,
			crdtWiring: null,
			api: { beacon: { flush() {} } },
			syncEngine: {
				getLastSync() {
					return 0;
				},
				destroy() {},
			},
			async savePluginData(_ls: unknown) {},
			baseStore: null,
			crdtOpQueue: null,
			noteStream: null,
			crdtLiveViews: null,
			crdtManager: null,
			syncInterval: null,
			promiseTracker: null,
		});

		EngramSyncPlugin.prototype.onunload.call(fake as never);

		expect(disposeSpy).toHaveBeenCalledTimes(1);
	});
});
