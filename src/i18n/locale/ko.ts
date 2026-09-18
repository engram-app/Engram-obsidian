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
};

export default ko;
