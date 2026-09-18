import type { Dict } from "..";

// 繁體中文
const zhTW: Dict = {
	"Code copied!": "驗證碼已複製！",
	"Engram sync: syncing...": "Engram 同步：正在同步…",
	"Engram Sync: pulled {pulled}, pushed {pushed}":
		"Engram 同步：拉取 {pulled} 項，推送 {pushed} 項",
	"Engram: disconnected. Open Engram settings to reconnect.":
		"Engram：連線已中斷。開啟 Engram settings 重新連線。",
	"Engram sync: checking...": "Engram 同步：正在檢查…",
	"Engram sync: everything in sync": "Engram 同步：全部已同步",
	"Engram sync: pulling all from server...": "Engram 同步：正在從伺服器拉取全部內容…",
	"Engram Sync: pushed {pushed}": "Engram 同步：已推送 {pushed} 項",
	"Engram sync: sync failed": "Engram 同步：同步失敗",
	"Engram: your login expired — open Engram settings to reconnect.":
		"Engram：登入已過期，請開啟 Engram settings 重新連線。",
	"Engram: This vault has been deleted on the server.": "Engram：此知識庫已在伺服器上被刪除。",
	"Engram Sync: pulled {pulled} (local extras deleted)":
		"Engram 同步：已拉取 {pulled} 項（本機多餘檔案已刪除）",
	"Engram Sync: pulled {pulled}": "Engram 同步：已拉取 {pulled} 項",
	"Engram Sync: replaced remote with local ({pushed} uploaded)":
		"Engram 同步：已用本機內容取代伺服器內容（上傳 {pushed} 項）",
	"Engram: sync failed. Open the sync log for details.":
		"Engram：同步失敗。開啟同步記錄檢視詳情。",
	"Engram unreachable. Showing matches from this device only.":
		"無法連線 Engram。僅顯示此裝置上的相符結果。",
	"No source path for this result": "此結果沒有對應的來源檔案路徑",
	"Note not synced locally": "此筆記尚未同步到本機",
	"Engram: settings tab failed to render ({error})": "Engram：設定頁繪製失敗（{error}）",
	"File not found locally: {path}": "本機找不到此檔案：{path}",
	"Restored {path} — will sync on next push.": "已還原 {path}，將於下次推送時同步。",
	"Ignored {path} — won't sync until restored from Sync Center.":
		"已忽略 {path}，在 Sync Center 中還原後才會同步。",
	"Added {pattern} to ignore patterns": "已將 {pattern} 加入忽略規則",
	"Engram backend changed — sign in again to continue.": "Engram 後端已變更，請重新登入以繼續。",
	"Engram: sign-in failed ({error})": "Engram：登入失敗（{error}）",
	"Enter an API key first": "請先輸入 API 金鑰",
	"Switched to {mode}.": "已切換至 {mode}。",

	"Engram Sync: pushed {count} files": "Engram 同步：已推送 {count} 個檔案",
	"Engram Sync: pulled {count} files from server": "Engram 同步：已從伺服器拉取 {count} 個檔案",
	"Engram Sync: pulled {count} changes": "Engram 同步：已拉取 {count} 項變更",
	"Engram: {count} files failed to sync{detail} — open Sync Center":
		"Engram：{count} 個檔案同步失敗{detail}，請開啟 Sync Center",
	"Engram: {count} attachments skipped — upgrade to sync images & PDFs.":
		"Engram：已略過 {count} 個附件，升級後可同步圖片與 PDF。",
	"Engram: plan upgraded — syncing {count} attachments…":
		"Engram：方案已升級，正在同步 {count} 個附件…",
};

export default zhTW;
