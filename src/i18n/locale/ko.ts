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
};

export default ko;
