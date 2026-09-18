import type { Dict } from "..";

// Español
const es: Dict = {
	"Code copied!": "Código copiado.",
	"Engram sync: syncing...": "Engram Sync: sincronizando…",
	"Engram Sync: pulled {pulled}, pushed {pushed}":
		"Engram Sync: {pulled} descargados, {pushed} subidos",
	"Engram: disconnected. Open Engram settings to reconnect.":
		"Engram: sin conexión. Abre Engram settings para volver a conectar.",
	"Engram sync: checking...": "Engram Sync: comprobando…",
	"Engram sync: everything in sync": "Engram Sync: todo sincronizado",
	"Engram sync: pulling all from server...": "Engram Sync: descargando todo del servidor…",
	"Engram Sync: pushed {pushed}": "Engram Sync: {pushed} subidos",
	"Engram sync: sync failed": "Engram Sync: la sincronización falló",
	"Engram: your login expired — open Engram settings to reconnect.":
		"Engram: tu sesión caducó. Abre Engram settings para volver a conectar.",
	"Engram: This vault has been deleted on the server.":
		"Engram: esta bóveda se ha eliminado en el servidor.",
	"Engram Sync: pulled {pulled} (local extras deleted)":
		"Engram Sync: {pulled} descargados (archivos locales sobrantes eliminados)",
	"Engram Sync: pulled {pulled}": "Engram Sync: {pulled} descargados",
	"Engram Sync: replaced remote with local ({pushed} uploaded)":
		"Engram Sync: el servidor se reemplazó por la versión local ({pushed} subidos)",
	"Engram: sync failed. Open the sync log for details.":
		"Engram: la sincronización falló. Los detalles están en el registro de sincronización.",
	"Engram unreachable. Showing matches from this device only.":
		"No se puede conectar con Engram. Solo se muestran coincidencias de este dispositivo.",
	"No source path for this result": "Este resultado no tiene ruta de origen",
	"Note not synced locally": "Esta nota aún no está sincronizada en este dispositivo",
	"Engram: settings tab failed to render ({error})":
		"Engram: no se pudo mostrar la pestaña de ajustes ({error})",
	"File not found locally: {path}": "Archivo no encontrado en local: {path}",
	"Restored {path} — will sync on next push.":
		"{path} restaurado, se sincronizará en el próximo envío.",
	"Ignored {path} — won't sync until restored from Sync Center.":
		"{path} ignorado, no se sincronizará hasta que lo restaures desde el Sync Center.",
	"Added {pattern} to ignore patterns": "{pattern} añadido a los patrones ignorados",
	"Engram backend changed — sign in again to continue.":
		"El servidor de Engram ha cambiado. Vuelve a iniciar sesión para continuar.",
	"Engram: sign-in failed ({error})": "Engram: no se pudo iniciar sesión ({error})",
	"Enter an API key first": "Introduce primero una clave de API",
	"Switched to {mode}.": "Se cambió a {mode}.",

	"Engram Sync: pushed {count} files": {
		one: "Engram Sync: {count} archivo subido",
		other: "Engram Sync: {count} archivos subidos",
	},
	"Engram Sync: pulled {count} files from server": {
		one: "Engram Sync: {count} archivo descargado del servidor",
		other: "Engram Sync: {count} archivos descargados del servidor",
	},
	"Engram Sync: pulled {count} changes": {
		one: "Engram Sync: {count} cambio descargado",
		other: "Engram Sync: {count} cambios descargados",
	},
	"Engram: {count} files failed to sync{detail} — open Sync Center": {
		one: "Engram: {count} archivo no se pudo sincronizar{detail}. Abre el Sync Center",
		other: "Engram: {count} archivos no se pudieron sincronizar{detail}. Abre el Sync Center",
	},
	"Engram: {count} attachments skipped — upgrade to sync images & PDFs.": {
		one: "Engram: {count} adjunto omitido. Mejora tu plan para sincronizar imágenes y PDF.",
		other: "Engram: {count} adjuntos omitidos. Mejora tu plan para sincronizar imágenes y PDF.",
	},
	"Engram: plan upgraded — syncing {count} attachments…": {
		one: "Engram: plan mejorado, sincronizando {count} adjunto…",
		other: "Engram: plan mejorado, sincronizando {count} adjuntos…",
	},
	// 402 limit reasons (limit-copy.ts). These gate payment, so they are the
	// highest-value strings in the plugin to get right.
	"Note limit reached. Upgrade to keep adding notes.":
		"Has alcanzado el límite de notas. Mejora tu plan para seguir añadiendo.",
	"Vault limit reached. Upgrade for more vaults.":
		"Has alcanzado el límite de bóvedas. Mejora tu plan para tener más.",
	"This file type isn't accepted by this server.": "Este servidor no acepta ese tipo de archivo.",
	"Attachment sync is disabled for this account.":
		"Esta cuenta tiene desactivada la sincronización de adjuntos.",
	"Attachment storage is full — upgrade for more.":
		"El almacenamiento de adjuntos está lleno. Mejora tu plan para tener más.",
	"File too large for your plan.": "El archivo es demasiado grande para tu plan.",
	"Already signed in on another device. Upgrade for multi-device.":
		"Ya has iniciado sesión en otro dispositivo. Mejora tu plan para usar varios.",
	"Device swap cooldown active. Wait or upgrade.":
		"El cambio de dispositivo está en espera. Aguarda un momento o mejora tu plan.",
	"Too many connected Obsidian vaults. Disconnect one or upgrade.":
		"Hay demasiadas bóvedas de Obsidian conectadas. Desconecta una o mejora tu plan.",
	"Too many connected AI clients. Disconnect one or upgrade.":
		"Hay demasiados clientes de IA conectados. Desconecta uno o mejora tu plan.",
	"Daily AI search limit reached. Free includes 20 per day across Obsidian, the web app and MCP. Upgrade for unlimited.":
		"Has alcanzado el límite diario de búsquedas con IA. El plan gratuito incluye 20 al día entre Obsidian, la web y MCP. Mejora tu plan para no tener límite.",
	"API keys need Pro. Sign in with your Engram account instead.":
		"Las claves de API requieren el plan Pro. Inicia sesión con tu cuenta de Engram en su lugar.",
	"Account suspended. Contact support.": "Cuenta suspendida. Escribe al soporte.",
	"Account setup incomplete.": "La configuración de la cuenta está incompleta.",
	"This account was deleted. Contact support if that is wrong.":
		"Esta cuenta se ha eliminado. Si es un error, escribe al soporte.",
	"Finish setting up your account at app.engram.page to start syncing.":
		"Termina de configurar tu cuenta en app.engram.page para empezar a sincronizar.",
	"Limit reached. Upgrade to continue.":
		"Has alcanzado el límite. Mejora tu plan para continuar.",
};

export default es;
