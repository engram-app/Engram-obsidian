import type { Dict } from "..";

// Русский
const ru: Dict = {
	" (default)": " (по умолчанию)",
	"(top level)": "(верхний уровень)",
	"({count} errors)": {
		one: "({count} ошибка)",
		few: "({count} ошибки)",
		many: "({count} ошибок)",
		other: "({count} ошибок)",
	},
	"...": "...",
	'... "{name}" ...': '... "{name}" ...',
	"1 vault, 2 devices": "1 хранилище, 2 устройства",
	"1. Make an account": "1. Создайте учётную запись",
	"10 GB attachments": "10 ГБ вложений",
	"10 vaults, unlimited devices": "10 хранилищ, неограниченное количество устройств",
	"2. Connect your vault to Engram": "2. Подключите ваше хранилище к Engram",
	"3. Connect your AI": "3. Подключите ваш ИИ",
	"50 GB attachments": "50 ГБ вложений",
	"A browser window has opened. Sign in and enter this code to link your vault.":
		"Открыто окно браузера. Войдите и введите этот код, чтобы связать ваше хранилище.",
	"A frontmatter key could not be parsed as YAML.":
		"Ключ в заголовке не удалось обработать как YAML.",
	"A temporary server problem — retrying automatically.":
		"Временная проблема с сервером — повторная попытка.",
	"AI / MCP setup guide": "Руководство по настройке ИИ / MCP",
	"AI searches": "Поиск по ИИ",
	"API access": "Доступ к API",
	"API key": "Ключ API",
	"API keys need a Pro plan. Sign in with your Engram account instead.":
		"Для использования API-ключей требуется тарифный план Pro. Войдите в систему, используя свою учётную запись Engram.",
	About: "О программе",
	"Accept it to keep syncing.": "Примите его, чтобы продолжить синхронизацию.",
	"Access token": "Токен доступа",
	"Account setup incomplete.": "Настройка учётной записи не завершена.",
	"Account suspended. Contact support.":
		"Учётная запись приостановлена. Обратитесь в службу поддержки.",
	"Activity ({count})": "Активность ({count})",
	"Add to ignores": "Добавить в исключения",
	"Added {pattern} to ignore patterns": 'Добавлено "{pattern}" в правила исключения',
	"Advanced sync options": "Расширенные параметры синхронизации",
	"All synced. Your vault and the cloud now match.":
		"Всё синхронизировано. Ваше хранилище и облако теперь совпадают.",
	"Already in sync. Nothing is deleted.": "Уже синхронизировано. Ничего не будет удалено.",
	"Already signed in on another device. Upgrade for multi-device.":
		"Вы уже вошли на другом устройстве. Обновите тариф для поддержки нескольких устройств.",
	"Already up to date. Nothing needed syncing.": "Уже актуально. Синхронизация не требуется.",
	"An unexpected error — retrying automatically.": "Неожиданная ошибка — повторная попытка.",
	"Attachment storage full": "Место для хранения вложений заполнено",
	"Attachment storage is full — upgrade for more.":
		"Место для хранения вложений заполнено — обновите тариф для увеличения.",
	"Attachment sync is disabled for this account.":
		"Синхронизация вложений отключена для этой учётной записи.",
	Attachments: "Вложения",
	"Attachments need a paid plan": "Вложения требуют платной подписки",
	"Attachments on this device": "Вложения на этом устройстве",
	"Authenticated via Engram account (OAuth).": "Аутентификация через аккаунт Engram (OAuth).",
	"Authenticated via manual API key.": "Аутентификация через ручной API-ключ.",
	Authentication: "Аутентификация",
	Back: "Назад",
	"Bearer token from your Engram account.": "Токен от вашей учётной записи Engram.",
	Both: "Оба",
	Bug: "Ошибка",
	"Build output": "Результаты сборки",
	"Can't reach the server — retrying automatically.":
		"Не удается связаться с сервером — повторная попытка.",
	Cancel: "Отменить",
	"Cargo cache": "Кэш Cargo",
	Change: "Изменить",
	"Change vault": "Изменить хранилище",
	"Check sync status": "Проверить статус синхронизации",
	"Checking for changes.": "Проверка на наличие изменений.",
	"Checking server…": "Проверка сервера…",
	"Choose sync direction": "Выберите направление синхронизации",
	Clear: "Очистить",
	"Clear all": "Очистить всё",
	"Clear key": "Очистить ключ",
	"Clear search": "Очистить поиск",
	"Click to copy": "Нажмите, чтобы скопировать",
	"Click to sync": "Нажмите для синхронизации",
	Close: "Закрыть",
	"Cloud server": "Облачный сервер",
	"CocoaPods dependencies": "Зависимости CocoaPods",
	"Code copied!": "Код скопирован!",
	"Code expired. Please try again.": "Код устарел. Пожалуйста, попробуйте снова.",
	"Comparing your vault with the cloud…": "Сравнение вашего хранилища с облаком…",
	Complete: "Завершено",
	Confirm: "Подтвердить",
	"Confirm destructive sync": "Подтвердить синхронизацию с удалением данных",
	Conflict: "Конфликт",
	Confusing: "Непонятно",
	"Connect any AI (MCP)": "Подключите любой ИИ (MCP)",
	"Connect to Engram first to send feedback.":
		"Сначала подключитесь к Engram, чтобы отправить отзыв.",
	"Connected — live sync active": "Подключено — активная синхронизация в реальном времени",
	"Connected — polling": "Подключено — опрос",
	"Connected — waiting for first sync decision":
		"Подключено — ожидается первое решение о синхронизации",
	"Connection failed": "Не удалось подключиться",
	Continue: "Продолжить",
	"Could not compare with the cloud. Check your connection.":
		"Не удалось сравнить с облаком. Проверьте ваше соединение.",
	"Could not create the vault — check your connection and try again.":
		"Не удалось создать хранилище — проверьте соединение и попробуйте снова.",
	"Could not load vaults: {error}": "Не удалось загрузить хранилища: {error}",
	"Could not reach Engram — check connection":
		"Не удалось связаться с Engram — проверьте соединение",
	"Could not save your folder choice. Try again.":
		"Не удалось сохранить выбранную вами папку. Попробуйте ещё раз.",
	"Couldn't create vault — the name may be invalid or already in use.":
		"Не удалось создать хранилище — имя может быть недействительным или уже используется.",
	"Couldn't send your feedback, please try again.":
		"Не удалось отправить ваш отзыв, попробуйте ещё раз.",
	Create: "Создать",
	"Create a hosted account at {signup}, or self-host the server ({guide}).":
		"Создайте учётную запись на {signup} или настройте сервер самостоятельно ({guide}).",
	"Create a new empty vault on the server, then sync this Obsidian vault into it.":
		"Создать новое пустое хранилище на сервере, затем синхронизировать с ним ваше хранилище Obsidian.",
	"Custom patterns": "Пользовательские правила",
	"Daily AI search limit reached. Free includes 20 per day across Obsidian, the web app and MCP. Upgrade for unlimited.":
		"Достигнут дневной лимит поиска по ИИ. Бесплатный тариф включает 20 запросов в день для Obsidian, веб-приложения и MCP. Обновите тариф для неограниченного использования.",
	"Dart tool cache": "Кэш инструментов Dart",
	"Debug (verbose)": "Отладка (подробная)",
	"Delete all local files, then download from remote":
		"Удалить все локальные файлы, затем загрузить из удалённого хранилища",
	"Delete all on remote, then upload local files":
		"Удалите всё на удалённом устройстве, затем загрузите локальные файлы",
	"Delete all {count} files currently on the server": {
		one: "Удалить все {count} файл, находящийся на сервере",
		few: "Удалить все {count} файла, находящиеся на сервере",
		many: "Удалить все {count} файлов, находящихся на сервере",
		other: "Удалить все файлы версии {count}, находящиеся на сервере",
	},
	"Delete all {count} files in this vault": {
		one: "Удалить все {count} файл в этом хранилище",
		few: "Удалить все {count} файла в этом хранилище",
		many: "Удалить все {count} файлов в этом хранилище",
		other: "Удалить все файлы версии {count} в этом хранилище",
	},
	Deleted: "Удалено",
	Deleting: "Удаление",
	"Deleting {count} local files.": {
		one: "Удаление {count} локального файла.",
		few: "Удалено {count} локальных файла.",
		many: "Удаление {count} локальных файлов.",
		other: "Удаление {count} локальных файлов.",
	},
	"Deleting {count} on the cloud.": {
		one: "Удаление {count} в облаке.",
		few: "Удаление {count} в облаке.",
		many: "Удаление {count} файлов из облака.",
		other: "Удаление версии {count} из облака.",
	},
	"Device swap cooldown active. Wait or upgrade.":
		"Активен период ожидания при смене устройства. Подождите или обновите тариф.",
	Diagnostics: "Диагностика",
	"Diagnostics detail": "Подробности диагностики",
	"Disconnect (clear login)": "Отключить (очистить данные для входа)",
	Disconnected: "Отключено",
	Dismiss: "Закрыть",
	"Distribution build output": "Результаты сборки для распространения",
	Documentation: "Документация",
	Done: "Готово",
	"Download everything": "Скачать всё",
	"Download remote files without uploading the local":
		"Скачивайте удалённые файлы, не загружая локальные",
	"Download {count} files from the server": {
		one: "Загрузить {count} файл с сервера",
		few: "Загрузить {count} файла с сервера",
		many: "Загрузить {count} файлов с сервера",
		other: "Загрузить {count} файлов с сервера",
	},
	Downloading: "Загрузка",
	"Downloading {count}.": {
		one: "Загрузка {count}.",
		few: "Загрузка {count}.",
		many: "Загрузка {count}.",
		other: "Загрузка {count}.",
	},
	"Engram Cloud": "Облако Engram",
	"Engram Sync: pulled {count} changes": {
		one: "Engram Sync: получено {count} изменение",
		few: "Engram Sync: получено {count} изменения",
		many: "Engram Sync: получено {count} изменений",
		other: "Engram Sync: получено {count} обновлений",
	},
	"Engram Sync: pulled {count} files from server": {
		one: "Engram Sync: получено {count} файл с сервера",
		few: "Engram Sync: получено {count} файла с сервера",
		many: "Engram Vault Sync: получено {count} файлов с сервера",
		other: "Engram Sync: получено {count} файлов с сервера",
	},
	"Engram Sync: pulled {pulled}": "Engram Sync: получено {pulled}",
	"Engram Sync: pulled {pulled} (local extras deleted)":
		"Engram Sync: получено {pulled} (локальные дополнительные файлы удалены)",
	"Engram Sync: pulled {pulled}, pushed {pushed}":
		"Синхронизация Engram: получено {pulled}, отправлено {pushed}",
	"Engram Sync: pushed {count} files": {
		one: "Engram Sync: отправлено {count} файл",
		few: "Engram Sync: отправлено {count} файла",
		many: "Engram Sync: отправлено {count} файлов",
		other: "Engram Sync: отправлено {count} файлов",
	},
	"Engram Sync: pushed {pushed}": "Engram Sync: отправлено {pushed}",
	'Engram Sync: renamed "{name}" (unsupported characters)':
		'Engram Sync: переименовано "{name}" (неподдерживаемые символы)',
	"Engram Sync: replaced remote with local ({pushed} uploaded)":
		"Engram Sync: удалённая версия заменена локальной ({pushed} загружено)",
	'Engram Sync: sync state for "{name}" was unreadable — using the on-disk copy.':
		'Engram Sync: состояние синхронизации для "{name}" не удалось прочитать — используется локальная копия.',
	"Engram Sync: {details}": "Синхронизация с Engram: {details}",
	"Engram URL": "URL Engram",
	"Engram Vault Sync {version} is available. {link}.":
		"Engram Vault Sync {version} доступен. {link}.",
	"Engram indexes {indexed} of your {all} notes. The rest match on this device only. Upgrade to index everything.":
		"Engram индексирует {indexed} из ваших {all} заметок. Остальные соответствия находятся только на этом устройстве. Обновите, чтобы индексировать всё.",
	"Engram is the backend that powers sync and semantic search.":
		"Engram — это серверная часть, обеспечивающая синхронизацию и смысловой поиск.",
	"Engram search": "Поиск по Engram",
	"Engram server changed — sign in again to continue.":
		"Сервер Engram изменён — войдите снова, чтобы продолжить.",
	"Engram sync: checking...": "Синхронизация Engram: проверка...",
	"Engram sync: everything in sync": "Синхронизация с Engram: всё синхронизировано",
	"Engram sync: live sync requires a plugin update — please update the Engram vault sync plugin.":
		"Engram sync: для синхронизации в реальном времени требуется обновление плагина — пожалуйста, обновите плагин Engram Vault Sync.",
	"Engram sync: pulling all from server...":
		"Синхронизация с Engram: загрузка всего с сервера...",
	"Engram sync: server does not support reconciliation (update backend)":
		"Синхронизация с Engram: сервер не поддерживает исправление (обновить бэкенд)",
	"Engram sync: sync failed": "Engram sync: синхронизация не удалась",
	"Engram sync: syncing...": "Синхронизация Engram: синхронизация...",
	"Engram unreachable. Showing matches from this device only.":
		"Engram недоступен. Отображаются соответствия только с этого устройства.",
	"Engram's {document} update, effective {date}.":
		"Обновление Engram для {document}, вступает в силу {date}.",
	"Engram: This vault has been deleted on the server.":
		"Engram: это хранилище было удалено на сервере.",
	"Engram: disconnected. Open Engram settings to reconnect.":
		"Engram: отключено. Откройте настройки Engram, чтобы подключиться снова.",
	"Engram: error": "Engram: ошибка",
	"Engram: finish setup": "Engram: завершить настройку",
	'Engram: frontmatter problem in "{name}"': 'Engram: проблема с метаданными в "{name}"',
	"Engram: live": "Engram: онлайн",
	"Engram: not connected": "Engram: не подключено",
	"Engram: offline": "Engram: в автономном режиме",
	"Engram: offline ({count} queued)": {
		one: "Engram: в автономном режиме ({count} в очереди)",
		few: "Engram: в автономном режиме ({count} в очереди)",
		many: "Engram: в автономном режиме (в очереди {count})",
		other: "Engram: в автономном режиме ({count} в очереди)",
	},
	"Engram: pending ({count})": "Engram: в ожидании ({count})",
	"Engram: plan upgraded — syncing {count} attachments…": {
		one: "Engram: план обновлён — синхронизируется {count} вложение…",
		few: "Engram: план обновлён — синхронизация {count} вложений…",
		many: "Engram: план обновлён — синхронизация {count} вложений…",
		other: "Engram: план обновлён — синхронизация {count} вложений…",
	},
	"Engram: plugin settings file was corrupted and could not be recovered. You may need to reconnect in settings.":
		"Engram: файл настроек плагина был поврежден и не может быть восстановлен. Возможно, потребуется повторное подключение в настройках.",
	"Engram: ready": "Engram: готов",
	"Engram: recovered plugin settings from a backup after a corrupted save.":
		"Engram: восстановлены настройки плагина из резервной копии после повреждения при сохранении.",
	"Engram: settings tab failed to render ({error})":
		"Engram: произошла ошибка при отображении вкладки настроек ({error})",
	"Engram: sign-in failed ({error})": "Engram: ошибка при входе ({error})",
	"Engram: signed out": "Engram: выход из системы",
	"Engram: sync conflict on {path} — your local edit was saved as {copy}":
		"Engram: конфликт синхронизации для {path} — ваши локальные изменения сохранены как {copy}",
	"Engram: sync failed. Open the sync log for details.":
		"Engram: синхронизация не удалась. Откройте журнал синхронизации для получения подробностей.",
	"Engram: sync is not set up yet, so nothing in this vault will sync.":
		"Engram: синхронизация ещё не настроена, поэтому ничего из этого хранилища не будет синхронизироваться.",
	"Engram: sync is paused. This edit was not synced. Choose a sync direction to resume.":
		"Engram: синхронизация приостановлена. Это изменение не было синхронизировано. Выберите направление синхронизации, чтобы продолжить.",
	"Engram: sync paused": "Engram: синхронизация приостановлена",
	"Engram: syncing": "Engram: синхронизация",
	"Engram: syncing ({count})": "Engram: синхронизация ({count})",
	"Engram: this plugin is too old to sync (needs {version} or newer). Update it to continue.":
		"Engram: этот плагин слишком старый для синхронизации (требуется {version} или новее). Обновите его, чтобы продолжить.",
	"Engram: this plugin is too old to sync. Update it to continue.":
		"Engram: этот плагин слишком старый для синхронизации. Обновите его, чтобы продолжить.",
	"Engram: this vault no longer exists on the server. Pick or create a vault to continue.":
		"Engram: это хранилище больше не существует на сервере. Выберите или создайте хранилище, чтобы продолжить.",
	"Engram: your login expired — open Engram settings to reconnect.":
		"Engram: ваш сеанс завершен — откройте настройки Engram, чтобы подключиться заново.",
	"Engram: {count} attachments skipped — upgrade your plan to sync images & PDFs.": {
		one: "Engram: Пропущено {count} вложение — обновите свой тариф, чтобы синхронизировать изображения и PDF-файлы.",
		few: "Engram: Пропущено {count} вложения — обновите свой тариф, чтобы синхронизировать изображения и PDF-файлы.",
		many: "Engram: Пропущено {count} вложений — обновите свой тариф, чтобы синхронизировать изображения и PDF-файлы.",
		other: "Engram: Пропущено {count} вложений — обновите свой тариф, чтобы синхронизировать изображения и PDF-файлы.",
	},
	"Engram: {count} files failed to sync{detail} — open Sync Center": {
		one: "Engram: Не удалось синхронизировать {count} файл{detail} — откройте Центр синхронизации",
		few: "Engram: Не удалось синхронизировать {count} файла{detail} — откройте Центр синхронизации",
		many: "Engram: Не удалось синхронизировать {count} файлов{detail} — откройте Центр синхронизации",
		other: "Engram: Не удалось синхронизировать {count} файла{detail} — откройте Центр синхронизации",
	},
	"Engram: {count} notes have frontmatter problems. Open Sync Center to fix.": {
		one: "Engram: Обнаружена проблема с метаданными в {count} заметке. Откройте Центр синхронизации для исправления.",
		few: "Engram: Обнаружены проблемы с метаданными у {count} заметок. Откройте Центр синхронизации для исправления.",
		many: "Engram: Обнаружено {count} проблем с метаданными в заметках. Откройте Центр синхронизации для исправления.",
		other: "Engram: Обнаружено {count} заметки с проблемами в метаданных. Откройте Центр синхронизации для исправления.",
	},
	"Engram: ⚠ {count} sync errors": {
		one: "Engram: ⚠ {count} ошибка синхронизации",
		few: "Engram: ⚠ {count} ошибки синхронизации",
		many: "Engram: ⚠ {count} ошибок синхронизации",
		other: "Engram: ⚠ {count} ошибок синхронизации",
	},
	"Enter a name for the new vault": "Введите имя для нового хранилища",
	"Enter an API key first": "Сначала введите ключ API",
	Error: "Ошибка",
	"Error: {error}": "Ошибка: {error}",
	"Errors only": "Только ошибки",
	"Everything is in sync": "Всё синхронизировано",
	"Excluded folders": "Исключенные папки",
	"Failed to start device flow. Check your Engram URL and try again.":
		"Не удалось запустить процесс аутентификации. Проверьте ваш URL Engram и попробуйте снова.",
	"Failed to switch vault: {error}": "Не удалось переключить хранилище: {error}",
	"File exceeds the {limit} limit": "Файл превышает лимит в {limit}",
	"File not found locally: {path}": "Файл не найден локально: {path}",
	"File too large for your plan.": "Файл слишком большой для вашего тарифа.",
	"Files that will be deleted:": "Файлы, которые будут удалены:",
	"Filter by folder…": "Фильтр по папке…",
	"Filter by tags…": "Фильтр по тегам…",
	"Finish setting up your account at app.engram.page to start syncing.":
		"Завершите настройку вашей учётной записи на app.engram.page, чтобы начать синхронизацию.",
	"Finish sync setup": "Завершить настройку синхронизации",
	"Finished with some errors. Open the sync log to see what failed.":
		"Завершено с ошибками. Откройте журнал синхронизации, чтобы узнать, что не удалось.",
	"First sync, this may take a moment.":
		"Первая синхронизация, это может занять некоторое время.",
	Free: "Бесплатно",
	"Free syncs notes only — images & PDFs need a paid plan.":
		"Бесплатная синхронизация только для заметок — для изображений и PDF требуется платная подписка.",
	"Free syncs notes only — {count} attachments will be skipped.": {
		one: "Бесплатный план синхронизирует только заметки, {count} вложение будет пропущено.",
		few: "Бесплатный план синхронизирует только заметки, {count} вложения будут пропущены.",
		many: "Бесплатный план синхронизирует только заметки, {count} вложений будут пропущены.",
		other: "Бесплатный план синхронизирует только заметки, {count} вложений будут пропущены.",
	},
	"Frontmatter could not be parsed": "Не удалось обработать метаданные",
	"Frontmatter isn't valid YAML.": "Заголовок не является допустимым YAML.",
	'Frontmatter key "{key}" could not be parsed as YAML.':
		'Ключ в заголовке "{key}" не удалось обработать как YAML.',
	"Frontmatter needs a fix": "Необходимо исправить метаданные",
	"Generic cache directory": "Каталог общего кэша",
	"Getting set up": "Начало работы",
	"Getting started…": "Начало работы…",
	"GitHub Sponsors": "GitHub Sponsors",
	"Gradle build cache": "Кэш сборки Gradle",
	"How do you feel about Engram?": "Что вы думаете о Engram?",
	"I understand {count} notes will not sync.": {
		one: "Я понимаю, что {count} заметка не будет синхронизирована.",
		few: "Я понимаю, что {count} заметки не будут синхронизированы.",
		many: "Я понимаю, что {count} заметок не будут синхронизированы.",
		other: "Я понимаю, что {count} заметки не будут синхронизированы.",
	},
	Idea: "Предложение",
	"If this plugin saves you time, consider supporting development.":
		"Если этот плагин экономит ваше время, рассмотрите возможность поддержки разработки.",
	Ignore: "Игнорировать",
	"Ignore patterns": "Правила исключения",
	"Ignored ({count})": "Исключено ({count})",
	"Ignored {path} — won't sync until restored from Sync Center.":
		"Игнорировано {path} — синхронизация будет возобновлена после восстановления из Центра синхронизации.",
	"Info (default)": "Информация (по умолчанию)",
	"Invalid API key": "Неверный ключ API",
	"It's OK to email me about this": "Вы можете написать мне об этом по электронной почте",
	"Join our Discord": "Присоединяйтесь к нашему Discord",
	Keyword: "Ключевое слово",
	"Last sync: {when}": "Последняя синхронизация: {when}",
	"Learn more": "Узнать больше",
	"License: {name}": "Лицензия: {name}",
	"Limit reached. Upgrade to continue.": "Достигнут лимит. Обновите подписку, чтобы продолжить.",
	"Link Claude, Cursor, ChatGPT, or any MCP app so it can read and write your notes. ":
		"Подключите Claude, Cursor, ChatGPT или любое приложение MCP, чтобы оно могло читать и записывать ваши заметки ",
	"Link Obsidian to Engram": "Свяжите Obsidian с Engram",
	"Loading vaults…": "Загрузка хранилищ…",
	"Love it": "Очень нравится",
	"Make new vault": "Создать новое хранилище",
	"Manage account": "Управление аккаунтом",
	"Minimum severity that ships while diagnostics are on. Higher levels send fewer lines. Default: Info.":
		"Минимальный уровень серьёзности, при котором отправляются данные при включенной диагностике. Более высокие уровни отправляют меньше строк. По умолчанию: Info.",
	"Needs attention ({count})": "Требует внимания ({count})",
	"Network unavailable": "Сеть недоступна",
	"New here? Watch the setup video": "Вы здесь впервые? Посмотрите видеоинструкцию",
	"New vault": "Новое хранилище",
	"Next.js build output": "Результаты сборки Next.js",
	"No activity yet. Push or pull to see entries here.":
		"Пока нет активности. Отправьте или получите данные, чтобы увидеть записи здесь.",
	"No files ignored. Use the ignore button on a failure row to stop syncing it.":
		'Никаких файлов не игнорируется. Используйте кнопку "Игнорировать" в строке с ошибкой, чтобы прекратить синхронизацию.',
	"No other vaults available.": "Другие хранилища недоступны.",
	"No results found": "Результаты не найдены",
	"No source path for this result": "Нет пути к исходному файлу для этого результата",
	"No sync activity this session.": "Нет активности синхронизации в этом сеансе.",
	"No vaults found — first sync will create one":
		"Хранилища не найдены — первая синхронизация создаст одно",
	"Node.js dependencies": "Зависимости Node.js",
	"Not configured": "Не настроено",
	"Not connected yet. Click to open settings and link this vault.":
		"Пока не подключено. Нажмите, чтобы открыть настройки и связать это хранилище.",
	"Not connected. Enter your Engram server URL below to start syncing.":
		"Не подключено. Введите URL вашего сервера Engram ниже, чтобы начать синхронизацию.",
	"Not now": "Не сейчас",
	"Not signed in, or the session expired. Sign in again in Engram settings.":
		"Вы не вошли в систему или сессия истекла. Войдите снова в настройках Engram.",
	"Not signed in. Click to open settings and reconnect.":
		"Не вошли в систему. Нажмите, чтобы открыть настройки и подключиться заново.",
	"Not synced on your plan ({count})": "Не синхронизировано по вашему тарифному плану ({count})",
	"Note couldn't be processed": "Заметку не удалось обработать",
	"Note limit reached. Upgrade to keep adding notes.":
		"Достигнут лимит заметок. Обновите подписку, чтобы добавлять больше заметок.",
	"Note not synced locally": "Заметка не синхронизирована локально",
	"Notes on this device": "Заметки на этом устройстве",
	"Notes past this still sync and open normally, they are just not in the search index. The index keeps your oldest notes, so it is your newest ones that fall outside.":
		"Заметки, расположенные после этой точки, синхронизируются и открываются нормально, но они не включены в индекс поиска. Индекс содержит ваши старые заметки, поэтому новые заметки не попадают в него.",
	"Notes searchable": "Заметки доступны для поиска",
	"Notes stored": "Заметки сохранены",
	"Notes up to the Free limit": "Заметки в пределах бесплатного лимита",
	"Nothing in this vault syncs until you choose how to merge it with the server.":
		"Ничего из этого хранилища не синхронизируется, пока вы не выберете, как объединить его с сервером.",
	"Nothing is deleted.": "Ничего не будет удалено.",
	"Nothing needs your attention. 🎉": "Ничего не требует вашего внимания. 🎉",
	"Nothing to sync yet — this vault is empty on both sides. Start syncing and everything you write appears on your other devices.":
		"Пока нет данных для синхронизации — это хранилище пустое с обеих сторон. Начните синхронизацию, и всё, что вы напишете, появится на ваших других устройствах.",
	"Nothing will be deleted.": "Ничего не будет удалено.",
	"Nothing will be removed from this device.": "Ничего не будет удалено с этого устройства.",
	Open: "Открыть",
	"Open Connection": "Открыть подключение",
	"Open Engram": "Открыть Engram",
	"Open Engram settings": "Открыть настройки Engram",
	"Open Engram to check your vault and confirm everything synced.":
		"Откройте Engram, чтобы проверить ваше хранилище и убедиться, что всё синхронизировано.",
	"Open connection tab": "Открыть вкладку подключения",
	"Open note": "Открыть заметку",
	"Open search sidebar": "Открыть боковую панель поиска",
	"Open sync center": "Открыть Центр синхронизации",
	"Open sync setup": "Открыть настройку синхронизации",
	"Open the file to resolve the conflict, then sync again.":
		"Откройте файл для разрешения конфликта, затем синхронизируйте снова.",
	"Opens your browser to sign in, or create an account if you don't have one yet, then links this vault.":
		"Откроет ваш браузер для входа или создания учётной записи, если её у вас ещё нет, а затем свяжет это хранилище.",
	"Or authenticate with a token instead of signing in.":
		"Или используйте токен для аутентификации вместо входа.",
	"Or authenticate with a token instead of signing in. Engram Cloud API keys require the Pro plan; on Free and Starter, sign in above.":
		"Или используйте токен для аутентификации вместо входа. Ключи API Engram Cloud требуют тарифный план Pro; для планов Free и Starter используйте вход выше.",
	"Paths to skip (one per line). Folder patterns end with /. Built-in: {configDir}/, .trash/, .git/":
		"Пути для исключения (по одному на строку). Имена папок должны заканчиваться на /. Встроенные: {configDir}/, .trash/, .git/",
	"Pick a vault": "Выберите хранилище",
	"Pick a vault (previous: '{name}' not found)":
		"Выберите хранилище (предыдущее: '{name}' не найдено)",
	"Pick a vault (previous: id {id} not found)":
		"Выберите хранилище (предыдущее: id {id} не найдено)",
	"Pick a vault to sync with. We will recalculate the sync preview after you choose.":
		"Выберите хранилище для синхронизации. Мы пересчитаем предварительный просмотр синхронизации после вашего выбора.",
	"Plan usage": "Использование по тарифному плану",
	Plans: "Планы",
	"Privacy Policy": "Политика конфиденциальности",
	Pro: "Pro",
	"Pull all (delete extras) aborted: could not obtain an exclusive server snapshot (replay contention). Nothing was trashed.":
		"Синхронизация всех (удаление дубликатов) прервана: не удалось получить эксклюзивный снимок сервера (конфликт доступа). Ничего не было удалено.",
	"Pull all aborted: another sync is running (replay contention). Try again when it finishes.":
		"Синхронизация всех прервана: другая синхронизация выполняется (конфликт доступа). Попробуйте снова, когда она завершится.",
	"Pull all failed: {error}": "Синхронизация всех не удалась: {error}",
	"Pull all from server (force overwrite)": "Загрузить всё с сервера (принудительная перезапись)",
	Pulled: "Получено",
	"Push entire vault": "Отправить всё хранилище",
	Pushed: "Отправлено",
	"Python bytecode cache": "Кэш байт-кода Python",
	"Python virtual environment": "Виртуальное окружение Python",
	"Read it": "Прочитать",
	"Real-time sync": "Синхронизация в реальном времени",
	"Reconnect your account to resume syncing.":
		"Подключите учётную запись заново, чтобы продолжить синхронизацию.",
	Refresh: "Обновить",
	"Remote vault": "Удалённое хранилище",
	"Remove tag {tag}": "Удалить тег {tag}",
	"Report an issue": "Сообщить о проблеме",
	"Report an issue on GitHub": "Сообщить о проблеме в GitHub",
	"Request failed ({status})": "Запрос не удался ({status})",
	Restore: "Восстановить",
	"Restored {path} — will sync on next push.":
		"Восстановлено {path} — синхронизация будет выполнена при следующей отправке.",
	"Retry all now": "Повторить все сейчас",
	"Retrying automatically ({count})": "Повторная попытка (автоматически, {count})",
	"Review and accept": "Ознакомиться и принять",
	"Run in background": "Работа в фоновом режиме",
	"Run your own Engram server": "Запустите собственный сервер Engram",
	"Rust/Java build output": "Результаты сборки Rust/Java",
	"Safe choice: combines both sides, nothing is deleted.":
		"Безопасный вариант: объединяет обе стороны, ничего не удаляется.",
	Save: "Сохранить",
	"Search across all vaults at once": "Поиск по всем хранилищам одновременно",
	"Search all your notes": "Ищите все ваши заметки",
	"Search failed — check connection": "Поиск не удался — проверьте соединение",
	"Search settings": "Настройки поиска",
	"Search your vault…": "Поиск по вашему хранилищу…",
	"Searching {indexed} of {all} notes. Upgrade to search everything.":
		"Поиск по {indexed} из {all} заметок. Обновите, чтобы искать всё.",
	"See full pricing": "Смотрите полную информацию о ценах",
	"See the AI setup guide": "Смотрите руководство по настройке ИИ",
	"Select which vault this plugin syncs with.":
		"Выберите хранилище, с которым будет осуществляться синхронизация.",
	"Selected: {selected} / {limit}": "Выбрано: {selected} / {limit}",
	"Self-hosted": "Самостоятельно размещенный",
	Semantic: "Смысловой",
	"Semantic search": "Смысловой поиск",
	Send: "Отправить",
	"Send debug logs. Note content stays private.":
		"Отправить отладочные журналы. Содержимое заметок остаётся конфиденциальным.",
	"Send detailed sync, vault, and connection activity to the server for troubleshooting, with distributed tracing on requests. Metadata only, never note content. Leave off for normal use.":
		"Отправляйте подробную информацию о синхронизации, хранилище и подключениях на сервер для отладки, с распределённой трассировкой запросов. Только метаданные, никогда содержимое заметок. Отключите для обычной работы.",
	"Send feedback": "Отправить отзыв",
	"Sending…": "Отправляется…",
	"Server error": "Ошибка сервера",
	"Server error ({status}) — check Engram logs":
		"Ошибка сервера ({status}) — проверьте логи Engram",
	"Server unreachable — changes will sync when connected":
		"Сервер недоступен — изменения будут синхронизированы при подключении",
	"Set up sync for this vault": "Настроить синхронизацию для этого хранилища",
	"Setup is not finished — nothing will sync until you choose a sync direction. Click to finish.":
		"Настройка не завершена — синхронизация не будет происходить, пока вы не выберете направление синхронизации. Нажмите, чтобы завершить.",
	"Show files ({count}) ▾": "Показать файлы ({count}) ▾",
	"Show sync log": "Показать журнал синхронизации",
	"Showing {count} entries": {
		one: "Отображается {count} запись",
		few: "Отображается {count} записи",
		many: "Отображается {count} записей",
		other: "Отображается {count} записей",
	},
	"Sign in": "Войти",
	"Sign in (or enter your server URL and key) on the connection tab, then run your first sync.":
		"Войдите в систему (или введите URL вашего сервера и ключ) на вкладке подключения, затем выполните первую синхронизацию.",
	"Sign in or create an account": "Войти или создать учётную запись",
	"Sign out": "Выйти",
	"Sign-in expired": "Сеанс работы завершён",
	"Sign-in required to load vaults": "Для загрузки хранилищ требуется авторизация",
	"Signed in as {email}": "Вошли как {email}",
	Skipped: "Пропущено",
	"Source: {link}": "Источник: {link}",
	"Start syncing": "Начать синхронизацию",
	Starter: "Starter",
	"Starting...": "Начало...",
	Stats: "Статистика",
	"Support development": "Поддержка разработки",
	"Switch to sign in": "Перейти к входу",
	"Switch vault": "Переключить хранилище",
	"Switched to {mode}.": "Переключено на {mode}.",
	Sync: "Синхронизировать",
	"Sync again": "Синхронизировать снова",
	"Sync again failed: {error}": "Синхронизация снова не удалась: {error}",
	"Sync complete": "Синхронизация завершена",
	"Sync failed": "Синхронизация не удалась",
	"Sync in progress...": "Синхронизация в процессе...",
	"Sync log": "Журнал синхронизации",
	"Sync now": "Синхронизировать сейчас",
	"Sync paused — click to choose a sync direction":
		"Синхронизация приостановлена — нажмите, чтобы выбрать направление синхронизации",
	"Sync preview": "Предварительный просмотр синхронизации",
	"Sync server": "Сервер синхронизации",
	"Sync these now": "Синхронизировать сейчас",
	"Sync...": "Синхронизация...",
	"Synced. Some attachments need a paid plan to sync (see below).":
		"Синхронизировано. Для синхронизации некоторых вложений требуется платная подписка (см. ниже).",
	"Syncing attachments": "Синхронизация вложений",
	"Syncing your vault": "Синхронизация вашего хранилища",
	"Syncing...": "Синхронизация...",
	"Syncing…": "Синхронизация…",
	"Tell us anything": "Расскажите нам о чём угодно",
	"Temporary errors. These clear themselves once the server recovers.":
		"Временные ошибки. Они исчезнут после восстановления работы сервера.",
	"Terms of Service": "Условия использования",
	"Thanks, we read every message.": "Спасибо, мы читаем каждое сообщение.",
	"That does not look like a complete server address. Include the scheme, for example http://127.0.0.1:4000":
		"Это не похоже на полный адрес сервера. Укажите схему, например http://127.0.0.1:4000",
	"That does not look like an Engram API key (expected {prefix}…).":
		"Это не похоже на ключ API Engram (ожидается {prefix}…).",
	"The Free tier syncs notes only. Upgrade to sync images and PDFs.":
		"Бесплатный тариф синхронизирует только заметки. Обновите подписку, чтобы синхронизировать изображения и PDF-файлы.",
	"The file is too large for the server.": "Файл слишком большой для сервера.",
	"The note synced, but its frontmatter could not be fully parsed. Open it to fix the highlighted line.":
		"Заметка синхронизирована, но метаданные не были полностью обработаны. Откройте её, чтобы исправить выделенную строку.",
	"The server couldn't process this note. Check its contents, then edit and save to try again.":
		"Сервер не смог обработать эту заметку. Проверьте её содержимое, затем отредактируйте и сохраните, чтобы повторить попытку.",
	"The server limit is 5 MB. Compress or split the file, then it will sync.":
		"Предел сервера составляет 5 МБ. Сжатие или разделение файла позволит выполнить синхронизацию.",
	"The server took too long to respond. Try again.":
		"Сервер слишком долго отвечает. Попробуйте ещё раз.",
	"These files are fine. They just need a paid plan to sync.":
		"Эти файлы в порядке. Для синхронизации требуется платный тариф.",
	"This account was deleted. Contact support if that is wrong.":
		"Эта учётная запись была удалена. Обратитесь в службу поддержки, если это не так.",
	"This cannot be undone.": "Это действие необратимо.",
	"This device's vault is empty. Download {what} from the server?":
		"Хранилище на этом устройстве пустое. Загрузить {what} с сервера?",
	"This file type isn't accepted by this server.": "Этот тип файла не принимается этим сервером.",
	"This note could not be processed and was skipped.":
		"Эта заметка не может быть обработана и была пропущена.",
	"This server is self-hosted, so feedback is not collected here. ":
		"Этот сервер работает локально, поэтому отзывы здесь не собираются. ",
	"This sync adds {count} notes.": {
		one: "Эта синхронизация добавит {count} заметку.",
		few: "Эта синхронизация добавит {count} заметки.",
		many: "Эта синхронизация добавит {count} заметок.",
		other: "Эта синхронизация добавит {count} заметки.",
	},
	"This vault": "Это хранилище",
	"This vault is empty on the server. Upload your {what}?":
		"Это хранилище пустое на сервере. Загрузить ваши {what}?",
	"Too large for the server": "Слишком большой для сервера",
	"Too many connected AI clients. Disconnect one or upgrade.":
		"Подключено слишком много клиентов ИИ. Отключите одного или обновите тариф.",
	"Too many connected Obsidian vaults. Disconnect one or upgrade.":
		"Подключено слишком много хранилищ Obsidian. Отключите одно или обновите тариф.",
	"Too many requests. Wait a moment and try again.":
		"Слишком много запросов. Подождите немного и попробуйте ещё раз.",
	"Top-level folders you chose not to sync.":
		"Папки верхнего уровня, которые вы решили не синхронизировать.",
	"Try again": "Повторить попытку",
	"Type {keyword} to confirm:": "Введите {keyword}, чтобы подтвердить:",
	"Unknown error": "Неизвестная ошибка",
	"Unlimited AI searches": "Неограниченное количество поисков с использованием ИИ",
	"Unlimited vaults": "Неограниченное количество хранилищ",
	"Unresolved conflict": "Неразрешенный конфликт",
	"Unticked folders stop syncing, including notes already uploaded.":
		"Папки, для которых снята галочка, перестают синхронизироваться, включая уже загруженные заметки.",
	Untitled: "Без названия",
	Update: "Обновить",
	"Update in settings": "Обновить в настройках",
	Upgrade: "Обновить",
	"Upload everything": "Загрузить всё",
	"Upload local files without downloading the remote":
		"Загружайте локальные файлы, не скачивая удалённые",
	"Upload {count} files from this vault": {
		one: "Загрузить {count} файл из этого хранилища",
		few: "Загрузить {count} файла из этого хранилища",
		many: "Загрузить {count} файлов из этого хранилища",
		other: "Загрузить {count} файла из этого хранилища",
	},
	Uploading: "Загрузка",
	"Uploading {count}.": {
		one: "Загрузка {count}.",
		few: "Загрузка {count}.",
		many: "Загрузка {count}.",
		other: "Загрузка {count}.",
	},
	"Uploads {up}, downloads {down}.": "Загружено {up}, скачано {down}.",
	"Using API key": "Используется API-ключ",
	Vault: "Хранилище",
	"Vault ID: {id}": "ID хранилища: {id}",
	"Vault limit reached. Upgrade for more vaults.":
		"Достигнут лимит хранилищ. Обновите подписку, чтобы использовать больше хранилищ.",
	"Vault name": "Имя хранилища",
	"Vault selection": "Выбор хранилища",
	"Vendored dependencies": "Внешние зависимости",
	"Version: {version}": "Версия: {version}",
	"Waiting for authorization — connected, this will complete instantly.":
		"Ожидание авторизации — подключено, процесс завершится мгновенно.",
	"Waiting for authorization — no live connection, checking every 30s.":
		"Ожидание авторизации — нет активного соединения, проверка каждые 30 секунд.",
	"Warnings and errors": "Предупреждения и ошибки",
	"WebSocket connected — live sync active":
		"WebSocket подключен — активная синхронизация в реальном времени",
	"What Engram does, and how to connect your vault, start to finish.":
		"Что делает Engram и как подключить ваше хранилище, от начала до конца.",
	"What kind of feedback?": "Какой тип отзыва?",
	"What's working, what's frustrating, what do you wish Engram did?":
		"Что работает, что вызывает затруднения, что вы хотели бы, чтобы Engram делал?",
	"Where this vault syncs to. Each backend keeps its own sign-in.":
		"Куда синхронизируется это хранилище. Каждый сервер требует отдельной авторизации.",
	"Will delete {count} files on the server.": {
		one: "Удалит {count} файл на сервере.",
		few: "Удалит {count} файла на сервере.",
		many: "Удалит {count} файлов на сервере.",
		other: "Удалит {count} файла на сервере.",
	},
	"Will download {count} files.": {
		one: "Загрузит {count} файл.",
		few: "Загрузит {count} файла.",
		many: "Загрузит {count} файлов.",
		other: "Загрузит {count} файлов.",
	},
	"Will upload {count} files.": {
		one: "Загрузка {count} файла.",
		few: "Загрузит {count} файла.",
		many: "Загрузка {count} файлов.",
		other: "Загрузка {count} файлов.",
	},
	"You are about to:": "Вы собираетесь:",
	"You are now pointing at a different cloud vault":
		"Сейчас вы используете другое облачное хранилище",
	"You can close this and the sync keeps running in the background.":
		"Вы можете закрыть это окно, и синхронизация продолжит работу в фоновом режиме.",
	"You've used all the attachment storage on your plan. Upgrade for more.":
		"Вы использовали весь объём хранилища для вложений в рамках вашего тарифного плана. Обновите подписку для получения большего объёма.",
	"Your code:": "Ваш код:",
	"Your feedback": "Ваши отзывы",
	"Your login expired. Sign in again in Engram settings to continue.":
		"Ваш сеанс завершён. Войдите снова в настройках Engram, чтобы продолжить.",
	"Your plan has room for {count}.": {
		one: "Ваш тарифный план позволяет хранить {count} заметку.",
		few: "Ваш тарифный план позволяет хранить {count} заметки.",
		many: "Ваш тарифный план позволяет хранить {count}.",
		other: "Ваш тарифный план позволяет хранить {count}.",
	},
	"Your plan syncs {count} notes.": {
		one: "Ваш план синхронизирует {count} заметку.",
		few: "Ваш план синхронизирует {count} заметки.",
		many: "Ваш план синхронизирует {count} заметок.",
		other: "Ваш план синхронизирует {count} заметки.",
	},
	"Your vault shares {percent} of its data with Engram":
		"Ваше хранилище передает {percent} своих данных в Engram",
	attachments: "Вложения",
	exact: "точно",
	files: "файлы",
	folders: "Папки",
	"match strength: {pct}%": "степень соответствия: {pct}%",
	"matches meaning. Finds notes that never use the words you typed.":
		"Соответствует смыслу. Находит заметки, которые никогда не используют слова, которые вы ввели.",
	"matches words and meaning together, plus this device. Widest results.":
		"Соответствует словам и смыслу вместе, плюс это устройство. Наиболее полные результаты.",
	"matches your words and their other forms — 'run' finds 'running' — plus this device.":
		"Соответствует вашим словам и их другим формам — 'run' найдёт 'running' — плюс это устройство.",
	meaning: "значение",
	"meaning + exact": "смысл + точное совпадение",
	"not linked": "не подключено",
	notes: "заметки",
	"setup guide": "руководство по настройке",
	"sync is paused": "синхронизация приостановлена",
	"syncing now": "синхронизация в процессе",
	unknown: "неизвестно",
	"waiting for a connection": "ожидание подключения",
	"waiting to retry": "ожидание повторной попытки",
	"{count} attachments": {
		one: "{count} вложение",
		few: "{count} вложения",
		many: "{count} вложений",
		other: "{count} вложений",
	},
	"{count} attachments need a paid plan to sync. See Sync Center.": {
		one: "{count} вложению нужен платный план. См. Центр синхронизации.",
		few: "{count} вложениям нужен платный план. См. Центр синхронизации.",
		many: "{count} вложениям нужен платный план. См. Центр синхронизации.",
		other: "{count} вложениям нужен платный план. См. Центр синхронизации.",
	},
	"{count} attempts": {
		one: "{count} попытка",
		few: "{count} попытки",
		many: "{count} попыток",
		other: "{count} попыток",
	},
	"{count} conflicts need resolution": {
		one: "{count} конфликт требует решения",
		few: "Обнаружено {count} конфликта, требующих решения",
		many: "{count} конфликтов требуют разрешения",
		other: "{count} конфликтов требуют разрешения",
	},
	"{count} conflicts to resolve.": {
		one: "{count} конфликт, требующий разрешения.",
		few: "{count} конфликта, которые необходимо разрешить.",
		many: "{count} конфликтов, которые необходимо разрешить.",
		other: "{count} конфликтов, которые необходимо разрешить.",
	},
	"{count} diverged": {
		one: "{count}. отличается",
		few: "{count} отличаются",
		many: "{count} различий",
		other: "{count} отличается",
	},
	'{count} failed. Run "{command}" for details.': {
		one: '{count} ошибка. Запустите "{command}", чтобы узнать подробности.',
		few: '{count} ошибки. Запустите "{command}", чтобы узнать подробности.',
		many: '{count} ошибок. Запустите "{command}", чтобы узнать подробности.',
		other: '{count} не удалось. Запустите "{command}", чтобы узнать подробности.',
	},
	"{count} files": {
		one: "{count} файл",
		few: "{count} файла",
		many: "{count} файлов",
		other: "{count} файла",
	},
	"{count} files could not sync.": {
		one: "Не удалось синхронизировать {count} файл.",
		few: "Не удалось синхронизировать {count} файла.",
		many: "Не удалось синхронизировать {count} файлов.",
		other: "{count} файлов не удалось синхронизировать.",
	},
	"{count} files not included in your plan": {
		one: "{count} файл не входят в ваш план",
		few: "{count} файла не входят в ваш план",
		many: "{count} файлов не входят в ваш план",
		other: "{count} файлов не входят в ваш план",
	},
	"{count} files queued": {
		one: "{count} файл в очереди",
		few: "{count} файла в очереди",
		many: "{count} файлов в очереди",
		other: "{count} файлов в очереди",
	},
	"{count} ignored": {
		one: "{count} пропущено",
		few: "{count} проигнорировано",
		many: "{count} проигнорировано",
		other: "{count} проигнорировано",
	},
	"{count} missing on server": {
		one: "{count} отсутствует на сервере",
		few: "{count} отсутствуют на сервере",
		many: "{count} файлов отсутствуют на сервере",
		other: "{count} отсутствует на сервере",
	},
	"{count} need attention": {
		one: "{count} требует внимания",
		few: "{count} требует внимания",
		many: "{count} требует внимания",
		other: "{count} требует внимания",
	},
	"{count} new": {
		one: "{count} новая",
		few: "{count} новых",
		many: "{count} новых",
		other: "{count} новых",
	},
	"{count} notes": {
		one: "{count} заметка",
		few: "{count} заметки",
		many: "{count} заметок",
		other: "{count} заметки",
	},
	"{count} notes did not sync (plan limit).": {
		one: "{count} заметка не синхронизированы (ограничение по плану).",
		few: "{count} заметки не синхронизированы (ограничение по плану).",
		many: "{count} заметок не синхронизированы (ограничение по плану).",
		other: "{count} заметки не синхронизированы (ограничение плана).",
	},
	"{count} only on server": {
		one: "{count} только на сервере",
		few: "{count} только на сервере",
		many: "{count} только на сервере",
		other: "{count} только на сервере",
	},
	"{count} queued — {reason}": {
		one: "{count} в очереди — {reason}",
		few: "{count} в очереди — {reason}",
		many: "{count} в очереди — {reason}",
		other: "{count} в очереди — {reason}",
	},
	"{count} retrying": {
		one: "{count} повторная попытка",
		few: "{count} повторные попытки",
		many: "{count} повторных попыток",
		other: "{count} повторных попыток",
	},
	"{desc} — should not be synced": "{desc} — не должно синхронизироваться",
	"{first} and {second}": "{first} и {second}",
	"{formatted} per day": "{formatted} в день",
	"{label} ({count} queued)": {
		one: "{label} ({count} в очереди)",
		few: "{label} ({count} в очереди)",
		many: "{label} ({count} в очереди)",
		other: "{label} ({count} в очереди)",
	},
	"{n} of 5": "{n} из 5",
	"▶ Watch on YouTube": "▶ Смотреть на YouTube",
	"⚙️ Advanced": "⚙️ Дополнительно",
	"⚠ Detected: {label}/ ({formatted} files)": "⚠ Обнаружено: {label} / ({formatted} файлов)",
	"✓ Engram server reachable (v{version})": "✓ Сервер Engram доступен (v{version})",
	"✓ {count} synced": {
		one: "✓ {count} синхронизировано",
		few: "✓ {count} синхронизировано",
		many: "✓ {count} синхронизировано",
		other: "✓ {count} синхронизировано",
	},
	"✕ {count} failed": {
		one: "✕ {count} ошибка",
		few: "✕ {count} ошибки",
		many: "✕ {count} неудачных попыток",
		other: "✕ {count} ошибка",
	},
	"✗ couldn't reach a server at this URL": "✗ Не удалось подключиться к серверу по этому адресу",
	"✗ server responded but isn't an Engram server": "✗ Сервер ответил, но это не сервер Engram",
	"⤳ {count} skipped (Free plan)": {
		one: "⤳ Пропущено {count} (бесплатный тариф)",
		few: "⤳ Пропущено {count} (бесплатный тариф)",
		many: "⤳ Пропущено {count} (бесплатный тариф)",
		other: "⤳ {count} пропущено (Бесплатный план)",
	},
	"👋 Welcome": "👋 Добро пожаловать",
	"💬 Feedback": "💬 Отзыв",
	"🔄 Sync Center": "🔄 Центр синхронизации",
	"🔌 Connection": "🔌 Соединение",
};

export default ru;
