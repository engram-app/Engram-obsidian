import type { Dict } from "..";

// Deutsch
const de: Dict = {
	"Code copied!": "Code kopiert.",
	"Engram sync: syncing...": "Engram Sync: synchronisiert …",
	"Engram Sync: pulled {pulled}, pushed {pushed}":
		"Engram Sync: {pulled} geladen, {pushed} gesendet",
	"Engram: disconnected. Open Engram settings to reconnect.":
		"Engram: Verbindung getrennt. Öffne Engram settings, um sie neu aufzubauen.",
	"Engram sync: checking...": "Engram Sync: prüft …",
	"Engram sync: everything in sync": "Engram Sync: alles synchron",
	"Engram sync: pulling all from server...": "Engram Sync: lädt alles vom Server …",
	"Engram Sync: pushed {pushed}": "Engram Sync: {pushed} gesendet",
	"Engram sync: sync failed": "Engram Sync: Synchronisierung fehlgeschlagen",
	"Engram: your login expired — open Engram settings to reconnect.":
		"Engram: deine Anmeldung ist abgelaufen. Öffne Engram settings, um dich neu zu verbinden.",
	"Engram: This vault has been deleted on the server.":
		"Engram: Dieser Vault wurde auf dem Server gelöscht.",
	"Engram Sync: pulled {pulled} (local extras deleted)":
		"Engram Sync: {pulled} geladen (überzählige lokale Dateien gelöscht)",
	"Engram Sync: pulled {pulled}": "Engram Sync: {pulled} geladen",
	"Engram Sync: replaced remote with local ({pushed} uploaded)":
		"Engram Sync: Server durch lokalen Stand ersetzt ({pushed} hochgeladen)",
	"Engram: sync failed. Open the sync log for details.":
		"Engram: Synchronisierung fehlgeschlagen. Details stehen im Sync-Protokoll.",
	"Engram unreachable. Showing matches from this device only.":
		"Engram nicht erreichbar. Es werden nur Treffer von diesem Gerät gezeigt.",
	"No source path for this result": "Zu diesem Treffer gibt es keinen Quellpfad",
	"Note not synced locally": "Diese Notiz ist lokal noch nicht synchronisiert",
	"Engram: settings tab failed to render ({error})":
		"Engram: Der Einstellungs-Tab konnte nicht dargestellt werden ({error})",
	"File not found locally: {path}": "Datei lokal nicht gefunden: {path}",
	"Restored {path} — will sync on next push.":
		"{path} wiederhergestellt, wird beim nächsten Senden synchronisiert.",
	"Ignored {path} — won't sync until restored from Sync Center.":
		"{path} ignoriert, wird erst synchronisiert, wenn du es im Sync Center wiederherstellst.",
	"Added {pattern} to ignore patterns": "{pattern} zu den Ignorier-Mustern hinzugefügt",
	"Engram backend changed — sign in again to continue.":
		"Engram-Backend geändert. Melde dich neu an, um weiterzumachen.",
	"Engram: sign-in failed ({error})": "Engram: Anmeldung fehlgeschlagen ({error})",
	"Enter an API key first": "Gib zuerst einen API-Schlüssel ein",
	"Switched to {mode}.": "Zu {mode} gewechselt.",

	"Engram Sync: pushed {count} files": {
		one: "Engram Sync: {count} Datei gesendet",
		other: "Engram Sync: {count} Dateien gesendet",
	},
	"Engram Sync: pulled {count} files from server": {
		one: "Engram Sync: {count} Datei vom Server geladen",
		other: "Engram Sync: {count} Dateien vom Server geladen",
	},
	"Engram Sync: pulled {count} changes": {
		one: "Engram Sync: {count} Änderung geladen",
		other: "Engram Sync: {count} Änderungen geladen",
	},
	"Engram: {count} files failed to sync{detail} — open Sync Center": {
		one: "Engram: {count} Datei konnte nicht synchronisiert werden{detail}. Öffne das Sync Center",
		other: "Engram: {count} Dateien konnten nicht synchronisiert werden{detail}. Öffne das Sync Center",
	},
	"Engram: {count} attachments skipped — upgrade to sync images & PDFs.": {
		one: "Engram: {count} Anhang übersprungen. Für Bilder und PDFs brauchst du ein Upgrade.",
		other: "Engram: {count} Anhänge übersprungen. Für Bilder und PDFs brauchst du ein Upgrade.",
	},
	"Engram: plan upgraded — syncing {count} attachments…": {
		one: "Engram: Tarif erweitert, {count} Anhang wird synchronisiert …",
		other: "Engram: Tarif erweitert, {count} Anhänge werden synchronisiert …",
	},
	// 402 limit reasons (limit-copy.ts). These gate payment, so they are the
	// highest-value strings in the plugin to get right.
	"Note limit reached. Upgrade to keep adding notes.":
		"Notizgrenze erreicht. Mit einem Upgrade kannst du weiter Notizen anlegen.",
	"Vault limit reached. Upgrade for more vaults.":
		"Vault-Grenze erreicht. Ein Upgrade bringt mehr Vaults.",
	"This file type isn't accepted by this server.":
		"Dieser Server nimmt diesen Dateityp nicht an.",
	"Attachment sync is disabled for this account.":
		"Für dieses Konto ist die Anhang-Synchronisierung deaktiviert.",
	"Attachment storage is full — upgrade for more.":
		"Der Speicher für Anhänge ist voll. Ein Upgrade bringt mehr Platz.",
	"File too large for your plan.": "Die Datei ist für deinen Tarif zu groß.",
	"Already signed in on another device. Upgrade for multi-device.":
		"Du bist bereits auf einem anderen Gerät angemeldet. Ein Upgrade erlaubt mehrere Geräte.",
	"Device swap cooldown active. Wait or upgrade.":
		"Gerätewechsel ist noch gesperrt. Warte kurz oder mach ein Upgrade.",
	"Too many connected Obsidian vaults. Disconnect one or upgrade.":
		"Zu viele verbundene Obsidian-Vaults. Trenne eines oder mach ein Upgrade.",
	"Too many connected AI clients. Disconnect one or upgrade.":
		"Zu viele verbundene KI-Clients. Trenne einen oder mach ein Upgrade.",
	"Daily AI search limit reached. Free includes 20 per day across Obsidian, the web app and MCP. Upgrade for unlimited.":
		"Tagesgrenze für KI-Suchen erreicht. Kostenlos sind 20 pro Tag über Obsidian, Web-App und MCP zusammen. Ein Upgrade hebt die Grenze auf.",
	"API keys need Pro. Sign in with your Engram account instead.":
		"API-Schlüssel brauchen Pro. Melde dich stattdessen mit deinem Engram-Konto an.",
	"Account suspended. Contact support.": "Konto gesperrt. Wende dich an den Support.",
	"Account setup incomplete.": "Die Kontoeinrichtung ist noch nicht fertig.",
	"This account was deleted. Contact support if that is wrong.":
		"Dieses Konto wurde gelöscht. Wenn das nicht stimmt, wende dich an den Support.",
	"Finish setting up your account at app.engram.page to start syncing.":
		"Richte dein Konto auf app.engram.page fertig ein, um mit dem Synchronisieren zu beginnen.",
	"Limit reached. Upgrade to continue.": "Grenze erreicht. Mit einem Upgrade geht es weiter.",
};

export default de;
