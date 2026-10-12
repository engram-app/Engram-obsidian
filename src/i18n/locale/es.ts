import type { Dict } from "..";

// Español
const es: Dict = {
	"Invalid API key": "Clave API inválida",
	"Connection failed": "Conexión fallida",
	"Link Obsidian to Engram": "Conecta Obsidian a Engram",
	"Failed to start device flow. Check your Engram URL and try again.":
		"No se pudo iniciar el proceso de autenticación. Verifica tu URL de Engram e inténtalo de nuevo.",
	"Your code:": "Tu código:",
	"Click to copy": "Haz clic para copiar",
	"Code copied!": "¡Código copiado!",
	"A browser window has opened. Sign in and enter this code to link your vault.":
		"Se ha abierto una ventana del navegador. Inicia sesión e introduce este código para conectar tu bóveda.",
	Cancel: "Cancelar",
	"Waiting for authorization — connected, this will complete instantly.":
		"Esperando autorización — conectado, esto se completará al instante.",
	"Waiting for authorization — no live connection, checking every 30s.":
		"Esperando autorización — sin conexión activa, verificando cada 30 segundos.",
	"Code expired. Please try again.": "Código expirado. Por favor, inténtalo de nuevo.",
	"Try again": "Intentar de nuevo",
	Close: "Cerrar",
	"Note couldn't be processed": "No se pudo procesar la nota",
	"The server couldn't process this note. Check its contents, then edit and save to try again.":
		"El servidor no pudo procesar esta nota. Revisa su contenido, luego edita y guarda para intentarlo de nuevo.",
	"Attachments need a paid plan": "Los adjuntos requieren un plan de pago",
	"The Free tier syncs notes only. Upgrade to sync images and PDFs.":
		"El plan gratuito sincroniza solo notas. Actualiza para sincronizar imágenes y PDFs.",
	"Attachment storage full": "Almacenamiento de adjuntos lleno",
	"You've used all the attachment storage on your plan. Upgrade for more.":
		"Has utilizado todo el almacenamiento de adjuntos de tu plan. Actualiza para obtener más.",
	"Too large for the server": "Demasiado grande para el servidor",
	"The server limit is 5 MB. Compress or split the file, then it will sync.":
		"El límite del servidor es de 5 MB. Comprime o divide el archivo, luego se sincronizará.",
	"Sign-in expired": "Sesión expirada",
	"Reconnect your account to resume syncing.":
		"Vuelve a conectar tu cuenta para reanudar la sincronización.",
	"Unresolved conflict": "Conflicto sin resolver",
	"Open the file to resolve the conflict, then sync again.":
		"Abre el archivo para resolver el conflicto, luego sincroniza de nuevo.",
	"Frontmatter needs a fix": "El frontmatter necesita una corrección",
	"The note synced, but its frontmatter could not be fully parsed. Open it to fix the highlighted line.":
		"La nota se sincronizó, pero no se pudo analizar completamente su frontmatter. Ábrela para corregir la línea resaltada.",
	"Server error": "Error del servidor",
	"A temporary server problem — retrying automatically.":
		"Un problema temporal del servidor, se está reintentando automáticamente.",
	"Network unavailable": "Red no disponible",
	"Can't reach the server — retrying automatically.":
		"No se puede acceder al servidor, se está reintentando automáticamente.",
	"Sync failed": "Sincronización fallida",
	"An unexpected error — retrying automatically.":
		"Un error inesperado, se está reintentando automáticamente.",
	"Frontmatter could not be parsed": "No se pudo analizar el frontmatter",
	"Note limit reached. Upgrade to keep adding notes.":
		"Se ha alcanzado el límite de notas. Actualiza para seguir añadiendo notas.",
	"Vault limit reached. Upgrade for more vaults.":
		"Se ha alcanzado el límite de bóvedas. Actualiza para tener más bóvedas.",
	"This file type isn't accepted by this server.":
		"Este tipo de archivo no es aceptado por este servidor.",
	"Attachment sync is disabled for this account.":
		"La sincronización de adjuntos está desactivada para esta cuenta.",
	"Attachment storage is full — upgrade for more.":
		"El almacenamiento de adjuntos está lleno. Actualiza para obtener más espacio.",
	"File too large for your plan.": "El archivo es demasiado grande para tu plan.",
	"Already signed in on another device. Upgrade for multi-device.":
		"Ya iniciaste sesión en otro dispositivo. Actualiza para usar varios dispositivos.",
	"Device swap cooldown active. Wait or upgrade.":
		"Periodo de espera para cambio de dispositivo activo. Espera o actualiza.",
	"Too many connected Obsidian vaults. Disconnect one or upgrade.":
		"Demasiadas bóvedas de Obsidian conectadas. Desconecta una o actualiza.",
	"Too many connected AI clients. Disconnect one or upgrade.":
		"Demasiados clientes de IA conectados. Desconecta uno o actualiza.",
	"Daily AI search limit reached. Free includes 20 per day across Obsidian, the web app and MCP. Upgrade for unlimited.":
		"Límite diario de búsquedas de IA alcanzado. La versión gratuita incluye 20 búsquedas por día en Obsidian, la aplicación web y MCP. Actualiza para tener búsquedas ilimitadas.",
	"API keys need Pro. Sign in with your Engram account instead.":
		"Las claves de API requieren la versión Pro. Inicia sesión con tu cuenta de Engram.",
	"Account suspended. Contact support.": "Cuenta suspendida. Contacta con soporte.",
	"Account setup incomplete.": "Configuración de la cuenta incompleta.",
	"This account was deleted. Contact support if that is wrong.":
		"Esta cuenta fue eliminada. Contacta con soporte si es incorrecto.",
	"Finish setting up your account at app.engram.page to start syncing.":
		"Finaliza la configuración de tu cuenta en app.engram.page para empezar a sincronizar.",
	"Limit reached. Upgrade to continue.": "Límite alcanzado. Actualiza para continuar.",
	Upgrade: "Actualizar",
	"Update in settings": "Actualizar en la configuración",
	"Sync now": "Sincronizar ahora",
	"Engram sync: syncing...": "Sincronización de Engram: sincronizando...",
	"Engram Sync: pulled {pulled}, pushed {pushed}":
		"Engram: descargados {pulled}, enviados {pushed}",
	"Disconnect (clear login)": "Desconectar (borrar inicio de sesión)",
	"Engram: disconnected. Open Engram settings to reconnect.":
		"Engram: desconectado. Abre la configuración de Engram para volver a conectar.",
	"Push entire vault": "Enviar toda la bóveda",
	"Engram Sync: pushed {count} files": {
		one: "Engram Sync: se enviaron {count} archivo",
		many: "Engram Sync: se enviaron {count} archivos",
		other: "Engram Sync: se enviaron {count} archivos",
	},
	"Check sync status": "Comprobar el estado de la sincronización",
	"Engram sync: checking...": "Sincronización de Engram: comprobando...",
	"Engram sync: server does not support reconciliation (update backend)":
		"Sincronización de Engram: el servidor no admite la reconciliación (actualizar el backend)",
	"Engram sync: everything in sync": "Sincronización de Engram: todo está sincronizado",
	"{count} missing on server": "{count} no encontrado en el servidor",
	"{count} diverged": "{count} divergente",
	"{count} only on server": "{count} solo en el servidor",
	"Engram Sync: {details}": "Sincronización de Engram: {details}",
	"Pull all from server (force overwrite)": "Descargar todo desde el servidor (sobrescribir)",
	"Engram sync: pulling all from server...":
		"Sincronización de Engram: descargando todo desde el servidor...",
	"Engram Sync: pulled {count} files from server": {
		one: "Engram Sync: se descargó {count} archivo del servidor",
		many: "Engram Sync: se descargaron {count} archivos del servidor",
		other: "Engram Sync: se descargaron {count} archivos del servidor",
	},
	"Show sync log": "Mostrar registro de sincronización",
	"Semantic search": "Búsqueda semántica",
	"Open search sidebar": "Abrir la barra lateral de búsqueda",
	"Engram search": "Búsqueda en Engram",
	"Open sync center": "Abrir el Centro de sincronización",
	"Engram: ready": "Engram: listo",
	"Engram Sync: pushed {pushed}": "Engram Sync: enviados {pushed}",
	"Engram sync: sync failed": "Engram: la sincronización falló",
	"Engram: this vault no longer exists on the server. Pick or create a vault to continue.":
		"Engram: esta bóveda ya no existe en el servidor. Elige o crea una bóveda para continuar.",
	"Engram: recovered plugin settings from a backup after a corrupted save.":
		"Engram: se restauraron la configuración del plugin desde una copia de seguridad después de un guardado corrupto.",
	"Engram: plugin settings file was corrupted and could not be recovered. You may need to reconnect in settings.":
		"Engram: el archivo de configuración del plugin está dañado y no se pudo recuperar. Es posible que debas volver a conectar en la configuración.",
	"Engram: your login expired — open Engram settings to reconnect.":
		"Engram: tu sesión ha expirado — abre la configuración de Engram para volver a conectar.",
	"Engram: This vault has been deleted on the server.":
		"Engram: esta bóveda ha sido eliminada en el servidor.",
	"Engram sync: live sync requires a plugin update — please update the Engram vault sync plugin.":
		"Engram: la sincronización en tiempo real requiere una actualización del plugin — actualiza el plugin de sincronización de la bóveda de Engram.",
	"Engram Sync: pulled {pulled} (local extras deleted)":
		"Engram Sync: descargados {pulled} (se eliminaron extras locales)",
	"Engram Sync: pulled {pulled}": "Engram Sync: descargados {pulled}",
	"Engram Sync: replaced remote with local ({pushed} uploaded)":
		"Engram Sync: reemplazado el remoto con el local ({pushed} subidos)",
	"Engram: sync is not set up yet, so nothing in this vault will sync.":
		"Engram: la sincronización no está configurada todavía, así que nada en esta bóveda se sincronizará.",
	"Finish sync setup": "Finalizar la configuración de sincronización",
	"Engram: sync is paused. This edit was not synced. Choose a sync direction to resume.":
		"Engram: la sincronización está pausada. Esta edición no se sincronizó. Elige una dirección de sincronización para reanudar.",
	"Open Engram settings": "Abrir la configuración de Engram",
	"Engram: sync failed. Open the sync log for details.":
		"Engram: la sincronización falló. Abre el registro de sincronización para más detalles.",
	"Engram: not connected": "Engram: no conectado",
	"Engram: signed out": "Engram: desconectado",
	"Not connected yet. Click to open settings and link this vault.":
		"Aún no está conectado. Haz clic para abrir la configuración y vincular esta bóveda.",
	"Not signed in. Click to open settings and reconnect.":
		"No has iniciado sesión. Haz clic para abrir la configuración y volver a conectar.",
	"Engram: finish setup": "Engram: finalizar la configuración",
	"Engram: sync paused": "Engram: sincronización pausada",
	"{label} ({count} queued)": "{label} ({count} en cola)",
	"Setup is not finished — nothing will sync until you choose a sync direction. Click to finish.":
		"La configuración no está finalizada; nada se sincronizará hasta que elijas una dirección de sincronización. Haz clic para finalizar.",
	"Sync paused — click to choose a sync direction":
		"Sincronización pausada — haz clic para elegir la dirección de la sincronización",
	"Engram: offline ({count} queued)": "Engram: sin conexión ({count} en cola)",
	"Engram: offline": "Engram: sin conexión",
	"Server unreachable — changes will sync when connected":
		"Servidor inaccesible — los cambios se sincronizarán al conectarse",
	"Engram: error": "Engram: error",
	"Unknown error": "Error desconocido",
	"Engram: syncing ({count})": "Engram: sincronizando ({count})",
	"Engram: syncing": "Engram: sincronizando",
	"Sync in progress...": "Sincronización en curso...",
	"Engram: pending ({count})": "Engram: pendiente ({count})",
	"{count} files queued": {
		one: "{count} archivo en cola",
		many: "{count} archivos en cola",
		other: "{count} archivos en cola",
	},
	"Engram: live": "Engram: en línea",
	"WebSocket connected — live sync active": "WebSocket conectado — sincronización en vivo activa",
	"Click to sync": "Haz clic para sincronizar",
	"Engram: ⚠ {count} sync errors": {
		one: "Engram: ⚠ {count} error de sincronización",
		many: "Engram: ⚠ {count} errores de sincronización",
		other: "Engram: ⚠ {count} errores de sincronización",
	},
	"Last sync: {when}": "Última sincronización: {when}",
	"Engram Sync: pulled {count} changes": {
		one: "Engram Sync: se aplicó {count} cambio",
		many: "Engram Sync: se aplicaron {count} cambios",
		other: "Engram Sync: se aplicaron {count} cambios",
	},
	'Engram Sync: sync state for "{name}" was unreadable — using the on-disk copy.':
		'Engram Sync: el estado de sincronización de "{name}" no se pudo leer; se está utilizando la copia en el disco.',
	"Engram Vault Sync {version} is available. {link}.":
		"Engram Vault Sync {version} está disponible. {link}.",
	"{formatted} files · ": {
		one: "{formatted} archivo ·",
		many: "{formatted} archivos ·",
		other: "{formatted} archivos ·",
	},
	"Notes searchable": "Notas indexadas para búsqueda",
	"Notes past this still sync and open normally, they are just not in the search index. The index keeps your oldest notes, so it is your newest ones that fall outside.":
		"Las notas posteriores a esta fecha se sincronizan y se abren normalmente, pero no están en el índice de búsqueda. El índice guarda tus notas más antiguas, por lo que las más recientes quedan fuera.",
	"Notes stored": "Notas almacenadas",
	Attachments: "Adjuntos",
	"AI searches": "Búsquedas con IA",
	"{formatted} per day": "{formatted} por día",
	Keyword: "Palabra clave",
	Semantic: "Semántica",
	Both: "Ambos",
	"matches your words and their other forms — 'run' finds 'running' — plus this device.":
		"coincide con tus palabras y sus otras formas — 'run' encuentra 'running' — además de este dispositivo.",
	"matches meaning. Finds notes that never use the words you typed.":
		"coincide con el significado. Encuentra notas que nunca usan las palabras que escribiste.",
	"matches words and meaning together, plus this device. Widest results.":
		"coincide con las palabras y el significado, además de este dispositivo. Resultados más amplios.",
	"Engram indexes {indexed} of your {all} notes. The rest match on this device only. Upgrade to index everything.":
		"Engram indexa {indexed} de tus {all} notas. El resto solo coinciden en este dispositivo. Actualiza para indexar todo.",
	"Searching {indexed} of {all} notes. Upgrade to search everything.":
		"Buscando {indexed} de {all} notas. Actualiza para buscar todo.",
	"Search your vault…": "Busca en tu bóveda…",
	"Clear search": "Borrar búsqueda",
	"Search settings": "Configuración de búsqueda",
	"Filter by folder…": "Filtrar por carpeta…",
	"Filter by tags…": "Filtrar por etiquetas…",
	"Remove tag {tag}": "Eliminar etiqueta {tag}",
	"Engram unreachable. Showing matches from this device only.":
		"Engram no está disponible. Mostrando coincidencias solo de este dispositivo.",
	"Search failed — check connection": "Búsqueda fallida — verifica la conexión",
	"No results found": "No se encontraron resultados",
	Untitled: "Sin título",
	"meaning + exact": "significado + exacto",
	"match strength: {pct}%": "nivel de coincidencia: {pct}%",
	"No source path for this result": "No hay ruta de origen para este resultado",
	"Note not synced locally": "Nota no sincronizada localmente",
	"Syncing...": "Sincronizando...",
	"👋 Welcome": "👋 Bienvenido/a",
	"🔌 Connection": "🔌 Conexión",
	"🔄 Sync Center": "🔄 Centro de sincronización",
	"⚙️ Advanced": "⚙️ Avanzado",
	"Engram: settings tab failed to render ({error})":
		"Engram: la pestaña de configuración no se pudo mostrar ({error})",
	Disconnected: "Desconectado",
	"Error: {error}": "Error: {error}",
	unknown: "desconocido",
	"Connected — waiting for first sync decision":
		"Conectado — esperando la primera decisión de sincronización",
	"Connected — live sync active": "Conectado — sincronización activa",
	"Connected — polling": "Conectado — verificando",
	"Not configured": "No configurado",
	"Open sync setup": "Abrir configuración de sincronización",
	"waiting for a connection": "esperando conexión",
	"sync is paused": "la sincronización está pausada",
	"syncing now": "sincronizando ahora",
	"waiting to retry": "esperando reintentar",
	"{count} not on your plan": "{count} no está en tu plan",
	"{count} need attention": {
		one: "{count} necesita atención",
		many: "{count} necesita atención",
		other: "{count} requieren atención",
	},
	"{count} retrying": "{count} reintentando",
	"{count} ignored": "{count} ignorado",
	"{count} queued — {reason}": "{count} en cola — {reason}",
	"Sync...": "Sincronizando...",
	"sync failed": "Sincronización fallida",
	Refresh: "Actualizar",
	"Not synced on your plan ({count})": "No se sincroniza en tu plan ({count})",
	"These files are fine. They just need a paid plan to sync.":
		"Estos archivos están bien. Solo necesitan un plan de pago para sincronizarse.",
	"Show files ({count}) ▾": "Mostrar archivos ({count}) ▾",
	"Sync these now": "Sincronizar ahora",
	"Needs attention ({count})": "Requiere atención ({count})",
	"Clear all": "Borrar todo",
	"Nothing needs your attention. 🎉": "No hay nada que requiera tu atención. 🎉",
	Dismiss: "Descartar",
	"Retrying automatically ({count})": "Reintentando automáticamente ({count})",
	"Retry all now": "Reintentar todo ahora",
	"Temporary errors. These clear themselves once the server recovers.":
		"Errores temporales. Se resolverán automáticamente cuando el servidor se recupere.",
	"{count} attempts": {
		one: "{count} intento",
		many: "{count} intentos",
		other: "{count} intentos",
	},
	Open: "Abrir",
	Ignore: "Ignorar",
	"No files ignored. Use the ignore button on a failure row to stop syncing it.":
		"No hay archivos ignorados. Usa el botón de ignorar en una fila de error para detener su sincronización.",
	Restore: "Restaurar",
	"File not found locally: {path}": "Archivo no encontrado localmente: {path}",
	"Ignored {path} — won't sync until restored from Sync Center.":
		"Ignorado {path} — no se sincronizará hasta que se restaure desde el Centro de sincronización.",
	"Restored {path} — will sync on next push.":
		"Restaurado {path} — se sincronizará en el próximo envío.",
	Clear: "Borrar",
	"No activity yet. Push or pull to see entries here.":
		"Aún no hay actividad. Envía o recibe para ver las entradas aquí.",
	Stats: "Estadísticas",
	"Notes on this device": "Notas en este dispositivo",
	"Attachments on this device": "Adjuntos en este dispositivo",
	"Remote vault": "Bóveda remota",
	"not linked": "no enlazada",
	"Plan usage": "Uso del plan",
	"Sync log": "Registro de sincronización",
	"Showing {count} entries": {
		one: "Mostrando {count} entrada",
		many: "Mostrando {count} entradas",
		other: "Mostrando {count} entradas",
	},
	"No sync activity this session.": "No hay actividad de sincronización en esta sesión.",
	"({count} errors)": {
		one: "({count} error)",
		many: "({count} errores)",
		other: "({count} errores)",
	},
	"Could not compare with the cloud. Check your connection.":
		"No se pudo comparar con la nube. Verifica tu conexión.",
	"Your login expired. Sign in again in Engram settings to continue.":
		"Tu sesión ha expirado. Inicia sesión de nuevo en la configuración de Engram para continuar.",
	"Couldn't create vault — the name may be invalid or already in use.":
		"No se pudo crear la bóveda. El nombre podría ser inválido o ya estar en uso.",
	"Could not create the vault — check your connection and try again.":
		"No se pudo crear la bóveda. Verifica tu conexión e inténtalo de nuevo.",
	"Free syncs notes only — {count} attachments will be skipped.": {
		one: "Sincroniza notas gratis, solo se omitirá {count} adjunto.",
		many: "Sincroniza notas gratis, solo se sincronizarán {count} adjuntos.",
		other: "Sincroniza notas gratis, solo se omitirán {count} adjuntos.",
	},
	"Uploads {up}, downloads {down}.": "Subidas {up}, descargas {down}.",
	"Uploads {count}.": "Subidas {count}.",
	"Downloads {count}.": "Descargas {count}.",
	"{count} conflicts to resolve.": {
		one: "{count} conflicto a resolver.",
		many: "{count} conflictos a resolver.",
		other: "{count} conflictos a resolver.",
	},
	"Safe choice: combines both sides, nothing is deleted.":
		"Opción segura: combina ambos lados, nada se elimina.",
	"Nothing is deleted.": "Nada se elimina.",
	"Already in sync. Nothing is deleted.": "Ya está sincronizado. Nada se elimina.",
	"Delete all {count} files currently on the server": {
		one: "Eliminar todos los {count} archivos que están actualmente en el servidor",
		many: "Eliminar todos los archivos {count} que están actualmente en el servidor",
		other: "Eliminar los {count} archivos que están actualmente en el servidor",
	},
	"Upload {count} files from this vault": {
		one: "Subir {count} archivo de esta bóveda",
		many: "Cargar {count} archivos de esta bóveda",
		other: "Cargar {count} archivos de esta bóveda",
	},
	"Delete all {count} files in this vault": {
		one: "Eliminar todos los {count} archivo en esta bóveda",
		many: "Eliminar todos los archivos {count} en esta bóveda",
		other: "Eliminar los {count} archivos de esta bóveda",
	},
	"Download {count} files from the server": {
		one: "Descargar {count} archivo del servidor",
		many: "Descargar {count} archivos del servidor",
		other: "Descarga {count} archivos del servidor",
	},
	Sync: "Sincronizar",
	"Upload local files without downloading the remote":
		"Sube archivos locales sin descargar los remotos",
	"Delete all on remote, then upload local files":
		"Elimina todo en el servidor, luego sube los archivos locales",
	"Download remote files without uploading the local":
		"Descarga archivos remotos sin subir los locales",
	"Delete all local files, then download from remote":
		"Borra todos los archivos locales y luego descárgalos desde el servidor",
	"Set up sync for this vault": "Configura la sincronización para esta bóveda",
	"You are now pointing at a different cloud vault":
		"Ahora estás apuntando a una bóveda en la nube diferente",
	"Sync preview": "Vista previa de la sincronización",
	"Nothing to sync yet — this vault is empty on both sides. Start syncing and everything you write appears on your other devices.":
		"Aún no hay nada que sincronizar: esta bóveda está vacía en ambos lados. Empieza a sincronizar y todo lo que escribas aparecerá en tus otros dispositivos.",
	"Start syncing": "Empezar la sincronización",
	"{count} notes": { one: "{count} nota", many: "{count} notas", other: "{count} notas" },
	"{count} attachments": {
		one: "{count} adjunto",
		many: "{count} adjuntos",
		other: "{count} adjuntos",
	},
	"{first} and {second}": "{first} y {second}",
	files: "archivos",
	"This vault is empty on the server. Upload your {what}?":
		"Esta bóveda está vacía en el servidor. ¿Quieres subir tus {what}?",
	"Upload everything": "Subir todo",
	"Nothing will be removed from this device.": "Nada se eliminará de este dispositivo.",
	"This device's vault is empty. Download {what} from the server?":
		"La bóveda de este dispositivo está vacía. ¿Descargar {what} del servidor?",
	"Download everything": "Descargar todo",
	Done: "Hecho",
	"Send debug logs. Note content stays private.":
		"Enviar registros de depuración. El contenido de las notas se mantiene privado.",
	"Comparing your vault with the cloud…": "Comparando tu bóveda con la nube…",
	"Not now": "No ahora",
	"Change vault": "Cambiar bóveda",
	"Advanced sync options": "Opciones de sincronización avanzadas",
	"Everything is in sync": "Todo está sincronizado",
	"This vault": "Esta bóveda",
	"Cloud server": "Servidor en la nube",
	" conflicts need resolution": {
		one: "conflicto necesita resolución",
		many: "conflictos que necesitan solución",
		other: "conflictos que necesitan solución",
	},
	notes: "notas",
	attachments: "adjuntos",
	folders: "carpetas",
	"Confirm destructive sync": "Confirmar sincronización destructiva",
	"You are about to:": "Estás a punto de:",
	"Files that will be deleted:": "Archivos que se eliminarán:",
	"This cannot be undone.": "Esto no se puede deshacer.",
	Back: "Atrás",
	Confirm: "Confirmar",
	"Switch vault": "Cambiar bóveda",
	"Pick a vault to sync with. We will recalculate the sync preview after you choose.":
		"Elige una bóveda para sincronizar. Recalcularemos la vista previa de la sincronización después de que la elijas.",
	"Loading vaults…": "Cargando bóvedas…",
	" (default)": "(por defecto)",
	"No other vaults available.": "No hay otras bóvedas disponibles.",
	"Make new vault": "Crear nueva bóveda",
	"New vault": "Bóveda nueva",
	"Create a new empty vault on the server, then sync this Obsidian vault into it.":
		"Crea una bóveda vacía en el servidor y luego sincroniza esta bóveda de Obsidian con ella.",
	"Vault name": "Nombre de la bóveda",
	Create: "Crear",
	"Could not load vaults": "No se pudieron cargar las bóvedas",
	"Enter a name for the new vault": "Introduce un nombre para la nueva bóveda",
	"Failed to switch vault": "No se pudo cambiar de bóveda",
	"Your vault shares {percent} of its data with Engram":
		"Tu bóveda comparte {percent} de sus datos con Engram",
	"Type {keyword} to confirm:": "Escribe {keyword} para confirmar:",
	"Uploading {count}.": "Subiendo {count}.",
	"Downloading {count}.": "Descargando {count}.",
	"Deleting {count} local files.": {
		one: "Eliminando {count} archivo local.",
		many: "Eliminando {count} archivos locales.",
		other: "Eliminando {count} archivos locales.",
	},
	"Deleting {count} on the cloud.": "Borrando {count} en la nube.",
	"First sync, this may take a moment.": "Primer sincronización, esto puede tardar un momento.",
	"Checking for changes.": "Comprobando cambios.",
	"Nothing will be deleted.": "Nada se borrará.",
	"✓ {count} synced": "✓ {count} sincronizado",
	"⤳ {count} skipped (Free plan)": "⤳ {count} omitido (Plan gratuito)",
	"✕ {count} failed": "✕ {count} fallido",
	"{count} attachments need a paid plan to sync. See Sync Center.": {
		one: "{count} adjunto necesita un plan de pago para sincronizarse. Consulta el Centro de sincronización.",
		many: "{count} Los adjuntos requieren un plan de pago para sincronizarse. Consulta el Centro de sincronización.",
		other: "{count} adjuntos necesitan un plan de pago para sincronizarse. Consulta el Centro de sincronización.",
	},
	"Finished with some errors. Open the sync log to see what failed.":
		"Finalizado con algunos errores. Abre el registro de sincronización para ver qué falló.",
	"Synced. Some attachments need a paid plan to sync (see below).":
		"Sincronizado. Algunos adjuntos requieren un plan de pago para sincronizarse (ver abajo).",
	"All synced. Your vault and the cloud now match.":
		"Todo sincronizado. Tu bóveda y la nube ahora coinciden.",
	"Already up to date. Nothing needed syncing.":
		"Ya está actualizado. No es necesario sincronizar nada.",
	Deleting: "Borrando",
	Downloading: "Descargando",
	Uploading: "Subiendo",
	"Syncing your vault": "Sincronizando tu bóveda",
	"Getting started…": "Empezando…",
	"Open Engram to check your vault and confirm everything synced.":
		"Abre Engram para revisar tu bóveda y confirmar que todo se sincronizó.",
	"Open Engram": "Abrir Engram",
	"You can close this and the sync keeps running in the background.":
		"Puedes cerrar esto y la sincronización continúa en segundo plano.",
	"Run in background": "Ejecutar en segundo plano",
	"Syncing…": "Sincronizando…",
	"Sync complete": "Sincronización completa",
	"Syncing attachments": "Sincronizando adjuntos",
	Complete: "Completado",
	'{count} failed. Run "{command}" for details.':
		'{count} falló. Ejecuta "{command}" para más detalles.',
	"Free syncs notes only — images & PDFs need a paid plan.":
		"Sincroniza notas gratis, pero las imágenes y los PDF requieren un plan de pago.",
	"Engram: {count} files failed to sync{detail} — open Sync Center": {
		one: "Engram: {count} archivo no se pudo sincronizar{detail} — abre el Centro de sincronización",
		many: "Engram: Fallaron {count} archivos al sincronizarse{detail} — abre el Centro de sincronización",
		other: "Engram: Fallaron {count} archivos al sincronizarse{detail} — abre el Centro de sincronización",
	},
	"Engram: {count} attachments skipped — upgrade to sync images & PDFs.": {
		one: "Engram: Se omitió {count} adjunto. Actualiza para sincronizar imágenes y PDF.",
		many: "Engram: Se omitieron {count} adjuntos. Actualiza para sincronizar imágenes y PDFs.",
		other: "Engram: Se omitieron {count} adjuntos. Actualiza para sincronizar imágenes y PDF.",
	},
	"Engram: plan upgraded — syncing {count} attachments…": {
		one: "Engram: plan mejorado — sincronizando {count} adjunto…",
		many: "Engram: plan mejorado — sincronizando {count} adjuntos…",
		other: "Engram: plan mejorado — sincronizando {count} adjuntos…",
	},
	"Pull all (delete extras) aborted: could not obtain an exclusive server snapshot (replay contention). Nothing was trashed.":
		"La descarga de todo (eliminando duplicados) se canceló: no se pudo obtener una instantánea exclusiva del servidor (conflicto de reescritura). Nada se eliminó.",
	"Pull all aborted: another sync is running (replay contention). Try again when it finishes.":
		"La descarga de todo se canceló: otra sincronización está en curso (conflicto de reescritura). Inténtalo de nuevo cuando termine.",
	"Pull all failed: {error}": "La descarga de todo falló: {error}",
	"Pull all failed": "La descarga de todo falló",
	"Engram: sync conflict on {path} — your local edit was saved as {copy}":
		"Engram: conflicto de sincronización en {path} — tu edición local se guardó como {copy}",
	"Open note": "Abrir nota",
	"Engram: {count} notes have frontmatter problems. Open Sync Center to fix.":
		"Engram: {count} notas tienen problemas en el frontmatter. Abre el Centro de sincronización para corregirlos.",
	'Engram Sync: renamed "{name}" (unsupported characters)':
		'Engram Sync: se renombró "{name}" (caracteres no admitidos)',
	'Engram: frontmatter problem in "{name}"': 'Engram: problema en el frontmatter de "{name}"',
	"Engram: this plugin is too old to sync (needs {version} or newer). Update it to continue.":
		"Engram: este plugin es demasiado antiguo para sincronizar (necesita {version} o superior). Actualízalo para continuar.",
	"Engram: this plugin is too old to sync. Update it to continue.":
		"Engram: este plugin es demasiado antiguo para sincronizar. Actualízalo para continuar.",
	Update: "Actualizar",
	"New here? Watch the setup video": "¿Eres nuevo aquí? Mira el video de configuración",
	"What Engram does, and how to connect your vault, start to finish.":
		"¿Qué hace Engram y cómo conectar tu bóveda, de principio a fin.",
	"▶ Watch on YouTube": "▶ Ver en YouTube",
	"Getting set up": "Configuración",
	"1. Make an account": "1. Crea una cuenta",
	"Create a hosted account at ": "Crea una cuenta alojada en",
	", or self-host the backend (": ", o alojas el backend tú mismo (",
	"setup guide": "guía de configuración",
	"2. Connect your vault to Engram": "2. Conecta tu bóveda a Engram",
	"Sign in (or enter your server URL and key) on the connection tab, then run your first sync.":
		"Inicia sesión (o introduce la URL de tu servidor y la clave) en la pestaña de conexión, y luego realiza tu primera sincronización.",
	"Open connection tab": "Abrir pestaña de conexión",
	"3. Connect your AI": "3. Conecta tu IA",
	"Link Claude, Cursor, ChatGPT, or any MCP app so it can read and write your notes. ":
		"Vincula Claude, Cursor, ChatGPT o cualquier aplicación MCP para que pueda leer y escribir tus notas",
	"See the AI setup guide": "Consulta la guía de configuración de la IA",
	Plans: "Planes",
	Free: "Gratuito",
	"1 vault, 2 devices": "1 bóveda, 2 dispositivos",
	"Real-time sync": "Sincronización en tiempo real",
	"2,000 notes searchable": "2000 notas buscables",
	"Connect any AI (MCP)": "Conecta cualquier IA (MCP)",
	Starter: "Starter",
	"10 vaults, unlimited devices": "10 bóvedas, dispositivos ilimitados",
	"Search all your notes": "Busca todas tus notas",
	"10 GB attachments": "10 GB de adjuntos",
	"Unlimited AI searches": "Búsquedas ilimitadas con IA",
	Pro: "Pro",
	"Unlimited vaults": "Bóvedas ilimitadas",
	"Search across all vaults at once": "Busca en todas las bóvedas a la vez",
	"50 GB attachments": "50 GB de adjuntos",
	"API access": "Acceso a la API",
	"See full pricing": "Ver precios completos",
	"Learn more": "Más información",
	Documentation: "Documentación",
	"AI / MCP setup guide": "Guía de configuración de IA / MCP",
	"Report an issue": "Reportar un problema",
	"Join our Discord": "Únete a nuestro Discord",
	"Node.js dependencies": "Dependencias de Node.js",
	"Python virtual environment": "Entorno virtual de Python",
	"Python bytecode cache": "Caché de bytecode de Python",
	"Vendored dependencies": "Dependencias incluidas",
	"Gradle build cache": "Caché de compilación de Gradle",
	"Rust/Java build output": "Salida de compilación de Rust/Java",
	"Build output": "Salida de compilación",
	"Next.js build output": "Salida de compilación de Next.js",
	"Distribution build output": "Salida de compilación de distribución",
	"Cargo cache": "Caché de Cargo",
	"CocoaPods dependencies": "Dependencias de CocoaPods",
	"Dart tool cache": "Caché de herramientas Dart",
	"Generic cache directory": "Directorio de caché genérico",
	"Ignore patterns": "Patrones ignorados",
	"Custom patterns": "Patrones personalizados",
	"Paths to skip (one per line). Folder patterns end with /. Built-in: {configDir}/, .trash/, .git/":
		"Rutas a omitir (una por línea). Los patrones de carpeta terminan con /. Incorporados: {configDir}/, .trash/, .git/",
	Diagnostics: "Diagnósticos",
	"Send detailed sync, vault, and connection activity to the server for troubleshooting, with distributed tracing on requests. Metadata only, never note content. Leave off for normal use.":
		"Envía información detallada de la sincronización, la bóveda y la conexión al servidor para solucionar problemas, con trazado distribuido en las solicitudes. Solo metadatos, nunca contenido de las notas. Desactiva para uso normal.",
	"Diagnostics detail": "Detalles de los diagnósticos",
	"Minimum severity that ships while diagnostics are on. Higher levels send fewer lines. Default: Info.":
		"Nivel de severidad mínimo que se envía mientras los diagnósticos están activados. Los niveles más altos envían menos líneas. Predeterminado: Info.",
	"Errors only": "Errores solamente",
	"Warnings and errors": "Advertencias y errores",
	"Info (default)": "Info (predeterminado)",
	"Debug (verbose)": "Depuración (detallado)",
	About: "Acerca de",
	"License: {name}": "Licencia: {name}",
	"⚠ Detected: {label}/ ({formatted} files)": "⚠ Detectado: {label} / ({formatted} archivos)",
	"{desc} — should not be synced": "{desc} — no debe sincronizarse",
	"Add to ignores": "Añadir a los ignorados",
	"Added {pattern} to ignore patterns": "Añadido {pattern} a los patrones ignorados",
	"Version: {version}": "Versión: {version}",
	"Source: {link}": "Origen: {link}",
	"Engram URL": "URL de Engram",
	"✓ Engram server reachable (v{version})": "✓ Servidor de Engram accesible (v{version})",
	"✗ server responded but isn't an Engram backend":
		"✗ El servidor respondió, pero no es un servidor de Engram",
	"✗ couldn't reach a server at this URL": "✗ No se pudo acceder a un servidor en esta URL",
	"Checking server…": "Verificando el servidor…",
	"That does not look like a complete server address. Include the scheme, for example http://127.0.0.1:4000":
		"Eso no parece una dirección de servidor completa. Incluye el esquema, por ejemplo http://127.0.0.1:4000",
	"Engram backend changed — sign in again to continue.":
		"El backend de Engram ha cambiado. Inicia sesión de nuevo para continuar.",
	Authentication: "Autenticación",
	"Signed in as {email}": "Iniciado sesión como {email}",
	"Authenticated via Engram account (OAuth).":
		"Autenticado a través de la cuenta de Engram (OAuth).",
	"Manage account": "Administrar cuenta",
	"Sign out": "Cerrar sesión",
	"Using API key": "Usando clave API",
	"Authenticated via manual API key.": "Autenticado a través de una clave API manual.",
	"Clear key": "Borrar clave",
	"Switch to sign in": "Cambiar a iniciar sesión",
	"Engram: sign-in failed ({error})": "Engram: inicio de sesión fallido ({error})",
	"Sign in or create an account": "Inicia sesión o crea una cuenta",
	"Opens your browser to sign in, or create an account if you don't have one yet, then links this vault.":
		"Abre tu navegador para iniciar sesión o crear una cuenta si no la tienes, y luego vincula esta bóveda.",
	"Sign in": "Iniciar sesión",
	"Or authenticate with a token instead of signing in. Engram Cloud API keys require the Pro plan; on Free and Starter, sign in above.":
		"O autentícate con un token en lugar de iniciar sesión. Las claves API de Engram requieren el plan Pro; en Free y Starter, inicia sesión arriba.",
	"Or authenticate with a token instead of signing in.":
		"O autentícate con un token en lugar de iniciar sesión.",
	"API key": "Clave API",
	Token: "Token",
	"Bearer token from your Engram account.": "Token de tu cuenta de Engram.",
	Save: "Guardar",
	"Enter an API key first": "Introduce una clave API primero",
	"That does not look like an Engram API key (expected {prefix}…).":
		"Eso no parece una clave API de Engram (se espera {prefix}…).",
	Vault: "Bóveda",
	"Vault selection": "Selección de bóveda",
	"Select which vault this plugin syncs with.":
		"Selecciona la bóveda con la que este plugin se sincroniza.",
	"No vaults found — first sync will create one":
		"No se encontraron bóvedas — la primera sincronización creará una",
	"Pick a vault (previous: '{name}' not found)":
		"Elige una bóveda (anterior: '{name}' no encontrado)",
	"Pick a vault (previous: id {id} not found)":
		"Elige una bóveda (anterior: id {id} no encontrado)",
	"Pick a vault": "Elige una bóveda",
	Change: "Cambiar",
	"Support development": "Apoya el desarrollo",
	"If this plugin saves you time, consider supporting development.":
		"Si este plugin te ahorra tiempo, considera apoyar el desarrollo.",
	"GitHub Sponsors": "GitHub Sponsors",
	"Sign-in required to load vaults": "Inicio de sesión requerido para cargar las bóvedas",
	"Server error ({status}) — check Engram logs":
		"Error del servidor ({status}) — revisa los registros de Engram",
	"Request failed ({status})": "La solicitud falló ({status})",
	"Could not reach Engram — check connection":
		"No se pudo conectar con Engram. Verifica la conexión",
	"Engram Cloud": "Nube de Engram",
	"Self-hosted": "Autohospedado",
	Backend: "Servidor",
	"Where this vault syncs to. Each backend keeps its own sign-in.":
		"Dónde se sincroniza esta bóveda. Cada servidor tiene su propio inicio de sesión.",
	"Switched to {mode}.": "Cambiado a {mode}.",
	"Not connected. Enter your Engram server URL below to start syncing.":
		"No conectado. Introduce la URL de tu servidor de Engram para empezar a sincronizar.",
	"Run your own Engram server": "Ejecuta tu propio servidor de Engram",
	"Engram is the backend that powers sync and semantic search.":
		"Engram es el servidor que permite la sincronización y la búsqueda semántica.",
	"Nothing in this vault syncs until you choose how to merge it with the server.":
		"Nada de esta bóveda se sincroniza hasta que elijas cómo fusionarla con el servidor.",
	"Choose sync direction": "Elige la dirección de sincronización",
	"...": "...",
	'... "{name}" ...': '... "{name}" ...',
};

export default es;
