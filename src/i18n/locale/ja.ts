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
	// UI strings
	"Link Obsidian to Engram": "Obsidian を Engram に接続",
	"Failed to start device flow. Check your Engram URL and try again.":
		"デバイス認証を開始できませんでした。Engram の URL を確認して、もう一度お試しください。",
	"Your code:": "コード:",
	"A browser window has opened. Sign in and enter this code to link your vault.":
		"ブラウザーのウィンドウが開きました。サインインしてこのコードを入力すると、保管庫が接続されます。",
	Cancel: "キャンセル",
	"Code expired. Please try again.": "コードの有効期限が切れました。もう一度お試しください。",
	"Try again": "再試行",
	Close: "閉じる",
	"Note couldn't be processed": "このノートを処理できませんでした",
	"The server couldn't process this note. Check its contents, then edit and save to try again.":
		"サーバーがこのノートを処理できませんでした。内容を確認し、編集して保存すると再試行します。",
	"Attachments need a paid plan": "添付ファイルには有料プランが必要です",
	"The Free tier syncs notes only. Upgrade to sync images and PDFs.":
		"無料プランはノートのみ同期します。画像と PDF を同期するにはアップグレードしてください。",
	"Attachment storage full": "添付ファイルの容量がいっぱいです",
	"You've used all the attachment storage on your plan. Upgrade for more.":
		"現在のプランの添付ファイル容量を使い切りました。アップグレードで増やせます。",
	"Too large for the server": "サーバーの上限を超えています",
	"The server limit is 5 MB. Compress or split the file, then it will sync.":
		"サーバーの上限は 5 MB です。圧縮または分割すれば同期できます。",
	"Sign-in expired": "サインインの期限が切れました",
	"Reconnect your account to resume syncing.": "アカウントを再接続すると同期を再開できます。",
	"Unresolved conflict": "未解決の競合があります",
	"Open the file to resolve the conflict, then sync again.":
		"ファイルを開いて競合を解決し、もう一度同期してください。",
	"Frontmatter needs a fix": "frontmatter の修正が必要です",
	"The note synced, but its frontmatter could not be fully parsed. Open it to fix the highlighted line.":
		"ノートは同期されましたが、frontmatter を完全に解析できませんでした。開いて、強調された行を直してください。",
	"Server error": "サーバーエラー",
	"A temporary server problem — retrying automatically.":
		"一時的なサーバーの問題です。自動で再試行しています。",
	"Network unavailable": "ネットワークに接続できません",
	"Can't reach the server — retrying automatically.":
		"サーバーに到達できません。自動で再試行しています。",
	"Sync failed": "同期に失敗しました",
	"An unexpected error — retrying automatically.":
		"予期しないエラーです。自動で再試行しています。",
	Upgrade: "アップグレード",
	"Update in settings": "設定から更新",
	"Engram: ready": "Engram: 準備完了",
	"Resume sync": "同期を再開",
	"Engram Vault Sync {version} is available. {link}.":
		"Engram Vault Sync {version} が公開されています。{link}。",
	"Search your vault…": "保管庫を検索…",
	"Filter by folder…": "フォルダーで絞り込み…",
	"Filter by tags…": "タグで絞り込み…",
	"Search failed — check connection": "検索に失敗しました。接続を確認してください",
	"No results found": "結果が見つかりません",
	"match strength: {pct}%": "一致度: {pct}%",
	"Open sync setup": "同期の設定を開く",
	"Last sync: {when}": "前回の同期: {when}",
	"waiting for a connection": "接続を待っています",
	"sync is paused": "同期は一時停止中です",
	"syncing now": "同期中です",
	"waiting to retry": "再試行を待っています",
	"{count} not on your plan": "{count} 件はプラン対象外",
	"{count} retrying": "{count} 件を再試行中",
	"{count} ignored": "{count} 件を無視",
	"{count} queued — {reason}": "{count} 件が待機中: {reason}",
	"These files are fine. They just need a paid plan to sync.":
		"これらのファイルに問題はありません。同期するには有料プランが必要なだけです。",
	"Show files ({count}) ▾": "ファイルを表示 ({count}) ▾",
	"Sync these now": "今すぐこれらを同期",
	"Clear all": "すべてクリア",
	"Nothing needs your attention. 🎉": "対応が必要なものはありません。🎉",
	Dismiss: "閉じる",
	"Retry all now": "今すぐすべて再試行",
	"Temporary errors. These clear themselves once the server recovers.":
		"一時的なエラーです。サーバーが復旧すると自動で解消します。",
	Open: "開く",
	Ignore: "無視",
	"No files ignored. Use the ignore button on a failure row to stop syncing it.":
		"無視中のファイルはありません。失敗した行の無視ボタンを押すと、そのファイルの同期を止められます。",
	Restore: "元に戻す",
	Clear: "クリア",
	"No activity yet. Push or pull to see entries here.":
		"まだ履歴がありません。送信または取得すると、ここに表示されます。",
	"Sync log": "同期ログ",
	"Could not compare with the cloud. Check your connection.":
		"サーバーと比較できませんでした。接続を確認してください。",
	"Your login expired. Sign in again in Engram settings to continue.":
		"ログインの有効期限が切れました。続けるには Engram settings で再度サインインしてください。",
	"Couldn't create vault — the name may be invalid or already in use.":
		"保管庫を作成できませんでした。名前が無効か、すでに使われている可能性があります。",
	"Could not create the vault — check your connection and try again.":
		"保管庫を作成できませんでした。接続を確認して、もう一度お試しください。",
	"Free syncs notes only — {count} attachments will be skipped.":
		"無料プランはノートのみ同期します。{count} 件の添付ファイルはスキップされます。",
	"Comparing your vault with the cloud…": "保管庫をサーバーと比較しています…",
	"Until you choose, nothing in this vault will sync.":
		"選択するまで、この保管庫は何も同期しません。",
	"Change vault": "保管庫を変更",
	"Advanced sync options": "詳細な同期オプション",
	"Everything is in sync": "すべて同期済みです",
	" conflicts need resolution": " 件の競合を解決する必要があります",
	"Confirm destructive sync": "破壊的な同期の確認",
	"You are about to:": "これから次を行います:",
	"Files that will be deleted:": "削除されるファイル:",
	"This cannot be undone.": "この操作は取り消せません。",
	Back: "戻る",
	Confirm: "確認",
	"Switch vault": "保管庫を切り替える",
	"Pick a vault to sync with. We will recalculate the sync preview after you choose.":
		"同期する保管庫を選んでください。選択後に同期プレビューを再計算します。",
	"Loading vaults…": "保管庫を読み込んでいます…",
	"No other vaults available.": "ほかに使える保管庫はありません。",
	"Make new vault": "保管庫を新規作成",
	"New vault": "新しい保管庫",
	"Create a new empty vault on the server, then sync this Obsidian vault into it.":
		"サーバー上に空の保管庫を作り、この Obsidian 保管庫をそこへ同期します。",
	Create: "作成",
	"Your vault shares {percent} of its data with Engram":
		"あなたの保管庫は Engram と {percent} のデータを共有しています",
	"Type {keyword} to confirm:": "確認のため {keyword} と入力してください:",
	"✓ {count} synced": "✓ {count} 件を同期",
	"⤳ {count} skipped (Free plan)": "⤳ {count} 件をスキップ (無料プラン)",
	"✕ {count} failed": "✕ {count} 件が失敗",
	"{count} attachments need a paid plan to sync. See Sync Center.":
		"{count} 件の添付ファイルは同期に有料プランが必要です。Sync Center をご確認ください。",
	"Syncing your vault": "保管庫を同期しています",
	"Getting started…": "準備しています…",
	"Open Engram to check your vault and confirm everything synced.":
		"Engram を開いて保管庫を確認し、すべて同期されたか確かめてください。",
	"Open Engram": "Engram を開く",
	"You can close this and the sync keeps running in the background.":
		"これを閉じても、同期はバックグラウンドで続きます。",
	"Run in background": "バックグラウンドで実行",
	"Syncing…": "同期中…",
	"Sync complete": "同期が完了しました",
	Done: "完了",
	"Engram: sync conflict on {path} — your local edit was saved as {copy}":
		"Engram: {path} で同期の競合が発生しました。ローカルの編集は {copy} として保存しました",
	"Open note": "ノートを開く",
	"Engram: {count} notes have frontmatter problems. Open Sync Center to fix.":
		"Engram: {count} 件のノートの frontmatter に問題があります。Sync Center を開いて直してください。",
	"New here? Watch the setup video": "はじめての方へ: セットアップ動画を見る",
	"What Engram does, and how to connect your vault, start to finish.":
		"Engram でできること、そして保管庫の接続手順を最後まで。",
	"▶ Watch on YouTube": "▶ YouTube で見る",
	"1. Make an account": "1. アカウントを作る",
	"2. Connect your vault to Engram": "2. 保管庫を Engram につなぐ",
	"Open connection tab": "接続タブを開く",
	"3. Connect your AI": "3. AI をつなぐ",
	"Node.js dependencies": "Node.js の依存パッケージ",
	"Python virtual environment": "Python の仮想環境",
	"Python bytecode cache": "Python のバイトコードキャッシュ",
	"Vendored dependencies": "同梱された依存パッケージ",
	"Gradle build cache": "Gradle のビルドキャッシュ",
	"Rust/Java build output": "Rust/Java のビルド出力",
	"Build output": "ビルド出力",
	"Next.js build output": "Next.js のビルド出力",
	"Distribution build output": "配布用ビルド出力",
	"Cargo cache": "Cargo のキャッシュ",
	"CocoaPods dependencies": "CocoaPods の依存パッケージ",
	"Dart tool cache": "Dart のツールキャッシュ",
	"Generic cache directory": "一般的なキャッシュ用ディレクトリ",
	"Ignore patterns": "除外パターン",
	"Custom patterns": "独自のパターン",
	Diagnostics: "診断",
	"Diagnostics detail": "診断の詳細",
	About: "このプラグインについて",
	"License: {name}": "ライセンス: {name}",
	"⚠ Detected: {label}/ ({formatted} files)": "⚠ 検出: {label}/ ({formatted} 件)",
	"{desc} — should not be synced": "{desc}。同期すべきではありません",
	"Add to ignores": "除外に追加",
	"Version: {version}": "バージョン: {version}",
	"Source: {link}": "ソース: {link}",
	"Engram URL": "Engram の URL",
	"✓ Engram server reachable (v{version})": "✓ Engram サーバーに接続できます (v{version})",
	"✗ server responded but isn't an Engram backend":
		"✗ サーバーは応答しましたが、Engram のバックエンドではありません",
	"✗ couldn't reach a server at this URL": "✗ この URL のサーバーに到達できませんでした",
	"Checking server…": "サーバーを確認しています…",
	Authentication: "認証",
	"Authenticated via Engram account (OAuth).": "Engram アカウント (OAuth) で認証済みです。",
	"Manage account": "アカウントを管理",
	"Sign out": "サインアウト",
	"Using API key": "API キーを使用中",
	"Authenticated via manual API key.": "手動の API キーで認証済みです。",
	"Clear key": "キーを消去",
	"Switch to sign in": "サインインに切り替える",
	"Sign in or create an account": "サインインまたはアカウント作成",
	"Sign in": "サインイン",
	"API key": "API キー",
	Token: "トークン",
	"Bearer token from your Engram account.": "Engram アカウントの Bearer トークン。",
	Save: "保存",
	"That does not look like an Engram API key (expected {prefix}…).":
		"Engram の API キーではないようです (先頭は {prefix} です)。",
	Vault: "保管庫",
	"Vault selection": "保管庫の選択",
	"Select which vault this plugin syncs with.": "このプラグインが同期する保管庫を選びます。",
	"No vaults found — first sync will create one":
		"保管庫が見つかりません。初回同期時に作成されます",
	"Pick a vault": "保管庫を選ぶ",
	Change: "変更",
	"Support development": "開発を支援する",
	"GitHub Sponsors": "GitHub Sponsors",
	Backend: "バックエンド",
	"Where this vault syncs to. Each backend keeps its own sign-in.":
		"この保管庫の同期先です。バックエンドごとにサインインは別々です。",
	"Run your own Engram server": "自分の Engram サーバーを使う",
	"Engram is the backend that powers sync and semantic search.":
		"Engram は同期とセマンティック検索を支えるバックエンドです。",
	"Finish sync setup": "同期の設定を終える",
	"Nothing in this vault syncs until you choose how to merge it with the server.":
		"サーバーとどう統合するかを選ぶまで、この保管庫は何も同期しません。",
	"Choose sync direction": "同期の方向を選ぶ",
	"Engram: this plugin is too old to sync (needs {version} or newer). Update it to continue.":
		"Engram: このプラグインは古すぎて同期できません ({version} 以降が必要です)。更新してから続けてください。",
	"Engram: this plugin is too old to sync. Update it to continue.":
		"Engram: このプラグインは古すぎて同期できません。更新してから続けてください。",
	Update: "更新",
};

export default ja;
