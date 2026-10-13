import type { Dict } from "..";

// Português (Portugal)
const pt: Dict = {
	"waiting for a connection": "à espera de uma ligação",
	"sync is paused": "a sincronização está suspensa",
	"syncing now": "a sincronizar agora",
	"waiting to retry": "à espera para tentar novamente",
	"{count} not on your plan": {
		one: "{count} não incluído no seu plano",
		many: "{count} não está incluído no seu plano",
		other: "{count} não incluídos no seu plano",
	},
	"{count} need attention": {
		one: "{count}. Precisa de atenção",
		many: "{count} precisa de atenção",
		other: "{count} precisam de atenção",
	},
	"{count} retrying": {
		one: "{count}. a tentar novamente",
		many: "{count} a tentar novamente",
		other: "{count}. a tentar novamente",
	},
	"{count} ignored": {
		one: "{count} ignorado",
		many: "{count} ignorados",
		other: "{count} ignorados",
	},
	"{count} queued — {reason}": {
		one: "{count} enfileirado — {reason}",
		many: "{count} na fila — {reason}",
		other: "{count} en espera — {reason}",
	},
	"Sync...": "A sincronizar...",
	"Engram Sync: {details}": "Engram: Sincronização: {details}",
	Refresh: "Atualizar",
	"Not synced on your plan ({count})": "Não sincronizado no seu plano ({count})",
	"These files are fine. They just need a paid plan to sync.":
		"Estes ficheiros estão bem. Apenas precisam de um plano pago para sincronizar.",
	"Show files ({count}) ▾": "Mostrar ficheiros ({count}) ▾",
	Upgrade: "Atualizar",
	"Sync these now": "Sincronizar agora",
	"Needs attention ({count})": "Requer atenção ({count})",
	"Clear all": "Limpar tudo",
	"Nothing needs your attention. 🎉": "Nada requer a sua atenção. 🎉",
	Dismiss: "Fechar",
	"Retrying automatically ({count})": "A tentar novamente automaticamente ({count})",
	"Retry all now": "Tentar novamente tudo agora",
	"Temporary errors. These clear themselves once the server recovers.":
		"Erros temporários. Estes desaparecem quando o servidor se recupera.",
	"{count} attempts": {
		one: "{count} tentativas",
		many: "{count} tentativas",
		other: "{count} tentativas",
	},
	Open: "Abrir",
	Ignore: "Ignorar",
	"Ignored ({count})": "Ignorado ({count})",
	"No files ignored. Use the ignore button on a failure row to stop syncing it.":
		"Nenhum ficheiro ignorado. Use o botão de ignorar numa linha de erro para interromper a sincronização.",
	Restore: "Restaurar",
	"File not found locally: {path}": "Ficheiro não encontrado localmente: {path}",
	"Ignored {path} — won't sync until restored from Sync Center.":
		"Ignorado {path} — não será sincronizado até ser restaurado no Centro de sincronização.",
	"Restored {path} — will sync on next push.":
		"Restaurado {path} — será sincronizado no próximo envio.",
	"Activity ({count})": "Atividade ({count})",
	Clear: "Limpar",
	"No activity yet. Push or pull to see entries here.":
		"Ainda não há atividade. Envie ou receba para ver as entradas aqui.",
	Pushed: "Enviado",
	Pulled: "Recebido",
	Deleted: "Eliminado",
	Conflict: "Conflito",
	Skipped: "Ignorado",
	Error: "Erro",
	Stats: "Estatísticas",
	"Notes on this device": "Notas neste dispositivo",
	"Attachments on this device": "Anexos neste dispositivo",
	"Remote vault": "Cofre remoto",
	"not linked": "não ligado",
	Attachments: "Anexos",
	"Plan usage": "Utilização do plano",
	"File exceeds the {limit} limit": "O ficheiro excede o limite de {limit}",
	"Free syncs notes only — images & PDFs need a paid plan.":
		"A sincronização gratuita sincroniza apenas notas — imagens e PDFs requerem um plano pago.",
	"Engram: {count} files failed to sync{detail} — open Sync Center": {
		one: "Engram: {count} ficheiro falhou na sincronização{detail} — abrir o Centro de sincronização",
		many: "Engram: {count} ficheiros falharam na sincronização{detail} — abrir o Centro de sincronização",
		other: "Engram: {count} ficheiros falharam na sincronização{detail} — abrir o Centro de sincronização",
	},
	"Engram: {count} attachments skipped — upgrade to sync images & PDFs.": {
		one: "Engram: {count} anexo ignorado — atualize para sincronizar imagens e PDFs.",
		many: "Engram: {count} anexos ignorados — faça uma atualização para sincronizar imagens e PDFs.",
		other: "Engram: {count} anexos ignorados — atualize para sincronizar imagens e PDFs.",
	},
	"Engram: plan upgraded — syncing {count} attachments…": {
		one: "Engram: plano atualizado — a sincronizar {count} anexo…",
		many: "Engram: plano atualizado — a sincronizar {count} de anexos…",
		other: "Engram: plano atualizado — a sincronizar {count} anexos…",
	},
	"Pull all (delete extras) aborted: could not obtain an exclusive server snapshot (replay contention). Nothing was trashed.":
		'A operação "importar tudo" foi interrompida: não foi possível obter uma cópia exclusiva do servidor (conflito de repetição). Nada foi eliminado.',
	"Pull all aborted: another sync is running (replay contention). Try again when it finishes.":
		'A operação "importar tudo" foi interrompida: outra sincronização está em curso (conflito de repetição). Tente novamente quando terminar.',
	"Pull all failed: {error}": 'A operação "importar tudo" falhou: {error}',
	"Engram: sync conflict on {path} — your local edit was saved as {copy}":
		"Engram: conflito de sincronização em {path} — a edição local foi guardada como {copy}",
	"Connection failed": "Falha na ligação",
	"Open note": "Abrir nota",
	"Engram: {count} notes have frontmatter problems. Open Sync Center to fix.": {
		one: "Engram: {count} nota tem problemas no frontmatter. Abra o Centro de sincronização para corrigir.",
		many: "Engram: {count} notas têm problemas no frontmatter. Abra o Centro de sincronização para corrigir.",
		other: "Engram: {count} notas têm problemas no frontmatter. Abra o Centro de sincronização para corrigir.",
	},
	'Engram Sync: renamed "{name}" (unsupported characters)':
		'Engram Sincronização: renomeado "{name}" (carateres não suportados)',
	'Engram: frontmatter problem in "{name}"': 'Engram: problema no frontmatter em "{name}"',
	"Uploading {count}.": {
		one: "A enviar {count}.",
		many: "A enviar {count}.",
		other: "A enviar {count}.",
	},
	"Downloading {count}.": {
		one: "A descarregar {count}.",
		many: "A descarregar {count}.",
		other: "A descarregar {count}.",
	},
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
	"First sync, this may take a moment.": "Primeira sincronização, isto pode demorar um momento.",
	"Checking for changes.": "A verificar alterações.",
	"Nothing will be deleted.": "Nada será eliminado.",
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
		many: "✕ {count} falhou",
		other: "✕ {count} falhas",
	},
	"{count} attachments need a paid plan to sync. See Sync Center.": {
		one: "{count} anexo necessita de um plano pago para sincronizar. Consulte o Centro de sincronização.",
		many: "{count} anexos requerem um plano pago para sincronizar. Consulte o Centro de sincronização.",
		other: "{count} anexos necessitam de um plano pago para sincronizar. Consulte o Centro de sincronização.",
	},
	"Finished with some errors. Open the sync log to see what failed.":
		"Terminado com alguns erros. Abra o registo de sincronização para ver o que falhou.",
	"Synced. Some attachments need a paid plan to sync (see below).":
		"Sincronizado. Alguns anexos necessitam de um plano pago para sincronizar (ver abaixo).",
	"All synced. Your vault and the cloud now match.":
		"Tudo sincronizado. O seu cofre e a nuvem estão agora sincronizados.",
	"Already up to date. Nothing needed syncing.":
		"Já está atualizado. Não é necessário sincronizar nada.",
	Deleting: "A eliminar",
	Downloading: "A descarregar",
	Uploading: "A enviar",
	"Syncing your vault": "A sincronizar o seu cofre",
	"Getting started…": "A iniciar…",
	"Open Engram to check your vault and confirm everything synced.":
		"Abra o Engram para verificar o seu cofre e confirmar que tudo foi sincronizado.",
	"Open Engram": "Abrir Engram",
	"You can close this and the sync keeps running in the background.":
		"Pode fechar isto e a sincronização continua a funcionar em segundo plano.",
	"Run in background": "Executar em segundo plano",
	"Syncing…": "A sincronizar…",
	"Sync complete": "Sincronização concluída",
	"Show sync log": "Mostrar o registo da sincronização",
	Done: "Concluído",
	"Syncing attachments": "A sincronizar anexos",
	Complete: "Concluído",
	'{count} failed. Run "{command}" for details.': {
		one: '{count} falhou. Execute "{command}" para detalhes.',
		many: '{count} falhou. Execute "{command}" para detalhes.',
		other: '{count} falhou. Execute "{command}" para detalhes.',
	},
	"Note limit reached. Upgrade to keep adding notes.":
		"Limite de notas atingido. Faça uma atualização para continuar a adicionar notas.",
	"Vault limit reached. Upgrade for more vaults.":
		"Limite de cofres atingido. Faça uma atualização para ter mais cofres.",
	"This file type isn't accepted by this server.":
		"Este tipo de ficheiro não é aceite por este servidor.",
	"Attachment sync is disabled for this account.":
		"A sincronização de anexos está desativada para esta conta.",
	"Attachment storage is full — upgrade for more.":
		"O espaço de armazenamento de anexos está cheio — faça uma atualização para ter mais.",
	"File too large for your plan.": "O ficheiro é demasiado grande para o seu plano.",
	"Already signed in on another device. Upgrade for multi-device.":
		"Já está autenticado noutro dispositivo. Faça uma atualização para usar em vários dispositivos.",
	"Device swap cooldown active. Wait or upgrade.":
		"Período de espera para troca de dispositivo ativo. Aguarde ou faça uma atualização.",
	"Too many connected Obsidian vaults. Disconnect one or upgrade.":
		"Demasiados cofres Obsidian conectados. Desconecte um ou faça uma atualização.",
	"Too many connected AI clients. Disconnect one or upgrade.":
		"Demasiados clientes de IA conectados. Desconecte um ou faça uma atualização.",
	"Daily AI search limit reached. Free includes 20 per day across Obsidian, the web app and MCP. Upgrade for unlimited.":
		"Limite diário de pesquisa de IA atingido. A versão gratuita inclui 20 por dia, distribuídos por Obsidian, a aplicação web e MCP. Faça uma atualização para ter acesso ilimitado.",
	"API keys need Pro. Sign in with your Engram account instead.":
		"As chaves API precisam de Pro. Autentique-se com a sua conta Engram em vez disso.",
	"Account suspended. Contact support.": "Conta suspensa. Contacte o suporte.",
	"Account setup incomplete.": "Configuração da conta incompleta.",
	"This account was deleted. Contact support if that is wrong.":
		"Esta conta foi eliminada. Contacte o suporte se estiver errado.",
	"Finish setting up your account at app.engram.page to start syncing.":
		"Complete a configuração da sua conta em app.engram.page para começar a sincronizar.",
	"Limit reached. Upgrade to continue.": "Limite atingido. Atualize para continuar.",
	"Link Obsidian to Engram": "Ligar Obsidian a Engram",
	"Starting...": "A iniciar...",
	"Failed to start device flow. Check your Engram URL and try again.":
		"Falha ao iniciar o processo de autenticação. Verifique a URL do Engram e tente novamente.",
	"Your code:": "O seu código:",
	"Click to copy": "Clicar para copiar",
	"Code copied!": "Código copiado!",
	"A browser window has opened. Sign in and enter this code to link your vault.":
		"Uma janela do navegador foi aberta. Inicie sessão e insira este código para ligar o seu cofre.",
	Cancel: "Cancelar",
	"Waiting for authorization — connected, this will complete instantly.":
		"Aguardando autorização — conectado, isto será concluído instantaneamente.",
	"Waiting for authorization — no live connection, checking every 30s.":
		"Aguardando autorização — sem ligação ativa, a verificar a cada 30 segundos.",
	"Code expired. Please try again.": "Código expirado. Por favor, tente novamente.",
	"Try again": "Tentar novamente",
	Close: "Fechar",
	"Update in settings": "Atualizar nas definições",
	"Sync now": "Sincronizar agora",
	"Engram sync: syncing...": "Engram Sincronização: a sincronizar...",
	"Engram Sync: pulled {pulled}, pushed {pushed}":
		"Engram Sincronização: transferidos {pulled}, enviados {pushed}",
	"Disconnect (clear login)": "Desconectar (limpar login)",
	"Engram: disconnected. Open Engram settings to reconnect.":
		"Engram: desconectado. Abra as definições de Engram para reconectar.",
	"Push entire vault": "Enviar todo o cofre",
	"Engram Sync: pushed {count} files": {
		one: "Engram Sincronização: enviados {count} ficheiro",
		many: "Engram Sincronização: enviados {count} ficheiros",
		other: "Engram Sincronização: enviados {count} ficheiros",
	},
	"Check sync status": "Verificar o estado da sincronização",
	"Engram sync: checking...": "Engram: a sincronização: a verificar...",
	"Engram sync: server does not support reconciliation (update backend)":
		"Engram: a sincronização: o servidor não suporta a reconciliação (atualizar o backend)",
	"Engram sync: everything in sync": "Engram: a sincronização: tudo sincronizado",
	"{count} missing on server": {
		one: "{count} em falta no servidor",
		many: "{count} em falta no servidor",
		other: "{count} em falta no servidor",
	},
	"{count} diverged": {
		one: "{count} divergente",
		many: "{count} divergências",
		other: "{count} divergências",
	},
	"{count} only on server": {
		one: "{count} apenas no servidor",
		many: "{count} apenas no servidor",
		other: "{count} apenas no servidor",
	},
	"Pull all from server (force overwrite)": "Descarregar tudo do servidor (substituição forçada)",
	"Engram sync: pulling all from server...":
		"Engram: a sincronização: a descarregar tudo do servidor...",
	"Engram Sync: pulled {count} files from server": {
		one: "Engram Sincronização: transferidos {count} ficheiro do servidor",
		many: "Engram Sincronização: transferidos {count} ficheiros do servidor",
		other: "Engram Sincronização: transferidos {count} ficheiros do servidor",
	},
	"Send feedback": "Enviar feedback",
	"Semantic search": "Pesquisa semântica",
	"Open search sidebar": "Abrir a barra lateral de pesquisa",
	"Engram search": "Engram: pesquisa",
	"Open sync center": "Abrir o Centro de sincronização",
	"Engram: ready": "Engram: pronto",
	"Engram Sync: pushed {pushed}": "Engram Sincronização: enviada {pushed}",
	"Engram sync: sync failed": "Engram sincronização: falha na sincronização",
	"Engram: this vault no longer exists on the server. Pick or create a vault to continue.":
		"Engram: este cofre já não existe no servidor. Escolha ou crie um cofre para continuar.",
	"Engram: recovered plugin settings from a backup after a corrupted save.":
		"Engram: definições do plugin recuperadas de uma cópia de segurança após uma gravação corrompida.",
	"Engram: plugin settings file was corrupted and could not be recovered. You may need to reconnect in settings.":
		"Engram: o ficheiro de definições do plugin foi corrompido e não foi possível recuperá-lo. Pode ser necessário reconectar nas definições.",
	"Engram: your login expired — open Engram settings to reconnect.":
		"Engram: a sua sessão expirou — abra as definições de Engram para reconectar.",
	"Engram: This vault has been deleted on the server.":
		"Engram: este cofre foi eliminado no servidor.",
	"Engram sync: live sync requires a plugin update — please update the Engram vault sync plugin.":
		"Engram sincronização: a sincronização em tempo real requer uma atualização do plugin — atualize o plugin de sincronização do Engram cofre.",
	"Engram Sync: pulled {pulled} (local extras deleted)":
		"Engram Sincronização: recebida {pulled} (extras locais eliminados)",
	"Engram Sync: pulled {pulled}": "Engram Sincronização: recebida {pulled}",
	"Engram Sync: replaced remote with local ({pushed} uploaded)":
		"Engram Sincronização: substituída a versão remota pela versão local ({pushed} enviada)",
	"Engram: sync is not set up yet, so nothing in this vault will sync.":
		"Engram: a sincronização ainda não está configurada, portanto, nada neste cofre será sincronizado.",
	"Finish sync setup": "Concluir a configuração da sincronização",
	"Engram: sync is paused. This edit was not synced. Choose a sync direction to resume.":
		"Engram: a sincronização está pausada. Esta edição não foi sincronizada. Escolha uma direção de sincronização para retomar.",
	"Open Engram settings": "Abrir as definições de Engram",
	"Engram: sync failed. Open the sync log for details.":
		"Engram: a sincronização falhou. Abrir o registo de sincronização para obter detalhes.",
	"Engram: not connected": "Engram: não está conectado",
	"Engram: signed out": "Engram: saiu da conta",
	"Not connected yet. Click to open settings and link this vault.":
		"Ainda não está conectado. Clique para abrir as definições e ligar este cofre.",
	"Not signed in. Click to open settings and reconnect.":
		"Não está autenticado. Clique para abrir as definições e reconectar.",
	"Engram: finish setup": "Engram: concluir a configuração",
	"Engram: sync paused": "Engram: sincronização pausada",
	"{label} ({count} queued)": {
		one: "{label} ({count} na fila)",
		many: "{label} ({count} em espera)",
		other: "{label} ({count} na fila)",
	},
	"Setup is not finished — nothing will sync until you choose a sync direction. Click to finish.":
		"A configuração não está concluída — nada será sincronizado até que escolha uma direção de sincronização. Clique para concluir.",
	"Sync paused — click to choose a sync direction":
		"Sincronização pausada — clique para escolher uma direção de sincronização",
	"Engram: offline ({count} queued)": {
		one: "Engram: offline ({count} na fila)",
		many: "Engram: offline ({count} em fila)",
		other: "Engram: offline ({count} na fila)",
	},
	"Engram: offline": "Engram: offline",
	"Server unreachable — changes will sync when connected":
		"Servidor inacessível — as alterações serão sincronizadas quando conectado",
	"Engram: error": "Engram: erro",
	"Unknown error": "Erro desconhecido",
	"Engram: syncing ({count})": "Engram: a sincronizar ({count})",
	"Engram: syncing": "Engram: a sincronizar",
	"Sync in progress...": "Sincronização em curso...",
	"Engram: pending ({count})": "Engram: pendente ({count})",
	"{count} files queued": {
		one: "{count} ficheiro na fila",
		many: "{count} ficheiros na fila",
		other: "{count} ficheiros na fila",
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
		one: "Engram Sincronização: transferidos {count} alteração",
		many: "Engram Sincronização: transferidos {count} de alterações",
		other: "Engram Sincronização: transferidos {count} elementos",
	},
	'Engram Sync: sync state for "{name}" was unreadable — using the on-disk copy.':
		'Engram Sincronização: o estado de sincronização de "{name}" não foi legível — a cópia no disco está a ser utilizada.',
	"Engram Vault Sync {version} is available. {link}.":
		"Engram Vault Sync {version} está disponível. {link}.",
	"Could not compare with the cloud. Check your connection.":
		"Não foi possível comparar com a nuvem. Verifique a ligação.",
	"Your login expired. Sign in again in Engram settings to continue.":
		"A sua sessão expirou. Inicie sessão novamente nas Engram definições para continuar.",
	"Couldn't create vault — the name may be invalid or already in use.":
		"Não foi possível criar o cofre — o nome pode ser inválido ou já estar em uso.",
	"Could not create the vault — check your connection and try again.":
		"Não foi possível criar o cofre — verifique a ligação e tente novamente.",
	"Free syncs notes only — {count} attachments will be skipped.": {
		one: "Sincronização gratuita: as notas são sincronizadas, mas apenas {count} anexo será ignorado.",
		many: "Sincronização gratuita de notas apenas — {count} anexos serão ignorados.",
		other: "Sincroniza notas gratuitamente, apenas {count} anexos serão ignorados.",
	},
	"Uploads {up}, downloads {down}.": "Envio {up}, download {down}.",
	"Uploads {count}.": {
		one: "Uploads {count}.",
		many: "Uploads {count}.",
		other: "Transferências {count}.",
	},
	"Downloads {count}.": {
		one: "Descarregas {count}.",
		many: "Descargas {count}.",
		other: "Descarregas {count}.",
	},
	"{count} conflicts to resolve.": {
		one: "{count} conflito a resolver.",
		many: "{count} conflitos a resolver.",
		other: "{count} conflitos a resolver.",
	},
	"Safe choice: combines both sides, nothing is deleted.":
		"Escolha segura: combina ambos os lados, nada é apagado.",
	"Nothing is deleted.": "Nada é apagado.",
	"Already in sync. Nothing is deleted.": "Já está sincronizado. Nada é apagado.",
	"Delete all {count} files currently on the server": {
		one: "Eliminar todos os {count} ficheiros atualmente no servidor",
		many: "Eliminar todos os {count} ficheiros atualmente no servidor",
		other: "Eliminar os {count} ficheiros atualmente no servidor",
	},
	"Upload {count} files from this vault": {
		one: "Carregar {count} ficheiro deste cofre",
		many: "Carregar {count} ficheiros deste cofre",
		other: "Carregar {count} ficheiros deste cofre",
	},
	"Delete all {count} files in this vault": {
		one: "Eliminar todos os {count} ficheiros neste cofre",
		many: "Eliminar todos os {count} ficheiros neste cofre",
		other: "Eliminar os {count} ficheiros neste cofre",
	},
	"Download {count} files from the server": {
		one: "Descarregar {count} ficheiro do servidor",
		many: "Descarregar {count} ficheiros do servidor",
		other: "Descarregar {count} ficheiros do servidor",
	},
	Sync: "Sincronizar",
	"Upload local files without downloading the remote":
		"Envie ficheiros locais sem descarregar os remotos",
	"Delete all on remote, then upload local files":
		"Apague tudo no remoto e, em seguida, envie os ficheiros locais",
	"Download remote files without uploading the local":
		"Descarregue ficheiros remotos sem enviar os locais",
	"Delete all local files, then download from remote":
		"Apague todos os ficheiros locais e, em seguida, descarregue do remoto",
	"Set up sync for this vault": "Configure a sincronização para este cofre",
	"You are now pointing at a different cloud vault":
		"Está agora a apontar para um cofre na nuvem diferente",
	"Sync preview": "Pré-visualização da sincronização",
	"Nothing to sync yet — this vault is empty on both sides. Start syncing and everything you write appears on your other devices.":
		"Ainda não há nada para sincronizar — este cofre está vazio em ambos os lados. Inicie a sincronização e tudo o que escreve aparece nos seus outros dispositivos.",
	"Start syncing": "Iniciar a sincronização",
	"{count} notes": { one: "{count} notas", many: "{count} notas", other: "{count} notas" },
	"{count} attachments": {
		one: "{count} anexo",
		many: "{count} anexos",
		other: "{count} anexos",
	},
	"{first} and {second}": "{first} e {second}",
	files: "ficheiros",
	"This vault is empty on the server. Upload your {what}?":
		"Este cofre está vazio no servidor. Deseja enviar {what}?",
	"Upload everything": "Enviar tudo",
	"Nothing will be removed from this device.": "Nada será removido deste dispositivo.",
	"This device's vault is empty. Download {what} from the server?":
		"O cofre deste dispositivo está vazio. Deseja descarregar {what} do servidor?",
	"Download everything": "Descarregar tudo",
	"Send debug logs. Note content stays private.":
		"Enviar registos de depuração. O conteúdo das notas permanece privado.",
	"Comparing your vault with the cloud…": "A comparar o seu cofre com a nuvem…",
	"Not now": "Não agora",
	"Change vault": "Alterar cofre",
	"Advanced sync options": "Opções avançadas de sincronização",
	"Everything is in sync": "Tudo está sincronizado",
	"This vault": "Este cofre",
	"Cloud server": "Servidor na nuvem",
	notes: "notas",
	attachments: "anexos",
	folders: "pastas",
	"Confirm destructive sync": "Confirmar sincronização destrutiva",
	"You are about to:": "Está prestes a:",
	"Files that will be deleted:": "Ficheiros que serão eliminados:",
	"This cannot be undone.": "Esta ação não pode ser desfeita.",
	Back: "Voltar",
	Confirm: "Confirmar",
	"Switch vault": "Mudar de cofre",
	"Pick a vault to sync with. We will recalculate the sync preview after you choose.":
		"Escolha um cofre para sincronizar. Recalcularemos a pré-visualização da sincronização após a escolha.",
	"Loading vaults…": "A carregar cofres…",
	" (default)": " (padrão)",
	"No other vaults available.": "Nenhum outro cofre disponível.",
	"Make new vault": "Criar novo cofre",
	"New vault": "Novo cofre",
	"Create a new empty vault on the server, then sync this Obsidian vault into it.":
		"Crie um novo cofre vazio no servidor e, em seguida, sincronize este cofre Obsidian para ele.",
	"Vault name": "Nome do Cofre",
	Create: "Criar",
	"Could not load vaults: {error}": "Não foi possível carregar os cofres: {error}",
	"Enter a name for the new vault": "Introduza um nome para o novo cofre",
	"Failed to switch vault: {error}": "Falha ao mudar de cofre: {error}",
	"Your vault shares {percent} of its data with Engram":
		"O seu cofre partilha {percent} dos seus dados com Engram",
	"{count} conflicts need resolution": {
		one: "{count} conflito necessita de resolução",
		many: "{count} conflitos precisam de ser resolvidos",
		other: "{count} conflitos precisam de resolução",
	},
	"Type {keyword} to confirm:": "Introduza {keyword} para confirmar:",
	Keyword: "Palavra-chave",
	Semantic: "Semântica",
	Both: "Ambos",
	"matches your words and their other forms — 'run' finds 'running' — plus this device.":
		'corresponde às suas palavras e às suas outras formas — "correr" encontra "correndo" — e também a este dispositivo.',
	"matches meaning. Finds notes that never use the words you typed.":
		"corresponde ao significado. Encontra notas que nunca usam as palavras que digitou.",
	"matches words and meaning together, plus this device. Widest results.":
		"Combina palavras e significado, mais este dispositivo. Resultados mais abrangentes.",
	"Engram indexes {indexed} of your {all} notes. The rest match on this device only. Upgrade to index everything.":
		"Engram indexa {indexed} das suas {all} notas. O resto corresponde apenas neste dispositivo. Atualize para indexar tudo.",
	"Searching {indexed} of {all} notes. Upgrade to search everything.":
		"A pesquisar {indexed} de {all} notas. Atualize para pesquisar tudo.",
	"Search your vault…": "Pesquisar no seu cofre…",
	"Clear search": "Limpar pesquisa",
	"Search settings": "Definições de pesquisa",
	"Filter by folder…": "Filtrar por pasta…",
	"Filter by tags…": "Filtrar por etiquetas…",
	"Remove tag {tag}": "Remover etiqueta {tag}",
	"Engram unreachable. Showing matches from this device only.":
		"Engram inacessível. A mostrar resultados apenas deste dispositivo.",
	"Search failed — check connection": "A pesquisa falhou — verifique a ligação",
	"No results found": "Nenhum resultado encontrado",
	Untitled: "Sem título",
	exact: "exato",
	"meaning + exact": "significado + exato",
	meaning: "significado",
	"match strength: {pct}%": "força da correspondência: {pct}%",
	"No source path for this result": "Sem caminho de origem para este resultado",
	"Note not synced locally": "Nota não sincronizada localmente",
	"{count} files": {
		one: "{count} ficheiro",
		many: "{count} ficheiros",
		other: "{count} ficheiros",
	},
	"Notes searchable": "Notas pesquisáveis",
	"Notes past this still sync and open normally, they are just not in the search index. The index keeps your oldest notes, so it is your newest ones that fall outside.":
		"As notas após este ponto continuam a sincronizar e a abrir normalmente, apenas não estão no índice de pesquisa. O índice guarda as suas notas mais antigas, por isso são as mais recentes que ficam de fora.",
	"Notes stored": "Notas armazenadas",
	"AI searches": "Pesquisas de IA",
	"{formatted} per day": "{formatted} por dia",
	"Note couldn't be processed": "A nota não pôde ser processada",
	"The server couldn't process this note. Check its contents, then edit and save to try again.":
		"O servidor não conseguiu processar esta nota. Verifique o seu conteúdo, depois edite e guarde para tentar novamente.",
	"Attachments need a paid plan": "Os anexos requerem um plano pago",
	"The Free tier syncs notes only. Upgrade to sync images and PDFs.":
		"A versão gratuita sincroniza apenas notas. Atualize para sincronizar imagens e PDFs.",
	"Attachment storage full": "Armazenamento de anexos cheio",
	"You've used all the attachment storage on your plan. Upgrade for more.":
		"Utilizou todo o armazenamento de anexos do seu plano. Atualize para obter mais.",
	"Too large for the server": "Demasiado grande para o servidor",
	"The server limit is 5 MB. Compress or split the file, then it will sync.":
		"O limite do servidor é de 5 MB. Comprima ou divida o ficheiro, e então será sincronizado.",
	"Sign-in expired": "Sessão expirada",
	"Reconnect your account to resume syncing.": "Reconecte a conta para retomar a sincronização.",
	"Unresolved conflict": "Conflito não resolvido",
	"Open the file to resolve the conflict, then sync again.":
		"Abra o ficheiro para resolver o conflito e, em seguida, sincronize novamente.",
	"Frontmatter needs a fix": "O frontmatter precisa de correção",
	"The note synced, but its frontmatter could not be fully parsed. Open it to fix the highlighted line.":
		"A nota foi sincronizada, mas o seu frontmatter não pôde ser totalmente analisado. Abra-a para corrigir a linha destacada.",
	"Server error": "Erro no servidor",
	"A temporary server problem — retrying automatically.":
		"Um problema temporário no servidor — a tentar novamente automaticamente.",
	"Network unavailable": "Rede indisponível",
	"Can't reach the server — retrying automatically.":
		"Não é possível contactar o servidor — a tentar novamente automaticamente.",
	"Sync failed": "A sincronização falhou",
	"An unexpected error — retrying automatically.":
		"Um erro inesperado — a tentar novamente automaticamente.",
	"Frontmatter could not be parsed": "Não foi possível analisar o frontmatter",
	"Engram: this plugin is too old to sync (needs {version} or newer). Update it to continue.":
		"Engram: este plugin é demasiado antigo para sincronizar (requer {version} ou superior). Atualize-o para continuar.",
	"Engram: this plugin is too old to sync. Update it to continue.":
		"Engram: este plugin é demasiado antigo para sincronizar. Atualize-o para continuar.",
	Update: "Atualizar",
	"Invalid API key": "Chave API inválida",
	"Request failed ({status})": "Falha na requisição ({status})",
	"Syncing...": "A sincronizar...",
	"👋 Welcome": "👋 Bem-vindo",
	"🔌 Connection": "🔌 Conexão",
	"🔄 Sync Center": "🔄 Centro de sincronização",
	"⚙️ Advanced": "⚙️ Avançado",
	"💬 Feedback": "💬 Feedback",
	"Engram: settings tab failed to render ({error})":
		"Engram: a aba de definições não foi carregada ({error})",
	Disconnected: "Desconectado",
	"Error: {error}": "Erro: {error}",
	unknown: "desconhecido",
	"Connected — waiting for first sync decision":
		"Conectado — aguardando a primeira decisão de sincronização",
	"Connected — live sync active": "Conectado — sincronização ativa",
	"Connected — polling": "Conectado — a verificar",
	"Not configured": "Não configurado",
	"Open sync setup": "Abrir configuração de sincronização",
	"Sync log": "Registo de sincronização",
	"Showing {count} entries": {
		one: "A mostrar {count} entrada",
		many: "A mostrar {count} entradas",
		other: "A mostrar {count} entradas",
	},
	"No sync activity this session.": "Sem atividade de sincronização nesta sessão.",
	"({count} errors)": {
		one: "({count} erro)",
		many: "({count} erros)",
		other: "({count} erros)",
	},
	"...": "...",
	'... "{name}" ...': '... "{name}" ...',
	"The server took too long to respond. Try again.":
		"O servidor demorou demasiado tempo a responder. Tente novamente.",
	"Not signed in, or the session expired. Sign in again in Engram settings.":
		"Não está autenticado, ou a sessão expirou. Autentique-se novamente nas definições de Engram.",
	"The file is too large for the server.": "O ficheiro é demasiado grande para o servidor.",
	"Too many requests. Wait a moment and try again.":
		"Demasiadas solicitações. Aguarde um momento e tente novamente.",
	"Server error ({status}) — check Engram logs":
		"Erro do servidor ({status}) — verifique os registos Engram",
	"Could not reach Engram — check connection":
		"Não foi possível aceder a Engram — verifique a ligação",
	"Frontmatter isn't valid YAML.": "O frontmatter não é um YAML válido.",
	"A frontmatter key could not be parsed as YAML.":
		"Uma chave de frontmatter não pôde ser interpretada como YAML.",
	"This note could not be processed and was skipped.":
		"Esta nota não pôde ser processada e foi ignorada.",
	'Frontmatter key "{key}" could not be parsed as YAML.':
		'A chave de frontmatter "{key}" não pôde ser interpretada como YAML.',
	Bug: "Erro",
	Idea: "Ideia",
	Confusing: "Confuso",
	"Love it": "Adorei",
	"What's working, what's frustrating, what do you wish Engram did?":
		"O que está a funcionar, o que é frustrante, o que gostaria que o Engram fizesse?",
	"This server is self-hosted, so feedback is not collected here. ":
		"Este servidor é alojado localmente, portanto, não são recolhidos dados aqui. ",
	"Report an issue on GitHub": "Reporte um problema no GitHub",
	"Connect to Engram first to send feedback.":
		"Conecte-se a Engram primeiro para enviar feedback.",
	"Open Connection": "Abrir ligação",
	"What kind of feedback?": "Que tipo de feedback?",
	"Your feedback": "O seu feedback",
	"Tell us anything": "Diga-nos qualquer coisa",
	"How do you feel about Engram?": "O que pensa de Engram?",
	"{n} of 5": "{n} de 5",
	"Couldn't send your feedback, please try again.":
		"Não foi possível enviar o seu feedback, por favor tente novamente.",
	"It's OK to email me about this": "Pode enviar-me um e-mail sobre isto",
	"Sending…": "A enviar…",
	Send: "Enviar",
	"Thanks, we read every message.": "Obrigado, lemos todas as mensagens.",
	"New here? Watch the setup video": "Novo por aqui? Veja o vídeo de configuração",
	"What Engram does, and how to connect your vault, start to finish.":
		"O que o Engram faz e como conectar o seu cofre, do início ao fim.",
	"▶ Watch on YouTube": "▶ Ver no YouTube",
	"Getting set up": "A iniciar a configuração",
	"1. Make an account": "1. Crie uma conta",
	"setup guide": "guia de configuração",
	"2. Connect your vault to Engram": "2. Conecte o seu cofre ao Engram",
	"Sign in (or enter your server URL and key) on the connection tab, then run your first sync.":
		"Inicie sessão (ou introduza a URL do servidor e a chave) na aba de ligação e, em seguida, execute a primeira sincronização.",
	"Open connection tab": "Abrir a aba de ligação",
	"3. Connect your AI": "3. Conecte a sua IA",
	"Link Claude, Cursor, ChatGPT, or any MCP app so it can read and write your notes. ":
		"Ligar o Claude, o Cursor, o ChatGPT ou qualquer aplicação MCP para que ela possa ler e escrever as suas notas. ",
	"See the AI setup guide": "Consulte o guia de configuração da IA",
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
	"Join our Discord": "Junte-se ao nosso Discord",
	"Create a hosted account at {signup}, or self-host the backend ({guide}).":
		"Crie uma conta alojada em {signup}, ou alojar o backend ({guide}).",
	"Engram URL": "URL do Engram",
	"✓ Engram server reachable (v{version})": "✓ Servidor Engram acessível (v{version})",
	"✗ server responded but isn't an Engram backend":
		"✗ O servidor respondeu, mas não é um backend Engram",
	"✗ couldn't reach a server at this URL": "✗ Não foi possível contactar um servidor neste URL",
	"Checking server…": "A verificar o servidor…",
	"That does not look like a complete server address. Include the scheme, for example http://127.0.0.1:4000":
		"Isto não parece ser um endereço de servidor completo. Inclua o esquema, por exemplo http://127.0.0.1:4000",
	"Engram backend changed — sign in again to continue.":
		"Backend Engram alterado — inicie sessão novamente para continuar.",
	Authentication: "Autenticação",
	"Signed in as {email}": "Iniciado sessão como {email}",
	"Authenticated via Engram account (OAuth).": "Autenticado através da conta Engram (OAuth).",
	"Manage account": "Gerir conta",
	"Sign out": "Desconectar",
	"Using API key": "A utilizar chave API",
	"Authenticated via manual API key.": "Autenticado através de chave API manual.",
	"Clear key": "Limpar chave",
	"Switch to sign in": "Mudar para iniciar sessão",
	"Engram: sign-in failed ({error})": "Engram: falha ao iniciar sessão ({error})",
	"Sign in or create an account": "Iniciar sessão ou criar uma conta",
	"Opens your browser to sign in, or create an account if you don't have one yet, then links this vault.":
		"Abre o seu navegador para iniciar sessão, ou criar uma conta se ainda não tiver, e depois associa este cofre.",
	"Sign in": "Iniciar sessão",
	"Or authenticate with a token instead of signing in. Engram Cloud API keys require the Pro plan; on Free and Starter, sign in above.":
		"Ou autentique-se com um token em vez de iniciar sessão. As chaves API Engram requerem o plano Pro; nos planos Free e Starter, inicie sessão acima.",
	"Or authenticate with a token instead of signing in.":
		"Ou autentique-se com um token em vez de iniciar sessão.",
	"API key": "Chave API",
	Token: "Token",
	"Bearer token from your Engram account.": "Token de acesso da sua conta Engram.",
	Save: "Guardar",
	"Enter an API key first": "Introduza primeiro uma chave API",
	"That does not look like an Engram API key (expected {prefix}…).":
		"Isso não parece ser uma chave API do Engram (esperava {prefix}…).",
	Vault: "Cofre",
	"Vault selection": "Seleção do Cofre",
	"Select which vault this plugin syncs with.":
		"Selecione o cofre com o qual este plugin sincroniza.",
	"No vaults found — first sync will create one":
		"Nenhum cofre encontrado — a primeira sincronização irá criar um",
	"Pick a vault (previous: '{name}' not found)":
		"Escolha um cofre (anterior: '{name}' não encontrado)",
	"Pick a vault (previous: id {id} not found)":
		"Escolha um cofre (anterior: ID {id} não encontrado)",
	"Pick a vault": "Escolha um cofre",
	"Vault ID: {id}": "ID do Cofre: {id}",
	Change: "Alterar",
	"Support development": "Apoiar o desenvolvimento",
	"If this plugin saves you time, consider supporting development.":
		"Se este plugin lhe poupa tempo, considere apoiar o desenvolvimento.",
	"GitHub Sponsors": "GitHub Patrocinadores",
	"Sign-in required to load vaults": "É necessário iniciar sessão para carregar os cofres",
	"Engram Cloud": "Engram Nuvem",
	"Self-hosted": "Servidor próprio",
	Backend: "Backend",
	"Where this vault syncs to. Each backend keeps its own sign-in.":
		"Para onde este cofre é sincronizado. Cada backend tem a sua própria autenticação.",
	"Switched to {mode}.": "Alterado para {mode}.",
	"Not connected. Enter your Engram server URL below to start syncing.":
		"Não está conectado. Insira a URL do servidor Engram abaixo para iniciar a sincronização.",
	"Run your own Engram server": "Execute o seu próprio servidor Engram",
	"Engram is the backend that powers sync and semantic search.":
		"Engram é o sistema que permite a sincronização e a pesquisa semântica.",
	"Nothing in this vault syncs until you choose how to merge it with the server.":
		"Nada neste cofre é sincronizado até que escolha como o combinar com o servidor.",
	"Choose sync direction": "Escolha a direção da sincronização",
	"Node.js dependencies": "Dependências Node.js",
	"Python virtual environment": "Ambiente virtual Python",
	"Python bytecode cache": "Cache de bytecode Python",
	"Vendored dependencies": "Dependências incluídas",
	"Gradle build cache": "Cache de construção Gradle",
	"Rust/Java build output": "Saída da construção Rust/Java",
	"Build output": "Resultado da compilação",
	"Next.js build output": "Resultado da compilação Next.js",
	"Distribution build output": "Resultado da compilação para distribuição",
	"Cargo cache": "Cache do Cargo",
	"CocoaPods dependencies": "Dependências do CocoaPods",
	"Dart tool cache": "Cache das ferramentas Dart",
	"Generic cache directory": "Diretório de cache genérico",
	"Ignore patterns": "Ignorar padrões",
	"Custom patterns": "Padrões personalizados",
	"Paths to skip (one per line). Folder patterns end with /. Built-in: {configDir}/, .trash/, .git/":
		"Caminhos a ignorar (um por linha). Os padrões de pastas terminam com /. Incorporados: {configDir}/, .trash/, .git/",
	Diagnostics: "Diagnósticos",
	"Send detailed sync, vault, and connection activity to the server for troubleshooting, with distributed tracing on requests. Metadata only, never note content. Leave off for normal use.":
		"Envie informações detalhadas sobre a sincronização, o cofre e a atividade da ligação para o servidor para resolução de problemas, com rastreamento distribuído nas requisições. Apenas metadados, nunca o conteúdo das notas. Desative para utilização normal.",
	"Diagnostics detail": "Detalhes dos diagnósticos",
	"Minimum severity that ships while diagnostics are on. Higher levels send fewer lines. Default: Info.":
		"Nível de gravidade mínimo quando os diagnósticos estão ativos. Níveis mais altos enviam menos linhas. Valor padrão: Info.",
	"Errors only": "Erros apenas",
	"Warnings and errors": "Avisos e erros",
	"Info (default)": "Info (padrão)",
	"Debug (verbose)": "Debug (detalhado)",
	About: "Sobre",
	"License: {name}": "Licença: {name}",
	"⚠ Detected: {label}/ ({formatted} files)": "⚠ Detetado: {label} / ({formatted} ficheiros)",
	"{desc} — should not be synced": "{desc} — não deve ser sincronizado",
	"Add to ignores": "Adicionar aos padrões a ignorar",
	"Added {pattern} to ignore patterns": "Adicionado {pattern} aos padrões a ignorar",
	"Version: {version}": "Versão: {version}",
	"Source: {link}": "Origem: {link}",
};

export default pt;
