import type { Dict } from "..";

// Русский
const ru: Dict = {
	"Invalid API key": "Неверный ключ API",
	"Connection failed": "Не удалось подключиться",
	"Link Obsidian to Engram": "Свяжите Obsidian с Engram",
	"Failed to start device flow. Check your Engram URL and try again.":
		"Не удалось запустить процесс аутентификации. Проверьте ваш URL Engram и попробуйте снова.",
	"Your code:": "Ваш код:",
	"Click to copy": "Нажмите, чтобы скопировать",
	"Code copied!": "Код скопирован!",
	"A browser window has opened. Sign in and enter this code to link your vault.":
		"Открыто окно браузера. Войдите и введите этот код, чтобы связать ваше хранилище.",
	Cancel: "Отменить",
	"Waiting for authorization — connected, this will complete instantly.":
		"Ожидание авторизации — подключено, процесс завершится мгновенно.",
	"Waiting for authorization — no live connection, checking every 30s.":
		"Ожидание авторизации — нет активного соединения, проверка каждые 30 секунд.",
	"Code expired. Please try again.": "Код устарел. Пожалуйста, попробуйте снова.",
	"Try again": "Повторить попытку",
	Close: "Закрыть",
	"Note couldn't be processed": "Заметку не удалось обработать",
	"The server couldn't process this note. Check its contents, then edit and save to try again.":
		"Сервер не смог обработать эту заметку. Проверьте её содержимое, затем отредактируйте и сохраните, чтобы повторить попытку.",
	"Attachments need a paid plan": "Вложения требуют платной подписки",
	"The Free tier syncs notes only. Upgrade to sync images and PDFs.":
		"Бесплатный тариф синхронизирует только заметки. Обновите подписку, чтобы синхронизировать изображения и PDF-файлы.",
	"Attachment storage full": "Место для хранения вложений заполнено",
	"You've used all the attachment storage on your plan. Upgrade for more.":
		"Вы использовали весь объём хранилища для вложений в рамках вашего тарифного плана. Обновите подписку для получения большего объёма.",
	"Too large for the server": "Слишком большой для сервера",
	"The server limit is 5 MB. Compress or split the file, then it will sync.":
		"Предел сервера составляет 5 МБ. Сжатие или разделение файла позволит выполнить синхронизацию.",
	"Sign-in expired": "Сеанс работы завершён",
	"Reconnect your account to resume syncing.":
		"Подключите учётную запись заново, чтобы продолжить синхронизацию.",
	"Unresolved conflict": "Неразрешенный конфликт",
	"Open the file to resolve the conflict, then sync again.":
		"Откройте файл для разрешения конфликта, затем синхронизируйте снова.",
	"Frontmatter needs a fix": "Необходимо исправить метаданные",
	"The note synced, but its frontmatter could not be fully parsed. Open it to fix the highlighted line.":
		"Заметка синхронизирована, но метаданные не были полностью обработаны. Откройте её, чтобы исправить выделенную строку.",
	"Server error": "Ошибка сервера",
	"A temporary server problem — retrying automatically.":
		"Временная проблема с сервером — повторная попытка.",
	"Network unavailable": "Сеть недоступна",
	"Can't reach the server — retrying automatically.":
		"Не удается связаться с сервером — повторная попытка.",
	"Sync failed": "Синхронизация не удалась",
	"An unexpected error — retrying automatically.": "Неожиданная ошибка — повторная попытка.",
	"Frontmatter could not be parsed": "Не удалось обработать метаданные",
	"Note limit reached. Upgrade to keep adding notes.":
		"Достигнут лимит заметок. Обновите подписку, чтобы добавлять больше заметок.",
	"Vault limit reached. Upgrade for more vaults.":
		"Достигнут лимит хранилищ. Обновите подписку, чтобы использовать больше хранилищ.",
	"This file type isn't accepted by this server.": "Этот тип файла не принимается этим сервером.",
	"Attachment sync is disabled for this account.":
		"Синхронизация вложений отключена для этой учётной записи.",
	"Attachment storage is full — upgrade for more.":
		"Место для хранения вложений заполнено — обновите тариф для увеличения.",
	"File too large for your plan.": "Файл слишком большой для вашего тарифа.",
	"Already signed in on another device. Upgrade for multi-device.":
		"Вы уже вошли на другом устройстве. Обновите тариф для поддержки нескольких устройств.",
	"Device swap cooldown active. Wait or upgrade.":
		"Активен период ожидания при смене устройства. Подождите или обновите тариф.",
	"Too many connected Obsidian vaults. Disconnect one or upgrade.":
		"Подключено слишком много хранилищ Obsidian. Отключите одно или обновите тариф.",
	"Too many connected AI clients. Disconnect one or upgrade.":
		"Подключено слишком много клиентов ИИ. Отключите одного или обновите тариф.",
	"Daily AI search limit reached. Free includes 20 per day across Obsidian, the web app and MCP. Upgrade for unlimited.":
		"Достигнут дневной лимит поиска по ИИ. Бесплатный тариф включает 20 запросов в день для Obsidian, веб-приложения и MCP. Обновите тариф для неограниченного использования.",
	"API keys need Pro. Sign in with your Engram account instead.":
		"Ключи API доступны только в тарифном плане Pro. Войдите с использованием вашей учётной записи Engram.",
	"Account suspended. Contact support.":
		"Учётная запись приостановлена. Обратитесь в службу поддержки.",
	"Account setup incomplete.": "Настройка учётной записи не завершена.",
	"This account was deleted. Contact support if that is wrong.":
		"Эта учётная запись была удалена. Обратитесь в службу поддержки, если это не так.",
	"Finish setting up your account at app.engram.page to start syncing.":
		"Завершите настройку вашей учётной записи на app.engram.page, чтобы начать синхронизацию.",
	"Limit reached. Upgrade to continue.": "Достигнут лимит. Обновите подписку, чтобы продолжить.",
	Upgrade: "Обновить",
	"Update in settings": "Обновить в настройках",
	"Sync now": "Синхронизировать сейчас",
	"Engram sync: syncing...": "Синхронизация Engram: синхронизация...",
	"Engram Sync: pulled {pulled}, pushed {pushed}":
		"Синхронизация Engram: получено {pulled}, отправлено {pushed}",
	"Disconnect (clear login)": "Отключить (очистить данные для входа)",
	"Engram: disconnected. Open Engram settings to reconnect.":
		"Engram: отключено. Откройте настройки Engram, чтобы подключиться снова.",
	"Push entire vault": "Отправить всё хранилище",
	"Engram Sync: pushed {count} files": {
		one: "Engram Sync: отправлено {count} файл",
		few: "Engram Sync: отправлено {count} файла",
		many: "Engram Sync: отправлено {count} файлов",
		other: "Engram Sync: отправлено {count} файлов",
	},
	"Check sync status": "Проверить статус синхронизации",
	"Engram sync: checking...": "Синхронизация Engram: проверка...",
	"Engram sync: server does not support reconciliation (update backend)":
		"Синхронизация с Engram: сервер не поддерживает исправление (обновить бэкенд)",
	"Engram sync: everything in sync": "Синхронизация с Engram: всё синхронизировано",
	"{count} missing on server": "{count} отсутствует на сервере",
	"{count} diverged": "{count} различается",
	"{count} only on server": "{count} только на сервере",
	"Engram Sync: {details}": "Синхронизация с Engram: {details}",
	"Pull all from server (force overwrite)": "Загрузить всё с сервера (принудительная перезапись)",
	"Engram sync: pulling all from server...":
		"Синхронизация с Engram: загрузка всего с сервера...",
	"Engram Sync: pulled {count} files from server": {
		one: "Engram Sync: получено {count} файл с сервера",
		few: "Engram Sync: получено {count} файла с сервера",
		many: "Engram Vault Sync: получено {count} файлов с сервера",
		other: "Engram Sync: получено {count} файлов с сервера",
	},
	"Show sync log": "Показать журнал синхронизации",
	"Semantic search": "Смысловой поиск",
	"Open search sidebar": "Открыть боковую панель поиска",
	"Engram search": "Поиск по Engram",
	"Open sync center": "Открыть Центр синхронизации",
	"Engram: ready": "Engram: готов",
	"Engram Sync: pushed {pushed}": "Engram Sync: отправлено {pushed}",
	"Engram sync: sync failed": "Engram sync: синхронизация не удалась",
	"Engram: this vault no longer exists on the server. Pick or create a vault to continue.":
		"Engram: это хранилище больше не существует на сервере. Выберите или создайте хранилище, чтобы продолжить.",
	"Engram: recovered plugin settings from a backup after a corrupted save.":
		"Engram: настройки плагина восстановлены из резервной копии после повреждения.",
	"Engram: plugin settings file was corrupted and could not be recovered. You may need to reconnect in settings.":
		"Engram: файл настроек плагина был поврежден и не может быть восстановлен. Возможно, потребуется повторное подключение в настройках.",
	"Engram: your login expired — open Engram settings to reconnect.":
		"Engram: ваш сеанс завершен — откройте настройки Engram, чтобы подключиться заново.",
	"Engram: This vault has been deleted on the server.":
		"Engram: это хранилище было удалено на сервере.",
	"Engram sync: live sync requires a plugin update — please update the Engram vault sync plugin.":
		"Engram sync: для синхронизации в реальном времени требуется обновление плагина — пожалуйста, обновите плагин Engram Vault Sync.",
	"Engram Sync: pulled {pulled} (local extras deleted)":
		"Engram Sync: получено {pulled} (локальные дополнительные файлы удалены)",
	"Engram Sync: pulled {pulled}": "Engram Sync: получено {pulled}",
	"Engram Sync: replaced remote with local ({pushed} uploaded)":
		"Engram Sync: удалённая версия заменена локальной ({pushed} загружено)",
	"Engram: sync is not set up yet, so nothing in this vault will sync.":
		"Engram: синхронизация ещё не настроена, поэтому ничего из этого хранилища не будет синхронизироваться.",
	"Finish sync setup": "Завершить настройку синхронизации",
	"Engram: sync is paused. This edit was not synced. Choose a sync direction to resume.":
		"Engram: синхронизация приостановлена. Это изменение не было синхронизировано. Выберите направление синхронизации, чтобы продолжить.",
	"Open Engram settings": "Открыть настройки Engram",
	"Engram: sync failed. Open the sync log for details.":
		"Engram: синхронизация не удалась. Откройте журнал синхронизации для получения подробностей.",
	"Engram: not connected": "Engram: не подключено",
	"Engram: signed out": "Engram: выход из системы",
	"Not connected yet. Click to open settings and link this vault.":
		"Пока не подключено. Нажмите, чтобы открыть настройки и связать это хранилище.",
	"Not signed in. Click to open settings and reconnect.":
		"Не вошли в систему. Нажмите, чтобы открыть настройки и подключиться заново.",
	"Engram: finish setup": "Engram: завершить настройку",
	"Engram: sync paused": "Engram: синхронизация приостановлена",
	"{label} ({count} queued)": "{label} ({count} в очереди)",
	"Setup is not finished — nothing will sync until you choose a sync direction. Click to finish.":
		"Настройка не завершена — синхронизация не будет происходить, пока вы не выберете направление синхронизации. Нажмите, чтобы завершить.",
	"Sync paused — click to choose a sync direction":
		"Синхронизация приостановлена — нажмите, чтобы выбрать направление синхронизации",
	"Engram: offline ({count} queued)": "Engram: в автономном режиме ({count} в очереди)",
	"Engram: offline": "Engram: в автономном режиме",
	"Server unreachable — changes will sync when connected":
		"Сервер недоступен — изменения будут синхронизированы при подключении",
	"Engram: error": "Engram: ошибка",
	"Unknown error": "Неизвестная ошибка",
	"Engram: syncing ({count})": "Engram: синхронизация ({count})",
	"Engram: syncing": "Engram: синхронизация",
	"Sync in progress...": "Синхронизация в процессе...",
	"Engram: pending ({count})": "Engram: в ожидании ({count})",
	"{count} files queued": {
		one: "{count} файл в очереди",
		few: "{count} файла в очереди",
		many: "{count} файлов в очереди",
		other: "{count} файлов в очереди",
	},
	"Engram: live": "Engram: онлайн",
	"WebSocket connected — live sync active":
		"WebSocket подключен — активная синхронизация в реальном времени",
	"Click to sync": "Нажмите для синхронизации",
	"Engram: ⚠ {count} sync errors": {
		one: "Engram: ⚠ {count} ошибка синхронизации",
		few: "Engram: ⚠ {count} ошибки синхронизации",
		many: "Engram: ⚠ {count} ошибок синхронизации",
		other: "Engram: ⚠ {count} ошибок синхронизации",
	},
	"Last sync: {when}": "Последняя синхронизация: {when}",
	"Engram Sync: pulled {count} changes": {
		one: "Engram Sync: получено {count} изменение",
		few: "Engram Sync: получено {count} изменения",
		many: "Engram Sync: получено {count} изменений",
		other: "Engram Sync: получено {count} обновлений",
	},
	'Engram Sync: sync state for "{name}" was unreadable — using the on-disk copy.':
		'Engram Sync: состояние синхронизации для "{name}" не удалось прочитать — используется локальная копия.',
	"Engram Vault Sync {version} is available. {link}.":
		"Engram Vault Sync {version} доступен. {link}.",
	"{formatted} files · ": {
		one: "{formatted} файл ·",
		few: "{formatted} файлов ·",
		many: "{formatted} файлов ·",
		other: "{formatted} файлов ·",
	},
	"Notes searchable": "Заметки доступны для поиска",
	"Notes past this still sync and open normally, they are just not in the search index. The index keeps your oldest notes, so it is your newest ones that fall outside.":
		"Заметки, расположенные после этой точки, синхронизируются и открываются нормально, но они не включены в индекс поиска. Индекс содержит ваши старые заметки, поэтому новые заметки не попадают в него.",
	"Notes stored": "Заметки сохранены",
	Attachments: "Вложения",
	"AI searches": "Поиск по ИИ",
	"{formatted} per day": "{formatted} в день",
	Keyword: "Ключевое слово",
	Semantic: "Смысловой",
	Both: "Оба",
	"matches your words and their other forms — 'run' finds 'running' — plus this device.":
		"Соответствует вашим словам и их другим формам — 'run' найдёт 'running' — плюс это устройство.",
	"matches meaning. Finds notes that never use the words you typed.":
		"Соответствует смыслу. Находит заметки, которые никогда не используют слова, которые вы ввели.",
	"matches words and meaning together, plus this device. Widest results.":
		"Соответствует словам и смыслу вместе, плюс это устройство. Наиболее полные результаты.",
	"Engram indexes {indexed} of your {all} notes. The rest match on this device only. Upgrade to index everything.":
		"Engram индексирует {indexed} из ваших {all} заметок. Остальные соответствия находятся только на этом устройстве. Обновите, чтобы индексировать всё.",
	"Searching {indexed} of {all} notes. Upgrade to search everything.":
		"Поиск по {indexed} из {all} заметок. Обновите, чтобы искать всё.",
	"Search your vault…": "Поиск по вашему хранилищу…",
	"Clear search": "Очистить поиск",
	"Search settings": "Настройки поиска",
	"Filter by folder…": "Фильтр по папке…",
	"Filter by tags…": "Фильтр по тегам…",
	"Remove tag {tag}": "Удалить тег {tag}",
	"Engram unreachable. Showing matches from this device only.":
		"Engram недоступен. Отображаются соответствия только с этого устройства.",
	"Search failed — check connection": "Поиск не удался — проверьте соединение",
	"No results found": "Результаты не найдены",
	Untitled: "Без названия",
	"meaning + exact": "смысл + точное совпадение",
	"match strength: {pct}%": "степень соответствия: {pct}%",
	"No source path for this result": "Нет пути к исходному файлу для этого результата",
	"Note not synced locally": "Заметка не синхронизирована локально",
	"Syncing...": "Синхронизация...",
	"👋 Welcome": "👋 Добро пожаловать",
	"🔌 Connection": "🔌 Соединение",
	"🔄 Sync Center": "🔄 Центр синхронизации",
	"⚙️ Advanced": "⚙️ Дополнительно",
	"Engram: settings tab failed to render ({error})":
		"Engram: произошла ошибка при отображении вкладки настроек ({error})",
	Disconnected: "Отключено",
	"Error: {error}": "Ошибка: {error}",
	unknown: "неизвестно",
	"Connected — waiting for first sync decision":
		"Подключено — ожидается первое решение о синхронизации",
	"Connected — live sync active": "Подключено — активная синхронизация в реальном времени",
	"Connected — polling": "Подключено — опрос",
	"Not configured": "Не настроено",
	"Open sync setup": "Открыть настройку синхронизации",
	"waiting for a connection": "ожидание подключения",
	"sync is paused": "синхронизация приостановлена",
	"syncing now": "синхронизация в процессе",
	"waiting to retry": "ожидание повторной попытки",
	"{count} not on your plan": "{count} не входит в ваш тарифный план",
	"{count} need attention": {
		one: "{count} требует внимания",
		few: "{count} требует внимания",
		many: "{count} требует внимания",
		other: "{count} Требует внимания",
	},
	"{count} retrying": "{count} попытка повтора",
	"{count} ignored": "{count} проигнорировано",
	"{count} queued — {reason}": "{count} в очереди — {reason}",
	"Sync...": "Синхронизация...",
	"sync failed": "Синхронизация не удалась",
	Refresh: "Обновить",
	"Not synced on your plan ({count})": "Не синхронизировано по вашему тарифному плану ({count})",
	"These files are fine. They just need a paid plan to sync.":
		"Эти файлы в порядке. Для синхронизации требуется платный тариф.",
	"Show files ({count}) ▾": "Показать файлы ({count}) ▾",
	"Sync these now": "Синхронизировать сейчас",
	"Needs attention ({count})": "Требует внимания ({count})",
	"Clear all": "Очистить всё",
	"Nothing needs your attention. 🎉": "Ничего не требует вашего внимания. 🎉",
	Dismiss: "Закрыть",
	"Retrying automatically ({count})": "Повторная попытка (автоматически, {count})",
	"Retry all now": "Повторить все сейчас",
	"Temporary errors. These clear themselves once the server recovers.":
		"Временные ошибки. Они исчезнут после восстановления сервера.",
	"{count} attempts": {
		one: "{count} попытка",
		few: "{count} попытки",
		many: "{count} попыток",
		other: "{count} попыток",
	},
	Open: "Открыть",
	Ignore: "Игнорировать",
	"No files ignored. Use the ignore button on a failure row to stop syncing it.":
		'Никаких файлов не игнорируется. Используйте кнопку "Игнорировать" в строке с ошибкой, чтобы прекратить синхронизацию.',
	Restore: "Восстановить",
	"File not found locally: {path}": "Файл не найден локально: {path}",
	"Ignored {path} — won't sync until restored from Sync Center.":
		"Игнорировано {path} — синхронизация будет возобновлена после восстановления из Центра синхронизации.",
	"Restored {path} — will sync on next push.":
		"Восстановлено {path} — синхронизация будет выполнена при следующей отправке.",
	Clear: "Очистить",
	"No activity yet. Push or pull to see entries here.":
		"Пока нет активности. Отправьте или получите данные, чтобы увидеть записи здесь.",
	Stats: "Статистика",
	"Notes on this device": "Заметки на этом устройстве",
	"Attachments on this device": "Вложения на этом устройстве",
	"Remote vault": "Удалённое хранилище",
	"not linked": "не подключено",
	"Plan usage": "Использование по тарифному плану",
	"Sync log": "Журнал синхронизации",
	"Showing {count} entries": {
		one: "Отображается {count} запись",
		few: "Отображается {count} записи",
		many: "Отображается {count} записей",
		other: "Отображается {count} записей",
	},
	"No sync activity this session.": "Нет активности синхронизации в этом сеансе.",
	"({count} errors)": {
		one: "({count} ошибка)",
		few: "({count} ошибки)",
		many: "({count} ошибок)",
		other: "({count} ошибок)",
	},
	"Could not compare with the cloud. Check your connection.":
		"Не удалось сравнить с облаком. Проверьте ваше соединение.",
	"Your login expired. Sign in again in Engram settings to continue.":
		"Ваш сеанс завершён. Войдите снова в настройках Engram, чтобы продолжить.",
	"Couldn't create vault — the name may be invalid or already in use.":
		"Не удалось создать хранилище — имя может быть недействительным или уже используется.",
	"Could not create the vault — check your connection and try again.":
		"Не удалось создать хранилище — проверьте соединение и попробуйте снова.",
	"Free syncs notes only — {count} attachments will be skipped.": {
		one: "Бесплатный план синхронизирует только заметки, {count} вложение будет пропущено.",
		few: "Бесплатный план синхронизирует только заметки, {count} вложения будут пропущены.",
		many: "Бесплатный план синхронизирует только заметки, {count} вложений будут пропущены.",
		other: "Бесплатный план синхронизирует только заметки, {count} вложений будут пропущены.",
	},
	"Uploads {up}, downloads {down}.": "Загружено {up}, скачано {down}.",
	"Uploads {count}.": "Загружено {count}.",
	"Downloads {count}.": "Скачано {count}.",
	"{count} conflicts to resolve.": {
		one: "{count} конфликт, требующий разрешения.",
		few: "{count} конфликта, которые необходимо разрешить.",
		many: "{count} конфликтов, которые необходимо разрешить.",
		other: "{count} конфликтов, которые необходимо разрешить.",
	},
	"Safe choice: combines both sides, nothing is deleted.":
		"Безопасный вариант: объединяет обе стороны, ничего не удаляется.",
	"Nothing is deleted.": "Ничего не будет удалено.",
	"Already in sync. Nothing is deleted.": "Уже синхронизировано. Ничего не будет удалено.",
	"Delete all {count} files currently on the server": {
		one: "Удалить все {count} файл, находящийся на сервере",
		few: "Удалить все {count} файла, находящиеся на сервере",
		many: "Удалить все {count} файлов, находящихся на сервере",
		other: "Удалить все файлы версии {count}, находящиеся на сервере",
	},
	"Upload {count} files from this vault": {
		one: "Загрузить {count} файл из этого хранилища",
		few: "Загрузить {count} файла из этого хранилища",
		many: "Загрузить {count} файлов из этого хранилища",
		other: "Загрузить {count} файла из этого хранилища",
	},
	"Delete all {count} files in this vault": {
		one: "Удалить все {count} файл в этом хранилище",
		few: "Удалить все {count} файла в этом хранилище",
		many: "Удалить все {count} файлов в этом хранилище",
		other: "Удалить все файлы версии {count} в этом хранилище",
	},
	"Download {count} files from the server": {
		one: "Загрузить {count} файл с сервера",
		few: "Загрузить {count} файла с сервера",
		many: "Загрузить {count} файлов с сервера",
		other: "Загрузить {count} файлов с сервера",
	},
	Sync: "Синхронизировать",
	"Upload local files without downloading the remote":
		"Загружайте локальные файлы, не скачивая удалённые",
	"Delete all on remote, then upload local files":
		"Удалите всё на удалённом устройстве, затем загрузите локальные файлы",
	"Download remote files without uploading the local":
		"Скачивайте удалённые файлы, не загружая локальные",
	"Delete all local files, then download from remote":
		"Удалить все локальные файлы, затем загрузить из удалённого хранилища",
	"Set up sync for this vault": "Настроить синхронизацию для этого хранилища",
	"You are now pointing at a different cloud vault":
		"Сейчас вы используете другое облачное хранилище",
	"Sync preview": "Предварительный просмотр синхронизации",
	"Nothing to sync yet — this vault is empty on both sides. Start syncing and everything you write appears on your other devices.":
		"Пока нет данных для синхронизации — это хранилище пустое с обеих сторон. Начните синхронизацию, и всё, что вы напишете, появится на ваших других устройствах.",
	"Start syncing": "Начать синхронизацию",
	"{count} notes": {
		one: "{count} заметка",
		few: "{count} заметки",
		many: "{count} заметок",
		other: "{count} заметки",
	},
	"{count} attachments": {
		one: "{count} вложение",
		few: "{count} вложения",
		many: "{count} вложений",
		other: "{count} вложений",
	},
	"{first} and {second}": "{first} и {second}",
	files: "файлы",
	"This vault is empty on the server. Upload your {what}?":
		"Это хранилище пустое на сервере. Загрузить ваши {what}?",
	"Upload everything": "Загрузить всё",
	"Nothing will be removed from this device.": "Ничего не будет удалено с этого устройства.",
	"This device's vault is empty. Download {what} from the server?":
		"Хранилище на этом устройстве пустое. Загрузить {what} с сервера?",
	"Download everything": "Скачать всё",
	Done: "Готово",
	"Send debug logs. Note content stays private.":
		"Отправить отладочные журналы. Содержимое заметок остаётся конфиденциальным.",
	"Comparing your vault with the cloud…": "Сравнение вашего хранилища с облаком…",
	"Not now": "Не сейчас",
	"Change vault": "Изменить хранилище",
	"Advanced sync options": "Расширенные параметры синхронизации",
	"Everything is in sync": "Всё синхронизировано",
	"This vault": "Это хранилище",
	"Cloud server": "Облачный сервер",
	" conflicts need resolution": {
		one: "Конфликт требует разрешения",
		few: "Конфликты требуют разрешения",
		many: "Конфликты требуют разрешения",
		other: "Конфликты требуют разрешения",
	},
	notes: "заметки",
	attachments: "Вложения",
	folders: "Папки",
	"Confirm destructive sync": "Подтвердить синхронизацию с удалением данных",
	"You are about to:": "Вы собираетесь:",
	"Files that will be deleted:": "Файлы, которые будут удалены:",
	"This cannot be undone.": "Это действие необратимо.",
	Back: "Назад",
	Confirm: "Подтвердить",
	"Switch vault": "Переключить хранилище",
	"Pick a vault to sync with. We will recalculate the sync preview after you choose.":
		"Выберите хранилище для синхронизации. Мы пересчитаем предварительный просмотр синхронизации после вашего выбора.",
	"Loading vaults…": "Загрузка хранилищ…",
	" (default)": "(по умолчанию)",
	"No other vaults available.": "Другие хранилища недоступны.",
	"Make new vault": "Создать новое хранилище",
	"New vault": "Новое хранилище",
	"Create a new empty vault on the server, then sync this Obsidian vault into it.":
		"Создать новое пустое хранилище на сервере, затем синхронизировать с ним ваше хранилище Obsidian.",
	"Vault name": "Имя хранилища",
	Create: "Создать",
	"Could not load vaults": "Не удалось загрузить хранилища",
	"Enter a name for the new vault": "Введите имя для нового хранилища",
	"Failed to switch vault": "Не удалось переключить хранилище",
	"Your vault shares {percent} of its data with Engram":
		"Ваше хранилище передает {percent} своих данных в Engram",
	"Type {keyword} to confirm:": "Введите {keyword}, чтобы подтвердить:",
	"Uploading {count}.": "Загрузка {count}.",
	"Downloading {count}.": "Загрузка {count}.",
	"Deleting {count} local files.": {
		one: "Удаление {count} локального файла.",
		few: "Удалено {count} локальных файла.",
		many: "Удаление {count} локальных файлов.",
		other: "Удаление {count} локальных файлов.",
	},
	"Deleting {count} on the cloud.": "Удаление {count} в облаке.",
	"First sync, this may take a moment.":
		"Первая синхронизация, это может занять некоторое время.",
	"Checking for changes.": "Проверка на наличие изменений.",
	"Nothing will be deleted.": "Ничего не будет удалено.",
	"✓ {count} synced": "✓ {count} синхронизировано",
	"⤳ {count} skipped (Free plan)": "⤳ {count} пропущено (бесплатный тариф)",
	"✕ {count} failed": "✕ {count} ошибка",
	"{count} attachments need a paid plan to sync. See Sync Center.": {
		one: "{count} вложению нужен платный план. См. Центр синхронизации.",
		few: "{count} вложениям нужен платный план. См. Центр синхронизации.",
		many: "{count} вложениям нужен платный план. См. Центр синхронизации.",
		other: "{count} вложениям нужен платный план. См. Центр синхронизации.",
	},
	"Finished with some errors. Open the sync log to see what failed.":
		"Завершено с ошибками. Откройте журнал синхронизации, чтобы узнать, что не удалось.",
	"Synced. Some attachments need a paid plan to sync (see below).":
		"Синхронизировано. Для синхронизации некоторых вложений требуется платная подписка (см. ниже).",
	"All synced. Your vault and the cloud now match.":
		"Всё синхронизировано. Ваше хранилище и облако теперь совпадают.",
	"Already up to date. Nothing needed syncing.": "Уже актуально. Синхронизация не требуется.",
	Deleting: "Удаление",
	Downloading: "Загрузка",
	Uploading: "Загрузка",
	"Syncing your vault": "Синхронизация вашего хранилища",
	"Getting started…": "Начало работы…",
	"Open Engram to check your vault and confirm everything synced.":
		"Откройте Engram, чтобы проверить ваше хранилище и убедиться, что всё синхронизировано.",
	"Open Engram": "Открыть Engram",
	"You can close this and the sync keeps running in the background.":
		"Вы можете закрыть это окно, и синхронизация продолжит работу в фоновом режиме.",
	"Run in background": "Работа в фоновом режиме",
	"Syncing…": "Синхронизация…",
	"Sync complete": "Синхронизация завершена",
	"Syncing attachments": "Синхронизация вложений",
	Complete: "Завершено",
	'{count} failed. Run "{command}" for details.':
		'{count} не удалась. Запустите "{command}", чтобы узнать подробности.',
	"Free syncs notes only — images & PDFs need a paid plan.":
		"Бесплатная синхронизация только для заметок — для изображений и PDF требуется платная подписка.",
	"Engram: {count} files failed to sync{detail} — open Sync Center": {
		one: "Engram: Не удалось синхронизировать {count} файл{detail} — откройте Центр синхронизации",
		few: "Engram: Не удалось синхронизировать {count} файла{detail} — откройте Центр синхронизации",
		many: "Engram: Не удалось синхронизировать {count} файлов{detail} — откройте Центр синхронизации",
		other: "Engram: Не удалось синхронизировать {count} файла{detail} — откройте Центр синхронизации",
	},
	"Engram: {count} attachments skipped — upgrade to sync images & PDFs.": {
		one: "Engram: Пропущено {count} вложение — обновите подписку, чтобы синхронизировать изображения и PDF-файлы.",
		few: "Engram: Пропущено {count} вложения — обновите подписку, чтобы синхронизировать изображения и PDF-файлы.",
		many: "Engram: Пропущено {count} вложений — обновите подписку, чтобы синхронизировать изображения и PDF-файлы.",
		other: "Engram: Пропущено {count} вложений — обновите подписку, чтобы синхронизировать изображения и PDF-файлы.",
	},
	"Engram: plan upgraded — syncing {count} attachments…": {
		one: "Engram: план обновлён — синхронизируется {count} вложение…",
		few: "Engram: план обновлён — синхронизация {count} вложений…",
		many: "Engram: план обновлён — синхронизация {count} вложений…",
		other: "Engram: план обновлён — синхронизация {count} вложений…",
	},
	"Pull all (delete extras) aborted: could not obtain an exclusive server snapshot (replay contention). Nothing was trashed.":
		"Синхронизация всех (удаление дубликатов) прервана: не удалось получить эксклюзивный снимок сервера (конфликт доступа). Ничего не было удалено.",
	"Pull all aborted: another sync is running (replay contention). Try again when it finishes.":
		"Синхронизация всех прервана: другая синхронизация выполняется (конфликт доступа). Попробуйте снова, когда она завершится.",
	"Pull all failed: {error}": "Синхронизация всех не удалась: {error}",
	"Pull all failed": "Синхронизация всех не удалась",
	"Engram: sync conflict on {path} — your local edit was saved as {copy}":
		"Engram: конфликт синхронизации для {path} — ваши локальные изменения сохранены как {copy}",
	"Open note": "Открыть заметку",
	"Engram: {count} notes have frontmatter problems. Open Sync Center to fix.":
		"Engram: в {count} заметках проблемы с метаданными. Откройте Центр синхронизации для исправления.",
	'Engram Sync: renamed "{name}" (unsupported characters)':
		'Engram Sync: переименовано "{name}" (неподдерживаемые символы)',
	'Engram: frontmatter problem in "{name}"': 'Engram: проблема с метаданными в "{name}"',
	"Engram: this plugin is too old to sync (needs {version} or newer). Update it to continue.":
		"Engram: этот плагин слишком старый для синхронизации (требуется {version} или новее). Обновите его, чтобы продолжить.",
	"Engram: this plugin is too old to sync. Update it to continue.":
		"Engram: этот плагин слишком старый для синхронизации. Обновите его, чтобы продолжить.",
	Update: "Обновить",
	"New here? Watch the setup video": "Вы здесь впервые? Посмотрите видеоинструкцию",
	"What Engram does, and how to connect your vault, start to finish.":
		"Что делает Engram и как подключить ваше хранилище, от начала до конца.",
	"▶ Watch on YouTube": "▶ Смотреть на YouTube",
	"Getting set up": "Начало работы",
	"1. Make an account": "1. Создайте учётную запись",
	"Create a hosted account at ": "Создайте учётную запись на сайте",
	", or self-host the backend (": ", или настройте сервер самостоятельно (",
	"setup guide": "руководство по настройке",
	"2. Connect your vault to Engram": "2. Подключите ваше хранилище к Engram",
	"Sign in (or enter your server URL and key) on the connection tab, then run your first sync.":
		"Войдите в систему (или введите URL вашего сервера и ключ) на вкладке подключения, затем выполните первую синхронизацию.",
	"Open connection tab": "Открыть вкладку подключения",
	"3. Connect your AI": "3. Подключите ваш ИИ",
	"Link Claude, Cursor, ChatGPT, or any MCP app so it can read and write your notes. ":
		"Подключите Claude, Cursor, ChatGPT или любое приложение MCP, чтобы оно могло читать и записывать ваши заметки",
	"See the AI setup guide": "Смотрите руководство по настройке ИИ",
	Plans: "Планы",
	Free: "Бесплатно",
	"1 vault, 2 devices": "1 хранилище, 2 устройства",
	"Real-time sync": "Синхронизация в реальном времени",
	"2,000 notes searchable": "2000 заметки для поиска",
	"Connect any AI (MCP)": "Подключите любой ИИ (MCP)",
	Starter: "Starter",
	"10 vaults, unlimited devices": "10 хранилищ, неограниченное количество устройств",
	"Search all your notes": "Ищите все ваши заметки",
	"10 GB attachments": "10 ГБ вложений",
	"Unlimited AI searches": "Неограниченное количество поисков с использованием ИИ",
	Pro: "Pro",
	"Unlimited vaults": "Неограниченное количество хранилищ",
	"Search across all vaults at once": "Поиск по всем хранилищам одновременно",
	"50 GB attachments": "50 ГБ вложений",
	"API access": "Доступ к API",
	"See full pricing": "Смотрите полную информацию о ценах",
	"Learn more": "Узнать больше",
	Documentation: "Документация",
	"AI / MCP setup guide": "Руководство по настройке ИИ / MCP",
	"Report an issue": "Сообщить о проблеме",
	"Join our Discord": "Присоединяйтесь к нашему Discord",
	"Node.js dependencies": "Зависимости Node.js",
	"Python virtual environment": "Виртуальное окружение Python",
	"Python bytecode cache": "Кэш байт-кода Python",
	"Vendored dependencies": "Внешние зависимости",
	"Gradle build cache": "Кэш сборки Gradle",
	"Rust/Java build output": "Результаты сборки Rust/Java",
	"Build output": "Результаты сборки",
	"Next.js build output": "Результаты сборки Next.js",
	"Distribution build output": "Результаты сборки для распространения",
	"Cargo cache": "Кэш Cargo",
	"CocoaPods dependencies": "Зависимости CocoaPods",
	"Dart tool cache": "Кэш инструментов Dart",
	"Generic cache directory": "Каталог общего кэша",
	"Ignore patterns": "Правила исключения",
	"Custom patterns": "Пользовательские правила",
	"Paths to skip (one per line). Folder patterns end with /. Built-in: {configDir}/, .trash/, .git/":
		"Пути для исключения (по одному на строку). Имена папок должны заканчиваться на /. Встроенные: {configDir}/, .trash/, .git/",
	Diagnostics: "Диагностика",
	"Send detailed sync, vault, and connection activity to the server for troubleshooting, with distributed tracing on requests. Metadata only, never note content. Leave off for normal use.":
		"Отправляйте подробную информацию о синхронизации, хранилище и подключениях на сервер для отладки, с распределённой трассировкой запросов. Только метаданные, никогда содержимое заметок. Отключите для обычной работы.",
	"Diagnostics detail": "Подробности диагностики",
	"Minimum severity that ships while diagnostics are on. Higher levels send fewer lines. Default: Info.":
		"Минимальный уровень серьёзности, при котором отправляются данные при включенной диагностике. Более высокие уровни отправляют меньше строк. По умолчанию: Info.",
	"Errors only": "Только ошибки",
	"Warnings and errors": "Предупреждения и ошибки",
	"Info (default)": "Информация (по умолчанию)",
	"Debug (verbose)": "Отладка (подробная)",
	About: "О программе",
	"License: {name}": "Лицензия: {name}",
	"⚠ Detected: {label}/ ({formatted} files)": "⚠ Обнаружено: {label} / ({formatted} файлов)",
	"{desc} — should not be synced": "{desc} — не должно синхронизироваться",
	"Add to ignores": "Добавить в исключения",
	"Added {pattern} to ignore patterns": 'Добавлено "{pattern}" в правила исключения',
	"Version: {version}": "Версия: {version}",
	"Source: {link}": "Источник: {link}",
	"Engram URL": "URL Engram",
	"✓ Engram server reachable (v{version})": "✓ Сервер Engram доступен (v{version})",
	"✗ server responded but isn't an Engram backend": "✗ Сервер ответил, но это не сервер Engram",
	"✗ couldn't reach a server at this URL": "✗ Не удалось подключиться к серверу по этому адресу",
	"Checking server…": "Проверка сервера…",
	"That does not look like a complete server address. Include the scheme, for example http://127.0.0.1:4000":
		"Это не похоже на полный адрес сервера. Укажите схему, например http://127.0.0.1:4000",
	"Engram backend changed — sign in again to continue.":
		"Сервер Engram был обновлён — войдите снова, чтобы продолжить.",
	Authentication: "Аутентификация",
	"Signed in as {email}": "Вошли как {email}",
	"Authenticated via Engram account (OAuth).": "Аутентификация через аккаунт Engram (OAuth).",
	"Manage account": "Управление аккаунтом",
	"Sign out": "Выйти",
	"Using API key": "Используется API-ключ",
	"Authenticated via manual API key.": "Аутентификация через ручной API-ключ.",
	"Clear key": "Очистить ключ",
	"Switch to sign in": "Перейти к входу",
	"Engram: sign-in failed ({error})": "Engram: ошибка при входе ({error})",
	"Sign in or create an account": "Войти или создать учётную запись",
	"Opens your browser to sign in, or create an account if you don't have one yet, then links this vault.":
		"Откроет ваш браузер для входа или создания учётной записи, если её у вас ещё нет, а затем свяжет это хранилище.",
	"Sign in": "Войти",
	"Or authenticate with a token instead of signing in. Engram Cloud API keys require the Pro plan; on Free and Starter, sign in above.":
		"Или используйте токен для аутентификации вместо входа. Ключи API Engram Cloud требуют тарифный план Pro; для планов Free и Starter используйте вход выше.",
	"Or authenticate with a token instead of signing in.":
		"Или используйте токен для аутентификации вместо входа.",
	"API key": "Ключ API",
	Token: "Токен",
	"Bearer token from your Engram account.": "Токен от вашей учётной записи Engram.",
	Save: "Сохранить",
	"Enter an API key first": "Сначала введите ключ API",
	"That does not look like an Engram API key (expected {prefix}…).":
		"Это не похоже на ключ API Engram (ожидается {prefix}…).",
	Vault: "Хранилище",
	"Vault selection": "Выбор хранилища",
	"Select which vault this plugin syncs with.":
		"Выберите хранилище, с которым будет осуществляться синхронизация.",
	"No vaults found — first sync will create one":
		"Хранилища не найдены — первая синхронизация создаст одно",
	"Pick a vault (previous: '{name}' not found)":
		"Выберите хранилище (предыдущее: '{name}' не найдено)",
	"Pick a vault (previous: id {id} not found)":
		"Выберите хранилище (предыдущее: id {id} не найдено)",
	"Pick a vault": "Выберите хранилище",
	Change: "Изменить",
	"Support development": "Поддержка разработки",
	"If this plugin saves you time, consider supporting development.":
		"Если этот плагин экономит ваше время, рассмотрите возможность поддержки разработки.",
	"GitHub Sponsors": "GitHub Sponsors",
	"Sign-in required to load vaults": "Для загрузки хранилищ требуется авторизация",
	"Server error ({status}) — check Engram logs":
		"Ошибка сервера ({status}) — проверьте логи Engram",
	"Request failed ({status})": "Запрос не удался ({status})",
	"Could not reach Engram — check connection":
		"Не удалось связаться с Engram — проверьте соединение",
	"Engram Cloud": "Облако Engram",
	"Self-hosted": "Самостоятельно размещенный",
	Backend: "Серверная часть",
	"Where this vault syncs to. Each backend keeps its own sign-in.":
		"Куда синхронизируется это хранилище. Каждый сервер требует отдельной авторизации.",
	"Switched to {mode}.": "Переключено на {mode}.",
	"Not connected. Enter your Engram server URL below to start syncing.":
		"Не подключено. Введите URL вашего сервера Engram ниже, чтобы начать синхронизацию.",
	"Run your own Engram server": "Запустите собственный сервер Engram",
	"Engram is the backend that powers sync and semantic search.":
		"Engram — это серверная часть, обеспечивающая синхронизацию и смысловой поиск.",
	"Nothing in this vault syncs until you choose how to merge it with the server.":
		"Ничего из этого хранилища не синхронизируется, пока вы не выберете, как объединить его с сервером.",
	"Choose sync direction": "Выберите направление синхронизации",
	"...": "...",
	'... "{name}" ...': '... "{name}" ...',
};

export default ru;
