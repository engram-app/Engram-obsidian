import type { Dict } from "..";

// Español
const es: Dict = {
	" (default)": " (por defecto)",
	"({count} errors)": {
		one: "({count} error)",
		many: "({count} errores)",
		other: "({count} errores)",
	},
	"...": "...",
	'... "{name}" ...': '... "{name}" ...',
	"1 vault, 2 devices": "1 bóveda, 2 dispositivos",
	"1. Make an account": "1. Crea una cuenta",
	"10 GB attachments": "10 GB de adjuntos",
	"10 vaults, unlimited devices": "10 bóvedas, dispositivos ilimitados",
	"2,000 notes searchable": "2000 notas buscables",
	"2. Connect your vault to Engram": "2. Conecta tu bóveda a Engram",
	"3. Connect your AI": "3. Conecta tu IA",
	"50 GB attachments": "50 GB de adjuntos",
	"A browser window has opened. Sign in and enter this code to link your vault.":
		"Se ha abierto una ventana del navegador. Inicia sesión e introduce este código para conectar tu bóveda.",
	"A frontmatter key could not be parsed as YAML.":
		"No se pudo analizar una clave del frontmatter como YAML.",
	"A temporary server problem — retrying automatically.":
		"Un problema temporal del servidor, se está reintentando automáticamente.",
	"AI / MCP setup guide": "Guía de configuración de IA / MCP",
	"AI searches": "Búsquedas con IA",
	"API access": "Acceso a la API",
	"API key": "Clave API",
	"API keys need Pro. Sign in with your Engram account instead.":
		"Las claves de API requieren la versión Pro. Inicia sesión con tu cuenta de Engram.",
	About: "Acerca de",
	"Accept it to keep syncing.": "Acepta para continuar sincronizando.",
	"Account setup incomplete.": "Configuración de la cuenta incompleta.",
	"Account suspended. Contact support.": "Cuenta suspendida. Contacta con soporte.",
	"Activity ({count})": "Actividad ({count})",
	"Add to ignores": "Añadir a los ignorados",
	"Added {pattern} to ignore patterns": "Añadido {pattern} a los patrones ignorados",
	"Advanced sync options": "Opciones de sincronización avanzadas",
	"All synced. Your vault and the cloud now match.":
		"Todo sincronizado. Tu bóveda y la nube ahora coinciden.",
	"Already in sync. Nothing is deleted.": "Ya está sincronizado. Nada se elimina.",
	"Already signed in on another device. Upgrade for multi-device.":
		"Ya iniciaste sesión en otro dispositivo. Actualiza para usar varios dispositivos.",
	"Already up to date. Nothing needed syncing.":
		"Ya está actualizado. No es necesario sincronizar nada.",
	"An unexpected error — retrying automatically.":
		"Un error inesperado, se está reintentando automáticamente.",
	"Attachment storage full": "Almacenamiento de adjuntos lleno",
	"Attachment storage is full — upgrade for more.":
		"El almacenamiento de adjuntos está lleno. Actualiza para obtener más espacio.",
	"Attachment sync is disabled for this account.":
		"La sincronización de adjuntos está desactivada para esta cuenta.",
	Attachments: "Adjuntos",
	"Attachments need a paid plan": "Los adjuntos requieren un plan de pago",
	"Attachments on this device": "Adjuntos en este dispositivo",
	"Authenticated via Engram account (OAuth).":
		"Autenticado a través de la cuenta de Engram (OAuth).",
	"Authenticated via manual API key.": "Autenticado a través de una clave API manual.",
	Authentication: "Autenticación",
	Back: "Atrás",
	Backend: "Servidor",
	"Bearer token from your Engram account.": "Token de tu cuenta de Engram.",
	Both: "Ambos",
	Bug: "Error",
	"Build output": "Salida de compilación",
	"Can't reach the server — retrying automatically.":
		"No se puede acceder al servidor, se está reintentando automáticamente.",
	Cancel: "Cancelar",
	"Cargo cache": "Caché de Cargo",
	Change: "Cambiar",
	"Change vault": "Cambiar bóveda",
	"Check sync status": "Comprobar el estado de la sincronización",
	"Checking for changes.": "Comprobando cambios.",
	"Checking server…": "Verificando el servidor…",
	"Choose sync direction": "Elige la dirección de sincronización",
	Clear: "Borrar",
	"Clear all": "Borrar todo",
	"Clear key": "Borrar clave",
	"Clear search": "Borrar búsqueda",
	"Click to copy": "Haz clic para copiar",
	"Click to sync": "Haz clic para sincronizar",
	Close: "Cerrar",
	"Cloud server": "Servidor en la nube",
	"CocoaPods dependencies": "Dependencias de CocoaPods",
	"Code copied!": "¡Código copiado!",
	"Code expired. Please try again.": "Código expirado. Por favor, inténtalo de nuevo.",
	"Comparing your vault with the cloud…": "Comparando tu bóveda con la nube…",
	Complete: "Completado",
	Confirm: "Confirmar",
	"Confirm destructive sync": "Confirmar sincronización destructiva",
	Conflict: "Conflicto",
	Confusing: "Confuso",
	"Connect any AI (MCP)": "Conecta cualquier IA (MCP)",
	"Connect to Engram first to send feedback.":
		"Conéctate a Engram primero para enviar comentarios.",
	"Connected — live sync active": "Conectado — sincronización activa",
	"Connected — polling": "Conectado — verificando",
	"Connected — waiting for first sync decision":
		"Conectado — esperando la primera decisión de sincronización",
	"Connection failed": "Conexión fallida",
	"Could not compare with the cloud. Check your connection.":
		"No se pudo comparar con la nube. Verifica tu conexión.",
	"Could not create the vault — check your connection and try again.":
		"No se pudo crear la bóveda. Verifica tu conexión e inténtalo de nuevo.",
	"Could not load vaults: {error}": "No se pudieron cargar las bóvedas: {error}",
	"Could not reach Engram — check connection":
		"No se pudo conectar con Engram. Verifica la conexión",
	"Couldn't create vault — the name may be invalid or already in use.":
		"No se pudo crear la bóveda. El nombre podría ser inválido o ya estar en uso.",
	"Couldn't send your feedback, please try again.":
		"No se pudo enviar tu opinión, por favor intenta de nuevo.",
	Create: "Crear",
	"Create a hosted account at {signup}, or self-host the backend ({guide}).":
		"Crea una cuenta alojada en {signup}, o aloja el backend tú mismo ({guide}).",
	"Create a new empty vault on the server, then sync this Obsidian vault into it.":
		"Crea una bóveda vacía en el servidor y luego sincroniza esta bóveda de Obsidian con ella.",
	"Custom patterns": "Patrones personalizados",
	"Daily AI search limit reached. Free includes 20 per day across Obsidian, the web app and MCP. Upgrade for unlimited.":
		"Límite diario de búsquedas de IA alcanzado. La versión gratuita incluye 20 búsquedas por día en Obsidian, la aplicación web y MCP. Actualiza para tener búsquedas ilimitadas.",
	"Dart tool cache": "Caché de herramientas Dart",
	"Debug (verbose)": "Depuración (detallado)",
	"Delete all local files, then download from remote":
		"Borra todos los archivos locales y luego descárgalos desde el servidor",
	"Delete all on remote, then upload local files":
		"Elimina todo en el servidor, luego sube los archivos locales",
	"Delete all {count} files currently on the server": {
		one: "Eliminar todos los {count} archivos que están actualmente en el servidor",
		many: "Eliminar todos los archivos {count} que están actualmente en el servidor",
		other: "Eliminar los {count} archivos que están actualmente en el servidor",
	},
	"Delete all {count} files in this vault": {
		one: "Eliminar todos los {count} archivo en esta bóveda",
		many: "Eliminar todos los archivos {count} en esta bóveda",
		other: "Eliminar los {count} archivos de esta bóveda",
	},
	Deleted: "Eliminado",
	Deleting: "Borrando",
	"Deleting {count} local files.": {
		one: "Eliminando {count} archivo local.",
		many: "Eliminando {count} archivos locales.",
		other: "Eliminando {count} archivos locales.",
	},
	"Deleting {count} on the cloud.": {
		one: "Eliminando {count} en la nube.",
		many: "Eliminando la versión {count} en la nube.",
		other: "Eliminando {count} en la nube.",
	},
	"Device swap cooldown active. Wait or upgrade.":
		"Periodo de espera para cambio de dispositivo activo. Espera o actualiza.",
	Diagnostics: "Diagnósticos",
	"Diagnostics detail": "Detalles de los diagnósticos",
	"Disconnect (clear login)": "Desconectar (borrar inicio de sesión)",
	Disconnected: "Desconectado",
	Dismiss: "Descartar",
	"Distribution build output": "Salida de compilación de distribución",
	Documentation: "Documentación",
	Done: "Hecho",
	"Download everything": "Descargar todo",
	"Download remote files without uploading the local":
		"Descarga archivos remotos sin subir los locales",
	"Download {count} files from the server": {
		one: "Descargar {count} archivo del servidor",
		many: "Descargar {count} archivos del servidor",
		other: "Descarga {count} archivos del servidor",
	},
	Downloading: "Descargando",
	"Downloading {count}.": {
		one: "Descargando {count}.",
		many: "Descargando {count}.",
		other: "Descargando {count}.",
	},
	"Downloads {count}.": {
		one: "Descargas {count}.",
		many: "Descargas {count}.",
		other: "Descargas {count}.",
	},
	"Engram Cloud": "Nube de Engram",
	"Engram Sync: pulled {count} changes": {
		one: "Engram Sync: se aplicó {count} cambio",
		many: "Engram Sync: se aplicaron {count} cambios",
		other: "Engram Sync: se aplicaron {count} cambios",
	},
	"Engram Sync: pulled {count} files from server": {
		one: "Engram Sync: se descargó {count} archivo del servidor",
		many: "Engram Sync: se descargaron {count} archivos del servidor",
		other: "Engram Sync: se descargaron {count} archivos del servidor",
	},
	"Engram Sync: pulled {pulled}": "Engram Sync: descargados {pulled}",
	"Engram Sync: pulled {pulled} (local extras deleted)":
		"Engram Sync: descargados {pulled} (se eliminaron extras locales)",
	"Engram Sync: pulled {pulled}, pushed {pushed}":
		"Engram: descargados {pulled}, enviados {pushed}",
	"Engram Sync: pushed {count} files": {
		one: "Engram Sync: se enviaron {count} archivo",
		many: "Engram Sync: se enviaron {count} archivos",
		other: "Engram Sync: se enviaron {count} archivos",
	},
	"Engram Sync: pushed {pushed}": "Engram Sync: enviados {pushed}",
	'Engram Sync: renamed "{name}" (unsupported characters)':
		'Engram Sync: se renombró "{name}" (caracteres no admitidos)',
	"Engram Sync: replaced remote with local ({pushed} uploaded)":
		"Engram Sync: reemplazado el remoto con el local ({pushed} subidos)",
	'Engram Sync: sync state for "{name}" was unreadable — using the on-disk copy.':
		'Engram Sync: el estado de sincronización de "{name}" no se pudo leer; se está utilizando la copia en el disco.',
	"Engram Sync: {details}": "Sincronización de Engram: {details}",
	"Engram URL": "URL de Engram",
	"Engram Vault Sync {version} is available. {link}.":
		"Engram Vault Sync {version} está disponible. {link}.",
	"Engram backend changed — sign in again to continue.":
		"El backend de Engram ha cambiado. Inicia sesión de nuevo para continuar.",
	"Engram indexes {indexed} of your {all} notes. The rest match on this device only. Upgrade to index everything.":
		"Engram indexa {indexed} de tus {all} notas. El resto solo coinciden en este dispositivo. Actualiza para indexar todo.",
	"Engram is the backend that powers sync and semantic search.":
		"Engram es el servidor que permite la sincronización y la búsqueda semántica.",
	"Engram search": "Búsqueda en Engram",
	"Engram sync: checking...": "Sincronización de Engram: comprobando...",
	"Engram sync: everything in sync": "Sincronización de Engram: todo está sincronizado",
	"Engram sync: live sync requires a plugin update — please update the Engram vault sync plugin.":
		"Engram: la sincronización en tiempo real requiere una actualización del plugin — actualiza el plugin de sincronización de la bóveda de Engram.",
	"Engram sync: pulling all from server...":
		"Sincronización de Engram: descargando todo desde el servidor...",
	"Engram sync: server does not support reconciliation (update backend)":
		"Sincronización de Engram: el servidor no admite la reconciliación (actualizar el backend)",
	"Engram sync: sync failed": "Engram: la sincronización falló",
	"Engram sync: syncing...": "Sincronización de Engram: sincronizando...",
	"Engram unreachable. Showing matches from this device only.":
		"Engram no está disponible. Mostrando coincidencias solo de este dispositivo.",
	"Engram's {document} update, effective {date}.":
		"Actualización de Engram {document}, vigente a partir del {date}.",
	"Engram: This vault has been deleted on the server.":
		"Engram: esta bóveda ha sido eliminada en el servidor.",
	"Engram: disconnected. Open Engram settings to reconnect.":
		"Engram: desconectado. Abre la configuración de Engram para volver a conectar.",
	"Engram: error": "Engram: error",
	"Engram: finish setup": "Engram: finalizar la configuración",
	'Engram: frontmatter problem in "{name}"': 'Engram: problema en el frontmatter de "{name}"',
	"Engram: live": "Engram: en línea",
	"Engram: not connected": "Engram: no conectado",
	"Engram: offline": "Engram: sin conexión",
	"Engram: offline ({count} queued)": {
		one: "Engram: sin conexión ({count} en cola)",
		many: "Engram: sin conexión ({count} en cola)",
		other: "Engram: sin conexión ({count} en cola)",
	},
	"Engram: pending ({count})": "Engram: pendiente ({count})",
	"Engram: plan upgraded — syncing {count} attachments…": {
		one: "Engram: plan mejorado — sincronizando {count} adjunto…",
		many: "Engram: plan mejorado — sincronizando {count} adjuntos…",
		other: "Engram: plan mejorado — sincronizando {count} adjuntos…",
	},
	"Engram: plugin settings file was corrupted and could not be recovered. You may need to reconnect in settings.":
		"Engram: el archivo de configuración del plugin está dañado y no se pudo recuperar. Es posible que debas volver a conectar en la configuración.",
	"Engram: ready": "Engram: listo",
	"Engram: recovered plugin settings from a backup after a corrupted save.":
		"Engram: se restauraron la configuración del plugin desde una copia de seguridad después de un guardado corrupto.",
	"Engram: settings tab failed to render ({error})":
		"Engram: la pestaña de configuración no se pudo mostrar ({error})",
	"Engram: sign-in failed ({error})": "Engram: inicio de sesión fallido ({error})",
	"Engram: signed out": "Engram: desconectado",
	"Engram: sync conflict on {path} — your local edit was saved as {copy}":
		"Engram: conflicto de sincronización en {path} — tu edición local se guardó como {copy}",
	"Engram: sync failed. Open the sync log for details.":
		"Engram: la sincronización falló. Abre el registro de sincronización para más detalles.",
	"Engram: sync is not set up yet, so nothing in this vault will sync.":
		"Engram: la sincronización no está configurada todavía, así que nada en esta bóveda se sincronizará.",
	"Engram: sync is paused. This edit was not synced. Choose a sync direction to resume.":
		"Engram: la sincronización está pausada. Esta edición no se sincronizó. Elige una dirección de sincronización para reanudar.",
	"Engram: sync paused": "Engram: sincronización pausada",
	"Engram: syncing": "Engram: sincronizando",
	"Engram: syncing ({count})": "Engram: sincronizando ({count})",
	"Engram: this plugin is too old to sync (needs {version} or newer). Update it to continue.":
		"Engram: este plugin es demasiado antiguo para sincronizar (necesita {version} o superior). Actualízalo para continuar.",
	"Engram: this plugin is too old to sync. Update it to continue.":
		"Engram: este plugin es demasiado antiguo para sincronizar. Actualízalo para continuar.",
	"Engram: this vault no longer exists on the server. Pick or create a vault to continue.":
		"Engram: esta bóveda ya no existe en el servidor. Elige o crea una bóveda para continuar.",
	"Engram: your login expired — open Engram settings to reconnect.":
		"Engram: tu sesión ha expirado — abre la configuración de Engram para volver a conectar.",
	"Engram: {count} attachments skipped — upgrade to sync images & PDFs.": {
		one: "Engram: Se omitió {count} adjunto. Actualiza para sincronizar imágenes y PDF.",
		many: "Engram: Se omitieron {count} adjuntos. Actualiza para sincronizar imágenes y PDFs.",
		other: "Engram: Se omitieron {count} adjuntos. Actualiza para sincronizar imágenes y PDF.",
	},
	"Engram: {count} files failed to sync{detail} — open Sync Center": {
		one: "Engram: {count} archivo no se pudo sincronizar{detail} — abre el Centro de sincronización",
		many: "Engram: Fallaron {count} archivos al sincronizarse{detail} — abre el Centro de sincronización",
		other: "Engram: Fallaron {count} archivos al sincronizarse{detail} — abre el Centro de sincronización",
	},
	"Engram: {count} notes have frontmatter problems. Open Sync Center to fix.": {
		one: "Engram: {count} nota tiene problemas en el frontmatter. Abre el Centro de sincronización para corregir.",
		many: "Engram: {count} notas tienen problemas en el frontmatter. Abre el Centro de sincronización para solucionarlos.",
		other: "Engram: {count} notas tienen problemas en el frontmatter. Abre el Centro de sincronización para corregir.",
	},
	"Engram: ⚠ {count} sync errors": {
		one: "Engram: ⚠ {count} error de sincronización",
		many: "Engram: ⚠ {count} errores de sincronización",
		other: "Engram: ⚠ {count} errores de sincronización",
	},
	"Enter a name for the new vault": "Introduce un nombre para la nueva bóveda",
	"Enter an API key first": "Introduce una clave API primero",
	Error: "Error",
	"Error: {error}": "Error: {error}",
	"Errors only": "Errores solamente",
	"Everything is in sync": "Todo está sincronizado",
	"Failed to start device flow. Check your Engram URL and try again.":
		"No se pudo iniciar el proceso de autenticación. Verifica tu URL de Engram e inténtalo de nuevo.",
	"Failed to switch vault: {error}": "No se pudo cambiar la bóveda: {error}",
	"File exceeds the {limit} limit": "El archivo excede el límite de {limit}",
	"File not found locally: {path}": "Archivo no encontrado localmente: {path}",
	"File too large for your plan.": "El archivo es demasiado grande para tu plan.",
	"Files that will be deleted:": "Archivos que se eliminarán:",
	"Filter by folder…": "Filtrar por carpeta…",
	"Filter by tags…": "Filtrar por etiquetas…",
	"Finish setting up your account at app.engram.page to start syncing.":
		"Finaliza la configuración de tu cuenta en app.engram.page para empezar a sincronizar.",
	"Finish sync setup": "Finalizar la configuración de sincronización",
	"Finished with some errors. Open the sync log to see what failed.":
		"Finalizado con algunos errores. Abre el registro de sincronización para ver qué falló.",
	"First sync, this may take a moment.": "Primer sincronización, esto puede tardar un momento.",
	Free: "Gratuito",
	"Free syncs notes only — images & PDFs need a paid plan.":
		"Sincroniza notas gratis, pero las imágenes y los PDF requieren un plan de pago.",
	"Free syncs notes only — {count} attachments will be skipped.": {
		one: "Sincroniza notas gratis, solo se omitirá {count} adjunto.",
		many: "Sincroniza notas gratis, solo se sincronizarán {count} adjuntos.",
		other: "Sincroniza notas gratis, solo se omitirán {count} adjuntos.",
	},
	"Frontmatter could not be parsed": "No se pudo analizar el frontmatter",
	"Frontmatter isn't valid YAML.": "El frontmatter no es un YAML válido.",
	'Frontmatter key "{key}" could not be parsed as YAML.':
		'No se pudo analizar la clave del frontmatter "{key}" como YAML.',
	"Frontmatter needs a fix": "El frontmatter necesita una corrección",
	"Generic cache directory": "Directorio de caché genérico",
	"Getting set up": "Configuración",
	"Getting started…": "Empezando…",
	"GitHub Sponsors": "GitHub Sponsors",
	"Gradle build cache": "Caché de compilación de Gradle",
	"How do you feel about Engram?": "¿Qué te parece Engram?",
	Idea: "Idea",
	"If this plugin saves you time, consider supporting development.":
		"Si este plugin te ahorra tiempo, considera apoyar el desarrollo.",
	Ignore: "Ignorar",
	"Ignore patterns": "Patrones ignorados",
	"Ignored ({count})": "Ignorados ({count})",
	"Ignored {path} — won't sync until restored from Sync Center.":
		"Ignorado {path} — no se sincronizará hasta que se restaure desde el Centro de sincronización.",
	"Info (default)": "Info (predeterminado)",
	"Invalid API key": "Clave API inválida",
	"It's OK to email me about this": "Puedes enviarme un correo electrónico sobre esto",
	"Join our Discord": "Únete a nuestro Discord",
	Keyword: "Palabra clave",
	"Last sync: {when}": "Última sincronización: {when}",
	"Learn more": "Más información",
	"License: {name}": "Licencia: {name}",
	"Limit reached. Upgrade to continue.": "Límite alcanzado. Actualiza para continuar.",
	"Link Claude, Cursor, ChatGPT, or any MCP app so it can read and write your notes. ":
		"Vincula Claude, Cursor, ChatGPT o cualquier aplicación MCP para que pueda leer y escribir tus notas ",
	"Link Obsidian to Engram": "Conecta Obsidian a Engram",
	"Loading vaults…": "Cargando bóvedas…",
	"Love it": "Me encanta",
	"Make new vault": "Crear nueva bóveda",
	"Manage account": "Administrar cuenta",
	"Minimum severity that ships while diagnostics are on. Higher levels send fewer lines. Default: Info.":
		"Nivel de severidad mínimo que se envía mientras los diagnósticos están activados. Los niveles más altos envían menos líneas. Predeterminado: Info.",
	"Needs attention ({count})": "Requiere atención ({count})",
	"Network unavailable": "Red no disponible",
	"New here? Watch the setup video": "¿Eres nuevo aquí? Mira el video de configuración",
	"New vault": "Bóveda nueva",
	"Next.js build output": "Salida de compilación de Next.js",
	"No activity yet. Push or pull to see entries here.":
		"Aún no hay actividad. Envía o recibe para ver las entradas aquí.",
	"No files ignored. Use the ignore button on a failure row to stop syncing it.":
		"No hay archivos ignorados. Usa el botón de ignorar en una fila de error para detener su sincronización.",
	"No other vaults available.": "No hay otras bóvedas disponibles.",
	"No results found": "No se encontraron resultados",
	"No source path for this result": "No hay ruta de origen para este resultado",
	"No sync activity this session.": "No hay actividad de sincronización en esta sesión.",
	"No vaults found — first sync will create one":
		"No se encontraron bóvedas — la primera sincronización creará una",
	"Node.js dependencies": "Dependencias de Node.js",
	"Not configured": "No configurado",
	"Not connected yet. Click to open settings and link this vault.":
		"Aún no está conectado. Haz clic para abrir la configuración y vincular esta bóveda.",
	"Not connected. Enter your Engram server URL below to start syncing.":
		"No conectado. Introduce la URL de tu servidor de Engram para empezar a sincronizar.",
	"Not now": "No ahora",
	"Not signed in, or the session expired. Sign in again in Engram settings.":
		"No has iniciado sesión, o la sesión ha expirado. Inicia sesión de nuevo en la configuración de Engram.",
	"Not signed in. Click to open settings and reconnect.":
		"No has iniciado sesión. Haz clic para abrir la configuración y volver a conectar.",
	"Not synced on your plan ({count})": "No se sincroniza en tu plan ({count})",
	"Note couldn't be processed": "No se pudo procesar la nota",
	"Note limit reached. Upgrade to keep adding notes.":
		"Se ha alcanzado el límite de notas. Actualiza para seguir añadiendo notas.",
	"Note not synced locally": "Nota no sincronizada localmente",
	"Notes on this device": "Notas en este dispositivo",
	"Notes past this still sync and open normally, they are just not in the search index. The index keeps your oldest notes, so it is your newest ones that fall outside.":
		"Las notas posteriores a esta fecha se sincronizan y se abren normalmente, pero no están en el índice de búsqueda. El índice guarda tus notas más antiguas, por lo que las más recientes quedan fuera.",
	"Notes searchable": "Notas indexadas para búsqueda",
	"Notes stored": "Notas almacenadas",
	"Nothing in this vault syncs until you choose how to merge it with the server.":
		"Nada de esta bóveda se sincroniza hasta que elijas cómo fusionarla con el servidor.",
	"Nothing is deleted.": "Nada se elimina.",
	"Nothing needs your attention. 🎉": "No hay nada que requiera tu atención. 🎉",
	"Nothing to sync yet — this vault is empty on both sides. Start syncing and everything you write appears on your other devices.":
		"Aún no hay nada que sincronizar: esta bóveda está vacía en ambos lados. Empieza a sincronizar y todo lo que escribas aparecerá en tus otros dispositivos.",
	"Nothing will be deleted.": "Nada se borrará.",
	"Nothing will be removed from this device.": "Nada se eliminará de este dispositivo.",
	Open: "Abrir",
	"Open Connection": "Abrir conexión",
	"Open Engram": "Abrir Engram",
	"Open Engram settings": "Abrir la configuración de Engram",
	"Open Engram to check your vault and confirm everything synced.":
		"Abre Engram para revisar tu bóveda y confirmar que todo se sincronizó.",
	"Open connection tab": "Abrir pestaña de conexión",
	"Open note": "Abrir nota",
	"Open search sidebar": "Abrir la barra lateral de búsqueda",
	"Open sync center": "Abrir el Centro de sincronización",
	"Open sync setup": "Abrir configuración de sincronización",
	"Open the file to resolve the conflict, then sync again.":
		"Abre el archivo para resolver el conflicto, luego sincroniza de nuevo.",
	"Opens your browser to sign in, or create an account if you don't have one yet, then links this vault.":
		"Abre tu navegador para iniciar sesión o crear una cuenta si no la tienes, y luego vincula esta bóveda.",
	"Or authenticate with a token instead of signing in.":
		"O autentícate con un token en lugar de iniciar sesión.",
	"Or authenticate with a token instead of signing in. Engram Cloud API keys require the Pro plan; on Free and Starter, sign in above.":
		"O autentícate con un token en lugar de iniciar sesión. Las claves API de Engram requieren el plan Pro; en Free y Starter, inicia sesión arriba.",
	"Paths to skip (one per line). Folder patterns end with /. Built-in: {configDir}/, .trash/, .git/":
		"Rutas a omitir (una por línea). Los patrones de carpeta terminan con /. Incorporados: {configDir}/, .trash/, .git/",
	"Pick a vault": "Elige una bóveda",
	"Pick a vault (previous: '{name}' not found)":
		"Elige una bóveda (anterior: '{name}' no encontrado)",
	"Pick a vault (previous: id {id} not found)":
		"Elige una bóveda (anterior: id {id} no encontrado)",
	"Pick a vault to sync with. We will recalculate the sync preview after you choose.":
		"Elige una bóveda para sincronizar. Recalcularemos la vista previa de la sincronización después de que la elijas.",
	"Plan usage": "Uso del plan",
	Plans: "Planes",
	"Privacy Policy": "Política de privacidad",
	Pro: "Pro",
	"Pull all (delete extras) aborted: could not obtain an exclusive server snapshot (replay contention). Nothing was trashed.":
		"La descarga de todo (eliminando duplicados) se canceló: no se pudo obtener una instantánea exclusiva del servidor (conflicto de reescritura). Nada se eliminó.",
	"Pull all aborted: another sync is running (replay contention). Try again when it finishes.":
		"La descarga de todo se canceló: otra sincronización está en curso (conflicto de reescritura). Inténtalo de nuevo cuando termine.",
	"Pull all failed: {error}": "La descarga de todo falló: {error}",
	"Pull all from server (force overwrite)": "Descargar todo desde el servidor (sobrescribir)",
	Pulled: "Recibido",
	"Push entire vault": "Enviar toda la bóveda",
	Pushed: "Enviado",
	"Python bytecode cache": "Caché de bytecode de Python",
	"Python virtual environment": "Entorno virtual de Python",
	"Read it": "Léelo",
	"Real-time sync": "Sincronización en tiempo real",
	"Reconnect your account to resume syncing.":
		"Vuelve a conectar tu cuenta para reanudar la sincronización.",
	Refresh: "Actualizar",
	"Remote vault": "Bóveda remota",
	"Remove tag {tag}": "Eliminar etiqueta {tag}",
	"Report an issue": "Reportar un problema",
	"Report an issue on GitHub": "Reporta un problema en GitHub",
	"Request failed ({status})": "La solicitud falló ({status})",
	Restore: "Restaurar",
	"Restored {path} — will sync on next push.":
		"Restaurado {path} — se sincronizará en el próximo envío.",
	"Retry all now": "Reintentar todo ahora",
	"Retrying automatically ({count})": "Reintentando automáticamente ({count})",
	"Review and accept": "Revisar y aceptar",
	"Run in background": "Ejecutar en segundo plano",
	"Run your own Engram server": "Ejecuta tu propio servidor de Engram",
	"Rust/Java build output": "Salida de compilación de Rust/Java",
	"Safe choice: combines both sides, nothing is deleted.":
		"Opción segura: combina ambos lados, nada se elimina.",
	Save: "Guardar",
	"Search across all vaults at once": "Busca en todas las bóvedas a la vez",
	"Search all your notes": "Busca todas tus notas",
	"Search failed — check connection": "Búsqueda fallida — verifica la conexión",
	"Search settings": "Configuración de búsqueda",
	"Search your vault…": "Busca en tu bóveda…",
	"Searching {indexed} of {all} notes. Upgrade to search everything.":
		"Buscando {indexed} de {all} notas. Actualiza para buscar todo.",
	"See full pricing": "Ver precios completos",
	"See the AI setup guide": "Consulta la guía de configuración de la IA",
	"Select which vault this plugin syncs with.":
		"Selecciona la bóveda con la que este plugin se sincroniza.",
	"Self-hosted": "Autohospedado",
	Semantic: "Semántica",
	"Semantic search": "Búsqueda semántica",
	Send: "Enviar",
	"Send debug logs. Note content stays private.":
		"Enviar registros de depuración. El contenido de las notas se mantiene privado.",
	"Send detailed sync, vault, and connection activity to the server for troubleshooting, with distributed tracing on requests. Metadata only, never note content. Leave off for normal use.":
		"Envía información detallada de la sincronización, la bóveda y la conexión al servidor para solucionar problemas, con trazado distribuido en las solicitudes. Solo metadatos, nunca contenido de las notas. Desactiva para uso normal.",
	"Send feedback": "Enviar comentarios",
	"Sending…": "Enviando…",
	"Server error": "Error del servidor",
	"Server error ({status}) — check Engram logs":
		"Error del servidor ({status}) — revisa los registros de Engram",
	"Server unreachable — changes will sync when connected":
		"Servidor inaccesible — los cambios se sincronizarán al conectarse",
	"Set up sync for this vault": "Configura la sincronización para esta bóveda",
	"Setup is not finished — nothing will sync until you choose a sync direction. Click to finish.":
		"La configuración no está finalizada; nada se sincronizará hasta que elijas una dirección de sincronización. Haz clic para finalizar.",
	"Show files ({count}) ▾": "Mostrar archivos ({count}) ▾",
	"Show sync log": "Mostrar registro de sincronización",
	"Showing {count} entries": {
		one: "Mostrando {count} entrada",
		many: "Mostrando {count} entradas",
		other: "Mostrando {count} entradas",
	},
	"Sign in": "Iniciar sesión",
	"Sign in (or enter your server URL and key) on the connection tab, then run your first sync.":
		"Inicia sesión (o introduce la URL de tu servidor y la clave) en la pestaña de conexión, y luego realiza tu primera sincronización.",
	"Sign in or create an account": "Inicia sesión o crea una cuenta",
	"Sign out": "Cerrar sesión",
	"Sign-in expired": "Sesión expirada",
	"Sign-in required to load vaults": "Inicio de sesión requerido para cargar las bóvedas",
	"Signed in as {email}": "Iniciado sesión como {email}",
	Skipped: "Omitido",
	"Source: {link}": "Origen: {link}",
	"Start syncing": "Empezar la sincronización",
	Starter: "Starter",
	"Starting...": "Iniciando...",
	Stats: "Estadísticas",
	"Support development": "Apoya el desarrollo",
	"Switch to sign in": "Cambiar a iniciar sesión",
	"Switch vault": "Cambiar bóveda",
	"Switched to {mode}.": "Cambiado a {mode}.",
	Sync: "Sincronizar",
	"Sync complete": "Sincronización completa",
	"Sync failed": "Sincronización fallida",
	"Sync in progress...": "Sincronización en curso...",
	"Sync log": "Registro de sincronización",
	"Sync now": "Sincronizar ahora",
	"Sync paused — click to choose a sync direction":
		"Sincronización pausada — haz clic para elegir la dirección de la sincronización",
	"Sync preview": "Vista previa de la sincronización",
	"Sync these now": "Sincronizar ahora",
	"Sync...": "Sincronizando...",
	"Synced. Some attachments need a paid plan to sync (see below).":
		"Sincronizado. Algunos adjuntos requieren un plan de pago para sincronizarse (ver abajo).",
	"Syncing attachments": "Sincronizando adjuntos",
	"Syncing your vault": "Sincronizando tu bóveda",
	"Syncing...": "Sincronizando...",
	"Syncing…": "Sincronizando…",
	"Tell us anything": "Cuéntanos cualquier cosa",
	"Temporary errors. These clear themselves once the server recovers.":
		"Errores temporales. Se resolverán automáticamente cuando el servidor se recupere.",
	"Terms of Service": "Términos del servicio",
	"Thanks, we read every message.": "Gracias, leemos cada mensaje.",
	"That does not look like a complete server address. Include the scheme, for example http://127.0.0.1:4000":
		"Eso no parece una dirección de servidor completa. Incluye el esquema, por ejemplo http://127.0.0.1:4000",
	"That does not look like an Engram API key (expected {prefix}…).":
		"Eso no parece una clave API de Engram (se espera {prefix}…).",
	"The Free tier syncs notes only. Upgrade to sync images and PDFs.":
		"El plan gratuito sincroniza solo notas. Actualiza para sincronizar imágenes y PDFs.",
	"The file is too large for the server.": "El archivo es demasiado grande para el servidor.",
	"The note synced, but its frontmatter could not be fully parsed. Open it to fix the highlighted line.":
		"La nota se sincronizó, pero no se pudo analizar completamente su frontmatter. Ábrela para corregir la línea resaltada.",
	"The server couldn't process this note. Check its contents, then edit and save to try again.":
		"El servidor no pudo procesar esta nota. Revisa su contenido, luego edita y guarda para intentarlo de nuevo.",
	"The server limit is 5 MB. Compress or split the file, then it will sync.":
		"El límite del servidor es de 5 MB. Comprime o divide el archivo, luego se sincronizará.",
	"The server took too long to respond. Try again.":
		"El servidor tardó demasiado en responder. Inténtalo de nuevo.",
	"These files are fine. They just need a paid plan to sync.":
		"Estos archivos están bien. Solo necesitan un plan de pago para sincronizarse.",
	"This account was deleted. Contact support if that is wrong.":
		"Esta cuenta fue eliminada. Contacta con soporte si es incorrecto.",
	"This cannot be undone.": "Esto no se puede deshacer.",
	"This device's vault is empty. Download {what} from the server?":
		"La bóveda de este dispositivo está vacía. ¿Descargar {what} del servidor?",
	"This file type isn't accepted by this server.":
		"Este tipo de archivo no es aceptado por este servidor.",
	"This note could not be processed and was skipped.":
		"Esta nota no se pudo procesar y se omitió.",
	"This server is self-hosted, so feedback is not collected here. ":
		"Este servidor es autohospedado, por lo que los comentarios no se recopilan aquí. ",
	"This vault": "Esta bóveda",
	"This vault is empty on the server. Upload your {what}?":
		"Esta bóveda está vacía en el servidor. ¿Quieres subir tus {what}?",
	Token: "Token",
	"Too large for the server": "Demasiado grande para el servidor",
	"Too many connected AI clients. Disconnect one or upgrade.":
		"Demasiados clientes de IA conectados. Desconecta uno o actualiza.",
	"Too many connected Obsidian vaults. Disconnect one or upgrade.":
		"Demasiadas bóvedas de Obsidian conectadas. Desconecta una o actualiza.",
	"Too many requests. Wait a moment and try again.":
		"Demasiadas solicitudes. Espera un momento e inténtalo de nuevo.",
	"Try again": "Intentar de nuevo",
	"Type {keyword} to confirm:": "Escribe {keyword} para confirmar:",
	"Unknown error": "Error desconocido",
	"Unlimited AI searches": "Búsquedas ilimitadas con IA",
	"Unlimited vaults": "Bóvedas ilimitadas",
	"Unresolved conflict": "Conflicto sin resolver",
	Untitled: "Sin título",
	Update: "Actualizar",
	"Update in settings": "Actualizar en la configuración",
	Upgrade: "Actualizar",
	"Upload everything": "Subir todo",
	"Upload local files without downloading the remote":
		"Sube archivos locales sin descargar los remotos",
	"Upload {count} files from this vault": {
		one: "Subir {count} archivo de esta bóveda",
		many: "Cargar {count} archivos de esta bóveda",
		other: "Cargar {count} archivos de esta bóveda",
	},
	Uploading: "Subiendo",
	"Uploading {count}.": {
		one: "Subiendo {count}.",
		many: "Subiendo {count}.",
		other: "Subiendo {count}.",
	},
	"Uploads {count}.": {
		one: "Subidas {count}.",
		many: "Subidas {count}.",
		other: "Subidas {count}.",
	},
	"Uploads {up}, downloads {down}.": "Subidas {up}, descargas {down}.",
	"Using API key": "Usando clave API",
	Vault: "Bóveda",
	"Vault ID: {id}": "ID de la bóveda: {id}",
	"Vault limit reached. Upgrade for more vaults.":
		"Se ha alcanzado el límite de bóvedas. Actualiza para tener más bóvedas.",
	"Vault name": "Nombre de la bóveda",
	"Vault selection": "Selección de bóveda",
	"Vendored dependencies": "Dependencias incluidas",
	"Version: {version}": "Versión: {version}",
	"Waiting for authorization — connected, this will complete instantly.":
		"Esperando autorización — conectado, esto se completará al instante.",
	"Waiting for authorization — no live connection, checking every 30s.":
		"Esperando autorización — sin conexión activa, verificando cada 30 segundos.",
	"Warnings and errors": "Advertencias y errores",
	"WebSocket connected — live sync active": "WebSocket conectado — sincronización en vivo activa",
	"What Engram does, and how to connect your vault, start to finish.":
		"¿Qué hace Engram y cómo conectar tu bóveda, de principio a fin.",
	"What kind of feedback?": "¿Qué tipo de comentario?",
	"What's working, what's frustrating, what do you wish Engram did?":
		"¿Qué funciona, qué frustra, qué te gustaría que Engram hiciera?",
	"Where this vault syncs to. Each backend keeps its own sign-in.":
		"Dónde se sincroniza esta bóveda. Cada servidor tiene su propio inicio de sesión.",
	"You are about to:": "Estás a punto de:",
	"You are now pointing at a different cloud vault":
		"Ahora estás apuntando a una bóveda en la nube diferente",
	"You can close this and the sync keeps running in the background.":
		"Puedes cerrar esto y la sincronización continúa en segundo plano.",
	"You've used all the attachment storage on your plan. Upgrade for more.":
		"Has utilizado todo el almacenamiento de adjuntos de tu plan. Actualiza para obtener más.",
	"Your code:": "Tu código:",
	"Your feedback": "Tu opinión",
	"Your login expired. Sign in again in Engram settings to continue.":
		"Tu sesión ha expirado. Inicia sesión de nuevo en la configuración de Engram para continuar.",
	"Your vault shares {percent} of its data with Engram":
		"Tu bóveda comparte {percent} de sus datos con Engram",
	attachments: "adjuntos",
	exact: "exacto",
	files: "archivos",
	folders: "carpetas",
	"match strength: {pct}%": "nivel de coincidencia: {pct}%",
	"matches meaning. Finds notes that never use the words you typed.":
		"coincide con el significado. Encuentra notas que nunca usan las palabras que escribiste.",
	"matches words and meaning together, plus this device. Widest results.":
		"coincide con las palabras y el significado, además de este dispositivo. Resultados más amplios.",
	"matches your words and their other forms — 'run' finds 'running' — plus this device.":
		"coincide con tus palabras y sus otras formas — 'run' encuentra 'running' — además de este dispositivo.",
	meaning: "significado",
	"meaning + exact": "significado + exacto",
	"not linked": "no enlazada",
	notes: "notas",
	"setup guide": "guía de configuración",
	"sync is paused": "la sincronización está pausada",
	"syncing now": "sincronizando ahora",
	unknown: "desconocido",
	"waiting for a connection": "esperando conexión",
	"waiting to retry": "esperando reintentar",
	"{count} attachments": {
		one: "{count} adjunto",
		many: "{count} adjuntos",
		other: "{count} adjuntos",
	},
	"{count} attachments need a paid plan to sync. See Sync Center.": {
		one: "{count} adjunto necesita un plan de pago para sincronizarse. Consulta el Centro de sincronización.",
		many: "{count} Los adjuntos requieren un plan de pago para sincronizarse. Consulta el Centro de sincronización.",
		other: "{count} adjuntos necesitan un plan de pago para sincronizarse. Consulta el Centro de sincronización.",
	},
	"{count} attempts": {
		one: "{count} intento",
		many: "{count} intentos",
		other: "{count} intentos",
	},
	"{count} conflicts need resolution": {
		one: "{count} conflicto necesita solución",
		many: "{count} conflictos que requieren solución",
		other: "{count} conflictos que resolver",
	},
	"{count} conflicts to resolve.": {
		one: "{count} conflicto a resolver.",
		many: "{count} conflictos a resolver.",
		other: "{count} conflictos a resolver.",
	},
	"{count} diverged": {
		one: "{count} divergente",
		many: "{count} divergido",
		other: "{count} divergieron",
	},
	'{count} failed. Run "{command}" for details.': {
		one: '{count} fallido. Ejecuta "{command}" para más detalles.',
		many: '{count} fallido. Ejecuta "{command}" para más detalles.',
		other: '{count} fallidos. Ejecuta "{command}" para más detalles.',
	},
	"{count} files": {
		one: "{count} archivo",
		many: "{count} archivos",
		other: "{count} archivos",
	},
	"{count} files queued": {
		one: "{count} archivo en cola",
		many: "{count} archivos en cola",
		other: "{count} archivos en cola",
	},
	"{count} ignored": {
		one: "{count} ignorado",
		many: "{count} ignorados",
		other: "{count} patrones ignorados",
	},
	"{count} missing on server": {
		one: "{count} faltante en el servidor",
		many: "{count} no disponible en el servidor",
		other: "{count} faltantes en el servidor",
	},
	"{count} need attention": {
		one: "{count} necesita atención",
		many: "{count} necesita atención",
		other: "{count} requieren atención",
	},
	"{count} not on your plan": {
		one: "{count} no incluido en tu plan",
		many: "{count} no está en tu plan",
		other: "{count} no incluidos en tu plan",
	},
	"{count} notes": { one: "{count} nota", many: "{count} notas", other: "{count} notas" },
	"{count} only on server": {
		one: "{count} solo en el servidor",
		many: "{count} solo en servidor",
		other: "{count} solo en el servidor",
	},
	"{count} queued — {reason}": {
		one: "{count} en cola — {reason}",
		many: "{count} en cola — {reason}",
		other: "{count} en cola — {reason}",
	},
	"{count} retrying": {
		one: "{count} reintentando",
		many: "{count} reintentando",
		other: "{count} reintentando",
	},
	"{desc} — should not be synced": "{desc} — no debe sincronizarse",
	"{first} and {second}": "{first} y {second}",
	"{formatted} per day": "{formatted} por día",
	"{label} ({count} queued)": {
		one: "{label} ({count} en cola)",
		many: "{label} ({count} en cola)",
		other: "{label} ({count} en cola)",
	},
	"{n} of 5": "{n} de 5",
	"▶ Watch on YouTube": "▶ Ver en YouTube",
	"⚙️ Advanced": "⚙️ Avanzado",
	"⚠ Detected: {label}/ ({formatted} files)": "⚠ Detectado: {label} / ({formatted} archivos)",
	"✓ Engram server reachable (v{version})": "✓ Servidor de Engram accesible (v{version})",
	"✓ {count} synced": {
		one: "✓ {count} bóveda sincronizada",
		many: "✓ {count} sincronizado",
		other: "✓ {count} sincronizados",
	},
	"✕ {count} failed": {
		one: "✕ {count} fallido",
		many: "✕ {count} fallido",
		other: "✕ {count} fallidos",
	},
	"✗ couldn't reach a server at this URL": "✗ No se pudo acceder a un servidor en esta URL",
	"✗ server responded but isn't an Engram backend":
		"✗ El servidor respondió, pero no es un servidor de Engram",
	"⤳ {count} skipped (Free plan)": {
		one: "⤳ {count} omitido (Plan gratuito)",
		many: "⤳ {count} omitido (Plan gratuito)",
		other: "⤳ {count} omitidos (Plan gratuito)",
	},
	"👋 Welcome": "👋 Bienvenido/a",
	"💬 Feedback": "💬 Comentarios",
	"🔄 Sync Center": "🔄 Centro de sincronización",
	"🔌 Connection": "🔌 Conexión",
};

export default es;
