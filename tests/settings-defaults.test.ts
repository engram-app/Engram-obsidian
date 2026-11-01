import { DEFAULT_SETTINGS } from "../src/types";

test("diagnosticsEnabled defaults OFF (Obsidian opt-in rule)", () => {
	expect(DEFAULT_SETTINGS.diagnosticsEnabled).toBe(false);
});

test("remoteLogLevel defaults to warn (info is an explicit opt-in)", () => {
	expect(DEFAULT_SETTINGS.remoteLogLevel).toBe("warn");
});

test("diagnostics carries no enable stamp by default", () => {
	expect(DEFAULT_SETTINGS.diagnosticsEnabledAt).toBeNull();
});
