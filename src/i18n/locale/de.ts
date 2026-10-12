import type { Dict } from "..";

// Deutsch
const de: Dict = {
	"Invalid API key": "Ungültiger API-Schlüssel",
	"Request failed ({status})": "Anfrage fehlgeschlagen ({status})",
	"Connection failed": "Verbindung fehlgeschlagen",
	"Link Obsidian to Engram": "Verbinde Obsidian mit Engram",
	"Starting...": "Starte...",
	"Failed to start device flow. Check your Engram URL and try again.":
		"Fehler beim Start des Geräte-Flows. Überprüfe deine Engram-URL und versuche es erneut.",
	"Your code:": "Dein Code:",
	"Click to copy": "Zum Kopieren klicken",
	"Code copied!": "Code kopiert!",
	"A browser window has opened. Sign in and enter this code to link your vault.":
		"Ein Browserfenster wurde geöffnet. Melde dich an und gib diesen Code ein, um dein Vault zu verknüpfen.",
	Cancel: "Abbrechen",
	"Waiting for authorization — connected, this will complete instantly.":
		"Warte auf Autorisierung — verbunden, dies dauert nur einen Moment.",
	"Waiting for authorization — no live connection, checking every 30s.":
		"Warte auf Autorisierung — keine aktive Verbindung, Überprüfung alle 30 Sekunden.",
	"Code expired. Please try again.": "Code abgelaufen. Bitte versuche es erneut.",
	"Try again": "Nochmal versuchen",
	Close: "Schließen",
	"Note couldn't be processed": "Notiz konnte nicht verarbeitet werden",
	"The server couldn't process this note. Check its contents, then edit and save to try again.":
		"Der Server konnte diese Notiz nicht verarbeiten. Überprüfe den Inhalt, bearbeite sie und speichere sie, um es erneut zu versuchen.",
	"Attachments need a paid plan": "Anhänge benötigen ein kostenpflichtiges Abonnement",
	"The Free tier syncs notes only. Upgrade to sync images and PDFs.":
		"Die kostenlose Version synchronisiert nur Notizen. Upgrade, um auch Bilder und PDFs zu synchronisieren.",
	"Attachment storage full": "Speicherplatz für Anhänge voll",
	"You've used all the attachment storage on your plan. Upgrade for more.":
		"Du hast den gesamten Speicherplatz für Anhänge in deinem Abonnement genutzt. Upgrade für mehr Speicher.",
	"Too large for the server": "Zu groß für den Server",
	"The server limit is 5 MB. Compress or split the file, then it will sync.":
		"Die Server-Grenze beträgt 5 MB. Komprimiere oder teile die Datei, dann wird sie synchronisiert.",
	"Sign-in expired": "Anmeldung abgelaufen",
	"Reconnect your account to resume syncing.":
		"Verbinde dein Konto neu, dann läuft die Synchronisierung weiter.",
	"Unresolved conflict": "Konflikt konnte nicht gelöst werden",
	"Open the file to resolve the conflict, then sync again.":
		"Öffne die Datei, um den Konflikt zu beheben, und synchronisiere dann erneut.",
	"Frontmatter needs a fix": "Frontmatter benötigt eine Korrektur",
	"The note synced, but its frontmatter could not be fully parsed. Open it to fix the highlighted line.":
		"Die Notiz wurde synchronisiert, aber ihr Frontmatter konnte nicht vollständig analysiert werden. Öffne sie, um die hervorgehobene Zeile zu korrigieren.",
	"Server error": "Serverfehler",
	"A temporary server problem — retrying automatically.":
		"Ein vorübergehendes Serverproblem – wird automatisch erneut versucht.",
	"Network unavailable": "Netzwerk nicht verfügbar",
	"Can't reach the server — retrying automatically.":
		"Verbindung zum Server konnte nicht hergestellt werden – wird automatisch erneut versucht.",
	"Sync failed": "Synchronisierung fehlgeschlagen",
	"An unexpected error — retrying automatically.":
		"Ein unerwarteter Fehler – wird automatisch erneut versucht.",
	"Frontmatter could not be parsed": "Frontmatter konnte nicht analysiert werden",
	"Note limit reached. Upgrade to keep adding notes.":
		"Notizen-Limit erreicht. Upgrade, um weitere Notizen hinzufügen zu können.",
	"Vault limit reached. Upgrade for more vaults.":
		"Vault-Limit erreicht. Upgrade für mehr Vaults.",
	"This file type isn't accepted by this server.":
		"Dieser Dateityp wird von diesem Server nicht akzeptiert.",
	"Attachment sync is disabled for this account.":
		"Die Synchronisierung von Anhängen ist für dieses Konto deaktiviert.",
	"Attachment storage is full — upgrade for more.":
		"Der Speicher für Anhänge ist voll — upgrade für mehr Speicher.",
	"File too large for your plan.": "Datei ist zu groß für dein Abo.",
	"Already signed in on another device. Upgrade for multi-device.":
		"Du bist bereits auf einem anderen Gerät angemeldet. Upgrade für mehrere Geräte.",
	"Device swap cooldown active. Wait or upgrade.": "Geräteschaltzeit aktiv. Warte oder upgrade.",
	"Too many connected Obsidian vaults. Disconnect one or upgrade.":
		"Zu viele verbundene Obsidian-Vaults. Trenne eine oder upgrade.",
	"Too many connected AI clients. Disconnect one or upgrade.":
		"Zu viele verbundene KI-Clients. Trenne einen oder upgrade.",
	"Daily AI search limit reached. Free includes 20 per day across Obsidian, the web app and MCP. Upgrade for unlimited.":
		"Tägliches Limit für KI-Suchen erreicht. Das kostenlose Abo beinhaltet 20 Suchen pro Tag für Obsidian, die Web-App und MCP. Upgrade für unbegrenzte Suchen.",
	"API keys need Pro. Sign in with your Engram account instead.":
		"API-Schlüssel benötigen Pro. Melde dich stattdessen mit deinem Engram-Konto an.",
	"Account suspended. Contact support.": "Konto gesperrt. Kontaktiere den Support.",
	"Account setup incomplete.": "Kontoeinrichtung nicht abgeschlossen.",
	"This account was deleted. Contact support if that is wrong.":
		"Dieses Konto wurde gelöscht. Kontaktiere den Support, falls das falsch ist.",
	"Finish setting up your account at app.engram.page to start syncing.":
		"Schließe die Einrichtung deines Kontos unter app.engram.page ab, um mit der Synchronisierung zu beginnen.",
	"Limit reached. Upgrade to continue.": "Limit erreicht. Upgrade erforderlich, um fortzufahren.",
	Upgrade: "Upgrade",
	"Update in settings": "In den Einstellungen aktualisieren",
	"Sync now": "Jetzt synchronisieren",
	"Engram sync: syncing...": "Engram-Synchronisierung: Synchronisiert...",
	"Engram Sync: pulled {pulled}, pushed {pushed}":
		"Engram-Synchronisierung: {pulled} heruntergeladen, {pushed} hochgeladen",
	"Disconnect (clear login)": "Verbindung trennen (Login löschen)",
	"Engram: disconnected. Open Engram settings to reconnect.":
		"Engram: Verbindung getrennt. Öffne die Engram-Einstellungen, um die Verbindung wiederherzustellen.",
	"Push entire vault": "Gesamten Vault synchronisieren",
	"Engram Sync: pushed {count} files": {
		one: "Engram Sync: {count} Datei hochgeladen",
		other: "Engram Sync: {count} Dateien hochgeladen",
	},
	"Check sync status": "Synchronisierungsstatus prüfen",
	"Engram sync: checking...": "Engram-Synchronisierung: Überprüfe...",
	"Engram sync: server does not support reconciliation (update backend)":
		"Engram-Synchronisierung: Der Server unterstützt keine Synchronisation (Backend aktualisieren)",
	"Engram sync: everything in sync": "Engram-Synchronisierung: Alles ist synchron",
	"{count} missing on server": {
		one: "{count} fehlt auf dem Server",
		other: "{count} fehlen auf dem Server",
	},
	"{count} diverged": { one: "{count} abweichend", other: "{count} abweichend" },
	"{count} only on server": {
		one: "{count} nur auf dem Server",
		other: "{count} nur auf dem Server",
	},
	"Engram Sync: {details}": "Engram-Synchronisierung: {details}",
	"Pull all from server (force overwrite)":
		"Alles vom Server herunterladen (erzwungene Überschreibung)",
	"Engram sync: pulling all from server...":
		"Engram-Synchronisierung: Lade alles vom Server herunter...",
	"Engram Sync: pulled {count} files from server": {
		one: "Engram Sync: {count} Datei vom Server heruntergeladen",
		other: "Engram Sync: {count} Dateien vom Server heruntergeladen",
	},
	"Show sync log": "Synchronisationsprotokoll anzeigen",
	"Send feedback": "Feedback senden",
	"Semantic search": "Semantische Suche",
	"Open search sidebar": "Suchleiste öffnen",
	"Engram search": "Engram-Suche",
	"Open sync center": "Sync-Zentrale öffnen",
	"Engram: ready": "Engram: bereit",
	"Engram Sync: pushed {pushed}": "Engram Sync: hochgeladen {pushed}",
	"Engram sync: sync failed": "Engram-Synchronisierung: Fehler",
	"Engram: this vault no longer exists on the server. Pick or create a vault to continue.":
		"Engram: Dieses Vault existiert nicht mehr auf dem Server. Wähle ein Vault aus oder erstelle eines, um fortzufahren.",
	"Engram: recovered plugin settings from a backup after a corrupted save.":
		"Engram: Plugin-Einstellungen aus einer Sicherung wiederhergestellt.",
	"Engram: plugin settings file was corrupted and could not be recovered. You may need to reconnect in settings.":
		"Engram: Die Plugin-Einstellungsdatei ist beschädigt und konnte nicht wiederhergestellt werden. Möglicherweise musst du die Verbindung in den Einstellungen neu herstellen.",
	"Engram: your login expired — open Engram settings to reconnect.":
		"Engram: Deine Anmeldung ist abgelaufen – öffne die Engram-Einstellungen, um die Verbindung wiederherzustellen.",
	"Engram: This vault has been deleted on the server.":
		"Engram: Dieses Vault wurde auf dem Server gelöscht.",
	"Engram sync: live sync requires a plugin update — please update the Engram vault sync plugin.":
		"Engram-Synchronisierung: Live-Synchronisierung erfordert ein Plugin-Update – bitte aktualisiere das Engram-Vault-Sync-Plugin.",
	"Engram Sync: pulled {pulled} (local extras deleted)":
		"Engram Sync: heruntergeladen {pulled} (lokale Extras gelöscht)",
	"Engram Sync: pulled {pulled}": "Engram Sync: heruntergeladen {pulled}",
	"Engram Sync: replaced remote with local ({pushed} uploaded)":
		"Engram Sync: Remote durch lokale Version ersetzt ({pushed} hochgeladen)",
	"Engram: sync is not set up yet, so nothing in this vault will sync.":
		"Engram: Die Synchronisierung ist noch nicht eingerichtet, daher werden keine Notizen in diesem Vault synchronisiert.",
	"Finish sync setup": "Synchronisierung einrichten",
	"Engram: sync is paused. This edit was not synced. Choose a sync direction to resume.":
		"Engram: Synchronisierung angehalten. Diese Änderung wurde nicht synchronisiert. Wähle eine Synchronisationsrichtung, um fortzufahren.",
	"Open Engram settings": "Engram-Einstellungen öffnen",
	"Engram: sync failed. Open the sync log for details.":
		"Engram: Synchronisierung fehlgeschlagen. Öffne das Synchronisierungsprotokoll für Details.",
	"Engram: not connected": "Engram: Keine Verbindung",
	"Engram: signed out": "Engram: Abgemeldet",
	"Not connected yet. Click to open settings and link this vault.":
		"Noch keine Verbindung. Klicke, um die Einstellungen zu öffnen und dieses Vault zu verknüpfen.",
	"Not signed in. Click to open settings and reconnect.":
		"Noch nicht angemeldet. Klicke, um die Einstellungen zu öffnen und dich erneut zu verbinden.",
	"Engram: finish setup": "Engram: Einrichtung abschließen",
	"Engram: sync paused": "Engram: Synchronisierung angehalten",
	"{label} ({count} queued)": {
		one: "{label} ({count} in der Warteschlange)",
		other: "{label} ({count} in der Warteschlange)",
	},
	"Setup is not finished — nothing will sync until you choose a sync direction. Click to finish.":
		"Einrichtung nicht abgeschlossen — nichts wird synchronisiert, bis du eine Synchronisationsrichtung wählst. Klicke, um fortzufahren.",
	"Sync paused — click to choose a sync direction":
		"Synchronisierung angehalten – klicke, um eine Synchronisationsrichtung auszuwählen",
	"Engram: offline ({count} queued)": {
		one: "Engram: offline ({count} in der Warteschlange)",
		other: "Engram: offline ({count} in der Warteschlange)",
	},
	"Engram: offline": "Engram: offline",
	"Server unreachable — changes will sync when connected":
		"Server nicht erreichbar – Änderungen werden synchronisiert, sobald eine Verbindung besteht",
	"Engram: error": "Engram: Fehler",
	"Unknown error": "Unbekannter Fehler",
	"Engram: syncing ({count})": "Engram: Synchronisieren ({count})",
	"Engram: syncing": "Engram: Synchronisieren",
	"Sync in progress...": "Synchronisierung läuft...",
	"Engram: pending ({count})": "Engram: Ausstehend ({count})",
	"{count} files queued": {
		one: "{count} Datei in der Warteschlange",
		other: "{count} Dateien in der Warteschlange",
	},
	"Engram: live": "Engram: aktiv",
	"WebSocket connected — live sync active": "WebSocket verbunden – Live-Synchronisierung aktiv",
	"Click to sync": "Zum Synchronisieren klicken",
	"Engram: ⚠ {count} sync errors": {
		one: "Engram: ⚠ {count} Synchronisierungsfehler",
		other: "Engram: ⚠ {count} Synchronisierungsfehler",
	},
	"Last sync: {when}": "Letzte Synchronisierung: {when}",
	"Engram Sync: pulled {count} changes": {
		one: "Engram Sync: {count} Änderung synchronisiert",
		other: "Engram Sync: {count} Änderungen wurden übertragen",
	},
	'Engram Sync: sync state for "{name}" was unreadable — using the on-disk copy.':
		'Engram Sync: Der Synchronisierungsstatus für "{name}" konnte nicht gelesen werden – es wird die lokale Kopie verwendet.',
	"Engram Vault Sync {version} is available. {link}.":
		"Engram Vault Sync {version} verfügbar. {link}.",
	"{count} files": { one: "{count} Datei", other: "{count} Dateien" },
	"Notes searchable": "Notizen durchsuchbar",
	"Notes past this still sync and open normally, they are just not in the search index. The index keeps your oldest notes, so it is your newest ones that fall outside.":
		"Notizen nach diesem Punkt werden weiterhin synchronisiert und normal geöffnet, sie sind nur nicht im Suchindex enthalten. Der Index speichert deine ältesten Notizen, sodass die neuesten Notizen nicht enthalten sind.",
	"Notes stored": "Notizen gespeichert",
	Attachments: "Anhänge",
	"AI searches": "KI-Suchen",
	"{formatted} per day": "{formatted} pro Tag",
	Keyword: "Schlüsselwort",
	Semantic: "Semantisch",
	Both: "Beide",
	"matches your words and their other forms — 'run' finds 'running' — plus this device.":
		"findet deine Wörter und ihre anderen Formen – 'run' findet 'running' – plus dieses Gerät.",
	"matches meaning. Finds notes that never use the words you typed.":
		"findet die Bedeutung. Findet Notizen, die die eingegebenen Wörter nicht verwenden.",
	"matches words and meaning together, plus this device. Widest results.":
		"findet Wörter und Bedeutung zusammen, plus dieses Gerät. Umfassendste Ergebnisse.",
	"Engram indexes {indexed} of your {all} notes. The rest match on this device only. Upgrade to index everything.":
		"Engram indiziert {indexed} deiner {all} Notizen. Der Rest wird nur auf diesem Gerät gefunden. Upgrade, um alles zu indizieren.",
	"Searching {indexed} of {all} notes. Upgrade to search everything.":
		"Durchsucht {indexed} von {all} Notizen. Upgrade, um alles zu durchsuchen.",
	"Search your vault…": "Suche in deinem Vault…",
	"Clear search": "Suche löschen",
	"Search settings": "Such-Einstellungen",
	"Filter by folder…": "Nach Ordner filtern…",
	"Filter by tags…": "Nach Tags filtern…",
	"Remove tag {tag}": "Tag {tag} entfernen",
	"Engram unreachable. Showing matches from this device only.":
		"Engram nicht erreichbar. Zeigt nur Ergebnisse von diesem Gerät.",
	"Search failed — check connection": "Suche fehlgeschlagen – Verbindung prüfen",
	"No results found": "Keine Ergebnisse gefunden",
	Untitled: "Ohne Titel",
	exact: "exakt",
	"meaning + exact": "Bedeutung + exakt",
	meaning: "Bedeutung",
	"match strength: {pct}%": "Übereinstimmungsstärke: {pct}%",
	"No source path for this result": "Kein Quellpfad für dieses Ergebnis",
	"Note not synced locally": "Notiz nicht lokal synchronisiert",
	"Syncing...": "Synchronisieren...",
	"👋 Welcome": "👋 Willkommen",
	"🔌 Connection": "🔌 Verbindung",
	"🔄 Sync Center": "🔄 Sync-Zentrale",
	"⚙️ Advanced": "⚙️ Erweitert",
	"💬 Feedback": "💬 Feedback",
	"Engram: settings tab failed to render ({error})":
		"Engram: Einstellungstab konnte nicht geladen werden ({error})",
	Disconnected: "Getrennt",
	"Error: {error}": "Fehler: {error}",
	unknown: "unbekannt",
	"Connected — waiting for first sync decision":
		"Verbunden — wartet auf die erste Synchronisierungsentscheidung",
	"Connected — live sync active": "Verbunden — Live-Synchronisierung aktiv",
	"Connected — polling": "Verbunden — Abfrage läuft",
	"Not configured": "Nicht konfiguriert",
	"Open sync setup": "Synchronisierung einrichten",
	"Sync log": "Synchronisierungs-Protokoll",
	"Showing {count} entries": { one: "Zeigt {count} Eintrag", other: "Zeigt {count} Einträge" },
	"No sync activity this session.": "Keine Synchronisierungsaktivität in dieser Sitzung.",
	"({count} errors)": { one: "({count} Fehler)", other: "({count} Fehler)" },
	"Could not compare with the cloud. Check your connection.":
		"Vergleich mit der Cloud fehlgeschlagen. Überprüfe deine Verbindung.",
	"Your login expired. Sign in again in Engram settings to continue.":
		"Dein Login ist abgelaufen. Melde dich erneut in den Engram-Einstellungen an, um fortzufahren.",
	"Couldn't create vault — the name may be invalid or already in use.":
		"Vault konnte nicht erstellt werden – der Name ist möglicherweise ungültig oder bereits verwendet.",
	"Could not create the vault — check your connection and try again.":
		"Vault konnte nicht erstellt werden – überprüfe deine Verbindung und versuche es erneut.",
	"Free syncs notes only — {count} attachments will be skipped.": {
		one: "Kostenlose Synchronisierung gilt nur für Notizen – {count} Anhang wird übersprungen.",
		other: "Kostenlose Synchronisierung gilt nur für Notizen – {count} Anhänge werden übersprungen.",
	},
	"Uploads {up}, downloads {down}.": "Hochgeladen: {up}, heruntergeladen: {down}.",
	"Uploads {count}.": { one: "Uploads {count}.", other: "Uploads {count}." },
	"Downloads {count}.": { one: "Downloads {count}.", other: "Downloads {count}." },
	"{count} conflicts to resolve.": {
		one: "{count} Konflikt, der behoben werden muss.",
		other: "{count} Konflikte müssen gelöst werden.",
	},
	"Safe choice: combines both sides, nothing is deleted.":
		"Sichere Wahl: Kombiniert beide Seiten, nichts wird gelöscht.",
	"Nothing is deleted.": "Nichts wird gelöscht.",
	"Already in sync. Nothing is deleted.": "Bereits synchronisiert. Nichts wird gelöscht.",
	"Delete all {count} files currently on the server": {
		one: "Lösche alle {count} Dateien, die sich aktuell auf dem Server befinden",
		other: "Lösche alle {count} Dateien, die sich aktuell auf dem Server befinden",
	},
	"Upload {count} files from this vault": {
		one: "Lade {count} Datei von diesem Vault hoch",
		other: "Lade {count} Dateien von diesem Vault hoch",
	},
	"Delete all {count} files in this vault": {
		one: "Lösche alle {count} Datei in diesem Vault",
		other: "Lösche alle {count} Dateien in diesem Vault",
	},
	"Download {count} files from the server": {
		one: "Lade {count} Datei vom Server herunter",
		other: "Lade {count} Dateien vom Server herunter",
	},
	Sync: "Synchronisieren",
	"Upload local files without downloading the remote":
		"Lade lokale Dateien hoch, ohne die Remote-Dateien herunterzuladen",
	"Delete all on remote, then upload local files":
		"Lösche alle Dateien auf dem Remote-Server und lade dann die lokalen Dateien hoch",
	"Download remote files without uploading the local":
		"Lade Remote-Dateien herunter, ohne die lokalen Dateien hochzuladen",
	"Delete all local files, then download from remote":
		"Lösche alle lokalen Dateien und lade sie dann von der Ferne herunter",
	"Set up sync for this vault": "Synchronisierung für diesen Vault einrichten",
	"You are now pointing at a different cloud vault":
		"Du zeigst jetzt auf einen anderen Cloud-Vault",
	"Sync preview": "Synchronisierungsvorschau",
	"Nothing to sync yet — this vault is empty on both sides. Start syncing and everything you write appears on your other devices.":
		"Noch nichts zu synchronisieren – dieser Vault ist auf beiden Seiten leer. Starte die Synchronisierung, und alles, was du schreibst, erscheint auf deinen anderen Geräten.",
	"Start syncing": "Synchronisierung starten",
	"{count} notes": { one: "{count} Notiz", other: "{count} Notizen" },
	"{count} attachments": { one: "{count} Anhang", other: "{count} Anhänge" },
	"{first} and {second}": "{first} und {second}",
	files: "Dateien",
	"This vault is empty on the server. Upload your {what}?":
		"Dieser Vault ist auf dem Server leer. Möchtest du deine {what} hochladen?",
	"Upload everything": "Alles hochladen",
	"Nothing will be removed from this device.": "Nichts wird von diesem Gerät entfernt.",
	"This device's vault is empty. Download {what} from the server?":
		"Der Vault dieses Geräts ist leer. Möchtest du {what} vom Server herunterladen?",
	"Download everything": "Alles herunterladen",
	Done: "Fertig",
	"Send debug logs. Note content stays private.":
		"Debug-Protokolle senden. Der Inhalt deiner Notizen bleibt privat.",
	"Comparing your vault with the cloud…": "Dein Vault wird mit dem Cloud-Server verglichen…",
	"Not now": "Nicht jetzt",
	"Change vault": "Vault ändern",
	"Advanced sync options": "Erweiterte Synchronisierungsoptionen",
	"Everything is in sync": "Alles ist synchronisiert",
	"This vault": "Dieser Vault",
	"Cloud server": "Cloud-Server",
	notes: "Notizen",
	attachments: "Anhänge",
	folders: "Ordner",
	"Confirm destructive sync": "Destruktive Synchronisierung bestätigen",
	"You are about to:": "Du wirst folgendes tun:",
	"Files that will be deleted:": "Dateien, die gelöscht werden:",
	"This cannot be undone.": "Das kann nicht rückgängig gemacht werden.",
	Back: "Zurück",
	Confirm: "Bestätigen",
	"Switch vault": "Vault wechseln",
	"Pick a vault to sync with. We will recalculate the sync preview after you choose.":
		"Wähle einen Vault aus, mit dem du synchronisieren möchtest. Wir berechnen dann die Synchronisierungs-Vorschau neu.",
	"Loading vaults…": "Lade Vaults…",
	" (default)": " (Standard)",
	"No other vaults available.": "Keine anderen Vaults verfügbar.",
	"Make new vault": "Neuen Vault erstellen",
	"New vault": "Neues Vault",
	"Create a new empty vault on the server, then sync this Obsidian vault into it.":
		"Erstelle ein neues, leeres Vault auf dem Server und synchronisiere dann dieses Obsidian-Vault damit.",
	"Vault name": "Vault-Name",
	Create: "Erstellen",
	"Could not load vaults: {error}": "Vaults konnten nicht geladen werden: {error}",
	"Enter a name for the new vault": "Gib einen Namen für das neue Vault ein",
	"Failed to switch vault: {error}": "Fehler beim Wechsel des Vaults: {error}",
	"Your vault shares {percent} of its data with Engram":
		"Dein Vault teilt {percent} seiner Daten mit Engram",
	"{count} conflicts need resolution": {
		one: "{count} Konflikt muss gelöst werden",
		other: "{count} Konflikte müssen gelöst werden",
	},
	"Type {keyword} to confirm:": "Gib {keyword} ein, um zu bestätigen:",
	"Uploading {count}.": { one: "Hochladen {count}.", other: "Hochladen {count}." },
	"Downloading {count}.": { one: "Herunterladen {count}.", other: "Herunterladen {count}." },
	"Deleting {count} local files.": {
		one: "{count} lokale Datei wird gelöscht.",
		other: "{count} lokale Dateien werden gelöscht.",
	},
	"Deleting {count} on the cloud.": {
		one: "{count} wird im Cloud-Speicher gelöscht.",
		other: "{count} werden im Cloud-Speicher gelöscht.",
	},
	"First sync, this may take a moment.": "Erste Synchronisierung, das kann einen Moment dauern.",
	"Checking for changes.": "Überprüfe auf Änderungen.",
	"Nothing will be deleted.": "Nichts wird gelöscht.",
	"✓ {count} synced": { one: "✓ {count} synchronisiert", other: "✓ {count} synchronisiert" },
	"⤳ {count} skipped (Free plan)": {
		one: "⤳ {count} übersprungen (kostenlose Version)",
		other: "⤳ {count} übersprungen (Kostenlose Version)",
	},
	"✕ {count} failed": { one: "✕ {count} fehlgeschlagen", other: "✕ {count} fehlgeschlagen" },
	"{count} attachments need a paid plan to sync. See Sync Center.": {
		one: "{count} Anhang benötigt ein kostenpflichtiges Abo, um synchronisiert zu werden. Siehe Sync-Zentrale.",
		other: "{count} Anhänge benötigen ein kostenpflichtiges Abo, um synchronisiert zu werden. Siehe Sync-Zentrale.",
	},
	"Finished with some errors. Open the sync log to see what failed.":
		"Beendet mit Fehlern. Öffne das Synchronprotokoll, um zu sehen, was fehlgeschlagen ist.",
	"Synced. Some attachments need a paid plan to sync (see below).":
		"Synchronisiert. Einige Anhänge benötigen ein kostenpflichtiges Abonnement, um synchronisiert zu werden (siehe unten).",
	"All synced. Your vault and the cloud now match.":
		"Alles synchronisiert. Dein Vault und die Cloud sind jetzt identisch.",
	"Already up to date. Nothing needed syncing.":
		"Bereits auf dem neuesten Stand. Nichts musste synchronisiert werden.",
	Deleting: "Löschen",
	Downloading: "Herunterladen",
	Uploading: "Hochladen",
	"Syncing your vault": "Synchronisiere dein Vault",
	"Getting started…": "Starte…",
	"Open Engram to check your vault and confirm everything synced.":
		"Öffne Engram, um dein Vault zu prüfen und sicherzustellen, dass alles synchronisiert wurde.",
	"Open Engram": "Engram öffnen",
	"You can close this and the sync keeps running in the background.":
		"Du kannst das Fenster schließen, die Synchronisierung läuft im Hintergrund weiter.",
	"Run in background": "Im Hintergrund ausführen",
	"Syncing…": "Synchronisieren…",
	"Sync complete": "Synchronisierung abgeschlossen",
	"Syncing attachments": "Anhänge synchronisieren",
	Complete: "Fertig",
	'{count} failed. Run "{command}" for details.': {
		one: '{count} fehlgeschlagen. Starte "{command}", um Details zu sehen.',
		other: '{count} fehlgeschlagen. Starte "{command}", um Details zu sehen.',
	},
	"File exceeds the {limit} limit": "Datei überschreitet das Limit von {limit}",
	"Free syncs notes only — images & PDFs need a paid plan.":
		"Kostenlose Synchronisierung gilt nur für Notizen – Bilder und PDFs benötigen ein kostenpflichtiges Abonnement.",
	"Engram: {count} files failed to sync{detail} — open Sync Center": {
		one: "Engram: {count} Datei konnte nicht synchronisiert werden{detail} — Öffne die Sync-Zentrale",
		other: "Engram: {count} Dateien konnten nicht synchronisiert werden{detail} – Sync-Zentrale öffnen",
	},
	"Engram: {count} attachments skipped — upgrade to sync images & PDFs.": {
		one: "Engram: {count} Anhang übersprungen – Upgrade erforderlich, um Bilder und PDFs zu synchronisieren.",
		other: "Engram: {count} Anhänge übersprungen – Upgrade erforderlich, um Bilder und PDFs zu synchronisieren.",
	},
	"Engram: plan upgraded — syncing {count} attachments…": {
		one: "Engram: Upgrade geplant — {count} Anhang wird synchronisiert…",
		other: "Engram: Upgrade geplant — {count} Anhänge werden synchronisiert…",
	},
	"Pull all (delete extras) aborted: could not obtain an exclusive server snapshot (replay contention). Nothing was trashed.":
		"Abbrechen: Alle Notizen herunterladen (Extras löschen) fehlgeschlagen: konnte keinen exklusiven Server-Snapshot erhalten (Konflikt). Nichts wurde gelöscht.",
	"Pull all aborted: another sync is running (replay contention). Try again when it finishes.":
		"Abbrechen: Alle Notizen herunterladen fehlgeschlagen: eine andere Synchronisierung läuft (Konflikt). Versuche es später erneut.",
	"Pull all failed: {error}": "Fehler beim Herunterladen aller Notizen: {error}",
	"Engram: sync conflict on {path} — your local edit was saved as {copy}":
		"Engram: Synchronisierungskonflikt bei {path} – deine lokale Änderung wurde als {copy} gespeichert",
	"Open note": "Notiz öffnen",
	"Engram: {count} notes have frontmatter problems. Open Sync Center to fix.": {
		one: "Engram: {count} Notiz hat Probleme mit der Kopfzeile. Öffne die Sync-Zentrale, um das zu beheben.",
		other: "Engram: {count} Notizen haben Probleme mit der Frontmatter. Öffne die Sync-Zentrale, um sie zu beheben.",
	},
	'Engram Sync: renamed "{name}" (unsupported characters)':
		'Engram Sync: "{name}" umbenannt (nicht unterstützte Zeichen)',
	'Engram: frontmatter problem in "{name}"': 'Engram: Problem mit dem Frontmatter in "{name}"',
	"Engram: this plugin is too old to sync (needs {version} or newer). Update it to continue.":
		"Engram: Dieses Plugin ist zu alt, um synchronisiert zu werden (benötigt {version} oder neuer). Aktualisiere es, um fortzufahren.",
	"Engram: this plugin is too old to sync. Update it to continue.":
		"Engram: Dieses Plugin ist zu alt, um synchronisiert zu werden. Aktualisiere es, um fortzufahren.",
	Update: "Aktualisieren",
	"waiting for a connection": "wartet auf eine Verbindung",
	"sync is paused": "Synchronisierung pausiert",
	"syncing now": "Synchronisiert",
	"waiting to retry": "wartet auf Wiederholung",
	"{count} not on your plan": {
		one: "{count} nicht in deinem Plan",
		other: "{count} nicht in deinem Plan",
	},
	"{count} need attention": {
		one: "{count} Benötigt Aufmerksamkeit",
		other: "{count} erfordern deine Aufmerksamkeit",
	},
	"{count} retrying": { one: "{count}. Versuch erneut", other: "{count} Wiederholungsversuch" },
	"{count} ignored": { one: "{count} ignoriert", other: "{count} ignoriert" },
	"{count} queued — {reason}": {
		one: "{count} in der Warteschlange — {reason}",
		other: "{count} in der Warteschlange — {reason}",
	},
	"Sync...": "Synchronisieren...",
	Refresh: "Aktualisieren",
	"Not synced on your plan ({count})": "Nicht im Rahmen deines Plans synchronisiert ({count})",
	"These files are fine. They just need a paid plan to sync.":
		"Diese Dateien sind in Ordnung. Sie benötigen nur einen kostenpflichtigen Plan, um synchronisiert zu werden.",
	"Show files ({count}) ▾": "Dateien anzeigen ({count}) ▾",
	"Sync these now": "Jetzt synchronisieren",
	"Needs attention ({count})": "Benötigt Aufmerksamkeit ({count})",
	"Clear all": "Alles löschen",
	"Nothing needs your attention. 🎉": "Nichts erfordert deine Aufmerksamkeit. 🎉",
	Dismiss: "Abbrechen",
	"Retrying automatically ({count})": "Automatischer Wiederversuch ({count})",
	"Retry all now": "Alle jetzt wiederholen",
	"Temporary errors. These clear themselves once the server recovers.":
		"Temporäre Fehler. Diese werden automatisch behoben, sobald der Server wiederhergestellt ist.",
	"{count} attempts": { one: "{count} Versuch", other: "{count} Versuche" },
	Open: "Öffnen",
	Ignore: "Ignorieren",
	"Ignored ({count})": "Ignoriert ({count})",
	"No files ignored. Use the ignore button on a failure row to stop syncing it.":
		"Keine Dateien ignoriert. Verwende den Ignorier-Button in einer Zeile mit Fehlern, um die Synchronisierung zu stoppen.",
	Restore: "Wiederherstellen",
	"File not found locally: {path}": "Datei nicht lokal gefunden: {path}",
	"Ignored {path} — won't sync until restored from Sync Center.":
		"Ignoriert {path} – wird erst wieder synchronisiert, wenn du sie in der Sync-Zentrale wiederherstellst.",
	"Restored {path} — will sync on next push.":
		"{path} wiederhergestellt – wird beim nächsten Synchronisieren aktualisiert.",
	"Activity ({count})": "Aktivität ({count})",
	Clear: "Löschen",
	"No activity yet. Push or pull to see entries here.":
		'Noch keine Aktivitäten. Drücke "Push" oder "Pull", um Einträge anzuzeigen.',
	Pushed: "Gesendet",
	Pulled: "Empfangen",
	Deleted: "Gelöscht",
	Conflict: "Konflikt",
	Skipped: "Übersprungen",
	Error: "Fehler",
	Stats: "Statistiken",
	"Notes on this device": "Notizen auf diesem Gerät",
	"Attachments on this device": "Anhänge auf diesem Gerät",
	"Remote vault": "Remote-Vault",
	"not linked": "nicht verbunden",
	"Plan usage": "Nutzungsübersicht",
	"Node.js dependencies": "Node.js-Abhängigkeiten",
	"Python virtual environment": "Python-virtuelle Umgebung",
	"Python bytecode cache": "Python-Bytecode-Cache",
	"Vendored dependencies": "Integrierte Abhängigkeiten",
	"Gradle build cache": "Gradle-Build-Cache",
	"Rust/Java build output": "Rust/Java-Build-Ausgabe",
	"Build output": "Build-Ausgabe",
	"Next.js build output": "Next.js-Build-Ausgabe",
	"Distribution build output": "Distribution-Build-Ausgabe",
	"Cargo cache": "Cargo-Cache",
	"CocoaPods dependencies": "CocoaPods-Abhängigkeiten",
	"Dart tool cache": "Dart-Tool-Cache",
	"Generic cache directory": "Allgemeines Cache-Verzeichnis",
	"Ignore patterns": "Ignorier-Muster",
	"Custom patterns": "Benutzerdefinierte Muster",
	"Paths to skip (one per line). Folder patterns end with /. Built-in: {configDir}/, .trash/, .git/":
		"Pfade, die übersprungen werden sollen (einer pro Zeile). Ordnernamen enden mit /. Voreinstellungen: {configDir}/, .trash/, .git/",
	Diagnostics: "Diagnose",
	"Send detailed sync, vault, and connection activity to the server for troubleshooting, with distributed tracing on requests. Metadata only, never note content. Leave off for normal use.":
		"Sende detaillierte Synchronisierungs-, Vault- und Verbindungsaktivitäten an den Server zur Fehlerbehebung, mit verteiltem Tracing für Anfragen. Nur Metadaten, niemals Notizeninhalte. Deaktiviere dies für normalen Gebrauch.",
	"Diagnostics detail": "Diagnose-Details",
	"Minimum severity that ships while diagnostics are on. Higher levels send fewer lines. Default: Info.":
		"Minimale Schweregradstufe, die aktiv ist, während die Diagnose eingeschaltet ist. Höhere Stufen senden weniger Zeilen. Standard: Info.",
	"Errors only": "Nur Fehler",
	"Warnings and errors": "Warnungen und Fehler",
	"Info (default)": "Info (Standard)",
	"Debug (verbose)": "Debug (ausführlich)",
	About: "Über",
	"License: {name}": "Lizenz: {name}",
	"⚠ Detected: {label}/ ({formatted} files)": "⚠ Erkannt: {label} ({formatted} Dateien)",
	"{desc} — should not be synced": "{desc} — soll nicht synchronisiert werden",
	"Add to ignores": "Zu den Ignorier-Mustern hinzufügen",
	"Added {pattern} to ignore patterns": "{pattern} zu den Ignorier-Mustern hinzugefügt",
	"Version: {version}": "Version: {version}",
	"Source: {link}": "Quelle: {link}",
	"Engram URL": "Engram-URL",
	"✓ Engram server reachable (v{version})": "✓ Engram-Server erreichbar (v{version})",
	"✗ server responded but isn't an Engram backend":
		"✗ Der Server antwortete, ist aber kein Engram-Backend",
	"✗ couldn't reach a server at this URL": "✗ Kein Server unter dieser URL erreichbar",
	"Checking server…": "Server wird geprüft…",
	"That does not look like a complete server address. Include the scheme, for example http://127.0.0.1:4000":
		"Das sieht nicht nach einer vollständigen Serveradresse aus. Gib das Schema mit an, z.B. http://127.0.0.1:4000",
	"Engram backend changed — sign in again to continue.":
		"Engram-Backend wurde geändert – melde dich erneut an, um fortzufahren.",
	Authentication: "Authentifizierung",
	"Signed in as {email}": "Angemeldet als {email}",
	"Authenticated via Engram account (OAuth).": "Authentifizierung über Engram-Konto (OAuth).",
	"Manage account": "Konto verwalten",
	"Sign out": "Abmelden",
	"Using API key": "API-Schlüssel verwenden",
	"Authenticated via manual API key.": "Authentifizierung über manuellen API-Schlüssel.",
	"Clear key": "Schlüssel löschen",
	"Switch to sign in": "Zur Anmeldung wechseln",
	"Engram: sign-in failed ({error})": "Engram: Anmeldung fehlgeschlagen ({error})",
	"Sign in or create an account": "Anmelden oder ein Konto erstellen",
	"Opens your browser to sign in, or create an account if you don't have one yet, then links this vault.":
		"Öffnet deinen Browser, um dich anzumelden oder ein Konto zu erstellen, falls du noch keins hast, und verknüpft dann diesen Vault.",
	"Sign in": "Anmelden",
	"Or authenticate with a token instead of signing in. Engram Cloud API keys require the Pro plan; on Free and Starter, sign in above.":
		"Oder authentifiziere dich mit einem Token anstelle der Anmeldung. Engram Cloud API-Schlüssel erfordern das Pro-Abonnement; bei Free und Starter melde dich oben an.",
	"Or authenticate with a token instead of signing in.":
		"Oder authentifiziere dich mit einem Token anstelle der Anmeldung.",
	"API key": "API-Schlüssel",
	Token: "Token",
	"Bearer token from your Engram account.": "Bearer-Token von deinem Engram-Konto.",
	Save: "Speichern",
	"Enter an API key first": "Gib zuerst einen API-Schlüssel ein",
	"That does not look like an Engram API key (expected {prefix}…).":
		"Das sieht nicht nach einem Engram API-Schlüssel aus (erwartet {prefix}…).",
	Vault: "Vault",
	"Vault selection": "Vault-Auswahl",
	"Select which vault this plugin syncs with.":
		"Wähle das Vault aus, mit dem dieses Plugin synchronisiert.",
	"No vaults found — first sync will create one":
		"Keine Vaults gefunden – die erste Synchronisierung erstellt eines",
	"Pick a vault (previous: '{name}' not found)":
		"Wähle ein Vault (vorherige: '{name}' nicht gefunden)",
	"Pick a vault (previous: id {id} not found)":
		"Wähle ein Vault (vorherige: ID {id} nicht gefunden)",
	"Pick a vault": "Wähle ein Vault",
	"Vault ID: {id}": "Vault-ID: {id}",
	Change: "Ändern",
	"Support development": "Entwicklung unterstützen",
	"If this plugin saves you time, consider supporting development.":
		"Wenn dieses Plugin dir Zeit spart, unterstütze die Entwicklung.",
	"GitHub Sponsors": "GitHub Sponsors",
	"Sign-in required to load vaults": "Anmeldung erforderlich, um Vaults zu laden",
	"Server error ({status}) — check Engram logs":
		"Serverfehler ({status}) – prüfe die Engram-Protokolle",
	"Could not reach Engram — check connection": "Engram nicht erreichbar – Verbindung prüfen",
	"Engram Cloud": "Engram Cloud",
	"Self-hosted": "Selbst gehostet",
	Backend: "Backend",
	"Where this vault syncs to. Each backend keeps its own sign-in.":
		"Wohin dieser Vault synchronisiert wird. Jedes Backend hat seine eigene Anmeldung.",
	"Switched to {mode}.": "Umgestellt auf {mode}.",
	"Not connected. Enter your Engram server URL below to start syncing.":
		"Nicht verbunden. Gib unten die URL deines Engram-Servers ein, um die Synchronisierung zu starten.",
	"Run your own Engram server": "Betreibe deinen eigenen Engram-Server",
	"Engram is the backend that powers sync and semantic search.":
		"Engram ist das Backend, das die Synchronisierung und die semantische Suche ermöglicht.",
	"Nothing in this vault syncs until you choose how to merge it with the server.":
		"Nichts in diesem Vault wird synchronisiert, bis du entscheidest, wie es mit dem Server zusammengeführt werden soll.",
	"Choose sync direction": "Synchronisationsrichtung wählen",
	Bug: "Fehler",
	Idea: "Idee",
	Confusing: "Verwirrend",
	"Love it": "Gefällt mir sehr",
	"What's working, what's frustrating, what do you wish Engram did?":
		"Was funktioniert, was ist frustrierend, was wünschst du dir von Engram?",
	"This server is self-hosted, so feedback is not collected here. ":
		"Dieser Server ist selbst gehostet, daher werden hier keine Daten gesammelt. ",
	"Report an issue on GitHub": "Fehlerbericht zu GitHub senden",
	"Connect to Engram first to send feedback.":
		"Verbinde dich zuerst mit Engram, um Feedback zu senden.",
	"Open Connection": "Verbindung öffnen",
	"What kind of feedback?": "Welche Art von Feedback?",
	"Your feedback": "Dein Feedback",
	"Tell us anything": "Erzähl uns alles",
	"How do you feel about Engram?": "Wie findest du Engram?",
	"{n} of 5": "{n} von 5",
	"Couldn't send your feedback, please try again.":
		"Dein Feedback konnte nicht gesendet werden, bitte versuche es erneut.",
	"It's OK to email me about this": "Du kannst mir gerne eine E-Mail dazu schreiben",
	"Sending…": "Sende…",
	Send: "Senden",
	"Thanks, we read every message.": "Danke, wir lesen jede Nachricht.",
	"New here? Watch the setup video": "Neu hier? Sieh dir das Einrichtungs-Video an",
	"What Engram does, and how to connect your vault, start to finish.":
		"Was Engram macht und wie du dein Vault verbindest, von Anfang bis Ende.",
	"▶ Watch on YouTube": "▶ Auf YouTube ansehen",
	"Getting set up": "Einrichtung",
	"1. Make an account": "1. Erstelle ein Konto",
	"setup guide": "2. Verbinde dein Vault mit Engram",
	"2. Connect your vault to Engram": "2. Verbinde deinen Vault mit Engram",
	"Sign in (or enter your server URL and key) on the connection tab, then run your first sync.":
		"Verbindungstab öffnen.",
	"Open connection tab": "Verbindungs-Tab öffnen",
	"3. Connect your AI": "3. Verbinde deine KI",
	"Link Claude, Cursor, ChatGPT, or any MCP app so it can read and write your notes. ":
		"Verbinde Claude, Cursor, ChatGPT oder jede andere MCP-App, damit sie deine Notizen lesen und schreiben kann ",
	"See the AI setup guide": "Sieh dir die Anleitung zur KI-Einrichtung an",
	Plans: "Pläne",
	Free: "Kostenlos",
	"1 vault, 2 devices": "1 Vault, 2 Geräte",
	"Real-time sync": "Echtzeit-Synchronisierung",
	"2,000 notes searchable": "2.000 Notizen durchsuchbar",
	"Connect any AI (MCP)": "Verbinde jede KI (MCP)",
	Starter: "Starter",
	"10 vaults, unlimited devices": "10 Vaults, unbegrenzte Geräte",
	"Search all your notes": "Durchsuche alle deine Notizen",
	"10 GB attachments": "10 GB Anhänge",
	"Unlimited AI searches": "Unbegrenzte KI-Suchen",
	Pro: "Pro",
	"Unlimited vaults": "Unbegrenzte Vaults",
	"Search across all vaults at once": "Suche in allen Vaults gleichzeitig",
	"50 GB attachments": "50 GB Anhänge",
	"API access": "API-Zugriff",
	"See full pricing": "Siehe vollständige Preisübersicht",
	"Learn more": "Mehr erfahren",
	Documentation: "Dokumentation",
	"AI / MCP setup guide": "Anleitung zur AI / MCP-Einrichtung",
	"Report an issue": "Problem melden",
	"Join our Discord": "Tritt unserem Discord bei",
	"Create a hosted account at {signup}, or self-host the backend ({guide}).":
		"Erstelle ein Konto bei {signup} oder hoste den Backend selbst ({guide}).",
	"...": "...",
	'... "{name}" ...': '... "{name}" ...',
	"The server took too long to respond. Try again.":
		"Der Server hat zu lange zum Antworten gebraucht. Versuche es erneut.",
	"Not signed in, or the session expired. Sign in again in Engram settings.":
		"Nicht angemeldet oder die Sitzung ist abgelaufen. Melde dich erneut in den Engram-Einstellungen an.",
	"The file is too large for the server.": "Die Datei ist zu groß für den Server.",
	"Too many requests. Wait a moment and try again.":
		"Zu viele Anfragen. Warte einen Moment und versuche es erneut.",
	"Frontmatter isn't valid YAML.": "Das Frontmatter ist kein gültiges YAML.",
	"A frontmatter key could not be parsed as YAML.":
		"Ein Frontmatter-Schlüssel konnte nicht als YAML geparst werden.",
	"This note could not be processed and was skipped.":
		"Diese Notiz konnte nicht verarbeitet und wurde übersprungen.",
	'Frontmatter key "{key}" could not be parsed as YAML.':
		'Der Frontmatter-Schlüssel "{key}" konnte nicht als YAML geparst werden.',
};

export default de;
