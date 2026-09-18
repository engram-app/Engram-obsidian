import type { Dict } from "..";

// 日本語
const ja: Dict = {
	"Code copied!": "コードをコピーしました。",
	"Engram sync: syncing...": "Engram 同期: 同期中…",
	"Engram Sync: pulled {pulled}, pushed {pushed}":
		"Engram 同期: {pulled} 件を取得、{pushed} 件を送信",
	"Engram: disconnected. Open Engram settings to reconnect.":
		"Engram: 接続が切れました。Engram settings を開いて再接続してください。",
	"Engram sync: checking...": "Engram 同期: 確認中…",
	"Engram sync: everything in sync": "Engram 同期: すべて同期済みです",
	"Engram sync: pulling all from server...": "Engram 同期: サーバーからすべて取得しています…",
	"Engram Sync: pushed {pushed}": "Engram 同期: {pushed} 件を送信しました",
	"Engram sync: sync failed": "Engram 同期: 同期に失敗しました",
	"Engram: your login expired — open Engram settings to reconnect.":
		"Engram: ログインの有効期限が切れました。Engram settings を開いて再接続してください。",
	"Engram: This vault has been deleted on the server.":
		"Engram: この保管庫はサーバー上で削除されています。",
	"Engram Sync: pulled {pulled} (local extras deleted)":
		"Engram 同期: {pulled} 件を取得しました (ローカルの余分なファイルを削除)",
	"Engram Sync: pulled {pulled}": "Engram 同期: {pulled} 件を取得しました",
	"Engram Sync: replaced remote with local ({pushed} uploaded)":
		"Engram 同期: サーバー側をローカルの内容で置き換えました ({pushed} 件アップロード)",
	"Engram: sync failed. Open the sync log for details.":
		"Engram: 同期に失敗しました。詳細は同期ログをご確認ください。",
	"Engram unreachable. Showing matches from this device only.":
		"Engram に接続できません。このデバイス上の結果のみ表示しています。",
	"No source path for this result": "この結果には元ファイルのパスがありません",
	"Note not synced locally": "このノートはまだローカルに同期されていません",
	"Engram: settings tab failed to render ({error})":
		"Engram: 設定タブの表示に失敗しました ({error})",
	"File not found locally: {path}": "ローカルにファイルが見つかりません: {path}",
	"Restored {path} — will sync on next push.":
		"{path} を復元しました。次回の送信時に同期されます。",
	"Ignored {path} — won't sync until restored from Sync Center.":
		"{path} を無視しました。Sync Center で復元するまで同期されません。",
	"Added {pattern} to ignore patterns": "{pattern} を除外パターンに追加しました",
	"Engram backend changed — sign in again to continue.":
		"Engram のバックエンドが変わりました。続けるにはもう一度サインインしてください。",
	"Engram: sign-in failed ({error})": "Engram: サインインに失敗しました ({error})",
	"Enter an API key first": "先に API キーを入力してください",
	"Switched to {mode}.": "{mode} に切り替えました。",

	"Engram Sync: pushed {count} files": "Engram 同期: {count} 件のファイルを送信しました",
	"Engram Sync: pulled {count} files from server":
		"Engram 同期: サーバーから {count} 件のファイルを取得しました",
	"Engram Sync: pulled {count} changes": "Engram 同期: {count} 件の変更を取得しました",
	"Engram: {count} files failed to sync{detail} — open Sync Center":
		"Engram: {count} 件のファイルが同期できませんでした{detail}。Sync Center を開いてください",
	"Engram: {count} attachments skipped — upgrade to sync images & PDFs.":
		"Engram: {count} 件の添付ファイルをスキップしました。画像と PDF を同期するにはアップグレードしてください。",
	"Engram: plan upgraded — syncing {count} attachments…":
		"Engram: プランをアップグレードしました。{count} 件の添付ファイルを同期しています…",
	// 402 limit reasons (limit-copy.ts). These gate payment, so they are the
	// highest-value strings in the plugin to get right.
	"Note limit reached. Upgrade to keep adding notes.":
		"ノート数の上限に達しました。アップグレードすると追加を続けられます。",
	"Vault limit reached. Upgrade for more vaults.":
		"保管庫数の上限に達しました。アップグレードするとさらに作成できます。",
	"This file type isn't accepted by this server.":
		"このサーバーはこのファイル形式を受け付けていません。",
	"Attachment sync is disabled for this account.":
		"このアカウントでは添付ファイルの同期が無効です。",
	"Attachment storage is full — upgrade for more.":
		"添付ファイルの保存容量がいっぱいです。アップグレードで増やせます。",
	"File too large for your plan.": "現在のプランではファイルが大きすぎます。",
	"Already signed in on another device. Upgrade for multi-device.":
		"別のデバイスでサインイン中です。アップグレードすると複数デバイスで使えます。",
	"Device swap cooldown active. Wait or upgrade.":
		"デバイス切り替えのクールダウン中です。しばらく待つか、アップグレードしてください。",
	"Too many connected Obsidian vaults. Disconnect one or upgrade.":
		"接続中の Obsidian 保管庫が多すぎます。ひとつ解除するか、アップグレードしてください。",
	"Too many connected AI clients. Disconnect one or upgrade.":
		"接続中の AI クライアントが多すぎます。ひとつ解除するか、アップグレードしてください。",
	"Daily AI search limit reached. Free includes 20 per day across Obsidian, the web app and MCP. Upgrade for unlimited.":
		"1 日の AI 検索上限に達しました。無料プランは Obsidian・ウェブアプリ・MCP 合わせて 1 日 20 回です。アップグレードで無制限になります。",
	"API keys need Pro. Sign in with your Engram account instead.":
		"API キーには Pro プランが必要です。代わりに Engram アカウントでサインインしてください。",
	"Account suspended. Contact support.":
		"アカウントが停止されています。サポートにご連絡ください。",
	"Account setup incomplete.": "アカウントの設定が完了していません。",
	"This account was deleted. Contact support if that is wrong.":
		"このアカウントは削除されています。お心当たりがない場合はサポートにご連絡ください。",
	"Finish setting up your account at app.engram.page to start syncing.":
		"app.engram.page でアカウント設定を終えると同期を始められます。",
	"Limit reached. Upgrade to continue.": "上限に達しました。アップグレードすると続けられます。",
};

export default ja;
