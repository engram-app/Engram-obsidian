import { expect, test } from "bun:test";
import * as searchUi from "../src/search-ui";

// Prod: every stored note is searchable on every plan; past the passage budget
// the least recently edited notes fall to keyword-only search, still found.
// The panel's "Searching 2,000 of N notes. Upgrade to search everything." line
// described a coverage cap the backend removed, so it is gone.
test("the search panel carries no index-cap hint", () => {
	expect("capHintText" in searchUi).toBe(false);
	expect("unsearchableCount" in searchUi).toBe(false);
});
