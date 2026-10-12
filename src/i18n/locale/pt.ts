import type { Dict } from "..";

// Português (do Brasil)
const pt: Dict = {
	"Invalid API key": "Chave de API inválida",
	"Connection failed": "Falha na conexão",
	"Link Obsidian to Engram": "Conectar o Obsidian ao Engram",
	"Failed to start device flow. Check your Engram URL and try again.":
		"Falha ao iniciar o processo de autenticação. Verifique o URL do Engram e tente novamente.",
	"Your code:": "Seu código:",
	"Click to copy": "Clique para copiar",
	"Code copied!": "Código copiado!",
	"A browser window has opened. Sign in and enter this code to link your vault.":
		"Uma janela do navegador foi aberta. Faça login e insira este código para conectar seu cofre.",
	Cancel: "Cancelar",
	"Waiting for authorization — connected, this will complete instantly.":
		"Aguardando autorização — conectado, isso será concluído instantaneamente.",
	"Waiting for authorization — no live connection, checking every 30s.":
		"Aguardando autorização — sem conexão ativa, verificando a cada 30 segundos.",
	"Code expired. Please try again.": "Código expirado. Por favor, tente novamente.",
	"Try again": "Tentar novamente",
	Close: "Fechar",
	"Note couldn't be processed": "Nota não pôde ser processada",
	"The server couldn't process this note. Check its contents, then edit and save to try again.":
		"O servidor não conseguiu processar esta nota. Verifique o conteúdo, edite e salve para tentar novamente.",
	"Attachments need a paid plan": "Anexos requerem um plano pago",
	"The Free tier syncs notes only. Upgrade to sync images and PDFs.":
		"O plano gratuito sincroniza apenas notas. Faça um upgrade para sincronizar imagens e PDFs.",
	"Attachment storage full": "Armazenamento de anexos cheio",
	"You've used all the attachment storage on your plan. Upgrade for more.":
		"Você usou todo o espaço de armazenamento de anexos do seu plano. Faça um upgrade para ter mais espaço.",
	"Too large for the server": "Muito grande para o servidor",
	"The server limit is 5 MB. Compress or split the file, then it will sync.":
		"O limite do servidor é de 5 MB. Comprima ou divida o arquivo, então ele será sincronizado.",
	"Sign-in expired": "Sessão expirada",
	"Reconnect your account to resume syncing.":
		"Reconecte sua conta para retomar a sincronização.",
	"Unresolved conflict": "Conflito não resolvido",
	"Open the file to resolve the conflict, then sync again.":
		"Abra o arquivo para resolver o conflito, depois sincronize novamente.",
	"Frontmatter needs a fix": "O frontmatter precisa de correção",
	"The note synced, but its frontmatter could not be fully parsed. Open it to fix the highlighted line.":
		"A nota foi sincronizada, mas seu frontmatter não pôde ser totalmente analisado. Abra-a para corrigir a linha destacada.",
	"Server error": "Erro no servidor",
	"A temporary server problem — retrying automatically.":
		"Um problema temporário no servidor — tentando novamente automaticamente.",
	"Network unavailable": "Rede indisponível",
	"Can't reach the server — retrying automatically.":
		"Não foi possível acessar o servidor — tentando novamente automaticamente.",
	"Sync failed": "Sincronização falhou",
	"An unexpected error — retrying automatically.":
		"Um erro inesperado — tentando novamente automaticamente.",
	"Frontmatter could not be parsed": "Não foi possível analisar o frontmatter",
	"Note limit reached. Upgrade to keep adding notes.":
		"Limite de notas atingido. Faça um upgrade para continuar adicionando notas.",
	"Vault limit reached. Upgrade for more vaults.":
		"Limite de cofres atingido. Faça um upgrade para ter mais cofres.",
	"This file type isn't accepted by this server.":
		"Este tipo de arquivo não é aceito por este servidor.",
	"Attachment sync is disabled for this account.":
		"A sincronização de anexos está desativada para esta conta.",
	"Attachment storage is full — upgrade for more.":
		"O armazenamento de anexos está cheio — faça um upgrade para mais espaço.",
	"File too large for your plan.": "Arquivo muito grande para o seu plano.",
	"Already signed in on another device. Upgrade for multi-device.":
		"Já conectado em outro dispositivo. Faça um upgrade para usar em vários dispositivos.",
	"Device swap cooldown active. Wait or upgrade.":
		"Período de espera para troca de dispositivo ativo. Aguarde ou faça um upgrade.",
	"Too many connected Obsidian vaults. Disconnect one or upgrade.":
		"Muitos cofres do Obsidian conectados. Desconecte um ou faça um upgrade.",
	"Too many connected AI clients. Disconnect one or upgrade.":
		"Muitos clientes de IA conectados. Desconecte um ou faça um upgrade.",
	"Daily AI search limit reached. Free includes 20 per day across Obsidian, the web app and MCP. Upgrade for unlimited.":
		"Limite diário de buscas por IA atingido. A versão gratuita inclui 20 por dia, entre o Obsidian, o aplicativo web e o MCP. Faça um upgrade para acesso ilimitado.",
	"API keys need Pro. Sign in with your Engram account instead.":
		"Chaves de API requerem a versão Pro. Faça login com sua conta Engram em vez disso.",
	"Account suspended. Contact support.": "Conta suspensa. Entre em contato com o suporte.",
	"Account setup incomplete.": "Configuração da conta incompleta.",
	"This account was deleted. Contact support if that is wrong.":
		"Esta conta foi excluída. Entre em contato com o suporte se isso estiver incorreto.",
	"Finish setting up your account at app.engram.page to start syncing.":
		"Finalize a configuração da sua conta em app.engram.page para começar a sincronizar.",
	"Limit reached. Upgrade to continue.": "Limite atingido. Faça um upgrade para continuar.",
	Upgrade: "Fazer upgrade",
	"Update in settings": "Atualizar nas configurações",
	"Sync now": "Sincronizar agora",
	"Engram sync: syncing...": "Sincronização do Engram: sincronizando...",
	"Engram Sync: pulled {pulled}, pushed {pushed}": "Engram: baixados {pulled}, enviados {pushed}",
	"Disconnect (clear login)": "Desconectar (limpar login)",
	"Engram: disconnected. Open Engram settings to reconnect.":
		"Engram: desconectado. Abra as configurações do Engram para reconectar.",
	"Push entire vault": "Enviar todo o cofre",
	"Engram Sync: pushed {count} files": {
		one: "Engram Sinc: enviou {count} arquivo",
		many: "Engram Sinc: enviadas {count} notas",
		other: "Engram Sinc: enviadas {count} arquivos",
	},
	"Check sync status": "Verificar o status da sincronização",
	"Engram sync: checking...": "Sincronização do Engram: verificando...",
	"Engram sync: server does not support reconciliation (update backend)":
		"Sincronização com o Engram: o servidor não suporta a reconciliação (atualizar o backend)",
	"Engram sync: everything in sync": "Sincronização com o Engram: tudo sincronizado",
	"{count} missing on server": "{count} ausente no servidor",
	"{count} diverged": "{count} divergente",
	"{count} only on server": "{count} apenas no servidor",
	"Engram Sync: {details}": "Sincronização com o Engram: {details}",
	"Pull all from server (force overwrite)": "Baixar tudo do servidor (sobrescrever)",
	"Engram sync: pulling all from server...":
		"Sincronização com o Engram: baixando tudo do servidor...",
	"Engram Sync: pulled {count} files from server": {
		one: "Engram Sinc: baixado {count} arquivo do servidor",
		many: "Engram Sinc: transferidos {count} arquivos do servidor",
		other: "Engram Sinc: transferidos {count} arquivos do servidor",
	},
	"Show sync log": "Mostrar o registro de sincronização",
	"Semantic search": "Busca semântica",
	"Open search sidebar": "Abrir a barra lateral de busca",
	"Engram search": "Busca no Engram",
	"Open sync center": "Abrir a Central de sincronização",
	"Engram: ready": "Engram: pronto",
	"Engram Sync: pushed {pushed}": "Engram Sync: enviado {pushed}",
	"Engram sync: sync failed": "Engram: sincronização falhou",
	"Engram: this vault no longer exists on the server. Pick or create a vault to continue.":
		"Engram: este cofre não existe mais no servidor. Selecione ou crie um cofre para continuar.",
	"Engram: recovered plugin settings from a backup after a corrupted save.":
		"Engram: configurações do plugin restauradas de um backup após um salvamento corrompido.",
	"Engram: plugin settings file was corrupted and could not be recovered. You may need to reconnect in settings.":
		"Engram: o arquivo de configurações do plugin foi corrompido e não pôde ser recuperado. Você pode precisar reconectar nas configurações.",
	"Engram: your login expired — open Engram settings to reconnect.":
		"Engram: sua sessão expirou — abra as configurações do Engram para reconectar.",
	"Engram: This vault has been deleted on the server.":
		"Engram: este cofre foi excluído no servidor.",
	"Engram sync: live sync requires a plugin update — please update the Engram vault sync plugin.":
		"Engram: a sincronização em tempo real requer uma atualização do plugin — atualize o plugin de sincronização do Engram.",
	"Engram Sync: pulled {pulled} (local extras deleted)":
		"Engram Sync: recebido {pulled} (extras locais excluídos)",
	"Engram Sync: pulled {pulled}": "Engram Sync: recebido {pulled}",
	"Engram Sync: replaced remote with local ({pushed} uploaded)":
		"Engram Sync: substituiu a versão remota pela local ({pushed} enviados)",
	"Engram: sync is not set up yet, so nothing in this vault will sync.":
		"Engram: a sincronização ainda não está configurada, então nada neste cofre será sincronizado.",
	"Finish sync setup": "Finalizar configuração de sincronização",
	"Engram: sync is paused. This edit was not synced. Choose a sync direction to resume.":
		"Engram: a sincronização está pausada. Esta edição não foi sincronizada. Escolha uma direção de sincronização para retomar.",
	"Open Engram settings": "Abrir configurações do Engram",
	"Engram: sync failed. Open the sync log for details.":
		"Engram: a sincronização falhou. Abra o registro de sincronização para detalhes.",
	"Engram: not connected": "Engram: não conectado",
	"Engram: signed out": "Engram: desconectado",
	"Not connected yet. Click to open settings and link this vault.":
		"Ainda não conectado. Clique para abrir as configurações e vincular este cofre.",
	"Not signed in. Click to open settings and reconnect.":
		"Não conectado. Clique para abrir as configurações e reconectar.",
	"Engram: finish setup": "Engram: finalizar configuração",
	"Engram: sync paused": "Engram: sincronização pausada",
	"{label} ({count} queued)": "{label} ({count} na fila)",
	"Setup is not finished — nothing will sync until you choose a sync direction. Click to finish.":
		"A configuração não foi finalizada — nada será sincronizado até que você escolha uma direção de sincronização. Clique para finalizar.",
	"Sync paused — click to choose a sync direction":
		"Sincronização pausada — clique para escolher a direção da sincronização",
	"Engram: offline ({count} queued)": "Engram: offline ({count} na fila)",
	"Engram: offline": "Engram: sem rede",
	"Server unreachable — changes will sync when connected":
		"Servidor inacessível — as alterações serão sincronizadas quando conectado",
	"Engram: error": "Engram: erro",
	"Unknown error": "Erro desconhecido",
	"Engram: syncing ({count})": "Engram: sincronizando ({count})",
	"Engram: syncing": "Engram: sincronizando",
	"Sync in progress...": "Sincronização em andamento...",
	"Engram: pending ({count})": "Engram: pendente ({count})",
	"{count} files queued": {
		one: "{count} arquivo na fila",
		many: "{count} arquivos na fila",
		other: "{count} arquivos na fila",
	},
	"Engram: live": "Engram: online",
	"WebSocket connected — live sync active":
		"WebSocket conectado — sincronização em tempo real ativa",
	"Click to sync": "Clique para sincronizar",
	"Engram: ⚠ {count} sync errors": {
		one: "Engram: ⚠ {count} erro de sincronização",
		many: "Engram: ⚠ {count} erros de sincronização",
		other: "Engram: ⚠ {count} erros de sincronização",
	},
	"Last sync: {when}": "Última sincronização: {when}",
	"Engram Sync: pulled {count} changes": {
		one: "Engram Sinc: {count} alteração sincronizada",
		many: "Engram Sinc: atualizadas {count} versões",
		other: "Engram Sinc: {count} alterações sincronizadas",
	},
	'Engram Sync: sync state for "{name}" was unreadable — using the on-disk copy.':
		'Engram Sync: o estado de sincronização de "{name}" não pôde ser lido — usando a cópia no disco.',
	"Engram Vault Sync {version} is available. {link}.":
		"Engram Vault Sync {version} disponível. {link}.",
	"{formatted} files · ": {
		one: "{formatted} arquivo ·",
		many: "{formatted} arquivos ·",
		other: "{formatted} arquivos ·",
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
		'corresponde às suas palavras e a outras formas delas — "correr" encontra "correndo" — além deste dispositivo.',
	"matches meaning. Finds notes that never use the words you typed.":
		"corresponde ao significado. Encontra notas que nunca usam as palavras que você digitou.",
	"matches words and meaning together, plus this device. Widest results.":
		"corresponde a palavras e significado juntos, além deste dispositivo. Resultados mais amplos.",
	"Engram indexes {indexed} of your {all} notes. The rest match on this device only. Upgrade to index everything.":
		"O Engram indexa {indexed} de suas {all} notas. O restante corresponde apenas neste dispositivo. Faça um upgrade para indexar tudo.",
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
	"Search failed — check connection": "A busca falhou — verifique a conexão",
	"No results found": "Nenhum resultado encontrado",
	Untitled: "Sem título",
	"meaning + exact": "significado + exato",
	"match strength: {pct}%": "força da correspondência: {pct}%",
	"No source path for this result": "Nenhum caminho de origem para este resultado",
	"Note not synced locally": "Nota não sincronizada localmente",
	"Syncing...": "Sincronizando...",
	"👋 Welcome": "👋 Bem-vindo",
	"🔌 Connection": "🔌 Conexão",
	"🔄 Sync Center": "🔄 Central de sincronização",
	"⚙️ Advanced": "⚙️ Avançado",
	"Engram: settings tab failed to render ({error})":
		"Engram: a guia de configurações falhou ao carregar ({error})",
	Disconnected: "Desconectado",
	"Error: {error}": "Erro: {error}",
	unknown: "desconhecido",
	"Connected — waiting for first sync decision":
		"Conectado — aguardando a primeira decisão de sincronização",
	"Connected — live sync active": "Conectado — sincronização ativa",
	"Connected — polling": "Conectado — verificando",
	"Not configured": "Não configurado",
	"Open sync setup": "Abrir configuração de sincronização",
	"waiting for a connection": "aguardando conexão",
	"sync is paused": "sincronização pausada",
	"syncing now": "sincronizando agora",
	"waiting to retry": "aguardando nova tentativa",
	"{count} not on your plan": "{count} não incluso no seu plano",
	"{count} need attention": {
		one: "{count} precisa de atenção",
		many: "{count} precisa de atenção",
		other: "{count} precisam de atenção",
	},
	"{count} retrying": "{count} tentando novamente",
	"{count} ignored": "{count} ignorado",
	"{count} queued — {reason}": "{count} na fila — {reason}",
	"Sync...": "Sincronizando...",
	"sync failed": "sincronização falhou",
	Refresh: "Atualizar",
	"Not synced on your plan ({count})": "Não sincronizado no seu plano ({count})",
	"These files are fine. They just need a paid plan to sync.":
		"Esses arquivos estão ok. Eles só precisam de um plano pago para sincronizar.",
	"Show files ({count}) ▾": "Mostrar arquivos ({count}) ▾",
	"Sync these now": "Sincronizar agora",
	"Needs attention ({count})": "Requer atenção ({count})",
	"Clear all": "Limpar tudo",
	"Nothing needs your attention. 🎉": "Nada precisa da sua atenção. 🎉",
	Dismiss: "Cancelar",
	"Retrying automatically ({count})": "Tentando novamente automaticamente ({count})",
	"Retry all now": "Tentar novamente tudo agora",
	"Temporary errors. These clear themselves once the server recovers.":
		"Erros temporários. Eles desaparecem quando o servidor se recupera.",
	"{count} attempts": {
		one: "{count} tentativa",
		many: "{count} tentativas",
		other: "{count} tentativas",
	},
	Open: "Abrir",
	Ignore: "Ignorar",
	"No files ignored. Use the ignore button on a failure row to stop syncing it.":
		'Nenhum arquivo ignorado. Use o botão "ignorar" em uma linha de erro para interromper a sincronização.',
	Restore: "Restaurar",
	"File not found locally: {path}": "Arquivo não encontrado localmente: {path}",
	"Ignored {path} — won't sync until restored from Sync Center.":
		"Ignorado {path} — não será sincronizado até ser restaurado na Central de sincronização.",
	"Restored {path} — will sync on next push.":
		"Restaurado {path} — será sincronizado no próximo envio.",
	Clear: "Limpar",
	"No activity yet. Push or pull to see entries here.":
		"Ainda não há atividades. Envie ou receba para ver os registros aqui.",
	Stats: "Estatísticas",
	"Notes on this device": "Notas neste dispositivo",
	"Attachments on this device": "Anexos neste dispositivo",
	"Remote vault": "Cofre remoto",
	"not linked": "não vinculado",
	"Plan usage": "Uso do plano",
	"Sync log": "Registro de sincronização",
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
		"Sua sessão expirou. Faça login novamente nas configurações do Engram para continuar.",
	"Couldn't create vault — the name may be invalid or already in use.":
		"Não foi possível criar o cofre — o nome pode ser inválido ou já estar em uso.",
	"Could not create the vault — check your connection and try again.":
		"Não foi possível criar o cofre — verifique sua conexão e tente novamente.",
	"Free syncs notes only — {count} attachments will be skipped.": {
		one: "Sincroniza notas gratuitamente, mas apenas {count} anexo será ignorado.",
		many: "Sincroniza notas gratuitamente, mas apenas {count} anexos serão sincronizados.",
		other: "Sincroniza notas gratuitamente, mas apenas {count} anexos serão sincronizados.",
	},
	"Uploads {up}, downloads {down}.": "Envio {up}, download {down}.",
	"Uploads {count}.": "Envio {count}.",
	"Downloads {count}.": "Download {count}.",
	"{count} conflicts to resolve.": {
		one: "{count} conflito a resolver.",
		many: "{count} conflitos a resolver.",
		other: "{count} conflitos a resolver.",
	},
	"Safe choice: combines both sides, nothing is deleted.":
		"Opção segura: combina ambos os lados, nada é excluído.",
	"Nothing is deleted.": "Nada é excluído.",
	"Already in sync. Nothing is deleted.": "Já está sincronizado. Nada é excluído.",
	"Delete all {count} files currently on the server": {
		one: "Excluir todos os {count} arquivo atualmente no servidor",
		many: "Excluir todos os arquivos {count} atualmente no servidor",
		other: "Excluir todos os {count} arquivos atualmente no servidor",
	},
	"Upload {count} files from this vault": {
		one: "Enviar {count} arquivo deste cofre",
		many: "Carregar {count} arquivos deste cofre",
		other: "Enviar {count} arquivos deste cofre",
	},
	"Delete all {count} files in this vault": {
		one: "Excluir todos os {count} arquivo neste cofre",
		many: "Excluir todos os arquivos {count} neste cofre",
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
		"Exclua tudo no remoto e, em seguida, envie os arquivos locais",
	"Download remote files without uploading the local":
		"Baixe arquivos remotos sem enviar os locais",
	"Delete all local files, then download from remote":
		"Excluir todos os arquivos locais e, em seguida, baixar do servidor",
	"Set up sync for this vault": "Configurar a sincronização para este cofre",
	"You are now pointing at a different cloud vault":
		"Você está agora apontando para um cofre na nuvem diferente",
	"Sync preview": "Visualização da sincronização",
	"Nothing to sync yet — this vault is empty on both sides. Start syncing and everything you write appears on your other devices.":
		"Ainda não há nada para sincronizar — este cofre está vazio em ambos os lados. Comece a sincronizar e tudo o que você escreve aparecerá em seus outros dispositivos.",
	"Start syncing": "Iniciar a sincronização",
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
	" conflicts need resolution": {
		one: "conflito precisa ser resolvido",
		many: "conflitos precisam ser resolvidos",
		other: "conflitos precisam ser resolvidos",
	},
	notes: "notas",
	attachments: "anexos",
	folders: "pastas",
	"Confirm destructive sync": "Confirmar sincronização destrutiva",
	"You are about to:": "Você está prestes a:",
	"Files that will be deleted:": "Arquivos que serão excluídos:",
	"This cannot be undone.": "Isso não pode ser desfeito.",
	Back: "Voltar",
	Confirm: "Confirmar",
	"Switch vault": "Alternar cofre",
	"Pick a vault to sync with. We will recalculate the sync preview after you choose.":
		"Escolha um cofre para sincronizar. Recalcularemos a prévia da sincronização após você escolher.",
	"Loading vaults…": "Carregando cofres…",
	" (default)": "(padrão)",
	"No other vaults available.": "Nenhum outro cofre disponível.",
	"Make new vault": "Criar novo cofre",
	"New vault": "Novo cofre",
	"Create a new empty vault on the server, then sync this Obsidian vault into it.":
		"Crie um novo cofre vazio no servidor e, em seguida, sincronize este cofre do Obsidian com ele.",
	"Vault name": "Nome do cofre",
	Create: "Criar",
	"Could not load vaults": "Não foi possível carregar os cofres",
	"Enter a name for the new vault": "Digite um nome para o novo cofre",
	"Failed to switch vault": "Falha ao alternar de cofre",
	"Your vault shares {percent} of its data with Engram":
		"Seu cofre compartilha {percent} de seus dados com o Engram",
	"Type {keyword} to confirm:": "Digite {keyword} para confirmar:",
	"Uploading {count}.": "Enviando {count}.",
	"Downloading {count}.": "Baixando {count}.",
	"Deleting {count} local files.": {
		one: "Excluindo {count} arquivo local.",
		many: "Excluindo {count} arquivos locais.",
		other: "Excluindo {count} arquivos locais.",
	},
	"Deleting {count} on the cloud.": "Excluindo {count} na nuvem.",
	"First sync, this may take a moment.":
		"Primeira sincronização, isso pode levar alguns instantes.",
	"Checking for changes.": "Verificando alterações.",
	"Nothing will be deleted.": "Nada será excluído.",
	"✓ {count} synced": "✓ {count} sincronizado",
	"⤳ {count} skipped (Free plan)": "⤳ {count} ignorado (plano gratuito)",
	"✕ {count} failed": "✕ {count} falhou",
	"{count} attachments need a paid plan to sync. See Sync Center.": {
		one: "{count} anexo precisa de um plano pago para sincronizar. Veja a Central de sincronização.",
		many: "{count} Anexos precisam de um plano pago para sincronizar. Veja a Central de sincronização.",
		other: "{count} anexos precisam de um plano pago para sincronizar. Veja a Central de sincronização.",
	},
	"Finished with some errors. Open the sync log to see what failed.":
		"Finalizado com alguns erros. Abra o registro de sincronização para ver o que falhou.",
	"Synced. Some attachments need a paid plan to sync (see below).":
		"Sincronizado. Alguns anexos precisam de um plano pago para sincronizar (veja abaixo).",
	"All synced. Your vault and the cloud now match.":
		"Tudo sincronizado. Seu cofre e a nuvem agora estão sincronizados.",
	"Already up to date. Nothing needed syncing.":
		"Já está atualizado. Nada precisa ser sincronizado.",
	Deleting: "Excluindo",
	Downloading: "Baixando",
	Uploading: "Enviando",
	"Syncing your vault": "Sincronizando seu cofre",
	"Getting started…": "Iniciando…",
	"Open Engram to check your vault and confirm everything synced.":
		"Abra o Engram para verificar seu cofre e confirmar se tudo foi sincronizado.",
	"Open Engram": "Abrir Engram",
	"You can close this and the sync keeps running in the background.":
		"Você pode fechar isso e a sincronização continua em segundo plano.",
	"Run in background": "Executar em segundo plano",
	"Syncing…": "Sincronizando…",
	"Sync complete": "Sincronização completa",
	"Syncing attachments": "Sincronizando anexos",
	Complete: "Completo",
	'{count} failed. Run "{command}" for details.':
		'{count} falhou. Execute "{command}" para detalhes.',
	"Free syncs notes only — images & PDFs need a paid plan.":
		"Sincroniza notas gratuitamente — imagens e PDFs precisam de um plano pago.",
	"Engram: {count} files failed to sync{detail} — open Sync Center": {
		one: "Engram: {count} arquivo falhou na sincronização{detail} — abra a Central de sincronização",
		many: "Engram: {count} arquivos falharam na sincronização{detail} — abra a Central de sincronização",
		other: "Engram: {count} arquivos falharam na sincronização{detail} — abra a Central de sincronização",
	},
	"Engram: {count} attachments skipped — upgrade to sync images & PDFs.": {
		one: "Engram: {count} anexo ignorado — atualize para sincronizar imagens e PDFs.",
		many: "Engram: {count} anexos ignorados — atualize para sincronizar imagens e PDFs.",
		other: "Engram: {count} anexos ignorados — atualize para sincronizar imagens e PDFs.",
	},
	"Engram: plan upgraded — syncing {count} attachments…": {
		one: "Engram: plano atualizado — sincronizando {count} anexo…",
		many: "Engram: plano atualizado — sincronizando {count} anexos…",
		other: "Engram: plano atualizado — sincronizando {count} anexos…",
	},
	"Pull all (delete extras) aborted: could not obtain an exclusive server snapshot (replay contention). Nothing was trashed.":
		"A sincronização de todos (excluindo duplicatas) foi interrompida: não foi possível obter um instantâneo exclusivo do servidor (conflito de replicação). Nada foi excluído.",
	"Pull all aborted: another sync is running (replay contention). Try again when it finishes.":
		"A sincronização de todos foi interrompida: outra sincronização está em andamento (conflito de replicação). Tente novamente quando terminar.",
	"Pull all failed: {error}": "A sincronização de todos falhou: {error}",
	"Pull all failed": "A sincronização de todos falhou",
	"Engram: sync conflict on {path} — your local edit was saved as {copy}":
		"Engram: conflito de sincronização em {path} — sua edição local foi salva como {copy}",
	"Open note": "Abrir nota",
	"Engram: {count} notes have frontmatter problems. Open Sync Center to fix.":
		"Engram: {count} notas têm problemas no frontmatter. Abra a Central de sincronização para corrigir.",
	'Engram Sync: renamed "{name}" (unsupported characters)':
		'Engram Sync: renomeado "{name}" (caracteres não suportados)',
	'Engram: frontmatter problem in "{name}"': 'Engram: problema no frontmatter em "{name}"',
	"Engram: this plugin is too old to sync (needs {version} or newer). Update it to continue.":
		"Engram: este plugin está muito antigo para sincronizar (requer {version} ou superior). Atualize-o para continuar.",
	"Engram: this plugin is too old to sync. Update it to continue.":
		"Engram: este plugin está muito antigo para sincronizar. Atualize-o para continuar.",
	Update: "Atualizar",
	"New here? Watch the setup video": "Novo por aqui? Assista ao vídeo de configuração",
	"What Engram does, and how to connect your vault, start to finish.":
		"O que o Engram faz e como conectar seu cofre, do início ao fim.",
	"▶ Watch on YouTube": "▶ Assistir no YouTube",
	"Getting set up": "Configurando",
	"1. Make an account": "1. Crie uma conta",
	"Create a hosted account at ": "Crie uma conta hospedada em",
	", or self-host the backend (": ", ou hospede o backend você mesmo (",
	"setup guide": "guia de configuração",
	"2. Connect your vault to Engram": "2. Conecte seu cofre ao Engram",
	"Sign in (or enter your server URL and key) on the connection tab, then run your first sync.":
		"Faça login (ou insira o URL do seu servidor e a chave) na aba de conexão e, em seguida, execute sua primeira sincronização.",
	"Open connection tab": "Abrir aba de conexão",
	"3. Connect your AI": "3. Conecte sua IA",
	"Link Claude, Cursor, ChatGPT, or any MCP app so it can read and write your notes. ":
		"Conecte Claude, Cursor, ChatGPT ou qualquer aplicativo MCP para que ele possa ler e escrever suas notas",
	"See the AI setup guide": "Veja o guia de configuração da IA",
	Plans: "Planos",
	Free: "Gratuito",
	"1 vault, 2 devices": "1 cofre, 2 dispositivos",
	"Real-time sync": "Sincronização em tempo real",
	"2,000 notes searchable": "2.000 notas pesquisáveis",
	"Connect any AI (MCP)": "Conecte qualquer IA (MCP)",
	Starter: "Básico",
	"10 vaults, unlimited devices": "10 cofres, dispositivos ilimitados",
	"Search all your notes": "Pesquise todas as suas notas",
	"10 GB attachments": "10 GB de anexos",
	"Unlimited AI searches": "Pesquisas ilimitadas por IA",
	Pro: "Versão Pro",
	"Unlimited vaults": "Cofres ilimitados",
	"Search across all vaults at once": "Pesquise em todos os cofres de uma vez",
	"50 GB attachments": "50 GB de anexos",
	"API access": "Acesso à API",
	"See full pricing": "Ver preços completos",
	"Learn more": "Saiba mais",
	Documentation: "Documentação",
	"AI / MCP setup guide": "Guia de configuração de IA / MCP",
	"Report an issue": "Reportar um problema",
	"Join our Discord": "Junte-se ao nosso Discord",
	"Node.js dependencies": "Dependências do Node.js",
	"Python virtual environment": "Ambiente virtual do Python",
	"Python bytecode cache": "Cache de bytecode do Python",
	"Vendored dependencies": "Dependências incluídas",
	"Gradle build cache": "Cache de compilação do Gradle",
	"Rust/Java build output": "Saída da compilação Rust/Java",
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
		"Envie atividades detalhadas de sincronização, cofre e conexão para o servidor para solução de problemas, com rastreamento distribuído nas requisições. Metadados apenas, nunca o conteúdo das notas. Desative para uso normal.",
	"Diagnostics detail": "Detalhes dos diagnósticos",
	"Minimum severity that ships while diagnostics are on. Higher levels send fewer lines. Default: Info.":
		"Nível mínimo de severidade enviado quando os diagnósticos estão ativados. Níveis mais altos enviam menos linhas. Padrão: Info.",
	"Errors only": "Erros apenas",
	"Warnings and errors": "Avisos e erros",
	"Info (default)": "Info (padrão)",
	"Debug (verbose)": "Debug (detalhado)",
	About: "Sobre",
	"License: {name}": "Licença: {name}",
	"⚠ Detected: {label}/ ({formatted} files)": "⚠ Detectado: {label} ({formatted} arquivos)",
	"{desc} — should not be synced": "{desc} — não deve ser sincronizado",
	"Add to ignores": "Adicionar aos ignorados",
	"Added {pattern} to ignore patterns": "Adicionado {pattern} aos padrões ignorados",
	"Version: {version}": "Versão: {version}",
	"Source: {link}": "Fonte: {link}",
	"Engram URL": "URL do Engram",
	"✓ Engram server reachable (v{version})": "✓ Servidor do Engram acessível (v{version})",
	"✗ server responded but isn't an Engram backend":
		"✗ O servidor respondeu, mas não é um servidor backend do Engram",
	"✗ couldn't reach a server at this URL": "✗ Não foi possível acessar um servidor neste URL",
	"Checking server…": "Verificando o servidor…",
	"That does not look like a complete server address. Include the scheme, for example http://127.0.0.1:4000":
		"Isso não parece um endereço de servidor completo. Inclua o protocolo, por exemplo http://127.0.0.1:4000",
	"Engram backend changed — sign in again to continue.":
		"O backend do Engram foi alterado — faça login novamente para continuar.",
	Authentication: "Autenticação",
	"Signed in as {email}": "Logado como {email}",
	"Authenticated via Engram account (OAuth).": "Autenticado via conta Engram (OAuth).",
	"Manage account": "Gerenciar conta",
	"Sign out": "Sair",
	"Using API key": "Usando chave de API",
	"Authenticated via manual API key.": "Autenticado via chave de API manual.",
	"Clear key": "Limpar chave",
	"Switch to sign in": "Mudar para login",
	"Engram: sign-in failed ({error})": "Engram: falha ao fazer login ({error})",
	"Sign in or create an account": "Faça login ou crie uma conta",
	"Opens your browser to sign in, or create an account if you don't have one yet, then links this vault.":
		"Abre seu navegador para fazer login ou criar uma conta, caso ainda não tenha, e então vincula este cofre.",
	"Sign in": "Fazer login",
	"Or authenticate with a token instead of signing in. Engram Cloud API keys require the Pro plan; on Free and Starter, sign in above.":
		"Ou autentique com um token em vez de fazer login. As chaves da API do Engram Cloud exigem o plano Pro; nos planos Free e Starter, faça login acima.",
	"Or authenticate with a token instead of signing in.":
		"Ou autentique com um token em vez de fazer login.",
	"API key": "Chave da API",
	Token: "Token",
	"Bearer token from your Engram account.": "Token de acesso da sua conta Engram.",
	Save: "Salvar",
	"Enter an API key first": "Insira uma chave da API primeiro",
	"That does not look like an Engram API key (expected {prefix}…).":
		"Isso não parece ser uma chave da API do Engram (esperado {prefix}…).",
	Vault: "Cofre",
	"Vault selection": "Seleção do Cofre",
	"Select which vault this plugin syncs with.":
		"Selecione o cofre com o qual este plugin sincroniza.",
	"No vaults found — first sync will create one":
		"Nenhum cofre encontrado — a primeira sincronização criará um",
	"Pick a vault (previous: '{name}' not found)":
		"Escolha um cofre (anterior: '{name}' não encontrado)",
	"Pick a vault (previous: id {id} not found)":
		"Escolha um cofre (anterior: id {id} não encontrado)",
	"Pick a vault": "Escolha um cofre",
	Change: "Alterar",
	"Support development": "Apoie o desenvolvimento",
	"If this plugin saves you time, consider supporting development.":
		"Se este plugin economiza seu tempo, considere apoiar o desenvolvimento.",
	"GitHub Sponsors": "GitHub Sponsors",
	"Sign-in required to load vaults": "É necessário fazer login para carregar os cofres",
	"Server error ({status}) — check Engram logs":
		"Erro no servidor ({status}) — verifique os logs do Engram",
	"Request failed ({status})": "Solicitação falhou ({status})",
	"Could not reach Engram — check connection":
		"Não foi possível acessar o Engram — verifique a conexão",
	"Engram Cloud": "Engram Cloud",
	"Self-hosted": "Auto-hospedado",
	Backend: "Backend",
	"Where this vault syncs to. Each backend keeps its own sign-in.":
		"Para onde este cofre é sincronizado. Cada backend tem sua própria forma de login.",
	"Switched to {mode}.": "Alternado para {mode}.",
	"Not connected. Enter your Engram server URL below to start syncing.":
		"Não conectado. Insira o URL do seu servidor Engram abaixo para iniciar a sincronização.",
	"Run your own Engram server": "Execute seu próprio servidor Engram",
	"Engram is the backend that powers sync and semantic search.":
		"Engram é o backend que alimenta a sincronização e a busca semântica.",
	"Nothing in this vault syncs until you choose how to merge it with the server.":
		"Nada neste cofre é sincronizado até que você escolha como combiná-lo com o servidor.",
	"Choose sync direction": "Escolha a direção da sincronização",
	"...": "...",
	'... "{name}" ...': '... "{name}" ...',
};

export default pt;
