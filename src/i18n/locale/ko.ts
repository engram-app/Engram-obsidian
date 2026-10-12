import type { Dict } from "..";

// 한국어
const ko: Dict = {
	"Invalid API key": "잘못된 API 키입니다",
	"Request failed ({status})": "요청 실패 ({status})",
	"Connection failed": "연결에 실패했습니다",
	"Link Obsidian to Engram": "Obsidian을 Engram에 연결합니다",
	"Starting...": "시작 중...",
	"Failed to start device flow. Check your Engram URL and try again.":
		"장치 연결 시작에 실패했습니다. Engram URL을 확인하고 다시 시도하세요.",
	"Your code:": "코드:",
	"Click to copy": "복사하기 클릭",
	"Code copied!": "코드 복사 완료!",
	"A browser window has opened. Sign in and enter this code to link your vault.":
		"브라우저 창이 열렸습니다. 로그인 후 이 코드를 입력하여 보관함을 연결하세요.",
	Cancel: "취소",
	"Waiting for authorization — connected, this will complete instantly.":
		"인증 대기 중 – 연결됨, 즉시 완료됩니다.",
	"Waiting for authorization — no live connection, checking every 30s.":
		"인증 대기 중 – 연결 없음, 30초마다 확인합니다.",
	"Code expired. Please try again.": "코드가 만료되었습니다. 다시 시도하세요.",
	"Try again": "다시 시도",
	Close: "닫기",
	"Note couldn't be processed": "노트 처리 실패",
	"The server couldn't process this note. Check its contents, then edit and save to try again.":
		"서버에서 이 노트를 처리할 수 없습니다. 내용을 확인한 후 편집하고 저장하여 다시 시도해 주세요.",
	"Attachments need a paid plan": "첨부 파일은 유료 플랜 필요",
	"The Free tier syncs notes only. Upgrade to sync images and PDFs.":
		"무료 플랜은 노트만 동기화합니다. 이미지 및 PDF 동기화를 원하시면 유료 플랜으로 업그레이드하세요.",
	"Attachment storage full": "첨부 파일 저장 공간 부족",
	"You've used all the attachment storage on your plan. Upgrade for more.":
		"플랜에서 제공하는 첨부 파일 저장 공간을 모두 사용하셨습니다. 더 많은 저장 공간을 원하시면 업그레이드하세요.",
	"Too large for the server": "서버 용량 초과",
	"The server limit is 5 MB. Compress or split the file, then it will sync.":
		"서버 제한은 5MB입니다. 파일을 압축하거나 분할한 후 동기화를 시도해 주세요.",
	"Sign-in expired": "로그인 만료",
	"Reconnect your account to resume syncing.": "계정을 다시 연결하면 동기화를 이어갑니다.",
	"Unresolved conflict": "충돌 해결 불가",
	"Open the file to resolve the conflict, then sync again.":
		"충돌을 해결할 파일을 열고 다시 동기화합니다.",
	"Frontmatter needs a fix": "Frontmatter 수정 필요",
	"The note synced, but its frontmatter could not be fully parsed. Open it to fix the highlighted line.":
		"노트는 동기화되었지만, frontmatter를 완전히 분석하지 못했습니다. 강조 표시된 줄을 수정하려면 파일을 엽니다.",
	"Server error": "서버 오류",
	"A temporary server problem — retrying automatically.":
		"일시적인 서버 문제 - 자동으로 재시도 중입니다.",
	"Network unavailable": "네트워크 연결 안됨",
	"Can't reach the server — retrying automatically.":
		"서버에 연결할 수 없음 - 자동으로 재시도 중입니다.",
	"Sync failed": "동기화 실패",
	"An unexpected error — retrying automatically.": "예상치 못한 오류 - 자동으로 재시도 중입니다.",
	"Frontmatter could not be parsed": "frontmatter 분석 실패",
	"Note limit reached. Upgrade to keep adding notes.":
		"노트 제한에 도달했습니다. 더 많은 노트를 추가하려면 업그레이드하세요.",
	"Vault limit reached. Upgrade for more vaults.":
		"보관함 제한에 도달했습니다. 더 많은 보관함을 사용하려면 업그레이드하세요.",
	"This file type isn't accepted by this server.": "이 파일 형식은 서버에서 지원하지 않습니다.",
	"Attachment sync is disabled for this account.":
		"이 계정의 첨부 파일 동기화가 비활성화되었습니다.",
	"Attachment storage is full — upgrade for more.":
		"저장 공간이 가득합니다. 더 많은 용량을 확보하려면 업그레이드하세요.",
	"File too large for your plan.": "파일 크기가 구독 한도를 초과합니다.",
	"Already signed in on another device. Upgrade for multi-device.":
		"다른 기기에서 이미 로그인되었습니다. 여러 기기 사용을 원하시면 업그레이드하세요.",
	"Device swap cooldown active. Wait or upgrade.":
		"기기 전환 대기 시간이 활성화되었습니다. 기다리거나 업그레이드하세요.",
	"Too many connected Obsidian vaults. Disconnect one or upgrade.":
		"연결된 Obsidian 보관함이 너무 많습니다. 하나를 연결 해제하거나 업그레이드하세요.",
	"Too many connected AI clients. Disconnect one or upgrade.":
		"연결된 AI 클라이언트가 너무 많습니다. 하나를 연결 해제하거나 업그레이드하세요.",
	"Daily AI search limit reached. Free includes 20 per day across Obsidian, the web app and MCP. Upgrade for unlimited.":
		"일일 AI 검색 제한에 도달했습니다. 무료 버전은 Obsidian, 웹 앱 및 MCP에서 하루에 20회 검색을 제공합니다. 무제한 사용을 원하시면 업그레이드하세요.",
	"API keys need Pro. Sign in with your Engram account instead.":
		"API 키는 Pro 버전에서만 사용할 수 있습니다. Engram 계정으로 로그인하세요.",
	"Account suspended. Contact support.": "계정이 정지되었습니다. 지원팀에 문의하세요.",
	"Account setup incomplete.": "계정 설정이 완료되지 않았습니다.",
	"This account was deleted. Contact support if that is wrong.":
		"이 계정이 삭제되었습니다. 오류인 경우 지원팀에 문의하세요.",
	"Finish setting up your account at app.engram.page to start syncing.":
		"동기화를 시작하려면 app.engram.page에서 계정 설정을 완료하세요.",
	"Limit reached. Upgrade to continue.":
		"제한에 도달했습니다. 업그레이드를 통해 계속 사용하세요.",
	Upgrade: "업그레이드",
	"Update in settings": "설정에서 업데이트",
	"Sync now": "지금 동기화",
	"Engram sync: syncing...": "Engram 동기화: 동기화 중...",
	"Engram Sync: pulled {pulled}, pushed {pushed}":
		"Engram 동기화: {pulled} 다운로드, {pushed} 업로드",
	"Disconnect (clear login)": "연결 해제 (로그인 정보 삭제)",
	"Engram: disconnected. Open Engram settings to reconnect.":
		"Engram: 연결 해제됨. 다시 연결하려면 Engram 설정으로 이동하세요.",
	"Push entire vault": "전체 보관함 동기화",
	"Engram Sync: pushed {count} files": "Engram 동기화: {count}개의 파일 전송 완료",
	"Check sync status": "동기화 상태 확인",
	"Engram sync: checking...": "Engram 동기화: 확인 중...",
	"Engram sync: server does not support reconciliation (update backend)":
		"Engram 동기화: 서버에서 조정 기능을 지원하지 않습니다 (백엔드 업데이트)",
	"Engram sync: everything in sync": "Engram 동기화: 모든 내용이 동기화되었습니다",
	"{count} missing on server": "서버에 {count}개가 누락됨",
	"{count} diverged": "{count}개 항목이 다름",
	"{count} only on server": "{count}이(가) 서버에만 있습니다",
	"Engram Sync: {details}": "Engram 동기화: {details}",
	"Pull all from server (force overwrite)": "서버에서 모든 내용 가져오기 (강제 덮어쓰기)",
	"Engram sync: pulling all from server...": "Engram 동기화: 서버에서 모든 내용 가져오는 중...",
	"Engram Sync: pulled {count} files from server":
		"Engram 동기화: 서버에서 {count}개의 파일을 가져왔습니다",
	"Show sync log": "동기화 로그 보기",
	"Send feedback": "피드백 보내기",
	"Semantic search": "의미 검색",
	"Open search sidebar": "검색 사이드바 열기",
	"Engram search": "Engram 검색",
	"Open sync center": "동기화 센터 열기",
	"Engram: ready": "Engram: 준비 완료",
	"Engram Sync: pushed {pushed}": "Engram 동기화: {pushed} 푸시됨",
	"Engram sync: sync failed": "Engram 동기화: 동기화 실패",
	"Engram: this vault no longer exists on the server. Pick or create a vault to continue.":
		"Engram: 이 보관함은 더 이상 서버에 존재하지 않습니다. 계속하려면 보관함을 선택하거나 새로 만드세요.",
	"Engram: recovered plugin settings from a backup after a corrupted save.":
		"Engram: 손상된 저장 파일에서 플러그인 설정을 복구했습니다.",
	"Engram: plugin settings file was corrupted and could not be recovered. You may need to reconnect in settings.":
		"Engram: 플러그인 설정 파일이 손상되어 복구할 수 없습니다. 설정에서 다시 연결해야 할 수 있습니다.",
	"Engram: your login expired — open Engram settings to reconnect.":
		"Engram: 로그인 만료되었습니다. 다시 연결하려면 Engram 설정으로 이동하세요.",
	"Engram: This vault has been deleted on the server.":
		"Engram: 이 보관함이 서버에서 삭제되었습니다.",
	"Engram sync: live sync requires a plugin update — please update the Engram vault sync plugin.":
		"Engram 동기화: 실시간 동기화를 사용하려면 플러그인 업데이트가 필요합니다. Engram 보관함 동기화 플러그인을 업데이트하세요.",
	"Engram Sync: pulled {pulled} (local extras deleted)":
		"Engram 동기화: {pulled} 가져오기 완료 (로컬 추가 파일 삭제)",
	"Engram Sync: pulled {pulled}": "Engram 동기화: {pulled} 가져오기 완료",
	"Engram Sync: replaced remote with local ({pushed} uploaded)":
		"Engram 동기화: 원격 파일을 로컬 파일로 대체 ({pushed} 업로드됨)",
	"Engram: sync is not set up yet, so nothing in this vault will sync.":
		"Engram: 아직 동기화 설정이 완료되지 않았으므로 이 보관함의 내용은 동기화되지 않습니다.",
	"Finish sync setup": "동기화 설정 완료",
	"Engram: sync is paused. This edit was not synced. Choose a sync direction to resume.":
		"Engram: 동기화가 일시 중지되었습니다. 이 변경 사항은 동기화되지 않았습니다. 동기화 방향을 선택하여 다시 시작하세요.",
	"Open Engram settings": "Engram 설정 열기",
	"Engram: sync failed. Open the sync log for details.":
		"Engram: 동기화 실패. 자세한 내용은 동기화 로그를 확인하세요.",
	"Engram: not connected": "Engram: 연결되지 않음",
	"Engram: signed out": "Engram: 로그아웃됨",
	"Not connected yet. Click to open settings and link this vault.":
		"아직 연결되지 않았습니다. 설정을 클릭하여 연결하고 이 보관함을 링크하세요.",
	"Not signed in. Click to open settings and reconnect.":
		"아직 로그인하지 않았습니다. 설정을 클릭하여 다시 연결하세요.",
	"Engram: finish setup": "Engram: 설정 완료",
	"Engram: sync paused": "Engram: 동기화 일시 중지",
	"{label} ({count} queued)": "{label} ({count}개 대기 중)",
	"Setup is not finished — nothing will sync until you choose a sync direction. Click to finish.":
		"설정이 완료되지 않았습니다. 동기화 방향을 선택할 때까지 아무 것도 동기화되지 않습니다. 완료하려면 클릭하세요.",
	"Sync paused — click to choose a sync direction":
		"동기화 중지됨 — 동기화 방향을 선택하려면 클릭하세요",
	"Engram: offline ({count} queued)": "Engram: 오프라인 ({count}개 대기 중)",
	"Engram: offline": "Engram: 오프라인",
	"Server unreachable — changes will sync when connected":
		"서버 연결 안됨 — 연결되면 변경 사항이 동기화됩니다",
	"Engram: error": "Engram: 오류",
	"Unknown error": "알 수 없는 오류",
	"Engram: syncing ({count})": "Engram: 동기화 중 ({count})",
	"Engram: syncing": "Engram: 동기화 중",
	"Sync in progress...": "동기화 진행 중...",
	"Engram: pending ({count})": "Engram: 대기 중 ({count})",
	"{count} files queued": "{count}개의 파일 대기 중",
	"Engram: live": "Engram: 연결됨",
	"WebSocket connected — live sync active": "WebSocket 연결됨 — 실시간 동기화 활성화됨",
	"Click to sync": "동기화하려면 클릭하세요",
	"Engram: ⚠ {count} sync errors": "Engram: ⚠ {count}개의 동기화 오류",
	"Last sync: {when}": "마지막 동기화: {when}",
	"Engram Sync: pulled {count} changes": "Engram 동기화: {count}개의 변경 사항을 가져왔습니다",
	'Engram Sync: sync state for "{name}" was unreadable — using the on-disk copy.':
		'Engram 동기화: "{name}"의 동기화 상태를 읽을 수 없음 - 디스크 복사본 사용.',
	"Engram Vault Sync {version} is available. {link}.":
		"Engram Vault Sync {version}이 사용 가능합니다. {link}.",
	"{count} files": "{count} 개의 파일",
	"Notes searchable": "검색 가능한 노트",
	"Notes past this still sync and open normally, they are just not in the search index. The index keeps your oldest notes, so it is your newest ones that fall outside.":
		"이 이후의 노트는 정상적으로 동기화되고 열립니다. 단, 검색 인덱스에 포함되지 않습니다. 인덱스는 가장 오래된 노트를 유지하므로, 가장 최신의 노트는 인덱스에서 제외될 수 있습니다.",
	"Notes stored": "저장된 노트",
	Attachments: "첨부 파일",
	"AI searches": "AI 검색",
	"{formatted} per day": "{formatted}개/일",
	Keyword: "키워드",
	Semantic: "의미 검색",
	Both: "모두",
	"matches your words and their other forms — 'run' finds 'running' — plus this device.":
		"입력하신 단어와 관련된 다른 형태의 단어를 찾습니다. 예를 들어 'run'을 검색하면 'running'도 찾습니다. 또한 이 기기에서만 검색합니다.",
	"matches meaning. Finds notes that never use the words you typed.":
		"의미를 기반으로 검색합니다. 입력하신 단어를 사용하지 않는 노트도 찾습니다.",
	"matches words and meaning together, plus this device. Widest results.":
		"단어와 의미를 함께 검색하며, 이 기기에서만 검색합니다. 가장 광범위한 검색 결과를 제공합니다.",
	"Engram indexes {indexed} of your {all} notes. The rest match on this device only. Upgrade to index everything.":
		"Engram은 {all}개의 노트 중 {indexed}개를 인덱싱합니다. 나머지는 이 기기에서만 검색 가능합니다. 모든 노트를 인덱싱하려면 업그레이드하세요.",
	"Searching {indexed} of {all} notes. Upgrade to search everything.":
		"{all}개의 노트 중 {indexed}개를 검색 중입니다. 모든 노트를 검색하려면 업그레이드하세요.",
	"Search your vault…": "보관함에서 검색…",
	"Clear search": "검색 결과 지우기",
	"Search settings": "검색 설정",
	"Filter by folder…": "폴더로 필터링…",
	"Filter by tags…": "태그로 필터링…",
	"Remove tag {tag}": "태그 {tag} 삭제",
	"Engram unreachable. Showing matches from this device only.":
		"Engram에 연결할 수 없습니다. 이 기기에서만 검색 결과를 보여줍니다.",
	"Search failed — check connection": "검색 실패 – 연결 상태 확인",
	"No results found": "결과 없음",
	Untitled: "제목 없음",
	exact: "정확히",
	"meaning + exact": "의미 + 정확히 일치",
	meaning: "의미",
	"match strength: {pct}%": "일치 강도: {pct}%",
	"No source path for this result": "이 결과에 대한 원본 경로가 없습니다",
	"Note not synced locally": "노트가 로컬에 동기화되지 않았습니다",
	"Syncing...": "동기화 중...",
	"👋 Welcome": "👋 안녕하세요",
	"🔌 Connection": "🔌 연결",
	"🔄 Sync Center": "🔄 동기화 센터",
	"⚙️ Advanced": "⚙️ 고급 설정",
	"💬 Feedback": "💬 피드백",
	"Engram: settings tab failed to render ({error})": "Engram: 설정 탭 로딩 실패 ({error})",
	Disconnected: "연결 해제됨",
	"Error: {error}": "오류: {error}",
	unknown: "알 수 없음",
	"Connected — waiting for first sync decision": "연결됨 — 첫 번째 동기화 결정 대기 중",
	"Connected — live sync active": "연결됨 — 실시간 동기화 활성",
	"Connected — polling": "연결됨 — 폴링 중",
	"Not configured": "설정되지 않음",
	"Open sync setup": "동기화 설정 열기",
	"Sync log": "동기화 기록",
	"Showing {count} entries": "{count}개의 항목을 표시합니다",
	"No sync activity this session.": "이번 세션 동안 동기화 활동이 없습니다.",
	"({count} errors)": "({count}개의 오류)",
	"Could not compare with the cloud. Check your connection.":
		"클라우드와 비교할 수 없습니다. 연결 상태를 확인하세요.",
	"Your login expired. Sign in again in Engram settings to continue.":
		"로그인 세션이 만료되었습니다. Engram 설정에서 다시 로그인하여 계속하세요.",
	"Couldn't create vault — the name may be invalid or already in use.":
		"보관함 생성에 실패했습니다. 이름이 유효하지 않거나 이미 사용 중일 수 있습니다.",
	"Could not create the vault — check your connection and try again.":
		"보관함 생성에 실패했습니다. 연결 상태를 확인하고 다시 시도하세요.",
	"Free syncs notes only — {count} attachments will be skipped.":
		"무료 동기화는 노트만 동기화하며, 첨부 파일 {count}개는 제외됩니다.",
	"Uploads {up}, downloads {down}.": "업로드 {up}, 다운로드 {down}.",
	"Uploads {count}.": "업로드 {count}.",
	"Downloads {count}.": "다운로드 {count}.",
	"{count} conflicts to resolve.": "해결해야 할 충돌이 {count}개 있습니다.",
	"Safe choice: combines both sides, nothing is deleted.":
		"안전한 선택: 양쪽을 모두 사용하며, 삭제되는 항목은 없습니다.",
	"Nothing is deleted.": "삭제되는 항목은 없습니다.",
	"Already in sync. Nothing is deleted.": "이미 동기화되었습니다. 삭제되는 항목은 없습니다.",
	"Delete all {count} files currently on the server":
		"서버에 있는 {count}개의 파일을 모두 삭제합니다",
	"Upload {count} files from this vault": "이 보관함에서 {count}개의 파일을 업로드합니다",
	"Delete all {count} files in this vault": "이 보관함의 {count}개 파일을 모두 삭제합니다",
	"Download {count} files from the server": "서버에서 {count}개의 파일을 다운로드합니다",
	Sync: "동기화",
	"Upload local files without downloading the remote":
		"원격 파일을 다운로드하지 않고 로컬 파일을 업로드합니다",
	"Delete all on remote, then upload local files":
		"원격 파일을 모두 삭제한 후 로컬 파일을 업로드합니다",
	"Download remote files without uploading the local":
		"로컬 파일을 업로드하지 않고 원격 파일을 다운로드합니다",
	"Delete all local files, then download from remote":
		"모든 로컬 파일을 삭제한 후, 원격에서 다운로드합니다",
	"Set up sync for this vault": "이 보관함의 동기화를 설정합니다",
	"You are now pointing at a different cloud vault": "현재 다른 클라우드 보관함을 사용 중입니다",
	"Sync preview": "동기화 미리보기",
	"Nothing to sync yet — this vault is empty on both sides. Start syncing and everything you write appears on your other devices.":
		"아직 동기화할 내용이 없습니다. 이 보관함은 양쪽 모두 비어 있습니다. 동기화를 시작하면 작성하는 모든 내용이 다른 기기에 표시됩니다.",
	"Start syncing": "동기화 시작",
	"{count} notes": "{count}개의 노트",
	"{count} attachments": "{count}개의 첨부 파일",
	"{first} and {second}": "{first} 및 {second}",
	files: "파일",
	"This vault is empty on the server. Upload your {what}?":
		"이 보관함은 서버에 비어 있습니다. {what}을 업로드하시겠습니까?",
	"Upload everything": "모두 업로드",
	"Nothing will be removed from this device.": "이 기기에서 파일은 삭제되지 않습니다.",
	"This device's vault is empty. Download {what} from the server?":
		"이 기기의 보관함이 비어 있습니다. 서버에서 {what}을 다운로드하시겠습니까?",
	"Download everything": "모두 다운로드",
	Done: "완료",
	"Send debug logs. Note content stays private.": "디버그 로그 전송. 노트 내용은 비공개입니다.",
	"Comparing your vault with the cloud…": "보관함과 클라우드를 비교 중…",
	"Not now": "지금은 안 함",
	"Change vault": "보관함 변경",
	"Advanced sync options": "고급 동기화 옵션",
	"Everything is in sync": "모두 동기화 완료",
	"This vault": "이 보관함",
	"Cloud server": "클라우드 서버",
	notes: "노트",
	attachments: "첨부 파일",
	folders: "폴더",
	"Confirm destructive sync": "파괴적인 동기화 확인",
	"You are about to:": "다음 작업을 수행합니다:",
	"Files that will be deleted:": "삭제될 파일:",
	"This cannot be undone.": "이 작업은 되돌릴 수 없습니다.",
	Back: "뒤로",
	Confirm: "확인",
	"Switch vault": "보관함 변경",
	"Pick a vault to sync with. We will recalculate the sync preview after you choose.":
		"동기화할 보관함을 선택하세요. 선택 후 동기화 미리보기를 다시 계산합니다.",
	"Loading vaults…": "보관함 로딩 중…",
	" (default)": " (기본값)",
	"No other vaults available.": "다른 보관함이 없습니다.",
	"Make new vault": "새 보관함 만들기",
	"New vault": "새 보관함",
	"Create a new empty vault on the server, then sync this Obsidian vault into it.":
		"서버에 새 보관함을 만들고, 이 Obsidian 보관함을 동기화합니다.",
	"Vault name": "보관함 이름",
	Create: "만들기",
	"Could not load vaults: {error}": "보관함 로드 실패: {error}",
	"Enter a name for the new vault": "새 보관함 이름을 입력하세요",
	"Failed to switch vault: {error}": "보관함 전환 실패: {error}",
	"Your vault shares {percent} of its data with Engram":
		"귀하의 보관함 데이터 중 {percent}이 Engram과 동기화됩니다",
	"{count} conflicts need resolution": "{count}개의 충돌이 해결되어야 합니다",
	"Type {keyword} to confirm:": "확인을 위해 {keyword}을 입력하세요:",
	"Uploading {count}.": "업로드 중 {count}.",
	"Downloading {count}.": "다운로드 중 {count}.",
	"Deleting {count} local files.": "{count}개의 로컬 파일을 삭제합니다.",
	"Deleting {count} on the cloud.": "클라우드에서 {count}개를 삭제 중입니다.",
	"First sync, this may take a moment.": "첫 번째 동기화, 잠시 시간이 걸릴 수 있습니다.",
	"Checking for changes.": "변경 사항을 확인 중입니다.",
	"Nothing will be deleted.": "삭제되는 항목은 없습니다.",
	"✓ {count} synced": "✓ {count}개 동기화 완료",
	"⤳ {count} skipped (Free plan)": "⤳ 무료 플랜으로 인해 {count}건 건너뜀",
	"✕ {count} failed": "✕ {count} 실패",
	"{count} attachments need a paid plan to sync. See Sync Center.":
		"{count}개의 첨부 파일은 유료 플랜이 필요합니다. 동기화 센터에서 확인하세요.",
	"Finished with some errors. Open the sync log to see what failed.":
		"오류와 함께 완료되었습니다. 실패 원인을 보려면 동기화 로그를 확인하세요.",
	"Synced. Some attachments need a paid plan to sync (see below).":
		"동기화 완료. 일부 첨부 파일은 유료 플랜에서만 동기화 가능합니다 (아래 참조).",
	"All synced. Your vault and the cloud now match.":
		"모두 동기화되었습니다. 보관함과 클라우드가 이제 동일합니다.",
	"Already up to date. Nothing needed syncing.":
		"이미 최신 상태입니다. 동기화할 필요가 없습니다.",
	Deleting: "삭제 중",
	Downloading: "다운로드 중",
	Uploading: "업로드 중",
	"Syncing your vault": "보관함 동기화 중",
	"Getting started…": "시작합니다…",
	"Open Engram to check your vault and confirm everything synced.":
		"Engram을 열어 보관함 상태를 확인하고 동기화가 완료되었는지 확인하세요.",
	"Open Engram": "Engram 열기",
	"You can close this and the sync keeps running in the background.":
		"이 창을 닫아도 동기화는 백그라운드에서 계속됩니다.",
	"Run in background": "백그라운드에서 실행",
	"Syncing…": "동기화 중…",
	"Sync complete": "동기화 완료",
	"Syncing attachments": "첨부 파일 동기화 중",
	Complete: "완료",
	'{count} failed. Run "{command}" for details.':
		'{count}건 실패했습니다. 자세한 내용은 "{command}"을 확인하세요.',
	"File exceeds the {limit} limit": "파일 크기가 {limit} 제한을 초과합니다",
	"Free syncs notes only — images & PDFs need a paid plan.":
		"노트만 무료 동기화, 이미지 및 PDF는 유료 플랜이 필요합니다.",
	"Engram: {count} files failed to sync{detail} — open Sync Center":
		"Engram: {count}개의 파일 동기화 실패{detail} — 동기화 센터 열기",
	"Engram: {count} attachments skipped — upgrade to sync images & PDFs.":
		"Engram: {count}개의 첨부 파일 동기화 건너�뎠습니다. 이미지 및 PDF 동기화를 위해 업그레이드하세요.",
	"Engram: plan upgraded — syncing {count} attachments…":
		"Engram: 요금제 업그레이드 – {count}개의 첨부 파일을 동기화 중…",
	"Pull all (delete extras) aborted: could not obtain an exclusive server snapshot (replay contention). Nothing was trashed.":
		"모든 항목 가져오기 실패: 서버 스냅샷을 확보하지 못했습니다 (충돌). 삭제된 항목은 없습니다.",
	"Pull all aborted: another sync is running (replay contention). Try again when it finishes.":
		"모든 항목 가져오기 실패: 다른 동기화가 진행 중입니다 (충돌). 완료되면 다시 시도하세요.",
	"Pull all failed: {error}": "모든 항목 가져오기 실패: {error}",
	"Engram: sync conflict on {path} — your local edit was saved as {copy}":
		"Engram: {path}에서 동기화 충돌이 발생했습니다. 로컬 편집 내용은 {copy}으로 저장되었습니다",
	"Open note": "노트 열기",
	"Engram: {count} notes have frontmatter problems. Open Sync Center to fix.":
		"Engram: {count}개의 노트에 메타데이터 문제가 있습니다. 동기화 센터에서 수정하세요.",
	'Engram Sync: renamed "{name}" (unsupported characters)':
		'Engram 동기화: "{name}" 이름 변경 (지원되지 않는 문자)',
	'Engram: frontmatter problem in "{name}"': 'Engram: "{name}"에 메타데이터 문제가 있습니다',
	"Engram: this plugin is too old to sync (needs {version} or newer). Update it to continue.":
		"Engram: 이 플러그인은 너무 오래되어 동기화할 수 없습니다 (최소 {version} 이상 필요). 계속하려면 업데이트하세요.",
	"Engram: this plugin is too old to sync. Update it to continue.":
		"Engram: 이 플러그인은 너무 오래되어 동기화할 수 없습니다. 계속하려면 업데이트하세요.",
	Update: "업데이트",
	"waiting for a connection": "연결 대기 중",
	"sync is paused": "동기화 일시 중지됨",
	"syncing now": "현재 동기화 중",
	"waiting to retry": "재시도 대기 중",
	"{count} not on your plan": "계획에 포함되지 않은 {count}개 항목",
	"{count} need attention": "{count}건 확인 필요",
	"{count} retrying": "{count}번 재시도 중",
	"{count} ignored": "{count}개 제외됨",
	"{count} queued — {reason}": "{count}개 대기 중 — {reason}",
	"Sync...": "동기화 중...",
	Refresh: "새로 고침",
	"Not synced on your plan ({count})": "구독 플랜에 포함되지 않아 동기화되지 않음 ({count})",
	"These files are fine. They just need a paid plan to sync.":
		"이 파일들은 괜찮습니다. 동기화를 하려면 유료 플랜이 필요합니다.",
	"Show files ({count}) ▾": "파일 표시 ({count}) ▾",
	"Sync these now": "지금 동기화",
	"Needs attention ({count})": "확인 필요 ({count})",
	"Clear all": "모두 지우기",
	"Nothing needs your attention. 🎉": "특별한 조치가 필요 없습니다. 🎉",
	Dismiss: "닫기",
	"Retrying automatically ({count})": "자동 재시도 ({count})",
	"Retry all now": "지금 모두 다시 시도",
	"Temporary errors. These clear themselves once the server recovers.":
		"일시적인 오류입니다. 서버가 복구되면 자동으로 해결됩니다.",
	"{count} attempts": "{count}회 시도",
	Open: "열기",
	Ignore: "무시",
	"Ignored ({count})": "제외됨 ({count})",
	"No files ignored. Use the ignore button on a failure row to stop syncing it.":
		"무시된 파일이 없습니다. 실패한 항목에 대해 동기화를 중단하려면 무시 버튼을 사용하세요.",
	Restore: "복원",
	"File not found locally: {path}": "로컬에서 파일을 찾을 수 없습니다: {path}",
	"Ignored {path} — won't sync until restored from Sync Center.":
		"{path}을 무시함 — 동기화 센터에서 복원할 때까지 동기화되지 않습니다.",
	"Restored {path} — will sync on next push.": "{path} 복원 완료 – 다음 동기화 시 적용됩니다.",
	"Activity ({count})": "활동 ({count})",
	Clear: "지우기",
	"No activity yet. Push or pull to see entries here.":
		"아직 활동 없음. 항목을 보려면 동기화 또는 업데이트를 진행하세요.",
	Pushed: "푸시됨",
	Pulled: "풀됨",
	Deleted: "삭제됨",
	Conflict: "충돌",
	Skipped: "건너뜀",
	Error: "오류",
	Stats: "통계",
	"Notes on this device": "이 기기의 노트",
	"Attachments on this device": "이 기기의 첨부 파일",
	"Remote vault": "원격 보관함",
	"not linked": "연결되지 않음",
	"Plan usage": "사용량 확인",
	"Node.js dependencies": "Node.js 종속성",
	"Python virtual environment": "Python 가상 환경",
	"Python bytecode cache": "Python 바이트코드 캐시",
	"Vendored dependencies": "포함된 종속성",
	"Gradle build cache": "Gradle 빌드 캐시",
	"Rust/Java build output": "Rust/Java 빌드 결과",
	"Build output": "빌드 결과",
	"Next.js build output": "Next.js 빌드 결과",
	"Distribution build output": "배포 빌드 결과",
	"Cargo cache": "Cargo 캐시",
	"CocoaPods dependencies": "CocoaPods 종속성",
	"Dart tool cache": "Dart 도구 캐시",
	"Generic cache directory": "일반 캐시 디렉토리",
	"Ignore patterns": "제외 패턴",
	"Custom patterns": "사용자 정의 패턴",
	"Paths to skip (one per line). Folder patterns end with /. Built-in: {configDir}/, .trash/, .git/":
		"건너뛸 경로 (한 줄에 하나). 폴더 패턴은 /로 끝납니다. 내장: {configDir}/, .trash/, .git/",
	Diagnostics: "진단",
	"Send detailed sync, vault, and connection activity to the server for troubleshooting, with distributed tracing on requests. Metadata only, never note content. Leave off for normal use.":
		"문제 해결을 위해 자세한 동기화, 보관함 및 연결 정보를 서버로 전송합니다. 요청에 대한 분산 추적 기능이 포함됩니다. 메타데이터만 전송하며, 노트 내용은 전송하지 않습니다. 일반 사용 시에는 이 기능을 끄십시오.",
	"Diagnostics detail": "진단 상세 정보",
	"Minimum severity that ships while diagnostics are on. Higher levels send fewer lines. Default: Info.":
		"진단 기능 활성화 시 표시되는 최소 심각도 수준입니다. 높은 수준일수록 더 적은 정보가 전송됩니다. 기본값: 정보.",
	"Errors only": "오류만",
	"Warnings and errors": "경고 및 오류",
	"Info (default)": "정보 (기본값)",
	"Debug (verbose)": "디버그 (상세)",
	About: "정보",
	"License: {name}": "라이선스: {name}",
	"⚠ Detected: {label}/ ({formatted} files)": "⚠ 감지됨: {label}개 ({formatted} 파일)",
	"{desc} — should not be synced": "{desc} — 동기화 대상이 아닙니다",
	"Add to ignores": "제외 목록에 추가",
	"Added {pattern} to ignore patterns": "{pattern}을 제외 목록에 추가했습니다",
	"Version: {version}": "버전: {version}",
	"Source: {link}": "출처: {link}",
	"Engram URL": "Engram URL",
	"✓ Engram server reachable (v{version})": "✓ Engram 서버 연결됨 (v{version})",
	"✗ server responded but isn't an Engram backend":
		"✗ 서버 응답은 받았지만, Engram 백엔드 서버가 아닙니다",
	"✗ couldn't reach a server at this URL": "✗ 해당 URL의 서버에 연결할 수 없습니다",
	"Checking server…": "서버 확인 중…",
	"That does not look like a complete server address. Include the scheme, for example http://127.0.0.1:4000":
		"서버 주소가 올바르지 않습니다. 스키마를 포함해주세요. 예: http://127.0.0.1:4000",
	"Engram backend changed — sign in again to continue.":
		"Engram 백엔드 변경됨 – 동기화를 계속하려면 다시 로그인하세요.",
	Authentication: "인증",
	"Signed in as {email}": "{email}으로 로그인됨",
	"Authenticated via Engram account (OAuth).": "Engram 계정(OAuth)을 통해 인증됨.",
	"Manage account": "계정 관리",
	"Sign out": "로그아웃",
	"Using API key": "API 키 사용 중",
	"Authenticated via manual API key.": "수동 API 키를 통해 인증됨.",
	"Clear key": "키 삭제",
	"Switch to sign in": "로그인으로 전환",
	"Engram: sign-in failed ({error})": "Engram: 로그인 실패 ({error})",
	"Sign in or create an account": "로그인 또는 계정 생성",
	"Opens your browser to sign in, or create an account if you don't have one yet, then links this vault.":
		"브라우저를 열어 로그인하거나, 계정이 없다면 새로 만들고, 이 보관함을 연결합니다.",
	"Sign in": "로그인",
	"Or authenticate with a token instead of signing in. Engram Cloud API keys require the Pro plan; on Free and Starter, sign in above.":
		"또는 토큰을 사용하여 인증합니다. Engram 클라우드 API 키는 Pro 플랜이 필요합니다. Free 및 Starter 플랜에서는 위의 로그인 방법을 사용하세요.",
	"Or authenticate with a token instead of signing in.": "또는 토큰을 사용하여 인증합니다.",
	"API key": "API 키",
	Token: "토큰",
	"Bearer token from your Engram account.": "Engram 계정의 Bearer 토큰입니다.",
	Save: "저장",
	"Enter an API key first": "먼저 API 키를 입력하세요",
	"That does not look like an Engram API key (expected {prefix}…).":
		"이것은 Engram API 키처럼 보이지 않습니다 (예상 값: {prefix}…).",
	Vault: "보관함",
	"Vault selection": "보관함 선택",
	"Select which vault this plugin syncs with.": "이 플러그인이 동기화할 보관함을 선택하세요.",
	"No vaults found — first sync will create one":
		"보관함이 없습니다 — 첫 동기화 시 하나가 생성됩니다",
	"Pick a vault (previous: '{name}' not found)": "보관함 선택 (이전: '{name}'을 찾을 수 없음)",
	"Pick a vault (previous: id {id} not found)": "보관함 선택 (이전: ID {id}을 찾을 수 없음)",
	"Pick a vault": "보관함 선택",
	"Vault ID: {id}": "보관함 ID: {id}",
	Change: "변경",
	"Support development": "개발 지원",
	"If this plugin saves you time, consider supporting development.":
		"이 플러그인이 시간을 절약해 준다면, 개발을 지원해주세요.",
	"GitHub Sponsors": "GitHub Sponsors",
	"Sign-in required to load vaults": "보관함을 로드하려면 로그인 필요합니다",
	"Server error ({status}) — check Engram logs":
		"서버 오류 ({status}) — Engram 로그를 확인하세요",
	"Could not reach Engram — check connection": "Engram 연결 오류 - 연결 상태를 확인하세요",
	"Engram Cloud": "Engram 클라우드",
	"Self-hosted": "자체 호스팅",
	Backend: "백엔드",
	"Where this vault syncs to. Each backend keeps its own sign-in.":
		"이 보관함이 동기화되는 위치입니다. 각 백엔드는 자체 로그인 정보를 사용합니다.",
	"Switched to {mode}.": "{mode}으로 전환했습니다.",
	"Not connected. Enter your Engram server URL below to start syncing.":
		"연결되지 않았습니다. 동기화를 시작하려면 Engram 서버 URL을 아래에 입력하세요.",
	"Run your own Engram server": "자체 Engram 서버 실행",
	"Engram is the backend that powers sync and semantic search.":
		"Engram은 동기화 및 의미 검색 기능을 제공하는 백엔드입니다.",
	"Nothing in this vault syncs until you choose how to merge it with the server.":
		"이 보관함의 내용은 서버와 병합하는 방법을 선택할 때까지 동기화되지 않습니다.",
	"Choose sync direction": "동기화 방향 선택",
	Bug: "버그",
	Idea: "아이디어",
	Confusing: "혼란스러움",
	"Love it": "매우 만족",
	"What's working, what's frustrating, what do you wish Engram did?":
		"어떤 점이 잘 되고, 어떤 점이 답답하며, Engram가 무엇을 해주기를 바라시나요?",
	"This server is self-hosted, so feedback is not collected here. ":
		"이 서버는 자체 호스팅 서버이므로, 피드백은 이곳에서 수집되지 않습니다. ",
	"Report an issue on GitHub": "GitHub에서 문제 보고",
	"Connect to Engram first to send feedback.": "피드백을 보내려면 먼저 Engram에 연결하세요.",
	"Open Connection": "연결 열기",
	"What kind of feedback?": "어떤 종류의 피드백인가요?",
	"Your feedback": "사용자 의견",
	"Tell us anything": "자유롭게 의견을 말씀해주세요",
	"How do you feel about Engram?": "Engram에 대해 어떻게 생각하시나요?",
	"{n} of 5": "5개 중 {n}개",
	"Couldn't send your feedback, please try again.":
		"의견 전송에 실패했습니다. 다시 시도해주세요.",
	"It's OK to email me about this": "이 문제에 대해 이메일로 문의하셔도 괜찮습니다",
	"Sending…": "보내는 중…",
	Send: "보내기",
	"Thanks, we read every message.": "감사합니다. 모든 메시지를 확인합니다.",
	"New here? Watch the setup video": "처음이신가요? 설정 안내 영상을 보세요",
	"What Engram does, and how to connect your vault, start to finish.":
		"Engram이 무엇을 하는지, 그리고 보관함을 연결하는 방법을 처음부터 끝까지 알려드립니다.",
	"▶ Watch on YouTube": "▶ 유튜브에서 보기",
	"Getting set up": "설정하기",
	"1. Make an account": "1. 계정 만들기",
	"setup guide": "2. Engram에 보관함 연결하기",
	"2. Connect your vault to Engram": "2. 보관함을 Engram에 연결하세요",
	"Sign in (or enter your server URL and key) on the connection tab, then run your first sync.":
		"연결 탭 열기",
	"Open connection tab": "연결 탭 열기",
	"3. Connect your AI": "3. AI 연결",
	"Link Claude, Cursor, ChatGPT, or any MCP app so it can read and write your notes. ":
		"Claude, Cursor, ChatGPT 또는 다른 MCP 앱을 연결하여 노트 읽기 및 쓰기를 가능하게 합니다 ",
	"See the AI setup guide": "AI 설정 가이드 보기",
	Plans: "요금제",
	Free: "무료",
	"1 vault, 2 devices": "1개의 보관함, 2개의 기기",
	"Real-time sync": "실시간 동기화",
	"2,000 notes searchable": "2,000개의 노트 검색 가능",
	"Connect any AI (MCP)": "모든 AI (MCP) 연결",
	Starter: "Starter",
	"10 vaults, unlimited devices": "10개의 보관함, 기기 수 제한 없음",
	"Search all your notes": "모든 노트 검색",
	"10 GB attachments": "10GB 첨부 파일",
	"Unlimited AI searches": "AI 검색 제한 없음",
	Pro: "Pro",
	"Unlimited vaults": "보관함 제한 없음",
	"Search across all vaults at once": "모든 보관함에서 한 번에 검색",
	"50 GB attachments": "50GB 첨부 파일",
	"API access": "API 접근",
	"See full pricing": "가격 정보 보기",
	"Learn more": "자세히 알아보기",
	Documentation: "설명서",
	"AI / MCP setup guide": "AI / MCP 설정 가이드",
	"Report an issue": "문제 신고",
	"Join our Discord": "저희 Discord에 참여하세요",
	"Create a hosted account at {signup}, or self-host the backend ({guide}).":
		"{signup}에서 호스팅 계정을 생성하거나, 백엔드를 직접 호스팅합니다 ({guide}).",
	"...": "...",
	'... "{name}" ...': '"{name}" ...',
	"The server took too long to respond. Try again.":
		"서버 응답 시간이 너무 오래 걸렸습니다. 다시 시도해 주세요.",
	"Not signed in, or the session expired. Sign in again in Engram settings.":
		"로그인하지 않았거나, 세션이 만료되었습니다. Engram 설정에서 다시 로그인하세요.",
	"The file is too large for the server.": "파일 크기가 서버 용량을 초과합니다.",
	"Too many requests. Wait a moment and try again.":
		"요청이 너무 많습니다. 잠시 기다린 후 다시 시도해 주세요.",
	"Frontmatter isn't valid YAML.": "Frontmatter가 유효한 YAML 형식이 아닙니다.",
	"A frontmatter key could not be parsed as YAML.": "Frontmatter 키를 YAML로 파싱할 수 없습니다.",
	"This note could not be processed and was skipped.":
		"이 노트를 처리할 수 없었으며, 건너뜁니다.",
	'Frontmatter key "{key}" could not be parsed as YAML.':
		'Frontmatter 키 "{key}"을 YAML로 파싱할 수 없습니다.',
};

export default ko;
