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
};

export default ja;
