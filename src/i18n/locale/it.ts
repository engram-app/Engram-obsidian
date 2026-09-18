import type { Dict } from "..";

// Italiano
const it: Dict = {
	"Code copied!": "Codice copiato.",
	"Engram sync: syncing...": "Engram Sync: sincronizzazione…",
	"Engram Sync: pulled {pulled}, pushed {pushed}":
		"Engram Sync: {pulled} scaricati, {pushed} inviati",
	"Engram: disconnected. Open Engram settings to reconnect.":
		"Engram: disconnesso. Apri Engram settings per riconnetterti.",
	"Engram sync: checking...": "Engram Sync: controllo…",
	"Engram sync: everything in sync": "Engram Sync: tutto sincronizzato",
	"Engram sync: pulling all from server...": "Engram Sync: scarico tutto dal server…",
	"Engram Sync: pushed {pushed}": "Engram Sync: {pushed} inviati",
	"Engram sync: sync failed": "Engram Sync: sincronizzazione non riuscita",
	"Engram: your login expired — open Engram settings to reconnect.":
		"Engram: la sessione è scaduta. Apri Engram settings per riconnetterti.",
	"Engram: This vault has been deleted on the server.":
		"Engram: questo archivio è stato eliminato sul server.",
	"Engram Sync: pulled {pulled} (local extras deleted)":
		"Engram Sync: {pulled} scaricati (file locali in eccesso eliminati)",
	"Engram Sync: pulled {pulled}": "Engram Sync: {pulled} scaricati",
	"Engram Sync: replaced remote with local ({pushed} uploaded)":
		"Engram Sync: il server è stato sostituito con la versione locale ({pushed} inviati)",
	"Engram: sync failed. Open the sync log for details.":
		"Engram: sincronizzazione non riuscita. I dettagli sono nel registro di sincronizzazione.",
	"Engram unreachable. Showing matches from this device only.":
		"Engram non raggiungibile. Vengono mostrati solo i risultati di questo dispositivo.",
	"No source path for this result": "Questo risultato non ha un percorso di origine",
	"Note not synced locally": "Questa nota non è ancora sincronizzata in locale",
	"Engram: settings tab failed to render ({error})":
		"Engram: non è stato possibile mostrare la scheda delle impostazioni ({error})",
	"File not found locally: {path}": "File non trovato in locale: {path}",
	"Restored {path} — will sync on next push.":
		"{path} ripristinato, verrà sincronizzato al prossimo invio.",
	"Ignored {path} — won't sync until restored from Sync Center.":
		"{path} ignorato, non verrà sincronizzato finché non lo ripristini dal Sync Center.",
	"Added {pattern} to ignore patterns": "{pattern} aggiunto ai modelli da ignorare",
	"Engram backend changed — sign in again to continue.":
		"Il server di Engram è cambiato. Accedi di nuovo per continuare.",
	"Engram: sign-in failed ({error})": "Engram: accesso non riuscito ({error})",
	"Enter an API key first": "Inserisci prima una chiave API",
	"Switched to {mode}.": "Passato a {mode}.",

	"Engram Sync: pushed {count} files": {
		one: "Engram Sync: {count} file inviato",
		other: "Engram Sync: {count} file inviati",
	},
	"Engram Sync: pulled {count} files from server": {
		one: "Engram Sync: {count} file scaricato dal server",
		other: "Engram Sync: {count} file scaricati dal server",
	},
	"Engram Sync: pulled {count} changes": {
		one: "Engram Sync: {count} modifica scaricata",
		other: "Engram Sync: {count} modifiche scaricate",
	},
	"Engram: {count} files failed to sync{detail} — open Sync Center": {
		one: "Engram: {count} file non si è sincronizzato{detail}. Apri il Sync Center",
		other: "Engram: {count} file non si sono sincronizzati{detail}. Apri il Sync Center",
	},
	"Engram: {count} attachments skipped — upgrade to sync images & PDFs.": {
		one: "Engram: {count} allegato ignorato. Passa a un piano superiore per immagini e PDF.",
		other: "Engram: {count} allegati ignorati. Passa a un piano superiore per immagini e PDF.",
	},
	"Engram: plan upgraded — syncing {count} attachments…": {
		one: "Engram: piano aggiornato, sincronizzo {count} allegato…",
		other: "Engram: piano aggiornato, sincronizzo {count} allegati…",
	},
	// 402 limit reasons (limit-copy.ts). These gate payment, so they are the
	// highest-value strings in the plugin to get right.
	"Note limit reached. Upgrade to keep adding notes.":
		"Hai raggiunto il limite di note. Passa a un piano superiore per aggiungerne altre.",
	"Vault limit reached. Upgrade for more vaults.":
		"Hai raggiunto il limite di archivi. Un piano superiore ne consente di più.",
	"This file type isn't accepted by this server.":
		"Questo server non accetta questo tipo di file.",
	"Attachment sync is disabled for this account.":
		"Per questo account la sincronizzazione degli allegati è disattivata.",
	"Attachment storage is full — upgrade for more.":
		"Lo spazio per gli allegati è pieno. Un piano superiore ne offre di più.",
	"File too large for your plan.": "Il file è troppo grande per il tuo piano.",
	"Already signed in on another device. Upgrade for multi-device.":
		"Hai già effettuato l'accesso su un altro dispositivo. Un piano superiore ne consente più di uno.",
	"Device swap cooldown active. Wait or upgrade.":
		"Il cambio di dispositivo è ancora in attesa. Aspetta un momento o passa a un piano superiore.",
	"Too many connected Obsidian vaults. Disconnect one or upgrade.":
		"Troppi archivi Obsidian collegati. Scollegane uno o passa a un piano superiore.",
	"Too many connected AI clients. Disconnect one or upgrade.":
		"Troppi client IA collegati. Scollegane uno o passa a un piano superiore.",
	"Daily AI search limit reached. Free includes 20 per day across Obsidian, the web app and MCP. Upgrade for unlimited.":
		"Hai raggiunto il limite giornaliero di ricerche IA. Il piano gratuito include 20 al giorno fra Obsidian, l'app web e MCP. Un piano superiore lo elimina.",
	"API keys need Pro. Sign in with your Engram account instead.":
		"Le chiavi API richiedono il piano Pro. Accedi invece con il tuo account Engram.",
	"Account suspended. Contact support.": "Account sospeso. Contatta l'assistenza.",
	"Account setup incomplete.": "La configurazione dell'account non è completa.",
	"This account was deleted. Contact support if that is wrong.":
		"Questo account è stato eliminato. Se non è corretto, contatta l'assistenza.",
	"Finish setting up your account at app.engram.page to start syncing.":
		"Completa la configurazione dell'account su app.engram.page per iniziare a sincronizzare.",
	"Limit reached. Upgrade to continue.":
		"Hai raggiunto il limite. Passa a un piano superiore per continuare.",
	// UI strings
	"Link Obsidian to Engram": "Collega Obsidian a Engram",
	"Failed to start device flow. Check your Engram URL and try again.":
		"Non è stato possibile avviare l'abbinamento del dispositivo. Controlla l'indirizzo del tuo Engram e riprova.",
	"Your code:": "Il tuo codice:",
	"A browser window has opened. Sign in and enter this code to link your vault.":
		"Si è aperta una finestra del browser. Accedi e inserisci questo codice per collegare il tuo archivio.",
	Cancel: "Annulla",
	"Code expired. Please try again.": "Il codice è scaduto. Riprova.",
	"Try again": "Riprova",
	Close: "Chiudi",
	"Note couldn't be processed": "Non è stato possibile elaborare questa nota",
	"The server couldn't process this note. Check its contents, then edit and save to try again.":
		"Il server non ha potuto elaborare questa nota. Controlla il contenuto, poi modificala e salvala per riprovare.",
	"Attachments need a paid plan": "Gli allegati richiedono un piano a pagamento",
	"The Free tier syncs notes only. Upgrade to sync images and PDFs.":
		"Il piano gratuito sincronizza solo le note. Passa a un piano superiore per immagini e PDF.",
	"Attachment storage full": "Spazio per gli allegati esaurito",
	"You've used all the attachment storage on your plan. Upgrade for more.":
		"Hai usato tutto lo spazio per allegati del tuo piano. Passa a un piano superiore per averne di più.",
	"Too large for the server": "Troppo grande per il server",
	"The server limit is 5 MB. Compress or split the file, then it will sync.":
		"Il limite del server è 5 MB. Comprimi o dividi il file e si sincronizzerà.",
	"Sign-in expired": "Accesso scaduto",
	"Reconnect your account to resume syncing.":
		"Ricollega il tuo account per riprendere la sincronizzazione.",
	"Unresolved conflict": "Conflitto non risolto",
	"Open the file to resolve the conflict, then sync again.":
		"Apri il file, risolvi il conflitto e sincronizza di nuovo.",
	"Frontmatter needs a fix": "Il frontmatter va corretto",
	"The note synced, but its frontmatter could not be fully parsed. Open it to fix the highlighted line.":
		"La nota è stata sincronizzata, ma il suo frontmatter non è stato letto del tutto. Aprila e correggi la riga evidenziata.",
	"Server error": "Errore del server",
	"A temporary server problem — retrying automatically.":
		"Un problema temporaneo del server: nuovo tentativo automatico.",
	"Network unavailable": "Rete non disponibile",
	"Can't reach the server — retrying automatically.":
		"Server non raggiungibile: nuovo tentativo automatico.",
	"Sync failed": "Sincronizzazione non riuscita",
	"An unexpected error — retrying automatically.":
		"Un errore inatteso: nuovo tentativo automatico.",
	Upgrade: "Passa a un piano superiore",
	"Update in settings": "Aggiorna nelle impostazioni",
	"Engram: ready": "Engram: pronto",
	"Resume sync": "Riprendi la sincronizzazione",
	"Engram Vault Sync {version} is available. {link}.":
		"Engram Vault Sync {version} è disponibile. {link}.",
	"Search your vault…": "Cerca nel tuo archivio…",
	"Filter by folder…": "Filtra per cartella…",
	"Filter by tags…": "Filtra per tag…",
	"Search failed — check connection": "Ricerca non riuscita, controlla la connessione",
	"No results found": "Nessun risultato",
	"match strength: {pct}%": "Corrispondenza: {pct}%",
	"Open sync setup": "Apri la configurazione della sincronizzazione",
	"Last sync: {when}": "Ultima sincronizzazione: {when}",
	"waiting for a connection": "in attesa di una connessione",
	"sync is paused": "la sincronizzazione è in pausa",
	"syncing now": "sincronizzazione in corso",
	"waiting to retry": "in attesa di riprovare",
	"{count} not on your plan": "{count} fuori dal tuo piano",
	"{count} retrying": "{count} in nuovo tentativo",
	"{count} ignored": "{count} ignorati",
	"{count} queued — {reason}": "{count} in coda, {reason}",
	"These files are fine. They just need a paid plan to sync.":
		"Questi file vanno bene. Serve solo un piano a pagamento per sincronizzarli.",
	"Show files ({count}) ▾": "Mostra i file ({count}) ▾",
	"Sync these now": "Sincronizza questi adesso",
	"Clear all": "Cancella tutto",
	"Nothing needs your attention. 🎉": "Non c'è nulla che richieda la tua attenzione. 🎉",
	Dismiss: "Nascondi",
	"Retry all now": "Riprova tutto adesso",
	"Temporary errors. These clear themselves once the server recovers.":
		"Errori temporanei. Si risolvono da soli quando il server torna disponibile.",
	Open: "Apri",
	Ignore: "Ignora",
	"No files ignored. Use the ignore button on a failure row to stop syncing it.":
		"Nessun file ignorato. Usa il pulsante di ignoramento su una riga con errore per non sincronizzarlo più.",
	Restore: "Ripristina",
	Clear: "Cancella",
	"No activity yet. Push or pull to see entries here.":
		"Ancora nessuna attività. Invia o scarica e qui compariranno le voci.",
	"Sync log": "Registro di sincronizzazione",
	"Could not compare with the cloud. Check your connection.":
		"Non è stato possibile confrontare con il server. Controlla la connessione.",
	"Your login expired. Sign in again in Engram settings to continue.":
		"Il tuo accesso è scaduto. Accedi di nuovo in Engram settings per continuare.",
	"Couldn't create vault — the name may be invalid or already in use.":
		"Non è stato possibile creare l'archivio: il nome potrebbe non essere valido o già in uso.",
	"Could not create the vault — check your connection and try again.":
		"Non è stato possibile creare l'archivio: controlla la connessione e riprova.",
	"Free syncs notes only — {count} attachments will be skipped.": {
		one: "Il piano gratuito sincronizza solo le note: {count} allegato verrà ignorato.",
		other: "Il piano gratuito sincronizza solo le note: {count} allegati verranno ignorati.",
	},
	"Comparing your vault with the cloud…": "Confronto del tuo archivio con il server…",
	"Until you choose, nothing in this vault will sync.":
		"Finché non scegli, in questo archivio non si sincronizza nulla.",
	"Change vault": "Cambia archivio",
	"Advanced sync options": "Opzioni avanzate di sincronizzazione",
	"Everything is in sync": "Tutto è sincronizzato",
	" conflicts need resolution": {
		one: " conflitto da risolvere",
		other: " conflitti da risolvere",
	},
	"Confirm destructive sync": "Conferma una sincronizzazione distruttiva",
	"You are about to:": "Ecco cosa succederà:",
	"Files that will be deleted:": "File che verranno eliminati:",
	"This cannot be undone.": "Non si può annullare.",
	Back: "Indietro",
	Confirm: "Conferma",
	"Switch vault": "Cambia archivio",
	"Pick a vault to sync with. We will recalculate the sync preview after you choose.":
		"Scegli l'archivio con cui sincronizzare. Poi ricalcoleremo l'anteprima.",
	"Loading vaults…": "Caricamento archivi…",
	"No other vaults available.": "Non ci sono altri archivi disponibili.",
	"Make new vault": "Crea un archivio",
	"New vault": "Nuovo archivio",
	"Create a new empty vault on the server, then sync this Obsidian vault into it.":
		"Crea un archivio vuoto sul server, poi sincronizza questo archivio Obsidian al suo interno.",
	Create: "Crea",
	"Your vault shares {percent} of its data with Engram":
		"Il tuo archivio condivide il {percent} dei dati con Engram",
	"Type {keyword} to confirm:": "Digita {keyword} per confermare:",
	"✓ {count} synced": "✓ {count} sincronizzati",
	"⤳ {count} skipped (Free plan)": "⤳ {count} ignorati (piano gratuito)",
	"✕ {count} failed": "✕ {count} non riusciti",
	"{count} attachments need a paid plan to sync. See Sync Center.": {
		one: "{count} allegato richiede un piano a pagamento. Vedi il Sync Center.",
		other: "{count} allegati richiedono un piano a pagamento. Vedi il Sync Center.",
	},
	"Syncing your vault": "Sincronizzazione del tuo archivio",
	"Getting started…": "Si comincia…",
	"Open Engram to check your vault and confirm everything synced.":
		"Apri Engram per controllare il tuo archivio e verificare che tutto sia sincronizzato.",
	"Open Engram": "Apri Engram",
	"You can close this and the sync keeps running in the background.":
		"Puoi chiudere questa finestra, la sincronizzazione continua in background.",
	"Run in background": "Lascia in background",
	"Syncing…": "Sincronizzazione…",
	"Sync complete": "Sincronizzazione completata",
	Done: "Fatto",
	"Engram: sync conflict on {path} — your local edit was saved as {copy}":
		"Engram: conflitto di sincronizzazione su {path}, la tua modifica locale è stata salvata come {copy}",
	"Open note": "Apri la nota",
	"Engram: {count} notes have frontmatter problems. Open Sync Center to fix.":
		"Engram: il frontmatter di {count} note ha problemi. Apri il Sync Center per correggerlo.",
	"New here? Watch the setup video": "Prima volta qui? Guarda il video di installazione",
	"What Engram does, and how to connect your vault, start to finish.":
		"Cosa fa Engram e come collegare il tuo archivio, dall'inizio alla fine.",
	"▶ Watch on YouTube": "▶ Guarda su YouTube",
	"1. Make an account": "1. Crea un account",
	"2. Connect your vault to Engram": "2. Collega il tuo archivio a Engram",
	"Open connection tab": "Apri la scheda di connessione",
	"3. Connect your AI": "3. Collega la tua IA",
	"Node.js dependencies": "Dipendenze Node.js",
	"Python virtual environment": "Ambiente virtuale Python",
	"Python bytecode cache": "Cache del bytecode Python",
	"Vendored dependencies": "Dipendenze incluse",
	"Gradle build cache": "Cache di build Gradle",
	"Rust/Java build output": "Output di build Rust/Java",
	"Build output": "Output di build",
	"Next.js build output": "Output di build Next.js",
	"Distribution build output": "Output di build per la distribuzione",
	"Cargo cache": "Cache di Cargo",
	"CocoaPods dependencies": "Dipendenze CocoaPods",
	"Dart tool cache": "Cache degli strumenti Dart",
	"Generic cache directory": "Cartella di cache generica",
	"Ignore patterns": "Modelli da ignorare",
	"Custom patterns": "Modelli personalizzati",
	Diagnostics: "Diagnostica",
	"Diagnostics detail": "Dettagli della diagnostica",
	About: "Informazioni",
	"License: {name}": "Licenza: {name}",
	"⚠ Detected: {label}/ ({formatted} files)": "⚠ Rilevato: {label}/ ({formatted} file)",
	"{desc} — should not be synced": "{desc}, non dovrebbe essere sincronizzato",
	"Add to ignores": "Aggiungi agli ignorati",
	"Version: {version}": "Versione: {version}",
	"Source: {link}": "Sorgente: {link}",
	"Engram URL": "Indirizzo di Engram",
	"✓ Engram server reachable (v{version})": "✓ Server Engram raggiungibile (v{version})",
	"✗ server responded but isn't an Engram backend":
		"✗ Il server risponde, ma non è un backend Engram",
	"✗ couldn't reach a server at this URL": "✗ Nessun server raggiungibile a questo indirizzo",
	"Checking server…": "Controllo del server…",
	Authentication: "Autenticazione",
	"Authenticated via Engram account (OAuth).": "Autenticato con il tuo account Engram (OAuth).",
	"Manage account": "Gestisci l'account",
	"Sign out": "Esci",
	"Using API key": "Chiave API in uso",
	"Authenticated via manual API key.": "Autenticato con una chiave API inserita a mano.",
	"Clear key": "Cancella la chiave",
	"Switch to sign in": "Passa all'accesso",
	"Sign in or create an account": "Accedi o crea un account",
	"Sign in": "Accedi",
	"API key": "Chiave API",
	Token: "Token",
	"Bearer token from your Engram account.": "Token Bearer del tuo account Engram.",
	Save: "Salva",
	"That does not look like an Engram API key (expected {prefix}…).":
		"Questa non sembra una chiave API di Engram (attesa {prefix}…).",
	Vault: "Archivio",
	"Vault selection": "Scelta dell'archivio",
	"Select which vault this plugin syncs with.":
		"Scegli con quale archivio si sincronizza questo plugin.",
	"No vaults found — first sync will create one":
		"Nessun archivio trovato: la prima sincronizzazione ne creerà uno",
	"Pick a vault": "Scegli un archivio",
	Change: "Cambia",
	"Support development": "Sostieni lo sviluppo",
	"GitHub Sponsors": "GitHub Sponsors",
	Backend: "Backend",
	"Where this vault syncs to. Each backend keeps its own sign-in.":
		"Dove si sincronizza questo archivio. Ogni backend conserva il proprio accesso.",
	"Run your own Engram server": "Usa un tuo server Engram",
	"Engram is the backend that powers sync and semantic search.":
		"Engram è il backend che muove la sincronizzazione e la ricerca semantica.",
	"Finish sync setup": "Concludi la configurazione",
	"Nothing in this vault syncs until you choose how to merge it with the server.":
		"Questo archivio non sincronizza nulla finché non scegli come unirlo al server.",
	"Choose sync direction": "Scegli il verso della sincronizzazione",
	"Engram: this plugin is too old to sync (needs {version} or newer). Update it to continue.":
		"Engram: questo plugin è troppo vecchio per sincronizzare (serve la {version} o più recente). Aggiornalo per continuare.",
	"Engram: this plugin is too old to sync. Update it to continue.":
		"Engram: questo plugin è troppo vecchio per sincronizzare. Aggiornalo per continuare.",
	Update: "Aggiorna",
	// UI strings (second pass)
	"Invalid API key": "Chiave API non valida",
	"Connection failed": "Connessione non riuscita",
	"Sync now": "Sincronizza adesso",
	"Disconnect (clear login)": "Disconnetti (cancella l'accesso)",
	"Push entire vault": "Invia tutto l'archivio",
	"Check sync status": "Controlla lo stato della sincronizzazione",
	"Engram sync: server does not support reconciliation (update backend)":
		"Engram Sync: il server non sa riconciliare i dati (aggiorna il backend)",
	"Pull all from server (force overwrite)": "Scarica tutto dal server (sovrascrive in locale)",
	"Show sync log": "Mostra il registro di sincronizzazione",
	"Semantic search": "Ricerca semantica",
	"Open search sidebar": "Apri il pannello di ricerca",
	"Engram search": "Ricerca Engram",
	"Open sync center": "Apri il Sync Center",
	"Engram: this vault no longer exists on the server. Pick or create a vault to continue.":
		"Engram: questo archivio non esiste più sul server. Scegli o crea un archivio per continuare.",
	"Engram: recovered plugin settings from a backup after a corrupted save.":
		"Engram: le impostazioni erano danneggiate e sono state ripristinate da una copia.",
	"Engram sync: live sync requires a plugin update — please update the Engram vault sync plugin.":
		"Engram Sync: la sincronizzazione dal vivo richiede un aggiornamento del plugin. Aggiorna Engram vault sync.",
	"Engram: sync is paused — this edit was not synced. Choose a sync direction to resume.":
		"Engram: la sincronizzazione è in pausa e questa modifica non è stata inviata. Scegli un verso per riprendere.",
	"Engram: not connected": "Engram: non connesso",
	"Engram: signed out": "Engram: disconnesso",
	"Not connected yet. Click to open settings and link this vault.":
		"Non ancora connesso. Fai clic per aprire le impostazioni e collegare questo archivio.",
	"Not signed in. Click to open settings and reconnect.":
		"Accesso non effettuato. Fai clic per aprire le impostazioni e ricollegarti.",
	"Engram: finish setup": "Engram: concludi la configurazione",
	"Engram: sync paused": "Engram: sincronizzazione in pausa",
	"{label} ({count} queued)": "{label} ({count} in coda)",
	"Setup is not finished — nothing will sync until you choose a sync direction. Click to finish.":
		"La configurazione non è finita. Finché non scegli un verso non si sincronizza nulla. Fai clic per concluderla.",
	"Sync paused — click to choose a sync direction":
		"Sincronizzazione in pausa: fai clic per scegliere un verso",
	"Engram: offline ({count} queued)": "Engram: offline ({count} in coda)",
	"Engram: offline": "Engram: offline",
	"Server unreachable — changes will sync when connected":
		"Server non raggiungibile: le modifiche partiranno quando torna la connessione",
	"Engram: error": "Engram: errore",
	"Unknown error": "Errore sconosciuto",
	"Engram: syncing ({count})": "Engram: sincronizzazione ({count})",
	"Engram: syncing": "Engram: sincronizzazione",
	"Sync in progress...": "Sincronizzazione in corso…",
	"Engram: pending ({count})": "Engram: in attesa ({count})",
	"{count} files queued": "{count} file in coda",
	"Engram: live": "Engram: dal vivo",
	"WebSocket connected — live sync active":
		"WebSocket connesso: la sincronizzazione dal vivo è attiva",
	"Click to sync": "Fai clic per sincronizzare",
	Attachments: "Allegati",
	Keyword: "Parola chiave",
	Semantic: "Semantica",
	Both: "Entrambe",
	"matches your words and their other forms — 'run' finds 'running' — plus this device.":
		"Trova le tue parole e le loro forme: «correre» trova anche «corre», più questo dispositivo.",
	"matches meaning. Finds notes that never use the words you typed.":
		"Trova per significato, comprese note in cui le tue parole non compaiono mai.",
	"matches words and meaning together, plus this device. Widest results.":
		"Trova parole e significato insieme, più questo dispositivo. La ricerca più ampia.",
	"Clear search": "Cancella la ricerca",
	"Search settings": "Impostazioni di ricerca",
	Untitled: "Senza titolo",
	"meaning + exact": "significato + esatto",
	Disconnected: "Disconnesso",
	"Connected — waiting for first sync decision":
		"Connesso: in attesa della prima scelta di sincronizzazione",
	"Connected — live sync active": "Connesso: sincronizzazione dal vivo attiva",
	"Connected — polling": "Connesso: interrogazione periodica",
	"Not configured": "Non configurato",
	Refresh: "Ricarica",
	"Not synced on your plan ({count})": "Fuori dal tuo piano ({count})",
	"Needs attention ({count})": "Richiede la tua attenzione ({count})",
	"Retrying automatically ({count})": "Nuovo tentativo automatico ({count})",
	Stats: "Numeri",
	"Notes on this device": "Note su questo dispositivo",
	"Attachments on this device": "Allegati su questo dispositivo",
	"Remote vault": "Archivio sul server",
	"not linked": "non collegato",
	"Plan usage": "Utilizzo del piano",
	"Safe choice: combines both sides, nothing is deleted.":
		"Scelta sicura: unisce i due lati e non elimina nulla.",
	"Already in sync. Nothing is deleted.": "Già sincronizzato. Non viene eliminato nulla.",
	Sync: "Sincronizza",
	"Upload local files without downloading the remote":
		"Invia i file locali senza scaricare dal server",
	"Delete all on remote, then upload local files":
		"Elimina tutto sul server, poi invia i file locali",
	"Download remote files without uploading the local":
		"Scarica i file dal server senza inviare quelli locali",
	"Delete all local files, then download from remote":
		"Elimina tutti i file locali, poi scarica dal server",
	"Set up sync for this vault": "Configura la sincronizzazione di questo archivio",
	"You are now pointing at a different cloud vault":
		"Adesso stai puntando a un altro archivio nel cloud",
	"Sync preview": "Anteprima della sincronizzazione",
	"Start syncing": "Inizia a sincronizzare",
	"Upload everything": "Invia tutto",
	"Nothing will be removed from this device.": "Non verrà rimosso nulla da questo dispositivo.",
	"Download everything": "Scarica tutto",
	"Not now": "Più tardi",
	"This vault": "Questo archivio",
	"Cloud server": "Archivio sul server",
	"Vault name": "Nome dell'archivio",
	"Could not load vaults": "Non è stato possibile caricare gli archivi",
	"Enter a name for the new vault": "Dai un nome al nuovo archivio",
	"Failed to switch vault": "Cambio di archivio non riuscito",
	"Finished with some errors. Open the sync log to see what failed.":
		"Terminato con alcuni errori. Nel registro di sincronizzazione trovi cosa non è andato.",
	"Synced. Some attachments need a paid plan to sync (see below).":
		"Sincronizzato. Alcuni allegati richiedono un piano a pagamento (vedi sotto).",
	"All synced. Your vault and the cloud now match.":
		"Tutto sincronizzato. Il tuo archivio e il cloud corrispondono.",
	"Already up to date. Nothing needed syncing.":
		"Già aggiornato. Non c'era nulla da sincronizzare.",
	Deleting: "Eliminazione",
	Downloading: "Download",
	Uploading: "Invio",
	"Engram: Show sync log": "Engram: mostra il registro di sincronizzazione",
	"Syncing attachments": "Sincronizzazione degli allegati",
	Complete: "Completato",
	"Getting set up": "Per iniziare",
	"setup guide": "guida all'installazione",
	"Sign in (or enter your server URL and key) on the connection tab, then run your first sync.":
		"Accedi nella scheda di connessione (o inserisci l'indirizzo del tuo server e la chiave), poi avvia la prima sincronizzazione.",
	"See the AI setup guide": "Vedi la guida alla configurazione dell'IA",
	Plans: "Piani",
	Free: "Gratuito",
	"1 vault, 2 devices": "1 archivio, 2 dispositivi",
	"Real-time sync": "Sincronizzazione in tempo reale",
	"2,000 notes searchable": "2.000 note ricercabili",
	"Connect any AI (MCP)": "Collega qualsiasi IA (MCP)",
	Starter: "Starter",
	"10 vaults, unlimited devices": "10 archivi, dispositivi illimitati",
	"Search all your notes": "Cerca in tutte le tue note",
	"10 GB attachments": "10 GB di allegati",
	"Unlimited AI searches": "Ricerche IA illimitate",
	Pro: "Pro",
	"Unlimited vaults": "Archivi illimitati",
	"Search across all vaults at once": "Cerca in tutti gli archivi insieme",
	"50 GB attachments": "50 GB di allegati",
	"API access": "Accesso alle API",
	"See full pricing": "Vedi tutti i prezzi",
	"Learn more": "Scopri di più",
	"Errors only": "Solo errori",
	"Warnings and errors": "Avvisi ed errori",
	"Info (default)": "Informazioni (predefinito)",
	"Debug (verbose)": "Debug (dettagliato)",
	"Or authenticate with a token instead of signing in.":
		"Oppure autenticati con un token invece di accedere.",
	"If this plugin saves you time, consider supporting development.":
		"Se questo plugin ti fa risparmiare tempo, considera di sostenere lo sviluppo.",
	"Sign-in required to load vaults": "Per caricare gli archivi serve l'accesso",
	"Could not reach Engram — check connection":
		"Engram non raggiungibile: controlla la connessione",
	// UI strings (sync error surfaces)
	"Free syncs notes only — images & PDFs need a paid plan.":
		"Il piano gratuito sincronizza solo le note: immagini e PDF richiedono un piano a pagamento.",
	"Pull all (delete extras) aborted: could not obtain an exclusive server snapshot (replay contention). Nothing was trashed.":
		"«Scarica tutto (elimina gli extra)» interrotto: non è stato possibile ottenere uno snapshot esclusivo del server (conflitto di replay). Non è stato spostato nulla nel cestino.",
	"Pull all aborted: another sync is running (replay contention). Try again when it finishes.":
		"«Scarica tutto» interrotto: è in corso un'altra sincronizzazione (conflitto di replay). Riprova quando finisce.",
	"Pull all failed: {error}": "«Scarica tutto» non riuscito: {error}",
	"Pull all failed": "«Scarica tutto» non riuscito",
};

export default it;
