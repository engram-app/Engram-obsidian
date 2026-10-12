import type { Dict } from "..";

// Tiếng Việt
const vi: Dict = {
	"Invalid API key": "Khóa API không hợp lệ",
	"Request failed ({status})": "Yêu cầu thất bại ({status})",
	"Connection failed": "Kết nối không thành công",
	"Link Obsidian to Engram": "Liên kết Obsidian với Engram",
	"Starting...": "Đang khởi động...",
	"Failed to start device flow. Check your Engram URL and try again.":
		"Không thể khởi động quá trình xác thực. Kiểm tra URL Engram của bạn và thử lại.",
	"Your code:": "Mã của bạn:",
	"Click to copy": "Nhấp để sao chép",
	"Code copied!": "Đã sao chép mã!",
	"A browser window has opened. Sign in and enter this code to link your vault.":
		"Một cửa sổ trình duyệt đã mở. Đăng nhập và nhập mã này để liên kết kho lưu trữ của bạn.",
	Cancel: "Hủy bỏ",
	"Waiting for authorization — connected, this will complete instantly.":
		"Đang chờ xác thực — đã kết nối, quá trình này sẽ hoàn tất ngay lập tức.",
	"Waiting for authorization — no live connection, checking every 30s.":
		"Đang chờ xác thực — không có kết nối trực tiếp, kiểm tra mỗi 30 giây.",
	"Code expired. Please try again.": "Mã đã hết hạn. Vui lòng thử lại.",
	"Try again": "Thử lại",
	Close: "Đóng",
	"Note couldn't be processed": "Không thể xử lý ghi chú",
	"The server couldn't process this note. Check its contents, then edit and save to try again.":
		"Máy chủ không thể xử lý ghi chú này. Kiểm tra nội dung, sau đó chỉnh sửa và lưu để thử lại.",
	"Attachments need a paid plan": "Tệp đính kèm cần gói trả phí",
	"The Free tier syncs notes only. Upgrade to sync images and PDFs.":
		"Gói miễn phí chỉ đồng bộ hóa ghi chú. Nâng cấp để đồng bộ hóa hình ảnh và PDF.",
	"Attachment storage full": "Bộ nhớ tệp đính kèm đã đầy",
	"You've used all the attachment storage on your plan. Upgrade for more.":
		"Bạn đã sử dụng hết dung lượng lưu trữ tệp đính kèm trong gói của bạn. Nâng cấp để có thêm dung lượng.",
	"Too large for the server": "Quá lớn cho máy chủ",
	"The server limit is 5 MB. Compress or split the file, then it will sync.":
		"Giới hạn của máy chủ là 5 MB. Nén hoặc chia nhỏ tệp, sau đó nó sẽ được đồng bộ hóa.",
	"Sign-in expired": "Phiên đăng nhập đã hết hạn",
	"Reconnect your account to resume syncing.":
		"Kết nối lại tài khoản của bạn để tiếp tục đồng bộ hóa.",
	"Unresolved conflict": "Xung đột chưa được giải quyết",
	"Open the file to resolve the conflict, then sync again.":
		"Mở tệp để giải quyết xung đột, sau đó đồng bộ hóa lại.",
	"Frontmatter needs a fix": "Cần sửa phần frontmatter",
	"The note synced, but its frontmatter could not be fully parsed. Open it to fix the highlighted line.":
		"Ghi chú đã được đồng bộ hóa, nhưng phần frontmatter không thể phân tích đầy đủ. Mở nó để sửa dòng được đánh dấu.",
	"Server error": "Lỗi máy chủ",
	"A temporary server problem — retrying automatically.":
		"Một vấn đề tạm thời với máy chủ — đang thử lại tự động.",
	"Network unavailable": "Mạng không khả dụng",
	"Can't reach the server — retrying automatically.":
		"Không thể kết nối với máy chủ — đang thử lại tự động.",
	"Sync failed": "Đồng bộ hóa thất bại",
	"An unexpected error — retrying automatically.":
		"Một lỗi không mong muốn — đang thử lại tự động.",
	"Frontmatter could not be parsed": "Không thể phân tích frontmatter",
	"Note limit reached. Upgrade to keep adding notes.":
		"Đã đạt giới hạn ghi chú. Nâng cấp để thêm nhiều ghi chú hơn.",
	"Vault limit reached. Upgrade for more vaults.":
		"Đã đạt giới hạn kho lưu trữ. Nâng cấp để có thêm kho lưu trữ.",
	"This file type isn't accepted by this server.":
		"Loại tệp này không được chấp nhận bởi máy chủ này.",
	"Attachment sync is disabled for this account.":
		"Tải lên tệp đính kèm đã bị tắt cho tài khoản này.",
	"Attachment storage is full — upgrade for more.":
		"Không gian lưu trữ tệp đính kèm đã đầy — nâng cấp để có thêm dung lượng.",
	"File too large for your plan.": "Tệp quá lớn cho gói của bạn.",
	"Already signed in on another device. Upgrade for multi-device.":
		"Đã đăng nhập trên một thiết bị khác. Nâng cấp để sử dụng trên nhiều thiết bị.",
	"Device swap cooldown active. Wait or upgrade.":
		"Chế độ chờ chuyển thiết bị đang hoạt động. Vui lòng chờ hoặc nâng cấp.",
	"Too many connected Obsidian vaults. Disconnect one or upgrade.":
		"Quá nhiều kho lưu trữ Obsidian được kết nối. Ngắt kết nối một kho hoặc nâng cấp.",
	"Too many connected AI clients. Disconnect one or upgrade.":
		"Quá nhiều ứng dụng AI được kết nối. Ngắt kết nối một ứng dụng hoặc nâng cấp.",
	"Daily AI search limit reached. Free includes 20 per day across Obsidian, the web app and MCP. Upgrade for unlimited.":
		"Đã đạt giới hạn tìm kiếm AI hàng ngày. Bản miễn phí bao gồm 20 lần mỗi ngày trên Obsidian, ứng dụng web và MCP. Nâng cấp để có không giới hạn.",
	"API keys need Pro. Sign in with your Engram account instead.":
		"Cần gói Pro để sử dụng API keys. Đăng nhập bằng tài khoản Engram của bạn.",
	"Account suspended. Contact support.": "Tài khoản đã bị đình chỉ. Liên hệ với bộ phận hỗ trợ.",
	"Account setup incomplete.": "Thiết lập tài khoản chưa hoàn tất.",
	"This account was deleted. Contact support if that is wrong.":
		"Tài khoản này đã bị xóa. Liên hệ hỗ trợ nếu điều này là sai.",
	"Finish setting up your account at app.engram.page to start syncing.":
		"Hoàn tất thiết lập tài khoản của bạn tại app.engram.page để bắt đầu đồng bộ hóa.",
	"Limit reached. Upgrade to continue.": "Đạt giới hạn. Nâng cấp để tiếp tục.",
	Upgrade: "Nâng cấp",
	"Update in settings": "Cập nhật trong cài đặt",
	"Sync now": "Đồng bộ hóa ngay",
	"Engram sync: syncing...": "Đồng bộ hóa Engram: đang đồng bộ hóa...",
	"Engram Sync: pulled {pulled}, pushed {pushed}":
		"Đồng bộ hóa Engram: đã tải {pulled}, đã đẩy {pushed}",
	"Disconnect (clear login)": "Ngắt kết nối (xóa thông tin đăng nhập)",
	"Engram: disconnected. Open Engram settings to reconnect.":
		"Engram: đã ngắt kết nối. Mở cài đặt Engram để kết nối lại.",
	"Push entire vault": "Đẩy toàn bộ kho lưu trữ",
	"Engram Sync: pushed {count} files": "Engram Sync: Đã đẩy {count} tệp",
	"Check sync status": "Kiểm tra trạng thái đồng bộ hóa",
	"Engram sync: checking...": "Đồng bộ hóa Engram: đang kiểm tra...",
	"Engram sync: server does not support reconciliation (update backend)":
		"Đồng bộ hóa Engram: máy chủ không hỗ trợ đồng bộ hóa (cập nhật phần nền)",
	"Engram sync: everything in sync": "Đồng bộ hóa Engram: mọi thứ đã đồng bộ",
	"{count} missing on server": "{count} mục chưa đồng bộ lên máy chủ",
	"{count} diverged": "{count} khác nhau",
	"{count} only on server": "{count} chỉ có trên máy chủ",
	"Engram Sync: {details}": "Đồng bộ hóa Engram: {details}",
	"Pull all from server (force overwrite)": "Tải tất cả từ máy chủ (ghi đè)",
	"Engram sync: pulling all from server...": "Đồng bộ hóa Engram: đang tải tất cả từ máy chủ...",
	"Engram Sync: pulled {count} files from server": "Engram Sync: đã tải {count} tệp từ máy chủ",
	"Show sync log": "Hiển thị nhật ký đồng bộ",
	"Send feedback": "Gửi phản hồi",
	"Semantic search": "Tìm kiếm ngữ nghĩa",
	"Open search sidebar": "Mở thanh bên tìm kiếm",
	"Engram search": "Tìm kiếm Engram",
	"Open sync center": "Mở Trung tâm đồng bộ hóa",
	"Engram: ready": "Engram: sẵn sàng",
	"Engram Sync: pushed {pushed}": "Engram Sync: đã đẩy {pushed}",
	"Engram sync: sync failed": "Engram sync: đồng bộ hóa thất bại",
	"Engram: this vault no longer exists on the server. Pick or create a vault to continue.":
		"Engram: kho lưu trữ này không còn tồn tại trên máy chủ. Chọn hoặc tạo một kho lưu trữ để tiếp tục.",
	"Engram: recovered plugin settings from a backup after a corrupted save.":
		"Engram: đã khôi phục cài đặt plugin từ bản sao lưu sau khi lưu bị lỗi.",
	"Engram: plugin settings file was corrupted and could not be recovered. You may need to reconnect in settings.":
		"Engram: tệp cài đặt plugin bị lỗi và không thể khôi phục. Bạn có thể cần kết nối lại trong phần cài đặt.",
	"Engram: your login expired — open Engram settings to reconnect.":
		"Engram: phiên đăng nhập của bạn đã hết hạn — mở cài đặt Engram để kết nối lại.",
	"Engram: This vault has been deleted on the server.":
		"Engram: kho lưu trữ này đã bị xóa trên máy chủ.",
	"Engram sync: live sync requires a plugin update — please update the Engram vault sync plugin.":
		"Engram sync: đồng bộ hóa trực tiếp yêu cầu cập nhật plugin — vui lòng cập nhật plugin Engram vault sync.",
	"Engram Sync: pulled {pulled} (local extras deleted)":
		"Engram Sync: đã tải {pulled} (các tệp bổ sung cục bộ đã bị xóa)",
	"Engram Sync: pulled {pulled}": "Engram Sync: đã tải {pulled}",
	"Engram Sync: replaced remote with local ({pushed} uploaded)":
		"Engram Sync: đã thay thế phiên bản từ xa bằng phiên bản cục bộ ({pushed} đã được tải lên)",
	"Engram: sync is not set up yet, so nothing in this vault will sync.":
		"Engram: chưa được thiết lập đồng bộ hóa, vì vậy không có gì trong kho lưu trữ này sẽ được đồng bộ hóa.",
	"Finish sync setup": "Hoàn tất thiết lập đồng bộ hóa",
	"Engram: sync is paused. This edit was not synced. Choose a sync direction to resume.":
		"Engram: Đã tạm dừng đồng bộ hóa. Chỉnh sửa này chưa được đồng bộ. Chọn chiều đồng bộ để tiếp tục.",
	"Open Engram settings": "Mở cài đặt Engram",
	"Engram: sync failed. Open the sync log for details.":
		"Engram: Đồng bộ hóa thất bại. Mở nhật ký đồng bộ để biết chi tiết.",
	"Engram: not connected": "Engram: Chưa kết nối",
	"Engram: signed out": "Engram: Đã đăng xuất",
	"Not connected yet. Click to open settings and link this vault.":
		"Chưa kết nối. Nhấp để mở cài đặt và liên kết kho lưu trữ này.",
	"Not signed in. Click to open settings and reconnect.":
		"Chưa đăng nhập. Nhấp để mở cài đặt và kết nối lại.",
	"Engram: finish setup": "Engram: Hoàn tất thiết lập",
	"Engram: sync paused": "Engram: Đã tạm dừng đồng bộ hóa",
	"{label} ({count} queued)": "{label} ({count} đang chờ)",
	"Setup is not finished — nothing will sync until you choose a sync direction. Click to finish.":
		"Thiết lập chưa hoàn thành — không có gì được đồng bộ hóa cho đến khi bạn chọn chiều đồng bộ. Nhấp để hoàn thành.",
	"Sync paused — click to choose a sync direction":
		"Đồng bộ hóa tạm dừng — nhấp để chọn chiều đồng bộ hóa",
	"Engram: offline ({count} queued)": "Engram: ngoại tuyến ({count} đang chờ)",
	"Engram: offline": "Engram: ngoại tuyến",
	"Server unreachable — changes will sync when connected":
		"Máy chủ không thể kết nối — thay đổi sẽ được đồng bộ hóa khi kết nối",
	"Engram: error": "Engram: lỗi",
	"Unknown error": "Lỗi không xác định",
	"Engram: syncing ({count})": "Engram: đang đồng bộ hóa ({count})",
	"Engram: syncing": "Engram: đang đồng bộ hóa",
	"Sync in progress...": "Đang đồng bộ hóa...",
	"Engram: pending ({count})": "Engram: đang xử lý ({count})",
	"{count} files queued": "{count} tệp đang chờ xử lý",
	"Engram: live": "Engram: hoạt động",
	"WebSocket connected — live sync active":
		"WebSocket đã kết nối — đồng bộ hóa trực tiếp đang hoạt động",
	"Click to sync": "Nhấp để đồng bộ hóa",
	"Engram: ⚠ {count} sync errors": "Engram: ⚠ {count} lỗi đồng bộ hóa",
	"Last sync: {when}": "Lần đồng bộ hóa cuối: {when}",
	"Engram Sync: pulled {count} changes": "Engram Sync: đã tải {count} thay đổi",
	'Engram Sync: sync state for "{name}" was unreadable — using the on-disk copy.':
		'Engram Sync: trạng thái đồng bộ hóa của "{name}" không thể đọc được — đang sử dụng bản sao trên ổ đĩa.',
	"Engram Vault Sync {version} is available. {link}.":
		"Engram Vault Sync {version} khả dụng. {link}.",
	"{count} files": "{count} tệp",
	"Notes searchable": "Ghi chú có thể tìm kiếm",
	"Notes past this still sync and open normally, they are just not in the search index. The index keeps your oldest notes, so it is your newest ones that fall outside.":
		"Các ghi chú sau đây vẫn được đồng bộ hóa và mở bình thường, chúng chỉ không nằm trong chỉ mục tìm kiếm. Chỉ mục lưu trữ các ghi chú cũ nhất của bạn, vì vậy các ghi chú mới nhất của bạn sẽ không nằm trong đó.",
	"Notes stored": "Ghi chú đã được lưu trữ",
	Attachments: "Tệp đính kèm",
	"AI searches": "Tìm kiếm AI",
	"{formatted} per day": "{formatted} mỗi ngày",
	Keyword: "Từ khóa",
	Semantic: "Ngữ nghĩa",
	Both: "Cả hai",
	"matches your words and their other forms — 'run' finds 'running' — plus this device.":
		"khớp với từ của bạn và các dạng khác — 'run' tìm 'running' — cộng với thiết bị này.",
	"matches meaning. Finds notes that never use the words you typed.":
		"khớp với ý nghĩa. Tìm ghi chú không sử dụng các từ bạn nhập.",
	"matches words and meaning together, plus this device. Widest results.":
		"khớp với cả từ và ý nghĩa, cộng với thiết bị này. Kết quả rộng nhất.",
	"Engram indexes {indexed} of your {all} notes. The rest match on this device only. Upgrade to index everything.":
		"Engram lập chỉ mục {indexed} trong số {all} ghi chú của bạn. Phần còn lại chỉ khớp trên thiết bị này. Nâng cấp để lập chỉ mục mọi thứ.",
	"Searching {indexed} of {all} notes. Upgrade to search everything.":
		"Tìm kiếm {indexed} trong số {all} ghi chú. Nâng cấp để tìm kiếm mọi thứ.",
	"Search your vault…": "Tìm kiếm trong kho lưu trữ của bạn…",
	"Clear search": "Xóa tìm kiếm",
	"Search settings": "Cài đặt tìm kiếm",
	"Filter by folder…": "Lọc theo thư mục…",
	"Filter by tags…": "Lọc theo thẻ…",
	"Remove tag {tag}": "Xóa thẻ {tag}",
	"Engram unreachable. Showing matches from this device only.":
		"Engram không khả dụng. Chỉ hiển thị kết quả từ thiết bị này.",
	"Search failed — check connection": "Tìm kiếm thất bại — kiểm tra kết nối",
	"No results found": "Không tìm thấy kết quả",
	Untitled: "Không tiêu đề",
	exact: "chính xác",
	"meaning + exact": "nghĩa + chính xác",
	meaning: "nghĩa",
	"match strength: {pct}%": "độ chính xác: {pct}%",
	"No source path for this result": "Không tìm thấy đường dẫn nguồn cho kết quả này",
	"Note not synced locally": "Ghi chú chưa được đồng bộ hóa cục bộ",
	"Syncing...": "Đang đồng bộ hóa...",
	"👋 Welcome": "👋 Chào mừng",
	"🔌 Connection": "🔌 Kết nối",
	"🔄 Sync Center": "🔄 Trung tâm đồng bộ hóa",
	"⚙️ Advanced": "⚙️ Nâng cao",
	"💬 Feedback": "💬 Phản hồi",
	"Engram: settings tab failed to render ({error})":
		"Engram: tab cài đặt không hiển thị ({error})",
	Disconnected: "Đã ngắt kết nối",
	"Error: {error}": "Lỗi: {error}",
	unknown: "không xác định",
	"Connected — waiting for first sync decision":
		"Đã kết nối — đang chờ quyết định đồng bộ hóa đầu tiên",
	"Connected — live sync active": "Đã kết nối — đồng bộ hóa trực tiếp đang hoạt động",
	"Connected — polling": "Đã kết nối — đang kiểm tra",
	"Not configured": "Chưa được cấu hình",
	"Open sync setup": "Mở cài đặt đồng bộ hóa",
	"Sync log": "Nhật ký đồng bộ hóa",
	"Showing {count} entries": "Hiển thị {count} mục",
	"No sync activity this session.": "Chưa có hoạt động đồng bộ hóa trong phiên này.",
	"({count} errors)": "({count} lỗi)",
	"Could not compare with the cloud. Check your connection.":
		"Không thể so sánh với đám mây. Kiểm tra kết nối của bạn.",
	"Your login expired. Sign in again in Engram settings to continue.":
		"Phiên đăng nhập của bạn đã hết hạn. Đăng nhập lại trong phần cài đặt Engram để tiếp tục.",
	"Couldn't create vault — the name may be invalid or already in use.":
		"Không thể tạo kho lưu trữ — tên có thể không hợp lệ hoặc đã được sử dụng.",
	"Could not create the vault — check your connection and try again.":
		"Không thể tạo kho lưu trữ — hãy kiểm tra kết nối của bạn và thử lại.",
	"Free syncs notes only — {count} attachments will be skipped.":
		"Miễn phí đồng bộ hóa ghi chú, chỉ {count} tệp đính kèm sẽ bị bỏ qua.",
	"Uploads {up}, downloads {down}.": "Tải lên {up}, tải xuống {down}.",
	"Uploads {count}.": "Tải lên {count}.",
	"Downloads {count}.": "Tải xuống {count}.",
	"{count} conflicts to resolve.": "{count} xung đột cần giải quyết.",
	"Safe choice: combines both sides, nothing is deleted.":
		"Lựa chọn an toàn: kết hợp cả hai, không có gì bị xóa.",
	"Nothing is deleted.": "Không có gì bị xóa.",
	"Already in sync. Nothing is deleted.": "Đã đồng bộ hóa. Không có gì bị xóa.",
	"Delete all {count} files currently on the server":
		"Xóa tất cả {count} tệp hiện tại trên máy chủ",
	"Upload {count} files from this vault": "Tải lên {count} tệp từ kho lưu trữ này",
	"Delete all {count} files in this vault": "Xóa tất cả {count} tệp trong kho lưu trữ này",
	"Download {count} files from the server": "Tải xuống {count} tệp từ máy chủ",
	Sync: "Đồng bộ hóa",
	"Upload local files without downloading the remote":
		"Tải lên các tệp cục bộ mà không tải xuống các tệp từ xa",
	"Delete all on remote, then upload local files":
		"Xóa tất cả trên máy chủ từ xa, sau đó tải lên các tệp cục bộ",
	"Download remote files without uploading the local":
		"Tải xuống các tệp từ xa mà không tải lên các tệp cục bộ",
	"Delete all local files, then download from remote":
		"Xóa tất cả các tệp cục bộ, sau đó tải xuống từ máy chủ",
	"Set up sync for this vault": "Thiết lập đồng bộ hóa cho kho lưu trữ này",
	"You are now pointing at a different cloud vault":
		"Bạn đang trỏ đến một kho lưu trữ đám mây khác",
	"Sync preview": "Xem trước đồng bộ hóa",
	"Nothing to sync yet — this vault is empty on both sides. Start syncing and everything you write appears on your other devices.":
		"Hiện tại chưa có gì để đồng bộ hóa — kho lưu trữ này trống ở cả hai phía. Bắt đầu đồng bộ hóa và mọi thứ bạn viết sẽ xuất hiện trên các thiết bị khác của bạn.",
	"Start syncing": "Bắt đầu đồng bộ hóa",
	"{count} notes": "{count} ghi chú",
	"{count} attachments": "{count} tệp đính kèm",
	"{first} and {second}": "{first} và {second}",
	files: "tệp",
	"This vault is empty on the server. Upload your {what}?":
		"Kho lưu trữ này trống trên máy chủ. Bạn muốn tải lên {what}?",
	"Upload everything": "Tải lên tất cả",
	"Nothing will be removed from this device.": "Không có gì sẽ bị xóa khỏi thiết bị này.",
	"This device's vault is empty. Download {what} from the server?":
		"Kho lưu trữ trên thiết bị này trống. Bạn muốn tải xuống {what} từ máy chủ?",
	"Download everything": "Tải xuống tất cả",
	Done: "Hoàn thành",
	"Send debug logs. Note content stays private.":
		"Gửi nhật ký gỡ lỗi. Nội dung ghi chú vẫn được bảo mật.",
	"Comparing your vault with the cloud…": "Đang so sánh kho lưu trữ của bạn với đám mây…",
	"Not now": "Không bây giờ",
	"Change vault": "Thay đổi kho lưu trữ",
	"Advanced sync options": "Tùy chọn đồng bộ hóa nâng cao",
	"Everything is in sync": "Tất cả đã được đồng bộ hóa",
	"This vault": "Kho lưu trữ này",
	"Cloud server": "Máy chủ đám mây",
	notes: "ghi chú",
	attachments: "tệp đính kèm",
	folders: "thư mục",
	"Confirm destructive sync": "Xác nhận đồng bộ hóa có thể gây mất dữ liệu",
	"You are about to:": "Bạn sắp:",
	"Files that will be deleted:": "Các tệp sẽ bị xóa:",
	"This cannot be undone.": "Không thể hoàn tác.",
	Back: "Quay lại",
	Confirm: "Xác nhận",
	"Switch vault": "Chuyển đổi kho lưu trữ",
	"Pick a vault to sync with. We will recalculate the sync preview after you choose.":
		"Chọn một kho lưu trữ để đồng bộ hóa. Chúng tôi sẽ tính toán lại bản xem trước đồng bộ hóa sau khi bạn chọn.",
	"Loading vaults…": "Đang tải kho lưu trữ…",
	" (default)": " (mặc định)",
	"No other vaults available.": "Không có kho lưu trữ nào khác.",
	"Make new vault": "Tạo kho lưu trữ mới",
	"New vault": "Kho lưu trữ mới",
	"Create a new empty vault on the server, then sync this Obsidian vault into it.":
		"Tạo một kho lưu trữ trống trên máy chủ, sau đó đồng bộ hóa kho lưu trữ Obsidian này vào đó.",
	"Vault name": "Tên kho lưu trữ",
	Create: "Tạo",
	"Could not load vaults: {error}": "Không thể tải kho lưu trữ: {error}",
	"Enter a name for the new vault": "Nhập tên cho kho lưu trữ mới",
	"Failed to switch vault: {error}": "Không thể chuyển đổi kho lưu trữ: {error}",
	"Your vault shares {percent} of its data with Engram":
		"Kho lưu trữ của bạn chia sẻ {percent} dữ liệu với Engram",
	"{count} conflicts need resolution": "{count} xung đột cần giải quyết",
	"Type {keyword} to confirm:": "Nhập {keyword} để xác nhận:",
	"Uploading {count}.": "Đang tải lên {count}.",
	"Downloading {count}.": "Đang tải xuống {count}.",
	"Deleting {count} local files.": "Xóa {count} tệp cục bộ.",
	"Deleting {count} on the cloud.": "Xóa {count} trên đám mây.",
	"First sync, this may take a moment.":
		"Lần đồng bộ hóa đầu tiên, có thể mất một chút thời gian.",
	"Checking for changes.": "Đang kiểm tra thay đổi.",
	"Nothing will be deleted.": "Không có gì sẽ bị xóa.",
	"✓ {count} synced": "✓ {count} đã đồng bộ hóa",
	"⤳ {count} skipped (Free plan)": "⤳ {count} bỏ qua (Gói miễn phí)",
	"✕ {count} failed": "✕ {count} thất bại",
	"{count} attachments need a paid plan to sync. See Sync Center.":
		"{count} tệp đính kèm cần gói trả phí để đồng bộ hóa. Xem Trung tâm đồng bộ hóa.",
	"Finished with some errors. Open the sync log to see what failed.":
		"Hoàn thành với một số lỗi. Mở nhật ký đồng bộ hóa để xem những gì đã thất bại.",
	"Synced. Some attachments need a paid plan to sync (see below).":
		"Đã đồng bộ hóa. Một số tệp đính kèm cần gói trả phí để đồng bộ hóa (xem bên dưới).",
	"All synced. Your vault and the cloud now match.":
		"Tất cả đã đồng bộ hóa. Kho lưu trữ của bạn và trên đám mây hiện đã khớp.",
	"Already up to date. Nothing needed syncing.": "Đã cập nhật. Không cần đồng bộ hóa gì.",
	Deleting: "Đang xóa",
	Downloading: "Đang tải xuống",
	Uploading: "Đang tải lên",
	"Syncing your vault": "Đang đồng bộ hóa kho lưu trữ của bạn",
	"Getting started…": "Bắt đầu…",
	"Open Engram to check your vault and confirm everything synced.":
		"Mở Engram để kiểm tra kho lưu trữ của bạn và xác nhận mọi thứ đã được đồng bộ hóa.",
	"Open Engram": "Mở Engram",
	"You can close this and the sync keeps running in the background.":
		"Bạn có thể đóng cửa và quá trình đồng bộ hóa vẫn tiếp tục chạy trong nền.",
	"Run in background": "Chạy trong nền",
	"Syncing…": "Đang đồng bộ hóa…",
	"Sync complete": "Đã hoàn thành đồng bộ hóa",
	"Syncing attachments": "Đang đồng bộ hóa tệp đính kèm",
	Complete: "Hoàn tất",
	'{count} failed. Run "{command}" for details.':
		'{count} lần thất bại. Xem "{command}" để biết chi tiết.',
	"File exceeds the {limit} limit": "Tệp vượt quá giới hạn {limit}",
	"Free syncs notes only — images & PDFs need a paid plan.":
		"Đồng bộ hóa miễn phí chỉ dành cho ghi chú — hình ảnh & PDF cần gói trả phí.",
	"Engram: {count} files failed to sync{detail} — open Sync Center":
		"Engram: {count} tệp không đồng bộ hóa{detail} — mở Trung tâm đồng bộ hóa",
	"Engram: {count} attachments skipped — upgrade to sync images & PDFs.":
		"Engram: Bỏ qua {count} tệp đính kèm — nâng cấp để đồng bộ hóa ảnh & PDF.",
	"Engram: plan upgraded — syncing {count} attachments…":
		"Engram: Nâng cấp gói — đang đồng bộ hóa {count} tệp đính kèm…",
	"Pull all (delete extras) aborted: could not obtain an exclusive server snapshot (replay contention). Nothing was trashed.":
		"Bỏ qua thao tác kéo tất cả (xóa dữ liệu thừa): không thể lấy bản chụp nhanh độc quyền của máy chủ (xung đột). Không có gì bị xóa.",
	"Pull all aborted: another sync is running (replay contention). Try again when it finishes.":
		"Bỏ qua thao tác kéo tất cả: một thao tác đồng bộ khác đang chạy (xung đột). Thử lại khi nó hoàn thành.",
	"Pull all failed: {error}": "Thao tác kéo tất cả thất bại: {error}",
	"Engram: sync conflict on {path} — your local edit was saved as {copy}":
		"Engram: xung đột đồng bộ trên {path} — chỉnh sửa cục bộ của bạn đã được lưu dưới dạng {copy}",
	"Open note": "Mở ghi chú",
	"Engram: {count} notes have frontmatter problems. Open Sync Center to fix.":
		"Engram: {count} ghi chú có vấn đề về frontmatter. Mở Trung tâm đồng bộ hóa để sửa.",
	'Engram Sync: renamed "{name}" (unsupported characters)':
		'Engram Sync: đổi tên "{name}" (ký tự không được hỗ trợ)',
	'Engram: frontmatter problem in "{name}"': 'Engram: vấn đề về frontmatter trong "{name}"',
	"Engram: this plugin is too old to sync (needs {version} or newer). Update it to continue.":
		"Engram: plugin này quá cũ để đồng bộ hóa (cần {version} trở lên). Cập nhật để tiếp tục.",
	"Engram: this plugin is too old to sync. Update it to continue.":
		"Engram: plugin này quá cũ để đồng bộ hóa. Cập nhật để tiếp tục.",
	Update: "Cập nhật",
	"waiting for a connection": "đang chờ kết nối",
	"sync is paused": "Đã tạm dừng đồng bộ hóa",
	"syncing now": "đang đồng bộ hóa",
	"waiting to retry": "đang chờ thử lại",
	"{count} not on your plan": "{count} không nằm trong gói của bạn",
	"{count} need attention": "{count} cần chú ý",
	"{count} retrying": "{count} lần thử lại",
	"{count} ignored": "{count} bị bỏ qua",
	"{count} queued — {reason}": "{count} đang chờ — {reason}",
	"Sync...": "Đồng bộ hóa...",
	Refresh: "Làm mới",
	"Not synced on your plan ({count})": "Chưa được đồng bộ hóa trong gói của bạn ({count})",
	"These files are fine. They just need a paid plan to sync.":
		"Các tệp này không có vấn đề. Chúng chỉ cần một gói trả phí để đồng bộ hóa.",
	"Show files ({count}) ▾": "Hiển thị tệp ({count}) ▾",
	"Sync these now": "Đồng bộ hóa các tệp này ngay bây giờ",
	"Needs attention ({count})": "Cần xử lý ({count})",
	"Clear all": "Xóa tất cả",
	"Nothing needs your attention. 🎉": "Không có gì cần bạn quan tâm. 🎉",
	Dismiss: "Đóng",
	"Retrying automatically ({count})": "Thử lại tự động ({count})",
	"Retry all now": "Thử lại tất cả ngay",
	"Temporary errors. These clear themselves once the server recovers.":
		"Lỗi tạm thời. Chúng sẽ tự động biến mất khi máy chủ hoạt động trở lại.",
	"{count} attempts": "{count} lần thử",
	Open: "Mở",
	Ignore: "Bỏ qua",
	"Ignored ({count})": "Bỏ qua ({count})",
	"No files ignored. Use the ignore button on a failure row to stop syncing it.":
		'Không có tệp nào bị bỏ qua. Sử dụng nút "bỏ qua" trên mỗi dòng lỗi để ngừng đồng bộ hóa tệp đó.',
	Restore: "Khôi phục",
	"File not found locally: {path}": "Không tìm thấy tệp cục bộ: {path}",
	"Ignored {path} — won't sync until restored from Sync Center.":
		"Đã bỏ qua {path} — sẽ không đồng bộ hóa cho đến khi được khôi phục từ Trung tâm đồng bộ hóa.",
	"Restored {path} — will sync on next push.":
		"Đã khôi phục {path} — sẽ đồng bộ hóa khi đẩy lần sau.",
	"Activity ({count})": "Hoạt động ({count})",
	Clear: "Xóa",
	"No activity yet. Push or pull to see entries here.":
		"Chưa có hoạt động nào. Nhấn nút đẩy hoặc kéo để xem các mục ở đây.",
	Pushed: "Đã đẩy",
	Pulled: "Đã kéo",
	Deleted: "Đã xóa",
	Conflict: "Xung đột",
	Skipped: "Bỏ qua",
	Error: "Lỗi",
	Stats: "Thống kê",
	"Notes on this device": "Ghi chú trên thiết bị này",
	"Attachments on this device": "Tệp đính kèm trên thiết bị này",
	"Remote vault": "Kho lưu trữ từ xa",
	"not linked": "chưa liên kết",
	"Plan usage": "Sử dụng gói",
	"Node.js dependencies": "Các thư viện Node.js",
	"Python virtual environment": "Môi trường ảo Python",
	"Python bytecode cache": "Bộ nhớ đệm bytecode Python",
	"Vendored dependencies": "Các thư viện đi kèm",
	"Gradle build cache": "Bộ nhớ đệm Gradle",
	"Rust/Java build output": "Đầu ra biên dịch Rust/Java",
	"Build output": "Đầu ra biên dịch",
	"Next.js build output": "Đầu ra biên dịch Next.js",
	"Distribution build output": "Đầu ra biên dịch phân phối",
	"Cargo cache": "Bộ nhớ đệm Cargo",
	"CocoaPods dependencies": "Các thư viện CocoaPods",
	"Dart tool cache": "Bộ nhớ đệm công cụ Dart",
	"Generic cache directory": "Thư mục bộ nhớ đệm chung",
	"Ignore patterns": "Bỏ qua mẫu",
	"Custom patterns": "Mẫu tùy chỉnh",
	"Paths to skip (one per line). Folder patterns end with /. Built-in: {configDir}/, .trash/, .git/":
		"Các đường dẫn cần bỏ qua (mỗi dòng một). Mẫu thư mục kết thúc bằng /. Tích hợp sẵn: {configDir}/, .trash/, .git/",
	Diagnostics: "Chẩn đoán",
	"Send detailed sync, vault, and connection activity to the server for troubleshooting, with distributed tracing on requests. Metadata only, never note content. Leave off for normal use.":
		"Gửi chi tiết hoạt động đồng bộ hóa, kho lưu trữ và kết nối đến máy chủ để khắc phục sự cố, với theo dõi phân tán trên các yêu cầu. Chỉ gửi siêu dữ liệu, không bao giờ gửi nội dung ghi chú. Tắt nếu không cần.",
	"Diagnostics detail": "Chi tiết chẩn đoán",
	"Minimum severity that ships while diagnostics are on. Higher levels send fewer lines. Default: Info.":
		"Mức độ nghiêm trọng tối thiểu khi bật chẩn đoán. Mức độ cao hơn sẽ gửi ít dòng hơn. Mặc định: Thông tin.",
	"Errors only": "Chỉ lỗi",
	"Warnings and errors": "Cảnh báo và lỗi",
	"Info (default)": "Thông tin (mặc định)",
	"Debug (verbose)": "Gỡ lỗi (chi tiết)",
	About: "Giới thiệu",
	"License: {name}": "Giấy phép: {name}",
	"⚠ Detected: {label}/ ({formatted} files)": "⚠ Phát hiện: {label} ({formatted} tệp)",
	"{desc} — should not be synced": "{desc} — không nên đồng bộ hóa",
	"Add to ignores": "Thêm vào danh sách bỏ qua",
	"Added {pattern} to ignore patterns": "Đã thêm {pattern} vào danh sách bỏ qua",
	"Version: {version}": "Phiên bản: {version}",
	"Source: {link}": "Nguồn: {link}",
	"Engram URL": "URL Engram",
	"✓ Engram server reachable (v{version})": "✓ Máy chủ Engram có thể truy cập (v{version})",
	"✗ server responded but isn't an Engram backend":
		"✗ Máy chủ đã phản hồi nhưng không phải là máy chủ Engram",
	"✗ couldn't reach a server at this URL": "✗ Không thể kết nối đến máy chủ tại URL này",
	"Checking server…": "Đang kiểm tra máy chủ…",
	"That does not look like a complete server address. Include the scheme, for example http://127.0.0.1:4000":
		"Địa chỉ máy chủ này có vẻ không đầy đủ. Hãy bao gồm cả giao thức, ví dụ: http://127.0.0.1:4000",
	"Engram backend changed — sign in again to continue.":
		"Backend của Engram đã thay đổi — đăng nhập lại để tiếp tục.",
	Authentication: "Xác thực",
	"Signed in as {email}": "Đã đăng nhập với tư cách {email}",
	"Authenticated via Engram account (OAuth).": "Xác thực qua tài khoản Engram (OAuth).",
	"Manage account": "Quản lý tài khoản",
	"Sign out": "Đăng xuất",
	"Using API key": "Sử dụng khóa API",
	"Authenticated via manual API key.": "Xác thực qua khóa API thủ công.",
	"Clear key": "Xóa khóa",
	"Switch to sign in": "Chuyển sang đăng nhập",
	"Engram: sign-in failed ({error})": "Engram: đăng nhập thất bại ({error})",
	"Sign in or create an account": "Đăng nhập hoặc tạo tài khoản",
	"Opens your browser to sign in, or create an account if you don't have one yet, then links this vault.":
		"Mở trình duyệt của bạn để đăng nhập, hoặc tạo tài khoản nếu bạn chưa có, sau đó liên kết kho lưu trữ này.",
	"Sign in": "Đăng nhập",
	"Or authenticate with a token instead of signing in. Engram Cloud API keys require the Pro plan; on Free and Starter, sign in above.":
		"Hoặc xác thực bằng token thay vì đăng nhập. Các khóa API Engram Cloud yêu cầu gói Pro; trên các gói Free và Starter, hãy đăng nhập ở trên.",
	"Or authenticate with a token instead of signing in.":
		"Hoặc xác thực bằng token thay vì đăng nhập.",
	"API key": "Khóa API",
	Token: "Token",
	"Bearer token from your Engram account.": "Token từ tài khoản Engram của bạn.",
	Save: "Lưu",
	"Enter an API key first": "Nhập khóa API trước",
	"That does not look like an Engram API key (expected {prefix}…).":
		"Đó không phải là khóa API Engram (mong đợi {prefix}…).",
	Vault: "Kho lưu trữ",
	"Vault selection": "Chọn kho lưu trữ",
	"Select which vault this plugin syncs with.": "Chọn kho lưu trữ mà plugin này sẽ đồng bộ hóa.",
	"No vaults found — first sync will create one":
		"Không tìm thấy kho lưu trữ nào — lần đồng bộ hóa đầu tiên sẽ tạo một kho",
	"Pick a vault (previous: '{name}' not found)":
		"Chọn một kho lưu trữ (trước đó: '{name}' không tìm thấy)",
	"Pick a vault (previous: id {id} not found)":
		"Chọn một kho lưu trữ (trước đó: id {id} không tìm thấy)",
	"Pick a vault": "Chọn một kho lưu trữ",
	"Vault ID: {id}": "ID kho lưu trữ: {id}",
	Change: "Thay đổi",
	"Support development": "Hỗ trợ phát triển",
	"If this plugin saves you time, consider supporting development.":
		"Nếu plugin này giúp bạn tiết kiệm thời gian, hãy cân nhắc hỗ trợ phát triển.",
	"GitHub Sponsors": "GitHub Sponsors",
	"Sign-in required to load vaults": "Đăng nhập là cần thiết để tải kho lưu trữ",
	"Server error ({status}) — check Engram logs":
		"Lỗi máy chủ ({status}) — kiểm tra nhật ký Engram",
	"Could not reach Engram — check connection": "Không thể kết nối với Engram — kiểm tra kết nối",
	"Engram Cloud": "Engram Cloud",
	"Self-hosted": "Tự lưu trữ",
	Backend: "Backend",
	"Where this vault syncs to. Each backend keeps its own sign-in.":
		"Nơi kho lưu trữ này được đồng bộ hóa. Mỗi backend có phương thức đăng nhập riêng.",
	"Switched to {mode}.": "Đã chuyển sang {mode}.",
	"Not connected. Enter your Engram server URL below to start syncing.":
		"Chưa kết nối. Nhập URL máy chủ Engram của bạn bên dưới để bắt đầu đồng bộ hóa.",
	"Run your own Engram server": "Chạy máy chủ Engram của riêng bạn",
	"Engram is the backend that powers sync and semantic search.":
		"Engram là backend cung cấp khả năng đồng bộ hóa và tìm kiếm ngữ nghĩa.",
	"Nothing in this vault syncs until you choose how to merge it with the server.":
		"Không có gì trong kho lưu trữ này được đồng bộ hóa cho đến khi bạn chọn cách hợp nhất nó với máy chủ.",
	"Choose sync direction": "Chọn chiều đồng bộ hóa",
	Bug: "Lỗi",
	Idea: "Ý tưởng",
	Confusing: "Khó hiểu",
	"Love it": "Rất thích",
	"What's working, what's frustrating, what do you wish Engram did?":
		"Điều gì đang hoạt động, điều gì gây khó chịu, bạn mong muốn Engram làm gì?",
	"This server is self-hosted, so feedback is not collected here. ":
		"Máy chủ này được tự lưu trữ, vì vậy phản hồi không được thu thập ở đây. ",
	"Report an issue on GitHub": "Báo cáo sự cố trên GitHub",
	"Connect to Engram first to send feedback.": "Kết nối với Engram trước khi gửi phản hồi.",
	"Open Connection": "Mở kết nối",
	"What kind of feedback?": "Loại phản hồi nào?",
	"Your feedback": "Phản hồi của bạn",
	"Tell us anything": "Hãy cho chúng tôi biết",
	"How do you feel about Engram?": "Bạn cảm thấy thế nào về Engram?",
	"{n} of 5": "{n} trong 5",
	"Couldn't send your feedback, please try again.":
		"Không thể gửi phản hồi của bạn, vui lòng thử lại.",
	"It's OK to email me about this": "Bạn có thể gửi email cho tôi về vấn đề này",
	"Sending…": "Đang gửi…",
	Send: "Gửi",
	"Thanks, we read every message.": "Cảm ơn, chúng tôi đọc mọi tin nhắn.",
	"New here? Watch the setup video": "Bạn mới bắt đầu? Xem video hướng dẫn",
	"What Engram does, and how to connect your vault, start to finish.":
		"Engram hoạt động như thế nào và cách kết nối kho lưu trữ của bạn, từ đầu đến cuối.",
	"▶ Watch on YouTube": "▶ Xem trên YouTube",
	"Getting set up": "Thiết lập",
	"1. Make an account": "1. Tạo tài khoản",
	"setup guide": "hướng dẫn thiết lập",
	"2. Connect your vault to Engram": "2. Kết nối kho lưu trữ của bạn với Engram",
	"Sign in (or enter your server URL and key) on the connection tab, then run your first sync.":
		"Đăng nhập (hoặc nhập URL và khóa máy chủ) trên tab kết nối, sau đó thực hiện đồng bộ hóa đầu tiên.",
	"Open connection tab": "Mở tab kết nối",
	"3. Connect your AI": "3. Kết nối AI của bạn",
	"Link Claude, Cursor, ChatGPT, or any MCP app so it can read and write your notes. ":
		"Liên kết Claude, Cursor, ChatGPT, hoặc bất kỳ ứng dụng MCP nào để nó có thể đọc và ghi ghi chú của bạn ",
	"See the AI setup guide": "Xem hướng dẫn thiết lập AI",
	Plans: "Các gói",
	Free: "Miễn phí",
	"1 vault, 2 devices": "1 kho lưu trữ, 2 thiết bị",
	"Real-time sync": "Đồng bộ hóa theo thời gian thực",
	"2,000 notes searchable": "Có thể tìm kiếm 2.000 ghi chú",
	"Connect any AI (MCP)": "Kết nối bất kỳ AI (MCP) nào",
	Starter: "Starter",
	"10 vaults, unlimited devices": "10 kho lưu trữ, số lượng thiết bị không giới hạn",
	"Search all your notes": "Tìm kiếm tất cả ghi chú của bạn",
	"10 GB attachments": "10 GB tệp đính kèm",
	"Unlimited AI searches": "Tìm kiếm AI không giới hạn",
	Pro: "Phiên bản Pro",
	"Unlimited vaults": "Kho lưu trữ không giới hạn",
	"Search across all vaults at once": "Tìm kiếm trên tất cả kho lưu trữ cùng lúc",
	"50 GB attachments": "50 GB tệp đính kèm",
	"API access": "Truy cập API",
	"See full pricing": "Xem chi tiết giá",
	"Learn more": "Tìm hiểu thêm",
	Documentation: "Tài liệu",
	"AI / MCP setup guide": "Hướng dẫn thiết lập AI / MCP",
	"Report an issue": "Báo cáo sự cố",
	"Join our Discord": "Tham gia Discord của chúng tôi",
	"Create a hosted account at {signup}, or self-host the backend ({guide}).":
		"Tạo tài khoản trên {signup}, hoặc tự thiết lập máy chủ ({guide}).",
	"...": "...",
	'... "{name}" ...': '... "{name}" ...',
	"The server took too long to respond. Try again.": "Máy chủ phản hồi quá chậm. Thử lại.",
	"Not signed in, or the session expired. Sign in again in Engram settings.":
		"Chưa đăng nhập, hoặc phiên đã hết hạn. Đăng nhập lại trong phần cài đặt Engram.",
	"The file is too large for the server.": "Tệp quá lớn đối với máy chủ.",
	"Too many requests. Wait a moment and try again.":
		"Quá nhiều yêu cầu. Chờ một lát rồi thử lại.",
	"Frontmatter isn't valid YAML.": "Frontmatter không phải là định dạng YAML hợp lệ.",
	"A frontmatter key could not be parsed as YAML.":
		"Không thể phân tích một khóa frontmatter thành YAML.",
	"This note could not be processed and was skipped.":
		"Ghi chú này không thể xử lý và đã bị bỏ qua.",
	'Frontmatter key "{key}" could not be parsed as YAML.':
		'Không thể phân tích khóa frontmatter "{key}" thành YAML.',
};

export default vi;
