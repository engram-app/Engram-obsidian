import type { Dict } from "..";

// Français
const fr: Dict = {
	" (default)": " (par défaut)",
	"(top level)": "(niveau supérieur)",
	"({count} errors)": {
		one: "({count} erreur)",
		many: "({count} erreurs)",
		other: "({count} erreurs)",
	},
	"...": "...",
	'... "{name}" ...': '... "{name}" ...',
	"1 vault, 2 devices": "1 coffre, 2 appareils",
	"1. Make an account": "1. Crée un compte",
	"10 GB attachments": "10 Go de pièces jointes",
	"10 vaults, unlimited devices": "10 coffres, nombre illimité d'appareils",
	"2. Connect your vault to Engram": "2. Connecte ton coffre à Engram",
	"3,000 notes, all searchable": "3 000 notes, toutes consultables",
	"3. Connect your AI": "3. Connecte ton IA",
	"50 GB attachments": "50 Go de pièces jointes",
	"A browser window has opened. Sign in and enter this code to link your vault.":
		"Une fenêtre de navigateur s'est ouverte. Connecte-toi et entre ce code pour associer ton coffre.",
	"A frontmatter key could not be parsed as YAML.":
		"Une clé du frontmatter n'a pas pu être interprétée comme du YAML.",
	"A temporary server problem — retrying automatically.":
		"Un problème temporaire du serveur — nouvelle tentative automatique.",
	"AI / MCP setup guide": "Guide de configuration IA / MCP",
	"AI searches": "Recherches IA",
	"API access": "Accès à l'API",
	"API key": "Clé API",
	"API keys need a Pro plan. Sign in with your Engram account instead.":
		"Les clés API nécessitent un abonnement Pro. Connecte-toi avec ton compte Engram à la place.",
	About: "À propos",
	"Accept it to keep syncing.": "Accepte-la pour continuer la synchronisation.",
	"Access token": "Jeton d'accès",
	"Account setup incomplete.": "Configuration du compte incomplète.",
	"Account suspended. Contact support.": "Compte suspendu. Contacte le support.",
	"Activity ({count})": "Activité ({count})",
	"Add to ignores": "Ajouter aux ignorés",
	"Added {pattern} to ignore patterns": "Ajouté {pattern} aux motifs à ignorer",
	"Advanced sync options": "Options de synchronisation avancées",
	"All synced. Your vault and the cloud now match.":
		"Tout est synchronisé. Ton coffre et le cloud sont maintenant identiques.",
	"Already in sync. Nothing is deleted.": "Déjà synchronisé. Rien n'est supprimé.",
	"Already signed in on another device. Upgrade for multi-device.":
		"Tu es déjà connecté sur un autre appareil. Passe à un abonnement supérieur pour utiliser plusieurs appareils.",
	"Already up to date. Nothing needed syncing.": "Déjà à jour. Rien à synchroniser.",
	"An unexpected error — retrying automatically.":
		"Une erreur inattendue — nouvelle tentative automatique.",
	"Attachment storage full": "Espace de stockage des pièces jointes saturé",
	"Attachment storage is full — upgrade for more.":
		"L'espace de stockage des pièces jointes est plein — passe à un abonnement supérieur pour plus d'espace.",
	"Attachment sync is disabled for this account.":
		"La synchronisation des pièces jointes est désactivée pour ce compte.",
	Attachments: "Pièces jointes",
	"Attachments need a paid plan": "Les pièces jointes nécessitent un abonnement payant",
	"Attachments on this device": "Pièces jointes sur cet appareil",
	"Authenticated via Engram account (OAuth).": "Authentifié via ton compte Engram (OAuth).",
	"Authenticated via manual API key.": "Authentifié via une clé API manuelle.",
	Authentication: "Authentification",
	Back: "Retour",
	"Bearer token from your Engram account.": "Token d'accès de ton compte Engram.",
	Both: "Les deux",
	Bug: "Bogue",
	"Build output": "Sortie de build",
	"Can't reach the server — retrying automatically.":
		"Impossible de contacter le serveur — nouvelle tentative automatique.",
	Cancel: "Annuler",
	"Cargo cache": "Cache Cargo",
	Change: "Modifier",
	"Change vault": "Changer de coffre",
	"Check sync status": "Vérifier le statut de la synchronisation",
	"Checking for changes.": "Vérification des modifications.",
	"Checking server…": "Vérification du serveur…",
	"Choose sync direction": "Choisis le sens de la synchronisation",
	Clear: "Effacer",
	"Clear all": "Effacer tout",
	"Clear key": "Effacer la clé",
	"Clear search": "Effacer la recherche",
	"Click to copy": "Cliquer pour copier",
	"Click to sync": "Cliquer pour synchroniser",
	Close: "Fermer",
	"Cloud server": "Serveur cloud",
	"CocoaPods dependencies": "Dépendances CocoaPods",
	"Code copied!": "Code copié !",
	"Code expired. Please try again.": "Code expiré. Merci de réessayer.",
	"Comparing your vault with the cloud…": "Comparaison de ton coffre avec le cloud…",
	Complete: "Terminé",
	Confirm: "Confirmer",
	"Confirm destructive sync": "Confirmer la synchronisation destructive",
	Conflict: "Conflit",
	Confusing: "Confus",
	"Connect any AI (MCP)": "Connecte n'importe quelle IA (MCP)",
	"Connect to Engram first to send feedback.": "Connecte-toi à Engram pour envoyer un retour.",
	"Connected — live sync active": "Connecté — synchronisation active",
	"Connected — polling": "Connecté — en cours de vérification",
	"Connected — waiting for first sync decision":
		"Connecté — en attente de la première décision de synchronisation",
	"Connection failed": "Connexion échouée",
	Continue: "Continuer",
	"Could not compare with the cloud. Check your connection.":
		"Impossible de comparer avec le cloud. Vérifie ta connexion.",
	"Could not create the vault — check your connection and try again.":
		"Impossible de créer le coffre — vérifie ta connexion et réessaie.",
	"Could not load vaults: {error}": "Impossible de charger les coffres : {error}",
	"Could not reach Engram — check connection":
		"Impossible de contacter Engram — vérifie ta connexion",
	"Could not save your folder choice. Try again.":
		"Impossible de sauvegarder ton choix de dossier. Réessaie.",
	"Couldn't create vault — the name may be invalid or already in use.":
		"Impossible de créer le coffre — le nom est peut-être invalide ou déjà utilisé.",
	"Couldn't send your feedback, please try again.":
		"Impossible d'envoyer ton feedback, essaie à nouveau.",
	Create: "Créer",
	"Create a hosted account at {signup}, or self-host the server ({guide}).":
		"Crée un compte chez {signup}, ou héberge le serveur toi-même ({guide}).",
	"Create a new empty vault on the server, then sync this Obsidian vault into it.":
		"Crée un nouveau coffre vide sur le serveur, puis synchronise ce coffre Obsidian avec lui.",
	"Custom patterns": "Motifs personnalisés",
	"Daily AI search limit reached. Free includes 20 per day across Obsidian, the web app and MCP. Upgrade for unlimited.":
		"Limite quotidienne de recherche IA atteinte. L'abonnement gratuit inclut 20 recherches par jour sur Obsidian, l'application web et MCP. Passe à un abonnement supérieur pour un nombre illimité.",
	"Dart tool cache": "Cache des outils Dart",
	"Debug (verbose)": "Débogage (détaillé)",
	"Delete all local files, then download from remote":
		"Supprimer tous les fichiers locaux, puis télécharger depuis le serveur",
	"Delete all on remote, then upload local files":
		"Supprime tout sur le serveur, puis télécharge les fichiers locaux",
	"Delete all {count} files currently on the server": {
		one: "Supprimer tous les {count} fichiers actuellement sur le serveur",
		many: "Supprimer tous les fichiers {count} actuellement sur le serveur",
		other: "Supprimer les {count} fichiers actuellement sur le serveur",
	},
	"Delete all {count} files in this vault": {
		one: "Supprimer tous les {count} fichier dans ce coffre",
		many: "Supprimer tous les fichiers {count} dans ce coffre",
		other: "Supprimer les {count} fichiers de ce coffre",
	},
	Deleted: "Supprimé",
	Deleting: "Suppression",
	"Deleting {count} local files.": {
		one: "Suppression de {count} fichier local.",
		many: "Suppression de {count} Mo de fichiers locaux.",
		other: "Suppression de {count} fichiers locaux.",
	},
	"Deleting {count} on the cloud.": {
		one: "Suppression de {count} sur le cloud.",
		many: "Suppression de la version {count} sur le cloud.",
		other: "Suppression de {count} éléments dans le cloud.",
	},
	"Device swap cooldown active. Wait or upgrade.":
		"Période de refroidissement pour le changement d'appareil active. Attends ou passe à un abonnement supérieur.",
	Diagnostics: "Diagnostics",
	"Diagnostics detail": "Détails des diagnostics",
	"Disconnect (clear login)": "Déconnecter (effacer la connexion)",
	Disconnected: "Déconnecté",
	Dismiss: "Fermer",
	"Distribution build output": "Sortie de build de distribution",
	Documentation: "Documentation",
	Done: "Terminé",
	"Download everything": "Télécharger tout",
	"Download remote files without uploading the local":
		"Télécharge les fichiers distants sans télécharger les fichiers locaux",
	"Download {count} files from the server": {
		one: "Télécharger {count} fichier du serveur",
		many: "Télécharge {count} fichiers depuis le serveur",
		other: "Télécharge {count} fichiers du serveur",
	},
	Downloading: "Téléchargement",
	"Downloading {count}.": {
		one: "Téléchargement {count}.",
		many: "Téléchargement {count}.",
		other: "Téléchargement {count}.",
	},
	"Engram Cloud": "Serveur Engram",
	"Engram Sync: pulled {count} changes": {
		one: "Engram Sync : {count} modification synchronisée",
		many: "Engram Sync : {count} modifications récupérées",
		other: "Engram Sync : {count} modifications synchronisées",
	},
	"Engram Sync: pulled {count} files from server": {
		one: "Engram Sync : {count} fichier téléchargé depuis le serveur",
		many: "Engram Sync : {count} fichiers récupérés du serveur",
		other: "Engram Sync : {count} fichiers téléchargés depuis le serveur",
	},
	"Engram Sync: pulled {pulled}": "Engram Sync : synchronisation reçue ({pulled})",
	"Engram Sync: pulled {pulled} (local extras deleted)":
		"Engram Sync : synchronisation reçue ({pulled}) (fichiers supplémentaires locaux supprimés)",
	"Engram Sync: pulled {pulled}, pushed {pushed}":
		"Engram : téléchargé {pulled}, envoyé {pushed}",
	"Engram Sync: pushed {count} files": {
		one: "Engram Sync : {count} fichier synchronisé",
		many: "Engram Sync : {count} fichiers synchronisés",
		other: "Engram Sync : {count} fichiers synchronisés",
	},
	"Engram Sync: pushed {pushed}": "Engram Sync : synchronisation envoyée ({pushed})",
	'Engram Sync: renamed "{name}" (unsupported characters)':
		'Engram Sync : renommé "{name}" (caractères non pris en charge)',
	"Engram Sync: replaced remote with local ({pushed} uploaded)":
		"Engram Sync : fichier distant remplacé par le fichier local ({pushed} téléchargé)",
	'Engram Sync: sync state for "{name}" was unreadable — using the on-disk copy.':
		"Engram Sync : l'état de synchronisation de \"{name}\" n'a pas pu être lu — copie utilisée depuis le disque.",
	"Engram Sync: {details}": "Synchronisation Engram : {details}",
	"Engram URL": "URL Engram",
	"Engram Vault Sync {version} is available. {link}.":
		"Engram Vault Sync {version} est disponible. {link}.",
	"Engram indexes {indexed} of your {all} notes. The rest match on this device only. Upgrade to index everything.":
		"Engram indexe {indexed} de tes {all} notes. Le reste correspond uniquement sur ce périphérique. Passe à une version supérieure pour indexer tout.",
	"Engram is the backend that powers sync and semantic search.":
		"Engram est le serveur qui gère la synchronisation et la recherche sémantique.",
	"Engram search": "Recherche Engram",
	"Engram server changed — sign in again to continue.":
		"Le serveur Engram a changé — reconnecte-toi pour continuer.",
	"Engram sync: checking...": "Synchronisation Engram : vérification en cours...",
	"Engram sync: everything in sync": "Synchronisation Engram : tout est synchronisé",
	"Engram sync: live sync requires a plugin update — please update the Engram vault sync plugin.":
		"Engram : la synchronisation en temps réel nécessite une mise à jour du plugin — mets à jour le plugin Engram Vault Sync.",
	"Engram sync: pulling all from server...":
		"Synchronisation Engram : téléchargement de tout depuis le serveur...",
	"Engram sync: server does not support reconciliation (update backend)":
		"Synchronisation Engram : le serveur ne prend pas en charge la réconciliation (mettre à jour le serveur)",
	"Engram sync: sync failed": "Engram : la synchronisation a échoué",
	"Engram sync: syncing...": "Synchronisation Engram : synchronisation en cours...",
	"Engram unreachable. Showing matches from this device only.":
		"Engram inaccessible. Affiche les correspondances de ce périphérique uniquement.",
	"Engram's {document} update, effective {date}.":
		"Mise à jour de Engram pour {document}, entrée en vigueur le {date}.",
	"Engram: This vault has been deleted on the server.":
		"Engram : ce coffre a été supprimé sur le serveur.",
	"Engram: disconnected. Open Engram settings to reconnect.":
		"Engram : déconnecté. Ouvre les paramètres Engram pour te reconnecter.",
	"Engram: error": "Engram : erreur",
	"Engram: finish setup": "Engram : terminer la configuration",
	'Engram: frontmatter problem in "{name}"': 'Engram : problème de frontmatter dans "{name}"',
	"Engram: live": "Engram : actif",
	"Engram: not connected": "Engram : non connecté",
	"Engram: offline": "Engram : hors ligne",
	"Engram: offline ({count} queued)": {
		one: "Engram : hors ligne ({count} en attente)",
		many: "Engram: hors ligne ({count} en attente)",
		other: "Engram: hors ligne ({count} en attente)",
	},
	"Engram: pending ({count})": "Engram : en attente ({count})",
	"Engram: plan upgraded — syncing {count} attachments…": {
		one: "Engram : plan amélioré — synchronisation de {count} pièce jointe…",
		many: "Engram : plan amélioré — synchronisation de {count} pièces jointes…",
		other: "Engram : plan amélioré — synchronisation de {count} pièces jointes…",
	},
	"Engram: plugin settings file was corrupted and could not be recovered. You may need to reconnect in settings.":
		"Engram : le fichier de paramètres du plugin est corrompu et ne peut pas être restauré. Tu devras peut-être te reconnecter dans les paramètres.",
	"Engram: ready": "Engram : prêt",
	"Engram: recovered plugin settings from a backup after a corrupted save.":
		"Engram: paramètres du plugin restaurés à partir d'une sauvegarde après une sauvegarde corrompue.",
	"Engram: settings tab failed to render ({error})":
		"Engram : l'onglet des paramètres n'a pas pu être affiché ({error})",
	"Engram: sign-in failed ({error})": "Engram : échec de la connexion ({error})",
	"Engram: signed out": "Engram : déconnecté",
	"Engram: sync conflict on {path} — your local edit was saved as {copy}":
		"Engram : conflit de synchronisation sur {path} — ta modification locale a été enregistrée sous le nom {copy}",
	"Engram: sync failed. Open the sync log for details.":
		"Engram : la synchronisation a échoué. Ouvre le journal de synchronisation pour plus de détails.",
	"Engram: sync is not set up yet, so nothing in this vault will sync.":
		"Engram : la synchronisation n'est pas encore configurée, donc rien dans ce coffre ne sera synchronisé.",
	"Engram: sync is paused. This edit was not synced. Choose a sync direction to resume.":
		"Engram : la synchronisation est interrompue. Cette modification n'a pas été synchronisée. Choisis un sens de synchronisation pour reprendre.",
	"Engram: sync paused": "Engram : synchronisation interrompue",
	"Engram: syncing": "Engram : synchronisation",
	"Engram: syncing ({count})": "Engram : synchronisation ({count})",
	"Engram: this plugin is too old to sync (needs {version} or newer). Update it to continue.":
		"Engram : ce plugin est trop ancien pour synchroniser (nécessite {version} ou une version ultérieure). Mets-le à jour pour continuer.",
	"Engram: this plugin is too old to sync. Update it to continue.":
		"Engram : ce plugin est trop ancien pour synchroniser. Mets-le à jour pour continuer.",
	"Engram: this vault no longer exists on the server. Pick or create a vault to continue.":
		"Engram : ce coffre n'existe plus sur le serveur. Choisis ou crée un coffre pour continuer.",
	"Engram: your login expired — open Engram settings to reconnect.":
		"Engram : ton identifiant a expiré — ouvre les paramètres Engram pour te reconnecter.",
	"Engram: {count} attachments skipped — upgrade your plan to sync images & PDFs.": {
		one: "Engram: {count} pièce jointe ignorée — améliore ton abonnement pour synchroniser les images et les PDF.",
		many: "Engram: {count} pièces jointes ignorées — améliore ton abonnement pour synchroniser les images et les PDF.",
		other: "Engram: {count} pièces jointes ignorées — améliore ton abonnement pour synchroniser les images et les PDF.",
	},
	"Engram: {count} files failed to sync{detail} — open Sync Center": {
		one: "Engram : {count} fichier n'a pas pu être synchronisé{detail} — ouvre le Centre de synchronisation",
		many: "Engram : {count} fichiers n'ont pas pu être synchronisés{detail} — ouvre le Centre de synchronisation",
		other: "Engram : {count} fichiers n'ont pas pu être synchronisés{detail} — ouvre le Centre de synchronisation",
	},
	"Engram: {count} notes have frontmatter problems. Open Sync Center to fix.": {
		one: "Engram: {count} note a des problèmes de frontmatter. Ouvre le Centre de synchronisation pour les corriger.",
		many: "Engram: {count} notes ont des problèmes de métadonnées. Ouvre le Centre de synchronisation pour les corriger.",
		other: "Engram: {count} notes ont des problèmes de frontmatter. Ouvre le Centre de synchronisation pour les corriger.",
	},
	"Engram: ⚠ {count} sync errors": {
		one: "Engram : ⚠ {count} erreur de synchronisation",
		many: "Engram : ⚠ {count} erreurs de synchronisation",
		other: "Engram : ⚠ {count} erreurs de synchronisation",
	},
	"Enter a name for the new vault": "Entrez un nom pour le nouveau coffre",
	"Enter an API key first": "Entre une clé API d'abord",
	Error: "Erreur",
	"Error: {error}": "Erreur : {error}",
	"Errors only": "Erreurs uniquement",
	"Everything is in sync": "Tout est synchronisé",
	"Failed to start device flow. Check your Engram URL and try again.":
		"Impossible de démarrer le processus. Vérifie ton URL Engram et réessaie.",
	"Failed to switch vault: {error}": "Échec du changement de coffre : {error}",
	"File exceeds the {limit} limit": "Le fichier dépasse la limite de {limit}",
	"File not found locally: {path}": "Fichier introuvable localement : {path}",
	"File too large for your plan.": "Le fichier est trop volumineux pour ton abonnement.",
	"Files that will be deleted:": "Fichiers qui seront supprimés :",
	"Filter by folder…": "Filtrer par dossier…",
	"Filter by tags…": "Filtrer par balises…",
	"Finish setting up your account at app.engram.page to start syncing.":
		"Termine la configuration de ton compte sur app.engram.page pour commencer la synchronisation.",
	"Finish sync setup": "Terminer la configuration de la synchronisation",
	"Finished with some errors. Open the sync log to see what failed.":
		"Terminé avec quelques erreurs. Ouvre le journal de synchronisation pour voir ce qui a échoué.",
	"First sync, this may take a moment.": "Première synchronisation, cela peut prendre un moment.",
	Free: "Gratuit",
	"Free syncs notes only — images & PDFs need a paid plan.":
		"Synchronisation gratuite pour les notes uniquement — les images et les PDF nécessitent un abonnement payant.",
	"Free syncs notes only — {count} attachments will be skipped.": {
		one: "Synchronisation gratuite des notes uniquement — {count} pièce jointe sera ignorée.",
		many: "Synchronisation gratuite des notes uniquement — {count} pièces jointes seront ignorées.",
		other: "Synchronisation gratuite des notes uniquement — {count} pièces jointes seront ignorées.",
	},
	"Frontmatter could not be parsed": "Le frontmatter n'a pas pu être analysé",
	"Frontmatter isn't valid YAML.": "Le frontmatter n'est pas un YAML valide.",
	'Frontmatter key "{key}" could not be parsed as YAML.':
		'La clé du frontmatter "{key}" n\'a pas pu être interprétée comme du YAML.',
	"Frontmatter needs a fix": "Le frontmatter nécessite une correction",
	"Generic cache directory": "Répertoire de cache générique",
	"Getting set up": "Installation",
	"Getting started…": "Démarrage…",
	"GitHub Sponsors": "GitHub Sponsors",
	"Gradle build cache": "Cache de build Gradle",
	"How do you feel about Engram?": "Qu'est-ce que tu penses de Engram ?",
	"I understand {count} notes will not sync.": {
		one: "Je comprends que {count} note ne sera pas synchronisée.",
		many: "Je comprends que {count} de notes ne seront pas synchronisées.",
		other: "Je comprends que {count} notes ne seront pas synchronisées.",
	},
	Idea: "Idée",
	"If this plugin saves you time, consider supporting development.":
		"Si ce plugin te fait gagner du temps, soutiens le développement.",
	Ignore: "Ignorer",
	"Ignore patterns": "Motifs à ignorer",
	"Ignored ({count})": "Ignoré ({count})",
	"Ignored {path} — won't sync until restored from Sync Center.":
		"Ignoré {path} — ne sera synchronisé qu'après restauration depuis le Centre de synchronisation.",
	"Info (default)": "Info (par défaut)",
	"Invalid API key": "Clé API invalide",
	"It's OK to email me about this": "Tu peux me contacter par email à ce sujet",
	"Join our Discord": "Rejoins notre serveur Discord",
	Keyword: "Mot-clé",
	"Last sync: {when}": "Dernière synchronisation : {when}",
	"Learn more": "En savoir plus",
	"License: {name}": "Licence : {name}",
	"Limit reached. Upgrade to continue.":
		"Limite atteinte. Passe à une version supérieure pour continuer.",
	"Link Claude, Cursor, ChatGPT, or any MCP app so it can read and write your notes. ":
		"Lie Claude, Cursor, ChatGPT ou n'importe quelle application MCP pour qu'elle puisse lire et écrire tes notes ",
	"Link Obsidian to Engram": "Associer Obsidian à Engram",
	"Loading vaults…": "Chargement des coffres…",
	"Love it": "J'adore",
	"Make new vault": "Créer un nouveau coffre",
	"Manage account": "Gérer le compte",
	"Minimum severity that ships while diagnostics are on. Higher levels send fewer lines. Default: Info.":
		"Niveau de gravité minimum envoyé lorsque les diagnostics sont activés. Les niveaux supérieurs envoient moins de lignes. Par défaut : Info.",
	"Needs attention ({count})": "Nécessite ton attention ({count})",
	"Network unavailable": "Réseau indisponible",
	"New here? Watch the setup video": "Nouveau ici ? Regarde la vidéo d'installation",
	"New vault": "Nouveau coffre",
	"Next.js build output": "Sortie de build Next.js",
	"No activity yet. Push or pull to see entries here.":
		"Aucune activité pour l'instant. Enregistre ou télécharge pour voir les entrées.",
	"No files ignored. Use the ignore button on a failure row to stop syncing it.":
		'Aucun fichier ignoré. Utilise le bouton "ignorer" sur une ligne d\'erreur pour arrêter sa synchronisation.',
	"No other vaults available.": "Aucun autre coffre disponible.",
	"No results found": "Aucun résultat trouvé",
	"No source path for this result": "Aucun chemin de source pour ce résultat",
	"No sync activity this session.": "Aucune activité de synchronisation pendant cette session.",
	"No vaults found — first sync will create one":
		"Aucun coffre trouvé — la première synchronisation en créera un",
	"Node.js dependencies": "Dépendances Node.js",
	"Not configured": "Non configuré",
	"Not connected yet. Click to open settings and link this vault.":
		"Pas encore connecté. Clique pour ouvrir les paramètres et lier ce coffre.",
	"Not connected. Enter your Engram server URL below to start syncing.":
		"Non connecté. Entre l'URL de ton serveur Engram ci-dessous pour commencer la synchronisation.",
	"Not now": "Pas maintenant",
	"Not signed in, or the session expired. Sign in again in Engram settings.":
		"Non connecté, ou la session a expiré. Reconnecte-toi dans les paramètres de Engram.",
	"Not signed in. Click to open settings and reconnect.":
		"Pas connecté. Clique pour ouvrir les paramètres et te reconnecter.",
	"Not synced on your plan ({count})": "Non synchronisé dans ton abonnement ({count})",
	"Note couldn't be processed": "La note n'a pas pu être traitée",
	"Note limit reached. Upgrade to keep adding notes.":
		"Limite de notes atteinte. Passe à un abonnement supérieur pour ajouter plus de notes.",
	"Note not synced locally": "Note non synchronisée localement",
	"Notes on this device": "Notes sur cet appareil",
	"Notes past this still sync and open normally, they are just not in the search index. The index keeps your oldest notes, so it is your newest ones that fall outside.":
		"Les notes après celle-ci sont toujours synchronisées et s'ouvrent normalement, mais ne sont pas dans l'index de recherche. L'index conserve tes notes les plus anciennes, donc ce sont les plus récentes qui ne sont pas incluses.",
	"Notes searchable": "Notes indexées",
	"Notes stored": "Notes stockées",
	"Nothing in this vault syncs until you choose how to merge it with the server.":
		"Rien dans ce coffre n'est synchronisé tant que tu n'as pas choisi comment le fusionner avec le serveur.",
	"Nothing is deleted.": "Rien n'est supprimé.",
	"Nothing needs your attention. 🎉": "Rien ne nécessite ton attention. 🎉",
	"Nothing to sync yet — this vault is empty on both sides. Start syncing and everything you write appears on your other devices.":
		"Rien à synchroniser pour l'instant — ce coffre est vide des deux côtés. Démarre la synchronisation et tout ce que tu écris apparaîtra sur tes autres appareils.",
	"Nothing will be deleted.": "Rien ne sera supprimé.",
	"Nothing will be removed from this device.": "Rien ne sera supprimé de cet appareil.",
	Open: "Ouvrir",
	"Open Connection": "Ouvrir la connexion",
	"Open Engram": "Ouvrir Engram",
	"Open Engram settings": "Ouvrir les paramètres Engram",
	"Open Engram to check your vault and confirm everything synced.":
		"Ouvre Engram pour vérifier ton coffre et confirmer que tout s'est synchronisé.",
	"Open connection tab": "Ouvrir l'onglet de connexion",
	"Open note": "Ouvrir la note",
	"Open search sidebar": "Ouvrir la barre latérale de recherche",
	"Open sync center": "Ouvrir le Centre de synchronisation",
	"Open sync setup": "Ouvrir la configuration de la synchronisation",
	"Open the file to resolve the conflict, then sync again.":
		"Ouvre le fichier pour résoudre le conflit, puis synchronise à nouveau.",
	"Opens your browser to sign in, or create an account if you don't have one yet, then links this vault.":
		"Ouvre ton navigateur pour te connecter, ou créer un compte si tu n'en as pas, puis associe ce coffre.",
	"Or authenticate with a token instead of signing in.":
		"Ou authentifie-toi avec un token au lieu de te connecter.",
	"Or authenticate with a token instead of signing in. Engram Cloud API keys require the Pro plan; on Free and Starter, sign in above.":
		"Ou authentifie-toi avec un token au lieu de te connecter. Les clés API Engram Cloud nécessitent l'abonnement Pro ; sur les plans Free et Starter, connecte-toi ci-dessus.",
	"Paths to skip (one per line). Folder patterns end with /. Built-in: {configDir}/, .trash/, .git/":
		"Chemins à ignorer (un par ligne). Les motifs de dossiers se terminent par /. Intégrés : {configDir}/, .trash/, .git/",
	"Pick a vault": "Choisis un coffre",
	"Pick a vault (previous: '{name}' not found)":
		"Choisis un coffre (précédent : '{name}' introuvable)",
	"Pick a vault (previous: id {id} not found)":
		"Choisis un coffre (précédent : id {id} introuvable)",
	"Pick a vault to sync with. We will recalculate the sync preview after you choose.":
		"Choisis un coffre à synchroniser. Nous recalculerons l'aperçu de la synchronisation après ton choix.",
	"Plan usage": "Utilisation du plan",
	Plans: "Abonnements",
	"Privacy Policy": "Politique de confidentialité",
	Pro: "Version Pro",
	"Pull all (delete extras) aborted: could not obtain an exclusive server snapshot (replay contention). Nothing was trashed.":
		"Synchronisation complète (supprime les doublons) annulée : impossible d'obtenir une copie exclusive du serveur (conflit de réexécution). Rien n'a été supprimé.",
	"Pull all aborted: another sync is running (replay contention). Try again when it finishes.":
		"Synchronisation complète annulée : une autre synchronisation est en cours (conflit de réexécution). Réessaie lorsque celle-ci sera terminée.",
	"Pull all failed: {error}": "Synchronisation complète échouée : {error}",
	"Pull all from server (force overwrite)":
		"Télécharger tout depuis le serveur (remplacement forcé)",
	Pulled: "Tiré",
	"Push entire vault": "Envoyer tout le coffre",
	Pushed: "Poussé",
	"Python bytecode cache": "Cache de bytecode Python",
	"Python virtual environment": "Environnement virtuel Python",
	"Read it": "Lire",
	"Real-time sync": "Synchronisation en temps réel",
	"Reconnect your account to resume syncing.":
		"Reconnecte ton compte pour reprendre la synchronisation.",
	Refresh: "Actualiser",
	"Remote vault": "Coffre distant",
	"Remove tag {tag}": "Supprimer la balise {tag}",
	"Report an issue": "Signaler un problème",
	"Report an issue on GitHub": "Signaler un problème sur GitHub",
	"Request failed ({status})": "La requête a échoué ({status})",
	Restore: "Restaurer",
	"Restored {path} — will sync on next push.":
		"Restauré {path} — sera synchronisé lors du prochain enregistrement.",
	"Retry all now": "Retenter tout maintenant",
	"Retrying automatically ({count})": "Tentative automatique ({count})",
	"Review and accept": "Consulter et accepter",
	"Run in background": "Exécuter en arrière-plan",
	"Run your own Engram server": "Exécute ton propre serveur Engram",
	"Rust/Java build output": "Sortie de build Rust/Java",
	"Safe choice: combines both sides, nothing is deleted.":
		"Choix sûr : combine les deux, rien n'est supprimé.",
	Save: "Sauvegarder",
	"Search across all vaults at once": "Recherche dans tous les coffres",
	"Search all your notes": "Recherche dans toutes tes notes",
	"Search failed — check connection": "Recherche impossible — vérifie ta connexion",
	"Search settings": "Paramètres de recherche",
	"Search your vault…": "Recherche dans ton coffre…",
	"Searching {indexed} of {all} notes. Upgrade to search everything.":
		"Recherche dans {indexed} de tes {all} notes. Passe à une version supérieure pour rechercher tout.",
	"See full pricing": "Voir les tarifs complets",
	"See the AI setup guide": "Consulte le guide de configuration de l'IA",
	"Select which vault this plugin syncs with.": "Choisis le coffre que ce plugin synchronise.",
	"Selected: {selected} / {limit}": "Sélectionné : {selected} / {limit}",
	"Self-hosted": "Auto-hébergé",
	Semantic: "Sémantique",
	"Semantic search": "Recherche sémantique",
	Send: "Envoyer",
	"Send debug logs. Note content stays private.":
		"Envoyer les journaux de débogage. Le contenu de tes notes reste privé.",
	"Send detailed sync, vault, and connection activity to the server for troubleshooting, with distributed tracing on requests. Metadata only, never note content. Leave off for normal use.":
		"Envoie des informations détaillées sur la synchronisation, le coffre et la connexion au serveur pour le dépannage, avec traçage distribué des requêtes. Métadonnées uniquement, jamais le contenu des notes. Désactive pour une utilisation normale.",
	"Send feedback": "Envoyer un retour",
	"Sending…": "Envoi en cours…",
	"Server error": "Erreur serveur",
	"Server error ({status}) — check Engram logs":
		"Erreur serveur ({status}) — consulte les journaux d'Engram",
	"Server unreachable — changes will sync when connected":
		"Serveur inaccessible — les modifications seront synchronisées lorsque la connexion sera rétablie",
	"Set up sync for this vault": "Configurer la synchronisation pour ce coffre",
	"Setup is not finished — nothing will sync until you choose a sync direction. Click to finish.":
		"La configuration n'est pas terminée — rien ne sera synchronisé tant que tu n'auras pas choisi un sens de synchronisation. Clique pour terminer.",
	"Show files ({count}) ▾": "Afficher les fichiers ({count}) ▾",
	"Show sync log": "Afficher le journal de synchronisation",
	"Showing {count} entries": {
		one: "Affichage d'{count} entrée",
		many: "Affichage de {count} entrées",
		other: "Affichage de {count} entrées",
	},
	"Sign in": "Connecte-toi",
	"Sign in (or enter your server URL and key) on the connection tab, then run your first sync.":
		"Connecte-toi (ou entre l'URL de ton serveur et ta clé) dans l'onglet de connexion, puis lance ta première synchronisation.",
	"Sign in or create an account": "Connecte-toi ou crée un compte",
	"Sign out": "Déconnexion",
	"Sign-in expired": "Session expirée",
	"Sign-in required to load vaults": "Connexion requise pour charger les coffres",
	"Signed in as {email}": "Connecté en tant que {email}",
	Skipped: "Ignoré",
	"Source: {link}": "Source : {link}",
	"Start syncing": "Démarrer la synchronisation",
	Starter: "Starter",
	"Starting...": "Démarrage...",
	Stats: "Statistiques",
	"Support development": "Soutenir le développement",
	"Switch to sign in": "Passer à la connexion",
	"Switch vault": "Changer de coffre",
	"Switched to {mode}.": "Passé à {mode}.",
	Sync: "Synchroniser",
	"Sync complete": "Synchronisation terminée",
	"Sync failed": "Synchronisation échouée",
	"Sync in progress...": "Synchronisation en cours...",
	"Sync log": "Journal de synchronisation",
	"Sync now": "Synchroniser maintenant",
	"Sync paused — click to choose a sync direction":
		"Synchronisation interrompue — clique pour choisir le sens de la synchronisation",
	"Sync preview": "Aperçu de la synchronisation",
	"Sync server": "Serveur de synchronisation",
	"Sync these now": "Synchroniser maintenant",
	"Sync...": "Synchronisation...",
	"Synced. Some attachments need a paid plan to sync (see below).":
		"Synchronisé. Certaines pièces jointes nécessitent un abonnement payant pour la synchronisation (voir ci-dessous).",
	"Syncing attachments": "Synchronisation des pièces jointes",
	"Syncing your vault": "Synchronisation de ton coffre",
	"Syncing...": "Synchronisation en cours...",
	"Syncing…": "Synchronisation…",
	"Tell us anything": "Dis-nous tout",
	"Temporary errors. These clear themselves once the server recovers.":
		"Erreurs temporaires. Elles disparaissent quand le serveur est remis en état.",
	"Terms of Service": "Conditions d'utilisation",
	"Thanks, we read every message.": "Merci, nous lisons chaque message.",
	"That does not look like a complete server address. Include the scheme, for example http://127.0.0.1:4000":
		"Ce n'est pas l'adresse complète du serveur. Inclue le protocole, par exemple http://127.0.0.1:4000",
	"That does not look like an Engram API key (expected {prefix}…).":
		"Cela ne ressemble pas à une clé API Engram (attendu {prefix}…).",
	"The Free tier syncs notes only. Upgrade to sync images and PDFs.":
		"Le plan gratuit synchronise uniquement les notes. Passe à un abonnement payant pour synchroniser les images et les PDF.",
	"The file is too large for the server.": "Le fichier est trop volumineux pour le serveur.",
	"The note synced, but its frontmatter could not be fully parsed. Open it to fix the highlighted line.":
		"La note a été synchronisée, mais son frontmatter n'a pas pu être entièrement analysé. Ouvre-la pour corriger la ligne surlignée.",
	"The server couldn't process this note. Check its contents, then edit and save to try again.":
		"Le serveur n'a pas pu traiter cette note. Vérifie son contenu, puis modifie et enregistre pour réessayer.",
	"The server limit is 5 MB. Compress or split the file, then it will sync.":
		"La limite du serveur est de 5 Mo. Compresse ou divise le fichier, puis il sera synchronisé.",
	"The server took too long to respond. Try again.":
		"Le serveur a mis trop de temps à répondre. Réessaie.",
	"These files are fine. They just need a paid plan to sync.":
		"Ces fichiers sont corrects. Ils nécessitent un abonnement payant pour être synchronisés.",
	"This account was deleted. Contact support if that is wrong.":
		"Ce compte a été supprimé. Contacte le support si c'est une erreur.",
	"This cannot be undone.": "Cela ne peut pas être annulé.",
	"This device's vault is empty. Download {what} from the server?":
		"Le coffre de cet appareil est vide. Souhaites-tu télécharger {what} depuis le serveur?",
	"This file type isn't accepted by this server.":
		"Ce type de fichier n'est pas accepté par ce serveur.",
	"This note could not be processed and was skipped.":
		"Cette note n'a pas pu être traitée et a été ignorée.",
	"This server is self-hosted, so feedback is not collected here. ":
		"Ce serveur est auto-hébergé, donc les retours ne sont pas collectés ici. ",
	"This vault": "Ce coffre",
	"This vault has {count} notes. Your plan syncs {limit}.": {
		one: "Ce coffre contient {count} note. Ton abonnement synchronise {limit}.",
		many: "Ce coffre contient {count} de notes. Ton abonnement synchronise {limit}.",
		other: "Ce coffre contient {count} notes. Ton abonnement synchronise {limit}.",
	},
	"This vault is empty on the server. Upload your {what}?":
		"Ce coffre est vide sur le serveur. Souhaites-tu télécharger tes {what}?",
	"Too large for the server": "Trop volumineux pour le serveur",
	"Too many connected AI clients. Disconnect one or upgrade.":
		"Trop de clients IA connectés. Déconnecte-en un ou passe à un abonnement supérieur.",
	"Too many connected Obsidian vaults. Disconnect one or upgrade.":
		"Trop de coffres Obsidian connectés. Déconnecte-en un ou passe à un abonnement supérieur.",
	"Too many requests. Wait a moment and try again.":
		"Trop de requêtes. Attends un moment et réessaie.",
	"Try again": "Réessayer",
	"Type {keyword} to confirm:": "Tape {keyword} pour confirmer :",
	"Unknown error": "Erreur inconnue",
	"Unlimited AI searches": "Recherches IA illimitées",
	"Unlimited vaults": "Coffres illimités",
	"Unresolved conflict": "Conflit non résolu",
	Untitled: "Sans titre",
	Update: "Mettre à jour",
	"Update in settings": "Mettre à jour dans les paramètres",
	Upgrade: "Mettre à niveau",
	"Upload everything": "Télécharger tout",
	"Upload local files without downloading the remote":
		"Télécharge les fichiers locaux sans télécharger les fichiers distants",
	"Upload {count} files from this vault": {
		one: "Téléverser {count} fichier de ce coffre",
		many: "Télécharge {count} fichiers de ce coffre",
		other: "Télécharge {count} fichiers de ce coffre",
	},
	Uploading: "Envoi en cours",
	"Uploading {count}.": {
		one: "Téléchargement {count}.",
		many: "Téléchargement {count}.",
		other: "Téléchargement {count}.",
	},
	"Uploads {up}, downloads {down}.": "Téléchargements {up}, téléchargements {down}.",
	"Using API key": "Utilisation d'une clé API",
	Vault: "Coffre",
	"Vault ID: {id}": "ID du coffre : {id}",
	"Vault limit reached. Upgrade for more vaults.":
		"Limite de coffres atteinte. Passe à un abonnement supérieur pour plus de coffres.",
	"Vault name": "Nom du coffre",
	"Vault selection": "Sélection du coffre",
	"Vendored dependencies": "Dépendances intégrées",
	"Version: {version}": "Version : {version}",
	"Waiting for authorization — connected, this will complete instantly.":
		"En attente d'autorisation — connecté, cela se terminera instantanément.",
	"Waiting for authorization — no live connection, checking every 30s.":
		"En attente d'autorisation — pas de connexion active, vérification toutes les 30 secondes.",
	"Warnings and errors": "Avertissements et erreurs",
	"WebSocket connected — live sync active":
		"WebSocket connecté — synchronisation en direct active",
	"What Engram does, and how to connect your vault, start to finish.":
		"Ce qu'Engram fait, et comment connecter ton coffre, du début à la fin.",
	"What kind of feedback?": "Quel type de retour ?",
	"What's working, what's frustrating, what do you wish Engram did?":
		"Qu'est-ce qui fonctionne, qu'est-ce qui est frustrant, qu'est-ce que tu aimerais que Engram fasse ?",
	"Where this vault syncs to. Each backend keeps its own sign-in.":
		"L'emplacement de la synchronisation de ce coffre. Chaque serveur possède sa propre connexion.",
	"Will download {count} files.": {
		one: "Téléchargera {count} fichier.",
		many: "Téléchargera {count} de fichiers.",
		other: "Téléchargera {count} fichiers.",
	},
	"Will upload {count} files.": {
		one: "Téléchargement de {count} fichier.",
		many: "Téléchargement de {count} fichiers.",
		other: "Téléchargera {count} fichiers.",
	},
	"You are about to:": "Tu vas :",
	"You are now pointing at a different cloud vault":
		"Tu utilises maintenant un autre coffre en ligne",
	"You can close this and the sync keeps running in the background.":
		"Tu peux fermer ceci et la synchronisation continue en arrière-plan.",
	"You've used all the attachment storage on your plan. Upgrade for more.":
		"Tu as utilisé tout l'espace de stockage des pièces jointes de ton abonnement. Passe à un abonnement supérieur pour plus d'espace.",
	"Your code:": "Ton code :",
	"Your feedback": "Ton feedback",
	"Your login expired. Sign in again in Engram settings to continue.":
		"Ton identifiant a expiré. Connecte-toi à nouveau dans les paramètres d'Engram pour continuer.",
	"Your vault shares {percent} of its data with Engram":
		"Ton coffre partage {percent} de ses données avec Engram",
	attachments: "pièces jointes",
	exact: "exact",
	files: "fichiers",
	folders: "dossiers",
	"match strength: {pct}%": "force de correspondance : {pct}%",
	"matches meaning. Finds notes that never use the words you typed.":
		"correspond au sens. Trouve les notes qui n'utilisent jamais les mots que tu as tapés.",
	"matches words and meaning together, plus this device. Widest results.":
		"correspond aux mots et au sens ensemble, plus ce périphérique. Résultats les plus larges.",
	"matches your words and their other forms — 'run' finds 'running' — plus this device.":
		"correspond à tes mots et à leurs autres formes — 'run' trouve 'running' — plus ce périphérique.",
	meaning: "sens",
	"meaning + exact": "sens + exact",
	"not linked": "non lié",
	notes: "notes",
	"setup guide": "guide d'installation",
	"sync is paused": "la synchronisation est suspendue",
	"syncing now": "synchronisation en cours",
	unknown: "inconnu",
	"waiting for a connection": "en attente de connexion",
	"waiting to retry": "en attente de reconnexion",
	"{count} attachments": {
		one: "{count} pièce jointe",
		many: "{count} pièces jointes",
		other: "{count} pièces jointes",
	},
	"{count} attachments need a paid plan to sync. See Sync Center.": {
		one: "{count} pièce jointe nécessite un abonnement payant pour être synchronisée. Consulte le Centre de synchronisation.",
		many: "{count} Les pièces jointes nécessitent un abonnement payant pour la synchronisation. Consulte le Centre de synchronisation.",
		other: "{count} pièces jointes nécessitent un abonnement payant pour la synchronisation. Consulte le Centre de synchronisation.",
	},
	"{count} attempts": {
		one: "{count} tentative",
		many: "{count} tentatives",
		other: "{count} tentatives",
	},
	"{count} conflicts need resolution": {
		one: "{count} conflit à résoudre",
		many: "{count} conflits à résoudre",
		other: "{count} conflits à résoudre",
	},
	"{count} conflicts to resolve.": {
		one: "{count} conflit à résoudre.",
		many: "{count} conflits à résoudre.",
		other: "{count} conflits à résoudre.",
	},
	"{count} diverged": {
		one: "{count} divergent",
		many: "{count} divergent",
		other: "{count} divergents",
	},
	'{count} failed. Run "{command}" for details.': {
		one: '{count} échec. Exécute "{command}" pour plus de détails.',
		many: '{count} a échoué. Consulte "{command}" pour plus de détails.',
		other: '{count} échecs. Consulte "{command}" pour plus de détails.',
	},
	"{count} files": {
		one: "{count} fichier",
		many: "{count} fichiers",
		other: "{count} fichiers",
	},
	"{count} files not included in your plan": {
		one: "{count} fichier non inclus dans ton abonnement",
		many: "{count} fichiers non inclus dans ton abonnement",
		other: "{count} fichiers non inclus dans ton abonnement",
	},
	"{count} files queued": {
		one: "{count} fichier en attente",
		many: "{count} fichiers en attente",
		other: "{count} fichiers en attente",
	},
	"{count} ignored": { one: "{count} ignoré", many: "{count} ignorés", other: "{count} ignorés" },
	"{count} missing on server": {
		one: "{count} manquant sur le serveur",
		many: "{count} manquants sur le serveur",
		other: "{count} manquants sur le serveur",
	},
	"{count} need attention": {
		one: "{count} demande ton attention",
		many: "{count} nécessitent ton attention",
		other: "{count} nécessitent ton attention",
	},
	"{count} notes": { one: "{count} note", many: "{count} notes", other: "{count} notes" },
	"{count} only on server": {
		one: "{count} uniquement sur serveur",
		many: "{count} uniquement sur serveur",
		other: "{count} uniquement sur serveur",
	},
	"{count} queued — {reason}": {
		one: "{count} en file d'attente — {reason}",
		many: "{count} en attente — {reason}",
		other: "{count} en file d'attente — {reason}",
	},
	"{count} retrying": {
		one: "{count} tentative de synchronisation",
		many: "{count} en cours de relecture",
		other: "{count} en cours de relecture",
	},
	"{desc} — should not be synced": "{desc} — ne doit pas être synchronisé",
	"{first} and {second}": "{first} et {second}",
	"{formatted} per day": "{formatted} par jour",
	"{label} ({count} queued)": {
		one: "{label} ({count} en attente)",
		many: "{label} ({count} en attente)",
		other: "{label} ({count} en attente)",
	},
	"{n} of 5": "{n} sur 5",
	"▶ Watch on YouTube": "▶ Regarder sur YouTube",
	"⚙️ Advanced": "⚙️ Avancé",
	"⚠ Detected: {label}/ ({formatted} files)": "⚠ Détecté : {label} / ({formatted} fichiers)",
	"✓ Engram server reachable (v{version})": "✓ Serveur Engram accessible (v{version})",
	"✓ {count} synced": {
		one: "✓ {count} coffre synchronisé",
		many: "✓ {count} synchronisé",
		other: "✓ {count} synchronisés",
	},
	"✕ {count} failed": {
		one: "✕ {count} échec",
		many: "✕ {count} échec",
		other: "✕ {count} échecs",
	},
	"✗ couldn't reach a server at this URL": "✗ Impossible de contacter un serveur à cette URL",
	"✗ server responded but isn't an Engram server":
		"✗ Le serveur a répondu, mais ce n'est pas un serveur Engram",
	"⤳ {count} skipped (Free plan)": {
		one: "⤳ {count} ignoré (plan gratuit)",
		many: "⤳ {count} ignoré (Plan gratuit)",
		other: "⤳ {count} ignorés (Plan gratuit)",
	},
	"👋 Welcome": "👋 Bienvenue",
	"💬 Feedback": "💬 Retour",
	"🔄 Sync Center": "🔄 Centre de synchronisation",
	"🔌 Connection": "🔌 Connexion",
};

export default fr;
