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
	// 402 limit reasons (limit-copy.ts). These gate payment, so they are the
	// highest-value strings in the plugin to get right.
	"Note limit reached. Upgrade to keep adding notes.": "已達筆記數量上限。升級後可繼續新增筆記。",
	"Vault limit reached. Upgrade for more vaults.": "已達知識庫數量上限。升級可建立更多知識庫。",
	"This file type isn't accepted by this server.": "此伺服器不接受該檔案類型。",
	"Attachment sync is disabled for this account.": "此帳號已停用附件同步。",
	"Attachment storage is full — upgrade for more.": "附件儲存空間已滿，升級可取得更多空間。",
	"File too large for your plan.": "檔案超出你目前方案的大小限制。",
	"Already signed in on another device. Upgrade for multi-device.":
		"已在另一台裝置上登入。升級可支援多裝置。",
	"Device swap cooldown active. Wait or upgrade.": "裝置切換冷卻中。請稍候或升級方案。",
	"Too many connected Obsidian vaults. Disconnect one or upgrade.":
		"已連線的 Obsidian 知識庫過多。請斷開一個或升級方案。",
	"Too many connected AI clients. Disconnect one or upgrade.":
		"已連線的 AI 用戶端過多。請斷開一個或升級方案。",
	"Daily AI search limit reached. Free includes 20 per day across Obsidian, the web app and MCP. Upgrade for unlimited.":
		"已達每日 AI 搜尋上限。免費版在 Obsidian、網頁版與 MCP 之間每天共 20 次。升級後不限次數。",
	"API keys need Pro. Sign in with your Engram account instead.":
		"API 金鑰需要 Pro 方案。請改用 Engram 帳號登入。",
	"Account suspended. Contact support.": "帳號已被停用。請聯絡客服。",
	"Account setup incomplete.": "帳號設定尚未完成。",
	"This account was deleted. Contact support if that is wrong.":
		"此帳號已被刪除。如有疑問請聯絡客服。",
	"Finish setting up your account at app.engram.page to start syncing.":
		"請前往 app.engram.page 完成帳號設定後再開始同步。",
	"Limit reached. Upgrade to continue.": "已達使用上限。升級後可繼續。",
	// UI strings
	"Link Obsidian to Engram": "將 Obsidian 連接到 Engram",
	"Failed to start device flow. Check your Engram URL and try again.":
		"裝置授權啟動失敗。請檢查 Engram 伺服器網址後重試。",
	"Your code:": "你的驗證碼：",
	"A browser window has opened. Sign in and enter this code to link your vault.":
		"已開啟瀏覽器視窗。請登入並輸入此驗證碼來連結你的知識庫。",
	Cancel: "取消",
	"Code expired. Please try again.": "驗證碼已過期，請重試。",
	"Try again": "重試",
	Close: "關閉",
	"Note couldn't be processed": "這則筆記無法處理",
	"The server couldn't process this note. Check its contents, then edit and save to try again.":
		"伺服器無法處理這則筆記。請檢查內容後編輯並儲存以重試。",
	"Attachments need a paid plan": "附件需要付費方案",
	"The Free tier syncs notes only. Upgrade to sync images and PDFs.":
		"免費版僅同步筆記。升級後可同步圖片與 PDF。",
	"Attachment storage full": "附件儲存空間已滿",
	"You've used all the attachment storage on your plan. Upgrade for more.":
		"你已用完目前方案的附件儲存空間。升級可取得更多。",
	"Too large for the server": "超出伺服器大小限制",
	"The server limit is 5 MB. Compress or split the file, then it will sync.":
		"伺服器上限為 5 MB。壓縮或分割該檔案後即可同步。",
	"Sign-in expired": "登入已過期",
	"Reconnect your account to resume syncing.": "重新連接帳號即可繼續同步。",
	"Unresolved conflict": "衝突尚未解決",
	"Open the file to resolve the conflict, then sync again.": "開啟檔案解決衝突，然後重新同步。",
	"Frontmatter needs a fix": "frontmatter 需要修正",
	"The note synced, but its frontmatter could not be fully parsed. Open it to fix the highlighted line.":
		"筆記已同步，但其 frontmatter 未能完整解析。開啟筆記修正標示的那一行。",
	"Server error": "伺服器錯誤",
	"A temporary server problem — retrying automatically.": "伺服器暫時故障，正在自動重試。",
	"Network unavailable": "網路不可用",
	"Can't reach the server — retrying automatically.": "無法連線伺服器，正在自動重試。",
	"Sync failed": "同步失敗",
	"An unexpected error — retrying automatically.": "發生意外錯誤，正在自動重試。",
	Upgrade: "升級",
	"Update in settings": "在設定中更新",
	"Engram: ready": "Engram：就緒",
	"Resume sync": "恢復同步",
	"Engram Vault Sync {version} is available. {link}.":
		"Engram Vault Sync {version} 已發布。{link}。",
	"Search your vault…": "搜尋你的知識庫…",
	"Filter by folder…": "依資料夾篩選…",
	"Filter by tags…": "依標籤篩選…",
	"Search failed — check connection": "搜尋失敗，請檢查網路連線",
	"No results found": "找不到結果",
	"match strength: {pct}%": "相符度：{pct}%",
	"Open sync setup": "開啟同步設定",
	"Last sync: {when}": "上次同步：{when}",
	"waiting for a connection": "等待網路連線",
	"sync is paused": "同步已暫停",
	"syncing now": "正在同步",
	"waiting to retry": "等待重試",
	"{count} not on your plan": "{count} 項不在你的方案內",
	"{count} retrying": "{count} 項正在重試",
	"{count} ignored": "{count} 項已忽略",
	"{count} queued — {reason}": "{count} 項排隊中，{reason}",
	"These files are fine. They just need a paid plan to sync.":
		"這些檔案本身沒問題，只是需要付費方案才能同步。",
	"Show files ({count}) ▾": "顯示檔案（{count}）▾",
	"Sync these now": "立即同步這些檔案",
	"Clear all": "全部清除",
	"Nothing needs your attention. 🎉": "沒有需要你處理的事項。🎉",
	Dismiss: "忽略此提示",
	"Retry all now": "立即全部重試",
	"Temporary errors. These clear themselves once the server recovers.":
		"暫時性錯誤。伺服器恢復後會自動清除。",
	Open: "開啟",
	Ignore: "忽略",
	"No files ignored. Use the ignore button on a failure row to stop syncing it.":
		"沒有被忽略的檔案。在失敗的項目上按下忽略按鈕即可停止同步該檔案。",
	Restore: "還原",
	Clear: "清除",
	"No activity yet. Push or pull to see entries here.": "尚無記錄。推送或拉取後這裡會顯示項目。",
	"Sync log": "同步記錄",
	"Could not compare with the cloud. Check your connection.":
		"無法與伺服器比對。請檢查網路連線。",
	"Your login expired. Sign in again in Engram settings to continue.":
		"登入已過期。請在 Engram settings 中重新登入以繼續。",
	"Couldn't create vault — the name may be invalid or already in use.":
		"無法建立知識庫，名稱可能無效或已被使用。",
	"Could not create the vault — check your connection and try again.":
		"無法建立知識庫，請檢查網路連線後重試。",
	"Free syncs notes only — {count} attachments will be skipped.":
		"免費版僅同步筆記，將略過 {count} 個附件。",
	"Comparing your vault with the cloud…": "正在比對你的知識庫與伺服器…",
	"Until you choose, nothing in this vault will sync.":
		"在你做出選擇前，此知識庫不會同步任何內容。",
	"Change vault": "更換知識庫",
	"Advanced sync options": "進階同步選項",
	"Everything is in sync": "全部已同步",
	" conflicts need resolution": " 項衝突需要解決",
	"Confirm destructive sync": "確認執行破壞性同步",
	"You are about to:": "你即將：",
	"Files that will be deleted:": "將被刪除的檔案：",
	"This cannot be undone.": "此操作無法復原。",
	Back: "返回",
	Confirm: "確認",
	"Switch vault": "切換知識庫",
	"Pick a vault to sync with. We will recalculate the sync preview after you choose.":
		"選擇要同步的知識庫。選定後我們會重新計算同步預覽。",
	"Loading vaults…": "正在載入知識庫…",
	"No other vaults available.": "沒有其他可用的知識庫。",
	"Make new vault": "新建知識庫",
	"New vault": "新知識庫",
	"Create a new empty vault on the server, then sync this Obsidian vault into it.":
		"先在伺服器上建立一個空知識庫，再把這個 Obsidian 知識庫同步進去。",
	Create: "建立",
	"Your vault shares {percent} of its data with Engram":
		"你的知識庫與 Engram 有 {percent} 的資料相同",
	"Type {keyword} to confirm:": "輸入 {keyword} 以確認：",
	"✓ {count} synced": "✓ 已同步 {count} 項",
	"⤳ {count} skipped (Free plan)": "⤳ 已略過 {count} 項（免費版）",
	"✕ {count} failed": "✕ 失敗 {count} 項",
	"{count} attachments need a paid plan to sync. See Sync Center.":
		"{count} 個附件需要付費方案才能同步。請查看 Sync Center。",
	"Syncing your vault": "正在同步你的知識庫",
	"Getting started…": "正在開始…",
	"Open Engram to check your vault and confirm everything synced.":
		"開啟 Engram 查看你的知識庫，確認全部已同步。",
	"Open Engram": "開啟 Engram",
	"You can close this and the sync keeps running in the background.":
		"你可以關閉此視窗，同步會在背景繼續。",
	"Run in background": "在背景執行",
	"Syncing…": "正在同步…",
	"Sync complete": "同步完成",
	Done: "完成",
	"Engram: sync conflict on {path} — your local edit was saved as {copy}":
		"Engram：{path} 發生同步衝突，你的本機修改已另存為 {copy}",
	"Open note": "開啟筆記",
	"Engram: {count} notes have frontmatter problems. Open Sync Center to fix.":
		"Engram：{count} 則筆記的 frontmatter 有問題。請開啟 Sync Center 修正。",
	"New here? Watch the setup video": "初次使用？觀看設定影片",
	"What Engram does, and how to connect your vault, start to finish.":
		"Engram 能做什麼，以及如何從頭到尾連接你的知識庫。",
	"▶ Watch on YouTube": "▶ 在 YouTube 上觀看",
	"1. Make an account": "1. 註冊帳號",
	"2. Connect your vault to Engram": "2. 將知識庫連接到 Engram",
	"Open connection tab": "開啟連線標籤頁",
	"3. Connect your AI": "3. 連接你的 AI",
	"Node.js dependencies": "Node.js 相依套件",
	"Python virtual environment": "Python 虛擬環境",
	"Python bytecode cache": "Python 位元碼快取",
	"Vendored dependencies": "內含相依套件（vendor）",
	"Gradle build cache": "Gradle 建置快取",
	"Rust/Java build output": "Rust/Java 建置輸出",
	"Build output": "建置輸出",
	"Next.js build output": "Next.js 建置輸出",
	"Distribution build output": "發布建置輸出",
	"Cargo cache": "Cargo 快取",
	"CocoaPods dependencies": "CocoaPods 相依套件",
	"Dart tool cache": "Dart 工具快取",
	"Generic cache directory": "通用快取目錄",
	"Ignore patterns": "忽略規則",
	"Custom patterns": "自訂規則",
	Diagnostics: "診斷資訊",
	"Diagnostics detail": "診斷詳情",
	About: "關於",
	"License: {name}": "授權條款：{name}",
	"⚠ Detected: {label}/ ({formatted} files)": "⚠ 偵測到：{label}/（{formatted} 個檔案）",
	"{desc} — should not be synced": "{desc}，不應同步",
	"Add to ignores": "加入忽略規則",
	"Version: {version}": "版本：{version}",
	"Source: {link}": "原始碼：{link}",
	"Engram URL": "Engram 伺服器網址",
	"✓ Engram server reachable (v{version})": "✓ Engram 伺服器可連線（v{version}）",
	"✗ server responded but isn't an Engram backend": "✗ 伺服器有回應，但不是 Engram 後端",
	"✗ couldn't reach a server at this URL": "✗ 無法連線到此網址的伺服器",
	"Checking server…": "正在檢查伺服器…",
	Authentication: "身分驗證",
	"Authenticated via Engram account (OAuth).": "已透過 Engram 帳號驗證（OAuth）。",
	"Manage account": "管理帳號",
	"Sign out": "登出",
	"Using API key": "使用 API 金鑰",
	"Authenticated via manual API key.": "已透過手動填寫的 API 金鑰驗證。",
	"Clear key": "清除金鑰",
	"Switch to sign in": "改用帳號登入",
	"Sign in or create an account": "登入或註冊帳號",
	"Sign in": "登入",
	"API key": "API 金鑰",
	Token: "權杖",
	"Bearer token from your Engram account.": "來自你的 Engram 帳號的 Bearer 權杖。",
	Save: "儲存",
	"That does not look like an Engram API key (expected {prefix}…).":
		"這看起來不像 Engram 的 API 金鑰（應以 {prefix} 開頭）。",
	Vault: "知識庫",
	"Vault selection": "知識庫選擇",
	"Select which vault this plugin syncs with.": "選擇此外掛要同步的知識庫。",
	"No vaults found — first sync will create one": "找不到知識庫，第一次同步時會自動建立一個",
	"Pick a vault": "選擇一個知識庫",
	Change: "變更",
	"Support development": "支持開發",
	"GitHub Sponsors": "GitHub Sponsors",
	Backend: "後端",
	"Where this vault syncs to. Each backend keeps its own sign-in.":
		"此知識庫同步到哪裡。每個後端各自保存登入狀態。",
	"Run your own Engram server": "自建 Engram 伺服器",
	"Engram is the backend that powers sync and semantic search.":
		"Engram 是驅動同步與語意搜尋的後端。",
	"Finish sync setup": "完成同步設定",
	"Nothing in this vault syncs until you choose how to merge it with the server.":
		"在你選擇如何與伺服器合併之前，此知識庫不會同步任何內容。",
	"Choose sync direction": "選擇同步方向",
	"Engram: this plugin is too old to sync (needs {version} or newer). Update it to continue.":
		"Engram：此外掛版本過舊，無法同步（需要 {version} 或更新版本）。請更新後繼續。",
	"Engram: this plugin is too old to sync. Update it to continue.":
		"Engram：此外掛版本過舊，無法同步。請更新後繼續。",
	Update: "更新",
};

export default zhTW;
