import type { Dict } from "..";

// Türkçe
const tr: Dict = {
	" (default)": " (varsayılan)",
	"({count} errors)": { one: "({count} hata)", other: "({count} hata)" },
	"...": "...",
	'... "{name}" ...': '... "{name}" ...',
	"1 vault, 2 devices": "1 kasa, 2 cihaz",
	"1. Make an account": "1. Bir hesap oluşturun",
	"10 GB attachments": "10 GB ek",
	"10 vaults, unlimited devices": "10 kasa, sınırsız cihaz",
	"2,000 notes searchable": "2.000 not aranabilir",
	"2. Connect your vault to Engram": "2. Kasanızı Engram ile bağlayın",
	"3. Connect your AI": "3. Yapay zekanızı bağlayın",
	"50 GB attachments": "50 GB ek",
	"A browser window has opened. Sign in and enter this code to link your vault.":
		"Bir tarayıcı penceresi açıldı. Giriş yapın ve bu kodu girerek kasanızı bağlayın.",
	"A frontmatter key could not be parsed as YAML.":
		"Bir ön bilgi anahtarı YAML olarak çözülemedi.",
	"A temporary server problem — retrying automatically.":
		"Geçici bir sunucu sorunu — otomatik olarak tekrar deneniyor.",
	"AI / MCP setup guide": "Yapay zeka / MCP kurulum kılavuzu",
	"AI searches": "Yapay zeka aramaları",
	"API access": "API erişimi",
	"API key": "API anahtarı",
	"API keys need a Pro plan. Sign in with your Engram account instead.":
		"API anahtarları için Pro planı gereklidir. Lütfen Engram hesabınızla giriş yapın.",
	About: "Hakkında",
	"Accept it to keep syncing.": "Senkronizasyonu devam ettirmek için kabul edin.",
	"Access token": "Erişim belirteci",
	"Account setup incomplete.": "Hesap kurulumu tamamlanmadı.",
	"Account suspended. Contact support.": "Hesap askıya alındı. Destekle iletişime geçin.",
	"Activity ({count})": "Etkinlik ({count})",
	"Add to ignores": "Yoksaymalara ekle",
	"Added {pattern} to ignore patterns": "{pattern} yoksayma kalıplarına eklendi",
	"Advanced sync options": "Gelişmiş senkronizasyon seçenekleri",
	"All synced. Your vault and the cloud now match.":
		"Her şey senkronize edildi. Kasanız ve bulut artık aynı.",
	"Already in sync. Nothing is deleted.": "Zaten senkronize. Hiçbir şey silinmez.",
	"Already signed in on another device. Upgrade for multi-device.":
		"Başka bir cihazda zaten giriş yapılmış. Çoklu cihaz için yükseltin.",
	"Already up to date. Nothing needed syncing.": "Zaten güncel. Senkronize edilecek bir şey yok.",
	"An unexpected error — retrying automatically.":
		"Beklenmeyen bir hata — otomatik olarak tekrar deneniyor.",
	"Attachment storage full": "Ek depolama alanı doldu",
	"Attachment storage is full — upgrade for more.":
		"Ek depolama alanı doldu — daha fazla için yükseltin.",
	"Attachment sync is disabled for this account.": "Bu hesap için ek senkronizasyonu devre dışı.",
	Attachments: "Ekler",
	"Attachments need a paid plan": "Ekler için ücretli bir plan gereklidir",
	"Attachments on this device": "Bu cihazdaki ekler",
	"Authenticated via Engram account (OAuth).":
		"Engram hesabı üzerinden kimlik doğrulandı (OAuth).",
	"Authenticated via manual API key.": "Manuel API anahtarı ile kimlik doğrulandı.",
	Authentication: "Kimlik Doğrulama",
	Back: "Geri",
	"Bearer token from your Engram account.": "Engram hesabınızdan alınan taşıyıcı token.",
	Both: "Her iki",
	Bug: "Hata",
	"Build output": "Derleme çıktıları",
	"Can't reach the server — retrying automatically.":
		"Sunucuya ulaşılamıyor — otomatik olarak tekrar deneniyor.",
	Cancel: "İptal",
	"Cargo cache": "Cargo önbelleği",
	Change: "Değiştir",
	"Change vault": "Kasa değiştir",
	"Check sync status": "Senkronizasyon durumunu kontrol et",
	"Checking for changes.": "Değişiklikler kontrol ediliyor.",
	"Checking server…": "Sunucu kontrol ediliyor…",
	"Choose sync direction": "Senkronizasyon yönünü seçin",
	Clear: "Temizle",
	"Clear all": "Tümünü temizle",
	"Clear key": "Anahtarı temizle",
	"Clear search": "Aramayı temizle",
	"Click to copy": "Kopyalamak için tıklayın",
	"Click to sync": "Senkronize etmek için tıklayın",
	Close: "Kapat",
	"Cloud server": "Bulut sunucusu",
	"CocoaPods dependencies": "CocoaPods bağımlılıkları",
	"Code copied!": "Kod kopyalandı!",
	"Comparing your vault with the cloud…": "Kasanızı bulutla karşılaştırıyoruz…",
	Complete: "Tamamlandı",
	Confirm: "Onayla",
	"Confirm destructive sync": "Verileri silmeyi onaylayın",
	Conflict: "Çakışma",
	Confusing: "Karmaşık",
	"Connect any AI (MCP)": "Herhangi bir yapay zekayı (MCP) bağlayın",
	"Connect to Engram first to send feedback.":
		"Geri bildirim göndermek için önce Engram ile bağlantı kurun.",
	"Connected — live sync active": "Bağlı - canlı senkronizasyon aktif",
	"Connected — polling": "Bağlı – sorgulama yapılıyor",
	"Connected — waiting for first sync decision": "Bağlı - ilk senkronizasyon kararı bekleniyor",
	"Connection failed": "Bağlantı hatası",
	"Could not compare with the cloud. Check your connection.":
		"Bulut ile karşılaştırılamadı. Bağlantınızı kontrol edin.",
	"Could not create the vault — check your connection and try again.":
		"Kasa oluşturulamadı — bağlantınızı kontrol edin ve tekrar deneyin.",
	"Could not load vaults: {error}": "Kasaları yükleyemedi: {error}",
	"Could not reach Engram — check connection":
		"Engram adresine ulaşılamadı — bağlantıyı kontrol edin",
	"Couldn't create vault — the name may be invalid or already in use.":
		"Kasa oluşturulamadı - isim geçersiz olabilir veya zaten kullanımda olabilir.",
	"Couldn't send your feedback, please try again.":
		"Geri bildiriminizi göndermek mümkün olmadı, lütfen tekrar deneyin.",
	Create: "Oluştur",
	"Create a hosted account at {signup}, or self-host the server ({guide}).":
		"{signup} adresinde bir hesap oluşturun veya sunucuyu kendiniz barındırın ({guide}).",
	"Create a new empty vault on the server, then sync this Obsidian vault into it.":
		"Sunucuda yeni bir boş kasa oluşturun, ardından bu Obsidian kasayı içine senkronize edin.",
	"Custom patterns": "Özel kalıplar",
	"Daily AI search limit reached. Free includes 20 per day across Obsidian, the web app and MCP. Upgrade for unlimited.":
		"Günlük yapay zeka arama limiti aşıldı. Ücretsiz kullanımda Obsidian, web uygulaması ve MCP için günlük 20 arama dahildir. Sınırsız kullanım için yükseltin.",
	"Dart tool cache": "Dart araç önbelleği",
	"Debug (verbose)": "Hata ayıklama (ayrıntılı)",
	"Delete all local files, then download from remote":
		"Tüm yerel dosyaları silin, ardından uzaktan indirin",
	"Delete all on remote, then upload local files":
		"Uzaktaki tüm dosyaları silin, ardından yerel dosyaları yükleyin",
	"Delete all {count} files currently on the server": {
		one: "Sunucudaki {count} dosyayı sil",
		other: "Sunucudaki {count} dosyayı sil",
	},
	"Delete all {count} files in this vault": {
		one: "Bu kasadaki {count} dosyayı sil",
		other: "Bu kasadaki {count} dosyayı sil",
	},
	Deleted: "Silindi",
	Deleting: "Silme",
	"Deleting {count} local files.": {
		one: "{count} yerel dosya siliniyor.",
		other: "{count} yerel dosya siliniyor.",
	},
	"Deleting {count} on the cloud.": {
		one: "Buluttan {count} öğe siliniyor.",
		other: "Buluttaki {count} öğe siliniyor.",
	},
	"Device swap cooldown active. Wait or upgrade.":
		"Cihaz değiştirme bekleme süresi aktif. Bekleyin veya yükseltin.",
	Diagnostics: "Tanı",
	"Diagnostics detail": "Tanı ayrıntısı",
	"Disconnect (clear login)": "Bağlantıyı kes (girişi temizle)",
	Disconnected: "Bağlantı kesildi",
	Dismiss: "Tamam",
	"Distribution build output": "Dağıtım derleme çıktıları",
	Documentation: "Belgeler",
	Done: "Tamam",
	"Download everything": "Her şeyi indir",
	"Download remote files without uploading the local":
		"Yerel dosyaları yüklemeden uzaktaki dosyaları indirin",
	"Download {count} files from the server": {
		one: "Sunucudan {count} dosya indir",
		other: "Sunucudan {count} dosya indirin",
	},
	Downloading: "İndirme",
	"Downloading {count}.": { one: "İndiriliyor {count}.", other: "İndiriliyor {count}." },
	"Engram Cloud": "Engram Bulut",
	"Engram Sync: pulled {count} changes": {
		one: "Engram Senkronizasyon: {count} değişiklik indirildi",
		other: "Engram Senkronizasyon: {count} değişiklik indirildi",
	},
	"Engram Sync: pulled {count} files from server": {
		one: "Engram Senkronizasyon: sunucudan {count} dosya indirildi",
		other: "Engram Senkronizasyon: sunucudan {count} dosya indirildi",
	},
	"Engram Sync: pulled {pulled}": "Engram Senkronizasyonu: {pulled} indirildi",
	"Engram Sync: pulled {pulled} (local extras deleted)":
		"Engram Senkronizasyonu: {pulled} indirildi (yerel ekler silindi)",
	"Engram Sync: pulled {pulled}, pushed {pushed}":
		"Engram Senkronizasyon: {pulled} indirildi, {pushed} gönderildi",
	"Engram Sync: pushed {count} files": {
		one: "Engram Senkronizasyon: {count} dosya gönderildi",
		other: "Engram Senkronizasyon: {count} dosya gönderildi",
	},
	"Engram Sync: pushed {pushed}": "Engram Senkronizasyonu: {pushed} gönderildi",
	'Engram Sync: renamed "{name}" (unsupported characters)':
		'Engram Senkronizasyon: "{name}" yeniden adlandırıldı (desteklenmeyen karakterler)',
	"Engram Sync: replaced remote with local ({pushed} uploaded)":
		"Engram Senkronizasyonu: Uzak kopyayı yerel ile değiştirdi ({pushed} yüklendi)",
	'Engram Sync: sync state for "{name}" was unreadable — using the on-disk copy.':
		'Engram Senkronizasyon: "{name}" için senkronizasyon durumu okunamadı — diskteki kopyası kullanılıyor.',
	"Engram Sync: {details}": "Engram Senkronizasyon: {details}",
	"Engram URL": "Engram URL'si",
	"Engram Vault Sync {version} is available. {link}.":
		"Engram Vault Sync {version} mevcut. {link}.",
	"Engram indexes {indexed} of your {all} notes. The rest match on this device only. Upgrade to index everything.":
		"Engram, {all} notunuzun {indexed} tanesini indeksliyor. Geri kalanı yalnızca bu cihazda mevcut. Her şeyi indekslemek için yükseltin.",
	"Engram is the backend that powers sync and semantic search.":
		"Engram, senkronizasyonu ve anlamsal aramayı sağlayan arka uçtur.",
	"Engram search": "Engram arama",
	"Engram server changed — sign in again to continue.":
		"Engram sunucusu değişti — devam etmek için tekrar giriş yapın.",
	"Engram sync: checking...": "Engram Senkronizasyon: kontrol ediliyor...",
	"Engram sync: everything in sync": "Engram Senkronizasyon: her şey senkronize",
	"Engram sync: live sync requires a plugin update — please update the Engram vault sync plugin.":
		"Engram senkronizasyonu: Canlı senkronizasyon için eklenti güncellenmesi gerekiyor — lütfen Engram kasa senkronizasyon eklentisini güncelleyin.",
	"Engram sync: pulling all from server...":
		"Engram senkronizasyonu: sunucudan tüm verileri çekiliyor...",
	"Engram sync: server does not support reconciliation (update backend)":
		"Engram Senkronizasyon: sunucu uzlaşmayı desteklemiyor (arka ucu güncelleyin)",
	"Engram sync: sync failed": "Engram senkronizasyonu: senkronizasyon başarısız oldu",
	"Engram sync: syncing...": "Engram Senkronizasyon: senkronize ediliyor...",
	"Engram unreachable. Showing matches from this device only.":
		"Engram erişilemiyor. Sadece bu cihazdaki sonuçları gösteriyor.",
	"Engram's {document} update, effective {date}.":
		"Engram'ın {document} güncellemesi, {date} tarihinden itibaren geçerli.",
	"Engram: This vault has been deleted on the server.": "Engram: Bu kasa sunucuda silindi.",
	"Engram: disconnected. Open Engram settings to reconnect.":
		"Engram: bağlantı kesildi. Yeniden bağlanmak için Engram ayarlarını açın.",
	"Engram: error": "Engram: hata",
	"Engram: finish setup": "Engram: kurulum tamamlandı",
	'Engram: frontmatter problem in "{name}"': 'Engram: "{name}" dosyasında frontmatter sorunu',
	"Engram: live": "Engram: aktif",
	"Engram: not connected": "Engram: Bağlı değil",
	"Engram: offline": "Engram: çevrimdışı",
	"Engram: offline ({count} queued)": {
		one: "Engram: çevrimdışı ({count} sırada)",
		other: "Engram: çevrimdışı ({count} sırada)",
	},
	"Engram: pending ({count})": "Engram: bekliyor ({count})",
	"Engram: plan upgraded — syncing {count} attachments…": {
		one: "Engram: plan yükseltildi — {count} ek senkronize ediliyor…",
		other: "Engram: plan yükseltildi — {count} ek senkronize ediliyor…",
	},
	"Engram: plugin settings file was corrupted and could not be recovered. You may need to reconnect in settings.":
		"Engram: eklenti ayarları dosyası bozuldu ve geri yüklenemedi. Ayarlarda yeniden bağlanmanız gerekebilir.",
	"Engram: ready": "Engram: hazır",
	"Engram: recovered plugin settings from a backup after a corrupted save.":
		"Engram: Kaydedilirken bir sorun oluştuğu için, eklenti ayarlarını bir yedekten geri yükledi.",
	"Engram: settings tab failed to render ({error})":
		"Engram: Ayarlar sekmesi yüklenemedi ({error})",
	"Engram: sign-in failed ({error})": "Engram: Giriş başarısız ({error})",
	"Engram: signed out": "Engram: Oturum kapatıldı",
	"Engram: sync conflict on {path} — your local edit was saved as {copy}":
		"Engram: {path} üzerinde senkronizasyon çakışması — yerel düzenlemeniz {copy} olarak kaydedildi",
	"Engram: sync failed. Open the sync log for details.":
		"Engram: Senkronizasyon başarısız oldu. Detaylar için senkronizasyon günlüğünü açın.",
	"Engram: sync is not set up yet, so nothing in this vault will sync.":
		"Engram: Senkronizasyon henüz ayarlanmadı, bu yüzden bu kasadaki hiçbir şey senkronize olmayacak.",
	"Engram: sync is paused. This edit was not synced. Choose a sync direction to resume.":
		"Engram: Senkronizasyon durduruldu. Bu değişiklik senkronize edilmedi. Devam etmek için bir senkronizasyon yönü seçin.",
	"Engram: sync paused": "Engram: senkronizasyon durduruldu",
	"Engram: syncing": "Engram: senkronize ediliyor",
	"Engram: syncing ({count})": "Engram: senkronize ediliyor ({count})",
	"Engram: this plugin is too old to sync (needs {version} or newer). Update it to continue.":
		"Engram: Bu eklenti senkronizasyon için çok eski (en az {version} veya daha yeni gerekiyor). Devam etmek için güncelleyin.",
	"Engram: this plugin is too old to sync. Update it to continue.":
		"Engram: Bu eklenti senkronizasyon için çok eski. Devam etmek için güncelleyin.",
	"Engram: this vault no longer exists on the server. Pick or create a vault to continue.":
		"Engram: bu kasa artık sunucuda bulunmuyor. Devam etmek için bir kasa seçin veya oluşturun.",
	"Engram: update required": "Engram: güncelleme gerekiyor",
	"Engram: your login expired — open Engram settings to reconnect.":
		"Engram: oturum açma süreniz doldu — yeniden bağlanmak için Engram ayarlarını açın.",
	"Engram: {count} attachments skipped — upgrade your plan to sync images & PDFs.": {
		one: "Engram: {count} ek atlandı — resim ve PDF'leri senkronize etmek için planınızı yükseltin.",
		other: "Engram: {count} ek atlandı — resim ve PDF'leri senkronize etmek için planınızı yükseltin.",
	},
	"Engram: {count} files failed to sync{detail} — open Sync Center": {
		one: "Engram: {count} dosya senkronize edilemedi{detail} — Senkronizasyon Merkezi'ni aç",
		other: "Engram: {count} dosya senkronize edilemedi{detail} — Senkronizasyon Merkezi'ni aç",
	},
	"Engram: {count} notes have frontmatter problems. Open Sync Center to fix.": {
		one: "Engram: {count} notta başlık sorunları var. Düzeltmek için Senkronizasyon Merkezi'ni açın.",
		other: "Engram: {count} notta başlık sorunları var. Düzeltmek için Senkronizasyon Merkezi'ni açın.",
	},
	"Engram: ⚠ {count} sync errors": {
		one: "Engram: ⚠ {count} senkronizasyon hatası",
		other: "Engram: ⚠ {count} senkronizasyon hatası",
	},
	"Enter a name for the new vault": "Yeni kasa için bir ad girin",
	"Enter an API key first": "Öncelikle bir API anahtarı girin",
	Error: "Hata",
	"Error: {error}": "Hata: {error}",
	"Errors only": "Sadece hatalar",
	"Everything is in sync": "Her şey senkronize",
	"Failed to start device flow. Check your Engram URL and try again.":
		"Cihaz bağlantısı başlatılamadı. Engram URL'nizi kontrol edin ve tekrar deneyin.",
	"Failed to switch vault: {error}": "Kasa değiştirme işlemi başarısız oldu: {error}",
	"File exceeds the {limit} limit": "Dosya {limit} sınırını aştı",
	"File not found locally: {path}": "Dosya yerel olarak bulunamadı: {path}",
	"File too large for your plan.": "Dosya, aboneliğiniz için çok büyük.",
	"File type not accepted": "Dosya türü kabul edilmiyor",
	"Files that will be deleted:": "Silinecek dosyalar:",
	"Filter by folder…": "Klasöre göre filtrele…",
	"Filter by tags…": "Etiketlere göre filtrele…",
	"Finish setting up your account at app.engram.page to start syncing.":
		"Senkronizasyonu başlatmak için app.engram.page adresindeki hesabınızı tamamlayın.",
	"Finish sync setup": "Senkronizasyon kurulumunu tamamla",
	"Finished with some errors. Open the sync log to see what failed.":
		"Bazı hatalarla tamamlandı. Hangi işlemlerin başarısız olduğunu görmek için senkronizasyon günlüğünü açın.",
	"First sync, this may take a moment.": "İlk senkronizasyon, bu biraz zaman alabilir.",
	Free: "Ücretsiz",
	"Free syncs notes only — images & PDFs need a paid plan.":
		"Ücretsiz senkronizasyon sadece notlar için geçerlidir — resimler ve PDF'ler için ücretli bir plan gereklidir.",
	"Free syncs notes only — {count} attachments will be skipped.": {
		one: "Ücretsiz sürümde sadece notlar senkronize edilir — {count} ek atlanır.",
		other: "Ücretsiz sürümde sadece notlar senkronize edilir — {count} ek dosya atlanır.",
	},
	"Frontmatter could not be parsed": "Başlık bölümü işlenemedi",
	"Frontmatter isn't valid YAML.": "Ön bilgi geçerli bir YAML değil.",
	'Frontmatter key "{key}" could not be parsed as YAML.':
		'Ön bilgi anahtarı "{key}" YAML olarak çözülemedi.',
	"Frontmatter needs a fix": "Başlık bölümünde düzeltme gerekiyor",
	"Generate new code": "Yeni kod oluştur",
	"Generic cache directory": "Genel önbellek dizini",
	"Getting set up": "Kurulum",
	"Getting started…": "Başlangıç...",
	"GitHub Sponsors": "GitHub Sponsorlar",
	"Gradle build cache": "Gradle derleme önbelleği",
	"How do you feel about Engram?": "Engram hakkında ne düşünüyorsunuz?",
	Idea: "Öneri",
	"If this plugin saves you time, consider supporting development.":
		"Bu eklenti size zaman kazandırıyorsa, lütfen geliştirmeye destek verin.",
	Ignore: "Yoksay",
	"Ignore patterns": "Yoksayılacak kalıplar",
	"Ignored ({count})": "Yoksayıldı ({count})",
	"Ignored {path} — won't sync until restored from Sync Center.":
		"{path} yoksayıldı — Senkronizasyon Merkezi'nden geri yüklenene kadar senkronize edilmeyecek.",
	"Info (default)": "Bilgi (varsayılan)",
	"Invalid API key": "Geçersiz API anahtarı",
	"It's OK to email me about this": "Bu konuyla ilgili bana e-posta gönderebilirsiniz",
	"Join our Discord": "Discord'umuza katılın",
	Keyword: "Anahtar kelime",
	"Last sync: {when}": "Son senkronizasyon: {when}",
	"Learn more": "Daha fazla bilgi edinin",
	"License: {name}": "Lisans: {name}",
	"Limit reached. Upgrade to continue.": "Limit aşıldı. Devam etmek için yükseltin.",
	"Link Claude, Cursor, ChatGPT, or any MCP app so it can read and write your notes. ":
		"Claude, Cursor, ChatGPT veya herhangi bir MCP uygulamasını bağlayın, böylece notlarınızı okuyup yazabilir. ",
	"Link Obsidian to Engram": "Obsidian ile Engram arasında bağlantı kur",
	"Loading vaults…": "Kasalar yükleniyor…",
	"Love it": "Çok beğendim",
	"Make new vault": "Yeni kasa oluştur",
	"Manage account": "Hesap yönetimi",
	"Minimum severity that ships while diagnostics are on. Higher levels send fewer lines. Default: Info.":
		"Tanı açıkken gönderilecek minimum önem düzeyi. Daha yüksek seviyeler daha az satır gönderir. Varsayılan: Bilgi.",
	"Missing on the server": "Sunucuda eksik",
	"Needs attention ({count})": "Dikkat gerektiriyor ({count})",
	"Network unavailable": "Ağ bağlantısı yok",
	"New here? Watch the setup video": "Yeni misiniz? Kurulum videosunu izleyin",
	"New vault": "Yeni kasa",
	"Next.js build output": "Next.js derleme çıktıları",
	"No activity yet. Push or pull to see entries here.":
		"Henüz bir etkinlik yok. Girişleri görmek için gönder veya al.",
	"No files ignored. Use the ignore button on a failure row to stop syncing it.":
		"Hiçbir dosya yoksayılmadı. Senkronizasyonu durdurmak için bir hata satırındaki yoksay düğmesini kullanın.",
	"No other vaults available.": "Başka kasalar mevcut değil.",
	"No results found": "Sonuç bulunamadı",
	"No source path for this result": "Bu sonuç için kaynak yolu yok",
	"No sync activity this session.": "Bu oturumda herhangi bir senkronizasyon etkinliği yok.",
	"No vaults found — first sync will create one":
		"Kasa bulunamadı — ilk senkronizasyon bir kasa oluşturacaktır",
	"Node.js dependencies": "Node.js bağımlılıkları",
	"Not configured": "Yapılandırılmamış",
	"Not connected yet. Click to open settings and link this vault.":
		"Henüz bağlanmadı. Ayarları açmak ve bu kasayı bağlamak için tıklayın.",
	"Not connected. Enter your Engram server URL below to start syncing.":
		"Bağlı değil. Senkronizasyonu başlatmak için Engram sunucu URL'nizi aşağıya girin.",
	"Not now": "Şimdilik değil",
	"Not signed in, or the session expired. Sign in again in Engram settings.":
		"Giriş yapılmamış veya oturum sona ermiş. Engram ayarlarından tekrar giriş yapın.",
	"Not signed in. Click to open settings and reconnect.":
		"Giriş yapılmadı. Ayarları açmak ve yeniden bağlanmak için tıklayın.",
	"Not synced on your plan ({count})": "Planınızda senkronize edilmiyor ({count})",
	"Not syncing: this plugin version is too old (needs {version} or newer). Click to update.":
		"Senkronizasyon yok: Bu eklenti sürümü çok eski (en az {version} veya daha yeni gerekiyor). Güncellemek için tıklayın.",
	"Not syncing: this plugin version is too old. Click to update.":
		"Senkronizasyon yok: Bu eklenti sürümü çok eski. Güncellemek için tıklayın.",
	"Note couldn't be processed": "Not işlenemedi",
	"Note limit reached. Upgrade to keep adding notes.":
		"Not sayısı limiti aşıldı. Daha fazla not eklemek için yükseltin.",
	"Note not synced locally": "Not yerel olarak senkronize edilmedi",
	"Notes on this device": "Bu cihazdaki notlar",
	"Notes past this still sync and open normally, they are just not in the search index. The index keeps your oldest notes, so it is your newest ones that fall outside.":
		"Buradan sonraki notlar hala normal şekilde senkronize olur ve açılır, sadece arama indeksinde yer almazlar. İndeks en eski notlarınızı saklar, bu yüzden en yeni notlarınız indeksin dışında kalır.",
	"Notes searchable": "Notlar aranabilir",
	"Notes stored": "Notlar kaydedildi",
	"Nothing in this vault syncs until you choose how to merge it with the server.":
		"Bu kasadaki hiçbir şey, sunucuyla nasıl birleştirileceğine karar vermediğiniz sürece senkronize olmaz.",
	"Nothing is deleted.": "Hiçbir şey silinmez.",
	"Nothing needs your attention. 🎉": "Herhangi bir şeye dikkat etmeniz gerekmiyor. 🎉",
	"Nothing to sync yet — this vault is empty on both sides. Start syncing and everything you write appears on your other devices.":
		"Henüz senkronize edilecek bir şey yok — bu kasa her iki tarafta da boş. Senkronizasyonu başlatın ve yazdığınız her şey diğer cihazlarınızda görünecek.",
	"Nothing to sync yet: every file here is on your ignore list. Start syncing and everything you write appears on your other devices.":
		"Henüz senkronize edilecek veri yok: Buradaki tüm dosyalar yoksayma listenizde. Senkronizasyonu başlatın ve yazdığınız her şey diğer cihazlarınızda görünecek.",
	"Nothing will be deleted.": "Herhangi bir veri silinmeyecek.",
	"Nothing will be removed from this device.": "Bu cihazdan hiçbir şey silinmeyecek.",
	Open: "Aç",
	"Open Connection": "Bağlantıyı Aç",
	"Open Engram": "Engram uygulamasını açın",
	"Open Engram settings": "Engram ayarlarını aç",
	"Open Engram to check your vault and confirm everything synced.":
		"Her şeyin senkronize olduğundan emin olmak için Engram uygulamasını açın.",
	"Open connection tab": "Bağlantı sekmesini aç",
	"Open note": "Notu aç",
	"Open search sidebar": "Arama yan panelini aç",
	"Open sync center": "Senkronizasyon merkezini aç",
	"Open sync setup": "Senkronizasyon ayarlarını aç",
	"Open the file to resolve the conflict, then sync again.":
		"Çakışmayı çözmek için dosyayı açın, ardından tekrar senkronize edin.",
	"Opens your browser to sign in, or create an account if you don't have one yet, then links this vault.":
		"Tarayıcınızı açarak giriş yapın veya henüz bir hesabınız yoksa oluşturun, ardından bu kasayı bağlayın.",
	"Or authenticate with a token instead of signing in.":
		"Veya giriş yapmak yerine bir token ile kimlik doğrulayın.",
	"Or authenticate with a token instead of signing in. Engram Cloud API keys require the Pro plan; on Free and Starter, sign in above.":
		"Veya giriş yapmak yerine bir token ile kimlik doğrulayın. Engram Cloud API anahtarları, Pro planını gerektirir; Ücretsiz ve Starter planlarında yukarıdaki giriş yöntemini kullanın.",
	"Paths to skip (one per line). Folder patterns end with /. Built-in: {configDir}/, .trash/, .git/":
		"Atlanacak yollar (her satırda bir tane). Klasör kalıpları / ile biter. Dahili: {configDir}/, .trash/, .git/",
	"Pick a vault": "Bir kasa seçin",
	"Pick a vault (previous: '{name}' not found)": "Bir kasa seçin (önceki: '{name}' bulunamadı)",
	"Pick a vault (previous: id {id} not found)": "Bir kasa seçin (önceki: kimlik {id} bulunamadı)",
	"Pick a vault to sync with. We will recalculate the sync preview after you choose.":
		"Senkronize edilecek bir kasa seçin. Seçiminizden sonra senkronizasyon önizlemesini yeniden hesaplayacağız.",
	"Plan usage": "Kullanım planı",
	Plans: "Planlar",
	"Privacy Policy": "Gizlilik Politikası",
	Pro: "Pro",
	"Pull all (delete extras) aborted: could not obtain an exclusive server snapshot (replay contention). Nothing was trashed.":
		"Tüm notları çekme işlemi iptal edildi: özel bir sunucu kopyası alınamadı (çakışma). Hiçbir şey silinmedi.",
	"Pull all aborted: another sync is running (replay contention). Try again when it finishes.":
		"Tüm notları çekme işlemi iptal edildi: başka bir senkronizasyon çalışıyor (çakışma). İşlemin bitmesini bekleyin ve tekrar deneyin.",
	"Pull all failed: {error}": "Tüm notları çekme işlemi başarısız oldu: {error}",
	"Pull all from server (force overwrite)": "Sunucudan her şeyi indir (zorla üzerine yaz)",
	Pulled: "Alındı",
	"Push entire vault": "Tüm kasayı gönder",
	Pushed: "Gönderildi",
	"Python bytecode cache": "Python bayt kodu önbelleği",
	"Python virtual environment": "Python sanal ortamı",
	"Read it": "Okuyun",
	"Real-time sync": "Gerçek zamanlı senkronizasyon",
	"Reconnect your account to resume syncing.":
		"Senkronizasyonu devam ettirmek için hesabınızı yeniden bağlayın.",
	Refresh: "Yenile",
	"Remote vault": "Uzak kasa",
	"Remove tag {tag}": "Etiketi {tag} kaldır",
	"Replacing the remote stopped early: the ignore list changed during sync. Some remote notes were not removed; run it again.":
		"Uzak sunucuyla senkronizasyon erken durdu: Yoksama listesi senkronizasyon sırasında değişti. Bazı uzak notlar silinmedi; tekrar deneyin.",
	"Report an issue": "Bir sorun bildirin",
	"Report an issue on GitHub": "GitHub üzerinde bir sorun bildirin",
	"Request failed ({status})": "İstek başarısız oldu ({status})",
	Restore: "Geri yükle",
	"Restored {path} — will sync on next push.":
		"{path} geri yüklendi — Bir sonraki senkronizasyonda senkronize edilecek.",
	"Retry all now": "Tümünü şimdi tekrar dene",
	"Retrying automatically ({count})": "Otomatik olarak tekrar deniyor ({count})",
	"Review and accept": "Gözden geçirin ve kabul edin",
	"Run in background": "Arka planda çalıştır",
	"Run your own Engram server": "Kendi Engram sunucunuzu çalıştırın",
	"Rust/Java build output": "Rust/Java derleme çıktıları",
	"Safe choice: combines both sides, nothing is deleted.":
		"Güvenli seçenek: Her iki tarafı da birleştirir, hiçbir şey silinmez.",
	Save: "Kaydet",
	"Search across all vaults at once": "Tüm kasalarda eşzamanlı arama yapın",
	"Search all your notes": "Tüm notlarınızı arayın",
	"Search failed — check connection": "Arama başarısız oldu — bağlantıyı kontrol edin",
	"Search settings": "Arama ayarları",
	"Search your vault…": "Kasanızı arayın…",
	"Searching {indexed} of {all} notes. Upgrade to search everything.":
		"{all} notunuzun içinden {indexed} tanesini arıyor. Her şeyi aramak için yükseltin.",
	"See full pricing": "Fiyatlandırma bilgilerini görün",
	"See the AI setup guide": "Yapay zeka kurulum kılavuzuna bakın",
	"Select which vault this plugin syncs with.":
		"Bu eklentinin hangi kasa ile senkronize olacağını seçin.",
	"Self-hosted": "Kendi sunucunuzda barındırılan",
	Semantic: "Anlamsal",
	"Semantic search": "Anlamsal arama",
	Send: "Gönder",
	"Send debug logs. Note content stays private.":
		"Hata ayıklama günlüklerini gönderin. Not içeriği gizli kalır.",
	"Send detailed sync, vault, and connection activity to the server for troubleshooting, with distributed tracing on requests. Metadata only, never note content. Leave off for normal use.":
		"Sorun giderme için, ayrıntılı senkronizasyon, kasa ve bağlantı bilgilerini dağıtık izleme ile birlikte sunucuya gönderin. Sadece meta veriler, asla not içeriği gönderilmez. Normal kullanım için bu seçeneği kapatın.",
	"Send feedback": "Geri bildirim gönder",
	"Sending…": "Gönderiliyor…",
	"Server error": "Sunucu hatası",
	"Server error ({status}) — check Engram logs":
		"Sunucu hatası ({status}) — Engram günlüklerini kontrol edin",
	"Server unreachable — changes will sync when connected":
		"Sunucuya ulaşılamıyor — bağlantı sağlandığında değişiklikler senkronize olacak",
	"Set up sync for this vault": "Bu kasa için senkronizasyonu ayarlayın",
	"Setup is not finished — nothing will sync until you choose a sync direction. Click to finish.":
		"Kurulum tamamlanmadı — bir senkronizasyon yönü seçene kadar hiçbir şey senkronize olmayacak. Tamamlamak için tıklayın.",
	"Show files ({count}) ▾": "Dosyaları göster ({count}) ▾",
	"Show sync log": "Senkronizasyon günlüğünü göster",
	"Showing {count} entries": {
		one: "{count} kayıt gösteriliyor",
		other: "{count} kayıt gösteriliyor",
	},
	"Sign in": "Giriş yapın",
	"Sign in (or enter your server URL and key) on the connection tab, then run your first sync.":
		"Bağlantı sekmesinde oturum açın (veya sunucu URL'nizi ve anahtarınızı girin), ardından ilk senkronizasyonunuzu başlatın.",
	"Sign in or create an account": "Giriş yap veya bir hesap oluştur",
	"Sign out": "Çıkış yap",
	"Sign-in expired": "Oturum sona erdi",
	"Sign-in required to load vaults": "Kasaları yüklemek için giriş yapmanız gerekir",
	"Signed in as {email}": "{email} olarak giriş yapıldı",
	Skipped: "Atlandı",
	"Source: {link}": "Kaynak: {link}",
	"Start syncing": "Senkronizasyonu başlat",
	Starter: "Starter",
	"Starting...": "Başlangıç...",
	Stats: "İstatistikler",
	"Support development": "Geliştirmeye destek verin",
	"Switch to sign in": "Giriş yap seçeneğine geç",
	"Switch vault": "Kasa değiştir",
	"Switched to {mode}.": "{mode} konumuna geçildi.",
	Sync: "Senkronizasyon",
	"Sync complete": "Senkronizasyon tamamlandı",
	"Sync failed": "Senkronizasyon başarısız oldu",
	"Sync in progress...": "Senkronizasyon devam ediyor...",
	"Sync log": "Senkronizasyon günlüğü",
	"Sync now": "Şimdi senkronize et",
	"Sync paused — click to choose a sync direction":
		"Senkronizasyon durduruldu — bir senkronizasyon yönü seçmek için tıklayın",
	"Sync preview": "Senkronizasyon önizlemesi",
	"Sync server": "Senkronizasyon sunucusu",
	"Sync these now": "Şimdi senkronize et",
	"Sync...": "Senkronize ediliyor...",
	"Synced. Some attachments need a paid plan to sync (see below).":
		"Senkronizasyon tamamlandı. Bazı eklerin senkronizasyonu için ücretli bir plan gerekebilir (aşağıya bakın).",
	"Syncing attachments": "Eklerin senkronizasyonu",
	"Syncing your vault": "Kasanızın senkronizasyonu",
	"Syncing...": "Senkronizasyon yapılıyor...",
	"Syncing…": "Senkronize ediliyor...",
	"Tell us anything": "Herhangi bir şey anlatabilirsiniz",
	"Temporary errors. These clear themselves once the server recovers.":
		"Geçici hatalar. Sunucu normale döndüğünde bunlar kendiliğinden düzelecektir.",
	"Terms of Service": "Hizmet Şartları",
	"Thanks, we read every message.": "Teşekkür ederiz, tüm mesajları okuyoruz.",
	"That does not look like a complete server address. Include the scheme, for example http://127.0.0.1:4000":
		"Bu, eksik bir sunucu adresi gibi görünüyor. Şemayı da dahil edin, örneğin http://127.0.0.1:4000",
	"That does not look like an Engram API key (expected {prefix}…).":
		"Bu, bir Engram API anahtarı gibi görünmüyor (beklenen {prefix}…).",
	"The Engram server no longer accepts this plugin version (it needs {version} or newer), so notes are not being sent or received. Changes made on this device stay here until you update.":
		"Engram sunucusu artık bu eklenti sürümünü kabul etmiyor (şu anda {version} veya daha yeni bir sürüm gerekiyor), bu nedenle notlar gönderilmiyor veya alınmıyor. Bu cihazda yapılan değişiklikler, güncelleyene kadar burada kalacak.",
	"The Engram server no longer accepts this plugin version, so notes are not being sent or received. Changes made on this device stay here until you update.":
		"Engram sunucusu artık bu eklenti sürümünü kabul etmiyor, bu nedenle notlar gönderilmiyor veya alınmıyor. Bu cihazda yapılan değişiklikler, güncelleyene kadar burada kalacak.",
	"The Free tier syncs notes only. Upgrade to sync images and PDFs.":
		"Ücretsiz planda sadece notlar senkronize edilir. Resimleri ve PDF'leri senkronize etmek için yükseltin.",
	"The file is over the server's size limit. Compress or split it, then it will sync.":
		"Dosya, sunucunun boyut sınırını aştı. Sıkıştırın veya bölün, sonra senkronize olur.",
	"The file is too large for the server.": "Dosya, sunucu için çok büyük.",
	"The note synced, but its frontmatter could not be fully parsed. Open it to fix the highlighted line.":
		"Not senkronize edildi, ancak başlık bölümü tamamen işlenemedi. Vurgulanan satırı düzeltmek için açın.",
	"The server couldn't process this note. Check its contents, then edit and save to try again.":
		"Sunucu bu notu işleyemedi. İçeriğini kontrol edin, düzenleyin ve tekrar denemek için kaydedin.",
	"The server does not accept this type of file. It will retry if the file changes.":
		"Sunucu bu tür dosyaları kabul etmiyor. Dosya değişirse tekrar denenecek.",
	"The server lost this file's stored content and will try to restore it. Nothing on this device was changed.":
		"Sunucu bu dosyanın içeriğini kaybetti ve geri yüklemeyi deneyecek. Bu cihazda hiçbir değişiklik yapılmadı.",
	"The server took too long to respond. Try again.":
		"Sunucu yanıt vermekte çok yavaş. Lütfen tekrar deneyin.",
	"These files are fine. They just need a paid plan to sync.":
		"Bu dosyalar sorunsuz. Sadece senkronize olmak için ücretli bir plana ihtiyaçları var.",
	"This account was deleted. Contact support if that is wrong.":
		"Bu hesap silindi. Yanlışsa destekle iletişime geçin.",
	"This cannot be undone.": "Bu geri alınamaz.",
	"This code expired before the link finished. Generate a new code to try again.":
		"Bu kod, bağlantı tamamlanmadan doldu. Lütfen tekrar denemek için yeni bir kod oluşturun.",
	"This device's vault is empty. Download {what} from the server?":
		"Bu cihazın kasası boş. Sunucudan {what} dosyasını indirmek ister misiniz?",
	"This file type isn't accepted by this server.":
		"Bu dosya türü bu sunucu tarafından kabul edilmiyor.",
	"This note could not be processed and was skipped.": "Bu not işlenemedi ve atlandı.",
	"This server is self-hosted, so feedback is not collected here. ":
		"Bu sunucu kendi kendine barındırıldığı için geri bildirim burada toplanmaz. ",
	"This vault": "Bu kasa",
	"This vault is empty on the server. Upload your {what}?":
		"Bu kasa sunucuda boş. {what} dosyanızı yüklemek ister misiniz?",
	"Too large for the server": "Sunucu için çok büyük",
	"Too many connected AI clients. Disconnect one or upgrade.":
		"Bağlı çok fazla yapay zeka istemcisi var. Birini ayırın veya yükseltin.",
	"Too many connected Obsidian vaults. Disconnect one or upgrade.":
		"Bağlı çok fazla Obsidian kasa var. Birini ayırın veya yükseltin.",
	"Too many requests. Wait a moment and try again.":
		"Çok fazla istek. Bir süre bekleyin ve tekrar deneyin.",
	"Type {keyword} to confirm:": "Onaylamak için {keyword} yazın:",
	"Unknown error": "Bilinmeyen hata",
	"Unlimited AI searches": "Sınırsız yapay zeka araması",
	"Unlimited vaults": "Sınırsız kasa",
	"Unresolved conflict": "Çözülemeyen çakışma",
	Untitled: "Başlık yok",
	Update: "Güncelle",
	"Update in settings": "Ayarlardan güncelleyin",
	"Update required, not syncing": "Güncelleme gerekiyor, senkronizasyon yok",
	"Update required: Engram is not syncing": "Güncelleme gerekiyor: Engram senkronize değil",
	Upgrade: "Yükselt",
	"Upload everything": "Her şeyi yükle",
	"Upload local files without downloading the remote":
		"Uzaktaki dosyaları indirmeden yerel dosyaları yükleyin",
	"Upload {count} files from this vault": {
		one: "Bu kasadan {count} dosya yükle",
		other: "Bu kasadan {count} dosya yükle",
	},
	Uploading: "Yükleme",
	"Uploading {count}.": { one: "Yükleniyor {count}.", other: "Yükleniyor {count}." },
	"Uploads {up}, downloads {down}.": "Yüklemeler: {up}, İndirmeler: {down}.",
	"Using API key": "API anahtarı kullanılıyor",
	Vault: "Kasa",
	"Vault ID: {id}": "Kasa kimliği: {id}",
	"Vault limit reached. Upgrade for more vaults.":
		"Kasa sayısı limiti aşıldı. Daha fazla kasa için yükseltin.",
	"Vault name": "Kasa adı",
	"Vault selection": "Kasa seçimi",
	"Vendored dependencies": "Dahili bağımlılıklar",
	"Version: {version}": "Sürüm: {version}",
	"Waiting for authorization — connected, this will complete instantly.":
		"Yetkilendirme bekleniyor — Bağlandı, bu işlem anında tamamlanacak.",
	"Waiting for authorization — no live connection, checking every 30s.":
		"Yetkilendirme bekleniyor — canlı bağlantı yok, her 30 saniyede bir kontrol ediliyor.",
	"Warnings and errors": "Uyarılar ve hatalar",
	"WebSocket connected — live sync active": "WebSocket bağlantısı — canlı senkronizasyon aktif",
	"What Engram does, and how to connect your vault, start to finish.":
		"Engram'ın ne yaptığı ve kasanızı nasıl bağlayacağınız, baştan sona.",
	"What kind of feedback?": "Ne tür bir geri bildirim?",
	"What's working, what's frustrating, what do you wish Engram did?":
		"Neler iyi, neler can sıkıcı, Engram'ın ne yapmasını istersiniz?",
	"Where this vault syncs to. Each backend keeps its own sign-in.":
		"Bu kasanın senkronize edildiği yer. Her arka uç kendi giriş bilgilerini kullanır.",
	"Will download {count} files.": {
		one: "{count} dosya indirilecektir.",
		other: "{count} dosya indirilecektir.",
	},
	"Will upload {count} files.": {
		one: "{count} dosya yüklenecek.",
		other: "{count} dosya yüklenecek.",
	},
	"You are about to:": "Aşağıdakileri yapacaksınız:",
	"You are now pointing at a different cloud vault":
		"Şu anda farklı bir bulut kasasına yönlendiriliyorsunuz",
	"You can close this and the sync keeps running in the background.":
		"Bu pencereyi kapatabilirsiniz, senkronizasyon arka planda devam eder.",
	"You've used all the attachment storage on your plan. Upgrade for more.":
		"Planınızdaki tüm ek depolama alanını kullandınız. Daha fazla için yükseltin.",
	"Your code:": "Kodunuz:",
	"Your feedback": "Geri bildiriminiz",
	"Your login expired. Sign in again in Engram settings to continue.":
		"Girişiniz sona erdi. Devam etmek için Engram ayarlarından tekrar giriş yapın.",
	"Your plan's file limit is {limit}. Compress or split the file, then it will sync.":
		"Planınızın dosya sınırı {limit}. Dosyayı sıkıştırın veya bölün, sonra senkronize olur.",
	"Your vault shares {percent} of its data with Engram":
		"Kasanızın verilerinin {percent} kısmı Engram ile paylaşılıyor",
	attachments: "Ekler",
	exact: "tam olarak",
	files: "dosyalar",
	folders: "Klasörler",
	"match strength: {pct}%": "eşleşme gücü: {pct}%",
	"matches meaning. Finds notes that never use the words you typed.":
		"Anlamı bulur. Yazdığınız kelimeleri hiç kullanmayan notları bulur.",
	"matches words and meaning together, plus this device. Widest results.":
		"Hem kelimeleri hem de anlamı birlikte bulur, ayrıca bu cihazı. En geniş sonuçları verir.",
	"matches your words and their other forms — 'run' finds 'running' — plus this device.":
		"Yazdığınız kelimeleri ve diğer formlarını bulur — 'run' kelimesi 'running' kelimesini de bulur — ayrıca bu cihazı.",
	meaning: "anlamı",
	"meaning + exact": "anlamı + tam olarak",
	"not linked": "Bağlı değil",
	notes: "notlar",
	"setup guide": "Kurulum kılavuzu",
	"sync is paused": "Senkronizasyon durduruldu",
	"syncing now": "Şu anda senkronize ediliyor",
	unknown: "bilinmeyen",
	"waiting for a connection": "Bağlantı bekleniyor",
	"waiting for a plugin update": "Eklenti güncellemesini bekliyor",
	"waiting to retry": "Yeniden denemeyi bekliyor",
	"{count} attachments": { one: "{count} ek", other: "{count} ek" },
	"{count} attachments need a paid plan to sync. See Sync Center.": {
		one: "{count} ek, senkronize olmak için ücretli bir plana ihtiyaç duyar. Senkronizasyon Merkezi'ni inceleyin.",
		other: "{count} ek, senkronize olmak için ücretli bir plana ihtiyaç duyar. Senkronizasyon Merkezi'ne bakın.",
	},
	"{count} attempts": { one: "{count} deneme", other: "{count} deneme" },
	"{count} conflicts need resolution": {
		one: "{count} çakışma çözülmeyi bekliyor",
		other: "{count} çakışma çözülmeyi bekliyor",
	},
	"{count} conflicts to resolve.": {
		one: "Çözülmesi gereken {count} çakışma var.",
		other: "Çözülmesi gereken {count} çakışma var.",
	},
	"{count} diverged": { one: "{count} farklılaştı", other: "{count} farklılaştı" },
	'{count} failed. Run "{command}" for details.': {
		one: '{count} başarısız oldu. Detaylar için "{command}"\'ı çalıştırın.',
		other: '{count} başarısız. Detaylar için "{command}"\'ı çalıştırın.',
	},
	"{count} files": { one: "{count} dosya", other: "{count} dosya" },
	"{count} files not included in your plan": {
		one: "Planınızda olmayan {count} dosya",
		other: "Planınızda yer almayan {count} dosya",
	},
	"{count} files queued": {
		one: "{count} dosya kuyruğa alındı",
		other: "{count} dosya kuyruğa alındı",
	},
	"{count} ignored": { one: "{count} tane yoksayıldı", other: "{count} tane yoksayıldı" },
	"{count} missing on server": {
		one: "{count} tanesi sunucuda eksik",
		other: "Sunucuda {count} eksik",
	},
	"{count} need attention": {
		one: "{count} tane işlem gerekiyor",
		other: "{count} işlem gerektiriyor",
	},
	"{count} notes": { one: "{count} not", other: "{count} not" },
	"{count} only on server": { one: "{count}. Sadece sunucuda", other: "{count} sadece sunucuda" },
	"{count} queued — {reason}": {
		one: "{count} sırada bekliyor — {reason}",
		other: "{count} sırada bekliyor — {reason}",
	},
	"{count} retrying": { one: "{count} tekrar deneniyor", other: "{count} tekrar deneniyor" },
	"{desc} — should not be synced": "{desc} — senkronize edilmemeli",
	"{first} and {second}": "{first} ve {second}",
	"{formatted} per day": "{formatted} günde",
	"{label} ({count} queued)": {
		one: "{label} ({count} sırada)",
		other: "{label} ({count} sırada)",
	},
	"{n} of 5": "5'in {n}",
	"▶ Watch on YouTube": "▶ YouTube'da izle",
	"⚙️ Advanced": "⚙️ Gelişmiş Ayarlar",
	"⚠ Detected: {label}/ ({formatted} files)": "⚠ Tespit edildi: {label}/ ({formatted} dosya)",
	"✓ Engram server reachable (v{version})": "✓ Engram sunucusuna ulaşılabiliyor (v{version})",
	"✓ {count} synced": {
		one: "✓ {count} senkronize edildi",
		other: "✓ {count} senkronize edildi",
	},
	"✕ {count} failed": { one: "✕ {count} başarısız", other: "✕ {count} başarısız" },
	"✗ couldn't reach a server at this URL": "✗ Bu URL'deki bir sunucuya ulaşılamadı",
	"✗ server responded but isn't an Engram server":
		"✗ Sunucu yanıt verdi ancak bir Engram sunucusu değil",
	"⤳ {count} skipped (Free plan)": {
		one: "⤳ {count} atlandı (Ücretsiz plan)",
		other: "⤳ {count} atlandı (Ücretsiz plan)",
	},
	"👋 Welcome": "👋 Hoş geldiniz",
	"💬 Feedback": "💬 Geri bildirim",
	"🔄 Sync Center": "🔄 Senkronizasyon Merkezi",
	"🔌 Connection": "🔌 Bağlantı",
};

export default tr;
