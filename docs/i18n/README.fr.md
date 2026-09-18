<div align="center">

# Engram Vault Sync

![Engram Vault Sync : vos notes sont la mémoire de votre IA, synchronisées partout, lues et écrites par votre IA](../../assets/vault-banner.gif)

**Synchronisez votre coffre sur tous vos appareils et laissez n'importe quelle IA y lire et y écrire.** Vos notes deviennent une mémoire que votre IA peut chercher, citer et prolonger.

**[Commencer gratuitement sur engram.page →](https://engram.page)** · Sans carte bancaire, prêt en quelques minutes.

[Installation](#installation) · [Connecter votre IA](#connecter-votre-ia) · [API](https://engram.page/docs/api) · [Guide d'utilisation](../user-guide.md) · [Auto-hébergement](https://engram.page/docs/self-host/) · [Discord](https://discord.gg/NKWcU2mm7N)

[English](../../README.md) · [简体中文](README.zh-CN.md) · [繁體中文](README.zh-TW.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Deutsch](README.de.md) · **Français** · [Español](README.es.md) · [Português](README.pt-BR.md) · [Русский](README.ru.md) · [Italiano](README.it.md)

<a href="https://www.youtube.com/watch?v=rwnPeZ-8Lqo"><img src="../../assets/setup-video.jpg" alt="Vidéo d'installation : connecter Obsidian à n'importe quelle IA" width="640"></a>

</div>

> L'interface du plugin n'existe pour l'instant qu'en anglais. Le fait que ce document soit traduit ne signifie pas que le logiciel lui-même est localisé.

## Ce que vous obtenez

- **Votre IA travaille *dans* votre coffre.** Connectez Claude, Cursor ou ChatGPT via [MCP](#connecter-votre-ia). Elle lit vos notes comme contexte et en écrit de nouvelles :
- **Vos notes sur chaque appareil.** Écrivez sur votre ordinateur, c'est sur votre téléphone, et les modifications faites par votre IA arrivent aussi.
- **Trouvez tout, par le sens ou au mot exact.** Cliquez sur l'icône de recherche et choisissez un mode : *Sémantique* mène de *« notre politique de remboursement »* vers **« Guide du support client »**, même si la note n'écrit jamais le mot « politique ». *Mot-clé* fait une correspondance exacte en local (fonctionne hors ligne, sans consommer de quota). *Hybride* combine les deux.
- **Votre coffre est programmable.** Une [API REST et WebSocket](https://engram.page/docs/api) complète couvre chaque note : automatisez, intégrez, ou construisez des applications sur votre propre savoir.

```text
Vous     Rassemble ce que nous savons sur le compte Henderson.

Claude   🔎  coffre exploré ·  4 notes trouvées
         Le renouvellement approche, des lacunes de mise en route
         ont été signalées au deuxième trimestre, et le module
         d'analyse a fait l'objet d'une demande.

Vous     Crée une note centrée sur les risques du renouvellement.

Claude   📝  « Henderson : risques du renouvellement » créée  ✓
         Liée aux quatre notes sources.
```

<video src="../../assets/showcase-file-creation.webm" width="800" autoplay loop muted playsinline></video>

Rien n'est jamais écrasé en silence. Les modifications faites hors ligne se synchronisent à la reconnexion. Vos notes ne vont qu'à Engram, jamais à un tiers, et rien n'est pisté.

## Installation

**1. Créez un compte Engram.** Hébergé sur **[engram.page](https://engram.page)** (offre gratuite, rien à installer), ou hébergez vous-même le [backend à sources ouvertes](https://github.com/engram-app/engram) pour que vos notes ne quittent jamais votre matériel.

**2. Connectez-vous.** Ouvrez *Settings → Engram Vault Sync*. **Hébergé :** cliquez sur **Sign in** dans l'onglet Cloud. **Auto-hébergé :** indiquez l'adresse de votre serveur et votre clé dans l'onglet Self-hosted. Dans les deux cas le plugin vous accompagne pour la première synchronisation ; rien n'est envoyé avant votre confirmation.

Ensuite, la synchronisation se fait simplement au fil de votre travail.

**Vous préférez regarder ?** La [vidéo d'installation](https://www.youtube.com/watch?v=rwnPeZ-8Lqo) couvre les deux étapes de bout en bout.

## Connecter votre IA

Engram parle **MCP (Model Context Protocol)**, le standard ouvert par lequel Claude, Cursor, ChatGPT et d'autres applications atteignent des outils externes. Une fois branchée, votre IA peut chercher vos notes, en écrire de nouvelles et mettre à jour les existantes, directement dans votre propre coffre.

Pointez votre client vers le serveur MCP d'Engram (`https://mcp.engram.page` sur le service hébergé). Les guides pas à pas pour chaque application sont dans la **[documentation d'intégration](https://engram.page/docs/integrations)**.

<video src="../../assets/showcase-mcp.webm" width="800" autoplay loop muted playsinline></video>

## Confidentialité

- **Accès réseau et comptes.** Le plugin ne parle qu'à votre serveur Engram, à rien d'autre, sans intermédiaire. Vous vous connectez à votre compte Engram par OAuth, ce qui fonctionne sur toutes les offres. Les clés d'API sont également prises en charge, mais sur Engram Cloud elles demandent l'offre Pro ; les serveurs auto-hébergés n'ont pas cette limite.
- **Aucune télémétrie.** La journalisation distante, facultative et désactivée par défaut, n'envoie que des évènements d'erreur et de cycle de vie, à votre propre serveur.
- **Confidentialité du service hébergé.** Voir [engram.page/privacy](https://engram.page/privacy). Les offres payantes augmentent les limites de stockage et de recherche ; l'auto-hébergement est gratuit.

## Pour aller plus loin

- **[Connecter votre IA](https://engram.page/docs/integrations)** : configuration MCP pour Claude, Cursor, ChatGPT, Windsurf et d'autres.
- **[Référence de l'API](https://engram.page/docs/api)** : bâtir sur l'API REST et WebSocket.
- **[Guide d'utilisation](../user-guide.md)** : assistants IA, conflits, le Sync Center, dépannage.
- **[Guide du développeur](../../DEV.md)** : compiler depuis les sources, architecture, versions.
- **Un problème ?** [Ouvrez un ticket](https://github.com/engram-app/Engram-obsidian/issues).
- **Rejoignez la communauté.** Échangez avec les utilisateurs et les développeurs sur [Discord](https://discord.gg/NKWcU2mm7N).
- **Ça vous plaît ?** Soutenez le développement via [GitHub Sponsors](https://github.com/sponsors/engram-app) ou [Ko-fi](https://ko-fi.com/engrams_sync). Facultatif, et très apprécié.

## Licence

[MIT](../../LICENSE)
