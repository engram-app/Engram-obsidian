import type { Dict } from "..";

// Deutsch
const de: Dict = {
	" (default)": " (Standard)",
	"({count} errors)": { one: "({count} Fehler)", other: "({count} Fehler)" },
	"...": "...",
	'... "{name}" ...': '... "{name}" ...',
	"1 vault, 2 devices": "1 Vault, 2 Geräte",
	"1. Make an account": "1. Erstelle ein Konto",
	"10 GB attachments": "10 GB Anhänge",
	"10 vaults, unlimited devices": "10 Vaults, unbegrenzte Geräte",
	"2,000 notes searchable": "2.000 Notizen durchsuchbar",
	"2. Connect your vault to Engram": "2. Verbinde deinen Vault mit Engram",
	"3. Connect your AI": "3. Verbinde deine KI",
	"50 GB attachments": "50 GB Anhänge",
	"A browser window has opened. Sign in and enter this code to link your vault.":
		"Ein Browserfenster wurde geöffnet. Melde dich an und gib diesen Code ein, um dein Vault zu verknüpfen.",
	"A frontmatter key could not be parsed as YAML.":
		"Ein Frontmatter-Schlüssel konnte nicht als YAML geparst werden.",
	"A temporary server problem — retrying automatically.":
		"Ein vorübergehendes Serverproblem – wird automatisch erneut versucht.",
	"AI / MCP setup guide": "Anleitung zur AI / MCP-Einrichtung",
	"AI searches": "KI-Suchen",
	"API access": "API-Zugriff",
	"API key": "API-Schlüssel",
	"API keys need a Pro plan. Sign in with your Engram account instead.":
		"API-Schlüssel benötigen einen Pro-Plan. Melde dich stattdessen mit deinem Engram-Konto an.",
	About: "Über",
	"Accept it to keep syncing.": "Akzeptiere es, um die Synchronisierung fortzusetzen.",
	"Access token": "Zugriffstoken",
	"Account setup incomplete.": "Kontoeinrichtung nicht abgeschlossen.",
	"Account suspended. Contact support.": "Konto gesperrt. Kontaktiere den Support.",
	"Activity ({count})": "Aktivität ({count})",
	"Add to ignores": "Zu den Ignorier-Mustern hinzufügen",
	"Added {pattern} to ignore patterns": "{pattern} zu den Ignorier-Mustern hinzugefügt",
	"Advanced sync options": "Erweiterte Synchronisierungsoptionen",
	"All synced. Your vault and the cloud now match.":
		"Alles synchronisiert. Dein Vault und die Cloud sind jetzt identisch.",
	"Already in sync. Nothing is deleted.": "Bereits synchronisiert. Nichts wird gelöscht.",
	"Already signed in on another device. Upgrade for multi-device.":
		"Du bist bereits auf einem anderen Gerät angemeldet. Upgrade für mehrere Geräte.",
	"Already up to date. Nothing needed syncing.":
		"Bereits auf dem neuesten Stand. Nichts musste synchronisiert werden.",
	"An unexpected error — retrying automatically.":
		"Ein unerwarteter Fehler – wird automatisch erneut versucht.",
	"Attachment storage full": "Speicherplatz für Anhänge voll",
	"Attachment storage is full — upgrade for more.":
		"Der Speicher für Anhänge ist voll — upgrade für mehr Speicher.",
	"Attachment sync is disabled for this account.":
		"Die Synchronisierung von Anhängen ist für dieses Konto deaktiviert.",
	Attachments: "Anhänge",
	"Attachments need a paid plan": "Anhänge benötigen ein kostenpflichtiges Abonnement",
	"Attachments on this device": "Anhänge auf diesem Gerät",
	"Authenticated via Engram account (OAuth).": "Authentifizierung über Engram-Konto (OAuth).",
	"Authenticated via manual API key.": "Authentifizierung über manuellen API-Schlüssel.",
	Authentication: "Authentifizierung",
	Back: "Zurück",
	"Bearer token from your Engram account.": "Bearer-Token von deinem Engram-Konto.",
	Both: "Beide",
	Bug: "Fehler",
	"Build output": "Build-Ausgabe",
	"Can't reach the server — retrying automatically.":
		"Verbindung zum Server konnte nicht hergestellt werden – wird automatisch erneut versucht.",
	Cancel: "Abbrechen",
	"Cargo cache": "Cargo-Cache",
	Change: "Ändern",
	"Change vault": "Vault ändern",
	"Check sync status": "Synchronisierungsstatus prüfen",
	"Checking for changes.": "Überprüfe auf Änderungen.",
	"Checking server…": "Server wird geprüft…",
	"Choose sync direction": "Synchronisationsrichtung wählen",
	Clear: "Löschen",
	"Clear all": "Alles löschen",
	"Clear key": "Schlüssel löschen",
	"Clear search": "Suche löschen",
	"Click to copy": "Zum Kopieren klicken",
	"Click to sync": "Zum Synchronisieren klicken",
	Close: "Schließen",
	"Cloud server": "Cloud-Server",
	"CocoaPods dependencies": "CocoaPods-Abhängigkeiten",
	"Code copied!": "Code kopiert!",
	"Code expired. Please try again.": "Code abgelaufen. Bitte versuche es erneut.",
	"Comparing your vault with the cloud…": "Dein Vault wird mit dem Cloud-Server verglichen…",
	Complete: "Fertig",
	Confirm: "Bestätigen",
	"Confirm destructive sync": "Destruktive Synchronisierung bestätigen",
	Conflict: "Konflikt",
	Confusing: "Verwirrend",
	"Connect any AI (MCP)": "Verbinde jede KI (MCP)",
	"Connect to Engram first to send feedback.":
		"Verbinde dich zuerst mit Engram, um Feedback zu senden.",
	"Connected — live sync active": "Verbunden — Live-Synchronisierung aktiv",
	"Connected — polling": "Verbunden — Abfrage läuft",
	"Connected — waiting for first sync decision":
		"Verbunden — wartet auf die erste Synchronisierungsentscheidung",
	"Connection failed": "Verbindung fehlgeschlagen",
	"Could not compare with the cloud. Check your connection.":
		"Vergleich mit der Cloud fehlgeschlagen. Überprüfe deine Verbindung.",
	"Could not create the vault — check your connection and try again.":
		"Vault konnte nicht erstellt werden – überprüfe deine Verbindung und versuche es erneut.",
	"Could not load vaults: {error}": "Vaults konnten nicht geladen werden: {error}",
	"Could not reach Engram — check connection": "Engram nicht erreichbar – Verbindung prüfen",
	"Couldn't create vault — the name may be invalid or already in use.":
		"Vault konnte nicht erstellt werden – der Name ist möglicherweise ungültig oder bereits verwendet.",
	"Couldn't send your feedback, please try again.":
		"Dein Feedback konnte nicht gesendet werden, bitte versuche es erneut.",
	Create: "Erstellen",
	"Create a hosted account at {signup}, or self-host the server ({guide}).":
		"Erstelle ein Konto bei {signup} oder hoste den Server selbst ({guide}).",
	"Create a new empty vault on the server, then sync this Obsidian vault into it.":
		"Erstelle ein neues, leeres Vault auf dem Server und synchronisiere dann dieses Obsidian-Vault damit.",
	"Custom patterns": "Benutzerdefinierte Muster",
	"Daily AI search limit reached. Free includes 20 per day across Obsidian, the web app and MCP. Upgrade for unlimited.":
		"Tägliches Limit für KI-Suchen erreicht. Das kostenlose Abo beinhaltet 20 Suchen pro Tag für Obsidian, die Web-App und MCP. Upgrade für unbegrenzte Suchen.",
	"Dart tool cache": "Dart-Tool-Cache",
	"Debug (verbose)": "Debug (ausführlich)",
	"Delete all local files, then download from remote":
		"Lösche alle lokalen Dateien und lade sie dann von der Ferne herunter",
	"Delete all on remote, then upload local files":
		"Lösche alle Dateien auf dem Remote-Server und lade dann die lokalen Dateien hoch",
	"Delete all {count} files currently on the server": {
		one: "Lösche alle {count} Dateien, die sich aktuell auf dem Server befinden",
		other: "Lösche alle {count} Dateien, die sich aktuell auf dem Server befinden",
	},
	"Delete all {count} files in this vault": {
		one: "Lösche alle {count} Datei in diesem Vault",
		other: "Lösche alle {count} Dateien in diesem Vault",
	},
	Deleted: "Gelöscht",
	Deleting: "Löschen",
	"Deleting {count} local files.": {
		one: "{count} lokale Datei wird gelöscht.",
		other: "{count} lokale Dateien werden gelöscht.",
	},
	"Deleting {count} on the cloud.": {
		one: "{count} wird im Cloud-Speicher gelöscht.",
		other: "{count} werden im Cloud-Speicher gelöscht.",
	},
	"Device swap cooldown active. Wait or upgrade.": "Geräteschaltzeit aktiv. Warte oder upgrade.",
	Diagnostics: "Diagnose",
	"Diagnostics detail": "Diagnose-Details",
	"Disconnect (clear login)": "Verbindung trennen (Login löschen)",
	Disconnected: "Getrennt",
	Dismiss: "Schließen",
	"Distribution build output": "Distribution-Build-Ausgabe",
	Documentation: "Dokumentation",
	Done: "Fertig",
	"Download everything": "Alles herunterladen",
	"Download remote files without uploading the local":
		"Lade Remote-Dateien herunter, ohne die lokalen Dateien hochzuladen",
	"Download {count} files from the server": {
		one: "Lade {count} Datei vom Server herunter",
		other: "Lade {count} Dateien vom Server herunter",
	},
	Downloading: "Herunterladen",
	"Downloading {count}.": { one: "Herunterladen {count}.", other: "Herunterladen {count}." },
	"Engram Cloud": "Engram Cloud",
	"Engram Sync: pulled {count} changes": {
		one: "Engram Sync: {count} Änderung synchronisiert",
		other: "Engram Sync: {count} Änderungen wurden übertragen",
	},
	"Engram Sync: pulled {count} files from server": {
		one: "Engram Sync: {count} Datei vom Server heruntergeladen",
		other: "Engram Sync: {count} Dateien vom Server heruntergeladen",
	},
	"Engram Sync: pulled {pulled}": "Engram Sync: heruntergeladen {pulled}",
	"Engram Sync: pulled {pulled} (local extras deleted)":
		"Engram Sync: heruntergeladen {pulled} (lokale Extras gelöscht)",
	"Engram Sync: pulled {pulled}, pushed {pushed}":
		"Engram-Synchronisierung: {pulled} heruntergeladen, {pushed} hochgeladen",
	"Engram Sync: pushed {count} files": {
		one: "Engram Sync: {count} Datei hochgeladen",
		other: "Engram Sync: {count} Dateien hochgeladen",
	},
	"Engram Sync: pushed {pushed}": "Engram Sync: hochgeladen {pushed}",
	'Engram Sync: renamed "{name}" (unsupported characters)':
		'Engram Sync: "{name}" umbenannt (nicht unterstützte Zeichen)',
	"Engram Sync: replaced remote with local ({pushed} uploaded)":
		"Engram Sync: Remote durch lokale Version ersetzt ({pushed} hochgeladen)",
	'Engram Sync: sync state for "{name}" was unreadable — using the on-disk copy.':
		'Engram Sync: Der Synchronisierungsstatus für "{name}" konnte nicht gelesen werden – es wird die lokale Kopie verwendet.',
	"Engram Sync: {details}": "Engram-Synchronisierung: {details}",
	"Engram URL": "Engram-URL",
	"Engram Vault Sync {version} is available. {link}.":
		"Engram Vault Sync {version} verfügbar. {link}.",
	"Engram indexes {indexed} of your {all} notes. The rest match on this device only. Upgrade to index everything.":
		"Engram indiziert {indexed} deiner {all} Notizen. Der Rest wird nur auf diesem Gerät gefunden. Upgrade, um alles zu indizieren.",
	"Engram is the backend that powers sync and semantic search.":
		"Engram ist das Backend, das die Synchronisierung und die semantische Suche ermöglicht.",
	"Engram search": "Engram-Suche",
	"Engram server changed — sign in again to continue.":
		"Engram-Server geändert – melde dich erneut an, um fortzufahren.",
	"Engram sync: checking...": "Engram-Synchronisierung: Überprüfe...",
	"Engram sync: everything in sync": "Engram-Synchronisierung: Alles ist synchron",
	"Engram sync: live sync requires a plugin update — please update the Engram vault sync plugin.":
		"Engram-Synchronisierung: Live-Synchronisierung erfordert ein Plugin-Update – bitte aktualisiere das Engram-Vault-Sync-Plugin.",
	"Engram sync: pulling all from server...":
		"Engram-Synchronisierung: Lade alles vom Server herunter...",
	"Engram sync: server does not support reconciliation (update backend)":
		"Engram-Synchronisierung: Der Server unterstützt keine Synchronisation (Backend aktualisieren)",
	"Engram sync: sync failed": "Engram-Synchronisierung: Fehler",
	"Engram sync: syncing...": "Engram-Synchronisierung: Synchronisiert...",
	"Engram unreachable. Showing matches from this device only.":
		"Engram nicht erreichbar. Zeigt nur Ergebnisse von diesem Gerät.",
	"Engram's {document} update, effective {date}.":
		"Engrams Update für {document}, gültig ab {date}.",
	"Engram: This vault has been deleted on the server.":
		"Engram: Dieses Vault wurde auf dem Server gelöscht.",
	"Engram: disconnected. Open Engram settings to reconnect.":
		"Engram: Verbindung getrennt. Öffne die Engram-Einstellungen, um die Verbindung wiederherzustellen.",
	"Engram: error": "Engram: Fehler",
	"Engram: finish setup": "Engram: Einrichtung abschließen",
	'Engram: frontmatter problem in "{name}"': 'Engram: Problem mit dem Frontmatter in "{name}"',
	"Engram: live": "Engram: aktiv",
	"Engram: not connected": "Engram: Keine Verbindung",
	"Engram: offline": "Engram: offline",
	"Engram: offline ({count} queued)": {
		one: "Engram: offline ({count} in der Warteschlange)",
		other: "Engram: offline ({count} in der Warteschlange)",
	},
	"Engram: pending ({count})": "Engram: Ausstehend ({count})",
	"Engram: plan upgraded — syncing {count} attachments…": {
		one: "Engram: Upgrade geplant — {count} Anhang wird synchronisiert…",
		other: "Engram: Upgrade geplant — {count} Anhänge werden synchronisiert…",
	},
	"Engram: plugin settings file was corrupted and could not be recovered. You may need to reconnect in settings.":
		"Engram: Die Plugin-Einstellungsdatei ist beschädigt und konnte nicht wiederhergestellt werden. Möglicherweise musst du die Verbindung in den Einstellungen neu herstellen.",
	"Engram: ready": "Engram: bereit",
	"Engram: recovered plugin settings from a backup after a corrupted save.":
		"Engram: Plugin-Einstellungen wurden aus einer Sicherungskopie wiederhergestellt, nachdem beim Speichern ein Fehler aufgetreten war.",
	"Engram: settings tab failed to render ({error})":
		"Engram: Einstellungstab konnte nicht geladen werden ({error})",
	"Engram: sign-in failed ({error})": "Engram: Anmeldung fehlgeschlagen ({error})",
	"Engram: signed out": "Engram: Abgemeldet",
	"Engram: sync conflict on {path} — your local edit was saved as {copy}":
		"Engram: Synchronisierungskonflikt bei {path} – deine lokale Änderung wurde als {copy} gespeichert",
	"Engram: sync failed. Open the sync log for details.":
		"Engram: Synchronisierung fehlgeschlagen. Öffne das Synchronisierungsprotokoll für Details.",
	"Engram: sync is not set up yet, so nothing in this vault will sync.":
		"Engram: Die Synchronisierung ist noch nicht eingerichtet, daher werden keine Notizen in diesem Vault synchronisiert.",
	"Engram: sync is paused. This edit was not synced. Choose a sync direction to resume.":
		"Engram: Synchronisierung angehalten. Diese Änderung wurde nicht synchronisiert. Wähle eine Synchronisationsrichtung, um fortzufahren.",
	"Engram: sync paused": "Engram: Synchronisierung angehalten",
	"Engram: syncing": "Engram: Synchronisieren",
	"Engram: syncing ({count})": "Engram: Synchronisieren ({count})",
	"Engram: this plugin is too old to sync (needs {version} or newer). Update it to continue.":
		"Engram: Dieses Plugin ist zu alt, um synchronisiert zu werden (benötigt {version} oder neuer). Aktualisiere es, um fortzufahren.",
	"Engram: this plugin is too old to sync. Update it to continue.":
		"Engram: Dieses Plugin ist zu alt, um synchronisiert zu werden. Aktualisiere es, um fortzufahren.",
	"Engram: this vault no longer exists on the server. Pick or create a vault to continue.":
		"Engram: Dieses Vault existiert nicht mehr auf dem Server. Wähle ein Vault aus oder erstelle eines, um fortzufahren.",
	"Engram: your login expired — open Engram settings to reconnect.":
		"Engram: Deine Anmeldung ist abgelaufen – öffne die Engram-Einstellungen, um die Verbindung wiederherzustellen.",
	"Engram: {count} attachments skipped — upgrade your plan to sync images & PDFs.": {
		one: "Engram: {count} Anhang übersprungen – aktualisiere dein Abo, um Bilder und PDFs zu synchronisieren.",
		other: "Engram: {count} Anhänge übersprungen – aktualisiere dein Abo, um Bilder und PDFs zu synchronisieren.",
	},
	"Engram: {count} files failed to sync{detail} — open Sync Center": {
		one: "Engram: {count} Datei konnte nicht synchronisiert werden{detail} — Öffne die Sync-Zentrale",
		other: "Engram: {count} Dateien konnten nicht synchronisiert werden{detail} – Sync-Zentrale öffnen",
	},
	"Engram: {count} notes have frontmatter problems. Open Sync Center to fix.": {
		one: "Engram: {count} Notiz hat Probleme mit der Kopfzeile. Öffne die Sync-Zentrale, um das zu beheben.",
		other: "Engram: {count} Notizen haben Probleme mit der Frontmatter. Öffne die Sync-Zentrale, um sie zu beheben.",
	},
	"Engram: ⚠ {count} sync errors": {
		one: "Engram: ⚠ {count} Synchronisierungsfehler",
		other: "Engram: ⚠ {count} Synchronisierungsfehler",
	},
	"Enter a name for the new vault": "Gib einen Namen für das neue Vault ein",
	"Enter an API key first": "Gib zuerst einen API-Schlüssel ein",
	Error: "Fehler",
	"Error: {error}": "Fehler: {error}",
	"Errors only": "Nur Fehler",
	"Everything is in sync": "Alles ist synchronisiert",
	"Failed to start device flow. Check your Engram URL and try again.":
		"Fehler beim Start des Geräte-Flows. Überprüfe deine Engram-URL und versuche es erneut.",
	"Failed to switch vault: {error}": "Fehler beim Wechsel des Vaults: {error}",
	"File exceeds the {limit} limit": "Datei überschreitet das Limit von {limit}",
	"File not found locally: {path}": "Datei nicht lokal gefunden: {path}",
	"File too large for your plan.": "Datei ist zu groß für dein Abo.",
	"Files that will be deleted:": "Dateien, die gelöscht werden:",
	"Filter by folder…": "Nach Ordner filtern…",
	"Filter by tags…": "Nach Tags filtern…",
	"Finish setting up your account at app.engram.page to start syncing.":
		"Schließe die Einrichtung deines Kontos unter app.engram.page ab, um mit der Synchronisierung zu beginnen.",
	"Finish sync setup": "Synchronisierung einrichten",
	"Finished with some errors. Open the sync log to see what failed.":
		"Beendet mit Fehlern. Öffne das Synchronprotokoll, um zu sehen, was fehlgeschlagen ist.",
	"First sync, this may take a moment.": "Erste Synchronisierung, das kann einen Moment dauern.",
	Free: "Kostenlos",
	"Free syncs notes only — images & PDFs need a paid plan.":
		"Kostenlose Synchronisierung gilt nur für Notizen – Bilder und PDFs benötigen ein kostenpflichtiges Abonnement.",
	"Free syncs notes only — {count} attachments will be skipped.": {
		one: "Kostenlose Synchronisierung gilt nur für Notizen – {count} Anhang wird übersprungen.",
		other: "Kostenlose Synchronisierung gilt nur für Notizen – {count} Anhänge werden übersprungen.",
	},
	"Frontmatter could not be parsed": "Frontmatter konnte nicht analysiert werden",
	"Frontmatter isn't valid YAML.": "Das Frontmatter ist kein gültiges YAML.",
	'Frontmatter key "{key}" could not be parsed as YAML.':
		'Der Frontmatter-Schlüssel "{key}" konnte nicht als YAML geparst werden.',
	"Frontmatter needs a fix": "Frontmatter benötigt eine Korrektur",
	"Generic cache directory": "Allgemeines Cache-Verzeichnis",
	"Getting set up": "Einrichtung",
	"Getting started…": "Starte…",
	"GitHub Sponsors": "GitHub Sponsors",
	"Gradle build cache": "Gradle-Build-Cache",
	"How do you feel about Engram?": "Wie findest du Engram?",
	Idea: "Idee",
	"If this plugin saves you time, consider supporting development.":
		"Wenn dieses Plugin dir Zeit spart, unterstütze die Entwicklung.",
	Ignore: "Ignorieren",
	"Ignore patterns": "Ignorier-Muster",
	"Ignored ({count})": "Ignoriert ({count})",
	"Ignored {path} — won't sync until restored from Sync Center.":
		"Ignoriert {path} – wird erst wieder synchronisiert, wenn du sie in der Sync-Zentrale wiederherstellst.",
	"Info (default)": "Info (Standard)",
	"Invalid API key": "Ungültiger API-Schlüssel",
	"It's OK to email me about this": "Du kannst mir gerne eine E-Mail dazu schreiben",
	"Join our Discord": "Tritt unserem Discord bei",
	Keyword: "Schlüsselwort",
	"Last sync: {when}": "Letzte Synchronisierung: {when}",
	"Learn more": "Mehr erfahren",
	"License: {name}": "Lizenz: {name}",
	"Limit reached. Upgrade to continue.": "Limit erreicht. Upgrade erforderlich, um fortzufahren.",
	"Link Claude, Cursor, ChatGPT, or any MCP app so it can read and write your notes. ":
		"Verbinde Claude, Cursor, ChatGPT oder jede andere MCP-App, damit sie deine Notizen lesen und schreiben kann ",
	"Link Obsidian to Engram": "Verbinde Obsidian mit Engram",
	"Loading vaults…": "Lade Vaults…",
	"Love it": "Gefällt mir sehr",
	"Make new vault": "Neuen Vault erstellen",
	"Manage account": "Konto verwalten",
	"Minimum severity that ships while diagnostics are on. Higher levels send fewer lines. Default: Info.":
		"Minimale Schweregradstufe, die aktiv ist, während die Diagnose eingeschaltet ist. Höhere Stufen senden weniger Zeilen. Standard: Info.",
	"Needs attention ({count})": "Benötigt Aufmerksamkeit ({count})",
	"Network unavailable": "Netzwerk nicht verfügbar",
	"New here? Watch the setup video": "Neu hier? Sieh dir das Einrichtungs-Video an",
	"New vault": "Neues Vault",
	"Next.js build output": "Next.js-Build-Ausgabe",
	"No activity yet. Push or pull to see entries here.":
		'Noch keine Aktivitäten. Drücke "Push" oder "Pull", um Einträge anzuzeigen.',
	"No files ignored. Use the ignore button on a failure row to stop syncing it.":
		"Keine Dateien ignoriert. Verwende den Ignorier-Button in einer Zeile mit Fehlern, um die Synchronisierung zu stoppen.",
	"No other vaults available.": "Keine anderen Vaults verfügbar.",
	"No results found": "Keine Ergebnisse gefunden",
	"No source path for this result": "Kein Quellpfad für dieses Ergebnis",
	"No sync activity this session.": "Keine Synchronisierungsaktivität in dieser Sitzung.",
	"No vaults found — first sync will create one":
		"Keine Vaults gefunden – die erste Synchronisierung erstellt eines",
	"Node.js dependencies": "Node.js-Abhängigkeiten",
	"Not configured": "Nicht konfiguriert",
	"Not connected yet. Click to open settings and link this vault.":
		"Noch keine Verbindung. Klicke, um die Einstellungen zu öffnen und dieses Vault zu verknüpfen.",
	"Not connected. Enter your Engram server URL below to start syncing.":
		"Nicht verbunden. Gib unten die URL deines Engram-Servers ein, um die Synchronisierung zu starten.",
	"Not now": "Nicht jetzt",
	"Not signed in, or the session expired. Sign in again in Engram settings.":
		"Nicht angemeldet oder die Sitzung ist abgelaufen. Melde dich erneut in den Engram-Einstellungen an.",
	"Not signed in. Click to open settings and reconnect.":
		"Noch nicht angemeldet. Klicke, um die Einstellungen zu öffnen und dich erneut zu verbinden.",
	"Not synced on your plan ({count})": "Nicht im Rahmen deines Plans synchronisiert ({count})",
	"Note couldn't be processed": "Notiz konnte nicht verarbeitet werden",
	"Note limit reached. Upgrade to keep adding notes.":
		"Notizen-Limit erreicht. Upgrade, um weitere Notizen hinzufügen zu können.",
	"Note not synced locally": "Notiz nicht lokal synchronisiert",
	"Notes on this device": "Notizen auf diesem Gerät",
	"Notes past this still sync and open normally, they are just not in the search index. The index keeps your oldest notes, so it is your newest ones that fall outside.":
		"Notizen nach diesem Punkt werden weiterhin synchronisiert und normal geöffnet, sie sind nur nicht im Suchindex enthalten. Der Index speichert deine ältesten Notizen, sodass die neuesten Notizen nicht enthalten sind.",
	"Notes searchable": "Notizen durchsuchbar",
	"Notes stored": "Notizen gespeichert",
	"Nothing in this vault syncs until you choose how to merge it with the server.":
		"Nichts in diesem Vault wird synchronisiert, bis du entscheidest, wie es mit dem Server zusammengeführt werden soll.",
	"Nothing is deleted.": "Nichts wird gelöscht.",
	"Nothing needs your attention. 🎉": "Nichts erfordert deine Aufmerksamkeit. 🎉",
	"Nothing to sync yet — this vault is empty on both sides. Start syncing and everything you write appears on your other devices.":
		"Noch nichts zu synchronisieren – dieser Vault ist auf beiden Seiten leer. Starte die Synchronisierung, und alles, was du schreibst, erscheint auf deinen anderen Geräten.",
	"Nothing to sync yet: every file here is on your ignore list. Start syncing and everything you write appears on your other devices.":
		"Noch nichts zu synchronisieren: jede Datei hier steht auf deiner Ignorierliste. Starte die Synchronisierung, und alles, was du schreibst, erscheint auf deinen anderen Geräten.",
	"Nothing will be deleted.": "Nichts wird gelöscht.",
	"Nothing will be removed from this device.": "Nichts wird von diesem Gerät entfernt.",
	Open: "Öffnen",
	"Open Connection": "Verbindung öffnen",
	"Open Engram": "Engram öffnen",
	"Open Engram settings": "Engram-Einstellungen öffnen",
	"Open Engram to check your vault and confirm everything synced.":
		"Öffne Engram, um dein Vault zu prüfen und sicherzustellen, dass alles synchronisiert wurde.",
	"Open connection tab": "Verbindungs-Tab öffnen",
	"Open note": "Notiz öffnen",
	"Open search sidebar": "Suchleiste öffnen",
	"Open sync center": "Sync-Zentrale öffnen",
	"Open sync setup": "Synchronisierung einrichten",
	"Open the file to resolve the conflict, then sync again.":
		"Öffne die Datei, um den Konflikt zu beheben, und synchronisiere dann erneut.",
	"Opens your browser to sign in, or create an account if you don't have one yet, then links this vault.":
		"Öffnet deinen Browser, um dich anzumelden oder ein Konto zu erstellen, falls du noch keins hast, und verknüpft dann diesen Vault.",
	"Or authenticate with a token instead of signing in.":
		"Oder authentifiziere dich mit einem Token anstelle der Anmeldung.",
	"Or authenticate with a token instead of signing in. Engram Cloud API keys require the Pro plan; on Free and Starter, sign in above.":
		"Oder authentifiziere dich mit einem Token anstelle der Anmeldung. Engram Cloud API-Schlüssel erfordern das Pro-Abonnement; bei Free und Starter melde dich oben an.",
	"Paths to skip (one per line). Folder patterns end with /. Built-in: {configDir}/, .trash/, .git/":
		"Pfade, die übersprungen werden sollen (einer pro Zeile). Ordnernamen enden mit /. Voreinstellungen: {configDir}/, .trash/, .git/",
	"Pick a vault": "Wähle ein Vault",
	"Pick a vault (previous: '{name}' not found)":
		"Wähle ein Vault (vorherige: '{name}' nicht gefunden)",
	"Pick a vault (previous: id {id} not found)":
		"Wähle ein Vault (vorherige: ID {id} nicht gefunden)",
	"Pick a vault to sync with. We will recalculate the sync preview after you choose.":
		"Wähle einen Vault aus, mit dem du synchronisieren möchtest. Wir berechnen dann die Synchronisierungs-Vorschau neu.",
	"Plan usage": "Nutzungsübersicht",
	Plans: "Pläne",
	"Privacy Policy": "Datenschutzrichtlinie",
	Pro: "Pro",
	"Pull all (delete extras) aborted: could not obtain an exclusive server snapshot (replay contention). Nothing was trashed.":
		"Abbrechen: Alle Notizen herunterladen (Extras löschen) fehlgeschlagen: konnte keinen exklusiven Server-Snapshot erhalten (Konflikt). Nichts wurde gelöscht.",
	"Pull all aborted: another sync is running (replay contention). Try again when it finishes.":
		"Abbrechen: Alle Notizen herunterladen fehlgeschlagen: eine andere Synchronisierung läuft (Konflikt). Versuche es später erneut.",
	"Pull all failed: {error}": "Fehler beim Herunterladen aller Notizen: {error}",
	"Pull all from server (force overwrite)":
		"Alles vom Server herunterladen (erzwungene Überschreibung)",
	Pulled: "Empfangen",
	"Push entire vault": "Gesamten Vault synchronisieren",
	Pushed: "Gesendet",
	"Python bytecode cache": "Python-Bytecode-Cache",
	"Python virtual environment": "Python-virtuelle Umgebung",
	"Read it": "Lies es",
	"Real-time sync": "Echtzeit-Synchronisierung",
	"Reconnect your account to resume syncing.":
		"Verbinde dein Konto neu, dann läuft die Synchronisierung weiter.",
	Refresh: "Aktualisieren",
	"Remote vault": "Remote-Vault",
	"Remove tag {tag}": "Tag {tag} entfernen",
	"Report an issue": "Problem melden",
	"Report an issue on GitHub": "Fehlerbericht zu GitHub senden",
	"Request failed ({status})": "Anfrage fehlgeschlagen ({status})",
	Restore: "Wiederherstellen",
	"Restored {path} — will sync on next push.":
		"{path} wiederhergestellt – wird beim nächsten Synchronisieren aktualisiert.",
	"Retry all now": "Alle jetzt wiederholen",
	"Retrying automatically ({count})": "Automatischer Wiederversuch ({count})",
	"Review and accept": "Überprüfen und akzeptieren",
	"Run in background": "Im Hintergrund ausführen",
	"Run your own Engram server": "Betreibe deinen eigenen Engram-Server",
	"Rust/Java build output": "Rust/Java-Build-Ausgabe",
	"Safe choice: combines both sides, nothing is deleted.":
		"Sichere Wahl: Kombiniert beide Seiten, nichts wird gelöscht.",
	Save: "Speichern",
	"Search across all vaults at once": "Suche in allen Vaults gleichzeitig",
	"Search all your notes": "Durchsuche alle deine Notizen",
	"Search failed — check connection": "Suche fehlgeschlagen – Verbindung prüfen",
	"Search settings": "Such-Einstellungen",
	"Search your vault…": "Suche in deinem Vault…",
	"Searching {indexed} of {all} notes. Upgrade to search everything.":
		"Durchsucht {indexed} von {all} Notizen. Upgrade, um alles zu durchsuchen.",
	"See full pricing": "Siehe vollständige Preisübersicht",
	"See the AI setup guide": "Sieh dir die Anleitung zur KI-Einrichtung an",
	"Select which vault this plugin syncs with.":
		"Wähle das Vault aus, mit dem dieses Plugin synchronisiert.",
	"Self-hosted": "Selbst gehostet",
	Semantic: "Semantisch",
	"Semantic search": "Semantische Suche",
	Send: "Senden",
	"Send debug logs. Note content stays private.":
		"Debug-Protokolle senden. Der Inhalt deiner Notizen bleibt privat.",
	"Send detailed sync, vault, and connection activity to the server for troubleshooting, with distributed tracing on requests. Metadata only, never note content. Leave off for normal use.":
		"Sende detaillierte Synchronisierungs-, Vault- und Verbindungsaktivitäten an den Server zur Fehlerbehebung, mit verteiltem Tracing für Anfragen. Nur Metadaten, niemals Notizeninhalte. Deaktiviere dies für normalen Gebrauch.",
	"Send feedback": "Feedback senden",
	"Sending…": "Sende…",
	"Server error": "Serverfehler",
	"Server error ({status}) — check Engram logs":
		"Serverfehler ({status}) – prüfe die Engram-Protokolle",
	"Server unreachable — changes will sync when connected":
		"Server nicht erreichbar – Änderungen werden synchronisiert, sobald eine Verbindung besteht",
	"Set up sync for this vault": "Synchronisierung für diesen Vault einrichten",
	"Setup is not finished — nothing will sync until you choose a sync direction. Click to finish.":
		"Einrichtung nicht abgeschlossen — nichts wird synchronisiert, bis du eine Synchronisationsrichtung wählst. Klicke, um fortzufahren.",
	"Show files ({count}) ▾": "Dateien anzeigen ({count}) ▾",
	"Show sync log": "Synchronisationsprotokoll anzeigen",
	"Showing {count} entries": { one: "Zeigt {count} Eintrag", other: "Zeigt {count} Einträge" },
	"Sign in": "Anmelden",
	"Sign in (or enter your server URL and key) on the connection tab, then run your first sync.":
		"Verbindungstab öffnen.",
	"Sign in or create an account": "Anmelden oder ein Konto erstellen",
	"Sign out": "Abmelden",
	"Sign-in expired": "Anmeldung abgelaufen",
	"Sign-in required to load vaults": "Anmeldung erforderlich, um Vaults zu laden",
	"Signed in as {email}": "Angemeldet als {email}",
	Skipped: "Übersprungen",
	"Source: {link}": "Quelle: {link}",
	"Start syncing": "Synchronisierung starten",
	Starter: "Starter",
	"Starting...": "Starte...",
	Stats: "Statistiken",
	"Support development": "Entwicklung unterstützen",
	"Switch to sign in": "Zur Anmeldung wechseln",
	"Switch vault": "Vault wechseln",
	"Switched to {mode}.": "Umgestellt auf {mode}.",
	Sync: "Synchronisieren",
	"Sync complete": "Synchronisierung abgeschlossen",
	"Sync failed": "Synchronisierung fehlgeschlagen",
	"Sync in progress...": "Synchronisierung läuft...",
	"Sync log": "Synchronisierungs-Protokoll",
	"Sync now": "Jetzt synchronisieren",
	"Sync paused — click to choose a sync direction":
		"Synchronisierung angehalten – klicke, um eine Synchronisationsrichtung auszuwählen",
	"Sync preview": "Synchronisierungsvorschau",
	"Sync server": "Synchronisierungsserver",
	"Sync these now": "Jetzt synchronisieren",
	"Sync...": "Synchronisieren...",
	"Synced. Some attachments need a paid plan to sync (see below).":
		"Synchronisiert. Einige Anhänge benötigen ein kostenpflichtiges Abonnement, um synchronisiert zu werden (siehe unten).",
	"Syncing attachments": "Anhänge synchronisieren",
	"Syncing your vault": "Synchronisiere dein Vault",
	"Syncing...": "Synchronisieren...",
	"Syncing…": "Synchronisieren…",
	"Tell us anything": "Erzähl uns alles",
	"Temporary errors. These clear themselves once the server recovers.":
		"Vorübergehende Fehler. Diese werden behoben, sobald der Server wieder normal läuft.",
	"Terms of Service": "Nutzungsbedingungen",
	"Thanks, we read every message.": "Danke, wir lesen jede Nachricht.",
	"That does not look like a complete server address. Include the scheme, for example http://127.0.0.1:4000":
		"Das sieht nicht nach einer vollständigen Serveradresse aus. Gib das Schema mit an, z.B. http://127.0.0.1:4000",
	"That does not look like an Engram API key (expected {prefix}…).":
		"Das sieht nicht nach einem Engram API-Schlüssel aus (erwartet {prefix}…).",
	"The Free tier syncs notes only. Upgrade to sync images and PDFs.":
		"Die kostenlose Version synchronisiert nur Notizen. Upgrade, um auch Bilder und PDFs zu synchronisieren.",
	"The file is too large for the server.": "Die Datei ist zu groß für den Server.",
	"The note synced, but its frontmatter could not be fully parsed. Open it to fix the highlighted line.":
		"Die Notiz wurde synchronisiert, aber ihr Frontmatter konnte nicht vollständig analysiert werden. Öffne sie, um die hervorgehobene Zeile zu korrigieren.",
	"The server couldn't process this note. Check its contents, then edit and save to try again.":
		"Der Server konnte diese Notiz nicht verarbeiten. Überprüfe den Inhalt, bearbeite sie und speichere sie, um es erneut zu versuchen.",
	"The server limit is 5 MB. Compress or split the file, then it will sync.":
		"Die Server-Grenze beträgt 5 MB. Komprimiere oder teile die Datei, dann wird sie synchronisiert.",
	"The server took too long to respond. Try again.":
		"Der Server hat zu lange zum Antworten gebraucht. Versuche es erneut.",
	"These files are fine. They just need a paid plan to sync.":
		"Diese Dateien sind in Ordnung. Sie benötigen nur einen kostenpflichtigen Plan, um synchronisiert zu werden.",
	"This account was deleted. Contact support if that is wrong.":
		"Dieses Konto wurde gelöscht. Kontaktiere den Support, falls das falsch ist.",
	"This cannot be undone.": "Das kann nicht rückgängig gemacht werden.",
	"This device's vault is empty. Download {what} from the server?":
		"Der Vault dieses Geräts ist leer. Möchtest du {what} vom Server herunterladen?",
	"This file type isn't accepted by this server.":
		"Dieser Dateityp wird von diesem Server nicht akzeptiert.",
	"This note could not be processed and was skipped.":
		"Diese Notiz konnte nicht verarbeitet und wurde übersprungen.",
	"This server is self-hosted, so feedback is not collected here. ":
		"Dieser Server ist selbst gehostet, daher werden hier keine Daten gesammelt. ",
	"This vault": "Dieser Vault",
	"This vault is empty on the server. Upload your {what}?":
		"Dieser Vault ist auf dem Server leer. Möchtest du deine {what} hochladen?",
	"Too large for the server": "Zu groß für den Server",
	"Too many connected AI clients. Disconnect one or upgrade.":
		"Zu viele verbundene KI-Clients. Trenne einen oder upgrade.",
	"Too many connected Obsidian vaults. Disconnect one or upgrade.":
		"Zu viele verbundene Obsidian-Vaults. Trenne eine oder upgrade.",
	"Too many requests. Wait a moment and try again.":
		"Zu viele Anfragen. Warte einen Moment und versuche es erneut.",
	"Try again": "Nochmal versuchen",
	"Type {keyword} to confirm:": "Gib {keyword} ein, um zu bestätigen:",
	"Unknown error": "Unbekannter Fehler",
	"Unlimited AI searches": "Unbegrenzte KI-Suchen",
	"Unlimited vaults": "Unbegrenzte Vaults",
	"Unresolved conflict": "Konflikt konnte nicht gelöst werden",
	Untitled: "Ohne Titel",
	Update: "Aktualisieren",
	"Update in settings": "In den Einstellungen aktualisieren",
	Upgrade: "Upgrade",
	"Upload everything": "Alles hochladen",
	"Upload local files without downloading the remote":
		"Lade lokale Dateien hoch, ohne die Remote-Dateien herunterzuladen",
	"Upload {count} files from this vault": {
		one: "Lade {count} Datei von diesem Vault hoch",
		other: "Lade {count} Dateien von diesem Vault hoch",
	},
	Uploading: "Hochladen",
	"Uploading {count}.": { one: "Hochladen {count}.", other: "Hochladen {count}." },
	"Uploads {up}, downloads {down}.": "Hochgeladen: {up}, heruntergeladen: {down}.",
	"Using API key": "API-Schlüssel verwenden",
	Vault: "Vault",
	"Vault ID: {id}": "Vault-ID: {id}",
	"Vault limit reached. Upgrade for more vaults.":
		"Vault-Limit erreicht. Upgrade für mehr Vaults.",
	"Vault name": "Vault-Name",
	"Vault selection": "Vault-Auswahl",
	"Vendored dependencies": "Integrierte Abhängigkeiten",
	"Version: {version}": "Version: {version}",
	"Waiting for authorization — connected, this will complete instantly.":
		"Warte auf Autorisierung — verbunden, dies dauert nur einen Moment.",
	"Waiting for authorization — no live connection, checking every 30s.":
		"Warte auf Autorisierung — keine aktive Verbindung, Überprüfung alle 30 Sekunden.",
	"Warnings and errors": "Warnungen und Fehler",
	"WebSocket connected — live sync active": "WebSocket verbunden – Live-Synchronisierung aktiv",
	"What Engram does, and how to connect your vault, start to finish.":
		"Was Engram macht und wie du dein Vault verbindest, von Anfang bis Ende.",
	"What kind of feedback?": "Welche Art von Feedback?",
	"What's working, what's frustrating, what do you wish Engram did?":
		"Was funktioniert, was ist frustrierend, was wünschst du dir von Engram?",
	"Where this vault syncs to. Each backend keeps its own sign-in.":
		"Wohin dieser Vault synchronisiert wird. Jedes Backend hat seine eigene Anmeldung.",
	"Will download {count} files.": {
		one: "Lädt {count} Datei herunter.",
		other: "Lädt {count} Dateien herunter.",
	},
	"Will upload {count} files.": {
		one: "Lädt {count} Datei hoch.",
		other: "Ladet {count} Dateien hoch.",
	},
	"You are about to:": "Du wirst folgendes tun:",
	"You are now pointing at a different cloud vault":
		"Du zeigst jetzt auf einen anderen Cloud-Vault",
	"You can close this and the sync keeps running in the background.":
		"Du kannst das Fenster schließen, die Synchronisierung läuft im Hintergrund weiter.",
	"You've used all the attachment storage on your plan. Upgrade for more.":
		"Du hast den gesamten Speicherplatz für Anhänge in deinem Abonnement genutzt. Upgrade für mehr Speicher.",
	"Your code:": "Dein Code:",
	"Your feedback": "Dein Feedback",
	"Your login expired. Sign in again in Engram settings to continue.":
		"Dein Login ist abgelaufen. Melde dich erneut in den Engram-Einstellungen an, um fortzufahren.",
	"Your vault shares {percent} of its data with Engram":
		"Dein Vault teilt {percent} seiner Daten mit Engram",
	attachments: "Anhänge",
	exact: "exakt",
	files: "Dateien",
	folders: "Ordner",
	"match strength: {pct}%": "Übereinstimmungsstärke: {pct}%",
	"matches meaning. Finds notes that never use the words you typed.":
		"findet die Bedeutung. Findet Notizen, die die eingegebenen Wörter nicht verwenden.",
	"matches words and meaning together, plus this device. Widest results.":
		"findet Wörter und Bedeutung zusammen, plus dieses Gerät. Umfassendste Ergebnisse.",
	"matches your words and their other forms — 'run' finds 'running' — plus this device.":
		"findet deine Wörter und ihre anderen Formen – 'run' findet 'running' – plus dieses Gerät.",
	meaning: "Bedeutung",
	"meaning + exact": "Bedeutung + exakt",
	"not linked": "nicht verbunden",
	notes: "Notizen",
	"setup guide": "2. Verbinde dein Vault mit Engram",
	"sync is paused": "Synchronisierung pausiert",
	"syncing now": "Synchronisiert",
	unknown: "unbekannt",
	"waiting for a connection": "wartet auf eine Verbindung",
	"waiting to retry": "wartet auf Wiederholung",
	"{count} attachments": { one: "{count} Anhang", other: "{count} Anhänge" },
	"{count} attachments need a paid plan to sync. See Sync Center.": {
		one: "{count} Anhang benötigt ein kostenpflichtiges Abo, um synchronisiert zu werden. Siehe Sync-Zentrale.",
		other: "{count} Anhänge benötigen ein kostenpflichtiges Abo, um synchronisiert zu werden. Siehe Sync-Zentrale.",
	},
	"{count} attempts": { one: "{count} Versuch", other: "{count} Versuche" },
	"{count} conflicts need resolution": {
		one: "{count} Konflikt muss gelöst werden",
		other: "{count} Konflikte müssen gelöst werden",
	},
	"{count} conflicts to resolve.": {
		one: "{count} Konflikt, der behoben werden muss.",
		other: "{count} Konflikte müssen gelöst werden.",
	},
	"{count} diverged": { one: "{count} abweichend", other: "{count} abweichend" },
	'{count} failed. Run "{command}" for details.': {
		one: '{count} fehlgeschlagen. Starte "{command}", um Details zu sehen.',
		other: '{count} fehlgeschlagen. Starte "{command}", um Details zu sehen.',
	},
	"{count} files": { one: "{count} Datei", other: "{count} Dateien" },
	"{count} files not included in your plan": {
		one: "{count} Datei nicht in deinem Plan enthalten",
		other: "{count} Dateien nicht in deinem Plan enthalten",
	},
	"{count} files queued": {
		one: "{count} Datei in der Warteschlange",
		other: "{count} Dateien in der Warteschlange",
	},
	"{count} ignored": { one: "{count} ignoriert", other: "{count} ignoriert" },
	"{count} missing on server": {
		one: "{count} fehlt auf dem Server",
		other: "{count} fehlen auf dem Server",
	},
	"{count} need attention": {
		one: "{count} erfordert deine Aufmerksamkeit",
		other: "{count} erfordern deine Aufmerksamkeit",
	},
	"{count} notes": { one: "{count} Notiz", other: "{count} Notizen" },
	"{count} only on server": {
		one: "{count} nur auf dem Server",
		other: "{count} nur auf dem Server",
	},
	"{count} queued — {reason}": {
		one: "{count} in der Warteschlange — {reason}",
		other: "{count} in der Warteschlange — {reason}",
	},
	"{count} retrying": { one: "{count} Wiederholung", other: "{count} Wiederholungsversuche" },
	"{desc} — should not be synced": "{desc} — soll nicht synchronisiert werden",
	"{first} and {second}": "{first} und {second}",
	"{formatted} per day": "{formatted} pro Tag",
	"{label} ({count} queued)": {
		one: "{label} ({count} in der Warteschlange)",
		other: "{label} ({count} in der Warteschlange)",
	},
	"{n} of 5": "{n} von 5",
	"▶ Watch on YouTube": "▶ Auf YouTube ansehen",
	"⚙️ Advanced": "⚙️ Erweitert",
	"⚠ Detected: {label}/ ({formatted} files)": "⚠ Erkannt: {label} ({formatted} Dateien)",
	"✓ Engram server reachable (v{version})": "✓ Engram-Server erreichbar (v{version})",
	"✓ {count} synced": { one: "✓ {count} synchronisiert", other: "✓ {count} synchronisiert" },
	"✕ {count} failed": { one: "✕ {count} fehlgeschlagen", other: "✕ {count} fehlgeschlagen" },
	"✗ couldn't reach a server at this URL": "✗ Kein Server unter dieser URL erreichbar",
	"✗ server responded but isn't an Engram server":
		"✗ Der Server antwortet, ist aber kein Engram-Server",
	"⤳ {count} skipped (Free plan)": {
		one: "⤳ {count} übersprungen (kostenlose Version)",
		other: "⤳ {count} übersprungen (Kostenlose Version)",
	},
	"👋 Welcome": "👋 Willkommen",
	"💬 Feedback": "💬 Feedback",
	"🔄 Sync Center": "🔄 Sync-Zentrale",
	"🔌 Connection": "🔌 Verbindung",
};

export default de;
