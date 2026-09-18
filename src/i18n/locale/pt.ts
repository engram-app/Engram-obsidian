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
};

export default pt;
