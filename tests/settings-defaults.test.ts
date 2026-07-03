import { DEFAULT_SETTINGS } from "../src/types";

test("diagnosticMode defaults OFF (Obsidian opt-in rule)", () => {
	expect(DEFAULT_SETTINGS.diagnosticMode).toBe(false);
});
