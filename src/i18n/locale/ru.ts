import type { Dict } from "..";

// Русский
//
// Russian has three plural categories (one/few/many), which is why the locale
// value for a counted string is a form map rather than a single template.
const ru: Dict = {
	"Code copied!": "Код скопирован.",
	"Engram sync: syncing...": "Engram Sync: синхронизация…",
	"Engram Sync: pulled {pulled}, pushed {pushed}":
		"Engram Sync: получено {pulled}, отправлено {pushed}",
	"Engram: disconnected. Open Engram settings to reconnect.":
		"Engram: соединение потеряно. Откройте Engram settings, чтобы подключиться заново.",
	"Engram sync: checking...": "Engram Sync: проверка…",
	"Engram sync: everything in sync": "Engram Sync: всё синхронизировано",
	"Engram sync: pulling all from server...": "Engram Sync: получаем всё с сервера…",
	"Engram Sync: pushed {pushed}": "Engram Sync: отправлено {pushed}",
	"Engram sync: sync failed": "Engram Sync: синхронизация не удалась",
	"Engram: your login expired — open Engram settings to reconnect.":
		"Engram: срок входа истёк. Откройте Engram settings, чтобы подключиться заново.",
	"Engram: This vault has been deleted on the server.":
		"Engram: это хранилище удалено на сервере.",
	"Engram Sync: pulled {pulled} (local extras deleted)":
		"Engram Sync: получено {pulled} (лишние локальные файлы удалены)",
	"Engram Sync: pulled {pulled}": "Engram Sync: получено {pulled}",
	"Engram Sync: replaced remote with local ({pushed} uploaded)":
		"Engram Sync: содержимое сервера заменено локальным (отправлено {pushed})",
	"Engram: sync failed. Open the sync log for details.":
		"Engram: синхронизация не удалась. Подробности в журнале синхронизации.",
	"Engram unreachable. Showing matches from this device only.":
		"Engram недоступен. Показаны совпадения только с этого устройства.",
	"No source path for this result": "Для этого результата нет пути к исходному файлу",
	"Note not synced locally": "Эта заметка ещё не синхронизирована на устройстве",
	"Engram: settings tab failed to render ({error})":
		"Engram: не удалось отобразить вкладку настроек ({error})",
	"File not found locally: {path}": "Файл не найден на устройстве: {path}",
	"Restored {path} — will sync on next push.":
		"{path} восстановлен, синхронизируется при следующей отправке.",
	"Ignored {path} — won't sync until restored from Sync Center.":
		"{path} игнорируется и не будет синхронизирован, пока вы не восстановите его в Sync Center.",
	"Added {pattern} to ignore patterns": "{pattern} добавлен в список исключений",
	"Engram backend changed — sign in again to continue.":
		"Сервер Engram изменился. Войдите снова, чтобы продолжить.",
	"Engram: sign-in failed ({error})": "Engram: не удалось войти ({error})",
	"Enter an API key first": "Сначала введите ключ API",
	"Switched to {mode}.": "Переключено на {mode}.",

	"Engram Sync: pushed {count} files": {
		one: "Engram Sync: отправлен {count} файл",
		few: "Engram Sync: отправлено {count} файла",
		many: "Engram Sync: отправлено {count} файлов",
		other: "Engram Sync: отправлено {count} файлов",
	},
	"Engram Sync: pulled {count} files from server": {
		one: "Engram Sync: получен {count} файл с сервера",
		few: "Engram Sync: получено {count} файла с сервера",
		many: "Engram Sync: получено {count} файлов с сервера",
		other: "Engram Sync: получено {count} файлов с сервера",
	},
	"Engram Sync: pulled {count} changes": {
		one: "Engram Sync: получено {count} изменение",
		few: "Engram Sync: получено {count} изменения",
		many: "Engram Sync: получено {count} изменений",
		other: "Engram Sync: получено {count} изменений",
	},
	"Engram: {count} files failed to sync{detail} — open Sync Center": {
		one: "Engram: {count} файл не синхронизирован{detail}. Откройте Sync Center",
		few: "Engram: {count} файла не синхронизированы{detail}. Откройте Sync Center",
		many: "Engram: {count} файлов не синхронизированы{detail}. Откройте Sync Center",
		other: "Engram: {count} файлов не синхронизированы{detail}. Откройте Sync Center",
	},
	"Engram: {count} attachments skipped — upgrade to sync images & PDFs.": {
		one: "Engram: пропущено {count} вложение. Для изображений и PDF нужен платный план.",
		few: "Engram: пропущено {count} вложения. Для изображений и PDF нужен платный план.",
		many: "Engram: пропущено {count} вложений. Для изображений и PDF нужен платный план.",
		other: "Engram: пропущено {count} вложений. Для изображений и PDF нужен платный план.",
	},
	"Engram: plan upgraded — syncing {count} attachments…": {
		one: "Engram: план обновлён, синхронизируем {count} вложение…",
		few: "Engram: план обновлён, синхронизируем {count} вложения…",
		many: "Engram: план обновлён, синхронизируем {count} вложений…",
		other: "Engram: план обновлён, синхронизируем {count} вложений…",
	},
	// 402 limit reasons (limit-copy.ts). These gate payment, so they are the
	// highest-value strings in the plugin to get right.
	"Note limit reached. Upgrade to keep adding notes.":
		"Достигнут предел числа заметок. После перехода на платный план можно добавлять ещё.",
	"Vault limit reached. Upgrade for more vaults.":
		"Достигнут предел числа хранилищ. На платном плане их больше.",
	"This file type isn't accepted by this server.": "Этот сервер не принимает такой тип файлов.",
	"Attachment sync is disabled for this account.":
		"Для этой учётной записи синхронизация вложений отключена.",
	"Attachment storage is full — upgrade for more.":
		"Место для вложений закончилось. На платном плане его больше.",
	"File too large for your plan.": "Файл слишком большой для вашего плана.",
	"Already signed in on another device. Upgrade for multi-device.":
		"Вы уже вошли на другом устройстве. На платном плане можно использовать несколько.",
	"Device swap cooldown active. Wait or upgrade.":
		"Смена устройства пока заблокирована. Подождите или перейдите на платный план.",
	"Too many connected Obsidian vaults. Disconnect one or upgrade.":
		"Подключено слишком много хранилищ Obsidian. Отключите одно или перейдите на платный план.",
	"Too many connected AI clients. Disconnect one or upgrade.":
		"Подключено слишком много ИИ-клиентов. Отключите один или перейдите на платный план.",
	"Daily AI search limit reached. Free includes 20 per day across Obsidian, the web app and MCP. Upgrade for unlimited.":
		"Достигнут дневной предел ИИ-поиска. На бесплатном плане это 20 запросов в день на Obsidian, веб-приложение и MCP вместе. На платном плане предела нет.",
	"API keys need Pro. Sign in with your Engram account instead.":
		"Ключи API доступны на плане Pro. Войдите через учётную запись Engram.",
	"Account suspended. Contact support.": "Учётная запись заблокирована. Напишите в поддержку.",
	"Account setup incomplete.": "Настройка учётной записи не завершена.",
	"This account was deleted. Contact support if that is wrong.":
		"Эта учётная запись удалена. Если это ошибка, напишите в поддержку.",
	"Finish setting up your account at app.engram.page to start syncing.":
		"Завершите настройку учётной записи на app.engram.page, чтобы начать синхронизацию.",
	"Limit reached. Upgrade to continue.":
		"Достигнут предел. Перейдите на платный план, чтобы продолжить.",
	// UI strings
	"Link Obsidian to Engram": "Подключить Obsidian к Engram",
	"Failed to start device flow. Check your Engram URL and try again.":
		"Не удалось начать привязку устройства. Проверьте адрес Engram и попробуйте снова.",
	"Your code:": "Ваш код:",
	"A browser window has opened. Sign in and enter this code to link your vault.":
		"Открылось окно браузера. Войдите и введите этот код, чтобы привязать хранилище.",
	Cancel: "Отмена",
	"Code expired. Please try again.": "Срок действия кода истёк. Попробуйте снова.",
	"Try again": "Повторить",
	Close: "Закрыть",
	"Note couldn't be processed": "Эту заметку не удалось обработать",
	"The server couldn't process this note. Check its contents, then edit and save to try again.":
		"Сервер не смог обработать эту заметку. Проверьте содержимое, затем измените и сохраните, чтобы повторить.",
	"Attachments need a paid plan": "Для вложений нужен платный план",
	"The Free tier syncs notes only. Upgrade to sync images and PDFs.":
		"Бесплатный план синхронизирует только заметки. Для изображений и PDF перейдите на платный план.",
	"Attachment storage full": "Место для вложений закончилось",
	"You've used all the attachment storage on your plan. Upgrade for more.":
		"Вы израсходовали всё место для вложений на своём плане. На платном плане его больше.",
	"Too large for the server": "Слишком большой файл для сервера",
	"The server limit is 5 MB. Compress or split the file, then it will sync.":
		"Предел сервера — 5 МБ. Сожмите или разделите файл, и он синхронизируется.",
	"Sign-in expired": "Срок входа истёк",
	"Reconnect your account to resume syncing.":
		"Подключите учётную запись заново, чтобы продолжить синхронизацию.",
	"Unresolved conflict": "Неразрешённый конфликт",
	"Open the file to resolve the conflict, then sync again.":
		"Откройте файл, разрешите конфликт и синхронизируйте снова.",
	"Frontmatter needs a fix": "Нужно поправить frontmatter",
	"The note synced, but its frontmatter could not be fully parsed. Open it to fix the highlighted line.":
		"Заметка синхронизирована, но её frontmatter не удалось прочитать полностью. Откройте её и поправьте выделенную строку.",
	"Server error": "Ошибка сервера",
	"A temporary server problem — retrying automatically.":
		"Временная проблема на сервере, повтор выполняется автоматически.",
	"Network unavailable": "Сеть недоступна",
	"Can't reach the server — retrying automatically.":
		"Сервер недостижим, повтор выполняется автоматически.",
	"Sync failed": "Синхронизация не удалась",
	"An unexpected error — retrying automatically.":
		"Неожиданная ошибка, повтор выполняется автоматически.",
	Upgrade: "Перейти на платный план",
	"Update in settings": "Обновить в настройках",
	"Engram: ready": "Engram: готово",
	"Resume sync": "Продолжить синхронизацию",
	"Engram Vault Sync {version} is available. {link}.":
		"Вышла версия Engram Vault Sync {version}. {link}.",
	"Search your vault…": "Поиск по хранилищу…",
	"Filter by folder…": "Фильтр по папке…",
	"Filter by tags…": "Фильтр по тегам…",
	"Search failed — check connection": "Поиск не удался, проверьте соединение",
	"No results found": "Ничего не найдено",
	"match strength: {pct}%": "Совпадение: {pct}%",
	"Open sync setup": "Открыть настройку синхронизации",
	"Last sync: {when}": "Последняя синхронизация: {when}",
	"waiting for a connection": "ожидание соединения",
	"sync is paused": "синхронизация приостановлена",
	"syncing now": "идёт синхронизация",
	"waiting to retry": "ожидание повтора",
	"{count} not on your plan": "{count} вне вашего плана",
	"{count} retrying": "{count} повторяются",
	"{count} ignored": "{count} игнорируются",
	"{count} queued — {reason}": "{count} в очереди, {reason}",
	"These files are fine. They just need a paid plan to sync.":
		"С этими файлами всё в порядке. Для синхронизации им нужен платный план.",
	"Show files ({count}) ▾": "Показать файлы ({count}) ▾",
	"Sync these now": "Синхронизировать их сейчас",
	"Clear all": "Очистить всё",
	"Nothing needs your attention. 🎉": "Ничего не требует вашего внимания. 🎉",
	Dismiss: "Скрыть",
	"Retry all now": "Повторить всё сейчас",
	"Temporary errors. These clear themselves once the server recovers.":
		"Временные ошибки. Они исчезнут сами, когда сервер восстановится.",
	Open: "Открыть",
	Ignore: "Игнорировать",
	"No files ignored. Use the ignore button on a failure row to stop syncing it.":
		"Игнорируемых файлов нет. Нажмите кнопку игнорирования в строке с ошибкой, чтобы перестать синхронизировать файл.",
	Restore: "Восстановить",
	Clear: "Очистить",
	"No activity yet. Push or pull to see entries here.":
		"Пока ничего не происходило. Отправьте или получите файлы, и здесь появятся записи.",
	"Sync log": "Журнал синхронизации",
	"Could not compare with the cloud. Check your connection.":
		"Не удалось сравнить с сервером. Проверьте соединение.",
	"Your login expired. Sign in again in Engram settings to continue.":
		"Срок входа истёк. Войдите заново в Engram settings, чтобы продолжить.",
	"Couldn't create vault — the name may be invalid or already in use.":
		"Не удалось создать хранилище: имя может быть недопустимым или уже занятым.",
	"Could not create the vault — check your connection and try again.":
		"Не удалось создать хранилище, проверьте соединение и попробуйте снова.",
	"Free syncs notes only — {count} attachments will be skipped.": {
		one: "Бесплатный план синхронизирует только заметки, {count} вложение будет пропущено.",
		few: "Бесплатный план синхронизирует только заметки, {count} вложения будут пропущены.",
		many: "Бесплатный план синхронизирует только заметки, {count} вложений будут пропущены.",
		other: "Бесплатный план синхронизирует только заметки, {count} вложений будут пропущены.",
	},
	"Comparing your vault with the cloud…": "Сравниваем ваше хранилище с сервером…",
	"Until you choose, nothing in this vault will sync.":
		"Пока вы не выберете, в этом хранилище ничего не синхронизируется.",
	"Change vault": "Сменить хранилище",
	"Advanced sync options": "Расширенные параметры синхронизации",
	"Everything is in sync": "Всё синхронизировано",
	" conflicts need resolution": {
		one: " конфликт требует решения",
		few: " конфликта требуют решения",
		many: " конфликтов требуют решения",
		other: " конфликтов требуют решения",
	},
	"Confirm destructive sync": "Подтвердите необратимую синхронизацию",
	"You are about to:": "Сейчас произойдёт следующее:",
	"Files that will be deleted:": "Файлы, которые будут удалены:",
	"This cannot be undone.": "Это нельзя отменить.",
	Back: "Назад",
	Confirm: "Подтвердить",
	"Switch vault": "Сменить хранилище",
	"Pick a vault to sync with. We will recalculate the sync preview after you choose.":
		"Выберите хранилище для синхронизации. После выбора мы пересчитаем предпросмотр.",
	"Loading vaults…": "Загружаем хранилища…",
	"No other vaults available.": "Других доступных хранилищ нет.",
	"Make new vault": "Создать хранилище",
	"New vault": "Новое хранилище",
	"Create a new empty vault on the server, then sync this Obsidian vault into it.":
		"Сначала создать на сервере пустое хранилище, затем синхронизировать в него это хранилище Obsidian.",
	Create: "Создать",
	"Your vault shares {percent} of its data with Engram":
		"Ваше хранилище совпадает с Engram на {percent} данных",
	"Type {keyword} to confirm:": "Введите {keyword} для подтверждения:",
	"✓ {count} synced": "✓ синхронизировано {count}",
	"⤳ {count} skipped (Free plan)": "⤳ пропущено {count} (бесплатный план)",
	"✕ {count} failed": "✕ не удалось {count}",
	"{count} attachments need a paid plan to sync. See Sync Center.": {
		one: "{count} вложению нужен платный план. См. Sync Center.",
		few: "{count} вложениям нужен платный план. См. Sync Center.",
		many: "{count} вложениям нужен платный план. См. Sync Center.",
		other: "{count} вложениям нужен платный план. См. Sync Center.",
	},
	"Syncing your vault": "Синхронизируем ваше хранилище",
	"Getting started…": "Начинаем…",
	"Open Engram to check your vault and confirm everything synced.":
		"Откройте Engram, посмотрите хранилище и убедитесь, что всё синхронизировалось.",
	"Open Engram": "Открыть Engram",
	"You can close this and the sync keeps running in the background.":
		"Это окно можно закрыть, синхронизация продолжится в фоне.",
	"Run in background": "Оставить в фоне",
	"Syncing…": "Синхронизация…",
	"Sync complete": "Синхронизация завершена",
	Done: "Готово",
	"Engram: sync conflict on {path} — your local edit was saved as {copy}":
		"Engram: конфликт синхронизации в {path}, ваша локальная правка сохранена как {copy}",
	"Open note": "Открыть заметку",
	"Engram: {count} notes have frontmatter problems. Open Sync Center to fix.":
		"Engram: у {count} заметок проблемы с frontmatter. Откройте Sync Center, чтобы исправить.",
	"New here? Watch the setup video": "Впервые здесь? Посмотрите видео по настройке",
	"What Engram does, and how to connect your vault, start to finish.":
		"Что делает Engram и как подключить хранилище, от начала до конца.",
	"▶ Watch on YouTube": "▶ Смотреть на YouTube",
	"1. Make an account": "1. Создайте учётную запись",
	"2. Connect your vault to Engram": "2. Подключите хранилище к Engram",
	"Open connection tab": "Открыть вкладку подключения",
	"3. Connect your AI": "3. Подключите свой ИИ",
	"Node.js dependencies": "Зависимости Node.js",
	"Python virtual environment": "Виртуальное окружение Python",
	"Python bytecode cache": "Кэш байт-кода Python",
	"Vendored dependencies": "Встроенные зависимости",
	"Gradle build cache": "Кэш сборки Gradle",
	"Rust/Java build output": "Результат сборки Rust/Java",
	"Build output": "Результат сборки",
	"Next.js build output": "Результат сборки Next.js",
	"Distribution build output": "Результат сборки для распространения",
	"Cargo cache": "Кэш Cargo",
	"CocoaPods dependencies": "Зависимости CocoaPods",
	"Dart tool cache": "Кэш инструментов Dart",
	"Generic cache directory": "Обычный каталог кэша",
	"Ignore patterns": "Правила исключения",
	"Custom patterns": "Свои правила",
	Diagnostics: "Диагностика",
	"Diagnostics detail": "Подробности диагностики",
	About: "О плагине",
	"License: {name}": "Лицензия: {name}",
	"⚠ Detected: {label}/ ({formatted} files)": "⚠ Обнаружено: {label}/ (файлов: {formatted})",
	"{desc} — should not be synced": "{desc}, синхронизировать не следует",
	"Add to ignores": "Добавить в исключения",
	"Version: {version}": "Версия: {version}",
	"Source: {link}": "Исходный код: {link}",
	"Engram URL": "Адрес Engram",
	"✓ Engram server reachable (v{version})": "✓ Сервер Engram доступен (v{version})",
	"✗ server responded but isn't an Engram backend": "✗ Сервер отвечает, но это не бэкенд Engram",
	"✗ couldn't reach a server at this URL": "✗ По этому адресу сервер недостижим",
	"Checking server…": "Проверяем сервер…",
	Authentication: "Аутентификация",
	"Authenticated via Engram account (OAuth).":
		"Вход выполнен через учётную запись Engram (OAuth).",
	"Manage account": "Управление учётной записью",
	"Sign out": "Выйти",
	"Using API key": "Используется ключ API",
	"Authenticated via manual API key.": "Вход выполнен по вручную указанному ключу API.",
	"Clear key": "Удалить ключ",
	"Switch to sign in": "Перейти ко входу",
	"Sign in or create an account": "Войдите или создайте учётную запись",
	"Sign in": "Войти",
	"API key": "Ключ API",
	Token: "Токен",
	"Bearer token from your Engram account.": "Токен Bearer из вашей учётной записи Engram.",
	Save: "Сохранить",
	"That does not look like an Engram API key (expected {prefix}…).":
		"Это не похоже на ключ API Engram (ожидается {prefix}…).",
	Vault: "Хранилище",
	"Vault selection": "Выбор хранилища",
	"Select which vault this plugin syncs with.":
		"Выберите, с каким хранилищем синхронизируется этот плагин.",
	"No vaults found — first sync will create one":
		"Хранилища не найдены, первая синхронизация создаст его",
	"Pick a vault": "Выберите хранилище",
	Change: "Изменить",
	"Support development": "Поддержать разработку",
	"GitHub Sponsors": "GitHub Sponsors",
	Backend: "Бэкенд",
	"Where this vault syncs to. Each backend keeps its own sign-in.":
		"Куда синхронизируется это хранилище. У каждого бэкенда свой вход.",
	"Run your own Engram server": "Свой сервер Engram",
	"Engram is the backend that powers sync and semantic search.":
		"Engram — это бэкенд, который обеспечивает синхронизацию и смысловой поиск.",
	"Finish sync setup": "Завершить настройку синхронизации",
	"Nothing in this vault syncs until you choose how to merge it with the server.":
		"Это хранилище ничего не синхронизирует, пока вы не выберете, как объединить его с сервером.",
	"Choose sync direction": "Выберите направление синхронизации",
	"Engram: this plugin is too old to sync (needs {version} or newer). Update it to continue.":
		"Engram: этот плагин слишком старый для синхронизации (нужна версия {version} или новее). Обновите его, чтобы продолжить.",
	"Engram: this plugin is too old to sync. Update it to continue.":
		"Engram: этот плагин слишком старый для синхронизации. Обновите его, чтобы продолжить.",
	Update: "Обновить",
	// UI strings (second pass)
	"Invalid API key": "Неверный ключ API",
	"Connection failed": "Не удалось подключиться",
	"Sync now": "Синхронизировать сейчас",
	"Disconnect (clear login)": "Отключить (удалить вход)",
	"Push entire vault": "Отправить всё хранилище",
	"Check sync status": "Проверить состояние синхронизации",
	"Engram sync: server does not support reconciliation (update backend)":
		"Engram: сервер не умеет сверять данные (обновите бэкенд)",
	"Pull all from server (force overwrite)": "Получить всё с сервера (перезапишет локальное)",
	"Show sync log": "Показать журнал синхронизации",
	"Semantic search": "Смысловой поиск",
	"Open search sidebar": "Открыть панель поиска",
	"Engram search": "Поиск Engram",
	"Open sync center": "Открыть Sync Center",
	"Engram: this vault no longer exists on the server. Pick or create a vault to continue.":
		"Engram: этого хранилища больше нет на сервере. Выберите или создайте хранилище, чтобы продолжить.",
	"Engram: recovered plugin settings from a backup after a corrupted save.":
		"Engram: настройки были повреждены и восстановлены из резервной копии.",
	"Engram sync: live sync requires a plugin update — please update the Engram vault sync plugin.":
		"Engram: для живой синхронизации нужно обновить плагин. Обновите Engram vault sync.",
	"Engram: sync is paused — this edit was not synced. Choose a sync direction to resume.":
		"Engram: синхронизация приостановлена, эта правка не отправлена. Выберите направление синхронизации, чтобы продолжить.",
	"Engram: not connected": "Engram: нет подключения",
	"Engram: signed out": "Engram: выполнен выход",
	"Not connected yet. Click to open settings and link this vault.":
		"Пока не подключено. Нажмите, чтобы открыть настройки и привязать это хранилище.",
	"Not signed in. Click to open settings and reconnect.":
		"Вход не выполнен. Нажмите, чтобы открыть настройки и подключиться заново.",
	"Engram: finish setup": "Engram: завершите настройку",
	"Engram: sync paused": "Engram: синхронизация приостановлена",
	"{label} ({count} queued)": "{label} (в очереди: {count})",
	"Setup is not finished — nothing will sync until you choose a sync direction. Click to finish.":
		"Настройка не завершена. Пока вы не выберете направление синхронизации, ничего не синхронизируется. Нажмите, чтобы завершить.",
	"Sync paused — click to choose a sync direction":
		"Синхронизация приостановлена, нажмите, чтобы выбрать направление",
	"Engram: offline ({count} queued)": "Engram: нет сети (в очереди: {count})",
	"Engram: offline": "Engram: нет сети",
	"Server unreachable — changes will sync when connected":
		"Сервер недоступен, изменения уйдут, как только появится связь",
	"Engram: error": "Engram: ошибка",
	"Unknown error": "Неизвестная ошибка",
	"Engram: syncing ({count})": "Engram: синхронизация ({count})",
	"Engram: syncing": "Engram: синхронизация",
	"Sync in progress...": "Идёт синхронизация…",
	"Engram: pending ({count})": "Engram: в ожидании ({count})",
	"{count} files queued": "{count} файлов в очереди",
	"Engram: live": "Engram: на связи",
	"WebSocket connected — live sync active": "WebSocket подключён, живая синхронизация работает",
	"Click to sync": "Нажмите, чтобы синхронизировать",
	Attachments: "Вложения",
	Keyword: "Ключевые слова",
	Semantic: "Смысл",
	Both: "Оба способа",
	"matches your words and their other forms — 'run' finds 'running' — plus this device.":
		"Находит ваши слова и их формы: по «бежать» найдётся и «бежит», плюс результаты с этого устройства.",
	"matches meaning. Finds notes that never use the words you typed.":
		"Находит по смыслу, в том числе заметки, где ваших слов нет вовсе.",
	"matches words and meaning together, plus this device. Widest results.":
		"Находит и по словам, и по смыслу, плюс это устройство. Самый широкий поиск.",
	"Clear search": "Очистить поиск",
	"Search settings": "Настройки поиска",
	Untitled: "Без названия",
	"meaning + exact": "смысл + точное совпадение",
	Disconnected: "Отключено",
	"Connected — waiting for first sync decision":
		"Подключено, ждём первого выбора направления синхронизации",
	"Connected — live sync active": "Подключено, живая синхронизация работает",
	"Connected — polling": "Подключено, периодические опросы",
	"Not configured": "Не настроено",
	Refresh: "Обновить",
	"Not synced on your plan ({count})": "Вне вашего плана ({count})",
	"Needs attention ({count})": "Требует внимания ({count})",
	"Retrying automatically ({count})": "Автоматически повторяем ({count})",
	Stats: "Статистика",
	"Notes on this device": "Заметки на этом устройстве",
	"Attachments on this device": "Вложения на этом устройстве",
	"Remote vault": "Хранилище на сервере",
	"not linked": "не привязано",
	"Plan usage": "Использование плана",
	"Safe choice: combines both sides, nothing is deleted.":
		"Безопасный выбор: объединяет обе стороны, ничего не удаляет.",
	"Already in sync. Nothing is deleted.": "Уже синхронизировано. Ничего не удаляется.",
	Sync: "Синхронизировать",
	"Upload local files without downloading the remote":
		"Отправить локальные файлы, ничего не получая с сервера",
	"Delete all on remote, then upload local files":
		"Удалить всё на сервере, затем отправить локальные файлы",
	"Download remote files without uploading the local":
		"Получить файлы с сервера, не отправляя локальные",
	"Delete all local files, then download from remote":
		"Удалить все локальные файлы, затем получить с сервера",
	"Set up sync for this vault": "Настроить синхронизацию этого хранилища",
	"You are now pointing at a different cloud vault":
		"Сейчас вы указываете на другое облачное хранилище",
	"Sync preview": "Предпросмотр синхронизации",
	"Start syncing": "Начать синхронизацию",
	"Upload everything": "Отправить всё",
	"Nothing will be removed from this device.": "С этого устройства ничего не будет удалено.",
	"Download everything": "Получить всё",
	"Not now": "Позже",
	"This vault": "Это хранилище",
	"Cloud server": "Хранилище на сервере",
	"Vault name": "Название хранилища",
	"Could not load vaults": "Не удалось загрузить хранилища",
	"Enter a name for the new vault": "Введите название нового хранилища",
	"Failed to switch vault": "Не удалось сменить хранилище",
	"Finished with some errors. Open the sync log to see what failed.":
		"Завершено, но были ошибки. Откройте журнал синхронизации, чтобы увидеть, что не удалось.",
	"Synced. Some attachments need a paid plan to sync (see below).":
		"Синхронизировано. Часть вложений требует платного плана (см. ниже).",
	"All synced. Your vault and the cloud now match.":
		"Всё синхронизировано. Хранилище и облако совпадают.",
	"Already up to date. Nothing needed syncing.": "Уже актуально. Синхронизировать было нечего.",
	Deleting: "Удаление",
	Downloading: "Загрузка",
	Uploading: "Отправка",
	"Syncing attachments": "Синхронизация вложений",
	Complete: "Готово",
	"Getting set up": "Начало работы",
	"setup guide": "руководство по настройке",
	"Sign in (or enter your server URL and key) on the connection tab, then run your first sync.":
		"Войдите на вкладке подключения (или укажите адрес сервера и ключ), затем выполните первую синхронизацию.",
	"See the AI setup guide": "Открыть руководство по настройке ИИ",
	Plans: "Планы",
	Free: "Бесплатно",
	"1 vault, 2 devices": "1 хранилище, 2 устройства",
	"Real-time sync": "Синхронизация в реальном времени",
	"2,000 notes searchable": "Поиск по 2 000 заметок",
	"Connect any AI (MCP)": "Подключение любого ИИ (MCP)",
	Starter: "Starter",
	"10 vaults, unlimited devices": "10 хранилищ, устройства без ограничений",
	"Search all your notes": "Поиск по всем заметкам",
	"10 GB attachments": "10 ГБ вложений",
	"Unlimited AI searches": "ИИ-поиск без ограничений",
	Pro: "Pro",
	"Unlimited vaults": "Хранилища без ограничений",
	"Search across all vaults at once": "Поиск сразу по всем хранилищам",
	"50 GB attachments": "50 ГБ вложений",
	"API access": "Доступ к API",
	"See full pricing": "Посмотреть все цены",
	"Learn more": "Подробнее",
	"Errors only": "Только ошибки",
	"Warnings and errors": "Предупреждения и ошибки",
	"Info (default)": "Информация (по умолчанию)",
	"Debug (verbose)": "Отладка (подробно)",
	"Or authenticate with a token instead of signing in.":
		"Или пройдите проверку по токену вместо входа в учётную запись.",
	"If this plugin saves you time, consider supporting development.":
		"Если этот плагин экономит вам время, подумайте о поддержке разработки.",
	"Sign-in required to load vaults": "Чтобы загрузить хранилища, нужно войти",
	"Could not reach Engram — check connection": "Engram недоступен, проверьте соединение",
	// UI strings (sync error surfaces)
	"Free syncs notes only — images & PDFs need a paid plan.":
		"Бесплатный план синхронизирует только заметки: для изображений и PDF нужен платный план.",
	"Pull all (delete extras) aborted: could not obtain an exclusive server snapshot (replay contention). Nothing was trashed.":
		"«Получить всё (удалить лишнее)» прервано: не удалось получить исключительный снимок сервера (конфликт воспроизведения). Ничего не удалено.",
	"Pull all aborted: another sync is running (replay contention). Try again when it finishes.":
		"«Получить всё» прервано: выполняется другая синхронизация (конфликт воспроизведения). Повторите, когда она закончится.",
	"Pull all failed: {error}": "«Получить всё» не удалось: {error}",
	"Pull all failed": "«Получить всё» не удалось",
	// UI strings (third pass)
	"Click to copy": "Нажмите, чтобы скопировать",
	"Waiting for authorization — connected, this will complete instantly.":
		"Ожидание авторизации: связь есть, всё произойдёт сразу.",
	"Waiting for authorization — no live connection, checking every 30s.":
		"Ожидание авторизации: живого подключения нет, проверяем каждые 30 с.",
	'Engram Sync: sync state for "{name}" was unreadable — using the on-disk copy.':
		"Engram Sync: не удалось прочитать состояние синхронизации для «{name}», берём копию с диска.",
	"{formatted} files · ": {
		one: "{formatted} файл · ",
		few: "{formatted} файла · ",
		many: "{formatted} файлов · ",
		other: "{formatted} файла · ",
	},
	"Notes searchable": "Заметок доступно для поиска",
	"Notes past this still sync and open normally, they are just not in the search index. The index keeps your oldest notes, so it is your newest ones that fall outside.":
		"Заметки сверх этого по-прежнему синхронизируются и открываются как обычно, их просто нет в поисковом индексе. Индекс хранит самые старые заметки, поэтому за его пределами оказываются самые новые.",
	"Notes stored": "Заметок сохранено",
	"AI searches": "ИИ-поиски",
	"{formatted} per day": "{formatted} в день",
	"Engram indexes {indexed} of your {all} notes. The rest match on this device only. Upgrade to index everything.":
		"Engram проиндексировал {indexed} из ваших {all} заметок. Остальные находятся только на этом устройстве. Обновите план, чтобы индексировать всё.",
	"Searching {indexed} of {all} notes. Upgrade to search everything.":
		"Поиск по {indexed} из {all} заметок. Обновите план, чтобы искать по всем.",
	"Remove tag {tag}": "Убрать тег {tag}",
	"👋 Welcome": "👋 Добро пожаловать",
	"🔌 Connection": "🔌 Подключение",
	"🔄 Sync Center": "🔄 Sync Center",
	"⚙️ Advanced": "⚙️ Дополнительно",
	"Error: {error}": "Ошибка: {error}",
	unknown: "неизвестно",
	"{count} need attention": {
		one: "{count} требует внимания",
		other: "{count} требуют внимания",
	},
	"Uploads {up}, downloads {down}.": "Отправит {up}, получит {down}.",
	"Uploads {count}.": "Отправит {count}.",
	"Downloads {count}.": "Получит {count}.",
	"{count} conflicts to resolve.": {
		one: "{count} конфликт нужно решить.",
		few: "{count} конфликта нужно решить.",
		many: "{count} конфликтов нужно решить.",
		other: "{count} конфликта нужно решить.",
	},
	"Nothing is deleted.": "Ничего не удаляется.",
	"Delete all {count} files currently on the server": {
		one: "Удалить {count} файл, который сейчас на сервере",
		few: "Удалить все {count} файла, которые сейчас на сервере",
		many: "Удалить все {count} файлов, которые сейчас на сервере",
		other: "Удалить все {count} файла, которые сейчас на сервере",
	},
	"Upload {count} files from this vault": {
		one: "Отправить {count} файл из этого хранилища",
		few: "Отправить {count} файла из этого хранилища",
		many: "Отправить {count} файлов из этого хранилища",
		other: "Отправить {count} файла из этого хранилища",
	},
	"Delete all {count} files in this vault": {
		one: "Удалить {count} файл в этом хранилище",
		few: "Удалить все {count} файла в этом хранилище",
		many: "Удалить все {count} файлов в этом хранилище",
		other: "Удалить все {count} файла в этом хранилище",
	},
	"Download {count} files from the server": {
		one: "Получить {count} файл с сервера",
		few: "Получить {count} файла с сервера",
		many: "Получить {count} файлов с сервера",
		other: "Получить {count} файла с сервера",
	},
	"Nothing to sync yet — this vault is empty on both sides. Start syncing and everything you write appears on your other devices.":
		"Пока синхронизировать нечего, это хранилище пусто с обеих сторон. Начните синхронизацию, и всё, что вы напишете, появится на других устройствах.",
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
		other: "{count} вложения",
	},
	"{first} and {second}": "{first} и {second}",
	files: "файлы",
	"This vault is empty on the server. Upload your {what}?":
		"На сервере это хранилище пусто. Отправить ваши {what}?",
	"This device's vault is empty. Download {what} from the server?":
		"Хранилище на этом устройстве пусто. Получить {what} с сервера?",
	notes: "заметки",
	attachments: "вложения",
	folders: "папки",
	"Uploading {count}.": "Отправка {count}.",
	"Downloading {count}.": "Загрузка {count}.",
	"Deleting {count} local files.": "Удаление {count} локальных файлов.",
	"Deleting {count} on the cloud.": "Удаление {count} в облаке.",
	"First sync, this may take a moment.":
		"Первая синхронизация, это может занять немного времени.",
	"Checking for changes.": "Проверяем изменения.",
	"Nothing will be deleted.": "Ничего не будет удалено.",
	'{count} failed. Run "{command}" for details.':
		"{count} не удалось. Выполните «{command}», чтобы увидеть подробности.",
	'Engram Sync: renamed "{name}" (unsupported characters)':
		"Engram Sync: «{name}» переименован (неподдерживаемые символы)",
	'Engram: frontmatter problem in "{name}"': "Engram: проблема с frontmatter в «{name}»",
	"Create a hosted account at ": "Создайте учётную запись на ",
	", or self-host the backend (": " или разверните бэкенд сами (",
	"Link Claude, Cursor, ChatGPT, or any MCP app so it can read and write your notes. ":
		"Подключите Claude, Cursor, ChatGPT или любое MCP-приложение, чтобы оно могло читать и писать ваши заметки. ",
	Documentation: "Документация",
	"AI / MCP setup guide": "Руководство по настройке ИИ / MCP",
	"Report an issue": "Сообщить о проблеме",
	"Join our Discord": "Присоединяйтесь к нашему Discord",
	"Paths to skip (one per line). Folder patterns end with /. Built-in: {configDir}/, .trash/, .git/":
		"Пути, которые нужно пропускать (по одному в строке). Шаблоны папок заканчиваются на /. Встроенные: {configDir}/, .trash/, .git/",
	"Send detailed sync, vault, and connection activity to the server for troubleshooting, with distributed tracing on requests. Metadata only, never note content. Leave off for normal use.":
		"Отправляет на сервер подробные данные о синхронизации, хранилище и подключении для диагностики, с распределённой трассировкой запросов. Только метаданные, никогда содержимое заметок. При обычной работе оставьте выключенным.",
	"Minimum severity that ships while diagnostics are on. Higher levels send fewer lines. Default: Info.":
		"Минимальный уровень, который отправляется при включённой диагностике. Чем выше уровень, тем меньше строк. По умолчанию: информация.",
	"Signed in as {email}": "Вход выполнен как {email}",
	"Pick a vault (previous: '{name}' not found)":
		"Выберите хранилище (предыдущее, «{name}», не найдено)",
	"Pick a vault (previous: id {id} not found)":
		"Выберите хранилище (предыдущий id {id} не найден)",
	"Server error ({status}) — check Engram logs":
		"Ошибка сервера ({status}), посмотрите журналы Engram",
	"Request failed ({status})": "Запрос не выполнен ({status})",
	"Engram Cloud": "Engram Cloud",
	"Self-hosted": "Своя установка",
	"{count} attempts": {
		one: "{count} попытка",
		few: "{count} попытки",
		many: "{count} попыток",
		other: "{count} попытки",
	},
	// UI strings (fourth pass)
	"{count} missing on server": "{count} нет на сервере",
	"{count} diverged": "{count} с расхождениями",
	"{count} only on server": "{count} только на сервере",
	"Engram Sync: {details}": "Engram Sync: {details}",
	"Engram: plugin settings file was corrupted and could not be recovered. You may need to reconnect in settings.":
		"Engram: файл настроек плагина был повреждён и его не удалось восстановить. Возможно, придётся заново подключиться в настройках.",
	"Engram: sync is not set up yet, so nothing in this vault will sync.":
		"Engram: синхронизация ещё не настроена, поэтому ничего из этого хранилища синхронизироваться не будет.",
	"Click the Engram item in the status bar to pick up where you left off.":
		"Нажмите на Engram в строке состояния, чтобы продолжить с того места, где остановились.",
	"Engram: ⚠ {count} sync errors": {
		one: "Engram: ⚠ {count} ошибка синхронизации",
		few: "Engram: ⚠ {count} ошибки синхронизации",
		many: "Engram: ⚠ {count} ошибок синхронизации",
		other: "Engram: ⚠ {count} ошибки синхронизации",
	},
	"sync failed": "синхронизация не удалась",
	"That does not look like a complete server address. Include the scheme, for example http://127.0.0.1:4000":
		"Это не похоже на полный адрес сервера. Укажите схему, например http://127.0.0.1:4000",
	"Opens your browser to sign in, or create an account if you don't have one yet, then links this vault.":
		"Откроет браузер для входа, а если учётной записи ещё нет, её можно создать, после чего это хранилище будет привязано.",
	"Or authenticate with a token instead of signing in. Engram Cloud API keys require the Pro plan; on Free and Starter, sign in above.":
		"Или пройдите проверку по токену вместо входа. Ключи API для Engram Cloud доступны на плане Pro; на Free и Starter войдите выше.",
	"No sync activity this session.": "В этой сессии не было синхронизации.",
	"Showing {count} entries": {
		one: "Показана {count} запись",
		few: "Показаны {count} записи",
		many: "Показано {count} записей",
		other: "Показаны {count} записи",
	},
	"({count} errors)": {
		one: "({count} ошибка)",
		few: "({count} ошибки)",
		many: "({count} ошибок)",
		other: "({count} ошибки)",
	},
	"Frontmatter could not be parsed": "Не удалось разобрать frontmatter",
	"Not connected. Enter your Engram server URL below to start syncing.":
		"Нет подключения. Укажите ниже адрес вашего сервера Engram, чтобы начать синхронизацию.",
};

export default ru;
