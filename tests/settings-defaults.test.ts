import { DEFAULT_SETTINGS } from "../src/types";

test("diagnosticsEnabled defaults OFF (Obsidian opt-in rule)", () => {
	expect(DEFAULT_SETTINGS.diagnosticsEnabled).toBe(false);
});
