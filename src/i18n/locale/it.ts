import type { Dict } from "..";

// Italiano
const it: Dict = {
	"Invalid API key": "Chiave API non valida",
	"Connection failed": "Connessione fallita",
	"Link Obsidian to Engram": "Collega Obsidian a Engram",
	"Failed to start device flow. Check your Engram URL and try again.":
		"Impossibile avviare il processo di autorizzazione. Controlla l'URL di Engram e riprova.",
	"Your code:": "Il tuo codice:",
	"Click to copy": "Clicca per copiare",
	"Code copied!": "Codice copiato!",
	"A browser window has opened. Sign in and enter this code to link your vault.":
		"È stata aperta una finestra del browser. Accedi e inserisci questo codice per collegare il tuo archivio.",
	Cancel: "Annulla",
	"Waiting for authorization — connected, this will complete instantly.":
		"In attesa di autorizzazione — connesso, il processo si completerà immediatamente.",
	"Waiting for authorization — no live connection, checking every 30s.":
		"In attesa di autorizzazione — nessuna connessione attiva, controllo ogni 30 secondi.",
	"Code expired. Please try again.": "Codice scaduto. Riprova.",
	"Try again": "Riprova",
	Close: "Chiudi",
	"Note couldn't be processed": "Impossibile elaborare la nota",
	"The server couldn't process this note. Check its contents, then edit and save to try again.":
		"Il server non è riuscito a elaborare questa nota. Controlla il contenuto, poi modificala e salvala per riprovare.",
	"Attachments need a paid plan": "Gli allegati richiedono un piano a pagamento",
	"The Free tier syncs notes only. Upgrade to sync images and PDFs.":
		"Il piano gratuito sincronizza solo le note. Aggiorna per sincronizzare immagini e PDF.",
	"Attachment storage full": "Spazio di archiviazione degli allegati esaurito",
	"You've used all the attachment storage on your plan. Upgrade for more.":
		"Hai esaurito lo spazio di archiviazione degli allegati del tuo piano. Aggiorna per averne di più.",
	"Too large for the server": "Troppo grande per il server",
	"The server limit is 5 MB. Compress or split the file, then it will sync.":
		"Il limite del server è di 5 MB. Comprimi o dividi il file, poi verrà sincronizzato.",
	"Sign-in expired": "Sessione scaduta",
	"Reconnect your account to resume syncing.":
		"Ricollega il tuo account per riprendere la sincronizzazione.",
	"Unresolved conflict": "Conflitto non risolto",
	"Open the file to resolve the conflict, then sync again.":
		"Apri il file per risolvere il conflitto, poi sincronizza di nuovo.",
	"Frontmatter needs a fix": "Il frontmatter necessita di una correzione",
	"The note synced, but its frontmatter could not be fully parsed. Open it to fix the highlighted line.":
		"La nota è stata sincronizzata, ma il suo frontmatter non è stato completamente analizzato. Aprila per correggere la riga evidenziata.",
	"Server error": "Errore del server",
	"A temporary server problem — retrying automatically.":
		"Un problema temporaneo del server — riprova automaticamente.",
	"Network unavailable": "Rete non disponibile",
	"Can't reach the server — retrying automatically.":
		"Impossibile raggiungere il server — riprova automaticamente.",
	"Sync failed": "Sincronizzazione fallita",
	"An unexpected error — retrying automatically.":
		"Si è verificato un errore inatteso — riprova automaticamente.",
	"Frontmatter could not be parsed": "Impossibile analizzare il frontmatter",
	"Note limit reached. Upgrade to keep adding notes.":
		"Numero massimo di note raggiunto. Aggiorna per continuare ad aggiungere note.",
	"Vault limit reached. Upgrade for more vaults.":
		"Numero massimo di archivi raggiunto. Aggiorna per avere più archivi.",
	"This file type isn't accepted by this server.":
		"Questo tipo di file non è accettato da questo server.",
	"Attachment sync is disabled for this account.":
		"La sincronizzazione degli allegati è disabilitata per questo account.",
	"Attachment storage is full — upgrade for more.":
		"Lo spazio di archiviazione degli allegati è pieno, effettua l'upgrade per averne di più.",
	"File too large for your plan.": "File troppo grande per il tuo piano.",
	"Already signed in on another device. Upgrade for multi-device.":
		"Già effettuato l'accesso su un altro dispositivo. Effettua l'upgrade per l'uso su più dispositivi.",
	"Device swap cooldown active. Wait or upgrade.":
		"Periodo di attesa per il cambio dispositivo attivo. Attendi o effettua l'upgrade.",
	"Too many connected Obsidian vaults. Disconnect one or upgrade.":
		"Troppi archivi Obsidian collegati. Disconnetti uno o effettua l'upgrade.",
	"Too many connected AI clients. Disconnect one or upgrade.":
		"Troppi client AI collegati. Disconnetti uno o effettua l'upgrade.",
	"Daily AI search limit reached. Free includes 20 per day across Obsidian, the web app and MCP. Upgrade for unlimited.":
		"Raggiunto il limite giornaliero di ricerche AI. Il piano gratuito include 20 ricerche al giorno tra Obsidian, l'app web e MCP. Effettua l'upgrade per un uso illimitato.",
	"API keys need Pro. Sign in with your Engram account instead.":
		"Le chiavi API richiedono il piano Pro. Accedi con il tuo account Engram.",
	"Account suspended. Contact support.": "Account sospeso. Contatta l'assistenza.",
	"Account setup incomplete.": "Configurazione dell'account incompleta.",
	"This account was deleted. Contact support if that is wrong.":
		"Questo account è stato eliminato. Contatta l'assistenza se non è corretto.",
	"Finish setting up your account at app.engram.page to start syncing.":
		"Completa la configurazione del tuo account su app.engram.page per iniziare la sincronizzazione.",
	"Limit reached. Upgrade to continue.": "Limite raggiunto. Aggiorna per continuare.",
	Upgrade: "Aggiorna",
	"Update in settings": "Aggiorna nelle impostazioni",
	"Sync now": "Sincronizza adesso",
	"Engram sync: syncing...": "Sincronizzazione Engram: in corso...",
	"Engram Sync: pulled {pulled}, pushed {pushed}":
		"Engram Sync: scaricati {pulled}, inviati {pushed}",
	"Disconnect (clear login)": "Disconnetti (cancella l'accesso)",
	"Engram: disconnected. Open Engram settings to reconnect.":
		"Engram: disconnesso. Apri le impostazioni di Engram per riconnetterti.",
	"Push entire vault": "Invia l'intero archivio",
	"Engram Sync: pushed {count} files": {
		one: "Engram Sync: inviato {count} file",
		many: "Engram Sync: sincronizzati {count} file",
		other: "Engram Sync: inviati {count} file",
	},
	"Check sync status": "Controlla lo stato della sincronizzazione",
	"Engram sync: checking...": "Sincronizzazione Engram: in verifica...",
	"Engram sync: server does not support reconciliation (update backend)":
		"Sincronizzazione Engram: il server non supporta la riconciliazione (aggiorna il backend)",
	"Engram sync: everything in sync": "Sincronizzazione Engram: tutto sincronizzato",
	"{count} missing on server": "{count} mancante sul server",
	"{count} diverged": "{count} divergente",
	"{count} only on server": "{count} solo sul server",
	"Engram Sync: {details}": "Sincronizzazione Engram: {details}",
	"Pull all from server (force overwrite)": "Scarica tutto dal server (sovrascrivi forzatamente)",
	"Engram sync: pulling all from server...":
		"Sincronizzazione Engram: scaricamento di tutto dal server...",
	"Engram Sync: pulled {count} files from server": {
		one: "Engram Sync: scaricato {count} file dal server",
		many: "Engram Sync: scaricati {count} file dal server",
		other: "Engram Sync: scaricati {count} file dal server",
	},
	"Show sync log": "Mostra il registro di sincronizzazione",
	"Semantic search": "Ricerca semantica",
	"Open search sidebar": "Apri la barra laterale di ricerca",
	"Engram search": "Ricerca Engram",
	"Open sync center": "Apri il Centro di sincronizzazione",
	"Engram: ready": "Engram: pronto",
	"Engram Sync: pushed {pushed}": "Engram Sync: inviati {pushed}",
	"Engram sync: sync failed": "Sincronizzazione Engram: errore",
	"Engram: this vault no longer exists on the server. Pick or create a vault to continue.":
		"Engram: questo archivio non esiste più sul server. Seleziona o crea un archivio per continuare.",
	"Engram: recovered plugin settings from a backup after a corrupted save.":
		"Engram: impostazioni del plugin ripristinate da un backup dopo un salvataggio corrotto.",
	"Engram: plugin settings file was corrupted and could not be recovered. You may need to reconnect in settings.":
		"Engram: il file delle impostazioni del plugin è corrotto e non può essere ripristinato. Potrebbe essere necessario ricollegare l'account nelle impostazioni.",
	"Engram: your login expired — open Engram settings to reconnect.":
		"Engram: la tua sessione è scaduta: apri le impostazioni di Engram per ricollegarti.",
	"Engram: This vault has been deleted on the server.":
		"Engram: questo archivio è stato eliminato sul server.",
	"Engram sync: live sync requires a plugin update — please update the Engram vault sync plugin.":
		"Engram sync: la sincronizzazione in tempo reale richiede un aggiornamento del plugin: aggiorna il plugin Engram vault sync.",
	"Engram Sync: pulled {pulled} (local extras deleted)":
		"Engram Sync: scaricati {pulled} (file extra locali eliminati)",
	"Engram Sync: pulled {pulled}": "Engram Sync: scaricati {pulled}",
	"Engram Sync: replaced remote with local ({pushed} uploaded)":
		"Engram Sync: sostituito il file remoto con quello locale ({pushed} caricati)",
	"Engram: sync is not set up yet, so nothing in this vault will sync.":
		"Engram: la sincronizzazione non è ancora configurata, quindi nulla in questo archivio verrà sincronizzato.",
	"Finish sync setup": "Completa la configurazione della sincronizzazione",
	"Engram: sync is paused. This edit was not synced. Choose a sync direction to resume.":
		"Engram: la sincronizzazione è in pausa. Questa modifica non è stata sincronizzata. Scegli una direzione di sincronizzazione per riprendere.",
	"Open Engram settings": "Apri le impostazioni di Engram",
	"Engram: sync failed. Open the sync log for details.":
		"Engram: la sincronizzazione è fallita. Apri il registro di sincronizzazione per i dettagli.",
	"Engram: not connected": "Engram: non connesso",
	"Engram: signed out": "Engram: disconnesso",
	"Not connected yet. Click to open settings and link this vault.":
		"Non ancora connesso. Clicca per aprire le impostazioni e collegare questo archivio.",
	"Not signed in. Click to open settings and reconnect.":
		"Non ancora connesso. Clicca per aprire le impostazioni e riconnetterti.",
	"Engram: finish setup": "Engram: completa la configurazione",
	"Engram: sync paused": "Engram: sincronizzazione in pausa",
	"{label} ({count} queued)": "{label} ({count} in coda)",
	"Setup is not finished — nothing will sync until you choose a sync direction. Click to finish.":
		"La configurazione non è completa: nulla verrà sincronizzato finché non scegli una direzione di sincronizzazione. Clicca per completare.",
	"Sync paused — click to choose a sync direction":
		"Sincronizzazione in pausa — clicca per scegliere la direzione della sincronizzazione",
	"Engram: offline ({count} queued)": "Engram: offline ({count} in coda)",
	"Engram: offline": "Engram: offline",
	"Server unreachable — changes will sync when connected":
		"Server non raggiungibile — le modifiche verranno sincronizzate quando connesso",
	"Engram: error": "Engram: errore",
	"Unknown error": "Errore sconosciuto",
	"Engram: syncing ({count})": "Engram: sincronizzando ({count})",
	"Engram: syncing": "Engram: sincronizzando",
	"Sync in progress...": "Sincronizzazione in corso...",
	"Engram: pending ({count})": "Engram: in attesa ({count})",
	"{count} files queued": {
		one: "{count} file in coda",
		many: "{count} file in coda",
		other: "{count} file in coda",
	},
	"Engram: live": "Engram: attivo",
	"WebSocket connected — live sync active":
		"WebSocket connesso — sincronizzazione in tempo reale attiva",
	"Click to sync": "Clicca per sincronizzare",
	"Engram: ⚠ {count} sync errors": {
		one: "Engram: ⚠ {count} errore di sincronizzazione",
		many: "Engram: ⚠ {count} errori di sincronizzazione",
		other: "Engram: ⚠ {count} errori di sincronizzazione",
	},
	"Last sync: {when}": "Ultima sincronizzazione: {when}",
	"Engram Sync: pulled {count} changes": {
		one: "Engram Sync: aggiornate {count} modifica",
		many: "Engram Sync: aggiornate le modifiche {count}",
		other: "Engram Sync: aggiornate {count} modifiche",
	},
	'Engram Sync: sync state for "{name}" was unreadable — using the on-disk copy.':
		'Engram Sync: lo stato di sincronizzazione di "{name}" non è leggibile, si sta usando la copia locale.',
	"Engram Vault Sync {version} is available. {link}.":
		"Engram Vault Sync {version} disponibile. {link}.",
	"{formatted} files · ": {
		one: "{formatted} file ·",
		many: "{formatted} file ·",
		other: "{formatted} file ·",
	},
	"Notes searchable": "Note indicizzabili",
	"Notes past this still sync and open normally, they are just not in the search index. The index keeps your oldest notes, so it is your newest ones that fall outside.":
		"Le note successive a questa vengono comunque sincronizzate e aperte normalmente, ma non sono nell'indice di ricerca. L'indice conserva le tue note più vecchie, quindi sono quelle più recenti che non vengono incluse.",
	"Notes stored": "Note salvate",
	Attachments: "Allegati",
	"AI searches": "Ricerche AI",
	"{formatted} per day": "{formatted} al giorno",
	Keyword: "Parola chiave",
	Semantic: "Semantica",
	Both: "Entrambe",
	"matches your words and their other forms — 'run' finds 'running' — plus this device.":
		'corrisponde alle tue parole e alle loro altre forme – "run" trova "running" – più questo dispositivo.',
	"matches meaning. Finds notes that never use the words you typed.":
		"corrisponde al significato. Trova note che non usano le parole che hai digitato.",
	"matches words and meaning together, plus this device. Widest results.":
		"corrisponde a parole e significato insieme, più questo dispositivo. Risultati più ampi.",
	"Engram indexes {indexed} of your {all} notes. The rest match on this device only. Upgrade to index everything.":
		"Engram indicizza {indexed} delle tue {all} note. Il resto corrisponde solo su questo dispositivo. Aggiorna per indicizzare tutto.",
	"Searching {indexed} of {all} notes. Upgrade to search everything.":
		"Ricerca in {indexed} di {all} note. Aggiorna per cercare tutto.",
	"Search your vault…": "Cerca nel tuo archivio…",
	"Clear search": "Cancella la ricerca",
	"Search settings": "Impostazioni di ricerca",
	"Filter by folder…": "Filtra per cartella…",
	"Filter by tags…": "Filtra per tag…",
	"Remove tag {tag}": "Rimuovi il tag {tag}",
	"Engram unreachable. Showing matches from this device only.":
		"Engram non raggiungibile. Mostra i risultati solo da questo dispositivo.",
	"Search failed — check connection": "Ricerca fallita — controlla la connessione",
	"No results found": "Nessun risultato trovato",
	Untitled: "Senza titolo",
	"meaning + exact": "significato + esatto",
	"match strength: {pct}%": "livello di corrispondenza: {pct}%",
	"No source path for this result": "Nessun percorso di origine per questo risultato",
	"Note not synced locally": "La nota non è sincronizzata localmente",
	"Syncing...": "Sincronizzazione in corso...",
	"👋 Welcome": "👋 Benvenuto",
	"🔌 Connection": "🔌 Connessione",
	"🔄 Sync Center": "🔄 Centro di sincronizzazione",
	"⚙️ Advanced": "⚙️ Avanzate",
	"Engram: settings tab failed to render ({error})":
		"Engram: impossibile visualizzare la scheda delle impostazioni ({error})",
	Disconnected: "Disconnesso",
	"Error: {error}": "Errore: {error}",
	unknown: "sconosciuto",
	"Connected — waiting for first sync decision":
		"Connesso — in attesa della prima decisione di sincronizzazione",
	"Connected — live sync active": "Connesso — sincronizzazione attiva",
	"Connected — polling": "Connesso — in attesa",
	"Not configured": "Non configurato",
	"Open sync setup": "Apri la configurazione di sincronizzazione",
	"waiting for a connection": "in attesa di connessione",
	"sync is paused": "la sincronizzazione è in pausa",
	"syncing now": "sincronizzando",
	"waiting to retry": "in attesa di riprovare",
	"{count} not on your plan": "{count} non incluso nel tuo piano",
	"{count} need attention": {
		one: "{count} richiede attenzione",
		many: "{count} richiede attenzione",
		other: "{count} richiedono attenzione",
	},
	"{count} retrying": "{count} tentativo in corso",
	"{count} ignored": "{count} ignorato",
	"{count} queued — {reason}": "{count} in coda — {reason}",
	"Sync...": "Sincronizza...",
	"sync failed": "sincronizzazione fallita",
	Refresh: "Aggiorna",
	"Not synced on your plan ({count})": "Non sincronizzato nel tuo piano ({count})",
	"These files are fine. They just need a paid plan to sync.":
		"Questi file sono ok. Hanno solo bisogno di un piano a pagamento per essere sincronizzati.",
	"Show files ({count}) ▾": "Mostra file ({count}) ▾",
	"Sync these now": "Sincronizza ora",
	"Needs attention ({count})": "Richiede attenzione ({count})",
	"Clear all": "Pulisci tutto",
	"Nothing needs your attention. 🎉": "Non ci sono problemi da risolvere. 🎉",
	Dismiss: "Annulla",
	"Retrying automatically ({count})": "Tentativo automatico ({count})",
	"Retry all now": "Riprova tutto adesso",
	"Temporary errors. These clear themselves once the server recovers.":
		"Errori temporanei. Spariranno quando il server si riprenderà.",
	"{count} attempts": {
		one: "{count} tentativo",
		many: "{count} tentativi",
		other: "{count} tentativi",
	},
	Open: "Apri",
	Ignore: "Ignora",
	"No files ignored. Use the ignore button on a failure row to stop syncing it.":
		'Nessun file ignorato. Usa il pulsante "ignora" su una riga con errori per interrompere la sincronizzazione.',
	Restore: "Ripristina",
	"File not found locally: {path}": "File non trovato localmente: {path}",
	"Ignored {path} — won't sync until restored from Sync Center.":
		"Ignorato {path} — non verrà sincronizzato finché non verrà ripristinato dal Centro di sincronizzazione.",
	"Restored {path} — will sync on next push.":
		"Ripristinato {path} — verrà sincronizzato al prossimo aggiornamento.",
	Clear: "Cancella",
	"No activity yet. Push or pull to see entries here.":
		"Nessuna attività ancora. Effettua una sincronizzazione per vedere le voci.",
	Stats: "Statistiche",
	"Notes on this device": "Note su questo dispositivo",
	"Attachments on this device": "Allegati su questo dispositivo",
	"Remote vault": "Archivio remoto",
	"not linked": "non collegato",
	"Plan usage": "Utilizzo del piano",
	"Sync log": "Registro sincronizzazioni",
	"Showing {count} entries": {
		one: "Mostrando {count} elemento",
		many: "Mostrando {count} elementi",
		other: "Mostrando {count} elementi",
	},
	"No sync activity this session.": "Nessuna attività di sincronizzazione in questa sessione.",
	"({count} errors)": {
		one: "({count} errore)",
		many: "({count} errori)",
		other: "({count} errori)",
	},
	"Could not compare with the cloud. Check your connection.":
		"Impossibile confrontare con il cloud. Controlla la connessione.",
	"Your login expired. Sign in again in Engram settings to continue.":
		"La tua sessione è scaduta. Accedi di nuovo nelle impostazioni di Engram per continuare.",
	"Couldn't create vault — the name may be invalid or already in use.":
		"Impossibile creare l'archivio: il nome potrebbe essere non valido o già in uso.",
	"Could not create the vault — check your connection and try again.":
		"Impossibile creare l'archivio: controlla la connessione e riprova.",
	"Free syncs notes only — {count} attachments will be skipped.": {
		one: "Sincronizza gratuitamente le note, ma salta {count} allegato.",
		many: "Sincronizza gratuitamente solo le note; verranno saltati {count} allegati.",
		other: "Sincronizza gratuitamente solo le note; verranno saltati {count} allegati.",
	},
	"Uploads {up}, downloads {down}.": "Upload {up}, download {down}.",
	"Uploads {count}.": "Upload {count}.",
	"Downloads {count}.": "Download {count}.",
	"{count} conflicts to resolve.": {
		one: "{count} conflitto da risolvere.",
		many: "{count} conflitti da risolvere.",
		other: "{count} conflitti da risolvere.",
	},
	"Safe choice: combines both sides, nothing is deleted.":
		"Scelta sicura: combina entrambe le parti, niente viene eliminato.",
	"Nothing is deleted.": "Niente viene eliminato.",
	"Already in sync. Nothing is deleted.": "Già sincronizzato. Niente viene eliminato.",
	"Delete all {count} files currently on the server": {
		one: "Elimina tutti e {count} i file attualmente sul server",
		many: "Elimina tutti i file {count} attualmente sul server",
		other: "Elimina tutti e {count} i file attualmente sul server",
	},
	"Upload {count} files from this vault": {
		one: "Carica {count} file da questo archivio",
		many: "Carica {count} file da questo archivio",
		other: "Carica {count} file da questo archivio",
	},
	"Delete all {count} files in this vault": {
		one: "Elimina tutti i {count} file in questo archivio",
		many: "Elimina tutti i file {count} in questo archivio",
		other: "Elimina tutti i {count} file in questo archivio",
	},
	"Download {count} files from the server": {
		one: "Scarica {count} file dal server",
		many: "Scarica {count} file dal server",
		other: "Scarica {count} file dal server",
	},
	Sync: "Sincronizza",
	"Upload local files without downloading the remote":
		"Carica i file locali senza scaricare quelli remoti",
	"Delete all on remote, then upload local files":
		"Elimina tutto sul server, poi carica i file locali",
	"Download remote files without uploading the local":
		"Scarica i file remoti senza caricare quelli locali",
	"Delete all local files, then download from remote":
		"Elimina tutti i file locali, poi scaricali dal server",
	"Set up sync for this vault": "Configura la sincronizzazione per questo archivio",
	"You are now pointing at a different cloud vault":
		"Ora stai puntando a un archivio cloud diverso",
	"Sync preview": "Anteprima della sincronizzazione",
	"Nothing to sync yet — this vault is empty on both sides. Start syncing and everything you write appears on your other devices.":
		"Al momento non c'è nulla da sincronizzare: questo archivio è vuoto su entrambi i lati. Inizia la sincronizzazione e tutto ciò che scrivi apparirà sui tuoi altri dispositivi.",
	"Start syncing": "Inizia la sincronizzazione",
	"{count} notes": { one: "{count} nota", many: "{count} note", other: "{count} note" },
	"{count} attachments": {
		one: "{count} allegato",
		many: "{count} allegati",
		other: "{count} allegati",
	},
	"{first} and {second}": "{first} e {second}",
	files: "file",
	"This vault is empty on the server. Upload your {what}?":
		"Questo archivio è vuoto sul server. Vuoi caricare i tuoi {what}?",
	"Upload everything": "Carica tutto",
	"Nothing will be removed from this device.": "Nulla verrà eliminato da questo dispositivo.",
	"This device's vault is empty. Download {what} from the server?":
		"L'archivio di questo dispositivo è vuoto. Vuoi scaricare {what} dal server?",
	"Download everything": "Scarica tutto",
	Done: "Fatto",
	"Send debug logs. Note content stays private.":
		"Invia i log di debug. Il contenuto delle note rimane privato.",
	"Comparing your vault with the cloud…": "Confronto del tuo archivio con il cloud…",
	"Not now": "Non ora",
	"Change vault": "Cambia archivio",
	"Advanced sync options": "Opzioni di sincronizzazione avanzate",
	"Everything is in sync": "Tutto è sincronizzato",
	"This vault": "Questo archivio",
	"Cloud server": "Server cloud",
	" conflicts need resolution": {
		one: "conflitto da risolvere",
		many: "conflitti da risolvere",
		other: "conflitti da risolvere",
	},
	notes: "note",
	attachments: "allegati",
	folders: "cartelle",
	"Confirm destructive sync": "Conferma sincronizzazione distruttiva",
	"You are about to:": "Stai per:",
	"Files that will be deleted:": "File che verranno eliminati:",
	"This cannot be undone.": "Questa operazione non è annullabile.",
	Back: "Indietro",
	Confirm: "Conferma",
	"Switch vault": "Cambia archivio",
	"Pick a vault to sync with. We will recalculate the sync preview after you choose.":
		"Scegli un archivio da sincronizzare. Ricalcoleremo l'anteprima della sincronizzazione dopo la tua scelta.",
	"Loading vaults…": "Caricamento archivi…",
	" (default)": "(predefinito)",
	"No other vaults available.": "Nessun altro archivio disponibile.",
	"Make new vault": "Crea un nuovo archivio",
	"New vault": "Nuovo archivio",
	"Create a new empty vault on the server, then sync this Obsidian vault into it.":
		"Crea un nuovo archivio vuoto sul server, quindi sincronizza questo archivio Obsidian con esso.",
	"Vault name": "Nome dell'archivio",
	Create: "Crea",
	"Could not load vaults": "Impossibile caricare gli archivi",
	"Enter a name for the new vault": "Inserisci un nome per il nuovo archivio",
	"Failed to switch vault": "Impossibile passare a un altro archivio",
	"Your vault shares {percent} of its data with Engram":
		"Il tuo archivio condivide {percent} dei suoi dati con Engram",
	"Type {keyword} to confirm:": "Digita {keyword} per confermare:",
	"Uploading {count}.": "Caricamento di {count}.",
	"Downloading {count}.": "Download di {count}.",
	"Deleting {count} local files.": {
		one: "Eliminando {count} file locale.",
		many: "Eliminando {count} file locali.",
		other: "Eliminando {count} file locali.",
	},
	"Deleting {count} on the cloud.": "Eliminazione di {count} nel cloud.",
	"First sync, this may take a moment.":
		"Prima sincronizzazione, potrebbe richiedere un momento.",
	"Checking for changes.": "Controllo delle modifiche.",
	"Nothing will be deleted.": "Nulla verrà eliminato.",
	"✓ {count} synced": "✓ {count} sincronizzato",
	"⤳ {count} skipped (Free plan)": "⤳ {count} saltato (piano gratuito)",
	"✕ {count} failed": "✕ {count} fallito",
	"{count} attachments need a paid plan to sync. See Sync Center.": {
		one: "{count} allegato richiede un piano a pagamento per essere sincronizzato. Vedi il Centro di sincronizzazione.",
		many: "{count} Gli allegati richiedono un piano a pagamento per la sincronizzazione. Vedi il Centro di sincronizzazione.",
		other: "{count} allegati richiedono un piano a pagamento per essere sincronizzati. Vedi il Centro di sincronizzazione.",
	},
	"Finished with some errors. Open the sync log to see what failed.":
		"Completata con alcuni errori. Apri il registro di sincronizzazione per vedere cosa è fallito.",
	"Synced. Some attachments need a paid plan to sync (see below).":
		"Sincronizzato. Alcuni allegati richiedono un piano a pagamento per essere sincronizzati (vedi sotto).",
	"All synced. Your vault and the cloud now match.":
		"Tutto sincronizzato. Il tuo archivio e il cloud ora corrispondono.",
	"Already up to date. Nothing needed syncing.":
		"Già aggiornato. Non è necessario sincronizzare nulla.",
	Deleting: "Eliminando",
	Downloading: "Scaricando",
	Uploading: "Caricamento",
	"Syncing your vault": "Sincronizzazione del tuo archivio",
	"Getting started…": "Inizializzazione…",
	"Open Engram to check your vault and confirm everything synced.":
		"Apri Engram per controllare il tuo archivio e confermare che tutto sia stato sincronizzato.",
	"Open Engram": "Apri Engram",
	"You can close this and the sync keeps running in the background.":
		"Puoi chiudere questa finestra e la sincronizzazione continuerà in background.",
	"Run in background": "Esegui in background",
	"Syncing…": "Sincronizzazione in corso…",
	"Sync complete": "Sincronizzazione completata",
	"Syncing attachments": "Sincronizzazione degli allegati",
	Complete: "Completato",
	'{count} failed. Run "{command}" for details.':
		'{count} non riuscito. Esegui "{command}" per i dettagli.',
	"Free syncs notes only — images & PDFs need a paid plan.":
		"La sincronizzazione è gratuita solo per le note; immagini e PDF richiedono un piano a pagamento.",
	"Engram: {count} files failed to sync{detail} — open Sync Center": {
		one: "Engram: impossibile sincronizzare {count} file{detail} — apri il Centro di sincronizzazione",
		many: "Engram: impossibile sincronizzare {count} file{detail} — apri il Centro di sincronizzazione",
		other: "Engram: impossibile sincronizzare {count} file{detail} — apri il Centro di sincronizzazione",
	},
	"Engram: {count} attachments skipped — upgrade to sync images & PDFs.": {
		one: "Engram: {count} allegato saltato — aggiorna per sincronizzare immagini e PDF.",
		many: "Engram: Saltati {count} allegati — aggiorna per sincronizzare immagini e PDF.",
		other: "Engram: {count} allegati saltati — aggiorna per sincronizzare immagini e PDF.",
	},
	"Engram: plan upgraded — syncing {count} attachments…": {
		one: "Engram: piano aggiornato — sincronizzando {count} allegato…",
		many: "Engram: piano aggiornato — sincronizzando {count} allegati…",
		other: "Engram: piano aggiornato — sincronizzando {count} allegati…",
	},
	"Pull all (delete extras) aborted: could not obtain an exclusive server snapshot (replay contention). Nothing was trashed.":
		"Pull di tutti i file interrotto: impossibile ottenere uno snapshot esclusivo del server (conflitto di replay). Nessun file è stato eliminato.",
	"Pull all aborted: another sync is running (replay contention). Try again when it finishes.":
		"Pull di tutti i file interrotto: un'altra sincronizzazione è in corso (conflitto di replay). Riprova quando sarà terminata.",
	"Pull all failed: {error}": "Pull di tutti i file fallito: {error}",
	"Pull all failed": "Pull di tutti i file fallito",
	"Engram: sync conflict on {path} — your local edit was saved as {copy}":
		"Engram: conflitto di sincronizzazione su {path} — la tua modifica locale è stata salvata come {copy}",
	"Open note": "Apri la nota",
	"Engram: {count} notes have frontmatter problems. Open Sync Center to fix.":
		"Engram: {count} note hanno problemi con il frontmatter. Apri il Centro di sincronizzazione per risolverli.",
	'Engram Sync: renamed "{name}" (unsupported characters)':
		'Engram Sync: rinominato "{name}" (caratteri non supportati)',
	'Engram: frontmatter problem in "{name}"': 'Engram: problema con il frontmatter in "{name}"',
	"Engram: this plugin is too old to sync (needs {version} or newer). Update it to continue.":
		"Engram: questo plugin è troppo vecchio per sincronizzare (richiede {version} o versione successiva). Aggiornalo per continuare.",
	"Engram: this plugin is too old to sync. Update it to continue.":
		"Engram: questo plugin è troppo vecchio per sincronizzare. Aggiornalo per continuare.",
	Update: "Aggiorna",
	"New here? Watch the setup video": "Sei nuovo qui? Guarda il video di configurazione",
	"What Engram does, and how to connect your vault, start to finish.":
		"Cosa fa Engram e come collegare il tuo archivio, dalla A alla Z.",
	"▶ Watch on YouTube": "▶ Guarda su YouTube",
	"Getting set up": "Configurazione",
	"1. Make an account": "1. Crea un account",
	"Create a hosted account at ":
		"Crea un account ospitato su [placeholder], oppure ospita tu stesso il backend (",
	", or self-host the backend (": "guida alla configurazione",
	"setup guide": "2. Collega il tuo archivio a Engram",
	"2. Connect your vault to Engram": "2. Collega il tuo archivio a Engram",
	"Sign in (or enter your server URL and key) on the connection tab, then run your first sync.":
		"Apri la scheda connessione.",
	"Open connection tab": "Apri la scheda connessione",
	"3. Connect your AI": "3. Collega la tua AI",
	"Link Claude, Cursor, ChatGPT, or any MCP app so it can read and write your notes. ":
		"Collega Claude, Cursor, ChatGPT o qualsiasi app MCP per permettergli di leggere e scrivere le tue note",
	"See the AI setup guide": "Consulta la guida per la configurazione dell'AI",
	Plans: "Piani",
	Free: "Gratuito",
	"1 vault, 2 devices": "1 archivio, 2 dispositivi",
	"Real-time sync": "Sincronizzazione in tempo reale",
	"2,000 notes searchable": "2.000 note ricercabili",
	"Connect any AI (MCP)": "Collega qualsiasi AI (MCP)",
	Starter: "Base",
	"10 vaults, unlimited devices": "10 archivi, dispositivi illimitati",
	"Search all your notes": "Cerca tutte le tue note",
	"10 GB attachments": "10 GB di allegati",
	"Unlimited AI searches": "Ricerche AI illimitate",
	Pro: "Pro",
	"Unlimited vaults": "Archivi illimitati",
	"Search across all vaults at once": "Cerca in tutti gli archivi contemporaneamente",
	"50 GB attachments": "50 GB di allegati",
	"API access": "Accesso all'API",
	"See full pricing": "Vedi i prezzi completi",
	"Learn more": "Scopri di più",
	Documentation: "Documentazione",
	"AI / MCP setup guide": "Guida all'installazione AI / MCP",
	"Report an issue": "Segnala un problema",
	"Join our Discord": "Unisciti al nostro Discord",
	"Node.js dependencies": "Dipendenze Node.js",
	"Python virtual environment": "Ambiente virtuale Python",
	"Python bytecode cache": "Cache del bytecode Python",
	"Vendored dependencies": "Dipendenze incluse",
	"Gradle build cache": "Cache della build Gradle",
	"Rust/Java build output": "Output della build Rust/Java",
	"Build output": "Output della build",
	"Next.js build output": "Output della build Next.js",
	"Distribution build output": "Output della build di distribuzione",
	"Cargo cache": "Cache di Cargo",
	"CocoaPods dependencies": "Dipendenze CocoaPods",
	"Dart tool cache": "Cache degli strumenti Dart",
	"Generic cache directory": "Directory di cache generica",
	"Ignore patterns": "Modelli da ignorare",
	"Custom patterns": "Modelli personalizzati",
	"Paths to skip (one per line). Folder patterns end with /. Built-in: {configDir}/, .trash/, .git/":
		"Percorsi da escludere (uno per riga). I modelli di cartella terminano con /. Predefiniti: {configDir}/, .trash/, .git/",
	Diagnostics: "Diagnostica",
	"Send detailed sync, vault, and connection activity to the server for troubleshooting, with distributed tracing on requests. Metadata only, never note content. Leave off for normal use.":
		"Invia attività dettagliate di sincronizzazione, archivio e connessione al server per la risoluzione dei problemi, con tracciamento distribuito delle richieste. Solo metadati, mai contenuto delle note. Disattiva per l'uso normale.",
	"Diagnostics detail": "Dettagli diagnostica",
	"Minimum severity that ships while diagnostics are on. Higher levels send fewer lines. Default: Info.":
		"Livello minimo di gravità visualizzato quando la diagnostica è attiva. I livelli più alti inviano meno righe. Predefinito: Info.",
	"Errors only": "Errori",
	"Warnings and errors": "Avvisi ed errori",
	"Info (default)": "Info (predefinito)",
	"Debug (verbose)": "Debug (dettagliato)",
	About: "Informazioni",
	"License: {name}": "Licenza: {name}",
	"⚠ Detected: {label}/ ({formatted} files)": "⚠ Rilevato: {label} ({formatted} file)",
	"{desc} — should not be synced": "{desc} — non deve essere sincronizzato",
	"Add to ignores": "Aggiungi agli ignorati",
	"Added {pattern} to ignore patterns": "Aggiunto {pattern} ai modelli da ignorare",
	"Version: {version}": "Versione: {version}",
	"Source: {link}": "Sorgente: {link}",
	"Engram URL": "URL di Engram",
	"✓ Engram server reachable (v{version})": "✓ Server Engram raggiungibile (v{version})",
	"✗ server responded but isn't an Engram backend":
		"✗ Il server ha risposto, ma non è un backend di Engram",
	"✗ couldn't reach a server at this URL": "✗ Impossibile raggiungere un server a questo URL",
	"Checking server…": "Controllo del server…",
	"That does not look like a complete server address. Include the scheme, for example http://127.0.0.1:4000":
		"Sembra che l'indirizzo del server sia incompleto. Includi lo schema, ad esempio http://127.0.0.1:4000",
	"Engram backend changed — sign in again to continue.":
		"Backend di Engram modificato: accedi di nuovo per continuare.",
	Authentication: "Autenticazione",
	"Signed in as {email}": "Accesso come {email}",
	"Authenticated via Engram account (OAuth).": "Autenticato tramite account Engram (OAuth).",
	"Manage account": "Gestisci l'account",
	"Sign out": "Disconnetti",
	"Using API key": "Utilizzo della chiave API",
	"Authenticated via manual API key.": "Autenticato tramite chiave API manuale.",
	"Clear key": "Cancella la chiave",
	"Switch to sign in": "Passa all'accesso",
	"Engram: sign-in failed ({error})": "Engram: impossibile accedere ({error})",
	"Sign in or create an account": "Accedi o crea un account",
	"Opens your browser to sign in, or create an account if you don't have one yet, then links this vault.":
		"Apre il tuo browser per accedere, oppure crea un account se non ne hai ancora uno, quindi collega questo archivio.",
	"Sign in": "Accedi",
	"Or authenticate with a token instead of signing in. Engram Cloud API keys require the Pro plan; on Free and Starter, sign in above.":
		"Oppure autenticati con un token invece di accedere. Le chiavi API di Engram richiedono il piano Pro; nei piani Free e Starter, accedi qui sopra.",
	"Or authenticate with a token instead of signing in.":
		"Oppure autenticati con un token invece di accedere.",
	"API key": "Chiave API",
	Token: "Token",
	"Bearer token from your Engram account.": "Token di accesso dal tuo account Engram.",
	Save: "Salva",
	"Enter an API key first": "Inserisci prima una chiave API",
	"That does not look like an Engram API key (expected {prefix}…).":
		"Non sembra una chiave API di Engram (previsto {prefix}…).",
	Vault: "Archivio",
	"Vault selection": "Selezione dell'archivio",
	"Select which vault this plugin syncs with.":
		"Seleziona l'archivio con cui questo plugin si sincronizza.",
	"No vaults found — first sync will create one":
		"Nessun archivio trovato — la prima sincronizzazione ne creerà uno",
	"Pick a vault (previous: '{name}' not found)":
		"Scegli un archivio (precedente: '{name}' non trovato)",
	"Pick a vault (previous: id {id} not found)":
		"Scegli un archivio (precedente: id {id} non trovato)",
	"Pick a vault": "Scegli un archivio",
	Change: "Cambia",
	"Support development": "Supporta lo sviluppo",
	"If this plugin saves you time, consider supporting development.":
		"Se questo plugin ti fa risparmiare tempo, considera di supportare lo sviluppo.",
	"GitHub Sponsors": "GitHub Sponsors",
	"Sign-in required to load vaults": "Richiede l'accesso per caricare gli archivi",
	"Server error ({status}) — check Engram logs":
		"Errore del server ({status}) — controlla i log di Engram",
	"Request failed ({status})": "Richiesta fallita ({status})",
	"Could not reach Engram — check connection":
		"Impossibile raggiungere Engram — controlla la connessione",
	"Engram Cloud": "Cloud Engram",
	"Self-hosted": "Autogestito",
	Backend: "Backend",
	"Where this vault syncs to. Each backend keeps its own sign-in.":
		"Dove questo archivio viene sincronizzato. Ogni backend ha il suo sistema di accesso.",
	"Switched to {mode}.": "Passato a {mode}.",
	"Not connected. Enter your Engram server URL below to start syncing.":
		"Non connesso. Inserisci l'URL del tuo server Engram qui sotto per iniziare la sincronizzazione.",
	"Run your own Engram server": "Gestisci il tuo server Engram",
	"Engram is the backend that powers sync and semantic search.":
		"Engram è il backend che alimenta la sincronizzazione e la ricerca semantica.",
	"Nothing in this vault syncs until you choose how to merge it with the server.":
		"Nessuna nota in questo archivio viene sincronizzata finché non scegli come fonderla con il server.",
	"Choose sync direction": "Scegli la direzione della sincronizzazione",
	"...": "...",
	'... "{name}" ...': '... "{name}" ...',
};

export default it;
