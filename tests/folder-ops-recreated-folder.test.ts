// Adversarial review @ 23b5eee2, LOW-4: after following a peer's folder
// move, the receiver records the old folder as moved away, so emptying it
// can remove it even though it is in the local explicit-folder set. If the
// user then makes a new folder at the old name, that record still said
// "moved away", and the next empty-folder pass dropped the user's marker
// and trashed the folder. A folder created at (or under) the name clears it.
import { expect, mock, test } from "bun:test";
import "fake-indexeddb/auto";
import type { EngramApi } from "../src/api";
import { SyncEngine } from "../src/sync";
import { DEFAULT_SETTINGS } from "../src/types";

function engine() {
	const app = {
		vault: {
			configDir: ".obsidian",
			getAbstractFileByPath: () => null,
			getFileByPath: () => null,
			getName: () => "Vault",
		},
		workspace: { getActiveViewOfType: () => null },
	} as any;
	const api = { createFolder: mock().mockResolvedValue({ folders: [] }) };
	const e = new SyncEngine(
		app,
		api as unknown as EngramApi,
		{ ...DEFAULT_SETTINGS, vaultId: "v1", debounceMs: 1 },
		mock().mockResolvedValue(undefined),
	);
	const marked = new Set<string>(); // the explicit-folder set
	(e as any).explicitFolders = {
		has: (p: string) => marked.has(p),
		add: async (p: string) => void marked.add(p),
		delete: async (p: string) => void marked.delete(p),
	};
	return { e, marked };
}

for (const [made, why] of [
	["Proj", "the folder itself"],
	["Proj/new", "a folder under it"],
] as const) {
	test(`re-making ${why} clears the moved-away record`, async () => {
		const { e } = engine();
		try {
			(e as any).movedAwayFolders.set("Proj", "Done");
			(e as any).movedAwayFolders.set("Proj/sub", "Done/sub");
			(e as any).movedAwayFolders.set("Other", "Elsewhere");
			await e.handleFolderCreate({ path: made });
			expect((e as any).isMovedAway("Proj")).toBe(false);
			expect((e as any).isMovedAway(made)).toBe(false);
			expect((e as any).isMovedAway("Other")).toBe(true); // unrelated record stays
		} finally {
			e.destroy();
		}
	});
}
