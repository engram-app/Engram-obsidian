import type { Dict } from "..";

/**
 * English singular forms.
 *
 * Every key here is its own plural ("files"), which is what the call site
 * passes, so `other` never needs an entry: a miss falls through to the key.
 * Only `one` differs from the key, so only `one` is listed.
 */
const enPlurals: Dict = {
	"Engram Sync: pushed {count} files": {
		one: "Engram Sync: pushed {count} file",
	},
	"Engram Sync: pulled {count} files from server": {
		one: "Engram Sync: pulled {count} file from server",
	},
	"Engram Sync: pulled {count} changes": {
		one: "Engram Sync: pulled {count} change",
	},
	"Engram: {count} files failed to sync{detail} — open Sync Center": {
		one: "Engram: {count} file failed to sync{detail} — open Sync Center",
	},
	"Engram: {count} attachments skipped — upgrade to sync images & PDFs.": {
		one: "Engram: {count} attachment skipped — upgrade to sync images & PDFs.",
	},
	"Engram: plan upgraded — syncing {count} attachments…": {
		one: "Engram: plan upgraded — syncing {count} attachment…",
	},
};

export default enPlurals;
