import { DEFAULT_SETTINGS } from "../src/types";

test("diagnosticsEnabled defaults OFF (Obsidian opt-in rule)", () => {
	expect(DEFAULT_SETTINGS.diagnosticsEnabled).toBe(false);
});

test("remoteLogLevel defaults to info (preserves legacy ship-everything behavior)", () => {
	expect(DEFAULT_SETTINGS.remoteLogLevel).toBe("info");
});
