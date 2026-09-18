<div align="center">

# Engram Vault Sync

![Engram Vault Sync: suas notas são a memória da sua IA, sincronizadas em todo lugar, lidas e escritas pela sua IA](../../assets/vault-banner.gif)

**Sincronize seu cofre em todos os aparelhos e deixe qualquer IA ler e escrever nele.** Suas notas se tornam uma memória que a sua IA pode pesquisar, citar e desenvolver.

**[Comece de graça em engram.page →](https://engram.page)** · Sem cartão de crédito, pronto em minutos.

[Instalação](#instalação) · [Conecte sua IA](#conecte-sua-ia) · [API](https://engram.page/docs/api) · [Guia do usuário](../user-guide.md) · [Hospedar por conta própria](https://engram.page/docs/self-host/) · [Discord](https://discord.gg/NKWcU2mm7N)

[English](../../README.md) · [简体中文](README.zh-CN.md) · [繁體中文](README.zh-TW.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Deutsch](README.de.md) · [Français](README.fr.md) · [Español](README.es.md) · **Português** · [Русский](README.ru.md) · [Italiano](README.it.md)

<a href="https://www.youtube.com/watch?v=rwnPeZ-8Lqo"><img src="../../assets/setup-video.jpg" alt="Vídeo de instalação: conectar o Obsidian a qualquer IA" width="640"></a>

</div>

> A interface do plugin está por enquanto só em inglês. O fato de este documento estar traduzido não significa que o programa em si esteja localizado.

## O que você ganha

- **Sua IA trabalha *dentro* do seu cofre.** Conecte Claude, Cursor ou ChatGPT por [MCP](#conecte-sua-ia). Ela lê suas notas como contexto e escreve notas novas de volta:
- **Suas notas em todo aparelho.** Você escreve no notebook, está no celular, e as alterações feitas pela sua IA também chegam.
- **Encontre qualquer coisa, por sentido ou pela palavra exata.** Clique no ícone de busca e escolha um modo: a busca *semântica* leva de *"nossa política de reembolso"* até **"Manual de atendimento ao cliente"**, mesmo que a nota nunca escreva a palavra "política". A busca por *palavra-chave* faz correspondência exata localmente (funciona sem internet e não consome cota). A *híbrida* combina as duas.
- **Seu cofre é programável.** Uma [API REST e WebSocket](https://engram.page/docs/api) completa cobre cada nota: automatize, integre ou construa aplicações sobre o seu próprio conhecimento.

```text
Você     Junte o que sabemos sobre a conta Henderson.

Claude   🔎  cofre pesquisado ·  4 notas encontradas
         Estão em fase de renovação, apontaram falhas na implantação
         no segundo trimestre e perguntaram sobre o módulo de análise.

Você     Crie uma nota focada nos riscos da renovação.

Claude   📝  criada "Henderson: riscos da renovação"  ✓
         Vinculada às quatro notas de origem.
```

<video src="../../assets/showcase-file-creation.webm" width="800" autoplay loop muted playsinline></video>

Nada é sobrescrito em silêncio. As edições feitas sem conexão sincronizam quando você volta. Suas notas vão só para o Engram, nunca para terceiros, e não há rastreamento.

## Instalação

**1. Crie uma conta no Engram.** Hospedada em **[engram.page](https://engram.page)** (plano gratuito, nada para instalar), ou hospede por conta própria o [backend de código disponível](https://github.com/engram-app/engram) para que suas notas nunca saiam do seu equipamento.

**2. Conecte.** Abra *Settings → Engram Vault Sync*. **Hospedado:** clique em **Sign in** na aba Cloud. **Por conta própria:** informe o endereço do seu servidor e a chave na aba Self-hosted. Nos dois casos o plugin conduz a primeira sincronização; nada é enviado antes da sua confirmação.

Depois disso, a sincronização acontece sozinha enquanto você trabalha.

**Prefere assistir?** O [vídeo de instalação](https://www.youtube.com/watch?v=rwnPeZ-8Lqo) mostra os dois passos do começo ao fim.

## Conecte sua IA

O Engram fala **MCP (Model Context Protocol)**, o padrão aberto que Claude, Cursor, ChatGPT e outros aplicativos usam para alcançar ferramentas externas. Conectada uma vez, sua IA pode pesquisar suas notas, escrever notas novas e atualizar as que já existem, direto no seu próprio cofre.

Aponte seu cliente para o servidor MCP do Engram (`https://mcp.engram.page` no serviço hospedado). Os guias passo a passo de cada aplicativo estão na **[documentação de integrações](https://engram.page/docs/integrations)**.

<video src="../../assets/showcase-mcp.webm" width="800" autoplay loop muted playsinline></video>

## Privacidade

- **Uso de rede e contas.** O plugin conversa apenas com o seu servidor Engram, com mais nada, sem intermediários. Você se conecta à sua conta Engram por login OAuth, o que funciona em todos os planos. Chaves de API também são aceitas, mas no Engram Cloud exigem o plano Pro; servidores hospedados por você não têm esse limite.
- **Sem telemetria.** O registro remoto opcional (desligado por padrão) envia apenas eventos de erro e de ciclo de vida, e só para o seu servidor.
- **Privacidade do serviço hospedado.** Veja [engram.page/privacy](https://engram.page/privacy). Os planos pagos aumentam os limites de armazenamento e de busca; hospedar por conta própria é gratuito.

## Mais

- **[Conecte sua IA](https://engram.page/docs/integrations)**: configuração de MCP para Claude, Cursor, ChatGPT, Windsurf e outros.
- **[Referência da API](https://engram.page/docs/api)**: construa sobre a API REST e WebSocket.
- **[Guia do usuário](../user-guide.md)**: assistentes de IA, conflitos, o Sync Center, solução de problemas.
- **[Guia do desenvolvedor](../../DEV.md)**: compilar do código-fonte, arquitetura, lançamentos.
- **Algo errado?** [Abra uma issue](https://github.com/engram-app/Engram-obsidian/issues).
- **Entre na comunidade.** Converse com usuários e desenvolvedores no [Discord](https://discord.gg/NKWcU2mm7N).
- **Gostou?** Apoie o desenvolvimento pelo [GitHub Sponsors](https://github.com/sponsors/engram-app) ou pelo [Ko-fi](https://ko-fi.com/engrams_sync). É opcional e muito bem-vindo.

## Licença

[MIT](../../LICENSE)
