<div align="center">

# Engram Vault Sync

![Engram Vault Sync: le tue note sono la memoria della tua IA, sincronizzate ovunque, lette e scritte dalla tua IA](assets/vault-banner.gif)

**Sincronizza il tuo archivio su ogni dispositivo e lascia che qualsiasi IA lo legga e ci scriva.** Le tue note diventano una memoria che la tua IA può cercare, citare e su cui può costruire.

**[Inizia gratis su engram.page →](https://engram.page)** · Senza carta di credito, pronto in pochi minuti.

[Installazione](#installazione) · [Collega la tua IA](#collega-la-tua-ia) · [API](https://engram.page/docs/api) · [Guida all'uso](docs/user-guide.md) · [Installazione autonoma](https://engram.page/docs/self-host/) · [Discord](https://discord.gg/NKWcU2mm7N)

[English](README.md) · [简体中文](README.zh-CN.md) · [繁體中文](README.zh-TW.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Deutsch](README.de.md) · [Français](README.fr.md) · [Español](README.es.md) · [Português](README.pt-BR.md) · [Русский](README.ru.md) · **Italiano**

<a href="https://www.youtube.com/watch?v=rwnPeZ-8Lqo"><img src="assets/setup-video.jpg" alt="Video sull'installazione: collegare Obsidian a qualsiasi IA" width="640"></a>

</div>

> L'interfaccia del plugin per ora è solo in inglese. Il fatto che questo documento sia tradotto non significa che il programma stesso sia localizzato.

## Cosa ottieni

- **La tua IA lavora *dentro* il tuo archivio.** Collega Claude, Cursor o ChatGPT tramite [MCP](#collega-la-tua-ia). Legge le tue note come contesto e ne scrive di nuove:
- **Le tue note su ogni dispositivo.** Scrivi sul portatile ed è sul telefono, e arrivano anche le modifiche fatte dalla tua IA.
- **Trova qualsiasi cosa, per significato o alla parola esatta.** Premi l'icona di ricerca e scegli una modalità: la ricerca *semantica* porta da *«la nostra politica sui rimborsi»* a **«Manuale dell'assistenza clienti»**, anche se nella nota la parola «politica» non compare mai. Quella per *parola chiave* trova corrispondenze esatte in locale (funziona offline e non consuma quota). Quella *ibrida* unisce le due.
- **Il tuo archivio è programmabile.** Una [API REST e WebSocket](https://engram.page/docs/api) completa copre ogni nota: automatizza, integra o costruisci applicazioni sulla tua stessa conoscenza.

```text
Tu       Raccogli quello che sappiamo sul cliente Henderson.

Claude   🔎  archivio consultato ·  trovate 4 note
         Sono in fase di rinnovo, nel secondo trimestre hanno segnalato
         lacune nell'avvio e hanno chiesto del modulo di analisi.

Tu       Crea una nota concentrata sui rischi del rinnovo.

Claude   📝  creata «Henderson: rischi del rinnovo»  ✓
         Collegata alle quattro note di origine.
```

<video src="assets/showcase-file-creation.webm" width="800" autoplay loop muted playsinline></video>

Niente viene mai sovrascritto in silenzio. Le modifiche fatte offline si sincronizzano quando torni in rete. Le tue note vanno solo a Engram, mai a terzi, e non c'è alcun tracciamento.

## Installazione

**1. Procurati un account Engram.** Ospitato su **[engram.page](https://engram.page)** (piano gratuito, nulla da installare), oppure installa da solo il [backend a codice disponibile](https://github.com/engram-app/engram) così che le tue note non lascino mai il tuo hardware.

**2. Collegati.** Apri *Settings → Engram Vault Sync*. **Ospitato:** premi **Sign in** nella scheda Cloud. **Installazione autonoma:** inserisci l'indirizzo del tuo server e la chiave nella scheda Self-hosted. In entrambi i casi il plugin ti accompagna nella prima sincronizzazione; nulla viene inviato prima della tua conferma.

Da lì in poi la sincronizzazione va da sé, mentre lavori.

**Preferisci guardare?** Il [video sull'installazione](https://www.youtube.com/watch?v=rwnPeZ-8Lqo) copre entrambi i passaggi dall'inizio alla fine.

## Collega la tua IA

Engram parla **MCP (Model Context Protocol)**, lo standard aperto con cui Claude, Cursor, ChatGPT e altre applicazioni raggiungono strumenti esterni. Una volta collegata, la tua IA può cercare le tue note, scriverne di nuove e aggiornare quelle esistenti, direttamente nel tuo archivio.

Punta il tuo client al server MCP di Engram (`https://mcp.engram.page` nel servizio ospitato). Le guide passo a passo per ogni applicazione sono nella **[documentazione sulle integrazioni](https://engram.page/docs/integrations)**.

<video src="assets/showcase-mcp.webm" width="800" autoplay loop muted playsinline></video>

## Privacy

- **Uso della rete e account.** Il plugin comunica solo con il tuo server Engram, con nient'altro, senza intermediari. Ti colleghi al tuo account Engram con l'accesso OAuth, che funziona su ogni piano. Sono supportate anche le chiavi API, ma su Engram Cloud richiedono il piano Pro; i server installati da te non hanno questo limite.
- **Nessuna telemetria.** La registrazione remota opzionale (disattivata per impostazione predefinita) invia solo eventi di errore e di ciclo di vita, e solo al tuo server.
- **Privacy del servizio ospitato.** Vedi [engram.page/privacy](https://engram.page/privacy). I piani a pagamento alzano i limiti di spazio e di ricerca; l'installazione autonoma è gratuita.

## Altro

- **[Collega la tua IA](https://engram.page/docs/integrations)**: configurazione MCP per Claude, Cursor, ChatGPT, Windsurf e altri.
- **[Riferimento API](https://engram.page/docs/api)**: costruisci sulla API REST e WebSocket.
- **[Guida all'uso](docs/user-guide.md)**: assistenti IA, conflitti, il Sync Center, risoluzione dei problemi.
- **[Guida per sviluppatori](DEV.md)**: compilare dai sorgenti, architettura, rilasci.
- **Qualcosa non va?** [Apri una segnalazione](https://github.com/engram-app/Engram-obsidian/issues).
- **Entra nella comunità.** Parla con utenti e sviluppatori su [Discord](https://discord.gg/NKWcU2mm7N).
- **Ti piace?** Sostieni lo sviluppo con [GitHub Sponsors](https://github.com/sponsors/engram-app) o [Ko-fi](https://ko-fi.com/engrams_sync). È facoltativo, ed è molto gradito.

## Licenza

[MIT](LICENSE)
