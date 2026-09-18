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
};

export default es;
