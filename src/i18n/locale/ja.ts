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
	// UI strings (second pass)
	"Invalid API key": "API キーが無効です",
	"Connection failed": "接続に失敗しました",
	"Sync now": "今すぐ同期",
	"Disconnect (clear login)": "接続を解除 (ログイン情報を消去)",
	"Push entire vault": "保管庫をすべて送信",
	"Check sync status": "同期の状態を確認",
	"Engram sync: server does not support reconciliation (update backend)":
		"Engram 同期: サーバーが照合に対応していません (バックエンドを更新してください)",
	"Pull all from server (force overwrite)": "サーバーからすべて取得 (強制的に上書き)",
	"Show sync log": "同期ログを表示",
	"Semantic search": "セマンティック検索",
	"Open search sidebar": "検索サイドバーを開く",
	"Engram search": "Engram 検索",
	"Open sync center": "Sync Center を開く",
	"Engram: this vault no longer exists on the server. Pick or create a vault to continue.":
		"Engram: この保管庫はサーバー上に存在しません。続けるには保管庫を選ぶか作成してください。",
	"Engram: recovered plugin settings from a backup after a corrupted save.":
		"Engram: 設定ファイルが壊れていたため、バックアップから復元しました。",
	"Engram sync: live sync requires a plugin update — please update the Engram vault sync plugin.":
		"Engram 同期: ライブ同期にはプラグインの更新が必要です。Engram vault sync を更新してください。",
	"Engram: sync is paused — this edit was not synced. Choose a sync direction to resume.":
		"Engram: 同期は一時停止中です。この編集は同期されていません。同期の方向を選ぶと再開します。",
	"Engram: not connected": "Engram: 未接続",
	"Engram: signed out": "Engram: サインアウト済み",
	"Not connected yet. Click to open settings and link this vault.":
		"まだ接続されていません。クリックして設定を開き、この保管庫を接続してください。",
	"Not signed in. Click to open settings and reconnect.":
		"サインインしていません。クリックして設定を開き、再接続してください。",
	"Engram: finish setup": "Engram: セットアップを完了",
	"Engram: sync paused": "Engram: 同期を一時停止中",
	"{label} ({count} queued)": "{label} ({count} 件待機)",
	"Setup is not finished — nothing will sync until you choose a sync direction. Click to finish.":
		"セットアップが終わっていません。同期の方向を選ぶまで何も同期されません。クリックして完了してください。",
	"Sync paused — click to choose a sync direction":
		"同期は一時停止中です。クリックして同期の方向を選んでください",
	"Engram: offline ({count} queued)": "Engram: オフライン ({count} 件待機)",
	"Engram: offline": "Engram: オフライン",
	"Server unreachable — changes will sync when connected":
		"サーバーに接続できません。接続が戻ると同期します",
	"Engram: error": "Engram: エラー",
	"Unknown error": "不明なエラー",
	"Engram: syncing ({count})": "Engram: 同期中 ({count})",
	"Engram: syncing": "Engram: 同期中",
	"Sync in progress...": "同期しています…",
	"Engram: pending ({count})": "Engram: 保留中 ({count})",
	"{count} files queued": "{count} 件のファイルが待機中",
	"Engram: live": "Engram: ライブ",
	"WebSocket connected — live sync active": "WebSocket 接続済み。ライブ同期が有効です",
	"Click to sync": "クリックして同期",
	Attachments: "添付ファイル",
	Keyword: "キーワード",
	Semantic: "セマンティック",
	Both: "両方",
	"matches your words and their other forms — 'run' finds 'running' — plus this device.":
		"入力した語とその変化形を照合します (run で running も見つかります)。このデバイスの結果も含みます。",
	"matches meaning. Finds notes that never use the words you typed.":
		"意味で照合します。入力した語が一度も出てこないノートも見つかります。",
	"matches words and meaning together, plus this device. Widest results.":
		"語と意味の両方を照合し、このデバイスの結果も含みます。もっとも広く探します。",
	"Clear search": "検索をクリア",
	"Search settings": "検索の設定",
	Untitled: "無題",
	"meaning + exact": "意味 + 完全一致",
	Disconnected: "接続が切れています",
	"Connected — waiting for first sync decision": "接続済み。最初の同期の選択を待っています",
	"Connected — live sync active": "接続済み。ライブ同期が有効です",
	"Connected — polling": "接続済み。ポーリング中",
	"Not configured": "未設定",
	Refresh: "再読み込み",
	"Not synced on your plan ({count})": "プラン対象外 ({count})",
	"Needs attention ({count})": "対応が必要 ({count})",
	"Retrying automatically ({count})": "自動で再試行中 ({count})",
	Stats: "統計",
	"Notes on this device": "このデバイスのノート",
	"Attachments on this device": "このデバイスの添付ファイル",
	"Remote vault": "サーバーの保管庫",
	"not linked": "未接続",
	"Plan usage": "プランの使用状況",
	"Safe choice: combines both sides, nothing is deleted.":
		"安全な選択: 両方をまとめ、何も削除しません。",
	"Already in sync. Nothing is deleted.": "すでに同期済みです。何も削除しません。",
	Sync: "同期",
	"Upload local files without downloading the remote":
		"サーバーから取得せずにローカルのファイルを送信",
	"Delete all on remote, then upload local files":
		"サーバー側をすべて削除してからローカルのファイルを送信",
	"Download remote files without uploading the local":
		"ローカルを送信せずにサーバーのファイルを取得",
	"Delete all local files, then download from remote":
		"ローカルのファイルをすべて削除してからサーバーから取得",
	"Set up sync for this vault": "この保管庫の同期を設定",
	"You are now pointing at a different cloud vault": "いま別のクラウド保管庫を指しています",
	"Sync preview": "同期プレビュー",
	"Start syncing": "同期を始める",
	"Upload everything": "すべて送信",
	"Nothing will be removed from this device.": "このデバイスから何も削除されません。",
	"Download everything": "すべて取得",
	"Not now": "あとで",
	"This vault": "この保管庫",
	"Cloud server": "サーバーの保管庫",
	"Vault name": "保管庫の名前",
	"Could not load vaults": "保管庫を読み込めませんでした",
	"Enter a name for the new vault": "新しい保管庫の名前を入力してください",
	"Failed to switch vault": "保管庫の切り替えに失敗しました",
	"Finished with some errors. Open the sync log to see what failed.":
		"エラーがいくつかありました。同期ログで失敗した項目を確認してください。",
	"Synced. Some attachments need a paid plan to sync (see below).":
		"同期しました。一部の添付ファイルには有料プランが必要です (下記参照)。",
	"All synced. Your vault and the cloud now match.":
		"すべて同期しました。保管庫とサーバーが一致しています。",
	"Already up to date. Nothing needed syncing.":
		"すでに最新です。同期するものはありませんでした。",
	Deleting: "削除中",
	Downloading: "ダウンロード中",
	Uploading: "アップロード中",
	"Syncing attachments": "添付ファイルを同期中",
	Complete: "完了",
	"Getting set up": "セットアップを始める",
	"setup guide": "セットアップガイド",
	"Sign in (or enter your server URL and key) on the connection tab, then run your first sync.":
		"接続タブでサインイン (またはサーバー URL とキーを入力) して、最初の同期を実行してください。",
	"See the AI setup guide": "AI セットアップガイドを見る",
	Plans: "プラン",
	Free: "無料",
	"1 vault, 2 devices": "保管庫 1 個、デバイス 2 台",
	"Real-time sync": "リアルタイム同期",
	"2,000 notes searchable": "2,000 件のノートを検索可能",
	"Connect any AI (MCP)": "任意の AI と接続 (MCP)",
	Starter: "スターター",
	"10 vaults, unlimited devices": "保管庫 10 個、デバイス数は無制限",
	"Search all your notes": "すべてのノートを検索",
	"10 GB attachments": "添付ファイル 10 GB",
	"Unlimited AI searches": "AI 検索は無制限",
	Pro: "プロ",
	"Unlimited vaults": "保管庫は無制限",
	"Search across all vaults at once": "すべての保管庫を一度に検索",
	"50 GB attachments": "添付ファイル 50 GB",
	"API access": "API アクセス",
	"See full pricing": "料金の詳細を見る",
	"Learn more": "詳しく見る",
	"Errors only": "エラーのみ",
	"Warnings and errors": "警告とエラー",
	"Info (default)": "情報 (既定)",
	"Debug (verbose)": "デバッグ (詳細)",
	"Or authenticate with a token instead of signing in.":
		"サインインの代わりにトークンで認証することもできます。",
	"If this plugin saves you time, consider supporting development.":
		"このプラグインが役に立っているなら、開発の支援をご検討ください。",
	"Sign-in required to load vaults": "保管庫の読み込みにはサインインが必要です",
	"Could not reach Engram — check connection": "Engram に接続できません。接続を確認してください",
	// UI strings (sync error surfaces)
	"Free syncs notes only — images & PDFs need a paid plan.":
		"無料プランはノートのみ同期します。画像と PDF には有料プランが必要です。",
	"Pull all (delete extras) aborted: could not obtain an exclusive server snapshot (replay contention). Nothing was trashed.":
		"すべて取得 (余分なファイルを削除) を中止しました: サーバーの排他スナップショットを取得できませんでした (リプレイの競合)。何も削除していません。",
	"Pull all aborted: another sync is running (replay contention). Try again when it finishes.":
		"すべて取得を中止しました: 別の同期が実行中です (リプレイの競合)。終わってからもう一度お試しください。",
	"Pull all failed: {error}": "すべて取得に失敗しました: {error}",
	"Pull all failed": "すべて取得に失敗しました",
	// UI strings (third pass)
	"Click to copy": "クリックでコピー",
	"Waiting for authorization — connected, this will complete instantly.":
		"認可を待っています: 接続済みなので、すぐ完了します。",
	"Waiting for authorization — no live connection, checking every 30s.":
		"認可を待っています: ライブ接続がないため、30 秒ごとに確認します。",
	'Engram Sync: sync state for "{name}" was unreadable — using the on-disk copy.':
		"Engram 同期: 「{name}」の同期状態を読み取れませんでした。ディスク上の内容を使います。",
	"{formatted} files · ": "{formatted} 件のファイル · ",
	"Notes searchable": "検索できるノート",
	"Notes past this still sync and open normally, they are just not in the search index. The index keeps your oldest notes, so it is your newest ones that fall outside.":
		"これを超えたノートも同期も表示も普通にできます。検索インデックスに入らないだけです。インデックスは古いノートを保持するので、外れるのは新しいノートです。",
	"Notes stored": "保存済みのノート",
	"AI searches": "AI 検索",
	"{formatted} per day": "1 日 {formatted} 回",
	"Engram indexes {indexed} of your {all} notes. The rest match on this device only. Upgrade to index everything.":
		"Engram は {all} 件のうち {indexed} 件をインデックスしています。残りはこのデバイス上でのみ一致します。アップグレードすると全件インデックスされます。",
	"Searching {indexed} of {all} notes. Upgrade to search everything.":
		"{all} 件のうち {indexed} 件を検索しています。アップグレードすると全件検索できます。",
	"Remove tag {tag}": "タグ {tag} を外す",
	"👋 Welcome": "👋 ようこそ",
	"🔌 Connection": "🔌 接続",
	"🔄 Sync Center": "🔄 Sync Center",
	"⚙️ Advanced": "⚙️ 詳細設定",
	"Error: {error}": "エラー: {error}",
	unknown: "不明",
	"{count} need attention": "{count} 件が対応待ち",
	"Uploads {up}, downloads {down}.": "{up} 件を送信、{down} 件を取得します。",
	"Uploads {count}.": "{count} 件を送信します。",
	"Downloads {count}.": "{count} 件を取得します。",
	"{count} conflicts to resolve.": "{count} 件の競合を解決する必要があります。",
	"Nothing is deleted.": "何も削除しません。",
	"Delete all {count} files currently on the server":
		"サーバー上にある {count} 件のファイルをすべて削除",
	"Upload {count} files from this vault": "この保管庫から {count} 件のファイルを送信",
	"Delete all {count} files in this vault": "この保管庫にある {count} 件のファイルをすべて削除",
	"Download {count} files from the server": "サーバーから {count} 件のファイルを取得",
	"Nothing to sync yet — this vault is empty on both sides. Start syncing and everything you write appears on your other devices.":
		"まだ同期するものがありません。両側とも空です。同期を始めれば、書いたものが他のデバイスにも現れます。",
	"{count} notes": "{count} 件のノート",
	"{count} attachments": "{count} 件の添付ファイル",
	"{first} and {second}": "{first} と {second}",
	files: "ファイル",
	"This vault is empty on the server. Upload your {what}?":
		"サーバー側のこの保管庫は空です。{what} を送信しますか?",
	"This device's vault is empty. Download {what} from the server?":
		"このデバイスの保管庫は空です。サーバーから {what} を取得しますか?",
	notes: "ノート",
	attachments: "添付ファイル",
	folders: "フォルダー",
	"Uploading {count}.": "{count} 件を送信しています。",
	"Downloading {count}.": "{count} 件を取得しています。",
	"Deleting {count} local files.": "ローカルの {count} 件のファイルを削除しています。",
	"Deleting {count} on the cloud.": "サーバー上の {count} 件を削除しています。",
	"First sync, this may take a moment.": "初回の同期です。少し時間がかかることがあります。",
	"Checking for changes.": "変更を確認しています。",
	"Nothing will be deleted.": "何も削除されません。",
	'{count} failed. Run "{command}" for details.':
		"{count} 件が失敗しました。詳細は「{command}」を実行してください。",
	'Engram Sync: renamed "{name}" (unsupported characters)':
		"Engram 同期: 「{name}」の名前を変更しました (使えない文字が含まれていました)",
	'Engram: frontmatter problem in "{name}"': "Engram: 「{name}」の frontmatter に問題があります",
	"Create a hosted account at ": "ホスト型アカウントの登録は ",
	", or self-host the backend (": "。または、バックエンドをセルフホストします (",
	"Link Claude, Cursor, ChatGPT, or any MCP app so it can read and write your notes. ":
		"Claude、Cursor、ChatGPT など MCP 対応アプリをつなぐと、ノートを読み書きできます。",
	Documentation: "ドキュメント",
	"AI / MCP setup guide": "AI / MCP セットアップガイド",
	"Report an issue": "問題を報告",
	"Join our Discord": "Discord に参加",
	"Paths to skip (one per line). Folder patterns end with /. Built-in: {configDir}/, .trash/, .git/":
		"除外するパス (1 行に 1 つ)。フォルダーは / で終わります。既定: {configDir}/、.trash/、.git/",
	"Send detailed sync, vault, and connection activity to the server for troubleshooting, with distributed tracing on requests. Metadata only, never note content. Leave off for normal use.":
		"同期・保管庫・接続の詳しい動きをトラブルシューティング用にサーバーへ送り、リクエストを分散トレースします。送るのはメタデータだけで、ノートの内容は送りません。通常はオフのままにしてください。",
	"Minimum severity that ships while diagnostics are on. Higher levels send fewer lines. Default: Info.":
		"診断が有効なあいだに送る最小のレベル。高いレベルほど行数は少なくなります。既定: 情報。",
	"Signed in as {email}": "{email} でサインイン中",
	"Pick a vault (previous: '{name}' not found)":
		"保管庫を選んでください (以前の「{name}」は見つかりません)",
	"Pick a vault (previous: id {id} not found)":
		"保管庫を選んでください (以前の id {id} は見つかりません)",
	"Server error ({status}) — check Engram logs":
		"サーバーエラー ({status})。Engram のログを確認してください",
	"Request failed ({status})": "リクエストに失敗しました ({status})",
	"Engram Cloud": "Engram Cloud",
	"Self-hosted": "セルフホスト",
	"{count} attempts": "{count} 回試行",
	// UI strings (fourth pass)
	"{count} missing on server": "サーバーに {count} 件ありません",
	"{count} diverged": "{count} 件が食い違っています",
	"{count} only on server": "サーバーにだけ {count} 件あります",
	"Engram Sync: {details}": "Engram 同期: {details}",
	"Engram: plugin settings file was corrupted and could not be recovered. You may need to reconnect in settings.":
		"Engram: プラグインの設定ファイルが壊れていて復元できませんでした。設定から再接続が必要かもしれません。",
	"Engram: sync is not set up yet, so nothing in this vault will sync.":
		"Engram: 同期がまだ設定されていないので、この保管庫の内容は何も同期されません。",
	"Click the Engram item in the status bar to pick up where you left off.":
		"ステータスバーの Engram をクリックすると、続きから始められます。",
	"Engram: ⚠ {count} sync errors": "Engram: ⚠ 同期エラー {count} 件",
	"sync failed": "同期に失敗しました",
	"That does not look like a complete server address. Include the scheme, for example http://127.0.0.1:4000":
		"サーバーアドレスが完全ではないようです。http://127.0.0.1:4000 のようにスキームも入れてください",
	"Opens your browser to sign in, or create an account if you don't have one yet, then links this vault.":
		"ブラウザーを開いてサインインします。アカウントがなければその場で作成でき、そのあとこの保管庫が紐づきます。",
	"Or authenticate with a token instead of signing in. Engram Cloud API keys require the Pro plan; on Free and Starter, sign in above.":
		"サインインの代わりにトークンで認証することもできます。Engram Cloud の API キーは Pro プランが必要です。Free と Starter では上からサインインしてください。",
	"No sync activity this session.": "このセッションでは同期の動きがありません。",
	"Showing {count} entries": "{count} 件を表示しています",
	"({count} errors)": "(エラー {count} 件)",
	"Frontmatter could not be parsed": "frontmatter を解析できませんでした",
	"Not connected. Enter your Engram server URL below to start syncing.":
		"未接続です。下に Engram サーバーのアドレスを入れると同期を始められます。",
	// UI strings (fifth pass)
	"Sync...": "同期...",
	"Syncing...": "同期しています...",
	" (default)": " (既定)",

	// First-run diagnostics opt-in (#528)
	"Send debug logs. Note content stays private.":
		"デバッグログを送信します。ノートの内容は非公開のままです。",
};

export default ja;
