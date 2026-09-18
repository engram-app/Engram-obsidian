import type { Dict } from "..";

// Français
const fr: Dict = {
	"Code copied!": "Code copié.",
	"Engram sync: syncing...": "Engram Sync : synchronisation …",
	"Engram Sync: pulled {pulled}, pushed {pushed}":
		"Engram Sync : {pulled} récupérés, {pushed} envoyés",
	"Engram: disconnected. Open Engram settings to reconnect.":
		"Engram : déconnecté. Ouvre Engram settings pour te reconnecter.",
	"Engram sync: checking...": "Engram Sync : vérification …",
	"Engram sync: everything in sync": "Engram Sync : tout est synchronisé",
	"Engram sync: pulling all from server...":
		"Engram Sync : récupération de tout depuis le serveur …",
	"Engram Sync: pushed {pushed}": "Engram Sync : {pushed} envoyés",
	"Engram sync: sync failed": "Engram Sync : la synchronisation a échoué",
	"Engram: your login expired — open Engram settings to reconnect.":
		"Engram : ta session a expiré. Ouvre Engram settings pour te reconnecter.",
	"Engram: This vault has been deleted on the server.":
		"Engram : ce coffre a été supprimé sur le serveur.",
	"Engram Sync: pulled {pulled} (local extras deleted)":
		"Engram Sync : {pulled} récupérés (fichiers locaux en trop supprimés)",
	"Engram Sync: pulled {pulled}": "Engram Sync : {pulled} récupérés",
	"Engram Sync: replaced remote with local ({pushed} uploaded)":
		"Engram Sync : serveur remplacé par la version locale ({pushed} envoyés)",
	"Engram: sync failed. Open the sync log for details.":
		"Engram : la synchronisation a échoué. Les détails sont dans le journal de synchronisation.",
	"Engram unreachable. Showing matches from this device only.":
		"Engram injoignable. Seuls les résultats de cet appareil sont affichés.",
	"No source path for this result": "Aucun chemin source pour ce résultat",
	"Note not synced locally": "Cette note n'est pas encore synchronisée localement",
	"Engram: settings tab failed to render ({error})":
		"Engram : l'onglet des paramètres n'a pas pu s'afficher ({error})",
	"File not found locally: {path}": "Fichier introuvable en local : {path}",
	"Restored {path} — will sync on next push.":
		"{path} restauré, il sera synchronisé au prochain envoi.",
	"Ignored {path} — won't sync until restored from Sync Center.":
		"{path} ignoré, il ne sera pas synchronisé avant restauration depuis le Sync Center.",
	"Added {pattern} to ignore patterns": "{pattern} ajouté aux motifs à ignorer",
	"Engram backend changed — sign in again to continue.":
		"Le serveur Engram a changé. Reconnecte-toi pour continuer.",
	"Engram: sign-in failed ({error})": "Engram : la connexion a échoué ({error})",
	"Enter an API key first": "Saisis d'abord une clé d'API",
	"Switched to {mode}.": "Basculé vers {mode}.",

	"Engram Sync: pushed {count} files": {
		one: "Engram Sync : {count} fichier envoyé",
		other: "Engram Sync : {count} fichiers envoyés",
	},
	"Engram Sync: pulled {count} files from server": {
		one: "Engram Sync : {count} fichier récupéré depuis le serveur",
		other: "Engram Sync : {count} fichiers récupérés depuis le serveur",
	},
	"Engram Sync: pulled {count} changes": {
		one: "Engram Sync : {count} modification récupérée",
		other: "Engram Sync : {count} modifications récupérées",
	},
	"Engram: {count} files failed to sync{detail} — open Sync Center": {
		one: "Engram : {count} fichier n'a pas pu être synchronisé{detail}. Ouvre le Sync Center",
		other: "Engram : {count} fichiers n'ont pas pu être synchronisés{detail}. Ouvre le Sync Center",
	},
	"Engram: {count} attachments skipped — upgrade to sync images & PDFs.": {
		one: "Engram : {count} pièce jointe ignorée. Passe à une offre payante pour les images et les PDF.",
		other: "Engram : {count} pièces jointes ignorées. Passe à une offre payante pour les images et les PDF.",
	},
	"Engram: plan upgraded — syncing {count} attachments…": {
		one: "Engram : offre mise à niveau, synchronisation de {count} pièce jointe …",
		other: "Engram : offre mise à niveau, synchronisation de {count} pièces jointes …",
	},
	// 402 limit reasons (limit-copy.ts). These gate payment, so they are the
	// highest-value strings in the plugin to get right.
	"Note limit reached. Upgrade to keep adding notes.":
		"Limite de notes atteinte. Passe à une offre payante pour en ajouter d'autres.",
	"Vault limit reached. Upgrade for more vaults.":
		"Limite de coffres atteinte. Une offre payante en autorise davantage.",
	"This file type isn't accepted by this server.": "Ce serveur n'accepte pas ce type de fichier.",
	"Attachment sync is disabled for this account.":
		"La synchronisation des pièces jointes est désactivée pour ce compte.",
	"Attachment storage is full — upgrade for more.":
		"L'espace de stockage des pièces jointes est plein. Une offre payante en donne plus.",
	"File too large for your plan.": "Fichier trop volumineux pour ton offre.",
	"Already signed in on another device. Upgrade for multi-device.":
		"Tu es déjà connecté sur un autre appareil. Une offre payante autorise plusieurs appareils.",
	"Device swap cooldown active. Wait or upgrade.":
		"Changement d'appareil encore bloqué. Attends un peu ou passe à une offre payante.",
	"Too many connected Obsidian vaults. Disconnect one or upgrade.":
		"Trop de coffres Obsidian connectés. Déconnectes-en un ou passe à une offre payante.",
	"Too many connected AI clients. Disconnect one or upgrade.":
		"Trop de clients IA connectés. Déconnectes-en un ou passe à une offre payante.",
	"Daily AI search limit reached. Free includes 20 per day across Obsidian, the web app and MCP. Upgrade for unlimited.":
		"Limite quotidienne de recherches IA atteinte. L'offre gratuite inclut 20 par jour au total entre Obsidian, l'application web et MCP. Une offre payante lève la limite.",
	"API keys need Pro. Sign in with your Engram account instead.":
		"Les clés d'API demandent l'offre Pro. Connecte-toi plutôt avec ton compte Engram.",
	"Account suspended. Contact support.": "Compte suspendu. Contacte le support.",
	"Account setup incomplete.": "La configuration du compte n'est pas terminée.",
	"This account was deleted. Contact support if that is wrong.":
		"Ce compte a été supprimé. Si c'est une erreur, contacte le support.",
	"Finish setting up your account at app.engram.page to start syncing.":
		"Termine la configuration de ton compte sur app.engram.page pour lancer la synchronisation.",
	"Limit reached. Upgrade to continue.":
		"Limite atteinte. Passe à une offre payante pour continuer.",
};

export default fr;
