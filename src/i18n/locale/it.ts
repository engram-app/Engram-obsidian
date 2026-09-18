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
};

export default it;
