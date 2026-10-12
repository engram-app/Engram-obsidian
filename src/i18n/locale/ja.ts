import type { Dict } from "..";

// 日本語
const ja: Dict = {
	"Invalid API key": "無効なAPIキー",
	"Connection failed": "接続エラー",
	"Link Obsidian to Engram": "EngramへのObsidian連携",
	"Failed to start device flow. Check your Engram URL and try again.":
		"デバイスフローの開始に失敗しました。EngramのURLを確認し、再度お試しください。",
	"Your code:": "コード：",
	"Click to copy": "コピー",
	"Code copied!": "コードをコピーしました！",
	"A browser window has opened. Sign in and enter this code to link your vault.":
		"ブラウザウィンドウが開きました。サインインし、このコードを入力して保管庫を連携してください。",
	Cancel: "キャンセル",
	"Waiting for authorization — connected, this will complete instantly.":
		"認証待ち — 接続済み。すぐに完了します。",
	"Waiting for authorization — no live connection, checking every 30s.":
		"認証待ち — ライブ接続なし。30秒ごとに確認しています。",
	"Code expired. Please try again.": "コードが期限切れです。再度お試しください。",
	"Try again": "再試行",
	Close: "閉じる",
	"Note couldn't be processed": "ノートの処理に失敗しました",
	"The server couldn't process this note. Check its contents, then edit and save to try again.":
		"サーバーでこのノートの処理に失敗しました。内容を確認し、編集して保存してから再度お試しください。",
	"Attachments need a paid plan": "添付ファイルには有料プランが必要です",
	"The Free tier syncs notes only. Upgrade to sync images and PDFs.":
		"無料プランではノートのみ同期されます。画像やPDFを同期するには、有料プランにアップグレードしてください。",
	"Attachment storage full": "添付ファイルの保存容量上限",
	"You've used all the attachment storage on your plan. Upgrade for more.":
		"プランの添付ファイル保存容量上限に達しました。より多くの容量が必要な場合は、アップグレードしてください。",
	"Too large for the server": "ファイルサイズが大きすぎます",
	"The server limit is 5 MB. Compress or split the file, then it will sync.":
		"サーバーの制限は5MBです。ファイルを圧縮するか分割し、再度同期してください。",
	"Sign-in expired": "ログインセッションが切れました",
	"Reconnect your account to resume syncing.": "アカウントを再接続すると同期を再開できます。",
	"Unresolved conflict": "競合が解決されていません",
	"Open the file to resolve the conflict, then sync again.":
		"競合を解決するファイルを開き、再度同期します。",
	"Frontmatter needs a fix": "フロントマターに修正が必要です",
	"The note synced, but its frontmatter could not be fully parsed. Open it to fix the highlighted line.":
		"ノートは同期されましたが、フロントマターを完全に解析できませんでした。ハイライトされた行を修正するために開いてください。",
	"Server error": "サーバーエラー",
	"A temporary server problem — retrying automatically.":
		"一時的なサーバーの問題です。自動的に再試行します。",
	"Network unavailable": "ネットワークに接続できません",
	"Can't reach the server — retrying automatically.":
		"サーバーに接続できません。自動的に再試行します。",
	"Sync failed": "同期に失敗しました",
	"An unexpected error — retrying automatically.":
		"予期しないエラーが発生しました。自動的に再試行します。",
	"Frontmatter could not be parsed": "フロントマターを解析できませんでした",
	"Note limit reached. Upgrade to keep adding notes.":
		"ノートの制限に達しました。ノートを追加するには、アップグレードしてください。",
	"Vault limit reached. Upgrade for more vaults.":
		"保管庫の制限に達しました。より多くの保管庫を使用するには、アップグレードしてください。",
	"This file type isn't accepted by this server.":
		"このファイル形式はサーバーでサポートされていません。",
	"Attachment sync is disabled for this account.":
		"このアカウントでは添付ファイルの同期が無効になっています。",
	"Attachment storage is full — upgrade for more.":
		"添付ファイルの保存容量がいっぱいです。より多くの容量のためにアップグレードしてください。",
	"File too large for your plan.": "ファイルサイズがプランの制限を超えています。",
	"Already signed in on another device. Upgrade for multi-device.":
		"別のデバイスで既にサインインしています。複数デバイス利用にはアップグレードが必要です。",
	"Device swap cooldown active. Wait or upgrade.":
		"デバイスの切り替え制限中です。しばらく待つか、アップグレードしてください。",
	"Too many connected Obsidian vaults. Disconnect one or upgrade.":
		"接続されているObsidianの保管庫が多すぎます。いずれかを解除するか、アップグレードしてください。",
	"Too many connected AI clients. Disconnect one or upgrade.":
		"接続されているAIクライアントが多すぎます。いずれかを解除するか、アップグレードしてください。",
	"Daily AI search limit reached. Free includes 20 per day across Obsidian, the web app and MCP. Upgrade for unlimited.":
		"1日のAI検索回数制限に達しました。無料プランでは、Obsidian、ウェブアプリ、MCP全体で1日20回までです。無制限にするにはアップグレードしてください。",
	"API keys need Pro. Sign in with your Engram account instead.":
		"APIキーはProプランが必要です。代わりにEngramアカウントでサインインしてください。",
	"Account suspended. Contact support.":
		"アカウントが停止されています。サポートにお問い合わせください。",
	"Account setup incomplete.": "アカウントの設定が完了していません。",
	"This account was deleted. Contact support if that is wrong.":
		"このアカウントは削除されました。もし誤りがあれば、サポートまでご連絡ください。",
	"Finish setting up your account at app.engram.page to start syncing.":
		"同期を開始するには、app.engram.page でアカウントの設定を完了してください。",
	"Limit reached. Upgrade to continue.":
		"制限に達しました。継続するには、アップグレードが必要です。",
	Upgrade: "アップグレード",
	"Update in settings": "設定で更新",
	"Sync now": "今すぐ同期",
	"Engram sync: syncing...": "Engram 同期: 同期中...",
	"Engram Sync: pulled {pulled}, pushed {pushed}":
		"Engram 同期: {pulled} を取得、{pushed} を送信",
	"Disconnect (clear login)": "接続解除 (ログイン情報を削除)",
	"Engram: disconnected. Open Engram settings to reconnect.":
		"Engram: 接続解除。再接続するには、Engram の設定を開いてください。",
	"Push entire vault": "保管庫全体を送信",
	"Engram Sync: pushed {count} files": "Engram 同期: {count}つのファイルを送信しました",
	"Check sync status": "同期状況を確認",
	"Engram sync: checking...": "Engram 同期: 確認中...",
	"Engram sync: server does not support reconciliation (update backend)":
		"Engram 同期: サーバーがリコンシリエーションに対応していません (バックエンドを更新)",
	"Engram sync: everything in sync": "Engram 同期: 全てが同期済み",
	"{count} missing on server": "サーバーに {count} がありません",
	"{count} diverged": "{count} が異なっています",
	"{count} only on server": "{count} はサーバーにのみ存在します",
	"Engram Sync: {details}": "Engram 同期: {details}",
	"Pull all from server (force overwrite)": "サーバーから全てをダウンロード (強制上書き)",
	"Engram sync: pulling all from server...": "Engram 同期: サーバーから全てをダウンロード中...",
	"Engram Sync: pulled {count} files from server":
		"Engram 同期: サーバーから{count}つのファイルを取得しました",
	"Show sync log": "同期ログを表示",
	"Semantic search": "セマンティック検索",
	"Open search sidebar": "検索サイドバーを開く",
	"Engram search": "Engram 検索",
	"Open sync center": "同期センターを開く",
	"Engram: ready": "Engram: 準備完了",
	"Engram Sync: pushed {pushed}": "Engram 同期: {pushed} をプッシュしました",
	"Engram sync: sync failed": "Engram 同期: 同期に失敗しました",
	"Engram: this vault no longer exists on the server. Pick or create a vault to continue.":
		"Engram: この保管庫はサーバー上に存在しません。利用可能な保管庫を選択するか、新規作成して続行してください。",
	"Engram: recovered plugin settings from a backup after a corrupted save.":
		"Engram: 破損した保存ファイルからのプラグイン設定を復元しました。",
	"Engram: plugin settings file was corrupted and could not be recovered. You may need to reconnect in settings.":
		"Engram: プラグイン設定ファイルが破損し、復元できませんでした。設定で再接続が必要になる場合があります。",
	"Engram: your login expired — open Engram settings to reconnect.":
		"Engram: ログインが期限切れです。Engram の設定を開いて再接続してください。",
	"Engram: This vault has been deleted on the server.":
		"Engram: この保管庫はサーバーから削除されました。",
	"Engram sync: live sync requires a plugin update — please update the Engram vault sync plugin.":
		"Engram 同期: リアルタイム同期にはプラグインのアップデートが必要です。Engram vault sync プラグインをアップデートしてください。",
	"Engram Sync: pulled {pulled} (local extras deleted)":
		"Engram 同期: {pulled} を取得しました (ローカルの追加ファイルを削除)",
	"Engram Sync: pulled {pulled}": "Engram 同期: {pulled} を取得しました",
	"Engram Sync: replaced remote with local ({pushed} uploaded)":
		"Engram 同期: リモートをローカルで置き換えました ({pushed} をアップロード)",
	"Engram: sync is not set up yet, so nothing in this vault will sync.":
		"Engram: まだ同期の設定が完了していません。この保管庫内のファイルは同期されません。",
	"Finish sync setup": "同期設定を完了",
	"Engram: sync is paused. This edit was not synced. Choose a sync direction to resume.":
		"Engram: 同期が一時停止中です。この編集は同期されていません。同期方向を選択して再開してください。",
	"Open Engram settings": "Engramの設定を開く",
	"Engram: sync failed. Open the sync log for details.":
		"Engram: 同期に失敗しました。詳細については、同期ログを開いてください。",
	"Engram: not connected": "Engram: 接続されていません",
	"Engram: signed out": "Engram: ログアウトされています",
	"Not connected yet. Click to open settings and link this vault.":
		"まだ接続されていません。設定を開いて、この保管庫をリンクしてください。",
	"Not signed in. Click to open settings and reconnect.":
		"まだログインされていません。設定を開いて、再接続してください。",
	"Engram: finish setup": "Engram: 設定を完了",
	"Engram: sync paused": "Engram: 同期を一時停止",
	"{label} ({count} queued)": "{label} ({count} キューに追加)",
	"Setup is not finished — nothing will sync until you choose a sync direction. Click to finish.":
		"設定は完了していません。同期方向を選択するまで、何も同期されません。完了するにはクリックしてください。",
	"Sync paused — click to choose a sync direction":
		"同期を一時停止 — 同期方向を選択するにはクリック",
	"Engram: offline ({count} queued)": "Engram: オフライン ({count} 件待ち)",
	"Engram: offline": "Engram: オフライン",
	"Server unreachable — changes will sync when connected":
		"サーバーに接続できません — 接続すると変更が同期されます",
	"Engram: error": "Engram: エラー",
	"Unknown error": "不明なエラー",
	"Engram: syncing ({count})": "Engram: 同期中 ({count})",
	"Engram: syncing": "Engram: 同期中",
	"Sync in progress...": "同期処理中...",
	"Engram: pending ({count})": "Engram: 待機中 ({count})",
	"{count} files queued": "{count}つのファイルが処理待ちです",
	"Engram: live": "Engram: 接続中",
	"WebSocket connected — live sync active": "WebSocket 接続済み — リアルタイム同期中",
	"Click to sync": "同期を開始",
	"Engram: ⚠ {count} sync errors": "Engram: ⚠ 同期エラー {count}件",
	"Last sync: {when}": "最終同期: {when}",
	"Engram Sync: pulled {count} changes": "Engram 同期: {count}つの変更を適用しました",
	'Engram Sync: sync state for "{name}" was unreadable — using the on-disk copy.':
		'Engram 同期: "{name}" の同期状態が読み込めませんでした。ディスク上のコピーを使用しています。',
	"Engram Vault Sync {version} is available. {link}.":
		"Engram Vault Sync {version} が利用可能です。{link}.",
	"{formatted} files · ": "{formatted} 個のファイル ·",
	"Notes searchable": "検索可能なノート",
	"Notes past this still sync and open normally, they are just not in the search index. The index keeps your oldest notes, so it is your newest ones that fall outside.":
		"ここより後のノートは通常通り同期され、開くことができます。ただし、検索インデックスには含まれません。インデックスには古いノートが保持されるため、新しいノートが対象外になることがあります。",
	"Notes stored": "ノートを保存",
	Attachments: "添付ファイル",
	"AI searches": "AI検索",
	"{formatted} per day": "{formatted} /日",
	Keyword: "キーワード",
	Semantic: "セマンティック",
	Both: "両方",
	"matches your words and their other forms — 'run' finds 'running' — plus this device.":
		'入力された単語と、その関連語形に一致します。例: "run" で "running" もヒットします。また、このデバイスも検索対象です。',
	"matches meaning. Finds notes that never use the words you typed.":
		"意味に一致するものを検索します。入力した単語を使わないノートもヒットします。",
	"matches words and meaning together, plus this device. Widest results.":
		"単語と意味の両方に一致するものを検索します。このデバイスも検索対象です。最も広範囲な検索結果が得られます。",
	"Engram indexes {indexed} of your {all} notes. The rest match on this device only. Upgrade to index everything.":
		"Engram は、あなたの {all} 個のノートのうち {indexed} 個をインデックス化しています。残りはこのデバイスでのみ検索可能です。すべてをインデックス化するにはアップグレードしてください。",
	"Searching {indexed} of {all} notes. Upgrade to search everything.":
		"{all} 個のノートのうち {indexed} 個を検索中です。すべてを検索するにはアップグレードしてください。",
	"Search your vault…": "保管庫を検索…",
	"Clear search": "検索をクリア",
	"Search settings": "検索設定",
	"Filter by folder…": "フォルダで絞り込み…",
	"Filter by tags…": "タグで絞り込み…",
	"Remove tag {tag}": "タグ {tag} を削除",
	"Engram unreachable. Showing matches from this device only.":
		"Engram に接続できません。このデバイスでのみ検索結果を表示しています。",
	"Search failed — check connection": "検索に失敗しました。接続を確認してください",
	"No results found": "結果が見つかりませんでした",
	Untitled: "タイトルなし",
	"meaning + exact": "意味 + 完全一致",
	"match strength: {pct}%": "一致度: {pct}%",
	"No source path for this result": "この結果にソースパスがありません",
	"Note not synced locally": "ノートがローカルに同期されていません",
	"Syncing...": "同期中...",
	"👋 Welcome": "👋 ようこそ",
	"🔌 Connection": "🔌 接続",
	"🔄 Sync Center": "🔄 同期センター",
	"⚙️ Advanced": "⚙️ 詳細設定",
	"Engram: settings tab failed to render ({error})":
		"Engram: 設定タブの表示に失敗しました ({error})",
	Disconnected: "接続解除",
	"Error: {error}": "エラー: {error}",
	unknown: "不明",
	"Connected — waiting for first sync decision": "接続済み - 最初の同期待ち",
	"Connected — live sync active": "接続済み - ライブ同期中",
	"Connected — polling": "接続済み - ポーリング中",
	"Not configured": "設定されていません",
	"Open sync setup": "同期設定を開く",
	"waiting for a connection": "接続待ち",
	"sync is paused": "同期を一時停止",
	"syncing now": "同期中",
	"waiting to retry": "再試行待ち",
	"{count} not on your plan": "{count} はプランに含まれていません",
	"{count} need attention": "{count}件、注意が必要です",
	"{count} retrying": "{count} 再試行中",
	"{count} ignored": "{count} 無視",
	"{count} queued — {reason}": "{count} キューに追加 — {reason}",
	"Sync...": "同期中...",
	"sync failed": "同期に失敗",
	Refresh: "更新",
	"Not synced on your plan ({count})": "プランでは同期できません ({count})",
	"These files are fine. They just need a paid plan to sync.":
		"これらのファイルは問題ありません。同期するには有料プランが必要です。",
	"Show files ({count}) ▾": "ファイルを表示 ({count}) ▾",
	"Sync these now": "今すぐ同期",
	"Needs attention ({count})": "注意が必要です ({count})",
	"Clear all": "すべてをクリア",
	"Nothing needs your attention. 🎉": "問題ありません。🎉",
	Dismiss: "閉じる",
	"Retrying automatically ({count})": "自動再試行 ({count})",
	"Retry all now": "今すぐすべてを再試行",
	"Temporary errors. These clear themselves once the server recovers.":
		"一時的なエラーです。サーバーが復旧すると自動的に解消されます。",
	"{count} attempts": "{count}回試行しました",
	Open: "開く",
	Ignore: "除外",
	"No files ignored. Use the ignore button on a failure row to stop syncing it.":
		"除外されているファイルはありません。エラーが発生した行の除外ボタンを使用して、そのファイルの同期を停止します。",
	Restore: "復元",
	"File not found locally: {path}": "ローカルにファイルが見つかりません: {path}",
	"Ignored {path} — won't sync until restored from Sync Center.":
		"{path} を除外しました。同期センターから復元するまで同期されません。",
	"Restored {path} — will sync on next push.":
		"{path} を復元しました。次回の同期で反映されます。",
	Clear: "クリア",
	"No activity yet. Push or pull to see entries here.":
		"まだ何もありません。プッシュまたはプルでエントリを表示します。",
	Stats: "統計",
	"Notes on this device": "このデバイス上のノート",
	"Attachments on this device": "このデバイス上の添付ファイル",
	"Remote vault": "リモート保管庫",
	"not linked": "未連携",
	"Plan usage": "利用状況",
	"Sync log": "同期ログ",
	"Showing {count} entries": "{count}件を表示中",
	"No sync activity this session.": "このセッションでは同期の履歴がありません。",
	"({count} errors)": "({count}件のエラー)",
	"Could not compare with the cloud. Check your connection.":
		"クラウドとの比較に失敗しました。接続を確認してください。",
	"Your login expired. Sign in again in Engram settings to continue.":
		"ログインが期限切れです。Engramの設定で再度ログインしてください。",
	"Couldn't create vault — the name may be invalid or already in use.":
		"保管庫の作成に失敗しました。名前が無効であるか、すでに使用されている可能性があります。",
	"Could not create the vault — check your connection and try again.":
		"保管庫の作成に失敗しました。接続を確認し、再度お試しください。",
	"Free syncs notes only — {count} attachments will be skipped.":
		"無料ではノートのみ同期。添付ファイルは{count}つまで。",
	"Uploads {up}, downloads {down}.": "アップロード {up}、ダウンロード {down}.",
	"Uploads {count}.": "アップロード {count}.",
	"Downloads {count}.": "ダウンロード {count}.",
	"{count} conflicts to resolve.": "解決すべき競合が{count}件あります。",
	"Safe choice: combines both sides, nothing is deleted.":
		"安全な選択肢：両方を組み合わせ、何も削除しません。",
	"Nothing is deleted.": "何も削除しません。",
	"Already in sync. Nothing is deleted.": "すでに同期されています。何も削除しません。",
	"Delete all {count} files currently on the server":
		"サーバー上の{count}つのファイルをすべて削除します",
	"Upload {count} files from this vault": "この保管庫から{count}つのファイルをアップロードします",
	"Delete all {count} files in this vault": "この保管庫内の{count}つのファイルをすべて削除します",
	"Download {count} files from the server": "サーバーから{count}つのファイルをダウンロードします",
	Sync: "同期",
	"Upload local files without downloading the remote":
		"ローカルファイルをアップロードする際に、リモートからのダウンロードは行いません",
	"Delete all on remote, then upload local files":
		"リモート上のファイルをすべて削除し、その後ローカルファイルをアップロードします",
	"Download remote files without uploading the local":
		"リモートファイルをダウンロードする際に、ローカルファイルのアップロードは行いません",
	"Delete all local files, then download from remote":
		"ローカルファイルをすべて削除し、リモートからダウンロードします",
	"Set up sync for this vault": "この保管庫の同期を設定します",
	"You are now pointing at a different cloud vault": "現在、別のクラウド保管庫を参照しています",
	"Sync preview": "同期プレビュー",
	"Nothing to sync yet — this vault is empty on both sides. Start syncing and everything you write appears on your other devices.":
		"まだ同期するものがありません。この保管庫は両方で空です。同期を開始すると、書いたものが他のデバイスにも表示されます。",
	"Start syncing": "同期を開始します",
	"{count} notes": "{count} ノート",
	"{count} attachments": "{count}つの添付ファイル",
	"{first} and {second}": "{first} と {second}",
	files: "ファイル",
	"This vault is empty on the server. Upload your {what}?":
		"この保管庫はサーバー上で空です。{what} をアップロードしますか？",
	"Upload everything": "すべてをアップロード",
	"Nothing will be removed from this device.": "このデバイスからファイルは削除されません。",
	"This device's vault is empty. Download {what} from the server?":
		"このデバイスの保管庫が空です。サーバーから {what} をダウンロードしますか？",
	"Download everything": "すべてをダウンロード",
	Done: "完了",
	"Send debug logs. Note content stays private.":
		"デバッグログを送信します。ノートの内容は非公開です。",
	"Comparing your vault with the cloud…": "保管庫とクラウドを比較しています…",
	"Not now": "今は不要",
	"Change vault": "保管庫を変更",
	"Advanced sync options": "詳細な同期オプション",
	"Everything is in sync": "すべて同期済み",
	"This vault": "この保管庫",
	"Cloud server": "クラウドサーバー",
	" conflicts need resolution": "解決が必要な競合があります",
	notes: "ノート",
	attachments: "添付ファイル",
	folders: "フォルダ",
	"Confirm destructive sync": "破壊的な同期を確認",
	"You are about to:": "以下の操作を行います:",
	"Files that will be deleted:": "削除されるファイル:",
	"This cannot be undone.": "この操作は取り消せません。",
	Back: "戻る",
	Confirm: "確認",
	"Switch vault": "保管庫を切り替え",
	"Pick a vault to sync with. We will recalculate the sync preview after you choose.":
		"同期する保管庫を選択してください。選択後、同期プレビューを再計算します。",
	"Loading vaults…": "保管庫を読み込み中…",
	" (default)": "(デフォルト)",
	"No other vaults available.": "他の保管庫は利用できません。",
	"Make new vault": "新しい保管庫を作成",
	"New vault": "新しい保管庫",
	"Create a new empty vault on the server, then sync this Obsidian vault into it.":
		"サーバー上に新しい空の保管庫を作成し、このObsidian保管庫をそこに同期します。",
	"Vault name": "保管庫名",
	Create: "作成",
	"Could not load vaults": "保管庫の読み込みに失敗しました",
	"Enter a name for the new vault": "新しい保管庫の名前を入力してください",
	"Failed to switch vault": "保管庫の切り替えに失敗しました",
	"Your vault shares {percent} of its data with Engram":
		"あなたの保管庫のデータの一部({percent})がEngramと共有されています",
	"Type {keyword} to confirm:": "確認のため、{keyword}を入力してください:",
	"Uploading {count}.": "{count}のアップロード中...",
	"Downloading {count}.": "{count}のダウンロード中...",
	"Deleting {count} local files.": "{count}つのローカルファイルを削除しています。",
	"Deleting {count} on the cloud.": "クラウド上の{count}を削除しています。",
	"First sync, this may take a moment.": "初回同期のため、しばらく時間がかかる場合があります。",
	"Checking for changes.": "変更をチェックしています。",
	"Nothing will be deleted.": "データは削除されません。",
	"✓ {count} synced": "✓ {count} 同期済み",
	"⤳ {count} skipped (Free plan)": "⤳ {count} 同期されませんでした (無料プラン)",
	"✕ {count} failed": "✕ {count} 失敗",
	"{count} attachments need a paid plan to sync. See Sync Center.":
		"{count}つの添付ファイルは、有料プランでのみ同期可能です。詳細はこちら: 同期センター。",
	"Finished with some errors. Open the sync log to see what failed.":
		"一部のエラーで完了しました。エラーの詳細については、同期ログをご確認ください。",
	"Synced. Some attachments need a paid plan to sync (see below).":
		"同期完了。一部の添付ファイルは有料プランでのみ同期可能です (下記参照)。",
	"All synced. Your vault and the cloud now match.":
		"すべて同期されました。保管庫とクラウドが一致しました。",
	"Already up to date. Nothing needed syncing.":
		"すでに最新の状態です。同期する必要はありません。",
	Deleting: "削除中",
	Downloading: "ダウンロード中",
	Uploading: "アップロード中",
	"Syncing your vault": "保管庫の同期",
	"Getting started…": "開始します…",
	"Open Engram to check your vault and confirm everything synced.":
		"Engramを開いて、保管庫の内容を確認し、すべてが同期されていることを確認してください。",
	"Open Engram": "Engramを開く",
	"You can close this and the sync keeps running in the background.":
		"このウィンドウを閉じても、同期はバックグラウンドで続行されます。",
	"Run in background": "バックグラウンドで実行",
	"Syncing…": "同期中…",
	"Sync complete": "同期完了",
	"Syncing attachments": "添付ファイルの同期",
	Complete: "完了",
	'{count} failed. Run "{command}" for details.':
		'{count} が失敗しました。詳細については "{command}" を参照してください。',
	"Free syncs notes only — images & PDFs need a paid plan.":
		"ノートのみ無料で同期。画像とPDFは有料プランが必要です。",
	"Engram: {count} files failed to sync{detail} — open Sync Center":
		"Engram: 同期に失敗したファイルが{count}件あります{detail} — 同期センターを開く",
	"Engram: {count} attachments skipped — upgrade to sync images & PDFs.":
		"Engram: 添付ファイルが{count}件スキップされました。画像やPDFを同期するには、アップグレードしてください。",
	"Engram: plan upgraded — syncing {count} attachments…":
		"Engram: プランがアップグレードされました — {count}つの添付ファイルを同期中…",
	"Pull all (delete extras) aborted: could not obtain an exclusive server snapshot (replay contention). Nothing was trashed.":
		"全件取得（重複削除）が中断されました：専用サーバーのスナップショットを取得できませんでした（競合）。データは削除されていません。",
	"Pull all aborted: another sync is running (replay contention). Try again when it finishes.":
		"全件取得が中断されました：別の同期処理中です（競合）。完了後に再度お試しください。",
	"Pull all failed: {error}": "全件取得に失敗しました：{error}",
	"Pull all failed": "全件取得に失敗しました",
	"Engram: sync conflict on {path} — your local edit was saved as {copy}":
		"Engram：{path} での同期競合が発生しました。ローカルの編集内容は {copy} として保存されました",
	"Open note": "ノートを開く",
	"Engram: {count} notes have frontmatter problems. Open Sync Center to fix.":
		"Engram：{count} 件のノートに、フロントマターの問題があります。同期センターを開いて修正してください。",
	'Engram Sync: renamed "{name}" (unsupported characters)':
		'Engram Sync："{name}" という名前を変更しました（サポートされていない文字）',
	'Engram: frontmatter problem in "{name}"': 'Engram："{name}" にフロントマターの問題があります',
	"Engram: this plugin is too old to sync (needs {version} or newer). Update it to continue.":
		"Engram：このプラグインは古く、同期できません（{version} 以降が必要です）。続行するには更新してください。",
	"Engram: this plugin is too old to sync. Update it to continue.":
		"Engram：このプラグインは古く、同期できません。続行するには更新してください。",
	Update: "更新",
	"New here? Watch the setup video": "初めての方はこちら。セットアップ動画をご覧ください",
	"What Engram does, and how to connect your vault, start to finish.":
		"Engramの機能と、保管庫の接続方法を最初から最後まで説明します。",
	"▶ Watch on YouTube": "▶ YouTubeで見る",
	"Getting set up": "セットアップ",
	"1. Make an account": "1. アカウントを作成",
	"Create a hosted account at ":
		"以下のURLでホストされたアカウントを作成するか、バックエンドを自己ホストします (",
	", or self-host the backend (": "セットアップガイド",
	"setup guide": "2. Engramに保管庫を接続",
	"2. Connect your vault to Engram": "2. 保管庫をEngramに接続します",
	"Sign in (or enter your server URL and key) on the connection tab, then run your first sync.":
		"接続タブを開く",
	"Open connection tab": "接続タブを開く",
	"3. Connect your AI": "3. AIとの接続",
	"Link Claude, Cursor, ChatGPT, or any MCP app so it can read and write your notes. ":
		"Claude、Cursor、ChatGPT、またはその他のMCPアプリを連携させて、ノートの読み書きを可能にします",
	"See the AI setup guide": "AIの設定ガイドを見る",
	Plans: "料金プラン",
	Free: "無料",
	"1 vault, 2 devices": "1つの保管庫、2つのデバイス",
	"Real-time sync": "リアルタイム同期",
	"2,000 notes searchable": "2,000件までのノートを検索可能",
	"Connect any AI (MCP)": "任意のAI（MCP）を連携",
	Starter: "Starter",
	"10 vaults, unlimited devices": "10個の保管庫、デバイス数無制限",
	"Search all your notes": "全てのノートを検索可能",
	"10 GB attachments": "10 GB 添付ファイル",
	"Unlimited AI searches": "AI検索 無制限",
	Pro: "Pro",
	"Unlimited vaults": "保管庫 無制限",
	"Search across all vaults at once": "全ての保管庫をまとめて検索",
	"50 GB attachments": "50 GB 添付ファイル",
	"API access": "APIアクセス",
	"See full pricing": "詳細な料金を見る",
	"Learn more": "詳細はこちら",
	Documentation: "ドキュメント",
	"AI / MCP setup guide": "AI / MCP 設定ガイド",
	"Report an issue": "問題を報告する",
	"Join our Discord": "Discordに参加",
	"Node.js dependencies": "Node.jsの依存関係",
	"Python virtual environment": "Python仮想環境",
	"Python bytecode cache": "Pythonバイトコードキャッシュ",
	"Vendored dependencies": "組み込みの依存関係",
	"Gradle build cache": "Gradleビルドキャッシュ",
	"Rust/Java build output": "Rust/Javaビルド出力",
	"Build output": "ビルド出力",
	"Next.js build output": "Next.jsビルド出力",
	"Distribution build output": "ディストリビューションビルド出力",
	"Cargo cache": "Cargoキャッシュ",
	"CocoaPods dependencies": "CocoaPodsの依存関係",
	"Dart tool cache": "Dartツールのキャッシュ",
	"Generic cache directory": "一般的なキャッシュディレクトリ",
	"Ignore patterns": "除外パターン",
	"Custom patterns": "カスタムパターン",
	"Paths to skip (one per line). Folder patterns end with /. Built-in: {configDir}/, .trash/, .git/":
		'除外するパス（1行に1つ）。フォルダのパターンは"/"で終わります。内蔵: {configDir}/, .trash/, .git/',
	Diagnostics: "診断",
	"Send detailed sync, vault, and connection activity to the server for troubleshooting, with distributed tracing on requests. Metadata only, never note content. Leave off for normal use.":
		"トラブルシューティングのため、詳細な同期、保管庫、接続の情報をサーバーに送信します。リクエストには分散トレーシングが含まれます。メタデータのみ送信し、ノートの内容は送信しません。通常の使用ではオフにしてください。",
	"Diagnostics detail": "診断の詳細",
	"Minimum severity that ships while diagnostics are on. Higher levels send fewer lines. Default: Info.":
		"診断が有効な場合に送信される最小の重要度。レベルが高いほど、送信される行数が少なくなります。デフォルト: Info",
	"Errors only": "エラーのみ",
	"Warnings and errors": "警告とエラー",
	"Info (default)": "情報（デフォルト）",
	"Debug (verbose)": "デバッグ（詳細）",
	About: "概要",
	"License: {name}": "ライセンス: {name}",
	"⚠ Detected: {label}/ ({formatted} files)": "⚠ 検出: {label} 個 ({formatted} ファイル)",
	"{desc} — should not be synced": "{desc} — 同期対象外",
	"Add to ignores": "除外リストに追加",
	"Added {pattern} to ignore patterns": "{pattern} を除外リストに追加しました",
	"Version: {version}": "バージョン: {version}",
	"Source: {link}": "情報源: {link}",
	"Engram URL": "EngramのURL",
	"✓ Engram server reachable (v{version})": "✓ Engramサーバーに接続可能 (v{version})",
	"✗ server responded but isn't an Engram backend":
		"✗ サーバーからの応答ありましたが、Engramのサーバーではありません",
	"✗ couldn't reach a server at this URL": "✗ このURLのサーバーに接続できませんでした",
	"Checking server…": "サーバーの確認中…",
	"That does not look like a complete server address. Include the scheme, for example http://127.0.0.1:4000":
		"これは完全なサーバーアドレスのように見えません。スキームを含めてください。例: http://127.0.0.1:4000",
	"Engram backend changed — sign in again to continue.":
		"Engramのバックエンドが変更されました。続行するには、再度サインインしてください。",
	Authentication: "認証",
	"Signed in as {email}": "{email} としてサインインしました",
	"Authenticated via Engram account (OAuth).": "Engramアカウント（OAuth）で認証済み",
	"Manage account": "アカウントの管理",
	"Sign out": "サインアウト",
	"Using API key": "APIキーを使用中",
	"Authenticated via manual API key.": "手動で入力したAPIキーで認証済み",
	"Clear key": "キーをクリア",
	"Switch to sign in": "サインインに切り替え",
	"Engram: sign-in failed ({error})": "Engram: ログインに失敗しました ({error})",
	"Sign in or create an account": "ログインまたはアカウントを作成",
	"Opens your browser to sign in, or create an account if you don't have one yet, then links this vault.":
		"ブラウザを開き、ログインするか、アカウントを作成して、この保管庫をリンクします。",
	"Sign in": "ログイン",
	"Or authenticate with a token instead of signing in. Engram Cloud API keys require the Pro plan; on Free and Starter, sign in above.":
		"または、サインインの代わりにトークンで認証します。Engram Cloud APIキーはProプランが必要です。FreeおよびStarterプランでは、上記からサインインしてください。",
	"Or authenticate with a token instead of signing in.":
		"または、サインインの代わりにトークンで認証します。",
	"API key": "APIキー",
	Token: "トークン",
	"Bearer token from your Engram account.": "Engramアカウントのベアラートークン。",
	Save: "保存",
	"Enter an API key first": "まずAPIキーを入力してください",
	"That does not look like an Engram API key (expected {prefix}…).":
		"これはEngramのAPIキーのように見えません (期待されるのは {prefix}…)",
	Vault: "保管庫",
	"Vault selection": "保管庫の選択",
	"Select which vault this plugin syncs with.": "このプラグインで同期する保管庫を選択します。",
	"No vaults found — first sync will create one":
		"保管庫が見つかりません。初回同期時に作成されます",
	"Pick a vault (previous: '{name}' not found)": "保管庫を選択 (以前: '{name}' が見つかりません)",
	"Pick a vault (previous: id {id} not found)": "保管庫を選択 (以前: ID {id} が見つかりません)",
	"Pick a vault": "保管庫を選択",
	Change: "変更",
	"Support development": "開発を支援",
	"If this plugin saves you time, consider supporting development.":
		"このプラグインが時間を節約できた場合、開発を支援をご検討ください。",
	"GitHub Sponsors": "GitHub Sponsors",
	"Sign-in required to load vaults": "保管庫を読み込むにはサインインが必要です",
	"Server error ({status}) — check Engram logs":
		"サーバーエラー ({status}) – Engram のログを確認してください",
	"Request failed ({status})": "リクエストに失敗しました ({status})",
	"Could not reach Engram — check connection": "Engramに接続できません。接続を確認してください",
	"Engram Cloud": "Engram クラウド",
	"Self-hosted": "ローカル環境",
	Backend: "バックエンド",
	"Where this vault syncs to. Each backend keeps its own sign-in.":
		"この保管庫が同期される場所。各バックエンドは個別のサインインが必要です。",
	"Switched to {mode}.": "{mode} に切り替えました。",
	"Not connected. Enter your Engram server URL below to start syncing.":
		"接続されていません。同期を開始するには、EngramサーバーのURLを入力してください。",
	"Run your own Engram server": "独自のEngramサーバーを構築",
	"Engram is the backend that powers sync and semantic search.":
		"Engramは、同期とセマンティック検索を支えるバックエンドです。",
	"Nothing in this vault syncs until you choose how to merge it with the server.":
		"この保管庫の内容は、サーバーとの連携方法を選択するまで同期されません。",
	"Choose sync direction": "同期方向を選択してください",
	"...": "...",
	'... "{name}" ...': '... "{name}" ...',
};

export default ja;
