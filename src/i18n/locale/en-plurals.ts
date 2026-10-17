import type { Dict } from "..";

/**
 * English singular forms.
 *
 * Every key here is its own plural ("files"), which is what the call site
 * passes, so `other` never needs an entry: a miss falls through to the key.
 * Only `one` differs from the key, so only `one` is listed.
 */
const enPlurals: Dict = {
	"This sync adds {count} notes. Your plan has room for {room}.": {
		one: "This sync adds {count} note. Your plan has room for {room}.",
	},
	"{folder} {count} notes ({newCount} new)": {
		one: "{folder} {count} note ({newCount} new)",
	},
	"I understand {count} notes will not sync.": {
		one: "I understand {count} note will not sync.",
	},
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
	"Engram: {count} attachments skipped — upgrade your plan to sync images & PDFs.": {
		one: "Engram: {count} attachment skipped — upgrade your plan to sync images & PDFs.",
	},
	"Engram: plan upgraded — syncing {count} attachments…": {
		one: "Engram: plan upgraded — syncing {count} attachment…",
	},
	"Free syncs notes only — {count} attachments will be skipped.": {
		one: "Free syncs notes only — {count} attachment will be skipped.",
	},
	"{count} conflicts need resolution": {
		one: "{count} conflict needs resolution",
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
	"{count} files": {
		one: "{count} file",
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
	"Engram: {count} notes have frontmatter problems. Open Sync Center to fix.": {
		one: "Engram: {count} note has frontmatter problems. Open Sync Center to fix.",
	},
	// English does not inflect these, but most locales do (ru: "1 повторяется",
	// "5 повторяются"), so they are plurals: the translator gets every form.
	"{count} missing on server": { one: "{count} missing on server" },
	"{count} diverged": { one: "{count} diverged" },
	"{count} only on server": { one: "{count} only on server" },
	"{label} ({count} queued)": { one: "{label} ({count} queued)" },
	"Engram: offline ({count} queued)": { one: "Engram: offline ({count} queued)" },
	"{count} files not included in your plan": { one: "{count} file not included in your plan" },
	"{count} retrying": { one: "{count} retrying" },
	"{count} ignored": { one: "{count} ignored" },
	"{count} queued — {reason}": { one: "{count} queued — {reason}" },
	"Will upload {count} files.": { one: "Will upload {count} file." },
	"Will download {count} files.": { one: "Will download {count} file." },
	"Uploading {count}.": { one: "Uploading {count}." },
	"Downloading {count}.": { one: "Downloading {count}." },
	"Deleting {count} on the cloud.": { one: "Deleting {count} on the cloud." },
	"✓ {count} synced": { one: "✓ {count} synced" },
	"⤳ {count} skipped (Free plan)": { one: "⤳ {count} skipped (Free plan)" },
	"✕ {count} failed": { one: "✕ {count} failed" },
	'{count} failed. Run "{command}" for details.': {
		one: '{count} failed. Run "{command}" for details.',
	},
};

export default enPlurals;
