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
};

export default ru;
