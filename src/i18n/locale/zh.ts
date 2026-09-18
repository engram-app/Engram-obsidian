import type { Dict } from "..";

// 简体中文
//
// "Engram", "Sync Center" and "Engram settings" name UI surfaces that are still
// English, so they stay English here. Translating a label the user cannot find
// on screen is worse than leaving it.
const zh: Dict = {
	"Code copied!": "验证码已复制！",
	"Engram sync: syncing...": "Engram 同步：正在同步…",
	"Engram Sync: pulled {pulled}, pushed {pushed}":
		"Engram 同步：拉取 {pulled} 项，推送 {pushed} 项",
	"Engram: disconnected. Open Engram settings to reconnect.":
		"Engram：连接已断开。打开 Engram settings 重新连接。",
	"Engram sync: checking...": "Engram 同步：正在检查…",
	"Engram sync: everything in sync": "Engram 同步：全部已同步",
	"Engram sync: pulling all from server...": "Engram 同步：正在从服务器拉取全部内容…",
	"Engram Sync: pushed {pushed}": "Engram 同步：已推送 {pushed} 项",
	"Engram sync: sync failed": "Engram 同步：同步失败",
	"Engram: your login expired — open Engram settings to reconnect.":
		"Engram：登录已过期，请打开 Engram settings 重新连接。",
	"Engram: This vault has been deleted on the server.": "Engram：该知识库已在服务器上被删除。",
	"Engram Sync: pulled {pulled} (local extras deleted)":
		"Engram 同步：已拉取 {pulled} 项（本地多余文件已删除）",
	"Engram Sync: pulled {pulled}": "Engram 同步：已拉取 {pulled} 项",
	"Engram Sync: replaced remote with local ({pushed} uploaded)":
		"Engram 同步：已用本地内容替换服务器内容（上传 {pushed} 项）",
	"Engram: sync failed. Open the sync log for details.":
		"Engram：同步失败。打开同步日志查看详情。",
	"Engram unreachable. Showing matches from this device only.":
		"无法连接 Engram。仅显示本设备上的匹配结果。",
	"No source path for this result": "该结果没有对应的源文件路径",
	"Note not synced locally": "该笔记尚未同步到本地",
	"Engram: settings tab failed to render ({error})": "Engram：设置页渲染失败（{error}）",
	"File not found locally: {path}": "本地找不到该文件：{path}",
	"Restored {path} — will sync on next push.": "已恢复 {path}，将在下次推送时同步。",
	"Ignored {path} — won't sync until restored from Sync Center.":
		"已忽略 {path}，在 Sync Center 中恢复后才会同步。",
	"Added {pattern} to ignore patterns": "已将 {pattern} 加入忽略规则",
	"Engram backend changed — sign in again to continue.": "Engram 后端已更改，请重新登录以继续。",
	"Engram: sign-in failed ({error})": "Engram：登录失败（{error}）",
	"Enter an API key first": "请先输入 API 密钥",
	"Switched to {mode}.": "已切换到 {mode}。",

	"Engram Sync: pushed {count} files": "Engram 同步：已推送 {count} 个文件",
	"Engram Sync: pulled {count} files from server": "Engram 同步：已从服务器拉取 {count} 个文件",
	"Engram Sync: pulled {count} changes": "Engram 同步：已拉取 {count} 项更改",
	"Engram: {count} files failed to sync{detail} — open Sync Center":
		"Engram：{count} 个文件同步失败{detail}，请打开 Sync Center",
	"Engram: {count} attachments skipped — upgrade to sync images & PDFs.":
		"Engram：已跳过 {count} 个附件，升级后可同步图片和 PDF。",
	"Engram: plan upgraded — syncing {count} attachments…":
		"Engram：套餐已升级，正在同步 {count} 个附件…",
	// 402 limit reasons (limit-copy.ts). These gate payment, so they are the
	// highest-value strings in the plugin to get right.
	"Note limit reached. Upgrade to keep adding notes.": "已达笔记数量上限。升级后可继续添加笔记。",
	"Vault limit reached. Upgrade for more vaults.": "已达知识库数量上限。升级可创建更多知识库。",
	"This file type isn't accepted by this server.": "此服务器不接受该文件类型。",
	"Attachment sync is disabled for this account.": "此账号已停用附件同步。",
	"Attachment storage is full — upgrade for more.": "附件存储空间已满，升级可获得更多空间。",
	"File too large for your plan.": "文件超出你当前套餐的大小限制。",
	"Already signed in on another device. Upgrade for multi-device.":
		"已在另一台设备上登录。升级可支持多设备。",
	"Device swap cooldown active. Wait or upgrade.": "设备切换冷却中。请稍等或升级套餐。",
	"Too many connected Obsidian vaults. Disconnect one or upgrade.":
		"已连接的 Obsidian 知识库过多。请断开一个或升级套餐。",
	"Too many connected AI clients. Disconnect one or upgrade.":
		"已连接的 AI 客户端过多。请断开一个或升级套餐。",
	"Daily AI search limit reached. Free includes 20 per day across Obsidian, the web app and MCP. Upgrade for unlimited.":
		"已达每日 AI 搜索上限。免费版在 Obsidian、网页版和 MCP 之间每天共 20 次。升级后不限次数。",
	"API keys need Pro. Sign in with your Engram account instead.":
		"API 密钥需要 Pro 套餐。请改用 Engram 账号登录。",
	"Account suspended. Contact support.": "账号已被停用。请联系客服。",
	"Account setup incomplete.": "账号设置尚未完成。",
	"This account was deleted. Contact support if that is wrong.":
		"此账号已被删除。如有疑问请联系客服。",
	"Finish setting up your account at app.engram.page to start syncing.":
		"请前往 app.engram.page 完成账号设置后再开始同步。",
	"Limit reached. Upgrade to continue.": "已达使用上限。升级后可继续。",
};

export default zh;
