import type { Dict } from "..";

// Português (do Brasil)
//
// Registered under `pt`, so Obsidian's `pt-BR` reaches it through the
// base-language fallback and `pt` speakers are not left on English.
const pt: Dict = {
	"Code copied!": "Código copiado.",
	"Engram sync: syncing...": "Engram Sync: sincronizando…",
	"Engram Sync: pulled {pulled}, pushed {pushed}":
		"Engram Sync: {pulled} baixados, {pushed} enviados",
	"Engram: disconnected. Open Engram settings to reconnect.":
		"Engram: desconectado. Abra Engram settings para reconectar.",
	"Engram sync: checking...": "Engram Sync: verificando…",
	"Engram sync: everything in sync": "Engram Sync: tudo sincronizado",
	"Engram sync: pulling all from server...": "Engram Sync: baixando tudo do servidor…",
	"Engram Sync: pushed {pushed}": "Engram Sync: {pushed} enviados",
	"Engram sync: sync failed": "Engram Sync: a sincronização falhou",
	"Engram: your login expired — open Engram settings to reconnect.":
		"Engram: sua sessão expirou. Abra Engram settings para reconectar.",
	"Engram: This vault has been deleted on the server.":
		"Engram: este cofre foi excluído no servidor.",
	"Engram Sync: pulled {pulled} (local extras deleted)":
		"Engram Sync: {pulled} baixados (arquivos locais sobrando foram excluídos)",
	"Engram Sync: pulled {pulled}": "Engram Sync: {pulled} baixados",
	"Engram Sync: replaced remote with local ({pushed} uploaded)":
		"Engram Sync: o servidor foi substituído pela versão local ({pushed} enviados)",
	"Engram: sync failed. Open the sync log for details.":
		"Engram: a sincronização falhou. Os detalhes estão no registro de sincronização.",
	"Engram unreachable. Showing matches from this device only.":
		"Não foi possível alcançar o Engram. Mostrando apenas resultados deste aparelho.",
	"No source path for this result": "Este resultado não tem caminho de origem",
	"Note not synced locally": "Esta nota ainda não foi sincronizada neste aparelho",
	"Engram: settings tab failed to render ({error})":
		"Engram: não foi possível exibir a aba de configurações ({error})",
	"File not found locally: {path}": "Arquivo não encontrado localmente: {path}",
	"Restored {path} — will sync on next push.":
		"{path} restaurado, será sincronizado no próximo envio.",
	"Ignored {path} — won't sync until restored from Sync Center.":
		"{path} ignorado, não será sincronizado até você restaurá-lo no Sync Center.",
	"Added {pattern} to ignore patterns": "{pattern} adicionado aos padrões ignorados",
	"Engram backend changed — sign in again to continue.":
		"O servidor do Engram mudou. Entre novamente para continuar.",
	"Engram: sign-in failed ({error})": "Engram: não foi possível entrar ({error})",
	"Enter an API key first": "Informe primeiro uma chave de API",
	"Switched to {mode}.": "Alterado para {mode}.",

	"Engram Sync: pushed {count} files": {
		one: "Engram Sync: {count} arquivo enviado",
		other: "Engram Sync: {count} arquivos enviados",
	},
	"Engram Sync: pulled {count} files from server": {
		one: "Engram Sync: {count} arquivo baixado do servidor",
		other: "Engram Sync: {count} arquivos baixados do servidor",
	},
	"Engram Sync: pulled {count} changes": {
		one: "Engram Sync: {count} alteração baixada",
		other: "Engram Sync: {count} alterações baixadas",
	},
	"Engram: {count} files failed to sync{detail} — open Sync Center": {
		one: "Engram: {count} arquivo não sincronizou{detail}. Abra o Sync Center",
		other: "Engram: {count} arquivos não sincronizaram{detail}. Abra o Sync Center",
	},
	"Engram: {count} attachments skipped — upgrade to sync images & PDFs.": {
		one: "Engram: {count} anexo ignorado. Melhore seu plano para sincronizar imagens e PDFs.",
		other: "Engram: {count} anexos ignorados. Melhore seu plano para sincronizar imagens e PDFs.",
	},
	"Engram: plan upgraded — syncing {count} attachments…": {
		one: "Engram: plano melhorado, sincronizando {count} anexo…",
		other: "Engram: plano melhorado, sincronizando {count} anexos…",
	},
	// 402 limit reasons (limit-copy.ts). These gate payment, so they are the
	// highest-value strings in the plugin to get right.
	"Note limit reached. Upgrade to keep adding notes.":
		"Você chegou ao limite de notas. Melhore seu plano para continuar adicionando.",
	"Vault limit reached. Upgrade for more vaults.":
		"Você chegou ao limite de cofres. Melhore seu plano para ter mais.",
	"This file type isn't accepted by this server.":
		"Este servidor não aceita esse tipo de arquivo.",
	"Attachment sync is disabled for this account.":
		"Esta conta está com a sincronização de anexos desligada.",
	"Attachment storage is full — upgrade for more.":
		"O armazenamento de anexos está cheio. Melhore seu plano para ter mais.",
	"File too large for your plan.": "O arquivo é grande demais para o seu plano.",
	"Already signed in on another device. Upgrade for multi-device.":
		"Você já entrou em outro aparelho. Melhore seu plano para usar vários.",
	"Device swap cooldown active. Wait or upgrade.":
		"A troca de aparelho está em espera. Aguarde um pouco ou melhore seu plano.",
	"Too many connected Obsidian vaults. Disconnect one or upgrade.":
		"Há cofres do Obsidian demais conectados. Desconecte um ou melhore seu plano.",
	"Too many connected AI clients. Disconnect one or upgrade.":
		"Há clientes de IA demais conectados. Desconecte um ou melhore seu plano.",
	"Daily AI search limit reached. Free includes 20 per day across Obsidian, the web app and MCP. Upgrade for unlimited.":
		"Você chegou ao limite diário de buscas com IA. O plano gratuito inclui 20 por dia somando Obsidian, o app web e o MCP. Melhore seu plano para não ter limite.",
	"API keys need Pro. Sign in with your Engram account instead.":
		"Chaves de API exigem o plano Pro. Entre com sua conta Engram em vez disso.",
	"Account suspended. Contact support.": "Conta suspensa. Fale com o suporte.",
	"Account setup incomplete.": "A configuração da conta está incompleta.",
	"This account was deleted. Contact support if that is wrong.":
		"Esta conta foi excluída. Se isso estiver errado, fale com o suporte.",
	"Finish setting up your account at app.engram.page to start syncing.":
		"Termine de configurar sua conta em app.engram.page para começar a sincronizar.",
	"Limit reached. Upgrade to continue.":
		"Você chegou ao limite. Melhore seu plano para continuar.",
	// UI strings
	"Link Obsidian to Engram": "Conectar o Obsidian ao Engram",
	"Failed to start device flow. Check your Engram URL and try again.":
		"Não foi possível iniciar a vinculação do aparelho. Confira o endereço do seu Engram e tente de novo.",
	"Your code:": "Seu código:",
	"A browser window has opened. Sign in and enter this code to link your vault.":
		"Uma janela do navegador foi aberta. Entre e informe este código para vincular seu cofre.",
	Cancel: "Cancelar",
	"Code expired. Please try again.": "O código expirou. Tente de novo.",
	"Try again": "Tentar de novo",
	Close: "Fechar",
	"Note couldn't be processed": "Não foi possível processar esta nota",
	"The server couldn't process this note. Check its contents, then edit and save to try again.":
		"O servidor não conseguiu processar esta nota. Confira o conteúdo, edite e salve para tentar de novo.",
	"Attachments need a paid plan": "Anexos exigem um plano pago",
	"The Free tier syncs notes only. Upgrade to sync images and PDFs.":
		"O plano gratuito sincroniza apenas notas. Melhore seu plano para sincronizar imagens e PDFs.",
	"Attachment storage full": "Armazenamento de anexos cheio",
	"You've used all the attachment storage on your plan. Upgrade for more.":
		"Você usou todo o armazenamento de anexos do seu plano. Melhore-o para ter mais.",
	"Too large for the server": "Grande demais para o servidor",
	"The server limit is 5 MB. Compress or split the file, then it will sync.":
		"O limite do servidor é 5 MB. Compacte ou divida o arquivo e ele sincroniza.",
	"Sign-in expired": "Sessão expirada",
	"Reconnect your account to resume syncing.":
		"Reconecte sua conta para retomar a sincronização.",
	"Unresolved conflict": "Conflito não resolvido",
	"Open the file to resolve the conflict, then sync again.":
		"Abra o arquivo, resolva o conflito e sincronize de novo.",
	"Frontmatter needs a fix": "O frontmatter precisa de um ajuste",
	"The note synced, but its frontmatter could not be fully parsed. Open it to fix the highlighted line.":
		"A nota sincronizou, mas o frontmatter não pôde ser lido por completo. Abra e corrija a linha destacada.",
	"Server error": "Erro do servidor",
	"A temporary server problem — retrying automatically.":
		"Um problema temporário do servidor; tentando de novo automaticamente.",
	"Network unavailable": "Sem rede",
	"Can't reach the server — retrying automatically.":
		"Não foi possível alcançar o servidor; tentando de novo automaticamente.",
	"Sync failed": "A sincronização falhou",
	"An unexpected error — retrying automatically.":
		"Um erro inesperado; tentando de novo automaticamente.",
	Upgrade: "Melhorar plano",
	"Update in settings": "Atualizar nas configurações",
	"Engram: ready": "Engram: pronto",
	"Resume sync": "Retomar a sincronização",
	"Engram Vault Sync {version} is available. {link}.":
		"O Engram Vault Sync {version} já saiu. {link}.",
	"Search your vault…": "Busque no seu cofre…",
	"Filter by folder…": "Filtrar por pasta…",
	"Filter by tags…": "Filtrar por tags…",
	"Search failed — check connection": "A busca falhou; confira a conexão",
	"No results found": "Nenhum resultado",
	"match strength: {pct}%": "Correspondência: {pct}%",
	"Open sync setup": "Abrir a configuração de sincronização",
	"Last sync: {when}": "Última sincronização: {when}",
	"waiting for a connection": "esperando conexão",
	"sync is paused": "a sincronização está pausada",
	"syncing now": "sincronizando agora",
	"waiting to retry": "esperando para tentar de novo",
	"{count} not on your plan": "{count} fora do seu plano",
	"{count} retrying": "{count} tentando de novo",
	"{count} ignored": "{count} ignorados",
	"{count} queued — {reason}": "{count} na fila, {reason}",
	"These files are fine. They just need a paid plan to sync.":
		"Estes arquivos estão bem. Só precisam de um plano pago para sincronizar.",
	"Show files ({count}) ▾": "Mostrar arquivos ({count}) ▾",
	"Sync these now": "Sincronizar estes agora",
	"Clear all": "Limpar tudo",
	"Nothing needs your attention. 🎉": "Nada precisa da sua atenção. 🎉",
	Dismiss: "Ocultar",
	"Retry all now": "Tentar tudo de novo agora",
	"Temporary errors. These clear themselves once the server recovers.":
		"Erros temporários. Eles somem sozinhos quando o servidor volta.",
	Open: "Abrir",
	Ignore: "Ignorar",
	"No files ignored. Use the ignore button on a failure row to stop syncing it.":
		"Nenhum arquivo ignorado. Use o botão de ignorar em uma linha com erro para parar de sincronizá-lo.",
	Restore: "Restaurar",
	Clear: "Limpar",
	"No activity yet. Push or pull to see entries here.":
		"Ainda sem atividade. Envie ou baixe e as entradas aparecem aqui.",
	"Sync log": "Registro de sincronização",
	"Could not compare with the cloud. Check your connection.":
		"Não foi possível comparar com o servidor. Confira sua conexão.",
	"Your login expired. Sign in again in Engram settings to continue.":
		"Sua sessão expirou. Entre novamente em Engram settings para continuar.",
	"Couldn't create vault — the name may be invalid or already in use.":
		"Não foi possível criar o cofre: o nome pode ser inválido ou já estar em uso.",
	"Could not create the vault — check your connection and try again.":
		"Não foi possível criar o cofre; confira sua conexão e tente de novo.",
	"Free syncs notes only — {count} attachments will be skipped.": {
		one: "O plano gratuito sincroniza apenas notas; {count} anexo será ignorado.",
		other: "O plano gratuito sincroniza apenas notas; {count} anexos serão ignorados.",
	},
	"Comparing your vault with the cloud…": "Comparando seu cofre com o servidor…",
	"Change vault": "Trocar de cofre",
	"Advanced sync options": "Opções avançadas de sincronização",
	"Everything is in sync": "Tudo está sincronizado",
	" conflicts need resolution": {
		one: " conflito a resolver",
		other: " conflitos a resolver",
	},
	"Confirm destructive sync": "Confirmar uma sincronização destrutiva",
	"You are about to:": "Veja o que vai acontecer:",
	"Files that will be deleted:": "Arquivos que serão excluídos:",
	"This cannot be undone.": "Isso não pode ser desfeito.",
	Back: "Voltar",
	Confirm: "Confirmar",
	"Switch vault": "Trocar de cofre",
	"Pick a vault to sync with. We will recalculate the sync preview after you choose.":
		"Escolha o cofre para sincronizar. Depois recalculamos a prévia.",
	"Loading vaults…": "Carregando cofres…",
	"No other vaults available.": "Não há outros cofres disponíveis.",
	"Make new vault": "Criar um cofre",
	"New vault": "Novo cofre",
	"Create a new empty vault on the server, then sync this Obsidian vault into it.":
		"Criar um cofre vazio no servidor e depois sincronizar este cofre do Obsidian com ele.",
	Create: "Criar",
	"Your vault shares {percent} of its data with Engram":
		"Seu cofre compartilha {percent} dos dados com o Engram",
	"Type {keyword} to confirm:": "Digite {keyword} para confirmar:",
	"✓ {count} synced": "✓ {count} sincronizados",
	"⤳ {count} skipped (Free plan)": "⤳ {count} ignorados (plano gratuito)",
	"✕ {count} failed": "✕ {count} com erro",
	"{count} attachments need a paid plan to sync. See Sync Center.": {
		one: "{count} anexo precisa de um plano pago. Veja o Sync Center.",
		other: "{count} anexos precisam de um plano pago. Veja o Sync Center.",
	},
	"Syncing your vault": "Sincronizando seu cofre",
	"Getting started…": "Começando…",
	"Open Engram to check your vault and confirm everything synced.":
		"Abra o Engram para conferir seu cofre e confirmar que tudo sincronizou.",
	"Open Engram": "Abrir o Engram",
	"You can close this and the sync keeps running in the background.":
		"Você pode fechar isto; a sincronização continua em segundo plano.",
	"Run in background": "Deixar em segundo plano",
	"Syncing…": "Sincronizando…",
	"Sync complete": "Sincronização concluída",
	Done: "Pronto",
	"Engram: sync conflict on {path} — your local edit was saved as {copy}":
		"Engram: conflito de sincronização em {path}; sua alteração local foi salva como {copy}",
	"Open note": "Abrir a nota",
	"Engram: {count} notes have frontmatter problems. Open Sync Center to fix.":
		"Engram: o frontmatter de {count} notas está com problema. Abra o Sync Center para corrigir.",
	"New here? Watch the setup video": "Primeira vez? Assista ao vídeo de instalação",
	"What Engram does, and how to connect your vault, start to finish.":
		"O que o Engram faz e como conectar seu cofre, do começo ao fim.",
	"▶ Watch on YouTube": "▶ Assistir no YouTube",
	"1. Make an account": "1. Crie uma conta",
	"2. Connect your vault to Engram": "2. Conecte seu cofre ao Engram",
	"Open connection tab": "Abrir a aba de conexão",
	"3. Connect your AI": "3. Conecte sua IA",
	"Node.js dependencies": "Dependências do Node.js",
	"Python virtual environment": "Ambiente virtual do Python",
	"Python bytecode cache": "Cache de bytecode do Python",
	"Vendored dependencies": "Dependências embutidas",
	"Gradle build cache": "Cache de build do Gradle",
	"Rust/Java build output": "Saída de build do Rust/Java",
	"Build output": "Saída de build",
	"Next.js build output": "Saída de build do Next.js",
	"Distribution build output": "Saída de build para distribuição",
	"Cargo cache": "Cache do Cargo",
	"CocoaPods dependencies": "Dependências do CocoaPods",
	"Dart tool cache": "Cache de ferramentas do Dart",
	"Generic cache directory": "Diretório de cache genérico",
	"Ignore patterns": "Padrões ignorados",
	"Custom patterns": "Padrões próprios",
	Diagnostics: "Diagnóstico",
	"Diagnostics detail": "Detalhes do diagnóstico",
	About: "Sobre",
	"License: {name}": "Licença: {name}",
	"⚠ Detected: {label}/ ({formatted} files)": "⚠ Detectado: {label}/ ({formatted} arquivos)",
	"{desc} — should not be synced": "{desc}; não deveria sincronizar",
	"Add to ignores": "Adicionar aos ignorados",
	"Version: {version}": "Versão: {version}",
	"Source: {link}": "Código: {link}",
	"Engram URL": "Endereço do Engram",
	"✓ Engram server reachable (v{version})": "✓ Servidor Engram acessível (v{version})",
	"✗ server responded but isn't an Engram backend":
		"✗ O servidor respondeu, mas não é um backend Engram",
	"✗ couldn't reach a server at this URL":
		"✗ Não foi possível alcançar um servidor neste endereço",
	"Checking server…": "Verificando o servidor…",
	Authentication: "Autenticação",
	"Authenticated via Engram account (OAuth).": "Autenticado pela sua conta Engram (OAuth).",
	"Manage account": "Gerenciar a conta",
	"Sign out": "Sair",
	"Using API key": "Usando chave de API",
	"Authenticated via manual API key.": "Autenticado por uma chave de API informada à mão.",
	"Clear key": "Apagar a chave",
	"Switch to sign in": "Mudar para entrar com a conta",
	"Sign in or create an account": "Entre ou crie uma conta",
	"Sign in": "Entrar",
	"API key": "Chave de API",
	Token: "Token",
	"Bearer token from your Engram account.": "Token Bearer da sua conta Engram.",
	Save: "Salvar",
	"That does not look like an Engram API key (expected {prefix}…).":
		"Isso não parece uma chave de API do Engram (esperado {prefix}…).",
	Vault: "Cofre",
	"Vault selection": "Escolha do cofre",
	"Select which vault this plugin syncs with.": "Escolha com qual cofre este plugin sincroniza.",
	"No vaults found — first sync will create one":
		"Nenhum cofre encontrado; a primeira sincronização cria um",
	"Pick a vault": "Escolher um cofre",
	Change: "Trocar",
	"Support development": "Apoiar o desenvolvimento",
	"GitHub Sponsors": "GitHub Sponsors",
	Backend: "Backend",
	"Where this vault syncs to. Each backend keeps its own sign-in.":
		"Para onde este cofre sincroniza. Cada backend guarda o próprio login.",
	"Run your own Engram server": "Rodar seu próprio servidor Engram",
	"Engram is the backend that powers sync and semantic search.":
		"O Engram é o backend que move a sincronização e a busca semântica.",
	"Finish sync setup": "Concluir a configuração",
	"Nothing in this vault syncs until you choose how to merge it with the server.":
		"Este cofre não sincroniza nada até você escolher como juntá-lo ao servidor.",
	"Choose sync direction": "Escolher o sentido da sincronização",
	"Engram: this plugin is too old to sync (needs {version} or newer). Update it to continue.":
		"Engram: este plugin é antigo demais para sincronizar (precisa da {version} ou mais nova). Atualize para continuar.",
	"Engram: this plugin is too old to sync. Update it to continue.":
		"Engram: este plugin é antigo demais para sincronizar. Atualize para continuar.",
	Update: "Atualizar",
	// UI strings (second pass)
	"Invalid API key": "Chave de API inválida",
	"Connection failed": "Falha de conexão",
	"Sync now": "Sincronizar agora",
	"Disconnect (clear login)": "Desconectar (apagar login)",
	"Push entire vault": "Enviar o cofre inteiro",
	"Check sync status": "Verificar o estado da sincronização",
	"Engram sync: server does not support reconciliation (update backend)":
		"Engram Sync: o servidor não sabe reconciliar (atualize o backend)",
	"Pull all from server (force overwrite)": "Baixar tudo do servidor (sobrescreve o local)",
	"Show sync log": "Ver o registro de sincronização",
	"Semantic search": "Busca semântica",
	"Open search sidebar": "Abrir o painel de busca",
	"Engram search": "Busca do Engram",
	"Open sync center": "Abrir o Sync Center",
	"Engram: this vault no longer exists on the server. Pick or create a vault to continue.":
		"Engram: este cofre já não existe no servidor. Escolha ou crie um cofre para continuar.",
	"Engram: recovered plugin settings from a backup after a corrupted save.":
		"Engram: as configurações estavam corrompidas e foram restauradas de uma cópia.",
	"Engram sync: live sync requires a plugin update — please update the Engram vault sync plugin.":
		"Engram Sync: a sincronização ao vivo precisa de uma atualização do plugin. Atualize o Engram vault sync.",
	"Engram: sync is paused — this edit was not synced. Choose a sync direction to resume.":
		"Engram: a sincronização está pausada e esta alteração não foi enviada. Escolha um sentido para retomar.",
	"Engram: not connected": "Engram: sem conexão",
	"Engram: signed out": "Engram: sessão encerrada",
	"Not connected yet. Click to open settings and link this vault.":
		"Ainda sem conexão. Toque para abrir as configurações e vincular este cofre.",
	"Not signed in. Click to open settings and reconnect.":
		"Sem login. Toque para abrir as configurações e reconectar.",
	"Engram: finish setup": "Engram: concluir a configuração",
	"Engram: sync paused": "Engram: sincronização pausada",
	"{label} ({count} queued)": "{label} ({count} na fila)",
	"Setup is not finished — nothing will sync until you choose a sync direction. Click to finish.":
		"A configuração não terminou. Nada sincroniza até você escolher um sentido. Toque para concluir.",
	"Sync paused — click to choose a sync direction":
		"Sincronização pausada; toque para escolher um sentido",
	"Engram: offline ({count} queued)": "Engram: sem rede ({count} na fila)",
	"Engram: offline": "Engram: sem rede",
	"Server unreachable — changes will sync when connected":
		"Servidor inacessível; as alterações vão quando a conexão voltar",
	"Engram: error": "Engram: erro",
	"Unknown error": "Erro desconhecido",
	"Engram: syncing ({count})": "Engram: sincronizando ({count})",
	"Engram: syncing": "Engram: sincronizando",
	"Sync in progress...": "Sincronizando…",
	"Engram: pending ({count})": "Engram: pendente ({count})",
	"{count} files queued": "{count} arquivos na fila",
	"Engram: live": "Engram: ao vivo",
	"WebSocket connected — live sync active":
		"WebSocket conectado; a sincronização ao vivo está ativa",
	"Click to sync": "Toque para sincronizar",
	Attachments: "Anexos",
	Keyword: "Palavra-chave",
	Semantic: "Semântica",
	Both: "Ambas",
	"matches your words and their other forms — 'run' finds 'running' — plus this device.":
		"Acha suas palavras e as formas delas: “correr” também acha “correndo”, e mais este aparelho.",
	"matches meaning. Finds notes that never use the words you typed.":
		"Acha por significado, inclusive notas onde suas palavras nunca aparecem.",
	"matches words and meaning together, plus this device. Widest results.":
		"Acha palavras e significado juntos, mais este aparelho. A busca mais ampla.",
	"Clear search": "Limpar a busca",
	"Search settings": "Configurações de busca",
	Untitled: "Sem título",
	"meaning + exact": "significado + exato",
	Disconnected: "Desconectado",
	"Connected — waiting for first sync decision":
		"Conectado; esperando a primeira decisão de sincronização",
	"Connected — live sync active": "Conectado; sincronização ao vivo ativa",
	"Connected — polling": "Conectado; consultando de tempo em tempo",
	"Not configured": "Não configurado",
	Refresh: "Recarregar",
	"Not synced on your plan ({count})": "Fora do seu plano ({count})",
	"Needs attention ({count})": "Precisa da sua atenção ({count})",
	"Retrying automatically ({count})": "Tentando de novo automaticamente ({count})",
	Stats: "Números",
	"Notes on this device": "Notas neste aparelho",
	"Attachments on this device": "Anexos neste aparelho",
	"Remote vault": "Cofre do servidor",
	"not linked": "não vinculado",
	"Plan usage": "Uso do plano",
	"Safe choice: combines both sides, nothing is deleted.":
		"Escolha segura: junta os dois lados e não apaga nada.",
	"Already in sync. Nothing is deleted.": "Já está sincronizado. Nada é apagado.",
	Sync: "Sincronizar",
	"Upload local files without downloading the remote":
		"Enviar os arquivos locais sem baixar do servidor",
	"Delete all on remote, then upload local files":
		"Apagar tudo no servidor e depois enviar os arquivos locais",
	"Download remote files without uploading the local":
		"Baixar os arquivos do servidor sem enviar os locais",
	"Delete all local files, then download from remote":
		"Apagar todos os arquivos locais e depois baixar do servidor",
	"Set up sync for this vault": "Configurar a sincronização deste cofre",
	"You are now pointing at a different cloud vault":
		"Agora você está apontando para outro cofre na nuvem",
	"Sync preview": "Prévia da sincronização",
	"Start syncing": "Começar a sincronizar",
	"Upload everything": "Enviar tudo",
	"Nothing will be removed from this device.": "Nada será removido deste aparelho.",
	"Download everything": "Baixar tudo",
	"Not now": "Mais tarde",
	"This vault": "Este cofre",
	"Cloud server": "Cofre do servidor",
	"Vault name": "Nome do cofre",
	"Could not load vaults": "Não foi possível carregar os cofres",
	"Enter a name for the new vault": "Dê um nome ao novo cofre",
	"Failed to switch vault": "Não foi possível trocar de cofre",
	"Finished with some errors. Open the sync log to see what failed.":
		"Terminou com alguns erros. Veja no registro de sincronização o que falhou.",
	"Synced. Some attachments need a paid plan to sync (see below).":
		"Sincronizado. Alguns anexos precisam de um plano pago (veja abaixo).",
	"All synced. Your vault and the cloud now match.":
		"Tudo sincronizado. Seu cofre e a nuvem estão iguais.",
	"Already up to date. Nothing needed syncing.":
		"Já estava em dia. Não havia nada para sincronizar.",
	Deleting: "Apagando",
	Downloading: "Baixando",
	Uploading: "Enviando",
	"Syncing attachments": "Sincronizando anexos",
	Complete: "Concluído",
	"Getting set up": "Primeiros passos",
	"setup guide": "guia de instalação",
	"Sign in (or enter your server URL and key) on the connection tab, then run your first sync.":
		"Entre na aba de conexão (ou informe o endereço do seu servidor e a chave) e rode a primeira sincronização.",
	"See the AI setup guide": "Ver o guia de configuração de IA",
	Plans: "Planos",
	Free: "Gratuito",
	"1 vault, 2 devices": "1 cofre, 2 aparelhos",
	"Real-time sync": "Sincronização em tempo real",
	"2,000 notes searchable": "2.000 notas pesquisáveis",
	"Connect any AI (MCP)": "Conecte qualquer IA (MCP)",
	Starter: "Starter",
	"10 vaults, unlimited devices": "10 cofres, aparelhos ilimitados",
	"Search all your notes": "Pesquise em todas as suas notas",
	"10 GB attachments": "10 GB de anexos",
	"Unlimited AI searches": "Buscas com IA ilimitadas",
	Pro: "Pro",
	"Unlimited vaults": "Cofres ilimitados",
	"Search across all vaults at once": "Pesquise em todos os cofres de uma vez",
	"50 GB attachments": "50 GB de anexos",
	"API access": "Acesso à API",
	"See full pricing": "Ver todos os preços",
	"Learn more": "Saber mais",
	"Errors only": "Somente erros",
	"Warnings and errors": "Avisos e erros",
	"Info (default)": "Informação (padrão)",
	"Debug (verbose)": "Depuração (detalhada)",
	"Or authenticate with a token instead of signing in.":
		"Ou autentique-se com um token em vez de entrar com a conta.",
	"If this plugin saves you time, consider supporting development.":
		"Se este plugin economiza seu tempo, pense em apoiar o desenvolvimento.",
	"Sign-in required to load vaults": "É preciso entrar para carregar os cofres",
	"Could not reach Engram — check connection":
		"Não foi possível alcançar o Engram; confira a conexão",
	// UI strings (sync error surfaces)
	"Free syncs notes only — images & PDFs need a paid plan.":
		"O plano gratuito sincroniza apenas notas: imagens e PDFs precisam de um plano pago.",
	"Pull all (delete extras) aborted: could not obtain an exclusive server snapshot (replay contention). Nothing was trashed.":
		"“Baixar tudo (apagar sobras)” cancelado: não foi possível obter um instantâneo exclusivo do servidor (conflito de reprodução). Nada foi para a lixeira.",
	"Pull all aborted: another sync is running (replay contention). Try again when it finishes.":
		"“Baixar tudo” cancelado: outra sincronização está em andamento (conflito de reprodução). Tente quando ela terminar.",
	"Pull all failed: {error}": "“Baixar tudo” falhou: {error}",
	"Pull all failed": "“Baixar tudo” falhou",
	// UI strings (third pass)
	"Click to copy": "Clique para copiar",
	"Waiting for authorization — connected, this will complete instantly.":
		"Aguardando a autorização: há conexão, vai ser imediato.",
	"Waiting for authorization — no live connection, checking every 30s.":
		"Aguardando a autorização: sem conexão ao vivo, verificando a cada 30 s.",
	'Engram Sync: sync state for "{name}" was unreadable — using the on-disk copy.':
		"Engram Sync: não foi possível ler o estado de sincronização de «{name}», será usada a cópia do disco.",
	"{formatted} files · ": {
		one: "{formatted} arquivo · ",
		other: "{formatted} arquivos · ",
	},
	"Notes searchable": "Notas pesquisáveis",
	"Notes past this still sync and open normally, they are just not in the search index. The index keeps your oldest notes, so it is your newest ones that fall outside.":
		"As notas além disso continuam sincronizando e abrindo normalmente, só não entram no índice de busca. O índice mantém as suas notas mais antigas, então são as mais novas que ficam de fora.",
	"Notes stored": "Notas guardadas",
	"AI searches": "Buscas com IA",
	"{formatted} per day": "{formatted} por dia",
	"Engram indexes {indexed} of your {all} notes. The rest match on this device only. Upgrade to index everything.":
		"O Engram indexa {indexed} das suas {all} notas. O resto só é encontrado neste aparelho. Faça upgrade para indexar tudo.",
	"Searching {indexed} of {all} notes. Upgrade to search everything.":
		"Buscando em {indexed} de {all} notas. Faça upgrade para buscar em tudo.",
	"Remove tag {tag}": "Remover a tag {tag}",
	"👋 Welcome": "👋 Bem-vindo",
	"🔌 Connection": "🔌 Conexão",
	"🔄 Sync Center": "🔄 Sync Center",
	"⚙️ Advanced": "⚙️ Avançado",
	"Error: {error}": "Erro: {error}",
	unknown: "desconhecido",
	"{count} need attention": {
		one: "{count} precisa de atenção",
		other: "{count} precisam de atenção",
	},
	"Uploads {up}, downloads {down}.": "Envia {up} e baixa {down}.",
	"Uploads {count}.": "Envia {count}.",
	"Downloads {count}.": "Baixa {count}.",
	"{count} conflicts to resolve.": {
		one: "{count} conflito para resolver.",
		other: "{count} conflitos para resolver.",
	},
	"Nothing is deleted.": "Nada é apagado.",
	"Delete all {count} files currently on the server": {
		one: "Apagar o {count} arquivo que está agora no servidor",
		other: "Apagar os {count} arquivos que estão agora no servidor",
	},
	"Upload {count} files from this vault": {
		one: "Enviar {count} arquivo deste cofre",
		other: "Enviar {count} arquivos deste cofre",
	},
	"Delete all {count} files in this vault": {
		one: "Apagar o {count} arquivo deste cofre",
		other: "Apagar os {count} arquivos deste cofre",
	},
	"Download {count} files from the server": {
		one: "Baixar {count} arquivo do servidor",
		other: "Baixar {count} arquivos do servidor",
	},
	"Nothing to sync yet — this vault is empty on both sides. Start syncing and everything you write appears on your other devices.":
		"Ainda não há nada para sincronizar, este cofre está vazio dos dois lados. Comece a sincronizar e tudo o que você escrever aparece nos seus outros aparelhos.",
	"{count} notes": {
		one: "{count} nota",
		other: "{count} notas",
	},
	"{count} attachments": {
		one: "{count} anexo",
		other: "{count} anexos",
	},
	"{first} and {second}": "{first} e {second}",
	files: "arquivos",
	"This vault is empty on the server. Upload your {what}?":
		"Este cofre está vazio no servidor. Enviar os seus {what}?",
	"This device's vault is empty. Download {what} from the server?":
		"O cofre deste aparelho está vazio. Baixar {what} do servidor?",
	notes: "notas",
	attachments: "anexos",
	folders: "pastas",
	"Uploading {count}.": "Enviando {count}.",
	"Downloading {count}.": "Baixando {count}.",
	"Deleting {count} local files.": "Apagando {count} arquivos locais.",
	"Deleting {count} on the cloud.": "Apagando {count} na nuvem.",
	"First sync, this may take a moment.": "Primeira sincronização, pode levar um momento.",
	"Checking for changes.": "Procurando mudanças.",
	"Nothing will be deleted.": "Nada será apagado.",
	'{count} failed. Run "{command}" for details.':
		"{count} falharam. Rode «{command}» para ver os detalhes.",
	'Engram Sync: renamed "{name}" (unsupported characters)':
		"Engram Sync: «{name}» foi renomeado (caracteres não suportados)",
	'Engram: frontmatter problem in "{name}"': "Engram: problema de frontmatter em «{name}»",
	"Create a hosted account at ": "Crie uma conta hospedada em ",
	", or self-host the backend (": ", ou hospede o backend você mesmo (",
	"Link Claude, Cursor, ChatGPT, or any MCP app so it can read and write your notes. ":
		"Ligue o Claude, o Cursor, o ChatGPT ou qualquer app MCP para que ele possa ler e escrever as suas notas. ",
	Documentation: "Documentação",
	"AI / MCP setup guide": "Guia de configuração de IA / MCP",
	"Report an issue": "Relatar um problema",
	"Join our Discord": "Entre no nosso Discord",
	"Paths to skip (one per line). Folder patterns end with /. Built-in: {configDir}/, .trash/, .git/":
		"Caminhos a ignorar (um por linha). Os padrões de pasta terminam com /. Integrados: {configDir}/, .trash/, .git/",
	"Send detailed sync, vault, and connection activity to the server for troubleshooting, with distributed tracing on requests. Metadata only, never note content. Leave off for normal use.":
		"Envia ao servidor a atividade detalhada de sincronização, cofre e conexão para diagnóstico, com rastreamento distribuído das requisições. Só metadados, nunca o conteúdo das notas. Deixe desligado no uso normal.",
	"Minimum severity that ships while diagnostics are on. Higher levels send fewer lines. Default: Info.":
		"Gravidade mínima enviada enquanto o diagnóstico está ligado. Níveis mais altos enviam menos linhas. Padrão: Informação.",
	"Signed in as {email}": "Conectado como {email}",
	"Pick a vault (previous: '{name}' not found)":
		"Escolha um cofre (o anterior, «{name}», não foi encontrado)",
	"Pick a vault (previous: id {id} not found)":
		"Escolha um cofre (o id anterior {id} não foi encontrado)",
	"Server error ({status}) — check Engram logs":
		"Erro do servidor ({status}), confira os registros do Engram",
	"Request failed ({status})": "A requisição falhou ({status})",
	"Engram Cloud": "Engram Cloud",
	"Self-hosted": "Auto-hospedado",
	"{count} attempts": {
		one: "{count} tentativa",
		other: "{count} tentativas",
	},
	// UI strings (fourth pass)
	"{count} missing on server": {
		one: "falta {count} no servidor",
		other: "faltam {count} no servidor",
	},
	"{count} diverged": {
		one: "{count} divergiu",
		other: "{count} divergiram",
	},
	"{count} only on server": "{count} só no servidor",
	"Engram Sync: {details}": "Engram Sync: {details}",
	"Engram: plugin settings file was corrupted and could not be recovered. You may need to reconnect in settings.":
		"Engram: o arquivo de configurações do plugin estava corrompido e não pôde ser recuperado. Talvez você precise reconectar nas configurações.",
	"Engram: sync is not set up yet, so nothing in this vault will sync.":
		"Engram: a sincronização ainda não está configurada, então nada deste cofre vai sincronizar.",
	"Click the Engram item in the status bar to pick up where you left off.":
		"Clique em Engram na barra de status para continuar de onde você parou.",
	"Engram: ⚠ {count} sync errors": {
		one: "Engram: ⚠ {count} erro de sincronização",
		other: "Engram: ⚠ {count} erros de sincronização",
	},
	"sync failed": "a sincronização falhou",
	"That does not look like a complete server address. Include the scheme, for example http://127.0.0.1:4000":
		"Isso não parece um endereço de servidor completo. Inclua o esquema, por exemplo http://127.0.0.1:4000",
	"Opens your browser to sign in, or create an account if you don't have one yet, then links this vault.":
		"Abre o seu navegador para entrar, ou criar uma conta se você ainda não tem, e depois liga este cofre.",
	"Or authenticate with a token instead of signing in. Engram Cloud API keys require the Pro plan; on Free and Starter, sign in above.":
		"Ou autentique com um token em vez de entrar. As chaves de API do Engram Cloud exigem o plano Pro; no Free e no Starter, entre acima.",
	"No sync activity this session.": "Nenhuma atividade de sincronização nesta sessão.",
	"Showing {count} entries": {
		one: "Mostrando {count} entrada",
		other: "Mostrando {count} entradas",
	},
	"({count} errors)": {
		one: "({count} erro)",
		other: "({count} erros)",
	},
	"Frontmatter could not be parsed": "Não foi possível interpretar o frontmatter",
	"Not connected. Enter your Engram server URL below to start syncing.":
		"Sem conexão. Escreva abaixo o endereço do seu servidor Engram para começar a sincronizar.",
	// UI strings (fifth pass)
	"Sync...": "Sincronizar...",
	"Syncing...": "Sincronizando...",
	" (default)": " (padrão)",

	// First-run diagnostics opt-in (#528)
	"Send debug logs. Note content stays private.":
		"Enviar logs de depuração. O conteúdo das notas continua privado.",
};

export default pt;
