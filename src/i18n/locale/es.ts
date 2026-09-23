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
	// UI strings
	"Link Obsidian to Engram": "Conectar Obsidian con Engram",
	"Failed to start device flow. Check your Engram URL and try again.":
		"No se pudo iniciar la vinculación del dispositivo. Revisa la dirección de tu Engram e inténtalo de nuevo.",
	"Your code:": "Tu código:",
	"A browser window has opened. Sign in and enter this code to link your vault.":
		"Se ha abierto una ventana del navegador. Inicia sesión e introduce este código para vincular tu bóveda.",
	Cancel: "Cancelar",
	"Code expired. Please try again.": "El código ha caducado. Inténtalo de nuevo.",
	"Try again": "Reintentar",
	Close: "Cerrar",
	"Note couldn't be processed": "No se pudo procesar esta nota",
	"The server couldn't process this note. Check its contents, then edit and save to try again.":
		"El servidor no pudo procesar esta nota. Revisa su contenido, edítala y guárdala para reintentar.",
	"Attachments need a paid plan": "Los adjuntos requieren un plan de pago",
	"The Free tier syncs notes only. Upgrade to sync images and PDFs.":
		"El plan gratuito solo sincroniza notas. Mejora tu plan para sincronizar imágenes y PDF.",
	"Attachment storage full": "Almacenamiento de adjuntos lleno",
	"You've used all the attachment storage on your plan. Upgrade for more.":
		"Has usado todo el almacenamiento de adjuntos de tu plan. Mejóralo para tener más.",
	"Too large for the server": "Demasiado grande para el servidor",
	"The server limit is 5 MB. Compress or split the file, then it will sync.":
		"El límite del servidor es de 5 MB. Comprime o divide el archivo y se sincronizará.",
	"Sign-in expired": "La sesión ha caducado",
	"Reconnect your account to resume syncing.":
		"Vuelve a conectar tu cuenta para reanudar la sincronización.",
	"Unresolved conflict": "Conflicto sin resolver",
	"Open the file to resolve the conflict, then sync again.":
		"Abre el archivo, resuelve el conflicto y sincroniza otra vez.",
	"Frontmatter needs a fix": "Hay que arreglar el frontmatter",
	"The note synced, but its frontmatter could not be fully parsed. Open it to fix the highlighted line.":
		"La nota se sincronizó, pero su frontmatter no se pudo leer del todo. Ábrela y corrige la línea marcada.",
	"Server error": "Error del servidor",
	"A temporary server problem — retrying automatically.":
		"Un problema temporal del servidor; se reintenta automáticamente.",
	"Network unavailable": "Sin red",
	"Can't reach the server — retrying automatically.":
		"No se llega al servidor; se reintenta automáticamente.",
	"Sync failed": "La sincronización falló",
	"An unexpected error — retrying automatically.":
		"Un error inesperado; se reintenta automáticamente.",
	Upgrade: "Mejorar plan",
	"Update in settings": "Actualizar en los ajustes",
	"Engram: ready": "Engram: listo",
	"Resume sync": "Reanudar la sincronización",
	"Engram Vault Sync {version} is available. {link}.":
		"Engram Vault Sync {version} ya está disponible. {link}.",
	"Search your vault…": "Busca en tu bóveda…",
	"Filter by folder…": "Filtrar por carpeta…",
	"Filter by tags…": "Filtrar por etiquetas…",
	"Search failed — check connection": "La búsqueda falló, revisa la conexión",
	"No results found": "Sin resultados",
	"match strength: {pct}%": "Coincidencia: {pct}%",
	"Open sync setup": "Abrir la configuración de sincronización",
	"Last sync: {when}": "Última sincronización: {when}",
	"waiting for a connection": "esperando conexión",
	"sync is paused": "la sincronización está en pausa",
	"syncing now": "sincronizando ahora",
	"waiting to retry": "esperando para reintentar",
	"{count} not on your plan": "{count} fuera de tu plan",
	"{count} retrying": "{count} reintentándose",
	"{count} ignored": "{count} ignorados",
	"{count} queued — {reason}": "{count} en cola, {reason}",
	"These files are fine. They just need a paid plan to sync.":
		"Estos archivos están bien. Solo necesitan un plan de pago para sincronizarse.",
	"Show files ({count}) ▾": "Mostrar archivos ({count}) ▾",
	"Sync these now": "Sincronizar estos ahora",
	"Clear all": "Borrar todo",
	"Nothing needs your attention. 🎉": "No hay nada que requiera tu atención. 🎉",
	Dismiss: "Ocultar",
	"Retry all now": "Reintentar todo ahora",
	"Temporary errors. These clear themselves once the server recovers.":
		"Errores temporales. Se resuelven solos cuando el servidor se recupera.",
	Open: "Abrir",
	Ignore: "Ignorar",
	"No files ignored. Use the ignore button on a failure row to stop syncing it.":
		"No hay archivos ignorados. Usa el botón de ignorar en una fila con error para dejar de sincronizarlo.",
	Restore: "Restaurar",
	Clear: "Borrar",
	"No activity yet. Push or pull to see entries here.":
		"Aún no hay actividad. Sube o descarga y aquí verás entradas.",
	"Sync log": "Registro de sincronización",
	"Could not compare with the cloud. Check your connection.":
		"No se pudo comparar con el servidor. Revisa tu conexión.",
	"Your login expired. Sign in again in Engram settings to continue.":
		"Tu sesión ha caducado. Vuelve a iniciar sesión en Engram settings para continuar.",
	"Couldn't create vault — the name may be invalid or already in use.":
		"No se pudo crear la bóveda: el nombre puede no ser válido o ya estar en uso.",
	"Could not create the vault — check your connection and try again.":
		"No se pudo crear la bóveda; revisa tu conexión e inténtalo de nuevo.",
	"Free syncs notes only — {count} attachments will be skipped.": {
		one: "El plan gratuito solo sincroniza notas; se omitirá {count} adjunto.",
		other: "El plan gratuito solo sincroniza notas; se omitirán {count} adjuntos.",
	},
	"Comparing your vault with the cloud…": "Comparando tu bóveda con el servidor…",
	"Change vault": "Cambiar de bóveda",
	"Advanced sync options": "Opciones avanzadas de sincronización",
	"Everything is in sync": "Todo está sincronizado",
	" conflicts need resolution": {
		one: " conflicto por resolver",
		other: " conflictos por resolver",
	},
	"Confirm destructive sync": "Confirmar una sincronización destructiva",
	"You are about to:": "Esto es lo que va a pasar:",
	"Files that will be deleted:": "Archivos que se eliminarán:",
	"This cannot be undone.": "Esto no se puede deshacer.",
	Back: "Atrás",
	Confirm: "Confirmar",
	"Switch vault": "Cambiar de bóveda",
	"Pick a vault to sync with. We will recalculate the sync preview after you choose.":
		"Elige la bóveda con la que sincronizar. Después recalcularemos la vista previa.",
	"Loading vaults…": "Cargando bóvedas…",
	"No other vaults available.": "No hay otras bóvedas disponibles.",
	"Make new vault": "Crear una bóveda",
	"New vault": "Bóveda nueva",
	"Create a new empty vault on the server, then sync this Obsidian vault into it.":
		"Crear una bóveda vacía en el servidor y luego sincronizar esta bóveda de Obsidian con ella.",
	Create: "Crear",
	"Your vault shares {percent} of its data with Engram":
		"Tu bóveda comparte el {percent} de sus datos con Engram",
	"Type {keyword} to confirm:": "Escribe {keyword} para confirmar:",
	"✓ {count} synced": "✓ {count} sincronizados",
	"⤳ {count} skipped (Free plan)": "⤳ {count} omitidos (plan gratuito)",
	"✕ {count} failed": "✕ {count} con error",
	"{count} attachments need a paid plan to sync. See Sync Center.": {
		one: "{count} adjunto necesita un plan de pago. Mira el Sync Center.",
		other: "{count} adjuntos necesitan un plan de pago. Mira el Sync Center.",
	},
	"Syncing your vault": "Sincronizando tu bóveda",
	"Getting started…": "Empezando…",
	"Open Engram to check your vault and confirm everything synced.":
		"Abre Engram para revisar tu bóveda y confirmar que todo se sincronizó.",
	"Open Engram": "Abrir Engram",
	"You can close this and the sync keeps running in the background.":
		"Puedes cerrar esto y la sincronización sigue en segundo plano.",
	"Run in background": "Dejar en segundo plano",
	"Syncing…": "Sincronizando…",
	"Sync complete": "Sincronización completada",
	Done: "Hecho",
	"Engram: sync conflict on {path} — your local edit was saved as {copy}":
		"Engram: conflicto de sincronización en {path}; tu cambio local se guardó como {copy}",
	"Open note": "Abrir la nota",
	"Engram: {count} notes have frontmatter problems. Open Sync Center to fix.":
		"Engram: el frontmatter de {count} notas da problemas. Abre el Sync Center para arreglarlo.",
	"New here? Watch the setup video": "¿Primera vez? Mira el vídeo de instalación",
	"What Engram does, and how to connect your vault, start to finish.":
		"Qué hace Engram y cómo conectar tu bóveda, de principio a fin.",
	"▶ Watch on YouTube": "▶ Ver en YouTube",
	"1. Make an account": "1. Crea una cuenta",
	"2. Connect your vault to Engram": "2. Conecta tu bóveda con Engram",
	"Open connection tab": "Abrir la pestaña de conexión",
	"3. Connect your AI": "3. Conecta tu IA",
	"Node.js dependencies": "Dependencias de Node.js",
	"Python virtual environment": "Entorno virtual de Python",
	"Python bytecode cache": "Caché de bytecode de Python",
	"Vendored dependencies": "Dependencias incluidas",
	"Gradle build cache": "Caché de compilación de Gradle",
	"Rust/Java build output": "Salida de compilación de Rust/Java",
	"Build output": "Salida de compilación",
	"Next.js build output": "Salida de compilación de Next.js",
	"Distribution build output": "Salida de compilación para distribución",
	"Cargo cache": "Caché de Cargo",
	"CocoaPods dependencies": "Dependencias de CocoaPods",
	"Dart tool cache": "Caché de herramientas de Dart",
	"Generic cache directory": "Directorio de caché genérico",
	"Ignore patterns": "Patrones ignorados",
	"Custom patterns": "Patrones propios",
	Diagnostics: "Diagnóstico",
	"Diagnostics detail": "Detalle del diagnóstico",
	About: "Acerca de",
	"License: {name}": "Licencia: {name}",
	"⚠ Detected: {label}/ ({formatted} files)": "⚠ Detectado: {label}/ ({formatted} archivos)",
	"{desc} — should not be synced": "{desc}; no debería sincronizarse",
	"Add to ignores": "Añadir a ignorados",
	"Version: {version}": "Versión: {version}",
	"Source: {link}": "Código: {link}",
	"Engram URL": "Dirección de Engram",
	"✓ Engram server reachable (v{version})": "✓ Servidor Engram accesible (v{version})",
	"✗ server responded but isn't an Engram backend":
		"✗ El servidor responde, pero no es un backend de Engram",
	"✗ couldn't reach a server at this URL":
		"✗ No se pudo llegar a ningún servidor en esta dirección",
	"Checking server…": "Comprobando el servidor…",
	Authentication: "Autenticación",
	"Authenticated via Engram account (OAuth).": "Autenticado con tu cuenta de Engram (OAuth).",
	"Manage account": "Gestionar la cuenta",
	"Sign out": "Cerrar sesión",
	"Using API key": "Usando clave de API",
	"Authenticated via manual API key.": "Autenticado con una clave de API introducida a mano.",
	"Clear key": "Borrar la clave",
	"Switch to sign in": "Cambiar a iniciar sesión",
	"Sign in or create an account": "Inicia sesión o crea una cuenta",
	"Sign in": "Iniciar sesión",
	"API key": "Clave de API",
	Token: "Token",
	"Bearer token from your Engram account.": "Token Bearer de tu cuenta de Engram.",
	Save: "Guardar",
	"That does not look like an Engram API key (expected {prefix}…).":
		"Esto no parece una clave de API de Engram (se espera {prefix}…).",
	Vault: "Bóveda",
	"Vault selection": "Selección de bóveda",
	"Select which vault this plugin syncs with.": "Elige con qué bóveda sincroniza este plugin.",
	"No vaults found — first sync will create one":
		"No se han encontrado bóvedas; la primera sincronización creará una",
	"Pick a vault": "Elegir una bóveda",
	Change: "Cambiar",
	"Support development": "Apoyar el desarrollo",
	"GitHub Sponsors": "GitHub Sponsors",
	Backend: "Backend",
	"Where this vault syncs to. Each backend keeps its own sign-in.":
		"Dónde se sincroniza esta bóveda. Cada backend guarda su propia sesión.",
	"Run your own Engram server": "Usar tu propio servidor de Engram",
	"Engram is the backend that powers sync and semantic search.":
		"Engram es el backend que mueve la sincronización y la búsqueda semántica.",
	"Finish sync setup": "Terminar la configuración",
	"Nothing in this vault syncs until you choose how to merge it with the server.":
		"Esta bóveda no sincroniza nada hasta que elijas cómo combinarla con el servidor.",
	"Choose sync direction": "Elegir el sentido de la sincronización",
	"Engram: this plugin is too old to sync (needs {version} or newer). Update it to continue.":
		"Engram: este plugin es demasiado antiguo para sincronizar (hace falta {version} o posterior). Actualízalo para continuar.",
	"Engram: this plugin is too old to sync. Update it to continue.":
		"Engram: este plugin es demasiado antiguo para sincronizar. Actualízalo para continuar.",
	Update: "Actualizar",
	// UI strings (second pass)
	"Invalid API key": "Clave de API no válida",
	"Connection failed": "Fallo de conexión",
	"Sync now": "Sincronizar ahora",
	"Disconnect (clear login)": "Desconectar (borrar sesión)",
	"Push entire vault": "Subir toda la bóveda",
	"Check sync status": "Comprobar el estado de la sincronización",
	"Engram sync: server does not support reconciliation (update backend)":
		"Engram Sync: el servidor no sabe reconciliar (actualiza el backend)",
	"Pull all from server (force overwrite)": "Descargar todo del servidor (sobrescribe lo local)",
	"Show sync log": "Ver el registro de sincronización",
	"Semantic search": "Búsqueda semántica",
	"Open search sidebar": "Abrir el panel de búsqueda",
	"Engram search": "Búsqueda de Engram",
	"Open sync center": "Abrir el Sync Center",
	"Engram: this vault no longer exists on the server. Pick or create a vault to continue.":
		"Engram: esta bóveda ya no existe en el servidor. Elige o crea una bóveda para continuar.",
	"Engram: recovered plugin settings from a backup after a corrupted save.":
		"Engram: los ajustes estaban dañados y se han restaurado desde una copia.",
	"Engram sync: live sync requires a plugin update — please update the Engram vault sync plugin.":
		"Engram Sync: la sincronización en directo necesita actualizar el plugin. Actualiza Engram vault sync.",
	"Engram: sync is paused — this edit was not synced. Choose a sync direction to resume.":
		"Engram: la sincronización está en pausa y este cambio no se ha enviado. Elige un sentido para reanudar.",
	"Engram: not connected": "Engram: sin conexión",
	"Engram: signed out": "Engram: sesión cerrada",
	"Not connected yet. Click to open settings and link this vault.":
		"Aún sin conectar. Pulsa para abrir los ajustes y vincular esta bóveda.",
	"Not signed in. Click to open settings and reconnect.":
		"Sin iniciar sesión. Pulsa para abrir los ajustes y volver a conectar.",
	"Engram: finish setup": "Engram: terminar la configuración",
	"Engram: sync paused": "Engram: sincronización en pausa",
	"{label} ({count} queued)": "{label} ({count} en cola)",
	"Setup is not finished — nothing will sync until you choose a sync direction. Click to finish.":
		"La configuración no está terminada. Nada se sincroniza hasta que elijas un sentido. Pulsa para terminarla.",
	"Sync paused — click to choose a sync direction":
		"Sincronización en pausa; pulsa para elegir un sentido",
	"Engram: offline ({count} queued)": "Engram: sin red ({count} en cola)",
	"Engram: offline": "Engram: sin red",
	"Server unreachable — changes will sync when connected":
		"No se llega al servidor; los cambios se enviarán al volver la conexión",
	"Engram: error": "Engram: error",
	"Unknown error": "Error desconocido",
	"Engram: syncing ({count})": "Engram: sincronizando ({count})",
	"Engram: syncing": "Engram: sincronizando",
	"Sync in progress...": "Sincronizando…",
	"Engram: pending ({count})": "Engram: pendiente ({count})",
	"{count} files queued": "{count} archivos en cola",
	"Engram: live": "Engram: en directo",
	"WebSocket connected — live sync active":
		"WebSocket conectado; la sincronización en directo está activa",
	"Click to sync": "Pulsa para sincronizar",
	Attachments: "Adjuntos",
	Keyword: "Palabra clave",
	Semantic: "Semántica",
	Both: "Ambas",
	"matches your words and their other forms — 'run' finds 'running' — plus this device.":
		"Encuentra tus palabras y sus formas: «correr» también encuentra «corriendo», y además este dispositivo.",
	"matches meaning. Finds notes that never use the words you typed.":
		"Encuentra por significado, incluso notas donde tus palabras no aparecen nunca.",
	"matches words and meaning together, plus this device. Widest results.":
		"Encuentra palabras y significado a la vez, más este dispositivo. La búsqueda más amplia.",
	"Clear search": "Limpiar la búsqueda",
	"Search settings": "Ajustes de búsqueda",
	Untitled: "Sin título",
	"meaning + exact": "significado + exacto",
	Disconnected: "Desconectado",
	"Connected — waiting for first sync decision":
		"Conectado; esperando la primera decisión de sincronización",
	"Connected — live sync active": "Conectado; sincronización en directo activa",
	"Connected — polling": "Conectado; consultando cada cierto tiempo",
	"Not configured": "Sin configurar",
	Refresh: "Recargar",
	"Not synced on your plan ({count})": "Fuera de tu plan ({count})",
	"Needs attention ({count})": "Requiere tu atención ({count})",
	"Retrying automatically ({count})": "Reintentando automáticamente ({count})",
	Stats: "Cifras",
	"Notes on this device": "Notas en este dispositivo",
	"Attachments on this device": "Adjuntos en este dispositivo",
	"Remote vault": "Bóveda del servidor",
	"not linked": "sin vincular",
	"Plan usage": "Uso del plan",
	"Safe choice: combines both sides, nothing is deleted.":
		"Opción segura: combina los dos lados y no borra nada.",
	"Already in sync. Nothing is deleted.": "Ya está sincronizado. No se borra nada.",
	Sync: "Sincronizar",
	"Upload local files without downloading the remote":
		"Subir los archivos locales sin descargar del servidor",
	"Delete all on remote, then upload local files":
		"Borrar todo en el servidor y luego subir los archivos locales",
	"Download remote files without uploading the local":
		"Descargar los archivos del servidor sin subir los locales",
	"Delete all local files, then download from remote":
		"Borrar todos los archivos locales y luego descargar del servidor",
	"Set up sync for this vault": "Configurar la sincronización de esta bóveda",
	"You are now pointing at a different cloud vault": "Ahora apuntas a otra bóveda en la nube",
	"Sync preview": "Vista previa de la sincronización",
	"Start syncing": "Empezar a sincronizar",
	"Upload everything": "Subir todo",
	"Nothing will be removed from this device.": "No se quitará nada de este dispositivo.",
	"Download everything": "Descargar todo",
	"Not now": "Más tarde",
	"This vault": "Esta bóveda",
	"Cloud server": "Bóveda del servidor",
	"Vault name": "Nombre de la bóveda",
	"Could not load vaults": "No se pudieron cargar las bóvedas",
	"Enter a name for the new vault": "Ponle un nombre a la bóveda nueva",
	"Failed to switch vault": "No se pudo cambiar de bóveda",
	"Finished with some errors. Open the sync log to see what failed.":
		"Terminó con algunos errores. Mira el registro de sincronización para ver qué falló.",
	"Synced. Some attachments need a paid plan to sync (see below).":
		"Sincronizado. Algunos adjuntos necesitan un plan de pago (ver abajo).",
	"All synced. Your vault and the cloud now match.":
		"Todo sincronizado. Tu bóveda y la nube coinciden.",
	"Already up to date. Nothing needed syncing.":
		"Ya estaba al día. No había nada que sincronizar.",
	Deleting: "Borrando",
	Downloading: "Descargando",
	Uploading: "Subiendo",
	"Syncing attachments": "Sincronizando adjuntos",
	Complete: "Completado",
	"Getting set up": "Primeros pasos",
	"setup guide": "guía de instalación",
	"Sign in (or enter your server URL and key) on the connection tab, then run your first sync.":
		"Inicia sesión en la pestaña de conexión (o introduce la dirección de tu servidor y tu clave) y lanza tu primera sincronización.",
	"See the AI setup guide": "Ver la guía de configuración de IA",
	Plans: "Planes",
	Free: "Gratis",
	"1 vault, 2 devices": "1 bóveda, 2 dispositivos",
	"Real-time sync": "Sincronización en tiempo real",
	"2,000 notes searchable": "2.000 notas consultables",
	"Connect any AI (MCP)": "Conecta cualquier IA (MCP)",
	Starter: "Starter",
	"10 vaults, unlimited devices": "10 bóvedas, dispositivos ilimitados",
	"Search all your notes": "Busca en todas tus notas",
	"10 GB attachments": "10 GB de adjuntos",
	"Unlimited AI searches": "Búsquedas con IA ilimitadas",
	Pro: "Pro",
	"Unlimited vaults": "Bóvedas ilimitadas",
	"Search across all vaults at once": "Busca en todas las bóvedas a la vez",
	"50 GB attachments": "50 GB de adjuntos",
	"API access": "Acceso a la API",
	"See full pricing": "Ver todos los precios",
	"Learn more": "Saber más",
	"Errors only": "Solo errores",
	"Warnings and errors": "Avisos y errores",
	"Info (default)": "Información (predeterminado)",
	"Debug (verbose)": "Depuración (detallada)",
	"Or authenticate with a token instead of signing in.":
		"O autentícate con un token en lugar de iniciar sesión.",
	"If this plugin saves you time, consider supporting development.":
		"Si este plugin te ahorra tiempo, piensa en apoyar el desarrollo.",
	"Sign-in required to load vaults": "Hay que iniciar sesión para cargar las bóvedas",
	"Could not reach Engram — check connection": "No se llega a Engram; revisa la conexión",
	// UI strings (sync error surfaces)
	"Free syncs notes only — images & PDFs need a paid plan.":
		"El plan gratuito solo sincroniza notas: las imágenes y los PDF necesitan un plan de pago.",
	"Pull all (delete extras) aborted: could not obtain an exclusive server snapshot (replay contention). Nothing was trashed.":
		"«Descargar todo (borrar sobrantes)» cancelado: no se pudo obtener una instantánea exclusiva del servidor (conflicto de reproducción). No se ha enviado nada a la papelera.",
	"Pull all aborted: another sync is running (replay contention). Try again when it finishes.":
		"«Descargar todo» cancelado: hay otra sincronización en curso (conflicto de reproducción). Inténtalo cuando termine.",
	"Pull all failed: {error}": "«Descargar todo» falló: {error}",
	"Pull all failed": "«Descargar todo» falló",
	// UI strings (third pass)
	"Click to copy": "Haz clic para copiar",
	"Waiting for authorization — connected, this will complete instantly.":
		"Esperando la autorización: hay conexión, esto será inmediato.",
	"Waiting for authorization — no live connection, checking every 30s.":
		"Esperando la autorización: sin conexión en vivo, se comprueba cada 30 s.",
	'Engram Sync: sync state for "{name}" was unreadable — using the on-disk copy.':
		"Engram Sync: no se pudo leer el estado de sincronización de «{name}», se usará la copia del disco.",
	"{formatted} files · ": {
		one: "{formatted} archivo · ",
		other: "{formatted} archivos · ",
	},
	"Notes searchable": "Notas que se pueden buscar",
	"Notes past this still sync and open normally, they are just not in the search index. The index keeps your oldest notes, so it is your newest ones that fall outside.":
		"Las notas que pasen de aquí se siguen sincronizando y abriendo con normalidad, solo que no están en el índice de búsqueda. El índice guarda tus notas más antiguas, así que las que quedan fuera son las más nuevas.",
	"Notes stored": "Notas guardadas",
	"AI searches": "Búsquedas con IA",
	"{formatted} per day": "{formatted} al día",
	"Engram indexes {indexed} of your {all} notes. The rest match on this device only. Upgrade to index everything.":
		"Engram indexa {indexed} de tus {all} notas. El resto solo coincide en este dispositivo. Mejora tu plan para indexarlo todo.",
	"Searching {indexed} of {all} notes. Upgrade to search everything.":
		"Se buscan {indexed} de {all} notas. Mejora tu plan para buscar en todo.",
	"Remove tag {tag}": "Quitar la etiqueta {tag}",
	"👋 Welcome": "👋 Bienvenida",
	"🔌 Connection": "🔌 Conexión",
	"🔄 Sync Center": "🔄 Sync Center",
	"⚙️ Advanced": "⚙️ Avanzado",
	"Error: {error}": "Error: {error}",
	unknown: "desconocido",
	"{count} need attention": {
		one: "{count} necesita tu atención",
		other: "{count} necesitan tu atención",
	},
	"Uploads {up}, downloads {down}.": "Sube {up} y descarga {down}.",
	"Uploads {count}.": "Sube {count}.",
	"Downloads {count}.": "Descarga {count}.",
	"{count} conflicts to resolve.": {
		one: "{count} conflicto por resolver.",
		other: "{count} conflictos por resolver.",
	},
	"Nothing is deleted.": "No se borra nada.",
	"Delete all {count} files currently on the server": {
		one: "Borrar el {count} archivo que hay ahora en el servidor",
		other: "Borrar los {count} archivos que hay ahora en el servidor",
	},
	"Upload {count} files from this vault": {
		one: "Subir {count} archivo de esta bóveda",
		other: "Subir {count} archivos de esta bóveda",
	},
	"Delete all {count} files in this vault": {
		one: "Borrar el {count} archivo de esta bóveda",
		other: "Borrar los {count} archivos de esta bóveda",
	},
	"Download {count} files from the server": {
		one: "Descargar {count} archivo del servidor",
		other: "Descargar {count} archivos del servidor",
	},
	"Nothing to sync yet — this vault is empty on both sides. Start syncing and everything you write appears on your other devices.":
		"Todavía no hay nada que sincronizar, esta bóveda está vacía en los dos lados. Empieza a sincronizar y todo lo que escribas aparecerá en tus otros dispositivos.",
	"{count} notes": {
		one: "{count} nota",
		other: "{count} notas",
	},
	"{count} attachments": {
		one: "{count} adjunto",
		other: "{count} adjuntos",
	},
	"{first} and {second}": "{first} y {second}",
	files: "archivos",
	"This vault is empty on the server. Upload your {what}?":
		"Esta bóveda está vacía en el servidor. ¿Subir tus {what}?",
	"This device's vault is empty. Download {what} from the server?":
		"La bóveda de este dispositivo está vacía. ¿Descargar {what} del servidor?",
	notes: "notas",
	attachments: "adjuntos",
	folders: "carpetas",
	"Uploading {count}.": "Subiendo {count}.",
	"Downloading {count}.": "Descargando {count}.",
	"Deleting {count} local files.": "Borrando {count} archivos locales.",
	"Deleting {count} on the cloud.": "Borrando {count} en la nube.",
	"First sync, this may take a moment.": "Primera sincronización, puede tardar un momento.",
	"Checking for changes.": "Buscando cambios.",
	"Nothing will be deleted.": "No se borrará nada.",
	'{count} failed. Run "{command}" for details.':
		"{count} han fallado. Ejecuta «{command}» para ver los detalles.",
	'Engram Sync: renamed "{name}" (unsupported characters)':
		"Engram Sync: «{name}» se ha renombrado (caracteres no admitidos)",
	'Engram: frontmatter problem in "{name}"': "Engram: problema de frontmatter en «{name}»",
	"Create a hosted account at ": "Crea una cuenta alojada en ",
	", or self-host the backend (": ", o aloja tú el backend (",
	"Link Claude, Cursor, ChatGPT, or any MCP app so it can read and write your notes. ":
		"Conecta Claude, Cursor, ChatGPT o cualquier app MCP para que pueda leer y escribir tus notas. ",
	Documentation: "Documentación",
	"AI / MCP setup guide": "Guía de configuración de IA / MCP",
	"Report an issue": "Informar de un problema",
	"Join our Discord": "Únete a nuestro Discord",
	"Paths to skip (one per line). Folder patterns end with /. Built-in: {configDir}/, .trash/, .git/":
		"Rutas que saltar (una por línea). Los patrones de carpeta terminan en /. Integrados: {configDir}/, .trash/, .git/",
	"Send detailed sync, vault, and connection activity to the server for troubleshooting, with distributed tracing on requests. Metadata only, never note content. Leave off for normal use.":
		"Envía al servidor la actividad detallada de sincronización, bóveda y conexión para diagnóstico, con trazado distribuido de las peticiones. Solo metadatos, nunca el contenido de las notas. Déjalo apagado para el uso normal.",
	"Minimum severity that ships while diagnostics are on. Higher levels send fewer lines. Default: Info.":
		"Gravedad mínima que se envía mientras el diagnóstico está activo. Los niveles más altos envían menos líneas. Predeterminado: Información.",
	"Signed in as {email}": "Sesión iniciada como {email}",
	"Pick a vault (previous: '{name}' not found)":
		"Elige una bóveda (la anterior, «{name}», no se encuentra)",
	"Pick a vault (previous: id {id} not found)":
		"Elige una bóveda (el id anterior {id} no se encuentra)",
	"Server error ({status}) — check Engram logs":
		"Error del servidor ({status}), revisa los registros de Engram",
	"Request failed ({status})": "La petición ha fallado ({status})",
	"Engram Cloud": "Engram Cloud",
	"Self-hosted": "Autoalojado",
	"{count} attempts": {
		one: "{count} intento",
		other: "{count} intentos",
	},
	// UI strings (fourth pass)
	"{count} missing on server": {
		one: "falta {count} en el servidor",
		other: "faltan {count} en el servidor",
	},
	"{count} diverged": {
		one: "{count} ha divergido",
		other: "{count} han divergido",
	},
	"{count} only on server": "{count} solo en el servidor",
	"Engram Sync: {details}": "Engram Sync: {details}",
	"Engram: plugin settings file was corrupted and could not be recovered. You may need to reconnect in settings.":
		"Engram: el archivo de ajustes del plugin estaba dañado y no se pudo recuperar. Puede que tengas que volver a conectar desde los ajustes.",
	"Engram: sync is not set up yet, so nothing in this vault will sync.":
		"Engram: la sincronización aún no está configurada, así que nada de esta bóveda se sincronizará.",
	"Click the Engram item in the status bar to pick up where you left off.":
		"Haz clic en Engram en la barra de estado para seguir donde lo dejaste.",
	"Engram: ⚠ {count} sync errors": {
		one: "Engram: ⚠ {count} error de sincronización",
		other: "Engram: ⚠ {count} errores de sincronización",
	},
	"sync failed": "la sincronización ha fallado",
	"That does not look like a complete server address. Include the scheme, for example http://127.0.0.1:4000":
		"Esto no parece una dirección de servidor completa. Incluye el esquema, por ejemplo http://127.0.0.1:4000",
	"Opens your browser to sign in, or create an account if you don't have one yet, then links this vault.":
		"Abre tu navegador para iniciar sesión, o crear una cuenta si aún no tienes, y luego vincula esta bóveda.",
	"Or authenticate with a token instead of signing in. Engram Cloud API keys require the Pro plan; on Free and Starter, sign in above.":
		"O autentícate con un token en lugar de iniciar sesión. Las claves de API de Engram Cloud requieren el plan Pro; en Free y Starter, inicia sesión arriba.",
	"No sync activity this session.": "No hay actividad de sincronización en esta sesión.",
	"Showing {count} entries": {
		one: "Mostrando {count} entrada",
		other: "Mostrando {count} entradas",
	},
	"({count} errors)": {
		one: "({count} error)",
		other: "({count} errores)",
	},
	"Frontmatter could not be parsed": "No se pudo analizar el frontmatter",
	"Not connected. Enter your Engram server URL below to start syncing.":
		"Sin conexión. Escribe abajo la dirección de tu servidor Engram para empezar a sincronizar.",
	// UI strings (fifth pass)
	"Sync...": "Sincronizar...",
	"Syncing...": "Sincronizando...",
	" (default)": " (predeterminada)",

	// First-run diagnostics opt-in (#528)
	"Send debug logs. Note content stays private.":
		"Enviar registros de depuración. El contenido de las notas queda privado.",
};

export default es;
