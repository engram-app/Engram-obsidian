import type { Dict } from "..";

// Français
const fr: Dict = {
	"Invalid API key": "Clé API invalide",
	"Connection failed": "Connexion échouée",
	"Link Obsidian to Engram": "Associer Obsidian à Engram",
	"Failed to start device flow. Check your Engram URL and try again.":
		"Impossible de démarrer le processus. Vérifie ton URL Engram et réessaie.",
	"Your code:": "Ton code :",
	"Click to copy": "Cliquer pour copier",
	"Code copied!": "Code copié !",
	"A browser window has opened. Sign in and enter this code to link your vault.":
		"Une fenêtre de navigateur s'est ouverte. Connecte-toi et entre ce code pour associer ton coffre.",
	Cancel: "Annuler",
	"Waiting for authorization — connected, this will complete instantly.":
		"En attente d'autorisation — connecté, cela se terminera instantanément.",
	"Waiting for authorization — no live connection, checking every 30s.":
		"En attente d'autorisation — pas de connexion active, vérification toutes les 30 secondes.",
	"Code expired. Please try again.": "Code expiré. Merci de réessayer.",
	"Try again": "Réessayer",
	Close: "Fermer",
	"Note couldn't be processed": "La note n'a pas pu être traitée",
	"The server couldn't process this note. Check its contents, then edit and save to try again.":
		"Le serveur n'a pas pu traiter cette note. Vérifie son contenu, puis modifie et enregistre pour réessayer.",
	"Attachments need a paid plan": "Les pièces jointes nécessitent un abonnement payant",
	"The Free tier syncs notes only. Upgrade to sync images and PDFs.":
		"Le plan gratuit synchronise uniquement les notes. Passe à un abonnement payant pour synchroniser les images et les PDF.",
	"Attachment storage full": "Espace de stockage des pièces jointes saturé",
	"You've used all the attachment storage on your plan. Upgrade for more.":
		"Tu as utilisé tout l'espace de stockage des pièces jointes de ton abonnement. Passe à un abonnement supérieur pour plus d'espace.",
	"Too large for the server": "Trop volumineux pour le serveur",
	"The server limit is 5 MB. Compress or split the file, then it will sync.":
		"La limite du serveur est de 5 Mo. Compresse ou divise le fichier, puis il sera synchronisé.",
	"Sign-in expired": "Session expirée",
	"Reconnect your account to resume syncing.":
		"Reconnecte ton compte pour reprendre la synchronisation.",
	"Unresolved conflict": "Conflit non résolu",
	"Open the file to resolve the conflict, then sync again.":
		"Ouvre le fichier pour résoudre le conflit, puis synchronise à nouveau.",
	"Frontmatter needs a fix": "Le frontmatter nécessite une correction",
	"The note synced, but its frontmatter could not be fully parsed. Open it to fix the highlighted line.":
		"La note a été synchronisée, mais son frontmatter n'a pas pu être entièrement analysé. Ouvre-la pour corriger la ligne surlignée.",
	"Server error": "Erreur serveur",
	"A temporary server problem — retrying automatically.":
		"Un problème temporaire du serveur — nouvelle tentative automatique.",
	"Network unavailable": "Réseau indisponible",
	"Can't reach the server — retrying automatically.":
		"Impossible de contacter le serveur — nouvelle tentative automatique.",
	"Sync failed": "Synchronisation échouée",
	"An unexpected error — retrying automatically.":
		"Une erreur inattendue — nouvelle tentative automatique.",
	"Frontmatter could not be parsed": "Le frontmatter n'a pas pu être analysé",
	"Note limit reached. Upgrade to keep adding notes.":
		"Limite de notes atteinte. Passe à un abonnement supérieur pour ajouter plus de notes.",
	"Vault limit reached. Upgrade for more vaults.":
		"Limite de coffres atteinte. Passe à un abonnement supérieur pour plus de coffres.",
	"This file type isn't accepted by this server.":
		"Ce type de fichier n'est pas accepté par ce serveur.",
	"Attachment sync is disabled for this account.":
		"La synchronisation des pièces jointes est désactivée pour ce compte.",
	"Attachment storage is full — upgrade for more.":
		"L'espace de stockage des pièces jointes est plein — passe à un abonnement supérieur pour plus d'espace.",
	"File too large for your plan.": "Le fichier est trop volumineux pour ton abonnement.",
	"Already signed in on another device. Upgrade for multi-device.":
		"Tu es déjà connecté sur un autre appareil. Passe à un abonnement supérieur pour utiliser plusieurs appareils.",
	"Device swap cooldown active. Wait or upgrade.":
		"Période de refroidissement pour le changement d'appareil active. Attends ou passe à un abonnement supérieur.",
	"Too many connected Obsidian vaults. Disconnect one or upgrade.":
		"Trop de coffres Obsidian connectés. Déconnecte-en un ou passe à un abonnement supérieur.",
	"Too many connected AI clients. Disconnect one or upgrade.":
		"Trop de clients IA connectés. Déconnecte-en un ou passe à un abonnement supérieur.",
	"Daily AI search limit reached. Free includes 20 per day across Obsidian, the web app and MCP. Upgrade for unlimited.":
		"Limite quotidienne de recherche IA atteinte. L'abonnement gratuit inclut 20 recherches par jour sur Obsidian, l'application web et MCP. Passe à un abonnement supérieur pour un nombre illimité.",
	"API keys need Pro. Sign in with your Engram account instead.":
		"Les clés API nécessitent un abonnement Pro. Connecte-toi avec ton compte Engram à la place.",
	"Account suspended. Contact support.": "Compte suspendu. Contacte le support.",
	"Account setup incomplete.": "Configuration du compte incomplète.",
	"This account was deleted. Contact support if that is wrong.":
		"Ce compte a été supprimé. Contacte le support si c'est une erreur.",
	"Finish setting up your account at app.engram.page to start syncing.":
		"Termine la configuration de ton compte sur app.engram.page pour commencer la synchronisation.",
	"Limit reached. Upgrade to continue.":
		"Limite atteinte. Passe à une version supérieure pour continuer.",
	Upgrade: "Mettre à niveau",
	"Update in settings": "Mettre à jour dans les paramètres",
	"Sync now": "Synchroniser maintenant",
	"Engram sync: syncing...": "Synchronisation Engram : synchronisation en cours...",
	"Engram Sync: pulled {pulled}, pushed {pushed}":
		"Engram : téléchargé {pulled}, envoyé {pushed}",
	"Disconnect (clear login)": "Déconnecter (effacer la connexion)",
	"Engram: disconnected. Open Engram settings to reconnect.":
		"Engram : déconnecté. Ouvre les paramètres Engram pour te reconnecter.",
	"Push entire vault": "Envoyer tout le coffre",
	"Engram Sync: pushed {count} files": {
		one: "Engram Sync : {count} fichier synchronisé",
		many: "Engram Sync : {count} fichiers synchronisés",
		other: "Engram Sync : {count} fichiers synchronisés",
	},
	"Check sync status": "Vérifier le statut de la synchronisation",
	"Engram sync: checking...": "Synchronisation Engram : vérification en cours...",
	"Engram sync: server does not support reconciliation (update backend)":
		"Synchronisation Engram : le serveur ne prend pas en charge la réconciliation (mettre à jour le serveur)",
	"Engram sync: everything in sync": "Synchronisation Engram : tout est synchronisé",
	"{count} missing on server": "{count} manquant sur le serveur",
	"{count} diverged": "{count} divergent",
	"{count} only on server": "{count} uniquement sur le serveur",
	"Engram Sync: {details}": "Synchronisation Engram : {details}",
	"Pull all from server (force overwrite)":
		"Télécharger tout depuis le serveur (remplacement forcé)",
	"Engram sync: pulling all from server...":
		"Synchronisation Engram : téléchargement de tout depuis le serveur...",
	"Engram Sync: pulled {count} files from server": {
		one: "Engram Sync : {count} fichier téléchargé depuis le serveur",
		many: "Engram Sync : {count} fichiers récupérés du serveur",
		other: "Engram Sync : {count} fichiers téléchargés depuis le serveur",
	},
	"Show sync log": "Afficher le journal de synchronisation",
	"Semantic search": "Recherche sémantique",
	"Open search sidebar": "Ouvrir la barre latérale de recherche",
	"Engram search": "Recherche Engram",
	"Open sync center": "Ouvrir le Centre de synchronisation",
	"Engram: ready": "Engram : prêt",
	"Engram Sync: pushed {pushed}": "Engram Sync : synchronisation envoyée ({pushed})",
	"Engram sync: sync failed": "Engram : la synchronisation a échoué",
	"Engram: this vault no longer exists on the server. Pick or create a vault to continue.":
		"Engram : ce coffre n'existe plus sur le serveur. Choisis ou crée un coffre pour continuer.",
	"Engram: recovered plugin settings from a backup after a corrupted save.":
		"Engram : les paramètres du plugin ont été restaurés à partir d'une sauvegarde après une corruption.",
	"Engram: plugin settings file was corrupted and could not be recovered. You may need to reconnect in settings.":
		"Engram : le fichier de paramètres du plugin est corrompu et ne peut pas être restauré. Tu devras peut-être te reconnecter dans les paramètres.",
	"Engram: your login expired — open Engram settings to reconnect.":
		"Engram : ton identifiant a expiré — ouvre les paramètres Engram pour te reconnecter.",
	"Engram: This vault has been deleted on the server.":
		"Engram : ce coffre a été supprimé sur le serveur.",
	"Engram sync: live sync requires a plugin update — please update the Engram vault sync plugin.":
		"Engram : la synchronisation en temps réel nécessite une mise à jour du plugin — mets à jour le plugin Engram Vault Sync.",
	"Engram Sync: pulled {pulled} (local extras deleted)":
		"Engram Sync : synchronisation reçue ({pulled}) (fichiers supplémentaires locaux supprimés)",
	"Engram Sync: pulled {pulled}": "Engram Sync : synchronisation reçue ({pulled})",
	"Engram Sync: replaced remote with local ({pushed} uploaded)":
		"Engram Sync : fichier distant remplacé par le fichier local ({pushed} téléchargé)",
	"Engram: sync is not set up yet, so nothing in this vault will sync.":
		"Engram : la synchronisation n'est pas encore configurée, donc rien dans ce coffre ne sera synchronisé.",
	"Finish sync setup": "Terminer la configuration de la synchronisation",
	"Engram: sync is paused. This edit was not synced. Choose a sync direction to resume.":
		"Engram : la synchronisation est interrompue. Cette modification n'a pas été synchronisée. Choisis un sens de synchronisation pour reprendre.",
	"Open Engram settings": "Ouvrir les paramètres Engram",
	"Engram: sync failed. Open the sync log for details.":
		"Engram : la synchronisation a échoué. Ouvre le journal de synchronisation pour plus de détails.",
	"Engram: not connected": "Engram : non connecté",
	"Engram: signed out": "Engram : déconnecté",
	"Not connected yet. Click to open settings and link this vault.":
		"Pas encore connecté. Clique pour ouvrir les paramètres et lier ce coffre.",
	"Not signed in. Click to open settings and reconnect.":
		"Pas connecté. Clique pour ouvrir les paramètres et te reconnecter.",
	"Engram: finish setup": "Engram : terminer la configuration",
	"Engram: sync paused": "Engram : synchronisation interrompue",
	"{label} ({count} queued)": "{label} ({count} en attente)",
	"Setup is not finished — nothing will sync until you choose a sync direction. Click to finish.":
		"La configuration n'est pas terminée — rien ne sera synchronisé tant que tu n'auras pas choisi un sens de synchronisation. Clique pour terminer.",
	"Sync paused — click to choose a sync direction":
		"Synchronisation interrompue — clique pour choisir le sens de la synchronisation",
	"Engram: offline ({count} queued)": "Engram : hors ligne ({count} en attente)",
	"Engram: offline": "Engram : hors ligne",
	"Server unreachable — changes will sync when connected":
		"Serveur inaccessible — les modifications seront synchronisées lorsque la connexion sera rétablie",
	"Engram: error": "Engram : erreur",
	"Unknown error": "Erreur inconnue",
	"Engram: syncing ({count})": "Engram : synchronisation ({count})",
	"Engram: syncing": "Engram : synchronisation",
	"Sync in progress...": "Synchronisation en cours...",
	"Engram: pending ({count})": "Engram : en attente ({count})",
	"{count} files queued": {
		one: "{count} fichier en attente",
		many: "{count} fichiers en attente",
		other: "{count} fichiers en attente",
	},
	"Engram: live": "Engram : actif",
	"WebSocket connected — live sync active":
		"WebSocket connecté — synchronisation en direct active",
	"Click to sync": "Cliquer pour synchroniser",
	"Engram: ⚠ {count} sync errors": {
		one: "Engram : ⚠ {count} erreur de synchronisation",
		many: "Engram : ⚠ {count} erreurs de synchronisation",
		other: "Engram : ⚠ {count} erreurs de synchronisation",
	},
	"Last sync: {when}": "Dernière synchronisation : {when}",
	"Engram Sync: pulled {count} changes": {
		one: "Engram Sync : {count} modification synchronisée",
		many: "Engram Sync : {count} modifications récupérées",
		other: "Engram Sync : {count} modifications synchronisées",
	},
	'Engram Sync: sync state for "{name}" was unreadable — using the on-disk copy.':
		"Engram Sync : l'état de synchronisation de \"{name}\" n'a pas pu être lu — copie utilisée depuis le disque.",
	"Engram Vault Sync {version} is available. {link}.":
		"Engram Vault Sync {version} est disponible. {link}.",
	"{formatted} files · ": {
		one: "{formatted} fichier ·",
		many: "{formatted} fichiers ·",
		other: "{formatted} fichiers ·",
	},
	"Notes searchable": "Notes indexées",
	"Notes past this still sync and open normally, they are just not in the search index. The index keeps your oldest notes, so it is your newest ones that fall outside.":
		"Les notes après celle-ci sont toujours synchronisées et s'ouvrent normalement, mais ne sont pas dans l'index de recherche. L'index conserve tes notes les plus anciennes, donc ce sont les plus récentes qui ne sont pas incluses.",
	"Notes stored": "Notes stockées",
	Attachments: "Pièces jointes",
	"AI searches": "Recherches IA",
	"{formatted} per day": "{formatted} par jour",
	Keyword: "Mot-clé",
	Semantic: "Sémantique",
	Both: "Les deux",
	"matches your words and their other forms — 'run' finds 'running' — plus this device.":
		"correspond à tes mots et à leurs autres formes — 'run' trouve 'running' — plus ce périphérique.",
	"matches meaning. Finds notes that never use the words you typed.":
		"correspond au sens. Trouve les notes qui n'utilisent jamais les mots que tu as tapés.",
	"matches words and meaning together, plus this device. Widest results.":
		"correspond aux mots et au sens ensemble, plus ce périphérique. Résultats les plus larges.",
	"Engram indexes {indexed} of your {all} notes. The rest match on this device only. Upgrade to index everything.":
		"Engram indexe {indexed} de tes {all} notes. Le reste correspond uniquement sur ce périphérique. Passe à une version supérieure pour indexer tout.",
	"Searching {indexed} of {all} notes. Upgrade to search everything.":
		"Recherche dans {indexed} de tes {all} notes. Passe à une version supérieure pour rechercher tout.",
	"Search your vault…": "Recherche dans ton coffre…",
	"Clear search": "Effacer la recherche",
	"Search settings": "Paramètres de recherche",
	"Filter by folder…": "Filtrer par dossier…",
	"Filter by tags…": "Filtrer par balises…",
	"Remove tag {tag}": "Supprimer la balise {tag}",
	"Engram unreachable. Showing matches from this device only.":
		"Engram inaccessible. Affiche les correspondances de ce périphérique uniquement.",
	"Search failed — check connection": "Recherche impossible — vérifie ta connexion",
	"No results found": "Aucun résultat trouvé",
	Untitled: "Sans titre",
	"meaning + exact": "sens + exact",
	"match strength: {pct}%": "force de correspondance : {pct}%",
	"No source path for this result": "Aucun chemin de source pour ce résultat",
	"Note not synced locally": "Note non synchronisée localement",
	"Syncing...": "Synchronisation en cours...",
	"👋 Welcome": "👋 Bienvenue",
	"🔌 Connection": "🔌 Connexion",
	"🔄 Sync Center": "🔄 Centre de synchronisation",
	"⚙️ Advanced": "⚙️ Avancé",
	"Engram: settings tab failed to render ({error})":
		"Engram : l'onglet des paramètres n'a pas pu être affiché ({error})",
	Disconnected: "Déconnecté",
	"Error: {error}": "Erreur : {error}",
	unknown: "inconnu",
	"Connected — waiting for first sync decision":
		"Connecté — en attente de la première décision de synchronisation",
	"Connected — live sync active": "Connecté — synchronisation active",
	"Connected — polling": "Connecté — en cours de vérification",
	"Not configured": "Non configuré",
	"Open sync setup": "Ouvrir la configuration de la synchronisation",
	"waiting for a connection": "en attente de connexion",
	"sync is paused": "la synchronisation est suspendue",
	"syncing now": "synchronisation en cours",
	"waiting to retry": "en attente de reconnexion",
	"{count} not on your plan": "{count} n'est pas inclus dans ton abonnement",
	"{count} need attention": {
		one: "{count} nécessite ton attention",
		many: "{count} nécessite une attention particulière",
		other: "{count} nécessitent ton attention",
	},
	"{count} retrying": "{count} en cours de tentative",
	"{count} ignored": "{count} ignoré",
	"{count} queued — {reason}": "{count} en file d'attente — {reason}",
	"Sync...": "Synchronisation...",
	"sync failed": "La synchronisation a échoué",
	Refresh: "Actualiser",
	"Not synced on your plan ({count})": "Non synchronisé dans ton abonnement ({count})",
	"These files are fine. They just need a paid plan to sync.":
		"Ces fichiers sont corrects. Ils nécessitent un abonnement payant pour être synchronisés.",
	"Show files ({count}) ▾": "Afficher les fichiers ({count}) ▾",
	"Sync these now": "Synchroniser maintenant",
	"Needs attention ({count})": "Nécessite ton attention ({count})",
	"Clear all": "Effacer tout",
	"Nothing needs your attention. 🎉": "Rien ne nécessite ton attention. 🎉",
	Dismiss: "Fermer",
	"Retrying automatically ({count})": "Tentative automatique ({count})",
	"Retry all now": "Retenter tout maintenant",
	"Temporary errors. These clear themselves once the server recovers.":
		"Erreurs temporaires. Elles disparaissent lorsque le serveur se rétablit.",
	"{count} attempts": {
		one: "{count} tentative",
		many: "{count} tentatives",
		other: "{count} tentatives",
	},
	Open: "Ouvrir",
	Ignore: "Ignorer",
	"No files ignored. Use the ignore button on a failure row to stop syncing it.":
		'Aucun fichier ignoré. Utilise le bouton "ignorer" sur une ligne d\'erreur pour arrêter sa synchronisation.',
	Restore: "Restaurer",
	"File not found locally: {path}": "Fichier introuvable localement : {path}",
	"Ignored {path} — won't sync until restored from Sync Center.":
		"Ignoré {path} — ne sera synchronisé qu'après restauration depuis le Centre de synchronisation.",
	"Restored {path} — will sync on next push.":
		"Restauré {path} — sera synchronisé lors du prochain enregistrement.",
	Clear: "Effacer",
	"No activity yet. Push or pull to see entries here.":
		"Aucune activité pour l'instant. Enregistre ou télécharge pour voir les entrées.",
	Stats: "Statistiques",
	"Notes on this device": "Notes sur cet appareil",
	"Attachments on this device": "Pièces jointes sur cet appareil",
	"Remote vault": "Coffre distant",
	"not linked": "non lié",
	"Plan usage": "Utilisation du plan",
	"Sync log": "Journal de synchronisation",
	"Showing {count} entries": {
		one: "Affichage d'{count} entrée",
		many: "Affichage de {count} entrées",
		other: "Affichage de {count} entrées",
	},
	"No sync activity this session.": "Aucune activité de synchronisation pendant cette session.",
	"({count} errors)": {
		one: "({count} erreur)",
		many: "({count} erreurs)",
		other: "({count} erreurs)",
	},
	"Could not compare with the cloud. Check your connection.":
		"Impossible de comparer avec le cloud. Vérifie ta connexion.",
	"Your login expired. Sign in again in Engram settings to continue.":
		"Ton identifiant a expiré. Connecte-toi à nouveau dans les paramètres d'Engram pour continuer.",
	"Couldn't create vault — the name may be invalid or already in use.":
		"Impossible de créer le coffre — le nom est peut-être invalide ou déjà utilisé.",
	"Could not create the vault — check your connection and try again.":
		"Impossible de créer le coffre — vérifie ta connexion et réessaie.",
	"Free syncs notes only — {count} attachments will be skipped.": {
		one: "Synchronisation gratuite des notes uniquement — {count} pièce jointe sera ignorée.",
		many: "Synchronisation gratuite des notes uniquement — {count} pièces jointes seront ignorées.",
		other: "Synchronisation gratuite des notes uniquement — {count} pièces jointes seront ignorées.",
	},
	"Uploads {up}, downloads {down}.": "Téléchargements {up}, téléchargements {down}.",
	"Uploads {count}.": "Téléchargements {count}.",
	"Downloads {count}.": "Téléchargements {count}.",
	"{count} conflicts to resolve.": {
		one: "{count} conflit à résoudre.",
		many: "{count} conflits à résoudre.",
		other: "{count} conflits à résoudre.",
	},
	"Safe choice: combines both sides, nothing is deleted.":
		"Choix sûr : combine les deux, rien n'est supprimé.",
	"Nothing is deleted.": "Rien n'est supprimé.",
	"Already in sync. Nothing is deleted.": "Déjà synchronisé. Rien n'est supprimé.",
	"Delete all {count} files currently on the server": {
		one: "Supprimer tous les {count} fichiers actuellement sur le serveur",
		many: "Supprimer tous les fichiers {count} actuellement sur le serveur",
		other: "Supprimer les {count} fichiers actuellement sur le serveur",
	},
	"Upload {count} files from this vault": {
		one: "Téléverser {count} fichier de ce coffre",
		many: "Télécharge {count} fichiers de ce coffre",
		other: "Télécharge {count} fichiers de ce coffre",
	},
	"Delete all {count} files in this vault": {
		one: "Supprimer tous les {count} fichier dans ce coffre",
		many: "Supprimer tous les fichiers {count} dans ce coffre",
		other: "Supprimer les {count} fichiers de ce coffre",
	},
	"Download {count} files from the server": {
		one: "Télécharger {count} fichier du serveur",
		many: "Télécharge {count} fichiers depuis le serveur",
		other: "Télécharge {count} fichiers du serveur",
	},
	Sync: "Synchroniser",
	"Upload local files without downloading the remote":
		"Télécharge les fichiers locaux sans télécharger les fichiers distants",
	"Delete all on remote, then upload local files":
		"Supprime tout sur le serveur, puis télécharge les fichiers locaux",
	"Download remote files without uploading the local":
		"Télécharge les fichiers distants sans télécharger les fichiers locaux",
	"Delete all local files, then download from remote":
		"Supprimer tous les fichiers locaux, puis télécharger depuis le serveur",
	"Set up sync for this vault": "Configurer la synchronisation pour ce coffre",
	"You are now pointing at a different cloud vault":
		"Tu utilises maintenant un autre coffre en ligne",
	"Sync preview": "Aperçu de la synchronisation",
	"Nothing to sync yet — this vault is empty on both sides. Start syncing and everything you write appears on your other devices.":
		"Rien à synchroniser pour l'instant — ce coffre est vide des deux côtés. Démarre la synchronisation et tout ce que tu écris apparaîtra sur tes autres appareils.",
	"Start syncing": "Démarrer la synchronisation",
	"{count} notes": { one: "{count} note", many: "{count} notes", other: "{count} notes" },
	"{count} attachments": {
		one: "{count} pièce jointe",
		many: "{count} pièces jointes",
		other: "{count} pièces jointes",
	},
	"{first} and {second}": "{first} et {second}",
	files: "fichiers",
	"This vault is empty on the server. Upload your {what}?":
		"Ce coffre est vide sur le serveur. Souhaites-tu télécharger tes {what}?",
	"Upload everything": "Télécharger tout",
	"Nothing will be removed from this device.": "Rien ne sera supprimé de cet appareil.",
	"This device's vault is empty. Download {what} from the server?":
		"Le coffre de cet appareil est vide. Souhaites-tu télécharger {what} depuis le serveur?",
	"Download everything": "Télécharger tout",
	Done: "Terminé",
	"Send debug logs. Note content stays private.":
		"Envoyer les journaux de débogage. Le contenu de tes notes reste privé.",
	"Comparing your vault with the cloud…": "Comparaison de ton coffre avec le cloud…",
	"Not now": "Pas maintenant",
	"Change vault": "Changer de coffre",
	"Advanced sync options": "Options de synchronisation avancées",
	"Everything is in sync": "Tout est synchronisé",
	"This vault": "Ce coffre",
	"Cloud server": "Serveur cloud",
	" conflicts need resolution": {
		one: "conflit à résoudre",
		many: "conflits à résoudre",
		other: "conflits à résoudre",
	},
	notes: "notes",
	attachments: "pièces jointes",
	folders: "dossiers",
	"Confirm destructive sync": "Confirmer la synchronisation destructive",
	"You are about to:": "Tu vas :",
	"Files that will be deleted:": "Fichiers qui seront supprimés :",
	"This cannot be undone.": "Cela ne peut pas être annulé.",
	Back: "Retour",
	Confirm: "Confirmer",
	"Switch vault": "Changer de coffre",
	"Pick a vault to sync with. We will recalculate the sync preview after you choose.":
		"Choisis un coffre à synchroniser. Nous recalculerons l'aperçu de la synchronisation après ton choix.",
	"Loading vaults…": "Chargement des coffres…",
	" (default)": "(par défaut)",
	"No other vaults available.": "Aucun autre coffre disponible.",
	"Make new vault": "Créer un nouveau coffre",
	"New vault": "Nouveau coffre",
	"Create a new empty vault on the server, then sync this Obsidian vault into it.":
		"Crée un nouveau coffre vide sur le serveur, puis synchronise ce coffre Obsidian avec lui.",
	"Vault name": "Nom du coffre",
	Create: "Créer",
	"Could not load vaults": "Impossible de charger les coffres",
	"Enter a name for the new vault": "Entrez un nom pour le nouveau coffre",
	"Failed to switch vault": "Échec du changement de coffre",
	"Your vault shares {percent} of its data with Engram":
		"Ton coffre partage {percent} de ses données avec Engram",
	"Type {keyword} to confirm:": "Tape {keyword} pour confirmer :",
	"Uploading {count}.": "Téléversement de {count}.",
	"Downloading {count}.": "Téléchargement de {count}.",
	"Deleting {count} local files.": {
		one: "Suppression de {count} fichier local.",
		many: "Suppression de {count} Mo de fichiers locaux.",
		other: "Suppression de {count} fichiers locaux.",
	},
	"Deleting {count} on the cloud.": "Suppression de {count} sur le cloud.",
	"First sync, this may take a moment.": "Première synchronisation, cela peut prendre un moment.",
	"Checking for changes.": "Vérification des modifications.",
	"Nothing will be deleted.": "Rien ne sera supprimé.",
	"✓ {count} synced": "✓ {count} synchronisé",
	"⤳ {count} skipped (Free plan)": "⤳ {count} ignoré (plan gratuit)",
	"✕ {count} failed": "✕ {count} échec",
	"{count} attachments need a paid plan to sync. See Sync Center.": {
		one: "{count} pièce jointe nécessite un abonnement payant pour être synchronisée. Consulte le Centre de synchronisation.",
		many: "{count} Les pièces jointes nécessitent un abonnement payant pour la synchronisation. Consulte le Centre de synchronisation.",
		other: "{count} pièces jointes nécessitent un abonnement payant pour la synchronisation. Consulte le Centre de synchronisation.",
	},
	"Finished with some errors. Open the sync log to see what failed.":
		"Terminé avec quelques erreurs. Ouvre le journal de synchronisation pour voir ce qui a échoué.",
	"Synced. Some attachments need a paid plan to sync (see below).":
		"Synchronisé. Certaines pièces jointes nécessitent un abonnement payant pour la synchronisation (voir ci-dessous).",
	"All synced. Your vault and the cloud now match.":
		"Tout est synchronisé. Ton coffre et le cloud sont maintenant identiques.",
	"Already up to date. Nothing needed syncing.": "Déjà à jour. Rien à synchroniser.",
	Deleting: "Suppression",
	Downloading: "Téléchargement",
	Uploading: "Téléchargement",
	"Syncing your vault": "Synchronisation de ton coffre",
	"Getting started…": "Démarrage…",
	"Open Engram to check your vault and confirm everything synced.":
		"Ouvre Engram pour vérifier ton coffre et confirmer que tout s'est synchronisé.",
	"Open Engram": "Ouvrir Engram",
	"You can close this and the sync keeps running in the background.":
		"Tu peux fermer ceci et la synchronisation continue en arrière-plan.",
	"Run in background": "Exécuter en arrière-plan",
	"Syncing…": "Synchronisation…",
	"Sync complete": "Synchronisation terminée",
	"Syncing attachments": "Synchronisation des pièces jointes",
	Complete: "Terminé",
	'{count} failed. Run "{command}" for details.':
		'{count} a échoué. Exécute "{command}" pour plus de détails.',
	"Free syncs notes only — images & PDFs need a paid plan.":
		"Synchronisation gratuite pour les notes uniquement — les images et les PDF nécessitent un abonnement payant.",
	"Engram: {count} files failed to sync{detail} — open Sync Center": {
		one: "Engram : {count} fichier n'a pas pu être synchronisé{detail} — ouvre le Centre de synchronisation",
		many: "Engram : {count} fichiers n'ont pas pu être synchronisés{detail} — ouvre le Centre de synchronisation",
		other: "Engram : {count} fichiers n'ont pas pu être synchronisés{detail} — ouvre le Centre de synchronisation",
	},
	"Engram: {count} attachments skipped — upgrade to sync images & PDFs.": {
		one: "Engram : {count} pièce jointe ignorée — passe à une version supérieure pour synchroniser les images et les PDF.",
		many: "Engram : {count} pièces jointes ignorées — passe à une version supérieure pour synchroniser les images et les PDF.",
		other: "Engram : {count} pièces jointes ignorées — passe à une version supérieure pour synchroniser les images et les PDF.",
	},
	"Engram: plan upgraded — syncing {count} attachments…": {
		one: "Engram : plan amélioré — synchronisation de {count} pièce jointe…",
		many: "Engram : plan amélioré — synchronisation de {count} pièces jointes…",
		other: "Engram : plan amélioré — synchronisation de {count} pièces jointes…",
	},
	"Pull all (delete extras) aborted: could not obtain an exclusive server snapshot (replay contention). Nothing was trashed.":
		"Synchronisation complète (supprime les doublons) annulée : impossible d'obtenir une copie exclusive du serveur (conflit de réexécution). Rien n'a été supprimé.",
	"Pull all aborted: another sync is running (replay contention). Try again when it finishes.":
		"Synchronisation complète annulée : une autre synchronisation est en cours (conflit de réexécution). Réessaie lorsque celle-ci sera terminée.",
	"Pull all failed: {error}": "Synchronisation complète échouée : {error}",
	"Pull all failed": "Synchronisation complète échouée",
	"Engram: sync conflict on {path} — your local edit was saved as {copy}":
		"Engram : conflit de synchronisation sur {path} — ta modification locale a été enregistrée sous le nom {copy}",
	"Open note": "Ouvrir la note",
	"Engram: {count} notes have frontmatter problems. Open Sync Center to fix.":
		"Engram : {count} notes ont des problèmes avec le frontmatter. Ouvre le Centre de synchronisation pour les corriger.",
	'Engram Sync: renamed "{name}" (unsupported characters)':
		'Engram Sync : renommé "{name}" (caractères non pris en charge)',
	'Engram: frontmatter problem in "{name}"': 'Engram : problème de frontmatter dans "{name}"',
	"Engram: this plugin is too old to sync (needs {version} or newer). Update it to continue.":
		"Engram : ce plugin est trop ancien pour synchroniser (nécessite {version} ou une version ultérieure). Mets-le à jour pour continuer.",
	"Engram: this plugin is too old to sync. Update it to continue.":
		"Engram : ce plugin est trop ancien pour synchroniser. Mets-le à jour pour continuer.",
	Update: "Mettre à jour",
	"New here? Watch the setup video": "Nouveau ici ? Regarde la vidéo d'installation",
	"What Engram does, and how to connect your vault, start to finish.":
		"Ce qu'Engram fait, et comment connecter ton coffre, du début à la fin.",
	"▶ Watch on YouTube": "▶ Regarder sur YouTube",
	"Getting set up": "Installation",
	"1. Make an account": "1. Crée un compte",
	"Create a hosted account at ": "Crée un compte hébergé sur",
	", or self-host the backend (": ", ou héberge toi-même le serveur (",
	"setup guide": "guide d'installation",
	"2. Connect your vault to Engram": "2. Connecte ton coffre à Engram",
	"Sign in (or enter your server URL and key) on the connection tab, then run your first sync.":
		"Connecte-toi (ou entre l'URL de ton serveur et ta clé) dans l'onglet de connexion, puis lance ta première synchronisation.",
	"Open connection tab": "Ouvrir l'onglet de connexion",
	"3. Connect your AI": "3. Connecte ton IA",
	"Link Claude, Cursor, ChatGPT, or any MCP app so it can read and write your notes. ":
		"Lie Claude, Cursor, ChatGPT ou n'importe quelle application MCP pour qu'elle puisse lire et écrire tes notes",
	"See the AI setup guide": "Consulte le guide de configuration de l'IA",
	Plans: "Abonnements",
	Free: "Gratuit",
	"1 vault, 2 devices": "1 coffre, 2 appareils",
	"Real-time sync": "Synchronisation en temps réel",
	"2,000 notes searchable": "2 000 notes consultables",
	"Connect any AI (MCP)": "Connecte n'importe quelle IA (MCP)",
	Starter: "Essentiel",
	"10 vaults, unlimited devices": "10 coffres, nombre illimité d'appareils",
	"Search all your notes": "Recherche dans toutes tes notes",
	"10 GB attachments": "10 Go de pièces jointes",
	"Unlimited AI searches": "Recherches IA illimitées",
	Pro: "Version Pro",
	"Unlimited vaults": "Coffres illimités",
	"Search across all vaults at once": "Recherche dans tous les coffres",
	"50 GB attachments": "50 Go de pièces jointes",
	"API access": "Accès à l'API",
	"See full pricing": "Voir les tarifs complets",
	"Learn more": "En savoir plus",
	Documentation: "Documentation",
	"AI / MCP setup guide": "Guide de configuration IA / MCP",
	"Report an issue": "Signaler un problème",
	"Join our Discord": "Rejoins notre serveur Discord",
	"Node.js dependencies": "Dépendances Node.js",
	"Python virtual environment": "Environnement virtuel Python",
	"Python bytecode cache": "Cache de bytecode Python",
	"Vendored dependencies": "Dépendances intégrées",
	"Gradle build cache": "Cache de build Gradle",
	"Rust/Java build output": "Sortie de build Rust/Java",
	"Build output": "Sortie de build",
	"Next.js build output": "Sortie de build Next.js",
	"Distribution build output": "Sortie de build de distribution",
	"Cargo cache": "Cache Cargo",
	"CocoaPods dependencies": "Dépendances CocoaPods",
	"Dart tool cache": "Cache des outils Dart",
	"Generic cache directory": "Répertoire de cache générique",
	"Ignore patterns": "Motifs à ignorer",
	"Custom patterns": "Motifs personnalisés",
	"Paths to skip (one per line). Folder patterns end with /. Built-in: {configDir}/, .trash/, .git/":
		"Chemins à ignorer (un par ligne). Les motifs de dossiers se terminent par /. Intégrés : {configDir}/, .trash/, .git/",
	Diagnostics: "Diagnostics",
	"Send detailed sync, vault, and connection activity to the server for troubleshooting, with distributed tracing on requests. Metadata only, never note content. Leave off for normal use.":
		"Envoie des informations détaillées sur la synchronisation, le coffre et la connexion au serveur pour le dépannage, avec traçage distribué des requêtes. Métadonnées uniquement, jamais le contenu des notes. Désactive pour une utilisation normale.",
	"Diagnostics detail": "Détails des diagnostics",
	"Minimum severity that ships while diagnostics are on. Higher levels send fewer lines. Default: Info.":
		"Niveau de gravité minimum envoyé lorsque les diagnostics sont activés. Les niveaux supérieurs envoient moins de lignes. Par défaut : Info.",
	"Errors only": "Erreurs uniquement",
	"Warnings and errors": "Avertissements et erreurs",
	"Info (default)": "Info (par défaut)",
	"Debug (verbose)": "Débogage (détaillé)",
	About: "À propos",
	"License: {name}": "Licence : {name}",
	"⚠ Detected: {label}/ ({formatted} files)": "⚠ Détecté : {label} / ({formatted} fichiers)",
	"{desc} — should not be synced": "{desc} — ne doit pas être synchronisé",
	"Add to ignores": "Ajouter aux ignorés",
	"Added {pattern} to ignore patterns": "Ajouté {pattern} aux motifs à ignorer",
	"Version: {version}": "Version : {version}",
	"Source: {link}": "Source : {link}",
	"Engram URL": "URL Engram",
	"✓ Engram server reachable (v{version})": "✓ Serveur Engram accessible (v{version})",
	"✗ server responded but isn't an Engram backend":
		"✗ Le serveur a répondu, mais ce n'est pas un serveur Engram",
	"✗ couldn't reach a server at this URL": "✗ Impossible de contacter un serveur à cette URL",
	"Checking server…": "Vérification du serveur…",
	"That does not look like a complete server address. Include the scheme, for example http://127.0.0.1:4000":
		"Ce n'est pas l'adresse complète du serveur. Inclue le protocole, par exemple http://127.0.0.1:4000",
	"Engram backend changed — sign in again to continue.":
		"Le serveur Engram a changé — reconnecte-toi pour continuer.",
	Authentication: "Authentification",
	"Signed in as {email}": "Connecté en tant que {email}",
	"Authenticated via Engram account (OAuth).": "Authentifié via ton compte Engram (OAuth).",
	"Manage account": "Gérer le compte",
	"Sign out": "Déconnexion",
	"Using API key": "Utilisation d'une clé API",
	"Authenticated via manual API key.": "Authentifié via une clé API manuelle.",
	"Clear key": "Effacer la clé",
	"Switch to sign in": "Passer à la connexion",
	"Engram: sign-in failed ({error})": "Engram : échec de la connexion ({error})",
	"Sign in or create an account": "Connecte-toi ou crée un compte",
	"Opens your browser to sign in, or create an account if you don't have one yet, then links this vault.":
		"Ouvre ton navigateur pour te connecter, ou créer un compte si tu n'en as pas, puis associe ce coffre.",
	"Sign in": "Connecte-toi",
	"Or authenticate with a token instead of signing in. Engram Cloud API keys require the Pro plan; on Free and Starter, sign in above.":
		"Ou authentifie-toi avec un token au lieu de te connecter. Les clés API Engram Cloud nécessitent l'abonnement Pro ; sur les plans Free et Starter, connecte-toi ci-dessus.",
	"Or authenticate with a token instead of signing in.":
		"Ou authentifie-toi avec un token au lieu de te connecter.",
	"API key": "Clé API",
	Token: "Jeton",
	"Bearer token from your Engram account.": "Token d'accès de ton compte Engram.",
	Save: "Sauvegarder",
	"Enter an API key first": "Entre une clé API d'abord",
	"That does not look like an Engram API key (expected {prefix}…).":
		"Cela ne ressemble pas à une clé API Engram (attendu {prefix}…).",
	Vault: "Coffre",
	"Vault selection": "Sélection du coffre",
	"Select which vault this plugin syncs with.": "Choisis le coffre que ce plugin synchronise.",
	"No vaults found — first sync will create one":
		"Aucun coffre trouvé — la première synchronisation en créera un",
	"Pick a vault (previous: '{name}' not found)":
		"Choisis un coffre (précédent : '{name}' introuvable)",
	"Pick a vault (previous: id {id} not found)":
		"Choisis un coffre (précédent : id {id} introuvable)",
	"Pick a vault": "Choisis un coffre",
	Change: "Modifier",
	"Support development": "Soutenir le développement",
	"If this plugin saves you time, consider supporting development.":
		"Si ce plugin te fait gagner du temps, soutiens le développement.",
	"GitHub Sponsors": "GitHub Sponsors",
	"Sign-in required to load vaults": "Connexion requise pour charger les coffres",
	"Server error ({status}) — check Engram logs":
		"Erreur serveur ({status}) — consulte les journaux d'Engram",
	"Request failed ({status})": "La requête a échoué ({status})",
	"Could not reach Engram — check connection":
		"Impossible de contacter Engram — vérifie ta connexion",
	"Engram Cloud": "Serveur Engram",
	"Self-hosted": "Auto-hébergé",
	Backend: "Serveur",
	"Where this vault syncs to. Each backend keeps its own sign-in.":
		"L'emplacement de la synchronisation de ce coffre. Chaque serveur possède sa propre connexion.",
	"Switched to {mode}.": "Passé à {mode}.",
	"Not connected. Enter your Engram server URL below to start syncing.":
		"Non connecté. Entre l'URL de ton serveur Engram ci-dessous pour commencer la synchronisation.",
	"Run your own Engram server": "Exécute ton propre serveur Engram",
	"Engram is the backend that powers sync and semantic search.":
		"Engram est le serveur qui gère la synchronisation et la recherche sémantique.",
	"Nothing in this vault syncs until you choose how to merge it with the server.":
		"Rien dans ce coffre n'est synchronisé tant que tu n'as pas choisi comment le fusionner avec le serveur.",
	"Choose sync direction": "Choisis le sens de la synchronisation",
	"...": "...",
	'... "{name}" ...': '... "{name}" ...',
};

export default fr;
