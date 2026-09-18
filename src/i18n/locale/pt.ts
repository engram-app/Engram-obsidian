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
	"Until you choose, nothing in this vault will sync.":
		"Até você escolher, nada neste cofre sincroniza.",
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
};

export default pt;
