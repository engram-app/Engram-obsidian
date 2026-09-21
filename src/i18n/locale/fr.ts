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
	// UI strings
	"Link Obsidian to Engram": "Connecter Obsidian à Engram",
	"Failed to start device flow. Check your Engram URL and try again.":
		"Impossible de lancer la connexion de l'appareil. Vérifie l'adresse de ton Engram et réessaie.",
	"Your code:": "Ton code :",
	"A browser window has opened. Sign in and enter this code to link your vault.":
		"Une fenêtre de navigateur s'est ouverte. Connecte-toi et saisis ce code pour relier ton coffre.",
	Cancel: "Annuler",
	"Code expired. Please try again.": "Le code a expiré. Réessaie.",
	"Try again": "Réessayer",
	Close: "Fermer",
	"Note couldn't be processed": "Cette note n'a pas pu être traitée",
	"The server couldn't process this note. Check its contents, then edit and save to try again.":
		"Le serveur n'a pas pu traiter cette note. Vérifie son contenu, puis modifie-la et enregistre pour réessayer.",
	"Attachments need a paid plan": "Les pièces jointes demandent une offre payante",
	"The Free tier syncs notes only. Upgrade to sync images and PDFs.":
		"L'offre gratuite ne synchronise que les notes. Passe à une offre payante pour les images et les PDF.",
	"Attachment storage full": "Stockage des pièces jointes plein",
	"You've used all the attachment storage on your plan. Upgrade for more.":
		"Tu as utilisé tout le stockage de pièces jointes de ton offre. Une offre payante en donne plus.",
	"Too large for the server": "Trop volumineux pour le serveur",
	"The server limit is 5 MB. Compress or split the file, then it will sync.":
		"La limite du serveur est de 5 Mo. Compresse ou découpe le fichier et il se synchronisera.",
	"Sign-in expired": "Session expirée",
	"Reconnect your account to resume syncing.":
		"Reconnecte ton compte pour reprendre la synchronisation.",
	"Unresolved conflict": "Conflit non résolu",
	"Open the file to resolve the conflict, then sync again.":
		"Ouvre le fichier, résous le conflit, puis synchronise à nouveau.",
	"Frontmatter needs a fix": "Le frontmatter a besoin d'une correction",
	"The note synced, but its frontmatter could not be fully parsed. Open it to fix the highlighted line.":
		"La note est synchronisée, mais son frontmatter n'a pas pu être lu entièrement. Ouvre-la et corrige la ligne signalée.",
	"Server error": "Erreur du serveur",
	"A temporary server problem — retrying automatically.":
		"Problème temporaire du serveur, nouvelle tentative automatique.",
	"Network unavailable": "Réseau indisponible",
	"Can't reach the server — retrying automatically.":
		"Serveur injoignable, nouvelle tentative automatique.",
	"Sync failed": "Échec de la synchronisation",
	"An unexpected error — retrying automatically.":
		"Erreur inattendue, nouvelle tentative automatique.",
	Upgrade: "Passer à une offre payante",
	"Update in settings": "Mettre à jour dans les paramètres",
	"Engram: ready": "Engram : prêt",
	"Resume sync": "Reprendre la synchronisation",
	"Engram Vault Sync {version} is available. {link}.":
		"Engram Vault Sync {version} est disponible. {link}.",
	"Search your vault…": "Cherche dans ton coffre…",
	"Filter by folder…": "Filtrer par dossier…",
	"Filter by tags…": "Filtrer par tags…",
	"Search failed — check connection": "Recherche en échec, vérifie la connexion",
	"No results found": "Aucun résultat",
	"match strength: {pct}%": "Pertinence : {pct}%",
	"Open sync setup": "Ouvrir la configuration de la synchronisation",
	"Last sync: {when}": "Dernière synchronisation : {when}",
	"waiting for a connection": "en attente d'une connexion",
	"sync is paused": "la synchronisation est en pause",
	"syncing now": "synchronisation en cours",
	"waiting to retry": "en attente d'une nouvelle tentative",
	"{count} not on your plan": "{count} hors de ton offre",
	"{count} retrying": "{count} en nouvelle tentative",
	"{count} ignored": "{count} ignorés",
	"{count} queued — {reason}": "{count} en file d'attente, {reason}",
	"These files are fine. They just need a paid plan to sync.":
		"Ces fichiers vont bien. Il leur faut simplement une offre payante.",
	"Show files ({count}) ▾": "Afficher les fichiers ({count}) ▾",
	"Sync these now": "Synchroniser ceux-ci maintenant",
	"Clear all": "Tout effacer",
	"Nothing needs your attention. 🎉": "Rien ne demande ton attention. 🎉",
	Dismiss: "Masquer",
	"Retry all now": "Tout réessayer maintenant",
	"Temporary errors. These clear themselves once the server recovers.":
		"Erreurs temporaires. Elles disparaissent d'elles-mêmes dès que le serveur revient.",
	Open: "Ouvrir",
	Ignore: "Ignorer",
	"No files ignored. Use the ignore button on a failure row to stop syncing it.":
		"Aucun fichier ignoré. Utilise le bouton ignorer sur une ligne en échec pour arrêter de le synchroniser.",
	Restore: "Restaurer",
	Clear: "Effacer",
	"No activity yet. Push or pull to see entries here.":
		"Aucune activité pour l'instant. Envoie ou récupère et les entrées apparaîtront ici.",
	"Sync log": "Journal de synchronisation",
	"Could not compare with the cloud. Check your connection.":
		"Comparaison avec le serveur impossible. Vérifie ta connexion.",
	"Your login expired. Sign in again in Engram settings to continue.":
		"Ta session a expiré. Reconnecte-toi dans Engram settings pour continuer.",
	"Couldn't create vault — the name may be invalid or already in use.":
		"Impossible de créer le coffre : le nom est peut-être invalide ou déjà pris.",
	"Could not create the vault — check your connection and try again.":
		"Impossible de créer le coffre, vérifie ta connexion et réessaie.",
	"Free syncs notes only — {count} attachments will be skipped.": {
		one: "L'offre gratuite ne synchronise que les notes, {count} pièce jointe sera ignorée.",
		other: "L'offre gratuite ne synchronise que les notes, {count} pièces jointes seront ignorées.",
	},
	"Comparing your vault with the cloud…": "Comparaison de ton coffre avec le serveur…",
	"Until you choose, nothing in this vault will sync.":
		"Tant que tu n'as pas choisi, rien ne se synchronise dans ce coffre.",
	"Change vault": "Changer de coffre",
	"Advanced sync options": "Options de synchronisation avancées",
	"Everything is in sync": "Tout est synchronisé",
	" conflicts need resolution": {
		one: " conflit à résoudre",
		other: " conflits à résoudre",
	},
	"Confirm destructive sync": "Confirmer une synchronisation destructive",
	"You are about to:": "Voici ce qui va se passer :",
	"Files that will be deleted:": "Fichiers qui seront supprimés :",
	"This cannot be undone.": "C'est irréversible.",
	Back: "Retour",
	Confirm: "Confirmer",
	"Switch vault": "Changer de coffre",
	"Pick a vault to sync with. We will recalculate the sync preview after you choose.":
		"Choisis le coffre à synchroniser. Nous recalculerons l'aperçu ensuite.",
	"Loading vaults…": "Chargement des coffres…",
	"No other vaults available.": "Aucun autre coffre disponible.",
	"Make new vault": "Créer un coffre",
	"New vault": "Nouveau coffre",
	"Create a new empty vault on the server, then sync this Obsidian vault into it.":
		"Créer un coffre vide sur le serveur, puis y synchroniser ce coffre Obsidian.",
	Create: "Créer",
	"Your vault shares {percent} of its data with Engram":
		"Ton coffre partage {percent} de ses données avec Engram",
	"Type {keyword} to confirm:": "Tape {keyword} pour confirmer :",
	"✓ {count} synced": "✓ {count} synchronisés",
	"⤳ {count} skipped (Free plan)": "⤳ {count} ignorés (offre gratuite)",
	"✕ {count} failed": "✕ {count} en échec",
	"{count} attachments need a paid plan to sync. See Sync Center.": {
		one: "{count} pièce jointe demande une offre payante. Voir le Sync Center.",
		other: "{count} pièces jointes demandent une offre payante. Voir le Sync Center.",
	},
	"Syncing your vault": "Synchronisation de ton coffre",
	"Getting started…": "On démarre…",
	"Open Engram to check your vault and confirm everything synced.":
		"Ouvre Engram pour vérifier ton coffre et confirmer que tout est synchronisé.",
	"Open Engram": "Ouvrir Engram",
	"You can close this and the sync keeps running in the background.":
		"Tu peux fermer cette fenêtre, la synchronisation continue en arrière-plan.",
	"Run in background": "Laisser tourner en arrière-plan",
	"Syncing…": "Synchronisation…",
	"Sync complete": "Synchronisation terminée",
	Done: "Terminé",
	"Engram: sync conflict on {path} — your local edit was saved as {copy}":
		"Engram : conflit de synchronisation sur {path}, ta modification locale a été enregistrée sous {copy}",
	"Open note": "Ouvrir la note",
	"Engram: {count} notes have frontmatter problems. Open Sync Center to fix.":
		"Engram : le frontmatter de {count} notes pose problème. Ouvre le Sync Center pour corriger.",
	"New here? Watch the setup video": "Nouveau ici ? Regarde la vidéo d'installation",
	"What Engram does, and how to connect your vault, start to finish.":
		"Ce que fait Engram, et comment relier ton coffre, de bout en bout.",
	"▶ Watch on YouTube": "▶ Regarder sur YouTube",
	"1. Make an account": "1. Créer un compte",
	"2. Connect your vault to Engram": "2. Relier ton coffre à Engram",
	"Open connection tab": "Ouvrir l'onglet de connexion",
	"3. Connect your AI": "3. Connecter ton IA",
	"Node.js dependencies": "Dépendances Node.js",
	"Python virtual environment": "Environnement virtuel Python",
	"Python bytecode cache": "Cache de bytecode Python",
	"Vendored dependencies": "Dépendances embarquées",
	"Gradle build cache": "Cache de build Gradle",
	"Rust/Java build output": "Sortie de build Rust/Java",
	"Build output": "Sortie de build",
	"Next.js build output": "Sortie de build Next.js",
	"Distribution build output": "Sortie de build de distribution",
	"Cargo cache": "Cache Cargo",
	"CocoaPods dependencies": "Dépendances CocoaPods",
	"Dart tool cache": "Cache d'outils Dart",
	"Generic cache directory": "Répertoire de cache générique",
	"Ignore patterns": "Motifs à ignorer",
	"Custom patterns": "Motifs personnalisés",
	Diagnostics: "Diagnostics",
	"Diagnostics detail": "Détail des diagnostics",
	About: "À propos",
	"License: {name}": "Licence : {name}",
	"⚠ Detected: {label}/ ({formatted} files)": "⚠ Détecté : {label}/ ({formatted} fichiers)",
	"{desc} — should not be synced": "{desc}, ne devrait pas être synchronisé",
	"Add to ignores": "Ajouter aux ignorés",
	"Version: {version}": "Version : {version}",
	"Source: {link}": "Source : {link}",
	"Engram URL": "Adresse Engram",
	"✓ Engram server reachable (v{version})": "✓ Serveur Engram joignable (v{version})",
	"✗ server responded but isn't an Engram backend":
		"✗ Le serveur répond mais n'est pas un backend Engram",
	"✗ couldn't reach a server at this URL": "✗ Aucun serveur joignable à cette adresse",
	"Checking server…": "Vérification du serveur…",
	Authentication: "Authentification",
	"Authenticated via Engram account (OAuth).": "Authentifié via ton compte Engram (OAuth).",
	"Manage account": "Gérer le compte",
	"Sign out": "Se déconnecter",
	"Using API key": "Clé d'API utilisée",
	"Authenticated via manual API key.": "Authentifié via une clé d'API saisie à la main.",
	"Clear key": "Effacer la clé",
	"Switch to sign in": "Passer à la connexion",
	"Sign in or create an account": "Se connecter ou créer un compte",
	"Sign in": "Se connecter",
	"API key": "Clé d'API",
	Token: "Jeton",
	"Bearer token from your Engram account.": "Jeton Bearer de ton compte Engram.",
	Save: "Enregistrer",
	"That does not look like an Engram API key (expected {prefix}…).":
		"Cela ne ressemble pas à une clé d'API Engram (attendu : {prefix}…).",
	Vault: "Coffre",
	"Vault selection": "Choix du coffre",
	"Select which vault this plugin syncs with.": "Choisis le coffre que ce plugin synchronise.",
	"No vaults found — first sync will create one":
		"Aucun coffre trouvé, la première synchronisation en créera un",
	"Pick a vault": "Choisir un coffre",
	Change: "Changer",
	"Support development": "Soutenir le développement",
	"GitHub Sponsors": "GitHub Sponsors",
	Backend: "Backend",
	"Where this vault syncs to. Each backend keeps its own sign-in.":
		"Là où ce coffre se synchronise. Chaque backend garde sa propre connexion.",
	"Run your own Engram server": "Héberger ton propre serveur Engram",
	"Engram is the backend that powers sync and semantic search.":
		"Engram est le backend qui fait tourner la synchronisation et la recherche sémantique.",
	"Finish sync setup": "Terminer la configuration",
	"Nothing in this vault syncs until you choose how to merge it with the server.":
		"Ce coffre ne synchronise rien tant que tu n'as pas choisi comment le fusionner avec le serveur.",
	"Choose sync direction": "Choisir le sens de la synchronisation",
	"Engram: this plugin is too old to sync (needs {version} or newer). Update it to continue.":
		"Engram : ce plugin est trop ancien pour synchroniser (il faut {version} ou plus récent). Mets-le à jour pour continuer.",
	"Engram: this plugin is too old to sync. Update it to continue.":
		"Engram : ce plugin est trop ancien pour synchroniser. Mets-le à jour pour continuer.",
	Update: "Mettre à jour",
	// UI strings (second pass)
	"Invalid API key": "Clé d'API invalide",
	"Connection failed": "Connexion échouée",
	"Sync now": "Synchroniser maintenant",
	"Disconnect (clear login)": "Se déconnecter (effacer la connexion)",
	"Push entire vault": "Envoyer tout le coffre",
	"Check sync status": "Vérifier l'état de la synchronisation",
	"Engram sync: server does not support reconciliation (update backend)":
		"Engram Sync : le serveur ne sait pas rapprocher les données (mets le backend à jour)",
	"Pull all from server (force overwrite)": "Tout récupérer du serveur (écrase en local)",
	"Show sync log": "Afficher le journal de synchronisation",
	"Semantic search": "Recherche sémantique",
	"Open search sidebar": "Ouvrir le panneau de recherche",
	"Engram search": "Recherche Engram",
	"Open sync center": "Ouvrir le Sync Center",
	"Engram: this vault no longer exists on the server. Pick or create a vault to continue.":
		"Engram : ce coffre n'existe plus sur le serveur. Choisis ou crée un coffre pour continuer.",
	"Engram: recovered plugin settings from a backup after a corrupted save.":
		"Engram : les réglages étaient corrompus, ils ont été restaurés depuis une sauvegarde.",
	"Engram sync: live sync requires a plugin update — please update the Engram vault sync plugin.":
		"Engram Sync : la synchronisation en direct demande une mise à jour du plugin. Mets Engram vault sync à jour.",
	"Engram: sync is paused — this edit was not synced. Choose a sync direction to resume.":
		"Engram : la synchronisation est en pause, cette modification n'a pas été envoyée. Choisis un sens de synchronisation pour reprendre.",
	"Engram: not connected": "Engram : non connecté",
	"Engram: signed out": "Engram : déconnecté",
	"Not connected yet. Click to open settings and link this vault.":
		"Pas encore connecté. Clique pour ouvrir les paramètres et relier ce coffre.",
	"Not signed in. Click to open settings and reconnect.":
		"Non connecté. Clique pour ouvrir les paramètres et te reconnecter.",
	"Engram: finish setup": "Engram : terminer la configuration",
	"Engram: sync paused": "Engram : synchronisation en pause",
	"{label} ({count} queued)": "{label} ({count} en attente)",
	"Setup is not finished — nothing will sync until you choose a sync direction. Click to finish.":
		"La configuration n'est pas terminée. Rien ne se synchronise tant que tu n'as pas choisi un sens. Clique pour terminer.",
	"Sync paused — click to choose a sync direction":
		"Synchronisation en pause, clique pour choisir un sens",
	"Engram: offline ({count} queued)": "Engram : hors ligne ({count} en attente)",
	"Engram: offline": "Engram : hors ligne",
	"Server unreachable — changes will sync when connected":
		"Serveur injoignable, les modifications partiront dès le retour de la connexion",
	"Engram: error": "Engram : erreur",
	"Unknown error": "Erreur inconnue",
	"Engram: syncing ({count})": "Engram : synchronisation ({count})",
	"Engram: syncing": "Engram : synchronisation",
	"Sync in progress...": "Synchronisation en cours…",
	"Engram: pending ({count})": "Engram : en attente ({count})",
	"{count} files queued": "{count} fichiers en attente",
	"Engram: live": "Engram : en direct",
	"WebSocket connected — live sync active":
		"WebSocket connecté, la synchronisation en direct est active",
	"Click to sync": "Clique pour synchroniser",
	Attachments: "Pièces jointes",
	Keyword: "Mot-clé",
	Semantic: "Sémantique",
	Both: "Les deux",
	"matches your words and their other forms — 'run' finds 'running' — plus this device.":
		"Trouve tes mots et leurs formes, « courir » trouve aussi « courant », et cet appareil en plus.",
	"matches meaning. Finds notes that never use the words you typed.":
		"Trouve par le sens, y compris des notes où tes mots n'apparaissent jamais.",
	"matches words and meaning together, plus this device. Widest results.":
		"Trouve mots et sens ensemble, plus cet appareil. La recherche la plus large.",
	"Clear search": "Effacer la recherche",
	"Search settings": "Paramètres de recherche",
	Untitled: "Sans titre",
	"meaning + exact": "sens + exact",
	Disconnected: "Déconnecté",
	"Connected — waiting for first sync decision":
		"Connecté, en attente du premier choix de synchronisation",
	"Connected — live sync active": "Connecté, synchronisation en direct active",
	"Connected — polling": "Connecté, interrogation régulière",
	"Not configured": "Non configuré",
	Refresh: "Recharger",
	"Not synced on your plan ({count})": "Hors de ton offre ({count})",
	"Needs attention ({count})": "Demande ton attention ({count})",
	"Retrying automatically ({count})": "Nouvelle tentative automatique ({count})",
	Stats: "Chiffres",
	"Notes on this device": "Notes sur cet appareil",
	"Attachments on this device": "Pièces jointes sur cet appareil",
	"Remote vault": "Coffre sur le serveur",
	"not linked": "non relié",
	"Plan usage": "Utilisation de l'offre",
	"Safe choice: combines both sides, nothing is deleted.":
		"Choix sûr : combine les deux côtés, rien n'est supprimé.",
	"Already in sync. Nothing is deleted.": "Déjà synchronisé. Rien n'est supprimé.",
	Sync: "Synchroniser",
	"Upload local files without downloading the remote":
		"Envoyer les fichiers locaux sans rien récupérer du serveur",
	"Delete all on remote, then upload local files":
		"Tout supprimer sur le serveur, puis envoyer les fichiers locaux",
	"Download remote files without uploading the local":
		"Récupérer les fichiers du serveur sans envoyer les locaux",
	"Delete all local files, then download from remote":
		"Supprimer tous les fichiers locaux, puis récupérer du serveur",
	"Set up sync for this vault": "Configurer la synchronisation de ce coffre",
	"You are now pointing at a different cloud vault":
		"Tu pointes maintenant vers un autre coffre dans le cloud",
	"Sync preview": "Aperçu de la synchronisation",
	"Start syncing": "Lancer la synchronisation",
	"Upload everything": "Tout envoyer",
	"Nothing will be removed from this device.": "Rien ne sera retiré de cet appareil.",
	"Download everything": "Tout récupérer",
	"Not now": "Plus tard",
	"This vault": "Ce coffre",
	"Cloud server": "Coffre sur le serveur",
	"Vault name": "Nom du coffre",
	"Could not load vaults": "Impossible de charger les coffres",
	"Enter a name for the new vault": "Donne un nom au nouveau coffre",
	"Failed to switch vault": "Le changement de coffre a échoué",
	"Finished with some errors. Open the sync log to see what failed.":
		"Terminé avec quelques erreurs. Le journal de synchronisation indique ce qui a échoué.",
	"Synced. Some attachments need a paid plan to sync (see below).":
		"Synchronisé. Certaines pièces jointes demandent une offre payante (voir plus bas).",
	"All synced. Your vault and the cloud now match.":
		"Tout est synchronisé. Ton coffre et le cloud correspondent.",
	"Already up to date. Nothing needed syncing.": "Déjà à jour. Il n'y avait rien à synchroniser.",
	Deleting: "Suppression",
	Downloading: "Téléchargement",
	Uploading: "Envoi",
	"Syncing attachments": "Synchronisation des pièces jointes",
	Complete: "Terminé",
	"Getting set up": "Mise en route",
	"setup guide": "guide d'installation",
	"Sign in (or enter your server URL and key) on the connection tab, then run your first sync.":
		"Connecte-toi dans l'onglet de connexion (ou saisis l'URL de ton serveur et ta clé), puis lance ta première synchronisation.",
	"See the AI setup guide": "Voir le guide d'installation IA",
	Plans: "Offres",
	Free: "Gratuit",
	"1 vault, 2 devices": "1 coffre, 2 appareils",
	"Real-time sync": "Synchronisation en temps réel",
	"2,000 notes searchable": "2 000 notes consultables",
	"Connect any AI (MCP)": "Connecter n'importe quelle IA (MCP)",
	Starter: "Starter",
	"10 vaults, unlimited devices": "10 coffres, appareils illimités",
	"Search all your notes": "Chercher dans toutes tes notes",
	"10 GB attachments": "10 Go de pièces jointes",
	"Unlimited AI searches": "Recherches IA illimitées",
	Pro: "Pro",
	"Unlimited vaults": "Coffres illimités",
	"Search across all vaults at once": "Chercher dans tous les coffres à la fois",
	"50 GB attachments": "50 Go de pièces jointes",
	"API access": "Accès à l'API",
	"See full pricing": "Voir tous les tarifs",
	"Learn more": "En savoir plus",
	"Errors only": "Erreurs seulement",
	"Warnings and errors": "Avertissements et erreurs",
	"Info (default)": "Info (par défaut)",
	"Debug (verbose)": "Débogage (détaillé)",
	"Or authenticate with a token instead of signing in.":
		"Ou authentifie-toi avec un jeton au lieu de te connecter.",
	"If this plugin saves you time, consider supporting development.":
		"Si ce plugin te fait gagner du temps, pense à soutenir le développement.",
	"Sign-in required to load vaults": "Il faut être connecté pour charger les coffres",
	"Could not reach Engram — check connection": "Engram injoignable, vérifie la connexion",
	// UI strings (sync error surfaces)
	"Free syncs notes only — images & PDFs need a paid plan.":
		"L'offre gratuite ne synchronise que les notes : les images et les PDF demandent une offre payante.",
	"Pull all (delete extras) aborted: could not obtain an exclusive server snapshot (replay contention). Nothing was trashed.":
		"« Tout récupérer (supprimer les extras) » interrompu : impossible d'obtenir un instantané exclusif du serveur (conflit de relecture). Rien n'a été mis à la corbeille.",
	"Pull all aborted: another sync is running (replay contention). Try again when it finishes.":
		"« Tout récupérer » interrompu : une autre synchronisation est en cours (conflit de relecture). Réessaie quand elle est finie.",
	"Pull all failed: {error}": "« Tout récupérer » a échoué : {error}",
	"Pull all failed": "« Tout récupérer » a échoué",
	// UI strings (third pass)
	"Click to copy": "Cliquer pour copier",
	"Waiting for authorization — connected, this will complete instantly.":
		"En attente de l'autorisation : connecté, ce sera immédiat.",
	"Waiting for authorization — no live connection, checking every 30s.":
		"En attente de l'autorisation : pas de connexion en direct, vérification toutes les 30 s.",
	'Engram Sync: sync state for "{name}" was unreadable — using the on-disk copy.':
		"Engram Sync : l'état de synchronisation de « {name} » était illisible, la copie sur le disque est utilisée.",
	"{formatted} files · ": {
		one: "{formatted} fichier · ",
		other: "{formatted} fichiers · ",
	},
	"Notes searchable": "Notes trouvables",
	"Notes past this still sync and open normally, they are just not in the search index. The index keeps your oldest notes, so it is your newest ones that fall outside.":
		"Les notes au-delà continuent de se synchroniser et de s'ouvrir normalement, elles ne sont simplement pas dans l'index de recherche. L'index garde vos notes les plus anciennes, ce sont donc les plus récentes qui en sortent.",
	"Notes stored": "Notes stockées",
	"AI searches": "Recherches IA",
	"{formatted} per day": "{formatted} par jour",
	"Engram indexes {indexed} of your {all} notes. The rest match on this device only. Upgrade to index everything.":
		"Engram indexe {indexed} de vos {all} notes. Le reste ne correspond que sur cet appareil. Passez à une offre supérieure pour tout indexer.",
	"Searching {indexed} of {all} notes. Upgrade to search everything.":
		"Recherche dans {indexed} notes sur {all}. Passez à une offre supérieure pour tout chercher.",
	"Remove tag {tag}": "Retirer l'étiquette {tag}",
	"👋 Welcome": "👋 Bienvenue",
	"🔌 Connection": "🔌 Connexion",
	"🔄 Sync Center": "🔄 Sync Center",
	"⚙️ Advanced": "⚙️ Avancé",
	"Error: {error}": "Erreur : {error}",
	unknown: "inconnu",
	"{count} need attention": {
		one: "{count} demande votre attention",
		other: "{count} demandent votre attention",
	},
	"Uploads {up}, downloads {down}.": "Envoie {up}, récupère {down}.",
	"Uploads {count}.": "Envoie {count}.",
	"Downloads {count}.": "Récupère {count}.",
	"{count} conflicts to resolve.": {
		one: "{count} conflit à résoudre.",
		other: "{count} conflits à résoudre.",
	},
	"Nothing is deleted.": "Rien n'est supprimé.",
	"Delete all {count} files currently on the server": {
		one: "Supprimer le {count} fichier présent sur le serveur",
		other: "Supprimer les {count} fichiers présents sur le serveur",
	},
	"Upload {count} files from this vault": {
		one: "Envoyer {count} fichier depuis ce coffre",
		other: "Envoyer {count} fichiers depuis ce coffre",
	},
	"Delete all {count} files in this vault": {
		one: "Supprimer le {count} fichier de ce coffre",
		other: "Supprimer les {count} fichiers de ce coffre",
	},
	"Download {count} files from the server": {
		one: "Récupérer {count} fichier depuis le serveur",
		other: "Récupérer {count} fichiers depuis le serveur",
	},
	"Nothing to sync yet — this vault is empty on both sides. Start syncing and everything you write appears on your other devices.":
		"Rien à synchroniser pour le moment, ce coffre est vide des deux côtés. Lancez la synchronisation et tout ce que vous écrivez apparaîtra sur vos autres appareils.",
	"{count} notes": {
		one: "{count} note",
		other: "{count} notes",
	},
	"{count} attachments": {
		one: "{count} pièce jointe",
		other: "{count} pièces jointes",
	},
	"{first} and {second}": "{first} et {second}",
	files: "fichiers",
	"This vault is empty on the server. Upload your {what}?":
		"Ce coffre est vide sur le serveur. Envoyer vos {what} ?",
	"This device's vault is empty. Download {what} from the server?":
		"Le coffre de cet appareil est vide. Récupérer {what} depuis le serveur ?",
	notes: "notes",
	attachments: "pièces jointes",
	folders: "dossiers",
	"Uploading {count}.": "Envoi de {count}.",
	"Downloading {count}.": "Réception de {count}.",
	"Deleting {count} local files.": "Suppression de {count} fichiers locaux.",
	"Deleting {count} on the cloud.": "Suppression de {count} dans le cloud.",
	"First sync, this may take a moment.": "Première synchronisation, cela peut prendre un moment.",
	"Checking for changes.": "Vérification des changements.",
	"Nothing will be deleted.": "Rien ne sera supprimé.",
	'{count} failed. Run "{command}" for details.':
		"{count} en échec. Lancez « {command} » pour les détails.",
	'Engram Sync: renamed "{name}" (unsupported characters)':
		"Engram Sync : « {name} » a été renommé (caractères non pris en charge)",
	'Engram: frontmatter problem in "{name}"': "Engram : problème de frontmatter dans « {name} »",
	"Create a hosted account at ": "Créez un compte hébergé sur ",
	", or self-host the backend (": ", ou hébergez le backend vous-même (",
	"Link Claude, Cursor, ChatGPT, or any MCP app so it can read and write your notes. ":
		"Reliez Claude, Cursor, ChatGPT ou toute application MCP pour qu'elle puisse lire et écrire vos notes. ",
	Documentation: "Documentation",
	"AI / MCP setup guide": "Guide de configuration IA / MCP",
	"Report an issue": "Signaler un problème",
	"Join our Discord": "Rejoignez notre Discord",
	"Paths to skip (one per line). Folder patterns end with /. Built-in: {configDir}/, .trash/, .git/":
		"Chemins à ignorer (un par ligne). Les motifs de dossier finissent par /. Intégrés : {configDir}/, .trash/, .git/",
	"Send detailed sync, vault, and connection activity to the server for troubleshooting, with distributed tracing on requests. Metadata only, never note content. Leave off for normal use.":
		"Envoie au serveur l'activité détaillée de synchronisation, de coffre et de connexion pour le dépannage, avec un traçage distribué des requêtes. Métadonnées uniquement, jamais le contenu des notes. Laissez désactivé pour un usage normal.",
	"Minimum severity that ships while diagnostics are on. Higher levels send fewer lines. Default: Info.":
		"Gravité minimale envoyée quand le diagnostic est actif. Les niveaux plus élevés envoient moins de lignes. Par défaut : Info.",
	"Signed in as {email}": "Connecté en tant que {email}",
	"Pick a vault (previous: '{name}' not found)":
		"Choisissez un coffre (précédent : « {name} » introuvable)",
	"Pick a vault (previous: id {id} not found)":
		"Choisissez un coffre (ancien id {id} introuvable)",
	"Server error ({status}) — check Engram logs":
		"Erreur du serveur ({status}), consultez les journaux Engram",
	"Request failed ({status})": "Échec de la requête ({status})",
	"Engram Cloud": "Engram Cloud",
	"Self-hosted": "Auto-hébergé",
	"{count} attempts": {
		one: "{count} tentative",
		other: "{count} tentatives",
	},
	// UI strings (fourth pass)
	"{count} missing on server": {
		one: "{count} manque sur le serveur",
		other: "{count} manquent sur le serveur",
	},
	"{count} diverged": {
		one: "{count} a divergé",
		other: "{count} ont divergé",
	},
	"{count} only on server": "{count} seulement sur le serveur",
	"Engram Sync: {details}": "Engram Sync : {details}",
	"Engram: plugin settings file was corrupted and could not be recovered. You may need to reconnect in settings.":
		"Engram : le fichier de réglages du plugin était corrompu et n'a pas pu être récupéré. Vous devrez peut-être vous reconnecter dans les réglages.",
	"Engram: sync is not set up yet, so nothing in this vault will sync.":
		"Engram : la synchronisation n'est pas encore configurée, rien de ce coffre ne sera donc synchronisé.",
	"Click the Engram item in the status bar to pick up where you left off.":
		"Cliquez sur Engram dans la barre d'état pour reprendre où vous en étiez.",
	"Engram: ⚠ {count} sync errors": {
		one: "Engram : ⚠ {count} erreur de synchronisation",
		other: "Engram : ⚠ {count} erreurs de synchronisation",
	},
	"sync failed": "la synchronisation a échoué",
	"That does not look like a complete server address. Include the scheme, for example http://127.0.0.1:4000":
		"Cela ne ressemble pas à une adresse de serveur complète. Indiquez le schéma, par exemple http://127.0.0.1:4000",
	"Opens your browser to sign in, or create an account if you don't have one yet, then links this vault.":
		"Ouvre votre navigateur pour vous connecter, ou créer un compte si vous n'en avez pas encore, puis relie ce coffre.",
	"Or authenticate with a token instead of signing in. Engram Cloud API keys require the Pro plan; on Free and Starter, sign in above.":
		"Ou authentifiez-vous avec un jeton au lieu de vous connecter. Les clés d'API Engram Cloud demandent l'offre Pro ; sur Free et Starter, connectez-vous ci-dessus.",
	"No sync activity this session.": "Aucune activité de synchronisation dans cette session.",
	"Showing {count} entries": {
		one: "{count} entrée affichée",
		other: "{count} entrées affichées",
	},
	"({count} errors)": {
		one: "({count} erreur)",
		other: "({count} erreurs)",
	},
	"Frontmatter could not be parsed": "Le frontmatter n'a pas pu être analysé",
	"Not connected. Enter your Engram server URL below to start syncing.":
		"Non connecté. Saisissez ci-dessous l'adresse de votre serveur Engram pour commencer à synchroniser.",
	// UI strings (fifth pass)
	"Sync...": "Synchroniser...",
	"Syncing...": "Synchronisation...",
	" (default)": " (par défaut)",
};

export default fr;
