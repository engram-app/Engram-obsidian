import type { Dict } from "..";

// 한국어
const ko: Dict = {
	"Code copied!": "코드를 복사했습니다.",
	"Engram sync: syncing...": "Engram 동기화: 동기화 중…",
	"Engram Sync: pulled {pulled}, pushed {pushed}":
		"Engram 동기화: {pulled}건 받음, {pushed}건 보냄",
	"Engram: disconnected. Open Engram settings to reconnect.":
		"Engram: 연결이 끊어졌습니다. Engram settings를 열어 다시 연결하세요.",
	"Engram sync: checking...": "Engram 동기화: 확인 중…",
	"Engram sync: everything in sync": "Engram 동기화: 모두 동기화되었습니다",
	"Engram sync: pulling all from server...": "Engram 동기화: 서버에서 전체를 받는 중…",
	"Engram Sync: pushed {pushed}": "Engram 동기화: {pushed}건을 보냈습니다",
	"Engram sync: sync failed": "Engram 동기화: 동기화에 실패했습니다",
	"Engram: your login expired — open Engram settings to reconnect.":
		"Engram: 로그인이 만료되었습니다. Engram settings를 열어 다시 연결하세요.",
	"Engram: This vault has been deleted on the server.":
		"Engram: 이 보관함은 서버에서 삭제되었습니다.",
	"Engram Sync: pulled {pulled} (local extras deleted)":
		"Engram 동기화: {pulled}건을 받았습니다 (로컬의 남은 파일 삭제)",
	"Engram Sync: pulled {pulled}": "Engram 동기화: {pulled}건을 받았습니다",
	"Engram Sync: replaced remote with local ({pushed} uploaded)":
		"Engram 동기화: 서버 내용을 로컬 내용으로 바꿨습니다 ({pushed}건 업로드)",
	"Engram: sync failed. Open the sync log for details.":
		"Engram: 동기화에 실패했습니다. 자세한 내용은 동기화 로그를 확인하세요.",
	"Engram unreachable. Showing matches from this device only.":
		"Engram에 연결할 수 없습니다. 이 기기의 결과만 표시합니다.",
	"No source path for this result": "이 결과에는 원본 파일 경로가 없습니다",
	"Note not synced locally": "이 노트는 아직 로컬에 동기화되지 않았습니다",
	"Engram: settings tab failed to render ({error})":
		"Engram: 설정 탭을 표시하지 못했습니다 ({error})",
	"File not found locally: {path}": "로컬에서 파일을 찾을 수 없습니다: {path}",
	"Restored {path} — will sync on next push.":
		"{path}을(를) 복원했습니다. 다음 전송 때 동기화됩니다.",
	"Ignored {path} — won't sync until restored from Sync Center.":
		"{path}을(를) 무시했습니다. Sync Center에서 복원할 때까지 동기화되지 않습니다.",
	"Added {pattern} to ignore patterns": "{pattern}을(를) 제외 패턴에 추가했습니다",
	"Engram backend changed — sign in again to continue.":
		"Engram 백엔드가 변경되었습니다. 계속하려면 다시 로그인하세요.",
	"Engram: sign-in failed ({error})": "Engram: 로그인에 실패했습니다 ({error})",
	"Enter an API key first": "먼저 API 키를 입력하세요",
	"Switched to {mode}.": "{mode}(으)로 전환했습니다.",

	"Engram Sync: pushed {count} files": "Engram 동기화: 파일 {count}개를 보냈습니다",
	"Engram Sync: pulled {count} files from server":
		"Engram 동기화: 서버에서 파일 {count}개를 받았습니다",
	"Engram Sync: pulled {count} changes": "Engram 동기화: 변경 {count}건을 받았습니다",
	"Engram: {count} files failed to sync{detail} — open Sync Center":
		"Engram: 파일 {count}개를 동기화하지 못했습니다{detail}. Sync Center를 열어보세요",
	"Engram: {count} attachments skipped — upgrade to sync images & PDFs.":
		"Engram: 첨부 파일 {count}개를 건너뛰었습니다. 이미지와 PDF를 동기화하려면 업그레이드하세요.",
	"Engram: plan upgraded — syncing {count} attachments…":
		"Engram: 요금제를 업그레이드했습니다. 첨부 파일 {count}개를 동기화하는 중…",
	// 402 limit reasons (limit-copy.ts). These gate payment, so they are the
	// highest-value strings in the plugin to get right.
	"Note limit reached. Upgrade to keep adding notes.":
		"노트 수 상한에 도달했습니다. 업그레이드하면 계속 추가할 수 있습니다.",
	"Vault limit reached. Upgrade for more vaults.":
		"보관함 수 상한에 도달했습니다. 업그레이드하면 더 만들 수 있습니다.",
	"This file type isn't accepted by this server.": "이 서버는 해당 파일 형식을 받지 않습니다.",
	"Attachment sync is disabled for this account.":
		"이 계정에서는 첨부 파일 동기화가 꺼져 있습니다.",
	"Attachment storage is full — upgrade for more.":
		"첨부 파일 저장 공간이 가득 찼습니다. 업그레이드하면 늘릴 수 있습니다.",
	"File too large for your plan.": "현재 요금제로는 파일이 너무 큽니다.",
	"Already signed in on another device. Upgrade for multi-device.":
		"다른 기기에서 이미 로그인되어 있습니다. 업그레이드하면 여러 기기를 쓸 수 있습니다.",
	"Device swap cooldown active. Wait or upgrade.":
		"기기 전환 대기 시간입니다. 잠시 기다리거나 업그레이드하세요.",
	"Too many connected Obsidian vaults. Disconnect one or upgrade.":
		"연결된 Obsidian 보관함이 너무 많습니다. 하나를 해제하거나 업그레이드하세요.",
	"Too many connected AI clients. Disconnect one or upgrade.":
		"연결된 AI 클라이언트가 너무 많습니다. 하나를 해제하거나 업그레이드하세요.",
	"Daily AI search limit reached. Free includes 20 per day across Obsidian, the web app and MCP. Upgrade for unlimited.":
		"일일 AI 검색 한도에 도달했습니다. 무료 요금제는 Obsidian, 웹 앱, MCP를 합쳐 하루 20회입니다. 업그레이드하면 무제한입니다.",
	"API keys need Pro. Sign in with your Engram account instead.":
		"API 키는 Pro 요금제가 필요합니다. 대신 Engram 계정으로 로그인하세요.",
	"Account suspended. Contact support.": "계정이 정지되었습니다. 지원팀에 문의하세요.",
	"Account setup incomplete.": "계정 설정이 완료되지 않았습니다.",
	"This account was deleted. Contact support if that is wrong.":
		"이 계정은 삭제되었습니다. 잘못된 경우 지원팀에 문의하세요.",
	"Finish setting up your account at app.engram.page to start syncing.":
		"app.engram.page에서 계정 설정을 마치면 동기화를 시작할 수 있습니다.",
	"Limit reached. Upgrade to continue.":
		"한도에 도달했습니다. 업그레이드하면 계속할 수 있습니다.",
	// UI strings
	"Link Obsidian to Engram": "Obsidian을 Engram에 연결",
	"Failed to start device flow. Check your Engram URL and try again.":
		"기기 인증을 시작하지 못했습니다. Engram URL을 확인하고 다시 시도하세요.",
	"Your code:": "코드:",
	"A browser window has opened. Sign in and enter this code to link your vault.":
		"브라우저 창이 열렸습니다. 로그인한 뒤 이 코드를 입력하면 보관함이 연결됩니다.",
	Cancel: "취소",
	"Code expired. Please try again.": "코드가 만료되었습니다. 다시 시도하세요.",
	"Try again": "다시 시도",
	Close: "닫기",
	"Note couldn't be processed": "이 노트를 처리할 수 없습니다",
	"The server couldn't process this note. Check its contents, then edit and save to try again.":
		"서버가 이 노트를 처리하지 못했습니다. 내용을 확인한 뒤 편집하고 저장하면 다시 시도합니다.",
	"Attachments need a paid plan": "첨부 파일에는 유료 요금제가 필요합니다",
	"The Free tier syncs notes only. Upgrade to sync images and PDFs.":
		"무료 요금제는 노트만 동기화합니다. 이미지와 PDF를 동기화하려면 업그레이드하세요.",
	"Attachment storage full": "첨부 파일 저장 공간이 가득 찼습니다",
	"You've used all the attachment storage on your plan. Upgrade for more.":
		"요금제의 첨부 파일 공간을 모두 썼습니다. 업그레이드하면 늘릴 수 있습니다.",
	"Too large for the server": "서버 크기 제한을 넘었습니다",
	"The server limit is 5 MB. Compress or split the file, then it will sync.":
		"서버 제한은 5 MB입니다. 압축하거나 나누면 동기화됩니다.",
	"Sign-in expired": "로그인이 만료되었습니다",
	"Reconnect your account to resume syncing.": "계정을 다시 연결하면 동기화를 이어갑니다.",
	"Unresolved conflict": "해결되지 않은 충돌",
	"Open the file to resolve the conflict, then sync again.":
		"파일을 열어 충돌을 해결한 뒤 다시 동기화하세요.",
	"Frontmatter needs a fix": "frontmatter를 고쳐야 합니다",
	"The note synced, but its frontmatter could not be fully parsed. Open it to fix the highlighted line.":
		"노트는 동기화되었지만 frontmatter를 완전히 해석하지 못했습니다. 열어서 강조된 줄을 고치세요.",
	"Server error": "서버 오류",
	"A temporary server problem — retrying automatically.":
		"일시적인 서버 문제입니다. 자동으로 다시 시도합니다.",
	"Network unavailable": "네트워크를 사용할 수 없습니다",
	"Can't reach the server — retrying automatically.":
		"서버에 연결할 수 없습니다. 자동으로 다시 시도합니다.",
	"Sync failed": "동기화 실패",
	"An unexpected error — retrying automatically.":
		"예상치 못한 오류입니다. 자동으로 다시 시도합니다.",
	Upgrade: "업그레이드",
	"Update in settings": "설정에서 업데이트",
	"Engram: ready": "Engram: 준비됨",
	"Resume sync": "동기화 다시 시작",
	"Engram Vault Sync {version} is available. {link}.":
		"Engram Vault Sync {version}이 나왔습니다. {link}.",
	"Search your vault…": "보관함 검색…",
	"Filter by folder…": "폴더로 필터…",
	"Filter by tags…": "태그로 필터…",
	"Search failed — check connection": "검색에 실패했습니다. 연결을 확인하세요",
	"No results found": "결과가 없습니다",
	"match strength: {pct}%": "일치도: {pct}%",
	"Open sync setup": "동기화 설정 열기",
	"Last sync: {when}": "마지막 동기화: {when}",
	"waiting for a connection": "연결을 기다리는 중",
	"sync is paused": "동기화가 일시 중지됨",
	"syncing now": "지금 동기화 중",
	"waiting to retry": "다시 시도를 기다리는 중",
	"{count} not on your plan": "{count}개는 요금제에 포함되지 않음",
	"{count} retrying": "{count}개 재시도 중",
	"{count} ignored": "{count}개 무시됨",
	"{count} queued — {reason}": "{count}개 대기 중: {reason}",
	"These files are fine. They just need a paid plan to sync.":
		"이 파일들에는 문제가 없습니다. 동기화하려면 유료 요금제가 필요할 뿐입니다.",
	"Show files ({count}) ▾": "파일 보기 ({count}) ▾",
	"Sync these now": "지금 이 파일들 동기화",
	"Clear all": "모두 지우기",
	"Nothing needs your attention. 🎉": "처리할 일이 없습니다. 🎉",
	Dismiss: "닫기",
	"Retry all now": "지금 모두 재시도",
	"Temporary errors. These clear themselves once the server recovers.":
		"일시적인 오류입니다. 서버가 복구되면 저절로 사라집니다.",
	Open: "열기",
	Ignore: "무시",
	"No files ignored. Use the ignore button on a failure row to stop syncing it.":
		"무시한 파일이 없습니다. 실패한 줄의 무시 버튼을 누르면 그 파일의 동기화를 멈춥니다.",
	Restore: "복원",
	Clear: "지우기",
	"No activity yet. Push or pull to see entries here.":
		"아직 기록이 없습니다. 올리거나 내리면 여기에 표시됩니다.",
	"Sync log": "동기화 로그",
	"Could not compare with the cloud. Check your connection.":
		"서버와 비교할 수 없습니다. 연결을 확인하세요.",
	"Your login expired. Sign in again in Engram settings to continue.":
		"로그인이 만료되었습니다. 계속하려면 Engram settings에서 다시 로그인하세요.",
	"Couldn't create vault — the name may be invalid or already in use.":
		"보관함을 만들지 못했습니다. 이름이 잘못되었거나 이미 쓰이고 있을 수 있습니다.",
	"Could not create the vault — check your connection and try again.":
		"보관함을 만들지 못했습니다. 연결을 확인하고 다시 시도하세요.",
	"Free syncs notes only — {count} attachments will be skipped.":
		"무료 요금제는 노트만 동기화합니다. 첨부 파일 {count}개는 건너뜁니다.",
	"Comparing your vault with the cloud…": "보관함을 서버와 비교하는 중…",
	"Until you choose, nothing in this vault will sync.":
		"선택하기 전까지 이 보관함은 아무것도 동기화하지 않습니다.",
	"Change vault": "보관함 바꾸기",
	"Advanced sync options": "고급 동기화 옵션",
	"Everything is in sync": "모두 동기화되었습니다",
	" conflicts need resolution": " 건의 충돌을 해결해야 합니다",
	"Confirm destructive sync": "되돌릴 수 없는 동기화 확인",
	"You are about to:": "다음을 실행합니다:",
	"Files that will be deleted:": "삭제될 파일:",
	"This cannot be undone.": "이 작업은 되돌릴 수 없습니다.",
	Back: "뒤로",
	Confirm: "확인",
	"Switch vault": "보관함 전환",
	"Pick a vault to sync with. We will recalculate the sync preview after you choose.":
		"동기화할 보관함을 고르세요. 고른 뒤 동기화 미리보기를 다시 계산합니다.",
	"Loading vaults…": "보관함을 불러오는 중…",
	"No other vaults available.": "사용할 수 있는 다른 보관함이 없습니다.",
	"Make new vault": "새 보관함 만들기",
	"New vault": "새 보관함",
	"Create a new empty vault on the server, then sync this Obsidian vault into it.":
		"서버에 빈 보관함을 만들고, 이 Obsidian 보관함을 그곳으로 동기화합니다.",
	Create: "만들기",
	"Your vault shares {percent} of its data with Engram":
		"이 보관함은 Engram과 데이터의 {percent}를 공유합니다",
	"Type {keyword} to confirm:": "확인을 위해 {keyword}를 입력하세요:",
	"✓ {count} synced": "✓ {count}개 동기화",
	"⤳ {count} skipped (Free plan)": "⤳ {count}개 건너뜀 (무료 요금제)",
	"✕ {count} failed": "✕ {count}개 실패",
	"{count} attachments need a paid plan to sync. See Sync Center.":
		"첨부 파일 {count}개는 동기화에 유료 요금제가 필요합니다. Sync Center를 확인하세요.",
	"Syncing your vault": "보관함을 동기화하는 중",
	"Getting started…": "시작하는 중…",
	"Open Engram to check your vault and confirm everything synced.":
		"Engram을 열어 보관함을 확인하고 모두 동기화되었는지 살펴보세요.",
	"Open Engram": "Engram 열기",
	"You can close this and the sync keeps running in the background.":
		"이 창을 닫아도 동기화는 백그라운드에서 계속됩니다.",
	"Run in background": "백그라운드에서 실행",
	"Syncing…": "동기화 중…",
	"Sync complete": "동기화 완료",
	Done: "완료",
	"Engram: sync conflict on {path} — your local edit was saved as {copy}":
		"Engram: {path}에서 동기화 충돌이 생겼습니다. 로컬 편집은 {copy}로 저장했습니다",
	"Open note": "노트 열기",
	"Engram: {count} notes have frontmatter problems. Open Sync Center to fix.":
		"Engram: 노트 {count}개의 frontmatter에 문제가 있습니다. Sync Center를 열어 고치세요.",
	"New here? Watch the setup video": "처음이신가요? 설치 영상 보기",
	"What Engram does, and how to connect your vault, start to finish.":
		"Engram이 하는 일과 보관함을 연결하는 방법을 처음부터 끝까지.",
	"▶ Watch on YouTube": "▶ YouTube에서 보기",
	"1. Make an account": "1. 계정 만들기",
	"2. Connect your vault to Engram": "2. 보관함을 Engram에 연결",
	"Open connection tab": "연결 탭 열기",
	"3. Connect your AI": "3. AI 연결",
	"Node.js dependencies": "Node.js 의존성",
	"Python virtual environment": "Python 가상 환경",
	"Python bytecode cache": "Python 바이트코드 캐시",
	"Vendored dependencies": "포함된 의존성",
	"Gradle build cache": "Gradle 빌드 캐시",
	"Rust/Java build output": "Rust/Java 빌드 출력",
	"Build output": "빌드 출력",
	"Next.js build output": "Next.js 빌드 출력",
	"Distribution build output": "배포 빌드 출력",
	"Cargo cache": "Cargo 캐시",
	"CocoaPods dependencies": "CocoaPods 의존성",
	"Dart tool cache": "Dart 도구 캐시",
	"Generic cache directory": "일반 캐시 디렉터리",
	"Ignore patterns": "제외 패턴",
	"Custom patterns": "사용자 패턴",
	Diagnostics: "진단",
	"Diagnostics detail": "진단 상세",
	About: "정보",
	"License: {name}": "라이선스: {name}",
	"⚠ Detected: {label}/ ({formatted} files)": "⚠ 발견: {label}/ (파일 {formatted}개)",
	"{desc} — should not be synced": "{desc}. 동기화하면 안 됩니다",
	"Add to ignores": "제외에 추가",
	"Version: {version}": "버전: {version}",
	"Source: {link}": "소스: {link}",
	"Engram URL": "Engram URL",
	"✓ Engram server reachable (v{version})": "✓ Engram 서버에 연결할 수 있습니다 (v{version})",
	"✗ server responded but isn't an Engram backend":
		"✗ 서버가 응답했지만 Engram 백엔드가 아닙니다",
	"✗ couldn't reach a server at this URL": "✗ 이 URL의 서버에 연결할 수 없습니다",
	"Checking server…": "서버를 확인하는 중…",
	Authentication: "인증",
	"Authenticated via Engram account (OAuth).": "Engram 계정(OAuth)으로 인증되었습니다.",
	"Manage account": "계정 관리",
	"Sign out": "로그아웃",
	"Using API key": "API 키 사용 중",
	"Authenticated via manual API key.": "직접 입력한 API 키로 인증되었습니다.",
	"Clear key": "키 지우기",
	"Switch to sign in": "로그인으로 바꾸기",
	"Sign in or create an account": "로그인 또는 계정 만들기",
	"Sign in": "로그인",
	"API key": "API 키",
	Token: "토큰",
	"Bearer token from your Engram account.": "Engram 계정의 Bearer 토큰.",
	Save: "저장",
	"That does not look like an Engram API key (expected {prefix}…).":
		"Engram API 키가 아닌 것 같습니다 ({prefix}로 시작해야 합니다).",
	Vault: "보관함",
	"Vault selection": "보관함 선택",
	"Select which vault this plugin syncs with.": "이 플러그인이 동기화할 보관함을 고릅니다.",
	"No vaults found — first sync will create one":
		"보관함이 없습니다. 첫 동기화 때 하나 만들어집니다",
	"Pick a vault": "보관함 고르기",
	Change: "변경",
	"Support development": "개발 후원",
	"GitHub Sponsors": "GitHub Sponsors",
	Backend: "백엔드",
	"Where this vault syncs to. Each backend keeps its own sign-in.":
		"이 보관함이 동기화되는 곳입니다. 백엔드마다 로그인이 따로입니다.",
	"Run your own Engram server": "직접 운영하는 Engram 서버",
	"Engram is the backend that powers sync and semantic search.":
		"Engram은 동기화와 의미 검색을 담당하는 백엔드입니다.",
	"Finish sync setup": "동기화 설정 마치기",
	"Nothing in this vault syncs until you choose how to merge it with the server.":
		"서버와 어떻게 합칠지 고르기 전까지 이 보관함은 아무것도 동기화하지 않습니다.",
	"Choose sync direction": "동기화 방향 고르기",
	"Engram: this plugin is too old to sync (needs {version} or newer). Update it to continue.":
		"Engram: 이 플러그인이 너무 오래되어 동기화할 수 없습니다 ({version} 이상이 필요합니다). 업데이트한 뒤 계속하세요.",
	"Engram: this plugin is too old to sync. Update it to continue.":
		"Engram: 이 플러그인이 너무 오래되어 동기화할 수 없습니다. 업데이트한 뒤 계속하세요.",
	Update: "업데이트",
	// UI strings (second pass)
	"Invalid API key": "API 키가 잘못되었습니다",
	"Connection failed": "연결에 실패했습니다",
	"Sync now": "지금 동기화",
	"Disconnect (clear login)": "연결 해제 (로그인 정보 지우기)",
	"Push entire vault": "보관함 전체 올리기",
	"Check sync status": "동기화 상태 확인",
	"Engram sync: server does not support reconciliation (update backend)":
		"Engram 동기화: 서버가 대조를 지원하지 않습니다 (백엔드를 업데이트하세요)",
	"Pull all from server (force overwrite)": "서버에서 전체 내리기 (강제로 덮어쓰기)",
	"Show sync log": "동기화 로그 보기",
	"Semantic search": "의미 검색",
	"Open search sidebar": "검색 사이드바 열기",
	"Engram search": "Engram 검색",
	"Open sync center": "Sync Center 열기",
	"Engram: this vault no longer exists on the server. Pick or create a vault to continue.":
		"Engram: 이 보관함은 서버에 없습니다. 계속하려면 보관함을 고르거나 만드세요.",
	"Engram: recovered plugin settings from a backup after a corrupted save.":
		"Engram: 설정 파일이 손상되어 백업에서 복구했습니다.",
	"Engram sync: live sync requires a plugin update — please update the Engram vault sync plugin.":
		"Engram 동기화: 실시간 동기화에는 플러그인 업데이트가 필요합니다. Engram vault sync를 업데이트하세요.",
	"Engram: sync is paused — this edit was not synced. Choose a sync direction to resume.":
		"Engram: 동기화가 일시 중지되었습니다. 이 편집은 동기화되지 않았습니다. 동기화 방향을 고르면 다시 시작합니다.",
	"Engram: not connected": "Engram: 연결되지 않음",
	"Engram: signed out": "Engram: 로그아웃됨",
	"Not connected yet. Click to open settings and link this vault.":
		"아직 연결되지 않았습니다. 눌러서 설정을 열고 이 보관함을 연결하세요.",
	"Not signed in. Click to open settings and reconnect.":
		"로그인하지 않았습니다. 눌러서 설정을 열고 다시 연결하세요.",
	"Engram: finish setup": "Engram: 설정 마치기",
	"Engram: sync paused": "Engram: 동기화 일시 중지",
	"{label} ({count} queued)": "{label} ({count}개 대기)",
	"Setup is not finished — nothing will sync until you choose a sync direction. Click to finish.":
		"설정이 끝나지 않았습니다. 동기화 방향을 고르기 전까지 아무것도 동기화되지 않습니다. 눌러서 마치세요.",
	"Sync paused — click to choose a sync direction":
		"동기화가 일시 중지되었습니다. 눌러서 동기화 방향을 고르세요",
	"Engram: offline ({count} queued)": "Engram: 오프라인 ({count}개 대기)",
	"Engram: offline": "Engram: 오프라인",
	"Server unreachable — changes will sync when connected":
		"서버에 연결할 수 없습니다. 연결되면 동기화됩니다",
	"Engram: error": "Engram: 오류",
	"Unknown error": "알 수 없는 오류",
	"Engram: syncing ({count})": "Engram: 동기화 중 ({count})",
	"Engram: syncing": "Engram: 동기화 중",
	"Sync in progress...": "동기화하는 중…",
	"Engram: pending ({count})": "Engram: 대기 중 ({count})",
	"{count} files queued": "파일 {count}개 대기 중",
	"Engram: live": "Engram: 실시간",
	"WebSocket connected — live sync active": "WebSocket 연결됨. 실시간 동기화가 켜졌습니다",
	"Click to sync": "눌러서 동기화",
	Attachments: "첨부 파일",
	Keyword: "키워드",
	Semantic: "의미",
	Both: "둘 다",
	"matches your words and their other forms — 'run' finds 'running' — plus this device.":
		"입력한 단어와 그 변화형을 찾습니다(run으로 running도 찾습니다). 이 기기의 결과도 포함합니다.",
	"matches meaning. Finds notes that never use the words you typed.":
		"의미로 찾습니다. 입력한 단어가 한 번도 없는 노트도 찾습니다.",
	"matches words and meaning together, plus this device. Widest results.":
		"단어와 의미를 함께 찾고 이 기기의 결과도 포함합니다. 가장 넓게 찾습니다.",
	"Clear search": "검색 지우기",
	"Search settings": "검색 설정",
	Untitled: "제목 없음",
	"meaning + exact": "의미 + 정확",
	Disconnected: "연결 끊김",
	"Connected — waiting for first sync decision": "연결됨. 첫 동기화 선택을 기다리는 중",
	"Connected — live sync active": "연결됨. 실시간 동기화가 켜졌습니다",
	"Connected — polling": "연결됨. 폴링 중",
	"Not configured": "설정되지 않음",
	Refresh: "새로 고침",
	"Not synced on your plan ({count})": "요금제 대상 아님 ({count})",
	"Needs attention ({count})": "처리 필요 ({count})",
	"Retrying automatically ({count})": "자동 재시도 중 ({count})",
	Stats: "통계",
	"Notes on this device": "이 기기의 노트",
	"Attachments on this device": "이 기기의 첨부 파일",
	"Remote vault": "서버 보관함",
	"not linked": "연결 안 됨",
	"Plan usage": "요금제 사용량",
	"Safe choice: combines both sides, nothing is deleted.":
		"안전한 선택: 양쪽을 합치고 아무것도 지우지 않습니다.",
	"Already in sync. Nothing is deleted.": "이미 동기화되었습니다. 아무것도 지우지 않습니다.",
	Sync: "동기화",
	"Upload local files without downloading the remote": "서버에서 내리지 않고 로컬 파일만 올리기",
	"Delete all on remote, then upload local files": "서버의 모든 것을 지운 뒤 로컬 파일 올리기",
	"Download remote files without uploading the local": "로컬을 올리지 않고 서버 파일만 내리기",
	"Delete all local files, then download from remote": "로컬 파일을 모두 지운 뒤 서버에서 내리기",
	"Set up sync for this vault": "이 보관함의 동기화 설정",
	"You are now pointing at a different cloud vault":
		"지금 다른 클라우드 보관함을 가리키고 있습니다",
	"Sync preview": "동기화 미리보기",
	"Start syncing": "동기화 시작",
	"Upload everything": "전부 올리기",
	"Nothing will be removed from this device.": "이 기기에서 아무것도 지우지 않습니다.",
	"Download everything": "전부 내리기",
	"Not now": "나중에",
	"This vault": "이 보관함",
	"Cloud server": "서버 보관함",
	"Vault name": "보관함 이름",
	"Could not load vaults": "보관함을 불러올 수 없습니다",
	"Enter a name for the new vault": "새 보관함의 이름을 입력하세요",
	"Failed to switch vault": "보관함 전환에 실패했습니다",
	"Finished with some errors. Open the sync log to see what failed.":
		"오류가 몇 건 있었습니다. 동기화 로그에서 실패한 항목을 확인하세요.",
	"Synced. Some attachments need a paid plan to sync (see below).":
		"동기화했습니다. 일부 첨부 파일에는 유료 요금제가 필요합니다(아래 참고).",
	"All synced. Your vault and the cloud now match.":
		"모두 동기화했습니다. 보관함과 서버가 같아졌습니다.",
	"Already up to date. Nothing needed syncing.": "이미 최신입니다. 동기화할 것이 없었습니다.",
	Deleting: "삭제 중",
	Downloading: "내리는 중",
	Uploading: "올리는 중",
	"Engram: Show sync log": "Engram: 동기화 로그 보기",
	"Syncing attachments": "첨부 파일 동기화 중",
	Complete: "완료",
	"Getting set up": "설정 시작",
	"setup guide": "설정 안내",
	"Sign in (or enter your server URL and key) on the connection tab, then run your first sync.":
		"연결 탭에서 로그인하거나 서버 URL과 키를 입력한 뒤 첫 동기화를 실행하세요.",
	"See the AI setup guide": "AI 설정 안내 보기",
	Plans: "요금제",
	Free: "무료",
	"1 vault, 2 devices": "보관함 1개, 기기 2대",
	"Real-time sync": "실시간 동기화",
	"2,000 notes searchable": "노트 2,000개 검색 가능",
	"Connect any AI (MCP)": "어떤 AI든 연결 (MCP)",
	Starter: "스타터",
	"10 vaults, unlimited devices": "보관함 10개, 기기 수 제한 없음",
	"Search all your notes": "모든 노트 검색",
	"10 GB attachments": "첨부 파일 10 GB",
	"Unlimited AI searches": "AI 검색 무제한",
	Pro: "프로",
	"Unlimited vaults": "보관함 무제한",
	"Search across all vaults at once": "모든 보관함을 한 번에 검색",
	"50 GB attachments": "첨부 파일 50 GB",
	"API access": "API 접근",
	"See full pricing": "전체 요금 보기",
	"Learn more": "자세히 보기",
	"Errors only": "오류만",
	"Warnings and errors": "경고와 오류",
	"Info (default)": "정보 (기본값)",
	"Debug (verbose)": "디버그 (상세)",
	"Or authenticate with a token instead of signing in.":
		"로그인 대신 토큰으로 인증할 수도 있습니다.",
	"If this plugin saves you time, consider supporting development.":
		"이 플러그인이 시간을 아껴준다면 개발 후원을 생각해 주세요.",
	"Sign-in required to load vaults": "보관함을 불러오려면 로그인이 필요합니다",
	"Could not reach Engram — check connection": "Engram에 연결할 수 없습니다. 연결을 확인하세요",
	// UI strings (sync error surfaces)
	"Free syncs notes only — images & PDFs need a paid plan.":
		"무료 요금제는 노트만 동기화합니다. 이미지와 PDF에는 유료 요금제가 필요합니다.",
	"Pull all (delete extras) aborted: could not obtain an exclusive server snapshot (replay contention). Nothing was trashed.":
		"전체 내리기(남은 파일 삭제)를 중단했습니다: 서버의 단독 스냅숏을 얻지 못했습니다(리플레이 충돌). 아무것도 삭제하지 않았습니다.",
	"Pull all aborted: another sync is running (replay contention). Try again when it finishes.":
		"전체 내리기를 중단했습니다: 다른 동기화가 실행 중입니다(리플레이 충돌). 끝난 뒤 다시 시도하세요.",
	"Pull all failed: {error}": "전체 내리기에 실패했습니다: {error}",
	"Pull all failed": "전체 내리기에 실패했습니다",
};

export default ko;
