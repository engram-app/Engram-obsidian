import type { Dict } from "..";

// Português (Portugal)
const pt: Dict = {
	" (default)": " (padrão)",
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
	"2,000 notes searchable": "2.000 notas pesquisáveis",
	"2. Connect your vault to Engram": "2. Conecte o seu cofre ao Engram",
	"3. Connect your AI": "3. Conecte a sua IA",
	"50 GB attachments": "50 GB de anexos",
	"A browser window has opened. Sign in and enter this code to link your vault.":
		"Uma janela do navegador foi aberta. Inicie sessão e insira este código para ligar o seu cofre.",
	"A frontmatter key could not be parsed as YAML.":
		"Uma chave de frontmatter não pôde ser interpretada como YAML.",
	"A temporary server problem — retrying automatically.":
		"Um problema temporário no servidor — a tentar novamente automaticamente.",
	"AI / MCP setup guide": "Guia de configuração de IA / MCP",
	"AI searches": "Pesquisas de IA",
	"API access": "Acesso à API",
	"API key": "Chave API",
	"API keys need a Pro plan. Sign in with your Engram account instead.":
		"As chaves de API necessitam de um plano Pro. Inicie sessão com a sua conta Engram em vez disso.",
	About: "Sobre",
	"Accept it to keep syncing.": "Aceite para continuar a sincronização.",
	"Access token": "Token de acesso",
	"Account setup incomplete.": "Configuração da conta incompleta.",
	"Account suspended. Contact support.": "Conta suspensa. Contacte o suporte.",
	"Activity ({count})": "Atividade ({count})",
	"Add to ignores": "Adicionar aos padrões a ignorar",
	"Added {pattern} to ignore patterns": "Adicionado {pattern} aos padrões a ignorar",
	"Advanced sync options": "Opções avançadas de sincronização",
	"All synced. Your vault and the cloud now match.":
		"Tudo sincronizado. O seu cofre e a nuvem estão agora sincronizados.",
	"Already in sync. Nothing is deleted.": "Já está sincronizado. Nada é apagado.",
	"Already signed in on another device. Upgrade for multi-device.":
		"Já está autenticado noutro dispositivo. Faça uma atualização para usar em vários dispositivos.",
	"Already up to date. Nothing needed syncing.":
		"Já está atualizado. Não é necessário sincronizar nada.",
	"An unexpected error — retrying automatically.":
		"Um erro inesperado — a tentar novamente automaticamente.",
	"Attachment storage full": "Armazenamento de anexos cheio",
	"Attachment storage is full — upgrade for more.":
		"O espaço de armazenamento de anexos está cheio — faça uma atualização para ter mais.",
	"Attachment sync is disabled for this account.":
		"A sincronização de anexos está desativada para esta conta.",
	Attachments: "Anexos",
	"Attachments need a paid plan": "Os anexos requerem um plano pago",
	"Attachments on this device": "Anexos neste dispositivo",
	"Authenticated via Engram account (OAuth).": "Autenticado através da conta Engram (OAuth).",
	"Authenticated via manual API key.": "Autenticado através de chave API manual.",
	Authentication: "Autenticação",
	Back: "Voltar",
	"Bearer token from your Engram account.": "Token de acesso da sua conta Engram.",
	Both: "Ambos",
	Bug: "Erro",
	"Build output": "Resultado da compilação",
	"Can't reach the server — retrying automatically.":
		"Não é possível contactar o servidor — a tentar novamente automaticamente.",
	Cancel: "Cancelar",
	"Cargo cache": "Cache do Cargo",
	Change: "Alterar",
	"Change vault": "Alterar cofre",
	"Check sync status": "Verificar o estado da sincronização",
	"Checking for changes.": "A verificar alterações.",
	"Checking server…": "A verificar o servidor…",
	"Choose sync direction": "Escolha a direção da sincronização",
	Clear: "Limpar",
	"Clear all": "Limpar tudo",
	"Clear key": "Limpar chave",
	"Clear search": "Limpar pesquisa",
	"Click to copy": "Clicar para copiar",
	"Click to sync": "Clique para sincronizar",
	Close: "Fechar",
	"Cloud server": "Servidor na nuvem",
	"CocoaPods dependencies": "Dependências do CocoaPods",
	"Code copied!": "Código copiado!",
	"Comparing your vault with the cloud…": "A comparar o seu cofre com a nuvem…",
	Complete: "Concluído",
	Confirm: "Confirmar",
	"Confirm destructive sync": "Confirmar sincronização destrutiva",
	Conflict: "Conflito",
	Confusing: "Confuso",
	"Connect any AI (MCP)": "Conecte qualquer IA (MCP)",
	"Connect to Engram first to send feedback.":
		"Conecte-se a Engram primeiro para enviar feedback.",
	"Connected — live sync active": "Conectado — sincronização ativa",
	"Connected — polling": "Conectado — a verificar",
	"Connected — waiting for first sync decision":
		"Conectado — aguardando a primeira decisão de sincronização",
	"Connection failed": "Falha na ligação",
	"Could not compare with the cloud. Check your connection.":
		"Não foi possível comparar com a nuvem. Verifique a ligação.",
	"Could not create the vault — check your connection and try again.":
		"Não foi possível criar o cofre — verifique a ligação e tente novamente.",
	"Could not load vaults: {error}": "Não foi possível carregar os cofres: {error}",
	"Could not reach Engram — check connection":
		"Não foi possível aceder a Engram — verifique a ligação",
	"Couldn't create vault — the name may be invalid or already in use.":
		"Não foi possível criar o cofre — o nome pode ser inválido ou já estar em uso.",
	"Couldn't send your feedback, please try again.":
		"Não foi possível enviar o seu feedback, por favor tente novamente.",
	Create: "Criar",
	"Create a hosted account at {signup}, or self-host the server ({guide}).":
		"Crie uma conta alojada em {signup}, ou alojar o servidor {guide}.",
	"Create a new empty vault on the server, then sync this Obsidian vault into it.":
		"Crie um novo cofre vazio no servidor e, em seguida, sincronize este cofre Obsidian para ele.",
	"Custom patterns": "Padrões personalizados",
	"Daily AI search limit reached. Free includes 20 per day across Obsidian, the web app and MCP. Upgrade for unlimited.":
		"Limite diário de pesquisa de IA atingido. A versão gratuita inclui 20 por dia, distribuídos por Obsidian, a aplicação web e MCP. Faça uma atualização para ter acesso ilimitado.",
	"Dart tool cache": "Cache das ferramentas Dart",
	"Debug (verbose)": "Debug (detalhado)",
	"Delete all local files, then download from remote":
		"Apague todos os ficheiros locais e, em seguida, descarregue do remoto",
	"Delete all on remote, then upload local files":
		"Apague tudo no remoto e, em seguida, envie os ficheiros locais",
	"Delete all {count} files currently on the server": {
		one: "Eliminar todos os {count} ficheiros atualmente no servidor",
		many: "Eliminar todos os {count} ficheiros atualmente no servidor",
		other: "Eliminar os {count} ficheiros atualmente no servidor",
	},
	"Delete all {count} files in this vault": {
		one: "Eliminar todos os {count} ficheiros neste cofre",
		many: "Eliminar todos os {count} ficheiros neste cofre",
		other: "Eliminar os {count} ficheiros neste cofre",
	},
	Deleted: "Eliminado",
	Deleting: "A eliminar",
	"Deleting {count} local files.": {
		one: "A eliminar {count} ficheiro local.",
		many: "A eliminar {count} de ficheiros locais.",
		other: "A eliminar {count} ficheiros locais.",
	},
	"Deleting {count} on the cloud.": {
		one: "A eliminar {count} na nuvem.",
		many: "Eliminar {count} na nuvem.",
		other: "A eliminar {count} na nuvem.",
	},
	"Device swap cooldown active. Wait or upgrade.":
		"Período de espera para troca de dispositivo ativo. Aguarde ou faça uma atualização.",
	Diagnostics: "Diagnósticos",
	"Diagnostics detail": "Detalhes dos diagnósticos",
	"Disconnect (clear login)": "Desconectar (limpar login)",
	Disconnected: "Desconectado",
	Dismiss: "Fechar",
	"Distribution build output": "Resultado da compilação para distribuição",
	Documentation: "Documentação",
	Done: "Concluído",
	"Download everything": "Descarregar tudo",
	"Download remote files without uploading the local":
		"Descarregue ficheiros remotos sem enviar os locais",
	"Download {count} files from the server": {
		one: "Descarregar {count} ficheiro do servidor",
		many: "Descarregar {count} ficheiros do servidor",
		other: "Descarregar {count} ficheiros do servidor",
	},
	Downloading: "A descarregar",
	"Downloading {count}.": {
		one: "A descarregar {count}.",
		many: "A descarregar {count}.",
		other: "A descarregar {count}.",
	},
	"Engram Cloud": "Engram Nuvem",
	"Engram Sync: pulled {count} changes": {
		one: "Engram Sincronização: transferidos {count} alteração",
		many: "Engram Sincronização: transferidos {count} de alterações",
		other: "Engram Sincronização: transferidos {count} elementos",
	},
	"Engram Sync: pulled {count} files from server": {
		one: "Engram Sincronização: transferidos {count} ficheiro do servidor",
		many: "Engram Sincronização: transferidos {count} ficheiros do servidor",
		other: "Engram Sincronização: transferidos {count} ficheiros do servidor",
	},
	"Engram Sync: pulled {pulled}": "Engram Sincronização: recebida {pulled}",
	"Engram Sync: pulled {pulled} (local extras deleted)":
		"Engram Sincronização: recebida {pulled} (extras locais eliminados)",
	"Engram Sync: pulled {pulled}, pushed {pushed}":
		"Engram Sincronização: transferidos {pulled}, enviados {pushed}",
	"Engram Sync: pushed {count} files": {
		one: "Engram Sincronização: enviados {count} ficheiro",
		many: "Engram Sincronização: enviados {count} ficheiros",
		other: "Engram Sincronização: enviados {count} ficheiros",
	},
	"Engram Sync: pushed {pushed}": "Engram Sincronização: enviada {pushed}",
	'Engram Sync: renamed "{name}" (unsupported characters)':
		'Engram Sincronização: renomeado "{name}" (carateres não suportados)',
	"Engram Sync: replaced remote with local ({pushed} uploaded)":
		"Engram Sincronização: substituída a versão remota pela versão local ({pushed} enviada)",
	'Engram Sync: sync state for "{name}" was unreadable — using the on-disk copy.':
		'Engram Sincronização: o estado de sincronização de "{name}" não foi legível — a cópia no disco está a ser utilizada.',
	"Engram Sync: {details}": "Engram: Sincronização: {details}",
	"Engram URL": "URL do Engram",
	"Engram Vault Sync {version} is available. {link}.":
		"Engram Vault Sync {version} está disponível. {link}.",
	"Engram indexes {indexed} of your {all} notes. The rest match on this device only. Upgrade to index everything.":
		"Engram indexa {indexed} das suas {all} notas. O resto corresponde apenas neste dispositivo. Atualize para indexar tudo.",
	"Engram is the backend that powers sync and semantic search.":
		"Engram é o sistema que permite a sincronização e a pesquisa semântica.",
	"Engram search": "Engram: pesquisa",
	"Engram server changed — sign in again to continue.":
		"Servidor Engram alterado — inicie sessão novamente para continuar.",
	"Engram sync: checking...": "Engram: a sincronização: a verificar...",
	"Engram sync: everything in sync": "Engram: a sincronização: tudo sincronizado",
	"Engram sync: live sync requires a plugin update — please update the Engram vault sync plugin.":
		"Engram sincronização: a sincronização em tempo real requer uma atualização do plugin — atualize o plugin de sincronização do Engram cofre.",
	"Engram sync: pulling all from server...":
		"Engram: a sincronização: a descarregar tudo do servidor...",
	"Engram sync: server does not support reconciliation (update backend)":
		"Engram: a sincronização: o servidor não suporta a reconciliação (atualizar o backend)",
	"Engram sync: sync failed": "Engram sincronização: falha na sincronização",
	"Engram sync: syncing...": "Engram Sincronização: a sincronizar...",
	"Engram unreachable. Showing matches from this device only.":
		"Engram inacessível. A mostrar resultados apenas deste dispositivo.",
	"Engram's {document} update, effective {date}.":
		"Atualização do Engram para {document}, em vigor a partir de {date}.",
	"Engram: This vault has been deleted on the server.":
		"Engram: este cofre foi eliminado no servidor.",
	"Engram: disconnected. Open Engram settings to reconnect.":
		"Engram: desconectado. Abra as definições de Engram para reconectar.",
	"Engram: error": "Engram: erro",
	"Engram: finish setup": "Engram: concluir a configuração",
	'Engram: frontmatter problem in "{name}"': 'Engram: problema no frontmatter em "{name}"',
	"Engram: live": "Engram: ativo",
	"Engram: not connected": "Engram: não está conectado",
	"Engram: offline": "Engram: offline",
	"Engram: offline ({count} queued)": {
		one: "Engram: offline ({count} na fila)",
		many: "Engram: offline ({count} em fila)",
		other: "Engram: offline ({count} na fila)",
	},
	"Engram: pending ({count})": "Engram: pendente ({count})",
	"Engram: plan upgraded — syncing {count} attachments…": {
		one: "Engram: plano atualizado — a sincronizar {count} anexo…",
		many: "Engram: plano atualizado — a sincronizar {count} de anexos…",
		other: "Engram: plano atualizado — a sincronizar {count} anexos…",
	},
	"Engram: plugin settings file was corrupted and could not be recovered. You may need to reconnect in settings.":
		"Engram: o ficheiro de definições do plugin foi corrompido e não foi possível recuperá-lo. Pode ser necessário reconectar nas definições.",
	"Engram: ready": "Engram: pronto",
	"Engram: recovered plugin settings from a backup after a corrupted save.":
		"Engram: recuperou as definições do plugin a partir de uma cópia de segurança após uma falha na gravação.",
	"Engram: settings tab failed to render ({error})":
		"Engram: a aba de definições não foi carregada ({error})",
	"Engram: sign-in failed ({error})": "Engram: falha ao iniciar sessão ({error})",
	"Engram: signed out": "Engram: saiu da conta",
	"Engram: sync conflict on {path} — your local edit was saved as {copy}":
		"Engram: conflito de sincronização em {path} — a edição local foi guardada como {copy}",
	"Engram: sync failed. Open the sync log for details.":
		"Engram: a sincronização falhou. Abrir o registo de sincronização para obter detalhes.",
	"Engram: sync is not set up yet, so nothing in this vault will sync.":
		"Engram: a sincronização ainda não está configurada, portanto, nada neste cofre será sincronizado.",
	"Engram: sync is paused. This edit was not synced. Choose a sync direction to resume.":
		"Engram: a sincronização está pausada. Esta edição não foi sincronizada. Escolha uma direção de sincronização para retomar.",
	"Engram: sync paused": "Engram: sincronização pausada",
	"Engram: syncing": "Engram: a sincronizar",
	"Engram: syncing ({count})": "Engram: a sincronizar ({count})",
	"Engram: this plugin is too old to sync (needs {version} or newer). Update it to continue.":
		"Engram: este plugin é demasiado antigo para sincronizar (requer {version} ou superior). Atualize-o para continuar.",
	"Engram: this plugin is too old to sync. Update it to continue.":
		"Engram: este plugin é demasiado antigo para sincronizar. Atualize-o para continuar.",
	"Engram: this vault no longer exists on the server. Pick or create a vault to continue.":
		"Engram: este cofre já não existe no servidor. Escolha ou crie um cofre para continuar.",
	"Engram: your login expired — open Engram settings to reconnect.":
		"Engram: a sua sessão expirou — abra as definições de Engram para reconectar.",
	"Engram: {count} attachments skipped — upgrade your plan to sync images & PDFs.": {
		one: "Engram: {count} anexo ignorado — atualize o plano para sincronizar imagens e PDFs.",
		many: "Engram: {count} anexos ignorados — atualize o plano para sincronizar imagens e PDFs.",
		other: "Engram: {count} anexos ignorados — atualize o plano para sincronizar imagens e PDFs.",
	},
	"Engram: {count} files failed to sync{detail} — open Sync Center": {
		one: "Engram: {count} ficheiro falhou na sincronização{detail} — abrir o Centro de sincronização",
		many: "Engram: {count} ficheiros falharam na sincronização{detail} — abrir o Centro de sincronização",
		other: "Engram: {count} ficheiros falharam na sincronização{detail} — abrir o Centro de sincronização",
	},
	"Engram: {count} notes have frontmatter problems. Open Sync Center to fix.": {
		one: "Engram: {count} nota tem problemas no frontmatter. Abra o Centro de sincronização para corrigir.",
		many: "Engram: {count} notas têm problemas no frontmatter. Abra o Centro de sincronização para corrigir.",
		other: "Engram: {count} notas têm problemas no frontmatter. Abra o Centro de sincronização para corrigir.",
	},
	"Engram: ⚠ {count} sync errors": {
		one: "Engram: ⚠ {count} erro de sincronização",
		many: "Engram: ⚠ {count} erros de sincronização",
		other: "Engram: ⚠ {count} erros de sincronização",
	},
	"Enter a name for the new vault": "Introduza um nome para o novo cofre",
	"Enter an API key first": "Introduza primeiro uma chave API",
	Error: "Erro",
	"Error: {error}": "Erro: {error}",
	"Errors only": "Erros apenas",
	"Everything is in sync": "Tudo está sincronizado",
	"Failed to start device flow. Check your Engram URL and try again.":
		"Falha ao iniciar o processo de autenticação. Verifique a URL do Engram e tente novamente.",
	"Failed to switch vault: {error}": "Falha ao mudar de cofre: {error}",
	"File exceeds the {limit} limit": "O ficheiro excede o limite de {limit}",
	"File not found locally: {path}": "Ficheiro não encontrado localmente: {path}",
	"File too large for your plan.": "O ficheiro é demasiado grande para o seu plano.",
	"File type not accepted": "Tipo de ficheiro não aceite",
	"Files that will be deleted:": "Ficheiros que serão eliminados:",
	"Filter by folder…": "Filtrar por pasta…",
	"Filter by tags…": "Filtrar por etiquetas…",
	"Finish setting up your account at app.engram.page to start syncing.":
		"Complete a configuração da sua conta em app.engram.page para começar a sincronizar.",
	"Finish sync setup": "Concluir a configuração da sincronização",
	"Finished with some errors. Open the sync log to see what failed.":
		"Terminado com alguns erros. Abra o registo de sincronização para ver o que falhou.",
	"First sync, this may take a moment.": "Primeira sincronização, isto pode demorar um momento.",
	Free: "Gratuito",
	"Free syncs notes only — images & PDFs need a paid plan.":
		"A sincronização gratuita sincroniza apenas notas — imagens e PDFs requerem um plano pago.",
	"Free syncs notes only — {count} attachments will be skipped.": {
		one: "Sincronização gratuita: as notas são sincronizadas, mas apenas {count} anexo será ignorado.",
		many: "Sincronização gratuita de notas apenas — {count} anexos serão ignorados.",
		other: "Sincroniza notas gratuitamente, apenas {count} anexos serão ignorados.",
	},
	"Frontmatter could not be parsed": "Não foi possível analisar o frontmatter",
	"Frontmatter isn't valid YAML.": "O frontmatter não é um YAML válido.",
	'Frontmatter key "{key}" could not be parsed as YAML.':
		'A chave de frontmatter "{key}" não pôde ser interpretada como YAML.',
	"Frontmatter needs a fix": "O frontmatter precisa de correção",
	"Generate new code": "Gerar novo código",
	"Generic cache directory": "Diretório de cache genérico",
	"Getting set up": "A iniciar a configuração",
	"Getting started…": "A iniciar…",
	"GitHub Sponsors": "GitHub Patrocinadores",
	"Gradle build cache": "Cache de construção Gradle",
	"How do you feel about Engram?": "O que pensa de Engram?",
	Idea: "Ideia",
	"If this plugin saves you time, consider supporting development.":
		"Se este plugin lhe poupa tempo, considere apoiar o desenvolvimento.",
	Ignore: "Ignorar",
	"Ignore patterns": "Ignorar padrões",
	"Ignored ({count})": "Ignorado ({count})",
	"Ignored {path} — won't sync until restored from Sync Center.":
		"Ignorado {path} — não será sincronizado até ser restaurado no Centro de sincronização.",
	"Info (default)": "Info (padrão)",
	"Invalid API key": "Chave API inválida",
	"It's OK to email me about this": "Pode enviar-me um e-mail sobre isto",
	"Join our Discord": "Junte-se ao nosso Discord",
	Keyword: "Palavra-chave",
	"Last sync: {when}": "Última sincronização: {when}",
	"Learn more": "Saiba mais",
	"License: {name}": "Licença: {name}",
	"Limit reached. Upgrade to continue.": "Limite atingido. Atualize para continuar.",
	"Link Claude, Cursor, ChatGPT, or any MCP app so it can read and write your notes. ":
		"Ligar o Claude, o Cursor, o ChatGPT ou qualquer aplicação MCP para que ela possa ler e escrever as suas notas. ",
	"Link Obsidian to Engram": "Ligar Obsidian a Engram",
	"Loading vaults…": "A carregar cofres…",
	"Love it": "Adorei",
	"Make new vault": "Criar novo cofre",
	"Manage account": "Gerir conta",
	"Minimum severity that ships while diagnostics are on. Higher levels send fewer lines. Default: Info.":
		"Nível de gravidade mínimo quando os diagnósticos estão ativos. Níveis mais altos enviam menos linhas. Valor padrão: Info.",
	"Missing on the server": "Faltante no servidor",
	"Needs attention ({count})": "Requer atenção ({count})",
	"Network unavailable": "Rede indisponível",
	"New here? Watch the setup video": "Novo por aqui? Veja o vídeo de configuração",
	"New vault": "Novo cofre",
	"Next.js build output": "Resultado da compilação Next.js",
	"No activity yet. Push or pull to see entries here.":
		"Ainda não há atividade. Envie ou receba para ver as entradas aqui.",
	"No files ignored. Use the ignore button on a failure row to stop syncing it.":
		"Nenhum ficheiro ignorado. Use o botão de ignorar numa linha de erro para interromper a sincronização.",
	"No other vaults available.": "Nenhum outro cofre disponível.",
	"No results found": "Nenhum resultado encontrado",
	"No source path for this result": "Sem caminho de origem para este resultado",
	"No sync activity this session.": "Sem atividade de sincronização nesta sessão.",
	"No vaults found — first sync will create one":
		"Nenhum cofre encontrado — a primeira sincronização irá criar um",
	"Node.js dependencies": "Dependências Node.js",
	"Not configured": "Não configurado",
	"Not connected yet. Click to open settings and link this vault.":
		"Ainda não está conectado. Clique para abrir as definições e ligar este cofre.",
	"Not connected. Enter your Engram server URL below to start syncing.":
		"Não está conectado. Insira a URL do servidor Engram abaixo para iniciar a sincronização.",
	"Not now": "Não agora",
	"Not signed in, or the session expired. Sign in again in Engram settings.":
		"Não está autenticado, ou a sessão expirou. Autentique-se novamente nas definições de Engram.",
	"Not signed in. Click to open settings and reconnect.":
		"Não está autenticado. Clique para abrir as definições e reconectar.",
	"Not synced on your plan ({count})": "Não sincronizado no seu plano ({count})",
	"Note couldn't be processed": "A nota não pôde ser processada",
	"Note limit reached. Upgrade to keep adding notes.":
		"Limite de notas atingido. Faça uma atualização para continuar a adicionar notas.",
	"Note not synced locally": "Nota não sincronizada localmente",
	"Notes on this device": "Notas neste dispositivo",
	"Notes past this still sync and open normally, they are just not in the search index. The index keeps your oldest notes, so it is your newest ones that fall outside.":
		"As notas após este ponto continuam a sincronizar e a abrir normalmente, apenas não estão no índice de pesquisa. O índice guarda as suas notas mais antigas, por isso são as mais recentes que ficam de fora.",
	"Notes searchable": "Notas pesquisáveis",
	"Notes stored": "Notas armazenadas",
	"Nothing in this vault syncs until you choose how to merge it with the server.":
		"Nada neste cofre é sincronizado até que escolha como o combinar com o servidor.",
	"Nothing is deleted.": "Nada é apagado.",
	"Nothing needs your attention. 🎉": "Nada requer a sua atenção. 🎉",
	"Nothing to sync yet — this vault is empty on both sides. Start syncing and everything you write appears on your other devices.":
		"Ainda não há nada para sincronizar — este cofre está vazio em ambos os lados. Inicie a sincronização e tudo o que escreve aparece nos seus outros dispositivos.",
	"Nothing to sync yet: every file here is on your ignore list. Start syncing and everything you write appears on your other devices.":
		"Ainda não há nada para sincronizar: todos os ficheiros aqui estão na sua lista de ignorados. Comece a sincronizar e tudo o que escreve aparece nos seus outros dispositivos.",
	"Nothing will be deleted.": "Nada será eliminado.",
	"Nothing will be removed from this device.": "Nada será removido deste dispositivo.",
	Open: "Abrir",
	"Open Connection": "Abrir ligação",
	"Open Engram": "Abrir Engram",
	"Open Engram settings": "Abrir as definições de Engram",
	"Open Engram to check your vault and confirm everything synced.":
		"Abra o Engram para verificar o seu cofre e confirmar que tudo foi sincronizado.",
	"Open connection tab": "Abrir a aba de ligação",
	"Open note": "Abrir nota",
	"Open search sidebar": "Abrir a barra lateral de pesquisa",
	"Open sync center": "Abrir o Centro de sincronização",
	"Open sync setup": "Abrir configuração de sincronização",
	"Open the file to resolve the conflict, then sync again.":
		"Abra o ficheiro para resolver o conflito e, em seguida, sincronize novamente.",
	"Opens your browser to sign in, or create an account if you don't have one yet, then links this vault.":
		"Abre o seu navegador para iniciar sessão, ou criar uma conta se ainda não tiver, e depois associa este cofre.",
	"Or authenticate with a token instead of signing in.":
		"Ou autentique-se com um token em vez de iniciar sessão.",
	"Or authenticate with a token instead of signing in. Engram Cloud API keys require the Pro plan; on Free and Starter, sign in above.":
		"Ou autentique-se com um token em vez de iniciar sessão. As chaves API Engram requerem o plano Pro; nos planos Free e Starter, inicie sessão acima.",
	"Paths to skip (one per line). Folder patterns end with /. Built-in: {configDir}/, .trash/, .git/":
		"Caminhos a ignorar (um por linha). Os padrões de pastas terminam com /. Incorporados: {configDir}/, .trash/, .git/",
	"Pick a vault": "Escolha um cofre",
	"Pick a vault (previous: '{name}' not found)":
		"Escolha um cofre (anterior: '{name}' não encontrado)",
	"Pick a vault (previous: id {id} not found)":
		"Escolha um cofre (anterior: ID {id} não encontrado)",
	"Pick a vault to sync with. We will recalculate the sync preview after you choose.":
		"Escolha um cofre para sincronizar. Recalcularemos a pré-visualização da sincronização após a escolha.",
	"Plan usage": "Utilização do plano",
	Plans: "Planos",
	"Privacy Policy": "Política de privacidade",
	Pro: "Pro",
	"Pull all (delete extras) aborted: could not obtain an exclusive server snapshot (replay contention). Nothing was trashed.":
		'A operação "importar tudo" foi interrompida: não foi possível obter uma cópia exclusiva do servidor (conflito de repetição). Nada foi eliminado.',
	"Pull all aborted: another sync is running (replay contention). Try again when it finishes.":
		'A operação "importar tudo" foi interrompida: outra sincronização está em curso (conflito de repetição). Tente novamente quando terminar.',
	"Pull all failed: {error}": 'A operação "importar tudo" falhou: {error}',
	"Pull all from server (force overwrite)": "Descarregar tudo do servidor (substituição forçada)",
	Pulled: "Recebido",
	"Push entire vault": "Enviar todo o cofre",
	Pushed: "Enviado",
	"Python bytecode cache": "Cache de bytecode Python",
	"Python virtual environment": "Ambiente virtual Python",
	"Read it": "Ler",
	"Real-time sync": "Sincronização em tempo real",
	"Reconnect your account to resume syncing.": "Reconecte a conta para retomar a sincronização.",
	Refresh: "Atualizar",
	"Remote vault": "Cofre remoto",
	"Remove tag {tag}": "Remover etiqueta {tag}",
	"Replacing the remote stopped early: the ignore list changed during sync. Some remote notes were not removed; run it again.":
		"A substituição remota foi interrompida prematuramente: a lista de ignorados foi alterada durante a sincronização. Algumas notas remotas não foram removidas; execute novamente.",
	"Report an issue": "Reportar um problema",
	"Report an issue on GitHub": "Reporte um problema no GitHub",
	"Request failed ({status})": "Falha na requisição ({status})",
	Restore: "Restaurar",
	"Restored {path} — will sync on next push.":
		"Restaurado {path} — será sincronizado no próximo envio.",
	"Retry all now": "Tentar novamente tudo agora",
	"Retrying automatically ({count})": "A tentar novamente automaticamente ({count})",
	"Review and accept": "Rever e aceitar",
	"Run in background": "Executar em segundo plano",
	"Run your own Engram server": "Execute o seu próprio servidor Engram",
	"Rust/Java build output": "Saída da construção Rust/Java",
	"Safe choice: combines both sides, nothing is deleted.":
		"Escolha segura: combina ambos os lados, nada é apagado.",
	Save: "Guardar",
	"Search across all vaults at once": "Pesquise em todos os Cofres de uma vez",
	"Search all your notes": "Pesquise todas as suas notas",
	"Search failed — check connection": "A pesquisa falhou — verifique a ligação",
	"Search settings": "Definições de pesquisa",
	"Search your vault…": "Pesquisar no seu cofre…",
	"Searching {indexed} of {all} notes. Upgrade to search everything.":
		"A pesquisar {indexed} de {all} notas. Atualize para pesquisar tudo.",
	"See full pricing": "Ver preços completos",
	"See the AI setup guide": "Consulte o guia de configuração da IA",
	"Select which vault this plugin syncs with.":
		"Selecione o cofre com o qual este plugin sincroniza.",
	"Self-hosted": "Servidor próprio",
	Semantic: "Semântica",
	"Semantic search": "Pesquisa semântica",
	Send: "Enviar",
	"Send debug logs. Note content stays private.":
		"Enviar registos de depuração. O conteúdo das notas permanece privado.",
	"Send detailed sync, vault, and connection activity to the server for troubleshooting, with distributed tracing on requests. Metadata only, never note content. Leave off for normal use.":
		"Envie informações detalhadas sobre a sincronização, o cofre e a atividade da ligação para o servidor para resolução de problemas, com rastreamento distribuído nas requisições. Apenas metadados, nunca o conteúdo das notas. Desative para utilização normal.",
	"Send feedback": "Enviar feedback",
	"Sending…": "A enviar…",
	"Server error": "Erro no servidor",
	"Server error ({status}) — check Engram logs":
		"Erro do servidor ({status}) — verifique os registos Engram",
	"Server unreachable — changes will sync when connected":
		"Servidor inacessível — as alterações serão sincronizadas quando conectado",
	"Set up sync for this vault": "Configure a sincronização para este cofre",
	"Setup is not finished — nothing will sync until you choose a sync direction. Click to finish.":
		"A configuração não está concluída — nada será sincronizado até que escolha uma direção de sincronização. Clique para concluir.",
	"Show files ({count}) ▾": "Mostrar ficheiros ({count}) ▾",
	"Show sync log": "Mostrar o registo da sincronização",
	"Showing {count} entries": {
		one: "A mostrar {count} entrada",
		many: "A mostrar {count} entradas",
		other: "A mostrar {count} entradas",
	},
	"Sign in": "Iniciar sessão",
	"Sign in (or enter your server URL and key) on the connection tab, then run your first sync.":
		"Inicie sessão (ou introduza a URL do servidor e a chave) na aba de ligação e, em seguida, execute a primeira sincronização.",
	"Sign in or create an account": "Iniciar sessão ou criar uma conta",
	"Sign out": "Desconectar",
	"Sign-in expired": "Sessão expirada",
	"Sign-in required to load vaults": "É necessário iniciar sessão para carregar os cofres",
	"Signed in as {email}": "Iniciado sessão como {email}",
	Skipped: "Ignorado",
	"Source: {link}": "Origem: {link}",
	"Start syncing": "Iniciar a sincronização",
	Starter: "Starter",
	"Starting...": "A iniciar...",
	Stats: "Estatísticas",
	"Support development": "Apoiar o desenvolvimento",
	"Switch to sign in": "Mudar para iniciar sessão",
	"Switch vault": "Mudar de cofre",
	"Switched to {mode}.": "Alterado para {mode}.",
	Sync: "Sincronizar",
	"Sync complete": "Sincronização concluída",
	"Sync failed": "A sincronização falhou",
	"Sync in progress...": "Sincronização em curso...",
	"Sync log": "Registo de sincronização",
	"Sync now": "Sincronizar agora",
	"Sync paused — click to choose a sync direction":
		"Sincronização pausada — clique para escolher uma direção de sincronização",
	"Sync preview": "Pré-visualização da sincronização",
	"Sync server": "Servidor de sincronização",
	"Sync these now": "Sincronizar agora",
	"Sync...": "A sincronizar...",
	"Synced. Some attachments need a paid plan to sync (see below).":
		"Sincronizado. Alguns anexos necessitam de um plano pago para sincronizar (ver abaixo).",
	"Syncing attachments": "A sincronizar anexos",
	"Syncing your vault": "A sincronizar o seu cofre",
	"Syncing...": "A sincronizar...",
	"Syncing…": "A sincronizar…",
	"Tell us anything": "Diga-nos qualquer coisa",
	"Temporary errors. These clear themselves once the server recovers.":
		"Erros temporários. Estes desaparecem quando o servidor volta a funcionar.",
	"Terms of Service": "Termos de serviço",
	"Thanks, we read every message.": "Obrigado, lemos todas as mensagens.",
	"That does not look like a complete server address. Include the scheme, for example http://127.0.0.1:4000":
		"Isto não parece ser um endereço de servidor completo. Inclua o esquema, por exemplo http://127.0.0.1:4000",
	"That does not look like an Engram API key (expected {prefix}…).":
		"Isso não parece ser uma chave API do Engram (esperava {prefix}…).",
	"The Free tier syncs notes only. Upgrade to sync images and PDFs.":
		"A versão gratuita sincroniza apenas notas. Atualize para sincronizar imagens e PDFs.",
	"The file is over the server's size limit. Compress or split it, then it will sync.":
		"O ficheiro excede o limite de tamanho do servidor. Comprima ou divida-o, e então ele será sincronizado.",
	"The file is too large for the server.": "O ficheiro é demasiado grande para o servidor.",
	"The note synced, but its frontmatter could not be fully parsed. Open it to fix the highlighted line.":
		"A nota foi sincronizada, mas o seu frontmatter não pôde ser totalmente analisado. Abra-a para corrigir a linha destacada.",
	"The server couldn't process this note. Check its contents, then edit and save to try again.":
		"O servidor não conseguiu processar esta nota. Verifique o seu conteúdo, depois edite e guarde para tentar novamente.",
	"The server does not accept this type of file. It will retry if the file changes.":
		"O servidor não aceita este tipo de ficheiro. Tentará novamente se o ficheiro for alterado.",
	"The server lost this file's stored content and will try to restore it. Nothing on this device was changed.":
		"O servidor perdeu o conteúdo guardado deste ficheiro e tentará restaurá-lo. Nada foi alterado neste dispositivo.",
	"The server took too long to respond. Try again.":
		"O servidor demorou demasiado tempo a responder. Tente novamente.",
	"These files are fine. They just need a paid plan to sync.":
		"Estes ficheiros estão bem. Apenas precisam de um plano pago para sincronizar.",
	"This account was deleted. Contact support if that is wrong.":
		"Esta conta foi eliminada. Contacte o suporte se estiver errado.",
	"This cannot be undone.": "Esta ação não pode ser desfeita.",
	"This code expired before the link finished. Generate a new code to try again.":
		"Este código expirou antes de a ligação ser concluída. Gere um novo código para tentar novamente.",
	"This device's vault is empty. Download {what} from the server?":
		"O cofre deste dispositivo está vazio. Deseja descarregar {what} do servidor?",
	"This file type isn't accepted by this server.":
		"Este tipo de ficheiro não é aceite por este servidor.",
	"This note could not be processed and was skipped.":
		"Esta nota não pôde ser processada e foi ignorada.",
	"This server is self-hosted, so feedback is not collected here. ":
		"Este servidor é alojado localmente, portanto, não são recolhidos dados aqui. ",
	"This vault": "Este cofre",
	"This vault is empty on the server. Upload your {what}?":
		"Este cofre está vazio no servidor. Deseja enviar {what}?",
	"Too large for the server": "Demasiado grande para o servidor",
	"Too many connected AI clients. Disconnect one or upgrade.":
		"Demasiados clientes de IA conectados. Desconecte um ou faça uma atualização.",
	"Too many connected Obsidian vaults. Disconnect one or upgrade.":
		"Demasiados cofres Obsidian conectados. Desconecte um ou faça uma atualização.",
	"Too many requests. Wait a moment and try again.":
		"Demasiadas solicitações. Aguarde um momento e tente novamente.",
	"Type {keyword} to confirm:": "Introduza {keyword} para confirmar:",
	"Unknown error": "Erro desconhecido",
	"Unlimited AI searches": "Pesquisas de IA ilimitadas",
	"Unlimited vaults": "Cofres ilimitados",
	"Unresolved conflict": "Conflito não resolvido",
	Untitled: "Sem título",
	Update: "Atualizar",
	"Update in settings": "Atualizar nas definições",
	Upgrade: "Atualizar",
	"Upload everything": "Enviar tudo",
	"Upload local files without downloading the remote":
		"Envie ficheiros locais sem descarregar os remotos",
	"Upload {count} files from this vault": {
		one: "Carregar {count} ficheiro deste cofre",
		many: "Carregar {count} ficheiros deste cofre",
		other: "Carregar {count} ficheiros deste cofre",
	},
	Uploading: "A enviar",
	"Uploading {count}.": {
		one: "A enviar {count}.",
		many: "A enviar {count}.",
		other: "A enviar {count}.",
	},
	"Uploads {up}, downloads {down}.": "Envio {up}, download {down}.",
	"Using API key": "A utilizar chave API",
	Vault: "Cofre",
	"Vault ID: {id}": "ID do Cofre: {id}",
	"Vault limit reached. Upgrade for more vaults.":
		"Limite de cofres atingido. Faça uma atualização para ter mais cofres.",
	"Vault name": "Nome do Cofre",
	"Vault selection": "Seleção do Cofre",
	"Vendored dependencies": "Dependências incluídas",
	"Version: {version}": "Versão: {version}",
	"Waiting for authorization — connected, this will complete instantly.":
		"Aguardando autorização — conectado, isto será concluído instantaneamente.",
	"Waiting for authorization — no live connection, checking every 30s.":
		"Aguardando autorização — sem ligação ativa, a verificar a cada 30 segundos.",
	"Warnings and errors": "Avisos e erros",
	"WebSocket connected — live sync active": "WebSocket conectado — sincronização ativa",
	"What Engram does, and how to connect your vault, start to finish.":
		"O que o Engram faz e como conectar o seu cofre, do início ao fim.",
	"What kind of feedback?": "Que tipo de feedback?",
	"What's working, what's frustrating, what do you wish Engram did?":
		"O que está a funcionar, o que é frustrante, o que gostaria que o Engram fizesse?",
	"Where this vault syncs to. Each backend keeps its own sign-in.":
		"Para onde este cofre é sincronizado. Cada backend tem a sua própria autenticação.",
	"Will download {count} files.": {
		one: "Vai descarregar {count} ficheiro.",
		many: "Vai descarregar {count} de ficheiros.",
		other: "Vai descarregar {count} ficheiros.",
	},
	"Will upload {count} files.": {
		one: "Vai enviar {count} ficheiro.",
		many: "Vai transferir {count} de ficheiros.",
		other: "Vai enviar {count} ficheiros.",
	},
	"You are about to:": "Está prestes a:",
	"You are now pointing at a different cloud vault":
		"Está agora a apontar para um cofre na nuvem diferente",
	"You can close this and the sync keeps running in the background.":
		"Pode fechar isto e a sincronização continua a funcionar em segundo plano.",
	"You've used all the attachment storage on your plan. Upgrade for more.":
		"Utilizou todo o armazenamento de anexos do seu plano. Atualize para obter mais.",
	"Your code:": "O seu código:",
	"Your feedback": "O seu feedback",
	"Your login expired. Sign in again in Engram settings to continue.":
		"A sua sessão expirou. Inicie sessão novamente nas Engram definições para continuar.",
	"Your plan's file limit is {limit}. Compress or split the file, then it will sync.":
		"O limite de tamanho do ficheiro do seu plano é {limit}. Comprima ou divida o ficheiro, e então ele será sincronizado.",
	"Your vault shares {percent} of its data with Engram":
		"O seu cofre partilha {percent} dos seus dados com Engram",
	attachments: "anexos",
	exact: "exato",
	files: "ficheiros",
	folders: "pastas",
	"match strength: {pct}%": "força da correspondência: {pct}%",
	"matches meaning. Finds notes that never use the words you typed.":
		"corresponde ao significado. Encontra notas que nunca usam as palavras que digitou.",
	"matches words and meaning together, plus this device. Widest results.":
		"Combina palavras e significado, mais este dispositivo. Resultados mais abrangentes.",
	"matches your words and their other forms — 'run' finds 'running' — plus this device.":
		'corresponde às suas palavras e às suas outras formas — "correr" encontra "correndo" — e também a este dispositivo.',
	meaning: "significado",
	"meaning + exact": "significado + exato",
	"not linked": "não ligado",
	notes: "notas",
	"setup guide": "guia de configuração",
	"sync is paused": "a sincronização está suspensa",
	"syncing now": "a sincronizar agora",
	unknown: "desconhecido",
	"waiting for a connection": "à espera de uma ligação",
	"waiting to retry": "à espera para tentar novamente",
	"{count} attachments": {
		one: "{count} anexo",
		many: "{count} anexos",
		other: "{count} anexos",
	},
	"{count} attachments need a paid plan to sync. See Sync Center.": {
		one: "{count} anexo necessita de um plano pago para sincronizar. Consulte o Centro de sincronização.",
		many: "{count} anexos requerem um plano pago para sincronizar. Consulte o Centro de sincronização.",
		other: "{count} anexos necessitam de um plano pago para sincronizar. Consulte o Centro de sincronização.",
	},
	"{count} attempts": {
		one: "{count} tentativas",
		many: "{count} tentativas",
		other: "{count} tentativas",
	},
	"{count} conflicts need resolution": {
		one: "{count} conflito necessita de resolução",
		many: "{count} conflitos precisam de ser resolvidos",
		other: "{count} conflitos precisam de resolução",
	},
	"{count} conflicts to resolve.": {
		one: "{count} conflito a resolver.",
		many: "{count} conflitos a resolver.",
		other: "{count} conflitos a resolver.",
	},
	"{count} diverged": {
		one: "{count} divergente",
		many: "{count} divergências",
		other: "{count} divergências",
	},
	'{count} failed. Run "{command}" for details.': {
		one: '{count} falhou. Execute "{command}" para detalhes.',
		many: '{count} falhou. Execute "{command}" para detalhes.',
		other: '{count} falhou. Execute "{command}" para detalhes.',
	},
	"{count} files": {
		one: "{count} ficheiro",
		many: "{count} ficheiros",
		other: "{count} ficheiros",
	},
	"{count} files not included in your plan": {
		one: "{count} ficheiro não incluído no plano",
		many: "{count} ficheiros não incluídos no seu plano",
		other: "{count} ficheiros não incluídos no plano",
	},
	"{count} files queued": {
		one: "{count} ficheiro na fila",
		many: "{count} ficheiros na fila",
		other: "{count} ficheiros na fila",
	},
	"{count} ignored": {
		one: "{count} ignorado",
		many: "{count} ignorados",
		other: "{count} ignorados",
	},
	"{count} missing on server": {
		one: "{count} em falta no servidor",
		many: "{count} ausentes no servidor",
		other: "{count} em falta no servidor",
	},
	"{count} need attention": {
		one: "{count} precisa de atenção",
		many: "{count} requerem atenção",
		other: "{count} requerem atenção",
	},
	"{count} notes": { one: "{count} notas", many: "{count} notas", other: "{count} notas" },
	"{count} only on server": {
		one: "{count} apenas no servidor",
		many: "{count} apenas no servidor",
		other: "{count} apenas no servidor",
	},
	"{count} queued — {reason}": {
		one: "{count} enfileirado — {reason}",
		many: "{count} na fila — {reason}",
		other: "{count} en espera — {reason}",
	},
	"{count} retrying": {
		one: "{count} a tentar novamente",
		many: "{count} a tentar novamente",
		other: "{count} a tentar novamente",
	},
	"{desc} — should not be synced": "{desc} — não deve ser sincronizado",
	"{first} and {second}": "{first} e {second}",
	"{formatted} per day": "{formatted} por dia",
	"{label} ({count} queued)": {
		one: "{label} ({count} na fila)",
		many: "{label} ({count} em espera)",
		other: "{label} ({count} na fila)",
	},
	"{n} of 5": "{n} de 5",
	"▶ Watch on YouTube": "▶ Ver no YouTube",
	"⚙️ Advanced": "⚙️ Avançado",
	"⚠ Detected: {label}/ ({formatted} files)": "⚠ Detetado: {label} / ({formatted} ficheiros)",
	"✓ Engram server reachable (v{version})": "✓ Servidor Engram acessível (v{version})",
	"✓ {count} synced": {
		one: "✓ {count} sincronizado",
		many: "✓ {count} sincronizados",
		other: "✓ {count} sincronizados",
	},
	"✕ {count} failed": {
		one: "✕ {count} falha",
		many: "✕ {count} falhou",
		other: "✕ {count} falhas",
	},
	"✗ couldn't reach a server at this URL": "✗ Não foi possível contactar um servidor neste URL",
	"✗ server responded but isn't an Engram server":
		"✗ O servidor respondeu, mas não é um servidor Engram",
	"⤳ {count} skipped (Free plan)": {
		one: "⤳ {count} ignorado (Plano gratuito)",
		many: "⤳ {count} ignorados (Plano gratuito)",
		other: "⤳ {count} ignorados (Plano gratuito)",
	},
	"👋 Welcome": "👋 Bem-vindo",
	"💬 Feedback": "💬 Feedback",
	"🔄 Sync Center": "🔄 Centro de sincronização",
	"🔌 Connection": "🔌 Conexão",
};

export default pt;
