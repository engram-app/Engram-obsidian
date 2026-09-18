<div align="center">

# Engram Vault Sync

![Engram Vault Sync: Deine Notizen sind das Gedächtnis deiner KI, überall synchronisiert, von der KI gelesen und geschrieben](../../assets/vault-banner.gif)

**Synchronisiere deinen Vault auf allen Geräten und lass jede KI darin lesen und schreiben.** Deine Notizen werden zu einem Gedächtnis, das deine KI durchsuchen, zitieren und weiterdenken kann.

**[Kostenlos starten auf engram.page →](https://engram.page)** · Ohne Kreditkarte, in wenigen Minuten einsatzbereit.

[Einrichtung](#einrichtung) · [KI verbinden](#ki-verbinden) · [API](https://engram.page/docs/api) · [Handbuch](../user-guide.md) · [Selbst hosten](https://engram.page/docs/self-host/) · [Discord](https://discord.gg/NKWcU2mm7N)

[English](../../README.md) · [简体中文](README.zh-CN.md) · [繁體中文](README.zh-TW.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · **Deutsch** · [Français](README.fr.md) · [Español](README.es.md) · [Português](README.pt-BR.md) · [Русский](README.ru.md) · [Italiano](README.it.md)

<a href="https://www.youtube.com/watch?v=rwnPeZ-8Lqo"><img src="../../assets/setup-video.jpg" alt="Video zur Einrichtung: Obsidian mit jeder KI verbinden" width="640"></a>

</div>

> Die Oberfläche des Plugins ist derzeit nur auf Englisch verfügbar. Dass dieses Dokument übersetzt ist, bedeutet nicht, dass die Software selbst lokalisiert wäre.

## Was du bekommst

- **Deine KI arbeitet *in* deinem Vault.** Verbinde Claude, Cursor oder ChatGPT über [MCP](#ki-verbinden). Sie liest deine Notizen als Kontext und schreibt neue zurück:
- **Deine Notizen auf jedem Gerät.** Schreib am Laptop, es ist auf dem Handy, und auch die Änderungen deiner KI kommen an.
- **Finde alles, nach Bedeutung oder nach genauem Wortlaut.** Klick auf das Suchsymbol und wähl einen Modus: *Semantisch* führt von *„unsere Richtlinie zu Rückerstattungen“* zu **„Leitfaden Kundensupport“**, selbst wenn das Wort „Richtlinie“ in der Notiz nie vorkommt. *Stichwort* trifft exakte Begriffe lokal (funktioniert offline, verbraucht kein Kontingent). *Hybrid* verbindet beides.
- **Dein Vault ist programmierbar.** Eine vollständige [REST- und WebSocket-API](https://engram.page/docs/api) umfasst jede Notiz: automatisieren, integrieren oder eigene Anwendungen auf deinem Wissen aufbauen.

```text
Du       Fass zusammen, was wir über den Kunden Henderson wissen.

Claude   🔎  Vault durchsucht ·  4 Notizen gefunden
         Die Verlängerung steht an, im zweiten Quartal wurden Lücken
         beim Onboarding gemeldet, und es gab eine Anfrage zum
         Analyse-Add-on.

Du       Erstell eine Notiz mit Fokus auf die Risiken der Verlängerung.

Claude   📝  „Henderson: Risiken der Verlängerung“ erstellt  ✓
         Mit den vier Quellnotizen verknüpft.
```

<video src="../../assets/showcase-file-creation.webm" width="800" autoplay loop muted playsinline></video>

Nichts wird jemals stillschweigend überschrieben. Offline vorgenommene Änderungen werden synchronisiert, sobald du wieder verbunden bist. Deine Notizen gehen ausschließlich an Engram, nie an Dritte, und es wird nichts getrackt.

## Einrichtung

**1. Besorg dir ein Engram-Konto.** Gehostet auf **[engram.page](https://engram.page)** (kostenlose Stufe, nichts zu installieren), oder hoste das [quelloffen verfügbare Backend](https://github.com/engram-app/engram) selbst, damit deine Notizen deine eigene Hardware nie verlassen.

**2. Verbinde dich.** Öffne *Settings → Engram Vault Sync*. **Gehostet:** klick im Tab Cloud auf **Sign in**. **Selbst gehostet:** trag im Tab Self-hosted die Adresse deines Servers und den Schlüssel ein. In beiden Fällen führt dich das Plugin durch die erste Synchronisierung; bis zu deiner Bestätigung wird nichts gesendet.

Danach läuft die Synchronisierung einfach mit, während du arbeitest.

**Lieber ansehen?** Das [Video zur Einrichtung](https://www.youtube.com/watch?v=rwnPeZ-8Lqo) zeigt beide Schritte von Anfang bis Ende.

## KI verbinden

Engram spricht **MCP (Model Context Protocol)**, den offenen Standard, über den Claude, Cursor, ChatGPT und andere Anwendungen externe Werkzeuge erreichen. Einmal eingerichtet, kann deine KI direkt in deinem eigenen Vault Notizen durchsuchen, neue schreiben und bestehende aktualisieren.

Richte deinen Client auf den Engram-MCP-Server (`https://mcp.engram.page` im gehosteten Dienst). Schritt-für-Schritt-Anleitungen für jede Anwendung stehen in der **[Integrationsdokumentation](https://engram.page/docs/integrations)**.

<video src="../../assets/showcase-mcp.webm" width="800" autoplay loop muted playsinline></video>

## Datenschutz

- **Netzwerkzugriff und Konten.** Das Plugin spricht ausschließlich mit deinem Engram-Server, mit nichts anderem, ohne Zwischenstationen. Du verbindest dich per OAuth-Anmeldung mit deinem Engram-Konto, was in jedem Tarif funktioniert. API-Schlüssel werden ebenfalls unterstützt, setzen in Engram Cloud aber den Pro-Tarif voraus; selbst gehostete Server haben diese Grenze nicht.
- **Keine Telemetrie.** Die optionale Fernprotokollierung (standardmäßig aus) sendet nur Fehler- und Lebenszyklusereignisse an deinen eigenen Server.
- **Datenschutz im gehosteten Dienst.** Siehe [engram.page/privacy](https://engram.page/privacy). Bezahlte Stufen erhöhen die Grenzen für Speicher und Suche; Selbsthosten ist kostenlos.

## Mehr

- **[KI verbinden](https://engram.page/docs/integrations)**: MCP-Einrichtung für Claude, Cursor, ChatGPT, Windsurf und weitere.
- **[API-Referenz](https://engram.page/docs/api)**: auf der REST- und WebSocket-API aufbauen.
- **[Handbuch](../user-guide.md)**: KI-Assistenten, Konflikte, das Sync Center, Fehlersuche.
- **[Entwicklerhandbuch](../../DEV.md)**: aus dem Quellcode bauen, Architektur, Releases.
- **Etwas kaputt?** [Eröffne ein Issue](https://github.com/engram-app/Engram-obsidian/issues).
- **Komm in die Community.** Sprich mit Nutzern und Entwicklern auf [Discord](https://discord.gg/NKWcU2mm7N).
- **Gefällt es dir?** Unterstütze die Entwicklung über [GitHub Sponsors](https://github.com/sponsors/engram-app) oder [Ko-fi](https://ko-fi.com/engrams_sync). Freiwillig und sehr willkommen.

## Lizenz

[MIT](../../LICENSE)
