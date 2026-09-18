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
};

export default de;
