import type { Dict } from "..";

// Português (do Brasil)
const ptBR: Dict = {
	"Invalid API key": "Chave de API inválida",
	"Request failed ({status})": "Solicitação falhou ({status})",
	"Connection failed": "Falha na conexão",
	"Link Obsidian to Engram": "Link Obsidian para Engram",
	"Starting...": "Iniciando...",
	"Failed to start device flow. Check your Engram URL and try again.":
		"Falha ao iniciar o fluxo do dispositivo. Verifique sua URL de Engram e tente novamente.",
	"Your code:": "Seu código:",
	"Click to copy": "Clique para copiar",
	"Code copied!": "Código copiado!",
	"A browser window has opened. Sign in and enter this code to link your vault.":
		"Uma janela do navegador foi aberta. Faça login e insira este código para vincular seu cofre.",
	Cancel: "Cancelar",
	"Waiting for authorization — connected, this will complete instantly.":
		"Aguardando autorização — conectado, isso será concluído instantaneamente.",
	"Waiting for authorization — no live connection, checking every 30s.":
		"Aguardando autorização — sem conexão ativa, verificando a cada 30 segundos.",
	"Code expired. Please try again.": "Código expirado. Tente novamente.",
	"Try again": "Tentar novamente",
	Close: "Fechar",
	"...": "...",
	'... "{name}" ...': '... "{name}" ...',
	"The server took too long to respond. Try again.":
		"O servidor demorou muito para responder. Tente novamente.",
	"Not signed in, or the session expired. Sign in again in Engram settings.":
		"Não está conectado, ou a sessão expirou. Faça login novamente nas configurações de Engram.",
	"The file is too large for the server.": "O arquivo é muito grande para o servidor.",
	"Too many requests. Wait a moment and try again.":
		"Muitos pedidos. Aguarde um momento e tente novamente.",
	"Server error ({status}) — check Engram logs":
		"Erro no servidor ({status}) — verifique os logs de Engram",
	"Could not reach Engram — check connection":
		"Não foi possível acessar Engram — verifique a conexão",
	"Unknown error": "Erro desconhecido",
	"Frontmatter isn't valid YAML.": "O frontmatter não é um YAML válido.",
	"A frontmatter key could not be parsed as YAML.":
		"Uma chave do frontmatter não pôde ser interpretada como YAML.",
	"This note could not be processed and was skipped.":
		"Esta nota não pôde ser processada e foi ignorada.",
	"Frontmatter could not be parsed": "Não foi possível analisar o cabeçalho",
	'Frontmatter key "{key}" could not be parsed as YAML.':
		'A chave do frontmatter "{key}" não pôde ser interpretada como YAML.',
	"Note couldn't be processed": "A nota não pôde ser processada",
	"The server couldn't process this note. Check its contents, then edit and save to try again.":
		"O servidor não conseguiu processar esta nota. Verifique o conteúdo, edite e salve para tentar novamente.",
	"Attachments need a paid plan": "Anexos requerem um plano pago",
	"The Free tier syncs notes only. Upgrade to sync images and PDFs.":
		"O plano gratuito sincroniza apenas notas. Faça um upgrade para sincronizar imagens e PDFs.",
	"Attachment storage full": "Armazenamento de anexos cheio",
	"You've used all the attachment storage on your plan. Upgrade for more.":
		"Você usou todo o espaço de armazenamento de anexos do seu plano. Faça um upgrade para ter mais.",
	"Too large for the server": "Muito grande para o servidor",
	"The server limit is 5 MB. Compress or split the file, then it will sync.":
		"O limite do servidor é de 5 MB. Comprima ou divida o arquivo, então ele será sincronizado.",
	"Sign-in expired": "Sessão expirada",
	"Reconnect your account to resume syncing.":
		"Reconecte sua conta para retomar a sincronização.",
	"Unresolved conflict": "Conflito não resolvido",
	"Open the file to resolve the conflict, then sync again.":
		"Abra o arquivo para resolver o conflito, e sincronize novamente.",
	"Frontmatter needs a fix": "O cabeçalho precisa de correção",
	"The note synced, but its frontmatter could not be fully parsed. Open it to fix the highlighted line.":
		"A nota foi sincronizada, mas o cabeçalho não pôde ser totalmente analisado. Abra-a para corrigir a linha destacada.",
	"Server error": "Erro no servidor",
	"A temporary server problem — retrying automatically.":
		"Um problema temporário no servidor — tentando novamente automaticamente.",
	"Network unavailable": "Rede indisponível",
	"Can't reach the server — retrying automatically.":
		"Não foi possível acessar o servidor — tentando novamente automaticamente.",
	"Sync failed": "Sincronização falhou",
	"An unexpected error — retrying automatically.":
		"Um erro inesperado — tentando novamente automaticamente.",
	"Note limit reached. Upgrade to keep adding notes.":
		"Limite de notas atingido. Faça um upgrade para continuar adicionando notas.",
	"Vault limit reached. Upgrade for more vaults.":
		"Limite de cofres atingido. Faça um upgrade para mais cofres.",
	"This file type isn't accepted by this server.":
		"Este tipo de arquivo não é aceito por este servidor.",
	"Attachment sync is disabled for this account.":
		"A sincronização de anexos está desativada para esta conta.",
	"Attachment storage is full — upgrade for more.":
		"O armazenamento de anexos está cheio — faça um upgrade para mais espaço.",
	"File too large for your plan.": "Arquivo muito grande para o seu plano.",
	"Already signed in on another device. Upgrade for multi-device.":
		"Já conectado em outro dispositivo. Faça um upgrade para acesso em múltiplos dispositivos.",
	"Device swap cooldown active. Wait or upgrade.":
		"Período de espera para troca de dispositivo ativo. Aguarde ou faça um upgrade.",
	"Too many connected Obsidian vaults. Disconnect one or upgrade.":
		"Muitos cofres Obsidian conectados. Desconecte um ou faça um upgrade.",
	"Too many connected AI clients. Disconnect one or upgrade.":
		"Muitos clientes de IA conectados. Desconecte um ou faça um upgrade.",
	"Daily AI search limit reached. Free includes 20 per day across Obsidian, the web app and MCP. Upgrade for unlimited.":
		"Limite diário de buscas por IA atingido. A versão gratuita inclui 20 por dia, distribuídos entre Obsidian, o aplicativo web e MCP. Faça um upgrade para acesso ilimitado.",
	"API keys need Pro. Sign in with your Engram account instead.":
		"As chaves de API precisam de Pro. Faça login com sua conta Engram em vez disso.",
	"Account suspended. Contact support.": "Conta suspensa. Entre em contato com o suporte.",
	"Account setup incomplete.": "Configuração da conta incompleta.",
	"This account was deleted. Contact support if that is wrong.":
		"Esta conta foi excluída. Entre em contato com o suporte se isso estiver incorreto.",
	"Finish setting up your account at app.engram.page to start syncing.":
		"Finalize a configuração da sua conta em app.engram.page para começar a sincronizar.",
	"Limit reached. Upgrade to continue.": "Limite atingido. Faça um upgrade para continuar.",
	Upgrade: "Atualizar",
	"Update in settings": "Atualizar nas configurações",
	"Sync now": "Sincronizar agora",
	"Engram sync: syncing...": "Engram Sincronização: sincronizando...",
	"Engram Sync: pulled {pulled}, pushed {pushed}":
		"Engram Sincronização: baixados {pulled}, enviados {pushed}",
	"Disconnect (clear login)": "Desconectar (limpar login)",
	"Engram: disconnected. Open Engram settings to reconnect.":
		"Engram: desconectado. Abra as configurações de Engram para reconectar.",
	"Push entire vault": "Enviar todo o cofre",
	"Engram Sync: pushed {count} files": {
		one: "Engram Sincronização: enviadas {count} arquivo(s)",
		many: "Engram Sincronização: enviadas {count} de arquivos",
		other: "Engram Sincronização: enviadas {count} arquivos",
	},
	"Check sync status": "Verificar o status da sincronização",
	"Engram sync: checking...": "Engram: sincronização: verificando...",
	"Engram sync: server does not support reconciliation (update backend)":
		"Engram: sincronização: o servidor não suporta a sincronização (atualize o backend)",
	"Engram sync: everything in sync": "Engram: sincronização: tudo em sincronia",
	"{count} missing on server": {
		one: "{count} faltando no servidor",
		many: "{count} faltando no servidor",
		other: "{count} faltando no servidor",
	},
	"{count} diverged": {
		one: "{count} divergente",
		many: "{count} divergências",
		other: "{count} divergentes",
	},
	"{count} only on server": {
		one: "{count} apenas no servidor",
		many: "{count} apenas no servidor",
		other: "{count} apenas no servidor",
	},
	"Engram Sync: {details}": "Engram: Sincronização: {details}",
	"Pull all from server (force overwrite)": "Baixar tudo do servidor (substituir tudo)",
	"Engram sync: pulling all from server...":
		"Engram: sincronização: baixando tudo do servidor...",
	"Engram Sync: pulled {count} files from server": {
		one: "Engram Sincronização: baixados {count} arquivo(s) do servidor",
		many: "Engram Sincronização: transferidos {count} arquivos do servidor",
		other: "Engram Sincronização: baixados {count} arquivos do servidor",
	},
	"Show sync log": "Mostrar o registro de sincronização",
	"Send feedback": "Enviar feedback",
	"Semantic search": "Busca semântica",
	"Open search sidebar": "Abrir a barra lateral de pesquisa",
	"Engram search": "Engram: pesquisa",
	"Open sync center": "Abrir a Central de sincronização",
	"Engram: ready": "Engram: pronto",
	"Engram Sync: pushed {pushed}": "Engram Sincronização: enviou {pushed}",
	"Engram sync: sync failed": "Engram sincronização: falha na sincronização",
	"Engram: this vault no longer exists on the server. Pick or create a vault to continue.":
		"Engram: este cofre não existe mais no servidor. Selecione ou crie um cofre para continuar.",
	"Engram: recovered plugin settings from a backup after a corrupted save.":
		"Engram: configurações do plugin restauradas de um backup após uma corrupção.",
	"Engram: plugin settings file was corrupted and could not be recovered. You may need to reconnect in settings.":
		"Engram: o arquivo de configurações do plugin foi corrompido e não pôde ser recuperado. Você pode precisar reconectar nas configurações.",
	"Engram: your login expired — open Engram settings to reconnect.":
		"Engram: sua sessão expirou — abra as configurações de Engram para reconectar.",
	"Engram: This vault has been deleted on the server.":
		"Engram: este cofre foi excluído no servidor.",
	"Engram sync: live sync requires a plugin update — please update the Engram vault sync plugin.":
		"Engram Sincronização: a sincronização em tempo real requer uma atualização do plugin — atualize o plugin de sincronização do Engram cofre.",
	"Engram Sync: pulled {pulled} (local extras deleted)":
		"Engram Sincronização: recebeu {pulled} (extras locais excluídos)",
	"Engram Sync: pulled {pulled}": "Engram Sincronização: recebeu {pulled}",
	"Engram Sync: replaced remote with local ({pushed} uploaded)":
		"Engram Sincronização: substituiu a versão remota pela local ({pushed} enviados)",
	"Engram: sync is not set up yet, so nothing in this vault will sync.":
		"Engram: a sincronização ainda não está configurada, então nada neste cofre será sincronizado.",
	"Finish sync setup": "Finalizar a configuração de sincronização",
	"Engram: sync is paused. This edit was not synced. Choose a sync direction to resume.":
		"Engram: a sincronização está pausada. Esta edição não foi sincronizada. Escolha uma direção de sincronização para retomar.",
	"Open Engram settings": "Abrir as configurações de Engram",
	"Engram: sync failed. Open the sync log for details.":
		"Engram: a sincronização falhou. Abra o registro de sincronização para detalhes.",
	"Engram: not connected": "Engram: não conectado",
	"Engram: signed out": "Engram: desconectado",
	"Not connected yet. Click to open settings and link this vault.":
		"Ainda não conectado. Clique para abrir as configurações e vincular este cofre.",
	"Not signed in. Click to open settings and reconnect.":
		"Não conectado. Clique para abrir as configurações e reconectar.",
	"Engram: finish setup": "Engram: finalizar a configuração",
	"Engram: sync paused": "Engram: sincronização pausada",
	"{label} ({count} queued)": {
		one: "{label} ({count} na fila)",
		many: "{label} ({count} na fila)",
		other: "{label} ({count} na fila)",
	},
	"Setup is not finished — nothing will sync until you choose a sync direction. Click to finish.":
		"A configuração não foi finalizada — nada será sincronizado até que você escolha uma direção de sincronização. Clique para finalizar.",
	"Sync paused — click to choose a sync direction":
		"Sincronização pausada — clique para escolher uma direção de sincronização",
	"Engram: offline ({count} queued)": {
		one: "Engram: offline ({count} na fila)",
		many: "Engram: offline ({count} na fila)",
		other: "Engram: offline ({count} na fila)",
	},
	"Engram: offline": "Engram: sem rede",
	"Server unreachable — changes will sync when connected":
		"Servidor inacessível — as alterações serão sincronizadas quando conectado",
	"Engram: error": "Engram: erro",
	"Engram: syncing ({count})": "Engram: sincronizando ({count})",
	"Engram: syncing": "Engram: sincronizando",
	"Sync in progress...": "Sincronização em andamento...",
	"Engram: pending ({count})": "Engram: pendente ({count})",
	"{count} files queued": {
		one: "{count} arquivo na fila",
		many: "{count} arquivos na fila",
		other: "{count} arquivos na fila",
	},
	"Engram: live": "Engram: ativo",
	"WebSocket connected — live sync active": "WebSocket conectado — sincronização ativa",
	"Click to sync": "Clique para sincronizar",
	"Engram: ⚠ {count} sync errors": {
		one: "Engram: ⚠ {count} erro de sincronização",
		many: "Engram: ⚠ {count} erros de sincronização",
		other: "Engram: ⚠ {count} erros de sincronização",
	},
	"Last sync: {when}": "Última sincronização: {when}",
	"Engram Sync: pulled {count} changes": {
		one: "Engram Sincronização: {count} alteração sincronizada",
		many: "Engram Sincronização: transferidos {count} itens",
		other: "Engram Sincronização: {count} alterações sincronizadas",
	},
	'Engram Sync: sync state for "{name}" was unreadable — using the on-disk copy.':
		'Engram Sincronização: o estado de sincronização de "{name}" não pôde ser lido — usando a cópia no disco.',
	"Engram Vault Sync {version} is available. {link}.":
		"Engram Vault Sync {version} está disponível. {link}.",
	"{count} files": {
		one: "{count} arquivo",
		many: "{count} arquivos",
		other: "{count} arquivos",
	},
	"Notes searchable": "Notas pesquisáveis",
	"Notes past this still sync and open normally, they are just not in the search index. The index keeps your oldest notes, so it is your newest ones that fall outside.":
		"As notas após este ponto ainda são sincronizadas e abertas normalmente, elas apenas não estão no índice de pesquisa. O índice armazena suas notas mais antigas, então são as suas notas mais recentes que ficam fora.",
	"Notes stored": "Notas armazenadas",
	Attachments: "Anexos",
	"AI searches": "Pesquisas de IA",
	"{formatted} per day": "{formatted} por dia",
	Keyword: "Palavra-chave",
	Semantic: "Semântica",
	Both: "Ambos",
	"matches your words and their other forms — 'run' finds 'running' — plus this device.":
		'corresponde às suas palavras e a outras formas delas — "run" encontra "running" — além deste dispositivo.',
	"matches meaning. Finds notes that never use the words you typed.":
		"corresponde ao significado. Encontra notas que nunca usam as palavras que você digitou.",
	"matches words and meaning together, plus this device. Widest results.":
		"combina palavras e significado, além deste dispositivo. Resultados mais amplos.",
	"Engram indexes {indexed} of your {all} notes. The rest match on this device only. Upgrade to index everything.":
		"Engram indexa {indexed} de suas {all} notas. O restante só corresponde neste dispositivo. Faça um upgrade para indexar tudo.",
	"Searching {indexed} of {all} notes. Upgrade to search everything.":
		"Pesquisando {indexed} de {all} notas. Faça um upgrade para pesquisar tudo.",
	"Search your vault…": "Pesquise seu cofre…",
	"Clear search": "Limpar pesquisa",
	"Search settings": "Configurações de pesquisa",
	"Filter by folder…": "Filtrar por pasta…",
	"Filter by tags…": "Filtrar por tags…",
	"Remove tag {tag}": "Remover tag {tag}",
	"Engram unreachable. Showing matches from this device only.":
		"Engram inacessível. Mostrando correspondências apenas deste dispositivo.",
	"Search failed — check connection": "A pesquisa falhou — verifique a conexão",
	"No results found": "Nenhum resultado encontrado",
	Untitled: "Sem título",
	exact: "exato",
	"meaning + exact": "significado + exato",
	meaning: "significado",
	"match strength: {pct}%": "força da correspondência: {pct}%",
	"No source path for this result": "Sem caminho de origem para este resultado",
	"Note not synced locally": "Nota não sincronizada localmente",
	"Syncing...": "Sincronizando...",
	"👋 Welcome": "👋 Bem-vindo",
	"🔌 Connection": "🔌 Conexão",
	"🔄 Sync Center": "🔄 Central de sincronização",
	"⚙️ Advanced": "⚙️ Avançado",
	"💬 Feedback": "💬 Feedback",
	"Engram: settings tab failed to render ({error})":
		"Engram: a aba de configurações não pôde ser exibida ({error})",
	Disconnected: "Desconectado",
	"Error: {error}": "Erro: {error}",
	unknown: "desconhecido",
	"Connected — waiting for first sync decision":
		"Conectado — aguardando a primeira decisão de sincronização",
	"Connected — live sync active": "Conectado — sincronização em tempo real ativa",
	"Connected — polling": "Conectado — verificando",
	"Not configured": "Não configurado",
	"Open sync setup": "Abrir configuração de sincronização",
	"waiting for a connection": "aguardando conexão",
	"sync is paused": "sincronização pausada",
	"syncing now": "sincronizando agora",
	"waiting to retry": "aguardando nova tentativa",
	"{count} not on your plan": {
		one: "{count} não incluso no seu plano",
		many: "{count} não incluso no seu plano",
		other: "{count} não estão no seu plano",
	},
	"{count} need attention": {
		one: "{count}. Precisa de atenção",
		many: "{count} precisa de atenção",
		other: "{count} precisam de atenção",
	},
	"{count} retrying": {
		one: "{count}. Tentando novamente",
		many: "{count} tentando novamente",
		other: "{count} tentando novamente",
	},
	"{count} ignored": {
		one: "{count} ignorado",
		many: "{count} ignorados",
		other: "{count} ignorados",
	},
	"{count} queued — {reason}": {
		one: "{count} na fila — {reason}",
		many: "{count} na fila — {reason}",
		other: "{count} na fila — {reason}",
	},
	"Sync...": "Sincronizando...",
	Refresh: "Atualizar",
	"Not synced on your plan ({count})": "Não sincronizado no seu plano ({count})",
	"These files are fine. They just need a paid plan to sync.":
		"Esses arquivos estão ok. Eles só precisam de um plano pago para sincronizar.",
	"Show files ({count}) ▾": "Mostrar arquivos ({count}) ▾",
	"Sync these now": "Sincronize isso agora",
	"Needs attention ({count})": "Precisa de atenção ({count})",
	"Clear all": "Limpar tudo",
	"Nothing needs your attention. 🎉": "Nada precisa da sua atenção. 🎉",
	Dismiss: "Dispensar",
	"Retrying automatically ({count})": "Tentando novamente automaticamente ({count})",
	"Retry all now": "Tentar novamente agora",
	"Temporary errors. These clear themselves once the server recovers.":
		"Erros temporários. Eles desaparecem quando o servidor se recupera.",
	"{count} attempts": {
		one: "{count} tentativa",
		many: "{count} tentativas",
		other: "{count} tentativas",
	},
	Open: "Abrir",
	Ignore: "Ignorar",
	"Ignored ({count})": "Ignorados ({count})",
	"No files ignored. Use the ignore button on a failure row to stop syncing it.":
		'Nenhum arquivo ignorado. Use o botão "ignorar" em uma linha de erro para interromper a sincronização.',
	Restore: "Restaurar",
	"File not found locally: {path}": "Arquivo não encontrado localmente: {path}",
	"Ignored {path} — won't sync until restored from Sync Center.":
		"Ignorado {path} — não será sincronizado até ser restaurado na Central de sincronização.",
	"Restored {path} — will sync on next push.":
		"Restaurado {path} — será sincronizado no próximo envio.",
	"Activity ({count})": "Atividade ({count})",
	Clear: "Limpar",
	"No activity yet. Push or pull to see entries here.":
		"Ainda não há atividade. Envie ou receba para ver os registros aqui.",
	Pushed: "Enviado",
	Pulled: "Recebido",
	Deleted: "Excluído",
	Conflict: "Conflito",
	Skipped: "Ignorado",
	Error: "Erro",
	Stats: "Estatísticas",
	"Notes on this device": "Notas neste dispositivo",
	"Attachments on this device": "Anexos neste dispositivo",
	"Remote vault": "Cofre remoto",
	"not linked": "não vinculado",
	"Plan usage": "Uso do plano",
	"Sync log": "Log de sincronização",
	"Showing {count} entries": {
		one: "Exibindo {count} entrada",
		many: "Exibindo {count} entradas",
		other: "Exibindo {count} entradas",
	},
	"No sync activity this session.": "Nenhuma atividade de sincronização nesta sessão.",
	"({count} errors)": {
		one: "({count} erro)",
		many: "({count} erros)",
		other: "({count} erros)",
	},
	"Could not compare with the cloud. Check your connection.":
		"Não foi possível comparar com a nuvem. Verifique sua conexão.",
	"Your login expired. Sign in again in Engram settings to continue.":
		"Sua sessão expirou. Faça login novamente nas configurações de Engram para continuar.",
	"Couldn't create vault — the name may be invalid or already in use.":
		"Não foi possível criar o cofre — o nome pode ser inválido ou já estar em uso.",
	"Could not create the vault — check your connection and try again.":
		"Não foi possível criar o cofre — verifique sua conexão e tente novamente.",
	"Free syncs notes only — {count} attachments will be skipped.": {
		one: "Sincroniza notas gratuitamente, mas apenas {count} anexo será ignorado.",
		many: "Sincroniza notas gratuitamente, mas {count} de anexos serão ignorados.",
		other: "Sincroniza notas gratuitamente, mas apenas {count} anexos serão sincronizados.",
	},
	"Uploads {up}, downloads {down}.": "Envio: {up}, download: {down}.",
	"Uploads {count}.": {
		one: "Envios {count}.",
		many: "Uploads: {count}.",
		other: "Uploads {count}.",
	},
	"Downloads {count}.": {
		one: "Downloads {count}.",
		many: "Downloads {count}.",
		other: "Downloads {count}.",
	},
	"{count} conflicts to resolve.": {
		one: "{count} conflito para resolver.",
		many: "{count} conflitos para resolver.",
		other: "{count} conflitos a resolver.",
	},
	"Safe choice: combines both sides, nothing is deleted.":
		"Opção segura: combina ambos os lados, nada é excluído.",
	"Nothing is deleted.": "Nada é excluído.",
	"Already in sync. Nothing is deleted.": "Já está sincronizado. Nada é excluído.",
	"Delete all {count} files currently on the server": {
		one: "Excluir todos os {count} arquivos atualmente no servidor",
		many: "Excluir todos os {count} de arquivos atualmente no servidor",
		other: "Excluir todos os {count} arquivos atualmente no servidor",
	},
	"Upload {count} files from this vault": {
		one: "Enviar {count} arquivo deste cofre",
		many: "Enviar {count} arquivos deste cofre",
		other: "Enviar {count} arquivos deste cofre",
	},
	"Delete all {count} files in this vault": {
		one: "Excluir todos os {count} arquivos neste cofre",
		many: "Excluir todos os {count} arquivos neste cofre",
		other: "Excluir todos os {count} arquivos neste cofre",
	},
	"Download {count} files from the server": {
		one: "Baixar {count} arquivo do servidor",
		many: "Baixar {count} arquivos do servidor",
		other: "Baixar {count} arquivos do servidor",
	},
	Sync: "Sincronizar",
	"Upload local files without downloading the remote":
		"Envie arquivos locais sem baixar os remotos",
	"Delete all on remote, then upload local files":
		"Exclua tudo no remoto, depois envie os arquivos locais",
	"Download remote files without uploading the local":
		"Baixe arquivos remotos sem enviar os locais",
	"Delete all local files, then download from remote":
		"Exclua todos os arquivos locais, depois baixe do remoto",
	"Set up sync for this vault": "Configure a sincronização para este cofre",
	"You are now pointing at a different cloud vault":
		"Você está apontando para um cofre na nuvem diferente",
	"Sync preview": "Visualização da sincronização",
	"Nothing to sync yet — this vault is empty on both sides. Start syncing and everything you write appears on your other devices.":
		"Ainda não há nada para sincronizar — este cofre está vazio em ambos os lados. Comece a sincronizar e tudo o que você escreve aparecerá em seus outros dispositivos.",
	"Start syncing": "Começar a sincronizar",
	"{count} notes": { one: "{count} nota", many: "{count} notas", other: "{count} notas" },
	"{count} attachments": {
		one: "{count} anexo",
		many: "{count} anexos",
		other: "{count} anexos",
	},
	"{first} and {second}": "{first} e {second}",
	files: "arquivos",
	"This vault is empty on the server. Upload your {what}?":
		"Este cofre está vazio no servidor. Deseja enviar seus {what}?",
	"Upload everything": "Enviar tudo",
	"Nothing will be removed from this device.": "Nada será removido deste dispositivo.",
	"This device's vault is empty. Download {what} from the server?":
		"O cofre deste dispositivo está vazio. Deseja baixar {what} do servidor?",
	"Download everything": "Baixar tudo",
	Done: "Concluído",
	"Send debug logs. Note content stays private.":
		"Enviar logs de depuração. O conteúdo das notas permanece privado.",
	"Comparing your vault with the cloud…": "Comparando seu cofre com a nuvem…",
	"Not now": "Não agora",
	"Change vault": "Alterar cofre",
	"Advanced sync options": "Opções avançadas de sincronização",
	"Everything is in sync": "Tudo está sincronizado",
	"This vault": "Este cofre",
	"Cloud server": "Servidor na nuvem",
	notes: "notas",
	attachments: "anexos",
	folders: "pastas",
	"Confirm destructive sync": "Confirmar sincronização que apaga dados",
	"You are about to:": "Você está prestes a:",
	"Files that will be deleted:": "Arquivos que serão excluídos:",
	"This cannot be undone.": "Isso não pode ser desfeito.",
	Back: "Voltar",
	Confirm: "Confirmar",
	"Switch vault": "Trocar de cofre",
	"Pick a vault to sync with. We will recalculate the sync preview after you choose.":
		"Escolha um cofre para sincronizar. Recalcularemos a prévia da sincronização após você escolher.",
	"Loading vaults…": "Carregando cofres…",
	" (default)": " (padrão)",
	"No other vaults available.": "Nenhum outro cofre disponível.",
	"Make new vault": "Criar novo cofre",
	"New vault": "Novo cofre",
	"Create a new empty vault on the server, then sync this Obsidian vault into it.":
		"Crie um novo cofre vazio no servidor e, em seguida, sincronize este cofre Obsidian para ele.",
	"Vault name": "Nome do Cofre",
	Create: "Criar",
	"Could not load vaults: {error}": "Não foi possível carregar os cofres: {error}",
	"Enter a name for the new vault": "Digite um nome para o novo cofre",
	"Failed to switch vault: {error}": "Falha ao alternar de cofre: {error}",
	"Your vault shares {percent} of its data with Engram":
		"Seu cofre compartilha {percent} de seus dados com Engram",
	"{count} conflicts need resolution": {
		one: "{count} conflito precisa ser resolvido",
		many: "{count} conflitos precisam ser resolvidos",
		other: "{count} conflitos precisam ser resolvidos",
	},
	"Type {keyword} to confirm:": "Digite {keyword} para confirmar:",
	"Uploading {count}.": {
		one: "Enviando {count}.",
		many: "Carregando {count}.",
		other: "Enviando {count}.",
	},
	"Downloading {count}.": {
		one: "Baixando {count}.",
		many: "Baixando {count}.",
		other: "Baixando {count}.",
	},
	"Deleting {count} local files.": {
		one: "Excluindo {count} arquivo local.",
		many: "Excluindo {count} arquivos locais.",
		other: "Excluindo {count} arquivos locais.",
	},
	"Deleting {count} on the cloud.": {
		one: "Excluindo {count} na nuvem.",
		many: "Excluindo {count} na nuvem.",
		other: "Excluindo {count} na nuvem.",
	},
	"First sync, this may take a moment.": "Primeira sincronização, isso pode levar um momento.",
	"Checking for changes.": "Verificando alterações.",
	"Nothing will be deleted.": "Nada será excluído.",
	"✓ {count} synced": {
		one: "✓ {count} sincronizado",
		many: "✓ {count} sincronizados",
		other: "✓ {count} sincronizados",
	},
	"⤳ {count} skipped (Free plan)": {
		one: "⤳ {count} ignorado (Plano gratuito)",
		many: "⤳ {count} ignorados (Plano gratuito)",
		other: "⤳ {count} ignorados (Plano gratuito)",
	},
	"✕ {count} failed": {
		one: "✕ {count} falha",
		many: "✕ {count} falhas",
		other: "✕ {count} tentativas falhadas",
	},
	"{count} attachments need a paid plan to sync. See Sync Center.": {
		one: "{count} anexo precisa de um plano pago para sincronizar. Veja a Central de sincronização.",
		many: "{count} anexos precisam de um plano pago para sincronizar. Veja a Central de sincronização.",
		other: "{count} anexos precisam de um plano pago para sincronizar. Veja a Central de sincronização.",
	},
	"Finished with some errors. Open the sync log to see what failed.":
		"Finalizado com alguns erros. Abra o registro de sincronização para ver o que falhou.",
	"Synced. Some attachments need a paid plan to sync (see below).":
		"Sincronizado. Alguns anexos precisam de um plano pago para sincronizar (veja abaixo).",
	"All synced. Your vault and the cloud now match.":
		"Tudo sincronizado. Seu cofre e a nuvem agora estão idênticos.",
	"Already up to date. Nothing needed syncing.":
		"Já está atualizado. Não há nada para sincronizar.",
	Deleting: "Excluindo",
	Downloading: "Baixando",
	Uploading: "Enviando",
	"Syncing your vault": "Sincronizando seu cofre",
	"Getting started…": "Iniciando…",
	"Open Engram to check your vault and confirm everything synced.":
		"Abra o Engram para verificar seu cofre e confirmar que tudo foi sincronizado.",
	"Open Engram": "Abrir Engram",
	"You can close this and the sync keeps running in the background.":
		"Você pode fechar isso e a sincronização continua em segundo plano.",
	"Run in background": "Executar em segundo plano",
	"Syncing…": "Sincronizando…",
	"Sync complete": "Sincronização completa",
	"Syncing attachments": "Sincronizando anexos",
	Complete: "Completo",
	'{count} failed. Run "{command}" for details.': {
		one: '{count} falha. Execute "{command}" para detalhes.',
		many: '{count} falhas. Execute "{command}" para detalhes.',
		other: '{count} falhas. Execute "{command}" para detalhes.',
	},
	"File exceeds the {limit} limit": "Arquivo excede o limite de {limit}",
	"Free syncs notes only — images & PDFs need a paid plan.":
		"A sincronização gratuita sincroniza apenas notas — imagens e PDFs precisam de um plano pago.",
	"Engram: {count} files failed to sync{detail} — open Sync Center": {
		one: "Engram: {count} arquivo falhou na sincronização{detail} — abra a Central de sincronização",
		many: "Engram: {count} arquivos falharam na sincronização{detail} — abra a Central de sincronização",
		other: "Engram: {count} arquivos falharam na sincronização{detail} — abra a Central de sincronização",
	},
	"Engram: {count} attachments skipped — upgrade to sync images & PDFs.": {
		one: "Engram: {count} anexo ignorado — atualize para sincronizar imagens e PDFs.",
		many: "Engram: {count} anexos ignorados — faça um upgrade para sincronizar imagens e PDFs.",
		other: "Engram: {count} anexos ignorados — atualize para sincronizar imagens e PDFs.",
	},
	"Engram: plan upgraded — syncing {count} attachments…": {
		one: "Engram: plano atualizado — sincronizando {count} anexo…",
		many: "Engram: plano atualizado — sincronizando {count} anexos…",
		other: "Engram: plano atualizado — sincronizando {count} anexos…",
	},
	"Pull all (delete extras) aborted: could not obtain an exclusive server snapshot (replay contention). Nothing was trashed.":
		'A operação "baixar tudo" (excluir duplicatas) foi interrompida: não foi possível obter um instantâneo exclusivo do servidor (conflito de replicação). Nada foi excluído.',
	"Pull all aborted: another sync is running (replay contention). Try again when it finishes.":
		'A operação "baixar tudo" foi interrompida: outra sincronização está em andamento (conflito de replicação). Tente novamente quando ela terminar.',
	"Pull all failed: {error}": 'A operação "baixar tudo" falhou: {error}',
	"Engram: sync conflict on {path} — your local edit was saved as {copy}":
		"Engram: conflito de sincronização em {path} — sua edição local foi salva como {copy}",
	"Open note": "Abrir nota",
	"Engram: {count} notes have frontmatter problems. Open Sync Center to fix.": {
		one: "Engram: {count} nota tem problemas no frontmatter. Abra a Central de sincronização para corrigir.",
		many: "Engram: {count} notas têm problemas no frontmatter. Abra a Central de sincronização para corrigir.",
		other: "Engram: {count} notas têm problemas no frontmatter. Abra a Central de sincronização para corrigir.",
	},
	'Engram Sync: renamed "{name}" (unsupported characters)':
		'Engram Sincronização: renomeado "{name}" (caracteres não suportados)',
	'Engram: frontmatter problem in "{name}"': 'Engram: problema no frontmatter em "{name}"',
	"New here? Watch the setup video": "Novo por aqui? Assista ao vídeo de configuração",
	"What Engram does, and how to connect your vault, start to finish.":
		"O que o Engram faz e como conectar seu cofre, do início ao fim.",
	"▶ Watch on YouTube": "▶ Assista no YouTube",
	"Getting set up": "Configurando",
	"1. Make an account": "1. Crie uma conta",
	"setup guide": "guia de configuração",
	"2. Connect your vault to Engram": "2. Conecte seu cofre ao Engram",
	"Sign in (or enter your server URL and key) on the connection tab, then run your first sync.":
		"Faça login (ou insira a URL do seu servidor e a chave) na aba de conexão e, em seguida, execute sua primeira sincronização.",
	"Open connection tab": "Abrir aba de conexão",
	"3. Connect your AI": "3. Conecte sua IA",
	"Link Claude, Cursor, ChatGPT, or any MCP app so it can read and write your notes. ":
		"Conecte Claude, Cursor, ChatGPT ou qualquer aplicativo MCP para que ele possa ler e escrever suas notas. ",
	"See the AI setup guide": "Veja o guia de configuração da IA",
	Plans: "Planos",
	Free: "Gratuito",
	"1 vault, 2 devices": "1 Cofre, 2 dispositivos",
	"Real-time sync": "Sincronização em tempo real",
	"2,000 notes searchable": "2.000 notas pesquisáveis",
	"Connect any AI (MCP)": "Conecte qualquer IA (MCP)",
	Starter: "Starter",
	"10 vaults, unlimited devices": "10 Cofres, dispositivos ilimitados",
	"Search all your notes": "Pesquise todas as suas notas",
	"10 GB attachments": "10 GB de anexos",
	"Unlimited AI searches": "Pesquisas de IA ilimitadas",
	Pro: "Pro",
	"Unlimited vaults": "Cofres ilimitados",
	"Search across all vaults at once": "Pesquise em todos os Cofres de uma vez",
	"50 GB attachments": "50 GB de anexos",
	"API access": "Acesso à API",
	"See full pricing": "Ver preços completos",
	"Learn more": "Saiba mais",
	Documentation: "Documentação",
	"AI / MCP setup guide": "Guia de configuração de IA / MCP",
	"Report an issue": "Reportar um problema",
	"Join our Discord": "Participe do nosso Discord",
	"Create a hosted account at {signup}, or self-host the backend ({guide}).":
		"Crie uma conta hospedada em {signup}, ou hospede o backend ({guide}).",
	"Node.js dependencies": "Dependências Node.js",
	"Python virtual environment": "Ambiente virtual Python",
	"Python bytecode cache": "Cache de bytecode Python",
	"Vendored dependencies": "Dependências incluídas",
	"Gradle build cache": "Cache de compilação Gradle",
	"Rust/Java build output": "Saída de compilação Rust/Java",
	"Build output": "Saída da compilação",
	"Next.js build output": "Saída da compilação Next.js",
	"Distribution build output": "Saída da compilação de distribuição",
	"Cargo cache": "Cache do Cargo",
	"CocoaPods dependencies": "Dependências do CocoaPods",
	"Dart tool cache": "Cache de ferramentas Dart",
	"Generic cache directory": "Diretório de cache genérico",
	"Ignore patterns": "Padrões ignorados",
	"Custom patterns": "Padrões personalizados",
	"Paths to skip (one per line). Folder patterns end with /. Built-in: {configDir}/, .trash/, .git/":
		"Caminhos a serem ignorados (um por linha). Padrões de pasta terminam com /. Embutidos: {configDir}/, .trash/, .git/",
	Diagnostics: "Diagnósticos",
	"Send detailed sync, vault, and connection activity to the server for troubleshooting, with distributed tracing on requests. Metadata only, never note content. Leave off for normal use.":
		"Envie informações detalhadas sobre a sincronização, o cofre e a conexão para o servidor para solucionar problemas, com rastreamento distribuído nas requisições. Apenas metadados, nunca o conteúdo das notas. Desative para uso normal.",
	"Diagnostics detail": "Detalhes dos diagnósticos",
	"Minimum severity that ships while diagnostics are on. Higher levels send fewer lines. Default: Info.":
		"Nível mínimo de severidade quando os diagnósticos estão ativados. Níveis mais altos enviam menos linhas. Padrão: Info.",
	"Errors only": "Erros apenas",
	"Warnings and errors": "Avisos e erros",
	"Info (default)": "Info (padrão)",
	"Debug (verbose)": "Debug (detalhado)",
	About: "Sobre",
	"License: {name}": "Licença: {name}",
	"⚠ Detected: {label}/ ({formatted} files)": "⚠ Detectado: {label} / ({formatted} arquivos)",
	"{desc} — should not be synced": "{desc} — não deve ser sincronizado",
	"Add to ignores": "Adicionar aos ignorados",
	"Added {pattern} to ignore patterns": "Adicionado {pattern} aos padrões ignorados",
	"Version: {version}": "Versão: {version}",
	"Source: {link}": "Fonte: {link}",
	"Engram URL": "URL do Engram",
	"✓ Engram server reachable (v{version})": "✓ Servidor Engram acessível (v{version})",
	"✗ server responded but isn't an Engram backend":
		"✗ O servidor respondeu, mas não é um backend do Engram",
	"✗ couldn't reach a server at this URL": "✗ Não foi possível acessar um servidor neste URL",
	"Checking server…": "Verificando servidor…",
	"That does not look like a complete server address. Include the scheme, for example http://127.0.0.1:4000":
		"Isso não parece um endereço de servidor completo. Inclua o esquema, por exemplo http://127.0.0.1:4000",
	"Engram backend changed — sign in again to continue.":
		"Backend do Engram alterado — faça login novamente para continuar.",
	Authentication: "Autenticação",
	"Signed in as {email}": "Logado como {email}",
	"Authenticated via Engram account (OAuth).": "Autenticado via conta Engram (OAuth).",
	"Manage account": "Gerenciar conta",
	"Sign out": "Sair",
	"Using API key": "Usando chave de API",
	"Authenticated via manual API key.": "Autenticado via chave de API manual.",
	"Clear key": "Limpar chave",
	"Switch to sign in": "Mudar para fazer login",
	"Engram: sign-in failed ({error})": "Engram: falha ao fazer login ({error})",
	"Sign in or create an account": "Faça login ou crie uma conta",
	"Opens your browser to sign in, or create an account if you don't have one yet, then links this vault.":
		"Abre seu navegador para fazer login ou criar uma conta, se você ainda não tiver uma, e então vincula este cofre.",
	"Sign in": "Fazer login",
	"Or authenticate with a token instead of signing in. Engram Cloud API keys require the Pro plan; on Free and Starter, sign in above.":
		"Ou autentique com um token em vez de fazer login. As chaves de API Engram exigem o plano Pro; nos planos Free e Starter, faça login acima.",
	"Or authenticate with a token instead of signing in.":
		"Ou autentique com um token em vez de fazer login.",
	"API key": "Chave de API",
	Token: "Token",
	"Bearer token from your Engram account.": "Token de acesso da sua conta Engram.",
	Save: "Salvar",
	"Enter an API key first": "Insira uma chave de API primeiro",
	"That does not look like an Engram API key (expected {prefix}…).":
		"Isso não parece ser uma chave de API do Engram (esperado {prefix}…).",
	Vault: "Cofre",
	"Vault selection": "Seleção do Cofre",
	"Select which vault this plugin syncs with.": "Selecione qual cofre este plugin sincroniza.",
	"No vaults found — first sync will create one":
		"Nenhum cofre encontrado — a primeira sincronização criará um",
	"Pick a vault (previous: '{name}' not found)":
		"Escolha um cofre (anterior: '{name}' não encontrado)",
	"Pick a vault (previous: id {id} not found)":
		"Escolha um cofre (anterior: ID {id} não encontrado)",
	"Pick a vault": "Escolha um cofre",
	"Vault ID: {id}": "ID do Cofre: {id}",
	Change: "Alterar",
	"Support development": "Apoiar o desenvolvimento",
	"If this plugin saves you time, consider supporting development.":
		"Se este plugin economiza seu tempo, considere apoiar o desenvolvimento.",
	"GitHub Sponsors": "GitHub Patrocinadores",
	"Sign-in required to load vaults": "É necessário fazer login para carregar os cofres",
	"Engram Cloud": "Engram Nuvem",
	"Self-hosted": "Hospedado por você",
	Backend: "Backend",
	"Where this vault syncs to. Each backend keeps its own sign-in.":
		"Para onde este cofre é sincronizado. Cada backend tem seu próprio login.",
	"Switched to {mode}.": "Alterado para {mode}.",
	"Not connected. Enter your Engram server URL below to start syncing.":
		"Não conectado. Insira o URL do seu servidor Engram abaixo para iniciar a sincronização.",
	"Run your own Engram server": "Execute seu próprio servidor Engram",
	"Engram is the backend that powers sync and semantic search.":
		"Engram é o backend que alimenta a sincronização e a busca semântica.",
	"Nothing in this vault syncs until you choose how to merge it with the server.":
		"Nada neste cofre é sincronizado até que você escolha como combiná-lo com o servidor.",
	"Choose sync direction": "Escolha a direção da sincronização",
	Bug: "Bug",
	Idea: "Ideia",
	Confusing: "Confuso",
	"Love it": "Adorei",
	"What's working, what's frustrating, what do you wish Engram did?":
		"O que está funcionando, o que é frustrante, o que você gostaria que o Engram fizesse?",
	"This server is self-hosted, so feedback is not collected here. ":
		"Este servidor é auto-hospedado, portanto, os comentários não são coletados aqui. ",
	"Report an issue on GitHub": "Relate um problema no GitHub",
	"Connect to Engram first to send feedback.":
		"Conecte-se ao Engram primeiro para enviar feedback.",
	"Open Connection": "Abrir conexão",
	"What kind of feedback?": "Que tipo de feedback?",
	"Your feedback": "Seu feedback",
	"Tell us anything": "Conte-nos tudo",
	"How do you feel about Engram?": "O que você acha do Engram?",
	"{n} of 5": "{n} de 5",
	"Couldn't send your feedback, please try again.":
		"Não foi possível enviar seu feedback, por favor, tente novamente.",
	"It's OK to email me about this": "Tudo bem enviar um e-mail sobre isso",
	"Sending…": "Enviando…",
	Send: "Enviar",
	"Thanks, we read every message.": "Obrigado, lemos todas as mensagens.",
	"Engram: this plugin is too old to sync (needs {version} or newer). Update it to continue.":
		"Engram: este plugin é muito antigo para sincronizar (requer {version} ou mais recente). Atualize-o para continuar.",
	"Engram: this plugin is too old to sync. Update it to continue.":
		"Engram: este plugin é muito antigo para sincronizar. Atualize-o para continuar.",
	Update: "Atualizar",
};

export default ptBR;
