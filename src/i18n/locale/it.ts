import type { Dict } from "..";

// Italiano
const it: Dict = {
	" (default)": " (predefinito)",
	"(top level)": "(cartella principale)",
	"({count} errors)": {
		one: "({count} errore)",
		many: "({count} errori)",
		other: "({count} errori)",
	},
	"...": "...",
	'... "{name}" ...': '... "{name}" ...',
	"1 vault, 2 devices": "1 Vault, 2 dispositivi",
	"1. Make an account": "1. Crea un account",
	"10 GB attachments": "10 GB di allegati",
	"10 vaults, unlimited devices": "10 archivi, dispositivi illimitati",
	"2. Connect your vault to Engram": "2. Collega il tuo Vault a Engram",
	"3,000 notes, all searchable": "3.000 note, tutte ricercabili",
	"3. Connect your AI": "3. Collega la tua AI",
	"50 GB attachments": "50 GB di allegati",
	"A browser window has opened. Sign in and enter this code to link your vault.":
		"Si è aperta una finestra del browser. Accedi e inserisci questo codice per collegare il tuo Vault.",
	"A frontmatter key could not be parsed as YAML.":
		"Una chiave del frontmatter non può essere interpretata come YAML.",
	"A temporary server problem — retrying automatically.":
		"Un problema temporaneo del server — riprova automaticamente.",
	"AI / MCP setup guide": "Guida all'installazione AI / MCP",
	"AI searches": "Ricerche AI",
	"API access": "Accesso all'API",
	"API key": "Chiave API",
	"API keys need a Pro plan. Sign in with your Engram account instead.":
		"Le chiavi API richiedono un piano Pro. Accedi con il tuo account Engram invece.",
	About: "Informazioni",
	"Accept it to keep syncing.": "Accettalo per continuare la sincronizzazione.",
	"Access token": "Token di accesso",
	"Account setup incomplete.": "Configurazione dell'account incompleta.",
	"Account suspended. Contact support.": "Account sospeso. Contatta l'assistenza.",
	"Activity ({count})": "Attività ({count})",
	"Add to ignores": "Aggiungi agli ignorati",
	"Added {pattern} to ignore patterns": "Aggiunto {pattern} ai modelli da ignorare",
	"Advanced sync options": "Opzioni di sincronizzazione avanzate",
	"All synced. Your vault and the cloud now match.":
		"Sincronizzazione completata. Il tuo vault e il cloud ora corrispondono.",
	"Already in sync. Nothing is deleted.": "Già sincronizzato. Niente viene eliminato.",
	"Already signed in on another device. Upgrade for multi-device.":
		"Già effettuato l'accesso su un altro dispositivo. Effettua l'upgrade per l'uso su più dispositivi.",
	"Already up to date. Nothing needed syncing.":
		"Già aggiornato. Non è necessario sincronizzare nulla.",
	"An unexpected error — retrying automatically.":
		"Si è verificato un errore inatteso — riprova automaticamente.",
	"Attachment storage full": "Spazio di archiviazione degli allegati esaurito",
	"Attachment storage is full — upgrade for more.":
		"Lo spazio di archiviazione degli allegati è pieno, effettua l'upgrade per averne di più.",
	"Attachment sync is disabled for this account.":
		"La sincronizzazione degli allegati è disabilitata per questo account.",
	Attachments: "Allegati",
	"Attachments need a paid plan": "Gli allegati richiedono un piano a pagamento",
	"Attachments on this device": "Allegati su questo dispositivo",
	"Authenticated via Engram account (OAuth).": "Autenticato tramite account Engram (OAuth).",
	"Authenticated via manual API key.": "Autenticato tramite chiave API manuale.",
	Authentication: "Autenticazione",
	Back: "Indietro",
	"Bearer token from your Engram account.": "Token di accesso dal tuo account Engram.",
	Both: "Entrambe",
	Bug: "Bug",
	"Build output": "Output della build",
	"Can't reach the server — retrying automatically.":
		"Impossibile raggiungere il server — riprova automaticamente.",
	Cancel: "Annulla",
	"Cargo cache": "Cache di Cargo",
	Change: "Cambia",
	"Change vault": "Cambia Vault",
	"Check sync status": "Controlla lo stato della sincronizzazione",
	"Checking for changes.": "Controllo delle modifiche.",
	"Checking server…": "Controllo del server…",
	"Choose sync direction": "Scegli la direzione della sincronizzazione",
	Clear: "Cancella",
	"Clear all": "Pulisci tutto",
	"Clear key": "Cancella la chiave",
	"Clear search": "Cancella la ricerca",
	"Click to copy": "Clicca per copiare",
	"Click to sync": "Clicca per sincronizzare",
	Close: "Chiudi",
	"Cloud server": "Server cloud",
	"CocoaPods dependencies": "Dipendenze CocoaPods",
	"Code copied!": "Codice copiato!",
	"Code expired. Please try again.": "Codice scaduto. Riprova.",
	"Comparing your vault with the cloud…": "Confronto del tuo Vault con il cloud…",
	Complete: "Completato",
	Confirm: "Conferma",
	"Confirm destructive sync": "Conferma sincronizzazione distruttiva",
	Conflict: "Conflitto",
	Confusing: "Confuso",
	"Connect any AI (MCP)": "Collega qualsiasi AI (MCP)",
	"Connect to Engram first to send feedback.":
		"Connettiti a Engram prima di inviare un feedback.",
	"Connected — live sync active": "Connesso — sincronizzazione attiva",
	"Connected — polling": "Connesso — in attesa",
	"Connected — waiting for first sync decision":
		"Connesso — in attesa della prima decisione di sincronizzazione",
	"Connection failed": "Connessione fallita",
	Continue: "Continua",
	"Could not compare with the cloud. Check your connection.":
		"Impossibile confrontare con il cloud. Controlla la connessione.",
	"Could not create the vault — check your connection and try again.":
		"Impossibile creare il Vault — controlla la tua connessione e riprova.",
	"Could not load vaults: {error}": "Impossibile caricare gli archivi: {error}",
	"Could not reach Engram — check connection":
		"Impossibile raggiungere Engram — controlla la connessione",
	"Could not save your folder choice. Try again.":
		"Impossibile salvare la tua scelta di cartella. Riprova.",
	"Couldn't create vault — the name may be invalid or already in use.":
		"Impossibile creare il Vault — il nome potrebbe essere non valido o già in uso.",
	"Couldn't send your feedback, please try again.":
		"Impossibile inviare il tuo feedback, riprova.",
	Create: "Crea",
	"Create a hosted account at {signup}, or self-host the server ({guide}).":
		"Crea un account ospitato su {signup}, oppure ospita tu stesso il server ({guide}).",
	"Create a new empty vault on the server, then sync this Obsidian vault into it.":
		"Crea un nuovo vault vuoto sul server, quindi sincronizza questo vault Obsidian con esso.",
	"Custom patterns": "Modelli personalizzati",
	"Daily AI search limit reached. Free includes 20 per day across Obsidian, the web app and MCP. Upgrade for unlimited.":
		"Raggiunto il limite giornaliero di ricerche AI. Il piano gratuito include 20 ricerche al giorno tra Obsidian, l'app web e MCP. Effettua l'upgrade per un uso illimitato.",
	"Dart tool cache": "Cache degli strumenti Dart",
	"Debug (verbose)": "Debug (dettagliato)",
	"Delete all local files, then download from remote":
		"Elimina tutti i file locali, poi scaricali dal server",
	"Delete all on remote, then upload local files":
		"Elimina tutto sul server, poi carica i file locali",
	"Delete all {count} files currently on the server": {
		one: "Elimina tutti e {count} i file attualmente sul server",
		many: "Elimina tutti i file {count} attualmente sul server",
		other: "Elimina tutti e {count} i file attualmente sul server",
	},
	"Delete all {count} files in this vault": {
		one: "Elimina tutti i {count} file in questo Vault",
		many: "Elimina tutti i {count} file in questo Vault",
		other: "Elimina tutti i {count} file in questo Vault",
	},
	Deleted: "Eliminato",
	Deleting: "Eliminando",
	"Deleting {count} local files.": {
		one: "Eliminando {count} file locale.",
		many: "Eliminando {count} file locali.",
		other: "Eliminando {count} file locali.",
	},
	"Deleting {count} on the cloud.": {
		one: "Eliminando {count} dal cloud.",
		many: "Eliminando la versione {count} nel cloud.",
		other: "Eliminando {count} dal cloud.",
	},
	"Device swap cooldown active. Wait or upgrade.":
		"Periodo di attesa per il cambio dispositivo attivo. Attendi o effettua l'upgrade.",
	Diagnostics: "Diagnostica",
	"Diagnostics detail": "Dettagli diagnostica",
	"Disconnect (clear login)": "Disconnetti (cancella l'accesso)",
	Disconnected: "Disconnesso",
	Dismiss: "Chiudi",
	"Distribution build output": "Output della build di distribuzione",
	Documentation: "Documentazione",
	Done: "Fatto",
	"Download everything": "Scarica tutto",
	"Download remote files without uploading the local":
		"Scarica i file remoti senza caricare quelli locali",
	"Download {count} files from the server": {
		one: "Scarica {count} file dal server",
		many: "Scarica {count} file dal server",
		other: "Scarica {count} file dal server",
	},
	Downloading: "Scaricando",
	"Downloading {count}.": {
		one: "Scaricamento {count}.",
		many: "Scaricamento {count}.",
		other: "Scaricamento {count}.",
	},
	"Engram Cloud": "Cloud Engram",
	"Engram Sync: pulled {count} changes": {
		one: "Engram Sync: aggiornate {count} modifica",
		many: "Engram Sync: aggiornate le modifiche {count}",
		other: "Engram Sync: aggiornate {count} modifiche",
	},
	"Engram Sync: pulled {count} files from server": {
		one: "Engram Sync: scaricato {count} file dal server",
		many: "Engram Sync: scaricati {count} file dal server",
		other: "Engram Sync: scaricati {count} file dal server",
	},
	"Engram Sync: pulled {pulled}": "Engram Sync: scaricati {pulled}",
	"Engram Sync: pulled {pulled} (local extras deleted)":
		"Engram Sync: scaricati {pulled} (file extra locali eliminati)",
	"Engram Sync: pulled {pulled}, pushed {pushed}":
		"Engram Sync: scaricati {pulled}, inviati {pushed}",
	"Engram Sync: pushed {count} files": {
		one: "Engram Sync: inviato {count} file",
		many: "Engram Sync: sincronizzati {count} file",
		other: "Engram Sync: inviati {count} file",
	},
	"Engram Sync: pushed {pushed}": "Engram Sync: inviati {pushed}",
	'Engram Sync: renamed "{name}" (unsupported characters)':
		'Engram Sync: rinominato "{name}" (caratteri non supportati)',
	"Engram Sync: replaced remote with local ({pushed} uploaded)":
		"Engram Sync: sostituito il file remoto con quello locale ({pushed} caricati)",
	'Engram Sync: sync state for "{name}" was unreadable — using the on-disk copy.':
		'Engram Sync: lo stato di sincronizzazione di "{name}" non è leggibile, si sta usando la copia locale.',
	"Engram Sync: {details}": "Sincronizzazione Engram: {details}",
	"Engram URL": "URL di Engram",
	"Engram Vault Sync {version} is available. {link}.":
		"Engram Vault Sync {version} disponibile. {link}.",
	"Engram indexes {indexed} of your {all} notes. The rest match on this device only. Upgrade to index everything.":
		"Engram indicizza {indexed} delle tue {all} note. Il resto corrisponde solo su questo dispositivo. Aggiorna per indicizzare tutto.",
	"Engram is the backend that powers sync and semantic search.":
		"Engram è il backend che alimenta la sincronizzazione e la ricerca semantica.",
	"Engram search": "Ricerca Engram",
	"Engram server changed — sign in again to continue.":
		"Il server Engram è cambiato: accedi di nuovo per continuare.",
	"Engram sync: checking...": "Sincronizzazione Engram: in verifica...",
	"Engram sync: everything in sync": "Sincronizzazione Engram: tutto sincronizzato",
	"Engram sync: live sync requires a plugin update — please update the Engram vault sync plugin.":
		"Engram sincronizzazione: la sincronizzazione in tempo reale richiede un aggiornamento del plugin — aggiorna il plugin di sincronizzazione Engram.",
	"Engram sync: pulling all from server...":
		"Sincronizzazione Engram: scaricamento di tutto dal server...",
	"Engram sync: server does not support reconciliation (update backend)":
		"Sincronizzazione Engram: il server non supporta la riconciliazione (aggiorna il backend)",
	"Engram sync: sync failed": "Sincronizzazione Engram: errore",
	"Engram sync: syncing...": "Sincronizzazione Engram: in corso...",
	"Engram unreachable. Showing matches from this device only.":
		"Engram non raggiungibile. Mostra i risultati solo da questo dispositivo.",
	"Engram's {document} update, effective {date}.":
		"Aggiornamento di Engram per {document}, valido dal {date}.",
	"Engram: This vault has been deleted on the server.":
		"Engram: questo Vault è stato eliminato dal server.",
	"Engram: disconnected. Open Engram settings to reconnect.":
		"Engram: disconnesso. Apri le impostazioni di Engram per riconnetterti.",
	"Engram: error": "Engram: errore",
	"Engram: finish setup": "Engram: completa la configurazione",
	'Engram: frontmatter problem in "{name}"': 'Engram: problema con il frontmatter in "{name}"',
	"Engram: live": "Engram: attivo",
	"Engram: not connected": "Engram: non connesso",
	"Engram: offline": "Engram: offline",
	"Engram: offline ({count} queued)": {
		one: "Engram: offline ({count} in coda)",
		many: "Engram: offline ({count} in coda)",
		other: "Engram: offline ({count} in coda)",
	},
	"Engram: pending ({count})": "Engram: in attesa ({count})",
	"Engram: plan upgraded — syncing {count} attachments…": {
		one: "Engram: piano aggiornato — sincronizzando {count} allegato…",
		many: "Engram: piano aggiornato — sincronizzando {count} allegati…",
		other: "Engram: piano aggiornato — sincronizzando {count} allegati…",
	},
	"Engram: plugin settings file was corrupted and could not be recovered. You may need to reconnect in settings.":
		"Engram: il file delle impostazioni del plugin è corrotto e non può essere ripristinato. Potrebbe essere necessario ricollegare l'account nelle impostazioni.",
	"Engram: ready": "Engram: pronto",
	"Engram: recovered plugin settings from a backup after a corrupted save.":
		"Engram: ripristinate le impostazioni del plugin da una copia di backup dopo un salvataggio corrotto.",
	"Engram: settings tab failed to render ({error})":
		"Engram: impossibile visualizzare la scheda delle impostazioni ({error})",
	"Engram: sign-in failed ({error})": "Engram: impossibile accedere ({error})",
	"Engram: signed out": "Engram: disconnesso",
	"Engram: sync conflict on {path} — your local edit was saved as {copy}":
		"Engram: conflitto di sincronizzazione su {path} — la tua modifica locale è stata salvata come {copy}",
	"Engram: sync failed. Open the sync log for details.":
		"Engram: la sincronizzazione è fallita. Apri il registro di sincronizzazione per i dettagli.",
	"Engram: sync is not set up yet, so nothing in this vault will sync.":
		"Engram: la sincronizzazione non è ancora configurata, quindi nulla in questo Vault verrà sincronizzato.",
	"Engram: sync is paused. This edit was not synced. Choose a sync direction to resume.":
		"Engram: la sincronizzazione è in pausa. Questa modifica non è stata sincronizzata. Scegli una direzione di sincronizzazione per riprendere.",
	"Engram: sync paused": "Engram: sincronizzazione in pausa",
	"Engram: syncing": "Engram: sincronizzando",
	"Engram: syncing ({count})": "Engram: sincronizzando ({count})",
	"Engram: this plugin is too old to sync (needs {version} or newer). Update it to continue.":
		"Engram: questo plugin è troppo vecchio per sincronizzare (richiede {version} o versione successiva). Aggiornalo per continuare.",
	"Engram: this plugin is too old to sync. Update it to continue.":
		"Engram: questo plugin è troppo vecchio per sincronizzare. Aggiornalo per continuare.",
	"Engram: this vault no longer exists on the server. Pick or create a vault to continue.":
		"Engram: questo Vault non esiste più sul server. Seleziona o crea un Vault per continuare.",
	"Engram: your login expired — open Engram settings to reconnect.":
		"Engram: la tua sessione è scaduta: apri le impostazioni di Engram per ricollegarti.",
	"Engram: {count} attachments skipped — upgrade your plan to sync images & PDFs.": {
		one: "Engram: {count} allegato saltato — aggiorna il tuo piano per sincronizzare immagini e PDF.",
		many: "Engram: {count} allegati saltati — aggiorna il tuo piano per sincronizzare immagini e PDF.",
		other: "Engram: {count} allegati saltati — aggiorna il tuo piano per sincronizzare immagini e PDF.",
	},
	"Engram: {count} files failed to sync{detail} — open Sync Center": {
		one: "Engram: impossibile sincronizzare {count} file{detail} — apri il Centro di sincronizzazione",
		many: "Engram: impossibile sincronizzare {count} file{detail} — apri il Centro di sincronizzazione",
		other: "Engram: impossibile sincronizzare {count} file{detail} — apri il Centro di sincronizzazione",
	},
	"Engram: {count} notes have frontmatter problems. Open Sync Center to fix.": {
		one: "Engram: {count} nota presenta problemi nel frontmatter. Apri il Centro di sincronizzazione per risolverli.",
		many: "Engram: {count} note presentano problemi nel frontmatter. Apri il Centro di sincronizzazione per risolverli.",
		other: "Engram: {count} note hanno problemi nel frontmatter. Apri il Centro di sincronizzazione per risolverli.",
	},
	"Engram: ⚠ {count} sync errors": {
		one: "Engram: ⚠ {count} errore di sincronizzazione",
		many: "Engram: ⚠ {count} errori di sincronizzazione",
		other: "Engram: ⚠ {count} errori di sincronizzazione",
	},
	"Enter a name for the new vault": "Inserisci un nome per il nuovo vault",
	"Enter an API key first": "Inserisci prima una chiave API",
	Error: "Errore",
	"Error: {error}": "Errore: {error}",
	"Errors only": "Errori",
	"Everything is in sync": "Tutto è sincronizzato",
	"Failed to start device flow. Check your Engram URL and try again.":
		"Impossibile avviare il processo di autorizzazione. Controlla l'URL di Engram e riprova.",
	"Failed to switch vault: {error}": "Impossibile passare al vault: {error}",
	"File exceeds the {limit} limit": "Il file supera il limite di {limit}",
	"File not found locally: {path}": "File non trovato localmente: {path}",
	"File too large for your plan.": "File troppo grande per il tuo piano.",
	"Files that will be deleted:": "File che verranno eliminati:",
	"Filter by folder…": "Filtra per cartella…",
	"Filter by tags…": "Filtra per tag…",
	"Finish setting up your account at app.engram.page to start syncing.":
		"Completa la configurazione del tuo account su app.engram.page per iniziare la sincronizzazione.",
	"Finish sync setup": "Completa la configurazione della sincronizzazione",
	"Finished with some errors. Open the sync log to see what failed.":
		"Completata con alcuni errori. Apri il registro di sincronizzazione per vedere cosa è fallito.",
	"First sync, this may take a moment.":
		"Prima sincronizzazione, potrebbe richiedere un momento.",
	Free: "Gratuito",
	"Free syncs notes only — images & PDFs need a paid plan.":
		"La sincronizzazione è gratuita solo per le note; immagini e PDF richiedono un piano a pagamento.",
	"Free syncs notes only — {count} attachments will be skipped.": {
		one: "Sincronizza gratuitamente le note, ma salta {count} allegato.",
		many: "Sincronizza gratuitamente solo le note; verranno saltati {count} allegati.",
		other: "Sincronizza gratuitamente solo le note; verranno saltati {count} allegati.",
	},
	"Frontmatter could not be parsed": "Impossibile analizzare il frontmatter",
	"Frontmatter isn't valid YAML.": "Il frontmatter non è un YAML valido.",
	'Frontmatter key "{key}" could not be parsed as YAML.':
		'La chiave del frontmatter "{key}" non può essere interpretata come YAML.',
	"Frontmatter needs a fix": "Il frontmatter necessita di una correzione",
	"Generic cache directory": "Directory di cache generica",
	"Getting set up": "Configurazione",
	"Getting started…": "Inizializzazione…",
	"GitHub Sponsors": "GitHub Sponsors",
	"Gradle build cache": "Cache della build Gradle",
	"How do you feel about Engram?": "Cosa ne pensi di Engram?",
	"I understand {count} notes will not sync.": {
		one: "Capisco che {count} nota non verrà sincronizzata.",
		many: "Capisco che {count} note non verranno sincronizzate.",
		other: "Capisco che {count} note non verranno sincronizzate.",
	},
	Idea: "Idea",
	"If this plugin saves you time, consider supporting development.":
		"Se questo plugin ti fa risparmiare tempo, considera di supportare lo sviluppo.",
	Ignore: "Ignora",
	"Ignore patterns": "Modelli da ignorare",
	"Ignored ({count})": "Ignorato ({count})",
	"Ignored {path} — won't sync until restored from Sync Center.":
		"Ignorato {path} — non verrà sincronizzato finché non verrà ripristinato dal Centro di sincronizzazione.",
	"Info (default)": "Info (predefinito)",
	"Invalid API key": "Chiave API non valida",
	"It's OK to email me about this": "Puoi scrivermi via email a riguardo",
	"Join our Discord": "Unisciti al nostro Discord",
	Keyword: "Parola chiave",
	"Last sync: {when}": "Ultima sincronizzazione: {when}",
	"Learn more": "Scopri di più",
	"License: {name}": "Licenza: {name}",
	"Limit reached. Upgrade to continue.": "Limite raggiunto. Aggiorna per continuare.",
	"Link Claude, Cursor, ChatGPT, or any MCP app so it can read and write your notes. ":
		"Collega Claude, Cursor, ChatGPT o qualsiasi app MCP per permettergli di leggere e scrivere le tue note ",
	"Link Obsidian to Engram": "Collega Obsidian a Engram",
	"Loading vaults…": "Caricamento archivi…",
	"Love it": "Mi piace",
	"Make new vault": "Crea un nuovo Vault",
	"Manage account": "Gestisci l'account",
	"Minimum severity that ships while diagnostics are on. Higher levels send fewer lines. Default: Info.":
		"Livello minimo di gravità visualizzato quando la diagnostica è attiva. I livelli più alti inviano meno righe. Predefinito: Info.",
	"Needs attention ({count})": "Richiede attenzione ({count})",
	"Network unavailable": "Rete non disponibile",
	"New here? Watch the setup video": "Sei nuovo qui? Guarda il video di configurazione",
	"New vault": "Nuovo Vault",
	"Next.js build output": "Output della build Next.js",
	"No activity yet. Push or pull to see entries here.":
		"Nessuna attività ancora. Effettua una sincronizzazione per vedere le voci.",
	"No files ignored. Use the ignore button on a failure row to stop syncing it.":
		'Nessun file ignorato. Usa il pulsante "ignora" su una riga con errori per interrompere la sincronizzazione.',
	"No other vaults available.": "Nessun altro archivio disponibile.",
	"No results found": "Nessun risultato trovato",
	"No source path for this result": "Nessun percorso di origine per questo risultato",
	"No sync activity this session.": "Nessuna attività di sincronizzazione in questa sessione.",
	"No vaults found — first sync will create one":
		"Nessun archivio trovato — la prima sincronizzazione ne creerà uno",
	"Node.js dependencies": "Dipendenze Node.js",
	"Not configured": "Non configurato",
	"Not connected yet. Click to open settings and link this vault.":
		"Non ancora connesso. Clicca per aprire le impostazioni e collegare questo Vault.",
	"Not connected. Enter your Engram server URL below to start syncing.":
		"Non connesso. Inserisci l'URL del tuo server Engram qui sotto per iniziare la sincronizzazione.",
	"Not now": "Non ora",
	"Not signed in, or the session expired. Sign in again in Engram settings.":
		"Non sei autenticato, oppure la sessione è scaduta. Effettua nuovamente l'accesso nelle impostazioni di Engram.",
	"Not signed in. Click to open settings and reconnect.":
		"Non ancora connesso. Clicca per aprire le impostazioni e riconnetterti.",
	"Not synced on your plan ({count})": "Non sincronizzato nel tuo piano ({count})",
	"Note couldn't be processed": "Impossibile elaborare la nota",
	"Note limit reached. Upgrade to keep adding notes.":
		"Numero massimo di note raggiunto. Aggiorna per continuare ad aggiungere note.",
	"Note not synced locally": "La nota non è sincronizzata localmente",
	"Notes on this device": "Note su questo dispositivo",
	"Notes past this still sync and open normally, they are just not in the search index. The index keeps your oldest notes, so it is your newest ones that fall outside.":
		"Le note successive a questa vengono comunque sincronizzate e aperte normalmente, ma non sono nell'indice di ricerca. L'indice conserva le tue note più vecchie, quindi sono quelle più recenti che non vengono incluse.",
	"Notes searchable": "Note indicizzabili",
	"Notes stored": "Note salvate",
	"Nothing in this vault syncs until you choose how to merge it with the server.":
		"Nessuna nota in questo Vault viene sincronizzata finché non scegli come fonderla con il server.",
	"Nothing is deleted.": "Niente viene eliminato.",
	"Nothing needs your attention. 🎉": "Non ci sono problemi da risolvere. 🎉",
	"Nothing to sync yet — this vault is empty on both sides. Start syncing and everything you write appears on your other devices.":
		"Al momento non c'è nulla da sincronizzare: questo Vault è vuoto su entrambi i lati. Inizia la sincronizzazione e tutto ciò che scrivi apparirà sui tuoi altri dispositivi.",
	"Nothing will be deleted.": "Nulla verrà eliminato.",
	"Nothing will be removed from this device.": "Nulla verrà eliminato da questo dispositivo.",
	Open: "Apri",
	"Open Connection": "Apri la connessione",
	"Open Engram": "Apri Engram",
	"Open Engram settings": "Apri le impostazioni di Engram",
	"Open Engram to check your vault and confirm everything synced.":
		"Apri Engram per controllare il tuo vault e confermare che tutto sia stato sincronizzato.",
	"Open connection tab": "Apri la scheda connessione",
	"Open note": "Apri la nota",
	"Open search sidebar": "Apri la barra laterale di ricerca",
	"Open sync center": "Apri il Centro di sincronizzazione",
	"Open sync setup": "Apri la configurazione di sincronizzazione",
	"Open the file to resolve the conflict, then sync again.":
		"Apri il file per risolvere il conflitto, poi sincronizza di nuovo.",
	"Opens your browser to sign in, or create an account if you don't have one yet, then links this vault.":
		"Apre il tuo browser per accedere, oppure crea un account se non ne hai ancora uno, quindi collega questo vault.",
	"Or authenticate with a token instead of signing in.":
		"Oppure autenticati con un token invece di accedere.",
	"Or authenticate with a token instead of signing in. Engram Cloud API keys require the Pro plan; on Free and Starter, sign in above.":
		"Oppure autenticati con un token invece di accedere. Le chiavi API di Engram richiedono il piano Pro; nei piani Free e Starter, accedi qui sopra.",
	"Paths to skip (one per line). Folder patterns end with /. Built-in: {configDir}/, .trash/, .git/":
		"Percorsi da escludere (uno per riga). I modelli di cartella terminano con /. Predefiniti: {configDir}/, .trash/, .git/",
	"Pick a vault": "Scegli un Vault",
	"Pick a vault (previous: '{name}' not found)":
		"Scegli un Vault (precedente: '{name}' non trovato)",
	"Pick a vault (previous: id {id} not found)":
		"Scegli un Vault (precedente: id {id} non trovato)",
	"Pick a vault to sync with. We will recalculate the sync preview after you choose.":
		"Scegli un Vault da sincronizzare. Ricalcoleremo l'anteprima della sincronizzazione dopo la tua scelta.",
	"Plan usage": "Utilizzo del piano",
	Plans: "Piani",
	"Privacy Policy": "Informativa sulla privacy",
	Pro: "Pro",
	"Pull all (delete extras) aborted: could not obtain an exclusive server snapshot (replay contention). Nothing was trashed.":
		"Pull di tutti i file interrotto: impossibile ottenere uno snapshot esclusivo del server (conflitto di replay). Nessun file è stato eliminato.",
	"Pull all aborted: another sync is running (replay contention). Try again when it finishes.":
		"Pull di tutti i file interrotto: un'altra sincronizzazione è in corso (conflitto di replay). Riprova quando sarà terminata.",
	"Pull all failed: {error}": "Pull di tutti i file fallito: {error}",
	"Pull all from server (force overwrite)": "Scarica tutto dal server (sovrascrivi forzatamente)",
	Pulled: "Ricevuto",
	"Push entire vault": "Sincronizza l'intero Vault",
	Pushed: "Inviato",
	"Python bytecode cache": "Cache del bytecode Python",
	"Python virtual environment": "Ambiente virtuale Python",
	"Read it": "Leggilo",
	"Real-time sync": "Sincronizzazione in tempo reale",
	"Reconnect your account to resume syncing.":
		"Ricollega il tuo account per riprendere la sincronizzazione.",
	Refresh: "Aggiorna",
	"Remote vault": "Vault remoto",
	"Remove tag {tag}": "Rimuovi il tag {tag}",
	"Report an issue": "Segnala un problema",
	"Report an issue on GitHub": "Segnala un problema su GitHub",
	"Request failed ({status})": "Richiesta fallita ({status})",
	Restore: "Ripristina",
	"Restored {path} — will sync on next push.":
		"Ripristinato {path} — verrà sincronizzato al prossimo aggiornamento.",
	"Retry all now": "Riprova tutto adesso",
	"Retrying automatically ({count})": "Tentativo automatico ({count})",
	"Review and accept": "Esamina e accetta",
	"Run in background": "Esegui in background",
	"Run your own Engram server": "Gestisci il tuo server Engram",
	"Rust/Java build output": "Output della build Rust/Java",
	"Safe choice: combines both sides, nothing is deleted.":
		"Scelta sicura: combina entrambe le parti, niente viene eliminato.",
	Save: "Salva",
	"Search across all vaults at once": "Cerca in tutti gli archivi contemporaneamente",
	"Search all your notes": "Cerca tutte le tue note",
	"Search failed — check connection": "Ricerca fallita — controlla la connessione",
	"Search settings": "Impostazioni di ricerca",
	"Search your vault…": "Cerca nel tuo Vault…",
	"Searching {indexed} of {all} notes. Upgrade to search everything.":
		"Ricerca in {indexed} di {all} note. Aggiorna per cercare tutto.",
	"See full pricing": "Vedi i prezzi completi",
	"See the AI setup guide": "Consulta la guida per la configurazione dell'AI",
	"Select which vault this plugin syncs with.":
		"Seleziona il Vault con cui questo plugin si sincronizza.",
	"Selected: {selected} / {limit}": "Selezionato: {selected} / {limit}",
	"Self-hosted": "Autogestito",
	Semantic: "Semantica",
	"Semantic search": "Ricerca semantica",
	Send: "Invia",
	"Send debug logs. Note content stays private.":
		"Invia i log di debug. Il contenuto delle note rimane privato.",
	"Send detailed sync, vault, and connection activity to the server for troubleshooting, with distributed tracing on requests. Metadata only, never note content. Leave off for normal use.":
		"Invia attività dettagliate di sincronizzazione, vault e connessione al server per la risoluzione dei problemi, con tracciamento distribuito delle richieste. Solo metadati, mai il contenuto delle note. Disattiva per l'uso normale.",
	"Send feedback": "Invia un feedback",
	"Sending…": "Invio…",
	"Server error": "Errore del server",
	"Server error ({status}) — check Engram logs":
		"Errore del server ({status}) — controlla i log di Engram",
	"Server unreachable — changes will sync when connected":
		"Server non raggiungibile — le modifiche verranno sincronizzate quando connesso",
	"Set up sync for this vault": "Configura la sincronizzazione per questo Vault",
	"Setup is not finished — nothing will sync until you choose a sync direction. Click to finish.":
		"La configurazione non è completa: nulla verrà sincronizzato finché non scegli una direzione di sincronizzazione. Clicca per completare.",
	"Show files ({count}) ▾": "Mostra file ({count}) ▾",
	"Show sync log": "Mostra il registro di sincronizzazione",
	"Showing {count} entries": {
		one: "Mostrando {count} elemento",
		many: "Mostrando {count} elementi",
		other: "Mostrando {count} elementi",
	},
	"Sign in": "Accedi",
	"Sign in (or enter your server URL and key) on the connection tab, then run your first sync.":
		"Apri la scheda connessione.",
	"Sign in or create an account": "Accedi o crea un account",
	"Sign out": "Disconnetti",
	"Sign-in expired": "Sessione scaduta",
	"Sign-in required to load vaults": "Richiede l'accesso per caricare gli archivi",
	"Signed in as {email}": "Accesso come {email}",
	Skipped: "Saltato",
	"Source: {link}": "Sorgente: {link}",
	"Start syncing": "Inizia la sincronizzazione",
	Starter: "Starter",
	"Starting...": "Inizio...",
	Stats: "Statistiche",
	"Support development": "Supporta lo sviluppo",
	"Switch to sign in": "Passa all'accesso",
	"Switch vault": "Passa a un altro Vault",
	"Switched to {mode}.": "Passato a {mode}.",
	Sync: "Sincronizza",
	"Sync complete": "Sincronizzazione completata",
	"Sync failed": "Sincronizzazione fallita",
	"Sync in progress...": "Sincronizzazione in corso...",
	"Sync log": "Registro sincronizzazioni",
	"Sync now": "Sincronizza adesso",
	"Sync paused — click to choose a sync direction":
		"Sincronizzazione in pausa — clicca per scegliere la direzione della sincronizzazione",
	"Sync preview": "Anteprima della sincronizzazione",
	"Sync server": "Server di sincronizzazione",
	"Sync these now": "Sincronizza ora",
	"Sync...": "Sincronizza...",
	"Synced. Some attachments need a paid plan to sync (see below).":
		"Sincronizzato. Alcuni allegati richiedono un piano a pagamento per essere sincronizzati (vedi sotto).",
	"Syncing attachments": "Sincronizzazione degli allegati",
	"Syncing your vault": "Sincronizzazione del tuo vault",
	"Syncing...": "Sincronizzazione in corso...",
	"Syncing…": "Sincronizzazione in corso…",
	"Tell us anything": "Dicci qualsiasi cosa",
	"Temporary errors. These clear themselves once the server recovers.":
		"Errori temporanei. Spariranno quando il server tornerà operativo.",
	"Terms of Service": "Termini di servizio",
	"Thanks, we read every message.": "Grazie, leggiamo ogni messaggio.",
	"That does not look like a complete server address. Include the scheme, for example http://127.0.0.1:4000":
		"Sembra che l'indirizzo del server sia incompleto. Includi lo schema, ad esempio http://127.0.0.1:4000",
	"That does not look like an Engram API key (expected {prefix}…).":
		"Non sembra una chiave API di Engram (previsto {prefix}…).",
	"The Free tier syncs notes only. Upgrade to sync images and PDFs.":
		"Il piano gratuito sincronizza solo le note. Aggiorna per sincronizzare immagini e PDF.",
	"The file is too large for the server.": "Il file è troppo grande per il server.",
	"The note synced, but its frontmatter could not be fully parsed. Open it to fix the highlighted line.":
		"La nota è stata sincronizzata, ma il suo frontmatter non è stato completamente analizzato. Aprila per correggere la riga evidenziata.",
	"The server couldn't process this note. Check its contents, then edit and save to try again.":
		"Il server non è riuscito a elaborare questa nota. Controlla il contenuto, poi modificala e salvala per riprovare.",
	"The server limit is 5 MB. Compress or split the file, then it will sync.":
		"Il limite del server è di 5 MB. Comprimi o dividi il file, poi verrà sincronizzato.",
	"The server took too long to respond. Try again.":
		"Il server ha impiegato troppo tempo per rispondere. Riprova.",
	"These files are fine. They just need a paid plan to sync.":
		"Questi file sono ok. Hanno solo bisogno di un piano a pagamento per essere sincronizzati.",
	"This account was deleted. Contact support if that is wrong.":
		"Questo account è stato eliminato. Contatta l'assistenza se non è corretto.",
	"This cannot be undone.": "Questa operazione non è annullabile.",
	"This device's vault is empty. Download {what} from the server?":
		"Il Vault di questo dispositivo è vuoto. Vuoi scaricare {what} dal server?",
	"This file type isn't accepted by this server.":
		"Questo tipo di file non è accettato da questo server.",
	"This note could not be processed and was skipped.":
		"Questa nota non può essere elaborata ed è stata saltata.",
	"This server is self-hosted, so feedback is not collected here. ":
		"Questo server è ospitato privatamente, quindi il feedback non viene raccolto qui. ",
	"This vault": "Questo Vault",
	"This vault is empty on the server. Upload your {what}?":
		"Questo Vault è vuoto sul server. Vuoi caricare {what}?",
	"Too large for the server": "Troppo grande per il server",
	"Too many connected AI clients. Disconnect one or upgrade.":
		"Troppi client AI collegati. Disconnetti uno o effettua l'upgrade.",
	"Too many connected Obsidian vaults. Disconnect one or upgrade.":
		"Troppi archivi Obsidian collegati. Disconnetti uno o effettua l'upgrade.",
	"Too many requests. Wait a moment and try again.":
		"Troppe richieste. Attendi un momento e riprova.",
	"Try again": "Riprova",
	"Type {keyword} to confirm:": "Digita {keyword} per confermare:",
	"Unknown error": "Errore sconosciuto",
	"Unlimited AI searches": "Ricerche AI illimitate",
	"Unlimited vaults": "Archivi illimitati",
	"Unresolved conflict": "Conflitto non risolto",
	Untitled: "Senza titolo",
	Update: "Aggiorna",
	"Update in settings": "Aggiorna nelle impostazioni",
	Upgrade: "Aggiorna",
	"Upload everything": "Carica tutto",
	"Upload local files without downloading the remote":
		"Carica i file locali senza scaricare quelli remoti",
	"Upload {count} files from this vault": {
		one: "Carica {count} file da questo Vault",
		many: "Carica {count} file da questo Vault",
		other: "Carica {count} file da questo Vault",
	},
	Uploading: "Caricamento",
	"Uploading {count}.": {
		one: "Caricamento {count}.",
		many: "Caricamento {count}.",
		other: "Caricamento {count}.",
	},
	"Uploads {up}, downloads {down}.": "Upload {up}, download {down}.",
	"Using API key": "Utilizzo della chiave API",
	Vault: "Vault",
	"Vault ID: {id}": "ID del Vault: {id}",
	"Vault limit reached. Upgrade for more vaults.":
		"Limite di Vault raggiunto. Aggiorna per avere più Vault.",
	"Vault name": "Nome del vault",
	"Vault selection": "Selezione del vault",
	"Vendored dependencies": "Dipendenze incluse",
	"Version: {version}": "Versione: {version}",
	"Waiting for authorization — connected, this will complete instantly.":
		"In attesa di autorizzazione — connesso, il processo si completerà immediatamente.",
	"Waiting for authorization — no live connection, checking every 30s.":
		"In attesa di autorizzazione — nessuna connessione attiva, controllo ogni 30 secondi.",
	"Warnings and errors": "Avvisi ed errori",
	"WebSocket connected — live sync active":
		"WebSocket connesso — sincronizzazione in tempo reale attiva",
	"What Engram does, and how to connect your vault, start to finish.":
		"Cosa fa Engram e come collegare il tuo Vault, dall'inizio alla fine.",
	"What kind of feedback?": "Che tipo di feedback?",
	"What's working, what's frustrating, what do you wish Engram did?":
		"Cosa funziona, cosa frustra, cosa vorresti che Engram facesse?",
	"Where this vault syncs to. Each backend keeps its own sign-in.":
		"Dove questo Vault viene sincronizzato. Ogni backend ha il suo sistema di accesso.",
	"Will download {count} files.": {
		one: "Scaricherà {count} file.",
		many: "Scaricherà {count} file.",
		other: "Scaricherà {count} file.",
	},
	"Will upload {count} files.": {
		one: "Caricherà {count} file.",
		many: "Caricherà {count} di file.",
		other: "Caricherà {count} file.",
	},
	"You are about to:": "Stai per:",
	"You are now pointing at a different cloud vault":
		"Attualmente stai puntando a un Vault cloud diverso",
	"You can close this and the sync keeps running in the background.":
		"Puoi chiudere questa finestra e la sincronizzazione continuerà in background.",
	"You've used all the attachment storage on your plan. Upgrade for more.":
		"Hai esaurito lo spazio di archiviazione degli allegati del tuo piano. Aggiorna per averne di più.",
	"Your code:": "Il tuo codice:",
	"Your feedback": "Il tuo feedback",
	"Your login expired. Sign in again in Engram settings to continue.":
		"La tua sessione è scaduta. Accedi di nuovo nelle impostazioni di Engram per continuare.",
	"Your plan syncs {limit} notes.": "Il tuo piano sincronizza {limit} note.",
	"Your vault shares {percent} of its data with Engram":
		"Il tuo vault condivide {percent} dei suoi dati con Engram",
	attachments: "allegati",
	exact: "esatto",
	files: "file",
	folders: "cartelle",
	"match strength: {pct}%": "livello di corrispondenza: {pct}%",
	"matches meaning. Finds notes that never use the words you typed.":
		"corrisponde al significato. Trova note che non usano le parole che hai digitato.",
	"matches words and meaning together, plus this device. Widest results.":
		"corrisponde a parole e significato insieme, più questo dispositivo. Risultati più ampi.",
	"matches your words and their other forms — 'run' finds 'running' — plus this device.":
		'corrisponde alle tue parole e alle loro altre forme – "run" trova "running" – più questo dispositivo.',
	meaning: "significato",
	"meaning + exact": "significato + esatto",
	"not linked": "non collegato",
	notes: "note",
	"setup guide": "2. Collega il tuo archivio a Engram",
	"sync is paused": "la sincronizzazione è in pausa",
	"syncing now": "sincronizzando",
	unknown: "sconosciuto",
	"waiting for a connection": "in attesa di connessione",
	"waiting to retry": "in attesa di riprovare",
	"{count} attachments": {
		one: "{count} allegato",
		many: "{count} allegati",
		other: "{count} allegati",
	},
	"{count} attachments need a paid plan to sync. See Sync Center.": {
		one: "{count} allegato richiede un piano a pagamento per essere sincronizzato. Vedi il Centro di sincronizzazione.",
		many: "{count} Gli allegati richiedono un piano a pagamento per la sincronizzazione. Vedi il Centro di sincronizzazione.",
		other: "{count} allegati richiedono un piano a pagamento per essere sincronizzati. Vedi il Centro di sincronizzazione.",
	},
	"{count} attempts": {
		one: "{count} tentativo",
		many: "{count} tentativi",
		other: "{count} tentativi",
	},
	"{count} conflicts need resolution": {
		one: "{count} conflitto da risolvere",
		many: "{count} conflitti da risolvere",
		other: "{count} conflitti da risolvere",
	},
	"{count} conflicts to resolve.": {
		one: "{count} conflitto da risolvere.",
		many: "{count} conflitti da risolvere.",
		other: "{count} conflitti da risolvere.",
	},
	"{count} diverged": {
		one: "{count} divergente",
		many: "{count} diverso",
		other: "{count} divergenti",
	},
	'{count} failed. Run "{command}" for details.': {
		one: '{count} fallito. Esegui "{command}" per i dettagli.',
		many: '{count} fallito. Consulta "{command}" per i dettagli.',
		other: '{count} falliti. Consulta "{command}" per i dettagli.',
	},
	"{count} files": { one: "{count} file", many: "{count} file", other: "{count} file" },
	"{count} files not included in your plan": {
		one: "{count} file non incluso nel tuo piano",
		many: "{count} file non inclusi nel tuo piano",
		other: "{count} file non inclusi nel tuo piano",
	},
	"{count} files queued": {
		one: "{count} file in coda",
		many: "{count} file in coda",
		other: "{count} file in coda",
	},
	"{count} ignored": {
		one: "{count} ignorato",
		many: "{count} ignorati",
		other: "{count} ignorati",
	},
	"{count} missing on server": {
		one: "{count} mancante sul server",
		many: "{count} mancanti sul server",
		other: "{count} mancanti sul server",
	},
	"{count} need attention": {
		one: "{count} richiede attenzione",
		many: "{count} richiedono attenzione",
		other: "{count} richiedono attenzione",
	},
	"{count} notes": { one: "{count} nota", many: "{count} note", other: "{count} note" },
	"{count} only on server": {
		one: "{count} solo sul server",
		many: "{count} solo sul server",
		other: "{count} solo sul server",
	},
	"{count} queued — {reason}": {
		one: "{count} in coda — {reason}",
		many: "{count} in coda — {reason}",
		other: "{count} in coda — {reason}",
	},
	"{count} retrying": {
		one: "{count} tentativo in corso",
		many: "{count} tentativo",
		other: "{count} in riprova",
	},
	"{desc} — should not be synced": "{desc} — non deve essere sincronizzato",
	"{first} and {second}": "{first} e {second}",
	"{formatted} per day": "{formatted} al giorno",
	"{label} ({count} queued)": {
		one: "{label} ({count} in coda)",
		many: "{label} ({count} in coda)",
		other: "{label} ({count} in coda)",
	},
	"{n} of 5": "{n} su 5",
	"▶ Watch on YouTube": "▶ Guarda su YouTube",
	"⚙️ Advanced": "⚙️ Avanzate",
	"⚠ Detected: {label}/ ({formatted} files)": "⚠ Rilevato: {label} ({formatted} file)",
	"✓ Engram server reachable (v{version})": "✓ Server Engram raggiungibile (v{version})",
	"✓ {count} synced": {
		one: "✓ {count} archivio sincronizzato",
		many: "✓ {count} sincronizzati",
		other: "✓ {count} sincronizzati",
	},
	"✕ {count} failed": {
		one: "✕ {count} fallito",
		many: "✕ {count} fallito",
		other: "✕ {count} falliti",
	},
	"✗ couldn't reach a server at this URL": "✗ Impossibile raggiungere un server a questo URL",
	"✗ server responded but isn't an Engram server":
		"✗ Il server ha risposto, ma non è un server Engram",
	"⤳ {count} skipped (Free plan)": {
		one: "⤳ {count} saltata (piano gratuito)",
		many: "⤳ {count} saltata (Piano gratuito)",
		other: "⤳ {count} saltati (Piano gratuito)",
	},
	"👋 Welcome": "👋 Benvenuto",
	"💬 Feedback": "💬 Feedback",
	"🔄 Sync Center": "🔄 Centro di sincronizzazione",
	"🔌 Connection": "🔌 Connessione",
};

export default it;
