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
};

export default fr;
