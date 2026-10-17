import type { Dict } from "..";

// Português (do Brasil)
const ptBR: Dict = {
	" (default)": " (padrão)",
	"(top level)": "(nível superior)",
	"({count} errors)": {
		one: "({count} erro)",
		many: "({count} erros)",
		other: "({count} erros)",
	},
	"...": "...",
	'... "{name}" ...': '... "{name}" ...',
	"1 vault, 2 devices": "1 Cofre, 2 dispositivos",
	"1. Make an account": "1. Crie uma conta",
	"10 GB attachments": "10 GB de anexos",
	"10 vaults, unlimited devices": "10 Cofres, dispositivos ilimitados",
	"2. Connect your vault to Engram": "2. Conecte seu cofre ao Engram",
	"3,000 notes, all searchable": "3.000 notas, todas pesquisáveis",
	"3. Connect your AI": "3. Conecte sua IA",
	"50 GB attachments": "50 GB de anexos",
	"A browser window has opened. Sign in and enter this code to link your vault.":
		"Uma janela do navegador foi aberta. Faça login e insira este código para vincular seu cofre.",
	"A frontmatter key could not be parsed as YAML.":
		"Uma chave do frontmatter não pôde ser interpretada como YAML.",
	"A temporary server problem — retrying automatically.":
		"Um problema temporário no servidor — tentando novamente automaticamente.",
	"AI / MCP setup guide": "Guia de configuração de IA / MCP",
	"AI searches": "Pesquisas de IA",
	"API access": "Acesso à API",
	"API key": "Chave de API",
	"API keys need a Pro plan. Sign in with your Engram account instead.":
		"As chaves de API precisam de um plano Pro. Faça login com sua conta Engram em vez disso.",
	About: "Sobre",
	"Accept it to keep syncing.": "Aceite para continuar sincronizando.",
	"Access token": "Token de acesso",
	"Account setup incomplete.": "Configuração da conta incompleta.",
	"Account suspended. Contact support.": "Conta suspensa. Entre em contato com o suporte.",
	"Activity ({count})": "Atividade ({count})",
	"Add to ignores": "Adicionar aos ignorados",
	"Added {pattern} to ignore patterns": "Adicionado {pattern} aos padrões ignorados",
	"Advanced sync options": "Opções avançadas de sincronização",
	"All synced. Your vault and the cloud now match.":
		"Tudo sincronizado. Seu cofre e a nuvem agora estão idênticos.",
	"Already in sync. Nothing is deleted.": "Já está sincronizado. Nada é excluído.",
	"Already signed in on another device. Upgrade for multi-device.":
		"Já conectado em outro dispositivo. Faça um upgrade para acesso em múltiplos dispositivos.",
	"Already up to date. Nothing needed syncing.":
		"Já está atualizado. Não há nada para sincronizar.",
	"An unexpected error — retrying automatically.":
		"Um erro inesperado — tentando novamente automaticamente.",
	"Attachment storage full": "Armazenamento de anexos cheio",
	"Attachment storage is full — upgrade for more.":
		"O armazenamento de anexos está cheio — faça um upgrade para mais espaço.",
	"Attachment sync is disabled for this account.":
		"A sincronização de anexos está desativada para esta conta.",
	Attachments: "Anexos",
	"Attachments need a paid plan": "Anexos requerem um plano pago",
	"Attachments on this device": "Anexos neste dispositivo",
	"Authenticated via Engram account (OAuth).": "Autenticado via conta Engram (OAuth).",
	"Authenticated via manual API key.": "Autenticado via chave de API manual.",
	Authentication: "Autenticação",
	Back: "Voltar",
	"Bearer token from your Engram account.": "Token de acesso da sua conta Engram.",
	Both: "Ambos",
	Bug: "Bug",
	"Build output": "Saída da compilação",
	"Can't reach the server — retrying automatically.":
		"Não foi possível acessar o servidor — tentando novamente automaticamente.",
	Cancel: "Cancelar",
	"Cargo cache": "Cache do Cargo",
	Change: "Alterar",
	"Change vault": "Alterar cofre",
	"Check sync status": "Verificar o status da sincronização",
	"Checking for changes.": "Verificando alterações.",
	"Checking server…": "Verificando servidor…",
	"Choose sync direction": "Escolha a direção da sincronização",
	Clear: "Limpar",
	"Clear all": "Limpar tudo",
	"Clear key": "Limpar chave",
	"Clear search": "Limpar pesquisa",
	"Click to copy": "Clique para copiar",
	"Click to sync": "Clique para sincronizar",
	Close: "Fechar",
	"Cloud server": "Servidor na nuvem",
	"CocoaPods dependencies": "Dependências do CocoaPods",
	"Code copied!": "Código copiado!",
	"Code expired. Please try again.": "Código expirado. Tente novamente.",
	"Comparing your vault with the cloud…": "Comparando seu cofre com a nuvem…",
	Complete: "Completo",
	Confirm: "Confirmar",
	"Confirm destructive sync": "Confirmar sincronização que apaga dados",
	Conflict: "Conflito",
	Confusing: "Confuso",
	"Connect any AI (MCP)": "Conecte qualquer IA (MCP)",
	"Connect to Engram first to send feedback.":
		"Conecte-se ao Engram primeiro para enviar feedback.",
	"Connected — live sync active": "Conectado — sincronização em tempo real ativa",
	"Connected — polling": "Conectado — verificando",
	"Connected — waiting for first sync decision":
		"Conectado — aguardando a primeira decisão de sincronização",
	"Connection failed": "Falha na conexão",
	Continue: "Continuar",
	"Could not compare with the cloud. Check your connection.":
		"Não foi possível comparar com a nuvem. Verifique sua conexão.",
	"Could not create the vault — check your connection and try again.":
		"Não foi possível criar o cofre — verifique sua conexão e tente novamente.",
	"Could not load vaults: {error}": "Não foi possível carregar os cofres: {error}",
	"Could not reach Engram — check connection":
		"Não foi possível acessar Engram — verifique a conexão",
	"Could not save your folder choice. Try again.":
		"Não foi possível salvar sua escolha de pasta. Tente novamente.",
	"Couldn't create vault — the name may be invalid or already in use.":
		"Não foi possível criar o cofre — o nome pode ser inválido ou já estar em uso.",
	"Couldn't send your feedback, please try again.":
		"Não foi possível enviar seu feedback, por favor, tente novamente.",
	Create: "Criar",
	"Create a hosted account at {signup}, or self-host the server ({guide}).":
		"Crie uma conta hospedada em {signup}, ou hospede o servidor você mesmo ({guide}).",
	"Create a new empty vault on the server, then sync this Obsidian vault into it.":
		"Crie um novo cofre vazio no servidor e, em seguida, sincronize este cofre Obsidian para ele.",
	"Custom patterns": "Padrões personalizados",
	"Daily AI search limit reached. Free includes 20 per day across Obsidian, the web app and MCP. Upgrade for unlimited.":
		"Limite diário de buscas por IA atingido. A versão gratuita inclui 20 por dia, distribuídos entre Obsidian, o aplicativo web e MCP. Faça um upgrade para acesso ilimitado.",
	"Dart tool cache": "Cache de ferramentas Dart",
	"Debug (verbose)": "Debug (detalhado)",
	"Delete all local files, then download from remote":
		"Exclua todos os arquivos locais, depois baixe do remoto",
	"Delete all on remote, then upload local files":
		"Exclua tudo no remoto, depois envie os arquivos locais",
	"Delete all {count} files currently on the server": {
		one: "Excluir todos os {count} arquivos atualmente no servidor",
		many: "Excluir todos os {count} de arquivos atualmente no servidor",
		other: "Excluir todos os {count} arquivos atualmente no servidor",
	},
	"Delete all {count} files in this vault": {
		one: "Excluir todos os {count} arquivos neste cofre",
		many: "Excluir todos os {count} arquivos neste cofre",
		other: "Excluir todos os {count} arquivos neste cofre",
	},
	Deleted: "Excluído",
	Deleting: "Excluindo",
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
	"Device swap cooldown active. Wait or upgrade.":
		"Período de espera para troca de dispositivo ativo. Aguarde ou faça um upgrade.",
	Diagnostics: "Diagnósticos",
	"Diagnostics detail": "Detalhes dos diagnósticos",
	"Disconnect (clear login)": "Desconectar (limpar login)",
	Disconnected: "Desconectado",
	Dismiss: "Dispensar",
	"Distribution build output": "Saída da compilação de distribuição",
	Documentation: "Documentação",
	Done: "Concluído",
	"Download everything": "Baixar tudo",
	"Download remote files without uploading the local":
		"Baixe arquivos remotos sem enviar os locais",
	"Download {count} files from the server": {
		one: "Baixar {count} arquivo do servidor",
		many: "Baixar {count} arquivos do servidor",
		other: "Baixar {count} arquivos do servidor",
	},
	Downloading: "Baixando",
	"Downloading {count}.": {
		one: "Baixando {count}.",
		many: "Baixando {count}.",
		other: "Baixando {count}.",
	},
	"Engram Cloud": "Engram Nuvem",
	"Engram Sync: pulled {count} changes": {
		one: "Engram Sincronização: {count} alteração sincronizada",
		many: "Engram Sincronização: transferidos {count} itens",
		other: "Engram Sincronização: {count} alterações sincronizadas",
	},
	"Engram Sync: pulled {count} files from server": {
		one: "Engram Sincronização: baixados {count} arquivo(s) do servidor",
		many: "Engram Sincronização: transferidos {count} arquivos do servidor",
		other: "Engram Sincronização: baixados {count} arquivos do servidor",
	},
	"Engram Sync: pulled {pulled}": "Engram Sincronização: recebeu {pulled}",
	"Engram Sync: pulled {pulled} (local extras deleted)":
		"Engram Sincronização: recebeu {pulled} (extras locais excluídos)",
	"Engram Sync: pulled {pulled}, pushed {pushed}":
		"Engram Sincronização: baixados {pulled}, enviados {pushed}",
	"Engram Sync: pushed {count} files": {
		one: "Engram Sincronização: enviadas {count} arquivo(s)",
		many: "Engram Sincronização: enviadas {count} de arquivos",
		other: "Engram Sincronização: enviadas {count} arquivos",
	},
	"Engram Sync: pushed {pushed}": "Engram Sincronização: enviou {pushed}",
	'Engram Sync: renamed "{name}" (unsupported characters)':
		'Engram Sincronização: renomeado "{name}" (caracteres não suportados)',
	"Engram Sync: replaced remote with local ({pushed} uploaded)":
		"Engram Sincronização: substituiu a versão remota pela local ({pushed} enviados)",
	'Engram Sync: sync state for "{name}" was unreadable — using the on-disk copy.':
		'Engram Sincronização: o estado de sincronização de "{name}" não pôde ser lido — usando a cópia no disco.',
	"Engram Sync: {details}": "Engram: Sincronização: {details}",
	"Engram URL": "URL do Engram",
	"Engram Vault Sync {version} is available. {link}.":
		"Engram Vault Sync {version} está disponível. {link}.",
	"Engram indexes {indexed} of your {all} notes. The rest match on this device only. Upgrade to index everything.":
		"Engram indexa {indexed} de suas {all} notas. O restante só corresponde neste dispositivo. Faça um upgrade para indexar tudo.",
	"Engram is the backend that powers sync and semantic search.":
		"Engram é o backend que alimenta a sincronização e a busca semântica.",
	"Engram search": "Engram: pesquisa",
	"Engram server changed — sign in again to continue.":
		"Servidor Engram alterado — faça login novamente para continuar.",
	"Engram sync: checking...": "Engram: sincronização: verificando...",
	"Engram sync: everything in sync": "Engram: sincronização: tudo em sincronia",
	"Engram sync: live sync requires a plugin update — please update the Engram vault sync plugin.":
		"Engram Sincronização: a sincronização em tempo real requer uma atualização do plugin — atualize o plugin de sincronização do Engram cofre.",
	"Engram sync: pulling all from server...":
		"Engram: sincronização: baixando tudo do servidor...",
	"Engram sync: server does not support reconciliation (update backend)":
		"Engram: sincronização: o servidor não suporta a sincronização (atualize o backend)",
	"Engram sync: sync failed": "Engram sincronização: falha na sincronização",
	"Engram sync: syncing...": "Engram Sincronização: sincronizando...",
	"Engram unreachable. Showing matches from this device only.":
		"Engram inacessível. Mostrando correspondências apenas deste dispositivo.",
	"Engram's {document} update, effective {date}.":
		"Atualização do Engram {document}, válida a partir de {date}.",
	"Engram: This vault has been deleted on the server.":
		"Engram: este cofre foi excluído no servidor.",
	"Engram: disconnected. Open Engram settings to reconnect.":
		"Engram: desconectado. Abra as configurações de Engram para reconectar.",
	"Engram: error": "Engram: erro",
	"Engram: finish setup": "Engram: finalizar a configuração",
	'Engram: frontmatter problem in "{name}"': 'Engram: problema no frontmatter em "{name}"',
	"Engram: live": "Engram: ativo",
	"Engram: not connected": "Engram: não conectado",
	"Engram: offline": "Engram: sem rede",
	"Engram: offline ({count} queued)": {
		one: "Engram: offline ({count} na fila)",
		many: "Engram: offline ({count} na fila)",
		other: "Engram: offline ({count} na fila)",
	},
	"Engram: pending ({count})": "Engram: pendente ({count})",
	"Engram: plan upgraded — syncing {count} attachments…": {
		one: "Engram: plano atualizado — sincronizando {count} anexo…",
		many: "Engram: plano atualizado — sincronizando {count} anexos…",
		other: "Engram: plano atualizado — sincronizando {count} anexos…",
	},
	"Engram: plugin settings file was corrupted and could not be recovered. You may need to reconnect in settings.":
		"Engram: o arquivo de configurações do plugin foi corrompido e não pôde ser recuperado. Você pode precisar reconectar nas configurações.",
	"Engram: ready": "Engram: pronto",
	"Engram: recovered plugin settings from a backup after a corrupted save.":
		"Engram: recuperou as configurações do plugin a partir de um backup após uma corrupção durante a gravação.",
	"Engram: settings tab failed to render ({error})":
		"Engram: a aba de configurações não pôde ser exibida ({error})",
	"Engram: sign-in failed ({error})": "Engram: falha ao fazer login ({error})",
	"Engram: signed out": "Engram: desconectado",
	"Engram: sync conflict on {path} — your local edit was saved as {copy}":
		"Engram: conflito de sincronização em {path} — sua edição local foi salva como {copy}",
	"Engram: sync failed. Open the sync log for details.":
		"Engram: a sincronização falhou. Abra o registro de sincronização para detalhes.",
	"Engram: sync is not set up yet, so nothing in this vault will sync.":
		"Engram: a sincronização ainda não está configurada, então nada neste cofre será sincronizado.",
	"Engram: sync is paused. This edit was not synced. Choose a sync direction to resume.":
		"Engram: a sincronização está pausada. Esta edição não foi sincronizada. Escolha uma direção de sincronização para retomar.",
	"Engram: sync paused": "Engram: sincronização pausada",
	"Engram: syncing": "Engram: sincronizando",
	"Engram: syncing ({count})": "Engram: sincronizando ({count})",
	"Engram: this plugin is too old to sync (needs {version} or newer). Update it to continue.":
		"Engram: este plugin é muito antigo para sincronizar (requer {version} ou mais recente). Atualize-o para continuar.",
	"Engram: this plugin is too old to sync. Update it to continue.":
		"Engram: este plugin é muito antigo para sincronizar. Atualize-o para continuar.",
	"Engram: this vault no longer exists on the server. Pick or create a vault to continue.":
		"Engram: este cofre não existe mais no servidor. Selecione ou crie um cofre para continuar.",
	"Engram: your login expired — open Engram settings to reconnect.":
		"Engram: sua sessão expirou — abra as configurações de Engram para reconectar.",
	"Engram: {count} attachments skipped — upgrade your plan to sync images & PDFs.": {
		one: "Engram: {count} anexo ignorado — atualize seu plano para sincronizar imagens e PDFs.",
		many: "Engram: {count} anexos ignorados — atualize seu plano para sincronizar imagens e PDFs.",
		other: "Engram: {count} anexos ignorados — atualize seu plano para sincronizar imagens e PDFs.",
	},
	"Engram: {count} files failed to sync{detail} — open Sync Center": {
		one: "Engram: {count} arquivo falhou na sincronização{detail} — abra a Central de sincronização",
		many: "Engram: {count} arquivos falharam na sincronização{detail} — abra a Central de sincronização",
		other: "Engram: {count} arquivos falharam na sincronização{detail} — abra a Central de sincronização",
	},
	"Engram: {count} notes have frontmatter problems. Open Sync Center to fix.": {
		one: "Engram: {count} nota tem problemas no frontmatter. Abra a Central de sincronização para corrigir.",
		many: "Engram: {count} notas têm problemas no frontmatter. Abra a Central de sincronização para corrigir.",
		other: "Engram: {count} notas têm problemas no frontmatter. Abra a Central de sincronização para corrigir.",
	},
	"Engram: ⚠ {count} sync errors": {
		one: "Engram: ⚠ {count} erro de sincronização",
		many: "Engram: ⚠ {count} erros de sincronização",
		other: "Engram: ⚠ {count} erros de sincronização",
	},
	"Enter a name for the new vault": "Digite um nome para o novo cofre",
	"Enter an API key first": "Insira uma chave de API primeiro",
	Error: "Erro",
	"Error: {error}": "Erro: {error}",
	"Errors only": "Erros apenas",
	"Everything is in sync": "Tudo está sincronizado",
	"Failed to start device flow. Check your Engram URL and try again.":
		"Falha ao iniciar o fluxo do dispositivo. Verifique sua URL de Engram e tente novamente.",
	"Failed to switch vault: {error}": "Falha ao alternar de cofre: {error}",
	"File exceeds the {limit} limit": "Arquivo excede o limite de {limit}",
	"File not found locally: {path}": "Arquivo não encontrado localmente: {path}",
	"File too large for your plan.": "Arquivo muito grande para o seu plano.",
	"Files that will be deleted:": "Arquivos que serão excluídos:",
	"Filter by folder…": "Filtrar por pasta…",
	"Filter by tags…": "Filtrar por tags…",
	"Finish setting up your account at app.engram.page to start syncing.":
		"Finalize a configuração da sua conta em app.engram.page para começar a sincronizar.",
	"Finish sync setup": "Finalizar a configuração de sincronização",
	"Finished with some errors. Open the sync log to see what failed.":
		"Finalizado com alguns erros. Abra o registro de sincronização para ver o que falhou.",
	"First sync, this may take a moment.": "Primeira sincronização, isso pode levar um momento.",
	Free: "Gratuito",
	"Free syncs notes only — images & PDFs need a paid plan.":
		"A sincronização gratuita sincroniza apenas notas — imagens e PDFs precisam de um plano pago.",
	"Free syncs notes only — {count} attachments will be skipped.": {
		one: "Sincroniza notas gratuitamente, mas apenas {count} anexo será ignorado.",
		many: "Sincroniza notas gratuitamente, mas {count} de anexos serão ignorados.",
		other: "Sincroniza notas gratuitamente, mas apenas {count} anexos serão sincronizados.",
	},
	"Frontmatter could not be parsed": "Não foi possível analisar o cabeçalho",
	"Frontmatter isn't valid YAML.": "O frontmatter não é um YAML válido.",
	'Frontmatter key "{key}" could not be parsed as YAML.':
		'A chave do frontmatter "{key}" não pôde ser interpretada como YAML.',
	"Frontmatter needs a fix": "O cabeçalho precisa de correção",
	"Generic cache directory": "Diretório de cache genérico",
	"Getting set up": "Configurando",
	"Getting started…": "Iniciando…",
	"GitHub Sponsors": "GitHub Patrocinadores",
	"Gradle build cache": "Cache de compilação Gradle",
	"How do you feel about Engram?": "O que você acha do Engram?",
	"I understand {count} notes will not sync.": {
		one: "Entendo que {count} nota não será sincronizada.",
		many: "Entendo que {count} de notas não serão sincronizadas.",
		other: "Entendo que {count} notas não serão sincronizadas.",
	},
	Idea: "Ideia",
	"If this plugin saves you time, consider supporting development.":
		"Se este plugin economiza seu tempo, considere apoiar o desenvolvimento.",
	Ignore: "Ignorar",
	"Ignore patterns": "Padrões ignorados",
	"Ignored ({count})": "Ignorados ({count})",
	"Ignored {path} — won't sync until restored from Sync Center.":
		"Ignorado {path} — não será sincronizado até ser restaurado na Central de sincronização.",
	"Info (default)": "Info (padrão)",
	"Invalid API key": "Chave de API inválida",
	"It's OK to email me about this": "Tudo bem enviar um e-mail sobre isso",
	"Join our Discord": "Participe do nosso Discord",
	Keyword: "Palavra-chave",
	"Last sync: {when}": "Última sincronização: {when}",
	"Learn more": "Saiba mais",
	"License: {name}": "Licença: {name}",
	"Limit reached. Upgrade to continue.": "Limite atingido. Faça um upgrade para continuar.",
	"Link Claude, Cursor, ChatGPT, or any MCP app so it can read and write your notes. ":
		"Conecte Claude, Cursor, ChatGPT ou qualquer aplicativo MCP para que ele possa ler e escrever suas notas. ",
	"Link Obsidian to Engram": "Link Obsidian para Engram",
	"Loading vaults…": "Carregando cofres…",
	"Love it": "Adorei",
	"Make new vault": "Criar novo cofre",
	"Manage account": "Gerenciar conta",
	"Minimum severity that ships while diagnostics are on. Higher levels send fewer lines. Default: Info.":
		"Nível mínimo de severidade quando os diagnósticos estão ativados. Níveis mais altos enviam menos linhas. Padrão: Info.",
	"Needs attention ({count})": "Precisa de atenção ({count})",
	"Network unavailable": "Rede indisponível",
	"New here? Watch the setup video": "Novo por aqui? Assista ao vídeo de configuração",
	"New vault": "Novo cofre",
	"Next.js build output": "Saída da compilação Next.js",
	"No activity yet. Push or pull to see entries here.":
		"Ainda não há atividade. Envie ou receba para ver os registros aqui.",
	"No files ignored. Use the ignore button on a failure row to stop syncing it.":
		'Nenhum arquivo ignorado. Use o botão "ignorar" em uma linha de erro para interromper a sincronização.',
	"No other vaults available.": "Nenhum outro cofre disponível.",
	"No results found": "Nenhum resultado encontrado",
	"No source path for this result": "Sem caminho de origem para este resultado",
	"No sync activity this session.": "Nenhuma atividade de sincronização nesta sessão.",
	"No vaults found — first sync will create one":
		"Nenhum cofre encontrado — a primeira sincronização criará um",
	"Node.js dependencies": "Dependências Node.js",
	"Not configured": "Não configurado",
	"Not connected yet. Click to open settings and link this vault.":
		"Ainda não conectado. Clique para abrir as configurações e vincular este cofre.",
	"Not connected. Enter your Engram server URL below to start syncing.":
		"Não conectado. Insira o URL do seu servidor Engram abaixo para iniciar a sincronização.",
	"Not now": "Não agora",
	"Not signed in, or the session expired. Sign in again in Engram settings.":
		"Não está conectado, ou a sessão expirou. Faça login novamente nas configurações de Engram.",
	"Not signed in. Click to open settings and reconnect.":
		"Não conectado. Clique para abrir as configurações e reconectar.",
	"Not synced on your plan ({count})": "Não sincronizado no seu plano ({count})",
	"Note couldn't be processed": "A nota não pôde ser processada",
	"Note limit reached. Upgrade to keep adding notes.":
		"Limite de notas atingido. Faça um upgrade para continuar adicionando notas.",
	"Note not synced locally": "Nota não sincronizada localmente",
	"Notes on this device": "Notas neste dispositivo",
	"Notes past this still sync and open normally, they are just not in the search index. The index keeps your oldest notes, so it is your newest ones that fall outside.":
		"As notas após este ponto ainda são sincronizadas e abertas normalmente, elas apenas não estão no índice de pesquisa. O índice armazena suas notas mais antigas, então são as suas notas mais recentes que ficam fora.",
	"Notes searchable": "Notas pesquisáveis",
	"Notes stored": "Notas armazenadas",
	"Nothing in this vault syncs until you choose how to merge it with the server.":
		"Nada neste cofre é sincronizado até que você escolha como combiná-lo com o servidor.",
	"Nothing is deleted.": "Nada é excluído.",
	"Nothing needs your attention. 🎉": "Nada precisa da sua atenção. 🎉",
	"Nothing to sync yet — this vault is empty on both sides. Start syncing and everything you write appears on your other devices.":
		"Ainda não há nada para sincronizar — este cofre está vazio em ambos os lados. Comece a sincronizar e tudo o que você escreve aparecerá em seus outros dispositivos.",
	"Nothing will be deleted.": "Nada será excluído.",
	"Nothing will be removed from this device.": "Nada será removido deste dispositivo.",
	Open: "Abrir",
	"Open Connection": "Abrir conexão",
	"Open Engram": "Abrir Engram",
	"Open Engram settings": "Abrir as configurações de Engram",
	"Open Engram to check your vault and confirm everything synced.":
		"Abra o Engram para verificar seu cofre e confirmar que tudo foi sincronizado.",
	"Open connection tab": "Abrir aba de conexão",
	"Open note": "Abrir nota",
	"Open search sidebar": "Abrir a barra lateral de pesquisa",
	"Open sync center": "Abrir a Central de sincronização",
	"Open sync setup": "Abrir configuração de sincronização",
	"Open the file to resolve the conflict, then sync again.":
		"Abra o arquivo para resolver o conflito, e sincronize novamente.",
	"Opens your browser to sign in, or create an account if you don't have one yet, then links this vault.":
		"Abre seu navegador para fazer login ou criar uma conta, se você ainda não tiver uma, e então vincula este cofre.",
	"Or authenticate with a token instead of signing in.":
		"Ou autentique com um token em vez de fazer login.",
	"Or authenticate with a token instead of signing in. Engram Cloud API keys require the Pro plan; on Free and Starter, sign in above.":
		"Ou autentique com um token em vez de fazer login. As chaves de API Engram exigem o plano Pro; nos planos Free e Starter, faça login acima.",
	"Paths to skip (one per line). Folder patterns end with /. Built-in: {configDir}/, .trash/, .git/":
		"Caminhos a serem ignorados (um por linha). Padrões de pasta terminam com /. Embutidos: {configDir}/, .trash/, .git/",
	"Pick a vault": "Escolha um cofre",
	"Pick a vault (previous: '{name}' not found)":
		"Escolha um cofre (anterior: '{name}' não encontrado)",
	"Pick a vault (previous: id {id} not found)":
		"Escolha um cofre (anterior: ID {id} não encontrado)",
	"Pick a vault to sync with. We will recalculate the sync preview after you choose.":
		"Escolha um cofre para sincronizar. Recalcularemos a prévia da sincronização após você escolher.",
	"Plan usage": "Uso do plano",
	Plans: "Planos",
	"Privacy Policy": "Política de Privacidade",
	Pro: "Pro",
	"Pull all (delete extras) aborted: could not obtain an exclusive server snapshot (replay contention). Nothing was trashed.":
		'A operação "baixar tudo" (excluir duplicatas) foi interrompida: não foi possível obter um instantâneo exclusivo do servidor (conflito de replicação). Nada foi excluído.',
	"Pull all aborted: another sync is running (replay contention). Try again when it finishes.":
		'A operação "baixar tudo" foi interrompida: outra sincronização está em andamento (conflito de replicação). Tente novamente quando ela terminar.',
	"Pull all failed: {error}": 'A operação "baixar tudo" falhou: {error}',
	"Pull all from server (force overwrite)": "Baixar tudo do servidor (substituir tudo)",
	Pulled: "Recebido",
	"Push entire vault": "Enviar todo o cofre",
	Pushed: "Enviado",
	"Python bytecode cache": "Cache de bytecode Python",
	"Python virtual environment": "Ambiente virtual Python",
	"Read it": "Ler",
	"Real-time sync": "Sincronização em tempo real",
	"Reconnect your account to resume syncing.":
		"Reconecte sua conta para retomar a sincronização.",
	Refresh: "Atualizar",
	"Remote vault": "Cofre remoto",
	"Remove tag {tag}": "Remover tag {tag}",
	"Report an issue": "Reportar um problema",
	"Report an issue on GitHub": "Relate um problema no GitHub",
	"Request failed ({status})": "Solicitação falhou ({status})",
	Restore: "Restaurar",
	"Restored {path} — will sync on next push.":
		"Restaurado {path} — será sincronizado no próximo envio.",
	"Retry all now": "Tentar novamente agora",
	"Retrying automatically ({count})": "Tentando novamente automaticamente ({count})",
	"Review and accept": "Revisar e aceitar",
	"Run in background": "Executar em segundo plano",
	"Run your own Engram server": "Execute seu próprio servidor Engram",
	"Rust/Java build output": "Saída de compilação Rust/Java",
	"Safe choice: combines both sides, nothing is deleted.":
		"Opção segura: combina ambos os lados, nada é excluído.",
	Save: "Salvar",
	"Search across all vaults at once": "Pesquise em todos os Cofres de uma vez",
	"Search all your notes": "Pesquise todas as suas notas",
	"Search failed — check connection": "A pesquisa falhou — verifique a conexão",
	"Search settings": "Configurações de pesquisa",
	"Search your vault…": "Pesquise seu cofre…",
	"Searching {indexed} of {all} notes. Upgrade to search everything.":
		"Pesquisando {indexed} de {all} notas. Faça um upgrade para pesquisar tudo.",
	"See full pricing": "Ver preços completos",
	"See the AI setup guide": "Veja o guia de configuração da IA",
	"Select which vault this plugin syncs with.": "Selecione qual cofre este plugin sincroniza.",
	"Selected: {selected} / {limit}": "Selecionado: {selected} / {limit}",
	"Self-hosted": "Hospedado por você",
	Semantic: "Semântica",
	"Semantic search": "Busca semântica",
	Send: "Enviar",
	"Send debug logs. Note content stays private.":
		"Enviar logs de depuração. O conteúdo das notas permanece privado.",
	"Send detailed sync, vault, and connection activity to the server for troubleshooting, with distributed tracing on requests. Metadata only, never note content. Leave off for normal use.":
		"Envie informações detalhadas sobre a sincronização, o cofre e a conexão para o servidor para solucionar problemas, com rastreamento distribuído nas requisições. Apenas metadados, nunca o conteúdo das notas. Desative para uso normal.",
	"Send feedback": "Enviar feedback",
	"Sending…": "Enviando…",
	"Server error": "Erro no servidor",
	"Server error ({status}) — check Engram logs":
		"Erro no servidor ({status}) — verifique os logs de Engram",
	"Server unreachable — changes will sync when connected":
		"Servidor inacessível — as alterações serão sincronizadas quando conectado",
	"Set up sync for this vault": "Configure a sincronização para este cofre",
	"Setup is not finished — nothing will sync until you choose a sync direction. Click to finish.":
		"A configuração não foi finalizada — nada será sincronizado até que você escolha uma direção de sincronização. Clique para finalizar.",
	"Show files ({count}) ▾": "Mostrar arquivos ({count}) ▾",
	"Show sync log": "Mostrar o registro de sincronização",
	"Showing {count} entries": {
		one: "Exibindo {count} entrada",
		many: "Exibindo {count} entradas",
		other: "Exibindo {count} entradas",
	},
	"Sign in": "Fazer login",
	"Sign in (or enter your server URL and key) on the connection tab, then run your first sync.":
		"Faça login (ou insira a URL do seu servidor e a chave) na aba de conexão e, em seguida, execute sua primeira sincronização.",
	"Sign in or create an account": "Faça login ou crie uma conta",
	"Sign out": "Sair",
	"Sign-in expired": "Sessão expirada",
	"Sign-in required to load vaults": "É necessário fazer login para carregar os cofres",
	"Signed in as {email}": "Logado como {email}",
	Skipped: "Ignorado",
	"Source: {link}": "Fonte: {link}",
	"Start syncing": "Começar a sincronizar",
	Starter: "Starter",
	"Starting...": "Iniciando...",
	Stats: "Estatísticas",
	"Support development": "Apoiar o desenvolvimento",
	"Switch to sign in": "Mudar para fazer login",
	"Switch vault": "Trocar de cofre",
	"Switched to {mode}.": "Alterado para {mode}.",
	Sync: "Sincronizar",
	"Sync complete": "Sincronização completa",
	"Sync failed": "Sincronização falhou",
	"Sync in progress...": "Sincronização em andamento...",
	"Sync log": "Log de sincronização",
	"Sync now": "Sincronizar agora",
	"Sync paused — click to choose a sync direction":
		"Sincronização pausada — clique para escolher uma direção de sincronização",
	"Sync preview": "Visualização da sincronização",
	"Sync server": "Servidor de sincronização",
	"Sync these now": "Sincronize isso agora",
	"Sync...": "Sincronizando...",
	"Synced. Some attachments need a paid plan to sync (see below).":
		"Sincronizado. Alguns anexos precisam de um plano pago para sincronizar (veja abaixo).",
	"Syncing attachments": "Sincronizando anexos",
	"Syncing your vault": "Sincronizando seu cofre",
	"Syncing...": "Sincronizando...",
	"Syncing…": "Sincronizando…",
	"Tell us anything": "Conte-nos tudo",
	"Temporary errors. These clear themselves once the server recovers.":
		"Erros temporários. Eles desaparecem quando o servidor volta a funcionar.",
	"Terms of Service": "Termos de Serviço",
	"Thanks, we read every message.": "Obrigado, lemos todas as mensagens.",
	"That does not look like a complete server address. Include the scheme, for example http://127.0.0.1:4000":
		"Isso não parece um endereço de servidor completo. Inclua o esquema, por exemplo http://127.0.0.1:4000",
	"That does not look like an Engram API key (expected {prefix}…).":
		"Isso não parece ser uma chave de API do Engram (esperado {prefix}…).",
	"The Free tier syncs notes only. Upgrade to sync images and PDFs.":
		"O plano gratuito sincroniza apenas notas. Faça um upgrade para sincronizar imagens e PDFs.",
	"The file is too large for the server.": "O arquivo é muito grande para o servidor.",
	"The note synced, but its frontmatter could not be fully parsed. Open it to fix the highlighted line.":
		"A nota foi sincronizada, mas o cabeçalho não pôde ser totalmente analisado. Abra-a para corrigir a linha destacada.",
	"The server couldn't process this note. Check its contents, then edit and save to try again.":
		"O servidor não conseguiu processar esta nota. Verifique o conteúdo, edite e salve para tentar novamente.",
	"The server limit is 5 MB. Compress or split the file, then it will sync.":
		"O limite do servidor é de 5 MB. Comprima ou divida o arquivo, então ele será sincronizado.",
	"The server took too long to respond. Try again.":
		"O servidor demorou muito para responder. Tente novamente.",
	"These files are fine. They just need a paid plan to sync.":
		"Esses arquivos estão ok. Eles só precisam de um plano pago para sincronizar.",
	"This account was deleted. Contact support if that is wrong.":
		"Esta conta foi excluída. Entre em contato com o suporte se isso estiver incorreto.",
	"This cannot be undone.": "Isso não pode ser desfeito.",
	"This device's vault is empty. Download {what} from the server?":
		"O cofre deste dispositivo está vazio. Deseja baixar {what} do servidor?",
	"This file type isn't accepted by this server.":
		"Este tipo de arquivo não é aceito por este servidor.",
	"This note could not be processed and was skipped.":
		"Esta nota não pôde ser processada e foi ignorada.",
	"This server is self-hosted, so feedback is not collected here. ":
		"Este servidor é auto-hospedado, portanto, os comentários não são coletados aqui. ",
	"This vault": "Este cofre",
	"This vault has {count} notes. Your plan syncs {limit}.": {
		one: "Este cofre tem {count} nota. Seu plano sincroniza {limit}.",
		many: "Este cofre tem {count} de notas. Seu plano sincroniza {limit}.",
		other: "Este cofre tem {count} notas. Seu plano sincroniza {limit}.",
	},
	"This vault is empty on the server. Upload your {what}?":
		"Este cofre está vazio no servidor. Deseja enviar seus {what}?",
	"Too large for the server": "Muito grande para o servidor",
	"Too many connected AI clients. Disconnect one or upgrade.":
		"Muitos clientes de IA conectados. Desconecte um ou faça um upgrade.",
	"Too many connected Obsidian vaults. Disconnect one or upgrade.":
		"Muitos cofres Obsidian conectados. Desconecte um ou faça um upgrade.",
	"Too many requests. Wait a moment and try again.":
		"Muitos pedidos. Aguarde um momento e tente novamente.",
	"Try again": "Tentar novamente",
	"Type {keyword} to confirm:": "Digite {keyword} para confirmar:",
	"Unknown error": "Erro desconhecido",
	"Unlimited AI searches": "Pesquisas de IA ilimitadas",
	"Unlimited vaults": "Cofres ilimitados",
	"Unresolved conflict": "Conflito não resolvido",
	Untitled: "Sem título",
	Update: "Atualizar",
	"Update in settings": "Atualizar nas configurações",
	Upgrade: "Atualizar",
	"Upload everything": "Enviar tudo",
	"Upload local files without downloading the remote":
		"Envie arquivos locais sem baixar os remotos",
	"Upload {count} files from this vault": {
		one: "Enviar {count} arquivo deste cofre",
		many: "Enviar {count} arquivos deste cofre",
		other: "Enviar {count} arquivos deste cofre",
	},
	Uploading: "Enviando",
	"Uploading {count}.": {
		one: "Enviando {count}.",
		many: "Carregando {count}.",
		other: "Enviando {count}.",
	},
	"Uploads {up}, downloads {down}.": "Envio: {up}, download: {down}.",
	"Using API key": "Usando chave de API",
	Vault: "Cofre",
	"Vault ID: {id}": "ID do Cofre: {id}",
	"Vault limit reached. Upgrade for more vaults.":
		"Limite de cofres atingido. Faça um upgrade para mais cofres.",
	"Vault name": "Nome do Cofre",
	"Vault selection": "Seleção do Cofre",
	"Vendored dependencies": "Dependências incluídas",
	"Version: {version}": "Versão: {version}",
	"Waiting for authorization — connected, this will complete instantly.":
		"Aguardando autorização — conectado, isso será concluído instantaneamente.",
	"Waiting for authorization — no live connection, checking every 30s.":
		"Aguardando autorização — sem conexão ativa, verificando a cada 30 segundos.",
	"Warnings and errors": "Avisos e erros",
	"WebSocket connected — live sync active": "WebSocket conectado — sincronização ativa",
	"What Engram does, and how to connect your vault, start to finish.":
		"O que o Engram faz e como conectar seu cofre, do início ao fim.",
	"What kind of feedback?": "Que tipo de feedback?",
	"What's working, what's frustrating, what do you wish Engram did?":
		"O que está funcionando, o que é frustrante, o que você gostaria que o Engram fizesse?",
	"Where this vault syncs to. Each backend keeps its own sign-in.":
		"Para onde este cofre é sincronizado. Cada backend tem seu próprio login.",
	"Will download {count} files.": {
		one: "Baixará {count} arquivo.",
		many: "Baixará {count} arquivos.",
		other: "Baixará {count} arquivos.",
	},
	"Will upload {count} files.": {
		one: "Serão enviados {count} arquivo.",
		many: "Serão enviados {count} de arquivos.",
		other: "Serão enviados {count} arquivos.",
	},
	"You are about to:": "Você está prestes a:",
	"You are now pointing at a different cloud vault":
		"Você está apontando para um cofre na nuvem diferente",
	"You can close this and the sync keeps running in the background.":
		"Você pode fechar isso e a sincronização continua em segundo plano.",
	"You've used all the attachment storage on your plan. Upgrade for more.":
		"Você usou todo o espaço de armazenamento de anexos do seu plano. Faça um upgrade para ter mais.",
	"Your code:": "Seu código:",
	"Your feedback": "Seu feedback",
	"Your login expired. Sign in again in Engram settings to continue.":
		"Sua sessão expirou. Faça login novamente nas configurações de Engram para continuar.",
	"Your vault shares {percent} of its data with Engram":
		"Seu cofre compartilha {percent} de seus dados com Engram",
	attachments: "anexos",
	exact: "exato",
	files: "arquivos",
	folders: "pastas",
	"match strength: {pct}%": "força da correspondência: {pct}%",
	"matches meaning. Finds notes that never use the words you typed.":
		"corresponde ao significado. Encontra notas que nunca usam as palavras que você digitou.",
	"matches words and meaning together, plus this device. Widest results.":
		"combina palavras e significado, além deste dispositivo. Resultados mais amplos.",
	"matches your words and their other forms — 'run' finds 'running' — plus this device.":
		'corresponde às suas palavras e a outras formas delas — "run" encontra "running" — além deste dispositivo.',
	meaning: "significado",
	"meaning + exact": "significado + exato",
	"not linked": "não vinculado",
	notes: "notas",
	"setup guide": "guia de configuração",
	"sync is paused": "sincronização pausada",
	"syncing now": "sincronizando agora",
	unknown: "desconhecido",
	"waiting for a connection": "aguardando conexão",
	"waiting to retry": "aguardando nova tentativa",
	"{count} attachments": {
		one: "{count} anexo",
		many: "{count} anexos",
		other: "{count} anexos",
	},
	"{count} attachments need a paid plan to sync. See Sync Center.": {
		one: "{count} anexo precisa de um plano pago para sincronizar. Veja a Central de sincronização.",
		many: "{count} anexos precisam de um plano pago para sincronizar. Veja a Central de sincronização.",
		other: "{count} anexos precisam de um plano pago para sincronizar. Veja a Central de sincronização.",
	},
	"{count} attempts": {
		one: "{count} tentativa",
		many: "{count} tentativas",
		other: "{count} tentativas",
	},
	"{count} conflicts need resolution": {
		one: "{count} conflito precisa ser resolvido",
		many: "{count} conflitos precisam ser resolvidos",
		other: "{count} conflitos precisam ser resolvidos",
	},
	"{count} conflicts to resolve.": {
		one: "{count} conflito para resolver.",
		many: "{count} conflitos para resolver.",
		other: "{count} conflitos a resolver.",
	},
	"{count} diverged": {
		one: "{count} divergente",
		many: "{count} divergências",
		other: "{count} divergentes",
	},
	'{count} failed. Run "{command}" for details.': {
		one: '{count} falha. Execute "{command}" para detalhes.',
		many: '{count} falhas. Execute "{command}" para detalhes.',
		other: '{count} falhas. Execute "{command}" para detalhes.',
	},
	"{count} files": {
		one: "{count} arquivo",
		many: "{count} arquivos",
		other: "{count} arquivos",
	},
	"{count} files not included in your plan": {
		one: "{count} arquivo não incluso no seu plano",
		many: "{count} arquivos não incluídos no seu plano",
		other: "{count} arquivos não inclusos no seu plano",
	},
	"{count} files queued": {
		one: "{count} arquivo na fila",
		many: "{count} arquivos na fila",
		other: "{count} arquivos na fila",
	},
	"{count} ignored": {
		one: "{count} ignorado",
		many: "{count} ignorados",
		other: "{count} ignorados",
	},
	"{count} missing on server": {
		one: "{count} faltando no servidor",
		many: "{count} faltando no servidor",
		other: "{count} faltando no servidor",
	},
	"{count} need attention": {
		one: "{count} precisa de atenção",
		many: "{count} precisam de atenção",
		other: "{count} precisam de atenção",
	},
	"{count} notes": { one: "{count} nota", many: "{count} notas", other: "{count} notas" },
	"{count} only on server": {
		one: "{count} apenas no servidor",
		many: "{count} apenas no servidor",
		other: "{count} apenas no servidor",
	},
	"{count} queued — {reason}": {
		one: "{count} na fila — {reason}",
		many: "{count} na fila — {reason}",
		other: "{count} na fila — {reason}",
	},
	"{count} retrying": {
		one: "{count} tentando novamente",
		many: "{count} tentando novamente",
		other: "{count} tentando novamente",
	},
	"{desc} — should not be synced": "{desc} — não deve ser sincronizado",
	"{first} and {second}": "{first} e {second}",
	"{formatted} per day": "{formatted} por dia",
	"{label} ({count} queued)": {
		one: "{label} ({count} na fila)",
		many: "{label} ({count} na fila)",
		other: "{label} ({count} na fila)",
	},
	"{n} of 5": "{n} de 5",
	"▶ Watch on YouTube": "▶ Assista no YouTube",
	"⚙️ Advanced": "⚙️ Avançado",
	"⚠ Detected: {label}/ ({formatted} files)": "⚠ Detectado: {label} / ({formatted} arquivos)",
	"✓ Engram server reachable (v{version})": "✓ Servidor Engram acessível (v{version})",
	"✓ {count} synced": {
		one: "✓ {count} sincronizado",
		many: "✓ {count} sincronizados",
		other: "✓ {count} sincronizados",
	},
	"✕ {count} failed": {
		one: "✕ {count} falha",
		many: "✕ {count} falhas",
		other: "✕ {count} tentativas falhadas",
	},
	"✗ couldn't reach a server at this URL": "✗ Não foi possível acessar um servidor neste URL",
	"✗ server responded but isn't an Engram server":
		"✗ O servidor respondeu, mas não é um servidor Engram",
	"⤳ {count} skipped (Free plan)": {
		one: "⤳ {count} ignorado (Plano gratuito)",
		many: "⤳ {count} ignorados (Plano gratuito)",
		other: "⤳ {count} ignorados (Plano gratuito)",
	},
	"👋 Welcome": "👋 Bem-vindo",
	"💬 Feedback": "💬 Feedback",
	"🔄 Sync Center": "🔄 Central de sincronização",
	"🔌 Connection": "🔌 Conexão",
};

export default ptBR;
