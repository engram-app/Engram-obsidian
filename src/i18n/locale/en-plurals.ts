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
	"Free syncs notes only — {count} attachments will be skipped.": {
		one: "Free syncs notes only — {count} attachment will be skipped.",
	},
	" conflicts need resolution": {
		one: " conflict needs resolution",
	},
	"{count} attachments need a paid plan to sync. See Sync Center.": {
		one: "{count} attachment needs a paid plan to sync. See Sync Center.",
	},
	"{count} files queued": {
		one: "{count} file queued",
	},
	"{count} attempts": {
		one: "{count} attempt",
	},
	// UI strings (third pass)
	"{formatted} files · ": {
		one: "{formatted} file · ",
	},
	"{count} need attention": {
		one: "{count} needs attention",
	},
	"{count} conflicts to resolve.": {
		one: "{count} conflict to resolve.",
	},
	"Delete all {count} files currently on the server": {
		one: "Delete all {count} file currently on the server",
	},
	"Upload {count} files from this vault": {
		one: "Upload {count} file from this vault",
	},
	"Delete all {count} files in this vault": {
		one: "Delete all {count} file in this vault",
	},
	"Download {count} files from the server": {
		one: "Download {count} file from the server",
	},
	"{count} notes": {
		one: "{count} note",
	},
	"{count} attachments": {
		one: "{count} attachment",
	},
	"Deleting {count} local files.": {
		one: "Deleting {count} local file.",
	},
	// UI strings (fourth pass)
	"Engram: ⚠ {count} sync errors": {
		one: "Engram: ⚠ {count} sync error",
	},
	"Showing {count} entries": {
		one: "Showing {count} entry",
	},
	"({count} errors)": {
		one: "({count} error)",
	},
};

export default enPlurals;
