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
};

export default ru;
