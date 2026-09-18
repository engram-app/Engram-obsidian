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
};

export default fr;
