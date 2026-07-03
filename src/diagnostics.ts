/**
 * Verbose diagnostic firehose. Emits metadata-only log lines for vault and
 * workspace activity so a WS "blip" can be reconstructed from the client side.
 * NEVER logs note content: only path, event kind, byte counts, and timing.
 * Gated by the diagnosticMode setting (which itself requires remoteLoggingEnabled).
 */
import { type App, TFile, TFolder } from "obsidian";
import { rlog } from "./remote-log";

type EventKind = "modify" | "create" | "delete" | "rename" | "file-open" | "leaf-change";

export function formatVaultEvent(
	kind: EventKind,
	path: string,
	extra?: Record<string, string | number>,
): string {
	const parts = [`${kind}`, `path=${path}`];
	if (extra) {
		for (const [k, v] of Object.entries(extra)) parts.push(`${k}=${v}`);
	}
	return parts.join(" ");
}

interface DiagnosticsHost {
	app: App;
	registerEvent(ref: unknown): void;
	settings: { diagnosticMode: boolean };
}

export function registerDiagnostics(plugin: DiagnosticsHost): void {
	const on = () => plugin.settings.diagnosticMode;
	const emit = (kind: EventKind, path: string, extra?: Record<string, string | number>) => {
		if (!on()) return;
		rlog().diag("vault", formatVaultEvent(kind, path, extra));
	};

	plugin.registerEvent(
		plugin.app.vault.on("modify", (file) => {
			if (file instanceof TFile) emit("modify", file.path, { bytes: file.stat.size });
		}),
	);
	plugin.registerEvent(
		plugin.app.vault.on("create", (file) => {
			if (file instanceof TFile) emit("create", file.path, { bytes: file.stat.size });
		}),
	);
	plugin.registerEvent(
		plugin.app.vault.on("delete", (file) => {
			emit("delete", file.path, { kind: file instanceof TFolder ? "folder" : "file" });
		}),
	);
	plugin.registerEvent(
		plugin.app.vault.on("rename", (file, oldPath) => {
			emit("rename", file.path, { from: oldPath });
		}),
	);
	plugin.registerEvent(
		plugin.app.workspace.on("file-open", (file) => {
			if (file instanceof TFile) emit("file-open", file.path);
		}),
	);
	plugin.registerEvent(
		plugin.app.workspace.on("active-leaf-change", () => {
			const file = plugin.app.workspace.getActiveFile();
			if (file instanceof TFile) emit("leaf-change", file.path);
		}),
	);
}
