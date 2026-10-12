import type { Dict } from "..";

// Bahasa Melayu
const ms: Dict = {
	"Invalid API key": "Kunci API tidak sah",
	"Request failed ({status})": "Permintaan gagal ({status})",
	"Connection failed": "Sambungan gagal",
	"Link Obsidian to Engram": "Sambungkan Obsidian ke Engram",
	"Starting...": "Bermula...",
	"Failed to start device flow. Check your Engram URL and try again.":
		"Gagal memulakan proses. Semak URL Engram anda dan cuba lagi.",
	"Your code:": "Kod anda:",
	"Click to copy": "Klik untuk salin",
	"Code copied!": "Kod telah disalin!",
	"A browser window has opened. Sign in and enter this code to link your vault.":
		"Tetingkap penyemak imbas telah dibuka. Log masuk dan masukkan kod ini untuk menyambungkan peti nota anda.",
	Cancel: "Batalkan",
	"Waiting for authorization — connected, this will complete instantly.":
		"Menunggu pengesahan — disambungkan, ini akan selesai dengan serta-merta.",
	"Waiting for authorization — no live connection, checking every 30s.":
		"Menunggu pengesahan — tiada sambungan langsung, menyemak setiap 30 saat.",
	"Code expired. Please try again.": "Kod tamat tempoh. Sila cuba lagi.",
	"Try again": "Cuba lagi",
	Close: "Tutup",
	"Note couldn't be processed": "Nota tidak dapat diproses",
	"The server couldn't process this note. Check its contents, then edit and save to try again.":
		"Pelayan tidak dapat memproses nota ini. Semak kandungannya, kemudian edit dan simpan untuk cuba lagi.",
	"Attachments need a paid plan": "Lampiran memerlukan langganan berbayar",
	"The Free tier syncs notes only. Upgrade to sync images and PDFs.":
		"Versi percuma hanya menyegerakkan nota. Tingkatkan untuk menyegerakkan imej dan fail PDF.",
	"Attachment storage full": "Ruang simpan lampiran penuh",
	"You've used all the attachment storage on your plan. Upgrade for more.":
		"Anda telah menggunakan semua ruang simpan lampiran dalam langganan anda. Tingkatkan untuk lebih banyak ruang.",
	"Too large for the server": "Terlalu besar untuk pelayan",
	"The server limit is 5 MB. Compress or split the file, then it will sync.":
		"Had saiz fail ialah 5 MB. Kompres atau bahagikan fail, kemudian ia akan disegerakkan.",
	"Sign-in expired": "Sesi telah tamat",
	"Reconnect your account to resume syncing.":
		"Sambungkan semula akaun anda untuk meneruskan proses sync.",
	"Unresolved conflict": "Konflik belum selesai",
	"Open the file to resolve the conflict, then sync again.":
		"Buka fail untuk menyelesaikan konflik, kemudian segerakkan semula.",
	"Frontmatter needs a fix": "Frontmatter memerlukan pembetulan",
	"The note synced, but its frontmatter could not be fully parsed. Open it to fix the highlighted line.":
		"Nota telah disink, tetapi frontmatternya tidak dapat diproses sepenuhnya. Buka untuk memperbaiki baris yang diserlahkan.",
	"Server error": "Ralat pelayan",
	"A temporary server problem — retrying automatically.":
		"Masalah pelayan sementara — cuba semula secara automatik.",
	"Network unavailable": "Rangkaian tidak tersedia",
	"Can't reach the server — retrying automatically.":
		"Tidak dapat mencapai pelayan — cuba semula secara automatik.",
	"Sync failed": "Kegagalan penyegerakan",
	"An unexpected error — retrying automatically.":
		"Ralat yang tidak dijangka — cuba semula secara automatik.",
	"Frontmatter could not be parsed": "Frontmatter tidak dapat diproses",
	"Note limit reached. Upgrade to keep adding notes.":
		"Had nota telah dicapai. Tingkatkan untuk terus menambah nota.",
	"Vault limit reached. Upgrade for more vaults.":
		"Had peti nota telah dicapai. Tingkatkan untuk lebih banyak peti nota.",
	"This file type isn't accepted by this server.":
		"Jenis fail ini tidak diterima oleh pelayan ini.",
	"Attachment sync is disabled for this account.":
		"Penyegerakan lampiran dilumpuhkan untuk akaun ini.",
	"Attachment storage is full — upgrade for more.":
		"Ruang simpanan lampiran telah penuh — tingkatkan untuk lebih banyak ruang.",
	"File too large for your plan.": "Fail terlalu besar untuk langganan anda.",
	"Already signed in on another device. Upgrade for multi-device.":
		"Sudah log masuk pada peranti lain. Tingkatkan untuk sokongan berbilang peranti.",
	"Device swap cooldown active. Wait or upgrade.":
		"Tempoh tunggu pertukaran peranti sedang aktif. Tunggu atau tingkatkan.",
	"Too many connected Obsidian vaults. Disconnect one or upgrade.":
		"Terlalu banyak Peti Nota Obsidian yang disambungkan. Putuskan sambungan satu atau tingkatkan.",
	"Too many connected AI clients. Disconnect one or upgrade.":
		"Terlalu banyak klien AI yang disambungkan. Putuskan sambungan satu atau tingkatkan.",
	"Daily AI search limit reached. Free includes 20 per day across Obsidian, the web app and MCP. Upgrade for unlimited.":
		"Had carian AI harian telah dicapai. Versi percuma termasuk 20 carian sehari merentasi Obsidian, aplikasi web dan MCP. Tingkatkan untuk had yang tidak terhad.",
	"API keys need Pro. Sign in with your Engram account instead.":
		"Kunci API memerlukan langganan Pro. Log masuk dengan akaun Engram anda.",
	"Account suspended. Contact support.": "Akaun telah digantung. Hubungi sokongan.",
	"Account setup incomplete.": "Persediaan akaun belum lengkap.",
	"This account was deleted. Contact support if that is wrong.":
		"Akaun ini telah dipadam. Hubungi sokongan jika ini tidak betul.",
	"Finish setting up your account at app.engram.page to start syncing.":
		"Selesaikan persediaan akaun anda di app.engram.page untuk mula sync.",
	"Limit reached. Upgrade to continue.": "Had telah dicapai. Tingkatkan untuk meneruskan.",
	Upgrade: "Tingkatkan",
	"Update in settings": "Kemas kini dalam tetapan",
	"Sync now": "Segerakkan sekarang",
	"Engram sync: syncing...": "Engram sedang disegerakkan: proses...",
	"Engram Sync: pulled {pulled}, pushed {pushed}":
		"Engram Segerakan: ditarik {pulled}, dihantar {pushed}",
	"Disconnect (clear login)": "Putuskan sambungan (hapus log masuk)",
	"Engram: disconnected. Open Engram settings to reconnect.":
		"Engram: telah diputuskan sambungan. Buka tetapan Engram untuk menyambung semula.",
	"Push entire vault": "Hantar keseluruhan peti nota",
	"Engram Sync: pushed {count} files": "Engram Segerakkan: menghantar {count} fail",
	"Check sync status": "Semak status penyegerakan",
	"Engram sync: checking...": "Engram sedang disegerakkan: sedang memeriksa...",
	"Engram sync: server does not support reconciliation (update backend)":
		"Engram sync: pelayan tidak menyokong penyelarasan (kemas kini bahagian belakang)",
	"Engram sync: everything in sync": "Engram sync: semuanya sudah diselaraskan",
	"{count} missing on server": "{count} hilang di server",
	"{count} diverged": "{count} berbeza",
	"{count} only on server": "{count} sahaja pada pelayan",
	"Engram Sync: {details}": "Engram Segerakkan: {details}",
	"Pull all from server (force overwrite)": "Tarik semua daripada pelayan (timpa paksa)",
	"Engram sync: pulling all from server...":
		"Engram sync: sedang mengambil semua daripada pelayan...",
	"Engram Sync: pulled {count} files from server":
		"Engram Segerakkan: telah mengambil {count} fail daripada pelayan",
	"Show sync log": "Tunjukkan log sync",
	"Send feedback": "Hantar maklum balas",
	"Semantic search": "Carian semantik",
	"Open search sidebar": "Buka panel carian",
	"Engram search": "Carian Engram",
	"Open sync center": "Buka Pusat Sync",
	"Engram: ready": "Engram: bersedia",
	"Engram Sync: pushed {pushed}": "Engram Sync: telah menghantar {pushed}",
	"Engram sync: sync failed": "Engram sync: proses sync gagal",
	"Engram: this vault no longer exists on the server. Pick or create a vault to continue.":
		"Engram: peti nota ini tidak lagi wujud di server. Pilih atau cipta peti nota untuk meneruskan.",
	"Engram: recovered plugin settings from a backup after a corrupted save.":
		"Engram: tetapan plugin telah dipulihkan daripada sandaran selepas fail yang rosak.",
	"Engram: plugin settings file was corrupted and could not be recovered. You may need to reconnect in settings.":
		"Engram: fail tetapan plugin rosak dan tidak dapat dipulihkan. Anda mungkin perlu menyambung semula dalam tetapan.",
	"Engram: your login expired — open Engram settings to reconnect.":
		"Engram: log masuk anda telah tamat tempoh — buka tetapan Engram untuk menyambung semula.",
	"Engram: This vault has been deleted on the server.":
		"Engram: Peti nota ini telah dipadamkan di server.",
	"Engram sync: live sync requires a plugin update — please update the Engram vault sync plugin.":
		"Engram sync: sync langsung memerlukan kemas kini plugin — sila kemas kini plugin Engram Vault Sync.",
	"Engram Sync: pulled {pulled} (local extras deleted)":
		"Engram Sync: telah mengambil {pulled} (fail tambahan tempatan telah dipadam)",
	"Engram Sync: pulled {pulled}": "Engram Sync: telah mengambil {pulled}",
	"Engram Sync: replaced remote with local ({pushed} uploaded)":
		"Engram Sync: telah menggantikan fail jauh dengan fail tempatan ({pushed} telah dimuat naik)",
	"Engram: sync is not set up yet, so nothing in this vault will sync.":
		"Engram: proses sync belum ditetapkan, jadi tiada apa dalam peti nota ini yang akan diselaraskan.",
	"Finish sync setup": "Selesaikan persediaan sync",
	"Engram: sync is paused. This edit was not synced. Choose a sync direction to resume.":
		"Engram: sync ditangguhkan. Pengeditan ini belum disegerakkan. Pilih arah sync untuk meneruskan.",
	"Open Engram settings": "Buka tetapan Engram",
	"Engram: sync failed. Open the sync log for details.":
		"Engram: sync gagal. Buka log sync untuk maklumat lanjut.",
	"Engram: not connected": "Engram: tidak disambungkan",
	"Engram: signed out": "Engram: telah log keluar",
	"Not connected yet. Click to open settings and link this vault.":
		"Belum disambungkan. Klik untuk membuka tetapan dan pautkan peti nota ini.",
	"Not signed in. Click to open settings and reconnect.":
		"Belum log masuk. Klik untuk membuka tetapan dan sambungkan semula.",
	"Engram: finish setup": "Engram: selesaikan persediaan",
	"Engram: sync paused": "Engram: sync ditangguhkan",
	"{label} ({count} queued)": "{label} ({count} dalam senarai)",
	"Setup is not finished — nothing will sync until you choose a sync direction. Click to finish.":
		"Persediaan belum selesai — tiada apa yang akan disegerakkan sehingga anda memilih arah sync. Klik untuk selesai.",
	"Sync paused — click to choose a sync direction":
		"Sync ditangguhkan — klik untuk memilih arah sync",
	"Engram: offline ({count} queued)": "Engram: luar talian ({count} dalam senarai tunggu)",
	"Engram: offline": "Engram: luar talian",
	"Server unreachable — changes will sync when connected":
		"Pelayan tidak dapat dihubungi — perubahan akan disegerakkan apabila disambungkan",
	"Engram: error": "Engram: ralat",
	"Unknown error": "Ralat tidak diketahui",
	"Engram: syncing ({count})": "Engram: sedang disinkronkan ({count})",
	"Engram: syncing": "Engram: sedang disinkronkan",
	"Sync in progress...": "Proses sync sedang berjalan...",
	"Engram: pending ({count})": "Engram: tertunda ({count})",
	"{count} files queued": "{count} fail dalam senarai tunggu",
	"Engram: live": "Engram: aktif",
	"WebSocket connected — live sync active": "WebSocket disambungkan — sync langsung aktif",
	"Click to sync": "Klik untuk menyegerakkan",
	"Engram: ⚠ {count} sync errors": "Engram: ⚠ {count} ralat sync",
	"Last sync: {when}": "Sync terakhir: {when}",
	"Engram Sync: pulled {count} changes": "Engram Segerakkan: telah mengambil {count} perubahan",
	'Engram Sync: sync state for "{name}" was unreadable — using the on-disk copy.':
		'Engram Sync: keadaan sync untuk "{name}" tidak dapat dibaca — menggunakan salinan dalam cakera.',
	"Engram Vault Sync {version} is available. {link}.":
		"Engram Vault Sync {version} tersedia. {link}.",
	"{count} files": "{count} fail",
	"Notes searchable": "Nota boleh dicari",
	"Notes past this still sync and open normally, they are just not in the search index. The index keeps your oldest notes, so it is your newest ones that fall outside.":
		"Nota selepas ini masih disegerakkan dan dibuka seperti biasa, tetapi tidak berada dalam indeks carian. Indeks menyimpan nota anda yang paling lama, jadi nota terbaru anda yang tidak disertakan.",
	"Notes stored": "Nota disimpan",
	Attachments: "Lampiran",
	"AI searches": "Carian AI",
	"{formatted} per day": "{formatted} sehari",
	Keyword: "Kata kunci",
	Semantic: "Semantik",
	Both: "Kedua-duanya",
	"matches your words and their other forms — 'run' finds 'running' — plus this device.":
		"padan dengan perkataan anda dan bentuknya yang lain — 'run' mencari 'running' — ditambah peranti ini.",
	"matches meaning. Finds notes that never use the words you typed.":
		"padan dengan makna. Mencari nota yang tidak menggunakan perkataan yang anda taip.",
	"matches words and meaning together, plus this device. Widest results.":
		"padan dengan perkataan dan makna bersama, ditambah peranti ini. Hasil paling luas.",
	"Engram indexes {indexed} of your {all} notes. The rest match on this device only. Upgrade to index everything.":
		"Engram mengindeks {indexed} daripada {all} nota anda. Nota yang lain hanya dipadankan pada peranti ini. Tingkatkan untuk mengindeks semuanya.",
	"Searching {indexed} of {all} notes. Upgrade to search everything.":
		"Mencari {indexed} daripada {all} nota. Tingkatkan untuk mencari semuanya.",
	"Search your vault…": "Cari dalam peti nota anda…",
	"Clear search": "Kosongkan carian",
	"Search settings": "Tetapan carian",
	"Filter by folder…": "Tukis ikut folder…",
	"Filter by tags…": "Tukis ikut tag…",
	"Remove tag {tag}": "Buang tag {tag}",
	"Engram unreachable. Showing matches from this device only.":
		"Engram tidak dapat dihubungi. Hanya menunjukkan padanan daripada peranti ini.",
	"Search failed — check connection": "Pencarian gagal — semak sambungan",
	"No results found": "Tiada hasil ditemui",
	Untitled: "Tanpa tajuk",
	exact: "tepat",
	"meaning + exact": "maksud + tepat",
	meaning: "maksud",
	"match strength: {pct}%": "kekuatan padanan: {pct}%",
	"No source path for this result": "Tiada laluan sumber untuk hasil ini",
	"Note not synced locally": "Nota belum disinkronkan secara tempatan",
	"Syncing...": "Sedang menyinkronkan...",
	"👋 Welcome": "👋 Selamat datang",
	"🔌 Connection": "🔌 Sambungan",
	"🔄 Sync Center": "🔄 Pusat Sync",
	"⚙️ Advanced": "⚙️ Lanjutan",
	"💬 Feedback": "💬 Maklum balas",
	"Engram: settings tab failed to render ({error})":
		"Engram: tab tetapan gagal dipaparkan ({error})",
	Disconnected: "Terputus",
	"Error: {error}": "Ralat: {error}",
	unknown: "tidak diketahui",
	"Connected — waiting for first sync decision": "Disambungkan — menunggu keputusan sync pertama",
	"Connected — live sync active": "Disambungkan — sync aktif",
	"Connected — polling": "Sambung — sedang memeriksa",
	"Not configured": "Belum dikonfigurasikan",
	"Open sync setup": "Buka tetapan sync",
	"waiting for a connection": "menunggu sambungan",
	"sync is paused": "Sync ditangguhkan",
	"syncing now": "sedang sync",
	"waiting to retry": "menunggu untuk cuba semula",
	"{count} not on your plan": "{count} tidak dalam pelan anda",
	"{count} need attention": "{count} memerlukan perhatian",
	"{count} retrying": "{count} cuba semula",
	"{count} ignored": "{count} pengecualian",
	"{count} queued — {reason}": "{count} dalam senarai — {reason}",
	"Sync...": "Segerakkan...",
	Refresh: "Segarkan",
	"Not synced on your plan ({count})": "Tidak disinkronkan dalam pelan anda ({count})",
	"These files are fine. They just need a paid plan to sync.":
		"Fail ini selamat. Ia hanya memerlukan langganan berbayar untuk disegerakkan.",
	"Show files ({count}) ▾": "Tunjukkan fail ({count}) ▾",
	"Sync these now": "Segerakkan ini sekarang",
	"Needs attention ({count})": "Perlu perhatian ({count})",
	"Clear all": "Kosongkan semua",
	"Nothing needs your attention. 🎉": "Tiada perkara yang memerlukan perhatian anda. 🎉",
	Dismiss: "Tutup",
	"Retrying automatically ({count})": "Mencuba semula secara automatik ({count})",
	"Retry all now": "Cuba semula semua sekarang",
	"Temporary errors. These clear themselves once the server recovers.":
		"Kesilapan sementara. Ini akan hilang apabila server pulih.",
	"{count} attempts": "{count} percubaan",
	Open: "Buka",
	Ignore: "Abaikan",
	"Ignored ({count})": "Diabaikan ({count})",
	"No files ignored. Use the ignore button on a failure row to stop syncing it.":
		"Tiada fail yang diabaikan. Gunakan butang abaikan pada baris yang gagal untuk menghentikan proses sync.",
	Restore: "Pulihkan",
	"File not found locally: {path}": "Fail tidak ditemui secara tempatan: {path}",
	"Ignored {path} — won't sync until restored from Sync Center.":
		"Dielakkan {path} — tidak akan disegerakkan sehingga dipulihkan dari Pusat Sync.",
	"Restored {path} — will sync on next push.":
		"Dipulihkan {path} — akan disegerakkan pada push seterusnya.",
	"Activity ({count})": "Aktiviti ({count})",
	Clear: "Kosongkan",
	"No activity yet. Push or pull to see entries here.":
		"Tiada aktiviti setakat ini. Tekan atau tarik untuk melihat entri di sini.",
	Pushed: "Ditolak",
	Pulled: "Ditarik",
	Deleted: "Dipadam",
	Conflict: "Konflik",
	Skipped: "Dilewatkan",
	Error: "Ralat",
	Stats: "Statistik",
	"Notes on this device": "Nota pada peranti ini",
	"Attachments on this device": "Lampiran pada peranti ini",
	"Remote vault": "Peti Nota jauh",
	"not linked": "belum dikaitkan",
	"Plan usage": "Penggunaan pelan",
	"Sync log": "Log sync",
	"Showing {count} entries": "Menunjukkan {count} entri",
	"No sync activity this session.": "Tiada aktiviti sync pada sesi ini.",
	"({count} errors)": "({count} ralat)",
	"Could not compare with the cloud. Check your connection.":
		"Tidak dapat dibandingkan dengan awan. Semak sambungan anda.",
	"Your login expired. Sign in again in Engram settings to continue.":
		"Log masuk anda telah tamat tempoh. Log masuk semula dalam tetapan Engram untuk meneruskan.",
	"Couldn't create vault — the name may be invalid or already in use.":
		"Tidak dapat mencipta peti nota — nama tersebut mungkin tidak sah atau sudah digunakan.",
	"Could not create the vault — check your connection and try again.":
		"Tidak dapat mencipta peti nota — semak sambungan anda dan cuba lagi.",
	"Free syncs notes only — {count} attachments will be skipped.":
		"Percuma: sync nota sahaja — {count} lampiran akan dilepaskan.",
	"Uploads {up}, downloads {down}.": "Muat naik {up}, muat turun {down}.",
	"Uploads {count}.": "Muat naik {count}.",
	"Downloads {count}.": "Muat turun {count}.",
	"{count} conflicts to resolve.": "{count} konflik untuk diselesaikan.",
	"Safe choice: combines both sides, nothing is deleted.":
		"Pilihan selamat: menggabungkan kedua-dua, tiada yang dipadam.",
	"Nothing is deleted.": "Tiada yang dipadam.",
	"Already in sync. Nothing is deleted.": "Sudah disegerakkan. Tiada apa yang dipadam.",
	"Delete all {count} files currently on the server":
		"Padamkan semua {count} fail yang ada di server",
	"Upload {count} files from this vault": "Muat naik {count} fail daripada peti nota ini",
	"Delete all {count} files in this vault": "Buang semua {count} fail dalam peti nota ini",
	"Download {count} files from the server": "Muat turun {count} fail daripada pelayan",
	Sync: "Segerakkan",
	"Upload local files without downloading the remote":
		"Muat naik fail tempatan tanpa memuat turun fail jauh",
	"Delete all on remote, then upload local files":
		"Padam semua fail di bahagian jauh, kemudian muat naik fail tempatan",
	"Download remote files without uploading the local":
		"Muat turun fail jauh tanpa memuat naik fail tempatan",
	"Delete all local files, then download from remote":
		"Padam semua fail tempatan, kemudian muat turun dari jauh",
	"Set up sync for this vault": "Konfigurasikan sync untuk peti nota ini",
	"You are now pointing at a different cloud vault":
		"Anda kini mengakses peti nota awan yang berbeza",
	"Sync preview": "Pratonton sync",
	"Nothing to sync yet — this vault is empty on both sides. Start syncing and everything you write appears on your other devices.":
		"Tiada apa yang perlu disegerakkan setakat ini — peti nota ini kosong di kedua-dua bahagian. Mulakan sync dan semua yang anda tulis akan muncul pada peranti anda yang lain.",
	"Start syncing": "Mulakan sync",
	"{count} notes": "{count} nota",
	"{count} attachments": "{count} lampiran",
	"{first} and {second}": "{first} dan {second}",
	files: "fail",
	"This vault is empty on the server. Upload your {what}?":
		"Peti nota ini kosong di server. Adakah anda ingin memuat naik {what}?",
	"Upload everything": "Muat naik semuanya",
	"Nothing will be removed from this device.":
		"Tiada apa yang akan dipadam daripada peranti ini.",
	"This device's vault is empty. Download {what} from the server?":
		"Peti nota peranti ini kosong. Adakah anda ingin memuat turun {what} dari server?",
	"Download everything": "Muat turun semua",
	Done: "Selesai",
	"Send debug logs. Note content stays private.":
		"Hantar log ralat. Kandungan nota kekal peribadi.",
	"Comparing your vault with the cloud…": "Membandingkan peti nota anda dengan awan…",
	"Not now": "Tidak sekarang",
	"Change vault": "Tukar peti nota",
	"Advanced sync options": "Pilihan sync lanjutan",
	"Everything is in sync": "Segalanya sudah disegerakkan",
	"This vault": "Peti nota ini",
	"Cloud server": "Pelayan awan",
	notes: "nota",
	attachments: "lampiran",
	folders: "folder",
	"Confirm destructive sync": "Sahkan sync yang akan memadamkan data",
	"You are about to:": "Anda akan:",
	"Files that will be deleted:": "Fail yang akan dipadam:",
	"This cannot be undone.": "Ini tidak dapat dibatalkan.",
	Back: "Kembali",
	Confirm: "Sahkan",
	"Switch vault": "Tukar peti nota",
	"Pick a vault to sync with. We will recalculate the sync preview after you choose.":
		"Pilih peti nota untuk disegerakkan. Kami akan mengira semula pratonton sync selepas anda memilih.",
	"Loading vaults…": "Memuatkan peti nota…",
	" (default)": " (lalai)",
	"No other vaults available.": "Tiada peti nota lain yang tersedia.",
	"Make new vault": "Buat peti nota baharu",
	"New vault": "Peti nota baharu",
	"Create a new empty vault on the server, then sync this Obsidian vault into it.":
		"Buat peti nota kosong baharu di server, kemudian segerakkan peti nota Obsidian ini ke dalamnya.",
	"Vault name": "Nama peti nota",
	Create: "Buat",
	"Could not load vaults: {error}": "Tidak dapat memuatkan peti nota: {error}",
	"Enter a name for the new vault": "Masukkan nama untuk peti nota baharu",
	"Failed to switch vault: {error}": "Gagal beralih peti nota: {error}",
	"Your vault shares {percent} of its data with Engram":
		"Peti nota anda berkongsi {percent} data dengan Engram",
	"{count} conflicts need resolution": "{count} konflik perlu diselesaikan",
	"Type {keyword} to confirm:": "Taip {keyword} untuk mengesahkan:",
	"Uploading {count}.": "Memuat naik {count}.",
	"Downloading {count}.": "Memukimkan {count}.",
	"Deleting {count} local files.": "Memadam {count} fail tempatan.",
	"Deleting {count} on the cloud.": "Memadam {count} daripada awan.",
	"First sync, this may take a moment.": "Sync pertama, ini mungkin mengambil masa.",
	"Checking for changes.": "Memeriksa perubahan.",
	"Nothing will be deleted.": "Tiada apa yang akan dipadam.",
	"✓ {count} synced": "✓ {count} disinkronkan",
	"⤳ {count} skipped (Free plan)": "⤳ {count} dilangkau (Pelan percuma)",
	"✕ {count} failed": "✕ {count} gagal",
	"{count} attachments need a paid plan to sync. See Sync Center.":
		"{count} lampiran memerlukan langganan berbayar untuk disegerakkan. Lihat Pusat Sync.",
	"Finished with some errors. Open the sync log to see what failed.":
		"Selesai dengan beberapa ralat. Buka log sync untuk melihat apa yang gagal.",
	"Synced. Some attachments need a paid plan to sync (see below).":
		"Disegerakkan. Sesetengah lampiran memerlukan langganan berbayar untuk disegerakkan (lihat di bawah).",
	"All synced. Your vault and the cloud now match.":
		"Semuanya disinkronkan. Peti Nota anda dan awan kini sepadan.",
	"Already up to date. Nothing needed syncing.":
		"Sudah terkini. Tiada apa yang perlu disinkronkan.",
	Deleting: "Memadam",
	Downloading: "Memuat turun",
	Uploading: "Sedang memuat naik",
	"Syncing your vault": "Mengsync peti nota anda",
	"Getting started…": "Memulakan…",
	"Open Engram to check your vault and confirm everything synced.":
		"Buka Engram untuk menyemak peti nota anda dan pastikan semuanya telah disink.",
	"Open Engram": "Buka Engram",
	"You can close this and the sync keeps running in the background.":
		"Anda boleh menutup ini dan proses sync akan terus berjalan di latar belakang.",
	"Run in background": "Jalankan di latar belakang",
	"Syncing…": "Sedang mengsync…",
	"Sync complete": "Sync selesai",
	"Syncing attachments": "Mengsync lampiran",
	Complete: "Selesai",
	'{count} failed. Run "{command}" for details.':
		'{count} gagal. Jalankan "{command}" untuk butiran.',
	"File exceeds the {limit} limit": "Fail melebihi had {limit}",
	"Free syncs notes only — images & PDFs need a paid plan.":
		"Percuma untuk menyinkronkan nota sahaja – imej & fail PDF memerlukan langganan berbayar.",
	"Engram: {count} files failed to sync{detail} — open Sync Center":
		"Engram: {count} fail gagal disegerakkan{detail} — buka Pusat Sync",
	"Engram: {count} attachments skipped — upgrade to sync images & PDFs.":
		"Engram: {count} lampiran dilepaskan — tingkatkan ke langganan untuk menyegerakkan imej & PDF.",
	"Engram: plan upgraded — syncing {count} attachments…":
		"Engram: Peningkatan pelan — sedang menyinkronkan {count} lampiran…",
	"Pull all (delete extras) aborted: could not obtain an exclusive server snapshot (replay contention). Nothing was trashed.":
		"Mengambil semua (padamkan yang berlebihan) dibatalkan: tidak dapat mendapatkan salinan server eksklusif (persaingan). Tiada yang dipadam.",
	"Pull all aborted: another sync is running (replay contention). Try again when it finishes.":
		"Semua proses tarik dibatalkan: proses sync lain sedang berjalan (konflik). Cuba lagi apabila selesai.",
	"Pull all failed: {error}": "Mengambil semua gagal: {error}",
	"Engram: sync conflict on {path} — your local edit was saved as {copy}":
		"Engram: konflik sync pada {path} — edit tempatan anda telah disimpan sebagai {copy}",
	"Open note": "Buka nota",
	"Engram: {count} notes have frontmatter problems. Open Sync Center to fix.":
		"Engram: {count} nota mempunyai masalah frontmatter. Buka Pusat Sync untuk membetulkannya.",
	'Engram Sync: renamed "{name}" (unsupported characters)':
		'Engram Sync: nama fail ditukar "{name}" (karektor tidak disokong)',
	'Engram: frontmatter problem in "{name}"': 'Engram: masalah frontmatter dalam "{name}"',
	"Engram: this plugin is too old to sync (needs {version} or newer). Update it to continue.":
		"Engram: plugin ini terlalu lama untuk melakukan sync (perlu {version} atau lebih baru). Kemas kini untuk meneruskan.",
	"Engram: this plugin is too old to sync. Update it to continue.":
		"Engram: plugin ini terlalu lama untuk melakukan sync. Kemas kini untuk meneruskan.",
	Update: "Kemas kini",
	"New here? Watch the setup video": "Baru di sini? Tonton video panduan",
	"What Engram does, and how to connect your vault, start to finish.":
		"Apa yang Engram lakukan, dan cara menyambungkan peti nota anda, dari awal hingga akhir.",
	"▶ Watch on YouTube": "▶ Tonton di YouTube",
	"Getting set up": "Memulakan",
	"1. Make an account": "1. Buat akaun",
	"setup guide": "panduan persediaan",
	"2. Connect your vault to Engram": "2. Sambungkan peti nota anda ke Engram",
	"Sign in (or enter your server URL and key) on the connection tab, then run your first sync.":
		"Log masuk (atau masukkan URL dan kunci pelayan anda) pada tab sambungan, kemudian jalankan sync pertama anda.",
	"Open connection tab": "Buka tab sambungan",
	"3. Connect your AI": "3. Sambungkan AI anda",
	"Link Claude, Cursor, ChatGPT, or any MCP app so it can read and write your notes. ":
		"Hubungkan Claude, Cursor, ChatGPT, atau sebarang aplikasi MCP supaya ia boleh membaca dan menulis nota anda ",
	"See the AI setup guide": "Lihat panduan konfigurasi AI",
	Plans: "Pakej",
	Free: "Percuma",
	"1 vault, 2 devices": "1 peti nota, 2 peranti",
	"Real-time sync": "Sync masa nyata",
	"2,000 notes searchable": "2,000 nota boleh dicari",
	"Connect any AI (MCP)": "Hubungkan sebarang AI (MCP)",
	Starter: "Starter",
	"10 vaults, unlimited devices": "10 peti nota, peranti tanpa had",
	"Search all your notes": "Cari semua nota anda",
	"10 GB attachments": "10 GB lampiran",
	"Unlimited AI searches": "Carian AI tanpa had",
	Pro: "Pro",
	"Unlimited vaults": "Peti nota tanpa had",
	"Search across all vaults at once": "Cari semua peti nota sekaligus",
	"50 GB attachments": "50 GB lampiran",
	"API access": "Akses API",
	"See full pricing": "Lihat harga penuh",
	"Learn more": "Ketahui lebih lanjut",
	Documentation: "Dokumentasi",
	"AI / MCP setup guide": "Panduan persediaan AI / MCP",
	"Report an issue": "Laporkan masalah",
	"Join our Discord": "Sertai Discord kami",
	"Create a hosted account at {signup}, or self-host the backend ({guide}).":
		"Buat akaun hos di {signup}, atau hoskan bahagian belakang sendiri ({guide}).",
	"Node.js dependencies": "Ketergantungan Node.js",
	"Python virtual environment": "Persekitaran maya Python",
	"Python bytecode cache": "Cache bytecode Python",
	"Vendored dependencies": "Ketergantungan yang disertakan",
	"Gradle build cache": "Cache binaan Gradle",
	"Rust/Java build output": "Output binaan Rust/Java",
	"Build output": "Output binaan",
	"Next.js build output": "Output binaan Next.js",
	"Distribution build output": "Output binaan pengedaran",
	"Cargo cache": "Cache Cargo",
	"CocoaPods dependencies": "Ketergantungan CocoaPods",
	"Dart tool cache": "Cache alat Dart",
	"Generic cache directory": "Direktori cache umum",
	"Ignore patterns": "Pengecualian corak",
	"Custom patterns": "Corak khusus",
	"Paths to skip (one per line). Folder patterns end with /. Built-in: {configDir}/, .trash/, .git/":
		"Jalur yang dikecualikan (satu per baris). Corak folder berakhir dengan /. Binaan dalam: {configDir}/, .trash/, .git/",
	Diagnostics: "Diagnosis",
	"Send detailed sync, vault, and connection activity to the server for troubleshooting, with distributed tracing on requests. Metadata only, never note content. Leave off for normal use.":
		"Hantar maklumat terperinci tentang proses sync, peti nota, dan sambungan ke pelayan untuk penyelesaian masalah, dengan penjejakan teragih pada permintaan. Hanya metadata, tidak pernah kandungan nota. Biarkan tidak aktif untuk penggunaan biasa.",
	"Diagnostics detail": "Butiran diagnosis",
	"Minimum severity that ships while diagnostics are on. Higher levels send fewer lines. Default: Info.":
		"Tahap keparuhan minimum yang dihantar semasa diagnosis diaktifkan. Tahap yang lebih tinggi menghantar lebih sedikit baris. Lalai: Info.",
	"Errors only": "Ralat sahaja",
	"Warnings and errors": "Amaran dan ralat",
	"Info (default)": "Info (lalai)",
	"Debug (verbose)": "Debug (terperinci)",
	About: "Mengenai",
	"License: {name}": "Lesen: {name}",
	"⚠ Detected: {label}/ ({formatted} files)": "⚠ Dikesan: {label} ({formatted} fail)",
	"{desc} — should not be synced": "{desc} — tidak perlu disinkronkan",
	"Add to ignores": "Tambah ke pengecualian",
	"Added {pattern} to ignore patterns": "Telah ditambahkan {pattern} ke corak pengecualian",
	"Version: {version}": "Versi: {version}",
	"Source: {link}": "Sumber: {link}",
	"Engram URL": "URL Engram",
	"✓ Engram server reachable (v{version})": "✓ Perantau Engram dapat diakses (v{version})",
	"✗ server responded but isn't an Engram backend":
		"✗ Perantau menjawab tetapi bukan perantau Engram",
	"✗ couldn't reach a server at this URL": "✗ Tidak dapat mengakses perantau di URL ini",
	"Checking server…": "Memeriksa pelayan…",
	"That does not look like a complete server address. Include the scheme, for example http://127.0.0.1:4000":
		"Itu tidak seperti alamat pelayan yang lengkap. Sertakan skema, contohnya http://127.0.0.1:4000",
	"Engram backend changed — sign in again to continue.":
		"Backend Engram telah berubah — log masuk semula untuk meneruskan.",
	Authentication: "Pengesahan",
	"Signed in as {email}": "Log masuk sebagai {email}",
	"Authenticated via Engram account (OAuth).": "Disahkan melalui akaun Engram (OAuth).",
	"Manage account": "Urus akaun",
	"Sign out": "Log keluar",
	"Using API key": "Menggunakan kunci API",
	"Authenticated via manual API key.": "Disahkan melalui kunci API manual.",
	"Clear key": "Kosongkan kunci",
	"Switch to sign in": "Tukar ke log masuk",
	"Engram: sign-in failed ({error})": "Engram: log masuk gagal ({error})",
	"Sign in or create an account": "Log masuk atau buat akaun",
	"Opens your browser to sign in, or create an account if you don't have one yet, then links this vault.":
		"Membuka penyemak imbas anda untuk log masuk, atau buat akaun jika anda belum ada, kemudian pautkan peti nota ini.",
	"Sign in": "Log masuk",
	"Or authenticate with a token instead of signing in. Engram Cloud API keys require the Pro plan; on Free and Starter, sign in above.":
		"Atau gunakan token untuk pengesahan, bukan log masuk. Kunci API Engram memerlukan pelan Pro; pada Free dan Starter, log masuk seperti di atas.",
	"Or authenticate with a token instead of signing in.":
		"Atau gunakan token untuk pengesahan, bukan log masuk.",
	"API key": "Kunci API",
	Token: "Token",
	"Bearer token from your Engram account.": "Token bawaan dari akaun Engram anda.",
	Save: "Simpan",
	"Enter an API key first": "Masukkan kunci API terlebih dahulu",
	"That does not look like an Engram API key (expected {prefix}…).":
		"Itu tidak kelihatan seperti kunci API Engram (diharapkan {prefix}…).",
	Vault: "Peti Nota",
	"Vault selection": "Pemilihan peti nota",
	"Select which vault this plugin syncs with.":
		"Pilih peti nota yang ingin disinkronkan oleh plugin ini.",
	"No vaults found — first sync will create one":
		"Tiada peti nota ditemui — sync pertama akan mencipta satu",
	"Pick a vault (previous: '{name}' not found)":
		"Pilih peti nota (sebelum ini: '{name}' tidak ditemui)",
	"Pick a vault (previous: id {id} not found)":
		"Pilih peti nota (sebelum ini: ID {id} tidak ditemui)",
	"Pick a vault": "Pilih peti nota",
	"Vault ID: {id}": "ID Peti Nota: {id}",
	Change: "Tukar",
	"Support development": "Sokong pembangunan",
	"If this plugin saves you time, consider supporting development.":
		"Jika plugin ini menjimatkan masa anda, pertimbangkan untuk menyokong pembangunan.",
	"GitHub Sponsors": "GitHub Sponsors",
	"Sign-in required to load vaults": "Sediakan log masuk untuk memuatkan peti nota",
	"Server error ({status}) — check Engram logs": "Ralat pelayan ({status}) — semak log Engram",
	"Could not reach Engram — check connection": "Tidak dapat mencapai Engram — semak sambungan",
	"Engram Cloud": "Awan Engram",
	"Self-hosted": "Dihos sendiri",
	Backend: "Sistem belakang",
	"Where this vault syncs to. Each backend keeps its own sign-in.":
		"Tempat peti nota ini disinkronkan. Setiap sistem belakang mempunyai log masuknya sendiri.",
	"Switched to {mode}.": "Beralih ke {mode}.",
	"Not connected. Enter your Engram server URL below to start syncing.":
		"Tidak disambungkan. Masukkan URL pelayan Engram anda di bawah untuk memulakan sync.",
	"Run your own Engram server": "Jalankan pelayan Engram anda sendiri",
	"Engram is the backend that powers sync and semantic search.":
		"Engram ialah sistem belakang yang menyokong sync dan carian semantik.",
	"Nothing in this vault syncs until you choose how to merge it with the server.":
		"Tiada apa dalam peti nota ini yang disinkronkan sehingga anda memilih cara untuk menggabungkannya dengan pelayan.",
	"Choose sync direction": "Pilih arah sync",
	Bug: "Ralat",
	Idea: "Idea",
	Confusing: "Membingungkan",
	"Love it": "Sangat suka",
	"What's working, what's frustrating, what do you wish Engram did?":
		"Apa yang berfungsi, apa yang mengecewakan, apa yang anda harapkan Engram lakukan?",
	"This server is self-hosted, so feedback is not collected here. ":
		"Pelayan ini dikendalikan sendiri, jadi maklum balas tidak dikumpul di sini. ",
	"Report an issue on GitHub": "Laporkan masalah di GitHub",
	"Connect to Engram first to send feedback.":
		"Sambung ke Engram terlebih dahulu untuk menghantar maklum balas.",
	"Open Connection": "Buka Sambungan",
	"What kind of feedback?": "Jenis maklum balas apa?",
	"Your feedback": "Maklum balas anda",
	"Tell us anything": "Beritahu kami apa sahaja",
	"How do you feel about Engram?": "Bagaimana pendapat anda tentang Engram?",
	"{n} of 5": "{n} daripada 5",
	"Couldn't send your feedback, please try again.":
		"Tidak dapat menghantar maklum balas anda, sila cuba lagi.",
	"It's OK to email me about this": "Anda boleh emel saya tentang ini",
	"Sending…": "Mengirim…",
	Send: "Hantar",
	"Thanks, we read every message.": "Terima kasih, kami membaca setiap mesej.",
	"...": "...",
	'... "{name}" ...': '... "{name}" ...',
	"The server took too long to respond. Try again.":
		"Pelayan mengambil masa terlalu lama untuk menjawab. Cuba lagi.",
	"Not signed in, or the session expired. Sign in again in Engram settings.":
		"Belum log masuk, atau sesi telah tamat. Log masuk semula dalam tetapan Engram.",
	"The file is too large for the server.": "Fail ini terlalu besar untuk pelayan.",
	"Too many requests. Wait a moment and try again.":
		"Terlalu banyak permintaan. Tunggu sebentar dan cuba lagi.",
	"Frontmatter isn't valid YAML.": "Frontmatter bukan YAML yang sah.",
	"A frontmatter key could not be parsed as YAML.":
		"Kunci frontmatter tidak dapat ditafsir sebagai YAML.",
	"This note could not be processed and was skipped.":
		"Nota ini tidak dapat diproses dan telah dilepaskan.",
	'Frontmatter key "{key}" could not be parsed as YAML.':
		'Kunci frontmatter "{key}" tidak dapat ditafsir sebagai YAML.',
};

export default ms;
