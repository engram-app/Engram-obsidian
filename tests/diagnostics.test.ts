import { formatVaultEvent } from "../src/diagnostics";

test("formats a metadata-only event line (no content)", () => {
	const line = formatVaultEvent("modify", "Notes/a.md", { bytes: 42 });
	expect(line).toBe("modify path=Notes/a.md bytes=42");
});

test("rename carries old path, still no content", () => {
	const line = formatVaultEvent("rename", "b.md", { from: "a.md" });
	expect(line).toContain("path=b.md");
	expect(line).toContain("from=a.md");
});
