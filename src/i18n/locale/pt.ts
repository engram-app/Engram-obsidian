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
};

export default pt;
