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
	// UI strings
	"Link Obsidian to Engram": "Obsidian mit Engram verbinden",
	"Failed to start device flow. Check your Engram URL and try again.":
		"Die Geräteanmeldung konnte nicht gestartet werden. Prüf deine Engram-Adresse und versuch es erneut.",
	"Your code:": "Dein Code:",
	"A browser window has opened. Sign in and enter this code to link your vault.":
		"Ein Browserfenster ist offen. Melde dich an und gib diesen Code ein, um deinen Vault zu verbinden.",
	Cancel: "Abbrechen",
	"Code expired. Please try again.": "Der Code ist abgelaufen. Versuch es erneut.",
	"Try again": "Erneut versuchen",
	Close: "Schließen",
	"Note couldn't be processed": "Diese Notiz konnte nicht verarbeitet werden",
	"The server couldn't process this note. Check its contents, then edit and save to try again.":
		"Der Server konnte diese Notiz nicht verarbeiten. Prüf den Inhalt, dann bearbeite und speichere sie für einen neuen Versuch.",
	"Attachments need a paid plan": "Anhänge brauchen einen bezahlten Tarif",
	"The Free tier syncs notes only. Upgrade to sync images and PDFs.":
		"Der kostenlose Tarif synchronisiert nur Notizen. Für Bilder und PDFs brauchst du ein Upgrade.",
	"Attachment storage full": "Speicher für Anhänge voll",
	"You've used all the attachment storage on your plan. Upgrade for more.":
		"Du hast den Anhang-Speicher deines Tarifs aufgebraucht. Ein Upgrade bringt mehr.",
	"Too large for the server": "Zu groß für den Server",
	"The server limit is 5 MB. Compress or split the file, then it will sync.":
		"Das Serverlimit liegt bei 5 MB. Komprimiere oder teile die Datei, dann synchronisiert sie.",
	"Sign-in expired": "Anmeldung abgelaufen",
	"Reconnect your account to resume syncing.":
		"Verbinde dein Konto neu, dann läuft die Synchronisierung weiter.",
	"Unresolved conflict": "Ungelöster Konflikt",
	"Open the file to resolve the conflict, then sync again.":
		"Öffne die Datei, löse den Konflikt und synchronisiere erneut.",
	"Frontmatter needs a fix": "Frontmatter braucht eine Korrektur",
	"The note synced, but its frontmatter could not be fully parsed. Open it to fix the highlighted line.":
		"Die Notiz wurde synchronisiert, ihr Frontmatter ließ sich aber nicht vollständig lesen. Öffne sie und korrigier die markierte Zeile.",
	"Server error": "Serverfehler",
	"A temporary server problem — retrying automatically.":
		"Ein vorübergehendes Serverproblem, es wird automatisch erneut versucht.",
	"Network unavailable": "Kein Netzwerk",
	"Can't reach the server — retrying automatically.":
		"Der Server ist nicht erreichbar, es wird automatisch erneut versucht.",
	"Sync failed": "Synchronisierung fehlgeschlagen",
	"An unexpected error — retrying automatically.":
		"Ein unerwarteter Fehler, es wird automatisch erneut versucht.",
	Upgrade: "Upgrade",
	"Update in settings": "In den Einstellungen aktualisieren",
	"Engram: ready": "Engram: bereit",
	"Resume sync": "Synchronisierung fortsetzen",
	"Engram Vault Sync {version} is available. {link}.":
		"Engram Vault Sync {version} ist verfügbar. {link}.",
	"Search your vault…": "Vault durchsuchen…",
	"Filter by folder…": "Nach Ordner filtern…",
	"Filter by tags…": "Nach Tags filtern…",
	"Search failed — check connection": "Suche fehlgeschlagen, prüf die Verbindung",
	"No results found": "Keine Ergebnisse",
	"match strength: {pct}%": "Trefferstärke: {pct}%",
	"Open sync setup": "Sync-Einrichtung öffnen",
	"Last sync: {when}": "Letzte Synchronisierung: {when}",
	"waiting for a connection": "warte auf eine Verbindung",
	"sync is paused": "Synchronisierung ist pausiert",
	"syncing now": "synchronisiert gerade",
	"waiting to retry": "warte auf den nächsten Versuch",
	"{count} not on your plan": "{count} nicht in deinem Tarif",
	"{count} retrying": "{count} werden erneut versucht",
	"{count} ignored": "{count} ignoriert",
	"{count} queued — {reason}": "{count} in der Warteschlange, {reason}",
	"These files are fine. They just need a paid plan to sync.":
		"Mit diesen Dateien ist alles in Ordnung. Sie brauchen nur einen bezahlten Tarif.",
	"Show files ({count}) ▾": "Dateien anzeigen ({count}) ▾",
	"Sync these now": "Diese jetzt synchronisieren",
	"Clear all": "Alle entfernen",
	"Nothing needs your attention. 🎉": "Nichts braucht deine Aufmerksamkeit. 🎉",
	Dismiss: "Ausblenden",
	"Retry all now": "Jetzt alle erneut versuchen",
	"Temporary errors. These clear themselves once the server recovers.":
		"Vorübergehende Fehler. Die verschwinden von selbst, sobald der Server wieder da ist.",
	Open: "Öffnen",
	Ignore: "Ignorieren",
	"No files ignored. Use the ignore button on a failure row to stop syncing it.":
		"Keine Dateien ignoriert. Nutz den Ignorieren-Knopf in einer Fehlerzeile, um eine Datei nicht mehr zu synchronisieren.",
	Restore: "Wiederherstellen",
	Clear: "Entfernen",
	"No activity yet. Push or pull to see entries here.":
		"Noch keine Aktivität. Sende oder lade, dann erscheinen hier Einträge.",
	"Sync log": "Sync-Protokoll",
	"Could not compare with the cloud. Check your connection.":
		"Der Vergleich mit dem Server war nicht möglich. Prüf deine Verbindung.",
	"Your login expired. Sign in again in Engram settings to continue.":
		"Deine Anmeldung ist abgelaufen. Melde dich in Engram settings neu an, um weiterzumachen.",
	"Couldn't create vault — the name may be invalid or already in use.":
		"Vault konnte nicht erstellt werden, der Name ist vielleicht ungültig oder schon vergeben.",
	"Could not create the vault — check your connection and try again.":
		"Der Vault konnte nicht erstellt werden. Prüf deine Verbindung und versuch es erneut.",
	"Free syncs notes only — {count} attachments will be skipped.": {
		one: "Der kostenlose Tarif synchronisiert nur Notizen, {count} Anhang wird übersprungen.",
		other: "Der kostenlose Tarif synchronisiert nur Notizen, {count} Anhänge werden übersprungen.",
	},
	"Comparing your vault with the cloud…": "Dein Vault wird mit dem Server verglichen…",
	"Until you choose, nothing in this vault will sync.":
		"Bis du dich entscheidest, synchronisiert dieser Vault nichts.",
	"Change vault": "Vault wechseln",
	"Advanced sync options": "Erweiterte Sync-Optionen",
	"Everything is in sync": "Alles ist synchron",
	" conflicts need resolution": {
		one: " Konflikt muss gelöst werden",
		other: " Konflikte müssen gelöst werden",
	},
	"Confirm destructive sync": "Zerstörende Synchronisierung bestätigen",
	"You are about to:": "Folgendes passiert jetzt:",
	"Files that will be deleted:": "Dateien, die gelöscht werden:",
	"This cannot be undone.": "Das lässt sich nicht rückgängig machen.",
	Back: "Zurück",
	Confirm: "Bestätigen",
	"Switch vault": "Vault wechseln",
	"Pick a vault to sync with. We will recalculate the sync preview after you choose.":
		"Wähl den Vault zum Synchronisieren. Danach berechnen wir die Vorschau neu.",
	"Loading vaults…": "Vaults werden geladen…",
	"No other vaults available.": "Keine weiteren Vaults verfügbar.",
	"Make new vault": "Neuen Vault anlegen",
	"New vault": "Neuer Vault",
	"Create a new empty vault on the server, then sync this Obsidian vault into it.":
		"Erst einen leeren Vault auf dem Server anlegen, dann diesen Obsidian-Vault hineinsynchronisieren.",
	Create: "Anlegen",
	"Your vault shares {percent} of its data with Engram":
		"Dein Vault teilt {percent} seiner Daten mit Engram",
	"Type {keyword} to confirm:": "Tipp {keyword} zum Bestätigen:",
	"✓ {count} synced": "✓ {count} synchronisiert",
	"⤳ {count} skipped (Free plan)": "⤳ {count} übersprungen (kostenloser Tarif)",
	"✕ {count} failed": "✕ {count} fehlgeschlagen",
	"{count} attachments need a paid plan to sync. See Sync Center.": {
		one: "{count} Anhang braucht einen bezahlten Tarif. Siehe Sync Center.",
		other: "{count} Anhänge brauchen einen bezahlten Tarif. Siehe Sync Center.",
	},
	"Syncing your vault": "Dein Vault wird synchronisiert",
	"Getting started…": "Es geht los…",
	"Open Engram to check your vault and confirm everything synced.":
		"Öffne Engram, sieh dir deinen Vault an und prüf, ob alles synchronisiert ist.",
	"Open Engram": "Engram öffnen",
	"You can close this and the sync keeps running in the background.":
		"Du kannst das schließen, die Synchronisierung läuft im Hintergrund weiter.",
	"Run in background": "Im Hintergrund laufen lassen",
	"Syncing…": "Synchronisiert…",
	"Sync complete": "Synchronisierung fertig",
	Done: "Fertig",
	"Engram: sync conflict on {path} — your local edit was saved as {copy}":
		"Engram: Sync-Konflikt bei {path}, deine lokale Änderung wurde als {copy} gesichert",
	"Open note": "Notiz öffnen",
	"Engram: {count} notes have frontmatter problems. Open Sync Center to fix.":
		"Engram: Bei {count} Notizen stimmt etwas im Frontmatter nicht. Öffne das Sync Center, um es zu beheben.",
	"New here? Watch the setup video": "Neu hier? Sieh dir das Einrichtungsvideo an",
	"What Engram does, and how to connect your vault, start to finish.":
		"Was Engram macht und wie du deinen Vault verbindest, von Anfang bis Ende.",
	"▶ Watch on YouTube": "▶ Auf YouTube ansehen",
	"1. Make an account": "1. Konto anlegen",
	"2. Connect your vault to Engram": "2. Vault mit Engram verbinden",
	"Open connection tab": "Verbindungs-Tab öffnen",
	"3. Connect your AI": "3. KI verbinden",
	"Node.js dependencies": "Node.js-Abhängigkeiten",
	"Python virtual environment": "Python-Umgebung",
	"Python bytecode cache": "Python-Bytecode-Cache",
	"Vendored dependencies": "Mitgelieferte Abhängigkeiten",
	"Gradle build cache": "Gradle-Build-Cache",
	"Rust/Java build output": "Rust/Java-Build-Ausgabe",
	"Build output": "Build-Ausgabe",
	"Next.js build output": "Next.js-Build-Ausgabe",
	"Distribution build output": "Build-Ausgabe für die Verteilung",
	"Cargo cache": "Cargo-Cache",
	"CocoaPods dependencies": "CocoaPods-Abhängigkeiten",
	"Dart tool cache": "Dart-Werkzeug-Cache",
	"Generic cache directory": "Allgemeines Cache-Verzeichnis",
	"Ignore patterns": "Ignorier-Muster",
	"Custom patterns": "Eigene Muster",
	Diagnostics: "Diagnose",
	"Diagnostics detail": "Diagnose im Detail",
	About: "Über",
	"License: {name}": "Lizenz: {name}",
	"⚠ Detected: {label}/ ({formatted} files)": "⚠ Gefunden: {label}/ ({formatted} Dateien)",
	"{desc} — should not be synced": "{desc}, sollte nicht synchronisiert werden",
	"Add to ignores": "Zu den Ignorierten",
	"Version: {version}": "Version: {version}",
	"Source: {link}": "Quelle: {link}",
	"Engram URL": "Engram-Adresse",
	"✓ Engram server reachable (v{version})": "✓ Engram-Server erreichbar (v{version})",
	"✗ server responded but isn't an Engram backend":
		"✗ Der Server antwortet, ist aber kein Engram-Backend",
	"✗ couldn't reach a server at this URL": "✗ Unter dieser Adresse war kein Server erreichbar",
	"Checking server…": "Server wird geprüft…",
	Authentication: "Anmeldung",
	"Authenticated via Engram account (OAuth).": "Über Engram-Konto angemeldet (OAuth).",
	"Manage account": "Konto verwalten",
	"Sign out": "Abmelden",
	"Using API key": "API-Schlüssel wird genutzt",
	"Authenticated via manual API key.":
		"Über einen manuell eingetragenen API-Schlüssel angemeldet.",
	"Clear key": "Schlüssel löschen",
	"Switch to sign in": "Zur Anmeldung wechseln",
	"Sign in or create an account": "Anmelden oder Konto anlegen",
	"Sign in": "Anmelden",
	"API key": "API-Schlüssel",
	Token: "Token",
	"Bearer token from your Engram account.": "Bearer-Token aus deinem Engram-Konto.",
	Save: "Speichern",
	"That does not look like an Engram API key (expected {prefix}…).":
		"Das sieht nicht wie ein Engram-API-Schlüssel aus (erwartet wird {prefix}…).",
	Vault: "Vault",
	"Vault selection": "Vault-Auswahl",
	"Select which vault this plugin syncs with.":
		"Wähl den Vault, mit dem dieses Plugin synchronisiert.",
	"No vaults found — first sync will create one":
		"Keine Vaults gefunden, die erste Synchronisierung legt einen an",
	"Pick a vault": "Vault wählen",
	Change: "Ändern",
	"Support development": "Entwicklung unterstützen",
	"GitHub Sponsors": "GitHub Sponsors",
	Backend: "Backend",
	"Where this vault syncs to. Each backend keeps its own sign-in.":
		"Wohin dieser Vault synchronisiert. Jedes Backend hat seine eigene Anmeldung.",
	"Run your own Engram server": "Eigenen Engram-Server betreiben",
	"Engram is the backend that powers sync and semantic search.":
		"Engram ist das Backend hinter Synchronisierung und semantischer Suche.",
	"Finish sync setup": "Sync-Einrichtung abschließen",
	"Nothing in this vault syncs until you choose how to merge it with the server.":
		"Dieser Vault synchronisiert nichts, bis du entschieden hast, wie er mit dem Server zusammengeführt wird.",
	"Choose sync direction": "Sync-Richtung wählen",
	"Engram: this plugin is too old to sync (needs {version} or newer). Update it to continue.":
		"Engram: Dieses Plugin ist zu alt zum Synchronisieren (nötig ist {version} oder neuer). Aktualisier es, um weiterzumachen.",
	"Engram: this plugin is too old to sync. Update it to continue.":
		"Engram: Dieses Plugin ist zu alt zum Synchronisieren. Aktualisier es, um weiterzumachen.",
	Update: "Aktualisieren",
	// UI strings (second pass)
	"Invalid API key": "API-Schlüssel ungültig",
	"Connection failed": "Verbindung fehlgeschlagen",
	"Sync now": "Jetzt synchronisieren",
	"Disconnect (clear login)": "Verbindung trennen (Anmeldung löschen)",
	"Push entire vault": "Ganzen Vault senden",
	"Check sync status": "Sync-Status prüfen",
	"Engram sync: server does not support reconciliation (update backend)":
		"Engram Sync: Der Server kann nicht abgleichen (Backend aktualisieren)",
	"Pull all from server (force overwrite)": "Alles vom Server laden (überschreibt lokal)",
	"Show sync log": "Sync-Protokoll anzeigen",
	"Semantic search": "Semantische Suche",
	"Open search sidebar": "Suchleiste öffnen",
	"Engram search": "Engram-Suche",
	"Open sync center": "Sync Center öffnen",
	"Engram: this vault no longer exists on the server. Pick or create a vault to continue.":
		"Engram: Dieser Vault existiert auf dem Server nicht mehr. Wähl einen Vault oder leg einen an, um weiterzumachen.",
	"Engram: recovered plugin settings from a backup after a corrupted save.":
		"Engram: Die Einstellungen waren beschädigt und wurden aus einem Backup wiederhergestellt.",
	"Engram sync: live sync requires a plugin update — please update the Engram vault sync plugin.":
		"Engram Sync: Live-Sync braucht ein Plugin-Update. Aktualisier bitte Engram vault sync.",
	"Engram: sync is paused — this edit was not synced. Choose a sync direction to resume.":
		"Engram: Die Synchronisierung ist pausiert, diese Änderung wurde nicht übertragen. Wähl eine Sync-Richtung, um fortzusetzen.",
	"Engram: not connected": "Engram: nicht verbunden",
	"Engram: signed out": "Engram: abgemeldet",
	"Not connected yet. Click to open settings and link this vault.":
		"Noch nicht verbunden. Klick, um die Einstellungen zu öffnen und diesen Vault zu verbinden.",
	"Not signed in. Click to open settings and reconnect.":
		"Nicht angemeldet. Klick, um die Einstellungen zu öffnen und dich neu zu verbinden.",
	"Engram: finish setup": "Engram: Einrichtung abschließen",
	"Engram: sync paused": "Engram: Sync pausiert",
	"{label} ({count} queued)": "{label} ({count} in der Warteschlange)",
	"Setup is not finished — nothing will sync until you choose a sync direction. Click to finish.":
		"Die Einrichtung ist nicht fertig. Bis du eine Sync-Richtung wählst, wird nichts synchronisiert. Klick, um sie abzuschließen.",
	"Sync paused — click to choose a sync direction":
		"Sync pausiert, klick, um eine Richtung zu wählen",
	"Engram: offline ({count} queued)": "Engram: offline ({count} in der Warteschlange)",
	"Engram: offline": "Engram: offline",
	"Server unreachable — changes will sync when connected":
		"Server nicht erreichbar, Änderungen gehen raus, sobald es wieder geht",
	"Engram: error": "Engram: Fehler",
	"Unknown error": "Unbekannter Fehler",
	"Engram: syncing ({count})": "Engram: synchronisiert ({count})",
	"Engram: syncing": "Engram: synchronisiert",
	"Sync in progress...": "Synchronisierung läuft …",
	"Engram: pending ({count})": "Engram: ausstehend ({count})",
	"{count} files queued": "{count} Dateien in der Warteschlange",
	"Engram: live": "Engram: live",
	"WebSocket connected — live sync active": "WebSocket verbunden, Live-Sync ist aktiv",
	"Click to sync": "Klick zum Synchronisieren",
	Attachments: "Anhänge",
	Keyword: "Stichwort",
	Semantic: "Semantisch",
	Both: "Beides",
	"matches your words and their other forms — 'run' finds 'running' — plus this device.":
		"Findet deine Wörter und ihre Formen, „lauf“ findet auch „laufen“, und dazu dieses Gerät.",
	"matches meaning. Finds notes that never use the words you typed.":
		"Findet nach Bedeutung, auch Notizen, in denen deine Wörter nie vorkommen.",
	"matches words and meaning together, plus this device. Widest results.":
		"Findet Wörter und Bedeutung zusammen, plus dieses Gerät. Die breiteste Suche.",
	"Clear search": "Suche leeren",
	"Search settings": "Sucheinstellungen",
	Untitled: "Ohne Titel",
	"meaning + exact": "Bedeutung + genau",
	Disconnected: "Nicht verbunden",
	"Connected — waiting for first sync decision":
		"Verbunden, wartet auf die erste Sync-Entscheidung",
	"Connected — live sync active": "Verbunden, Live-Sync ist aktiv",
	"Connected — polling": "Verbunden, fragt regelmäßig ab",
	"Not configured": "Nicht eingerichtet",
	Refresh: "Neu laden",
	"Not synced on your plan ({count})": "Nicht in deinem Tarif ({count})",
	"Needs attention ({count})": "Braucht Aufmerksamkeit ({count})",
	"Retrying automatically ({count})": "Wird automatisch wiederholt ({count})",
	Stats: "Zahlen",
	"Notes on this device": "Notizen auf diesem Gerät",
	"Attachments on this device": "Anhänge auf diesem Gerät",
	"Remote vault": "Vault auf dem Server",
	"not linked": "nicht verknüpft",
	"Plan usage": "Tarifnutzung",
	"Safe choice: combines both sides, nothing is deleted.":
		"Sichere Wahl: verbindet beide Seiten, nichts wird gelöscht.",
	"Already in sync. Nothing is deleted.": "Schon synchron. Nichts wird gelöscht.",
	Sync: "Synchronisieren",
	"Upload local files without downloading the remote":
		"Lokale Dateien senden, ohne vom Server zu laden",
	"Delete all on remote, then upload local files":
		"Alles auf dem Server löschen, dann lokale Dateien senden",
	"Download remote files without uploading the local":
		"Dateien vom Server laden, ohne lokale zu senden",
	"Delete all local files, then download from remote":
		"Alle lokalen Dateien löschen, dann vom Server laden",
	"Set up sync for this vault": "Sync für diesen Vault einrichten",
	"You are now pointing at a different cloud vault":
		"Du zeigst jetzt auf einen anderen Cloud-Vault",
	"Sync preview": "Sync-Vorschau",
	"Start syncing": "Sync starten",
	"Upload everything": "Alles senden",
	"Nothing will be removed from this device.": "Von diesem Gerät wird nichts entfernt.",
	"Download everything": "Alles laden",
	"Not now": "Später",
	"This vault": "Dieser Vault",
	"Cloud server": "Vault auf dem Server",
	"Vault name": "Name des Vaults",
	"Could not load vaults": "Vaults konnten nicht geladen werden",
	"Enter a name for the new vault": "Gib dem neuen Vault einen Namen",
	"Failed to switch vault": "Vault-Wechsel fehlgeschlagen",
	"Finished with some errors. Open the sync log to see what failed.":
		"Mit einigen Fehlern beendet. Im Sync-Protokoll steht, was nicht ging.",
	"Synced. Some attachments need a paid plan to sync (see below).":
		"Synchronisiert. Ein Teil der Anhänge braucht einen bezahlten Tarif (siehe unten).",
	"All synced. Your vault and the cloud now match.":
		"Alles synchron. Dein Vault und die Cloud stimmen überein.",
	"Already up to date. Nothing needed syncing.":
		"Schon aktuell. Es gab nichts zu synchronisieren.",
	Deleting: "Löscht",
	Downloading: "Lädt herunter",
	Uploading: "Lädt hoch",
	"Syncing attachments": "Synchronisiert Anhänge",
	Complete: "Fertig",
	"Getting set up": "Einrichtung",
	"setup guide": "Einrichtungsanleitung",
	"Sign in (or enter your server URL and key) on the connection tab, then run your first sync.":
		"Melde dich im Verbindungs-Tab an (oder trag Server-URL und Schlüssel ein) und starte deine erste Synchronisierung.",
	"See the AI setup guide": "Zur KI-Einrichtungsanleitung",
	Plans: "Tarife",
	Free: "Kostenlos",
	"1 vault, 2 devices": "1 Vault, 2 Geräte",
	"Real-time sync": "Synchronisierung in Echtzeit",
	"2,000 notes searchable": "2.000 Notizen durchsuchbar",
	"Connect any AI (MCP)": "Jede KI verbinden (MCP)",
	Starter: "Starter",
	"10 vaults, unlimited devices": "10 Vaults, beliebig viele Geräte",
	"Search all your notes": "Alle deine Notizen durchsuchen",
	"10 GB attachments": "10 GB Anhänge",
	"Unlimited AI searches": "Unbegrenzte KI-Suchen",
	Pro: "Pro",
	"Unlimited vaults": "Beliebig viele Vaults",
	"Search across all vaults at once": "Alle Vaults auf einmal durchsuchen",
	"50 GB attachments": "50 GB Anhänge",
	"API access": "API-Zugang",
	"See full pricing": "Alle Preise ansehen",
	"Learn more": "Mehr erfahren",
	"Errors only": "Nur Fehler",
	"Warnings and errors": "Warnungen und Fehler",
	"Info (default)": "Info (Standard)",
	"Debug (verbose)": "Debug (ausführlich)",
	"Or authenticate with a token instead of signing in.":
		"Oder mit einem Token authentifizieren statt anzumelden.",
	"If this plugin saves you time, consider supporting development.":
		"Wenn dir dieses Plugin Zeit spart, denk über eine Unterstützung nach.",
	"Sign-in required to load vaults": "Zum Laden der Vaults ist eine Anmeldung nötig",
	"Could not reach Engram — check connection": "Engram nicht erreichbar, prüf die Verbindung",
	// UI strings (sync error surfaces)
	"Free syncs notes only — images & PDFs need a paid plan.":
		"Der kostenlose Tarif synchronisiert nur Notizen, Bilder und PDFs brauchen einen bezahlten Tarif.",
	"Pull all (delete extras) aborted: could not obtain an exclusive server snapshot (replay contention). Nothing was trashed.":
		"„Alles laden (Extras löschen)“ abgebrochen: kein exklusiver Server-Snapshot zu bekommen (Replay-Konflikt). Es wurde nichts in den Papierkorb verschoben.",
	"Pull all aborted: another sync is running (replay contention). Try again when it finishes.":
		"„Alles laden“ abgebrochen: eine andere Synchronisierung läuft (Replay-Konflikt). Versuch es erneut, wenn sie fertig ist.",
	"Pull all failed: {error}": "„Alles laden“ fehlgeschlagen: {error}",
	"Pull all failed": "„Alles laden“ fehlgeschlagen",
	// UI strings (third pass)
	"Click to copy": "Zum Kopieren klicken",
	"Waiting for authorization — connected, this will complete instantly.":
		"Warte auf die Autorisierung: verbunden, das ist sofort erledigt.",
	"Waiting for authorization — no live connection, checking every 30s.":
		"Warte auf die Autorisierung: keine Live-Verbindung, Prüfung alle 30 Sekunden.",
	'Engram Sync: sync state for "{name}" was unreadable — using the on-disk copy.':
		"Engram Sync: Der Sync-Status von „{name}“ war nicht lesbar, es wird die Kopie auf der Festplatte verwendet.",
	"{formatted} files · ": {
		one: "{formatted} Datei · ",
		other: "{formatted} Dateien · ",
	},
	"Notes searchable": "Durchsuchbare Notizen",
	"Notes past this still sync and open normally, they are just not in the search index. The index keeps your oldest notes, so it is your newest ones that fall outside.":
		"Notizen darüber hinaus werden weiterhin normal synchronisiert und geöffnet, sie sind nur nicht im Suchindex. Der Index behält deine ältesten Notizen, es fallen also die neuesten heraus.",
	"Notes stored": "Gespeicherte Notizen",
	"AI searches": "KI-Suchen",
	"{formatted} per day": "{formatted} pro Tag",
	"Engram indexes {indexed} of your {all} notes. The rest match on this device only. Upgrade to index everything.":
		"Engram indexiert {indexed} von deinen {all} Notizen. Der Rest wird nur auf diesem Gerät gefunden. Mit einem Upgrade wird alles indexiert.",
	"Searching {indexed} of {all} notes. Upgrade to search everything.":
		"Es werden {indexed} von {all} Notizen durchsucht. Mit einem Upgrade wird alles durchsucht.",
	"Remove tag {tag}": "Tag {tag} entfernen",
	"👋 Welcome": "👋 Willkommen",
	"🔌 Connection": "🔌 Verbindung",
	"🔄 Sync Center": "🔄 Sync Center",
	"⚙️ Advanced": "⚙️ Erweitert",
	"Error: {error}": "Fehler: {error}",
	unknown: "unbekannt",
	"{count} need attention": {
		one: "{count} braucht Aufmerksamkeit",
		other: "{count} brauchen Aufmerksamkeit",
	},
	"Uploads {up}, downloads {down}.": "Lädt {up} hoch, {down} herunter.",
	"Uploads {count}.": "Lädt {count} hoch.",
	"Downloads {count}.": "Lädt {count} herunter.",
	"{count} conflicts to resolve.": {
		one: "{count} Konflikt muss gelöst werden.",
		other: "{count} Konflikte müssen gelöst werden.",
	},
	"Nothing is deleted.": "Es wird nichts gelöscht.",
	"Delete all {count} files currently on the server": {
		one: "Die {count} Datei löschen, die derzeit auf dem Server liegt",
		other: "Alle {count} Dateien löschen, die derzeit auf dem Server liegen",
	},
	"Upload {count} files from this vault": {
		one: "{count} Datei aus diesem Vault hochladen",
		other: "{count} Dateien aus diesem Vault hochladen",
	},
	"Delete all {count} files in this vault": {
		one: "Die {count} Datei in diesem Vault löschen",
		other: "Alle {count} Dateien in diesem Vault löschen",
	},
	"Download {count} files from the server": {
		one: "{count} Datei vom Server herunterladen",
		other: "{count} Dateien vom Server herunterladen",
	},
	"Nothing to sync yet — this vault is empty on both sides. Start syncing and everything you write appears on your other devices.":
		"Noch nichts zu synchronisieren, dieser Vault ist auf beiden Seiten leer. Starte die Synchronisierung und alles, was du schreibst, erscheint auf deinen anderen Geräten.",
	"{count} notes": {
		one: "{count} Notiz",
		other: "{count} Notizen",
	},
	"{count} attachments": {
		one: "{count} Anhang",
		other: "{count} Anhänge",
	},
	"{first} and {second}": "{first} und {second}",
	files: "Dateien",
	"This vault is empty on the server. Upload your {what}?":
		"Dieser Vault ist auf dem Server leer. {what} hochladen?",
	"This device's vault is empty. Download {what} from the server?":
		"Der Vault auf diesem Gerät ist leer. {what} vom Server herunterladen?",
	notes: "Notizen",
	attachments: "Anhänge",
	folders: "Ordner",
	"Uploading {count}.": "{count} werden hochgeladen.",
	"Downloading {count}.": "{count} werden heruntergeladen.",
	"Deleting {count} local files.": "{count} lokale Dateien werden gelöscht.",
	"Deleting {count} on the cloud.": "{count} werden in der Cloud gelöscht.",
	"First sync, this may take a moment.": "Erste Synchronisierung, das kann einen Moment dauern.",
	"Checking for changes.": "Änderungen werden geprüft.",
	"Nothing will be deleted.": "Es wird nichts gelöscht.",
	'{count} failed. Run "{command}" for details.':
		"{count} fehlgeschlagen. Führe „{command}“ für Details aus.",
	'Engram Sync: renamed "{name}" (unsupported characters)':
		"Engram Sync: „{name}“ wurde umbenannt (nicht unterstützte Zeichen)",
	'Engram: frontmatter problem in "{name}"': "Engram: Frontmatter-Problem in „{name}“",
	"Create a hosted account at ": "Erstelle ein gehostetes Konto bei ",
	", or self-host the backend (": ", oder hoste das Backend selbst (",
	"Link Claude, Cursor, ChatGPT, or any MCP app so it can read and write your notes. ":
		"Verbinde Claude, Cursor, ChatGPT oder eine beliebige MCP-App, damit sie deine Notizen lesen und schreiben kann. ",
	Documentation: "Dokumentation",
	"AI / MCP setup guide": "Anleitung zur KI-/MCP-Einrichtung",
	"Report an issue": "Problem melden",
	"Join our Discord": "Tritt unserem Discord bei",
	"Paths to skip (one per line). Folder patterns end with /. Built-in: {configDir}/, .trash/, .git/":
		"Zu überspringende Pfade (einer pro Zeile). Ordnermuster enden mit /. Eingebaut: {configDir}/, .trash/, .git/",
	"Send detailed sync, vault, and connection activity to the server for troubleshooting, with distributed tracing on requests. Metadata only, never note content. Leave off for normal use.":
		"Sendet detaillierte Sync-, Vault- und Verbindungsaktivität zur Fehlersuche an den Server, mit verteiltem Tracing für Anfragen. Nur Metadaten, niemals Notizinhalte. Für den normalen Gebrauch ausgeschaltet lassen.",
	"Minimum severity that ships while diagnostics are on. Higher levels send fewer lines. Default: Info.":
		"Mindestschwere, die bei aktivierter Diagnose gesendet wird. Höhere Stufen senden weniger Zeilen. Standard: Info.",
	"Signed in as {email}": "Angemeldet als {email}",
	"Pick a vault (previous: '{name}' not found)":
		"Wähle einen Vault (vorheriger: „{name}“ nicht gefunden)",
	"Pick a vault (previous: id {id} not found)":
		"Wähle einen Vault (vorherige ID {id} nicht gefunden)",
	"Server error ({status}) — check Engram logs": "Serverfehler ({status}), prüfe die Engram-Logs",
	"Request failed ({status})": "Anfrage fehlgeschlagen ({status})",
	"Engram Cloud": "Engram Cloud",
	"Self-hosted": "Selbst gehostet",
	"{count} attempts": {
		one: "{count} Versuch",
		other: "{count} Versuche",
	},
	// UI strings (fourth pass)
	"{count} missing on server": {
		one: "{count} fehlt auf dem Server",
		other: "{count} fehlen auf dem Server",
	},
	"{count} diverged": "{count} abgewichen",
	"{count} only on server": "{count} nur auf dem Server",
	"Engram Sync: {details}": "Engram Sync: {details}",
	"Engram: plugin settings file was corrupted and could not be recovered. You may need to reconnect in settings.":
		"Engram: Die Einstellungsdatei des Plugins war beschädigt und ließ sich nicht wiederherstellen. Du musst dich in den Einstellungen vielleicht neu verbinden.",
	"Engram: sync is not set up yet, so nothing in this vault will sync.":
		"Engram: Die Synchronisierung ist noch nicht eingerichtet, es wird also nichts aus diesem Vault synchronisiert.",
	"Click the Engram item in the status bar to pick up where you left off.":
		"Klicke in der Statusleiste auf Engram, um da weiterzumachen, wo du aufgehört hast.",
	"Engram: ⚠ {count} sync errors": "Engram: ⚠ {count} Sync-Fehler",
	"sync failed": "Synchronisierung fehlgeschlagen",
	"That does not look like a complete server address. Include the scheme, for example http://127.0.0.1:4000":
		"Das sieht nicht wie eine vollständige Serveradresse aus. Gib das Schema mit an, zum Beispiel http://127.0.0.1:4000",
	"Opens your browser to sign in, or create an account if you don't have one yet, then links this vault.":
		"Öffnet deinen Browser zum Anmelden, oder zum Erstellen eines Kontos, falls du noch keins hast, und verknüpft dann diesen Vault.",
	"Or authenticate with a token instead of signing in. Engram Cloud API keys require the Pro plan; on Free and Starter, sign in above.":
		"Oder authentifiziere dich mit einem Token statt per Anmeldung. API-Schlüssel für Engram Cloud brauchen den Pro-Tarif; melde dich bei Free und Starter oben an.",
	"No sync activity this session.": "In dieser Sitzung gibt es keine Sync-Aktivität.",
	"Showing {count} entries": {
		one: "{count} Eintrag wird angezeigt",
		other: "{count} Einträge werden angezeigt",
	},
	"({count} errors)": "({count} Fehler)",
	"Frontmatter could not be parsed": "Frontmatter konnte nicht gelesen werden",
	"Not connected. Enter your Engram server URL below to start syncing.":
		"Nicht verbunden. Trage unten die Adresse deines Engram-Servers ein, um mit dem Synchronisieren zu beginnen.",
	// UI strings (fifth pass)
	"Sync...": "Synchronisieren...",
	"Syncing...": "Wird synchronisiert...",
	" (default)": " (Standard)",
};

export default de;
