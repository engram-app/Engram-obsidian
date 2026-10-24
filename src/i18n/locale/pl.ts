import type { Dict } from "..";

// Polski
const pl: Dict = {
	" (default)": " (domyślny)",
	"({count} errors)": {
		one: "({count} błąd)",
		few: "({count} błędy)",
		many: "({count} błędów)",
		other: "({count} błędów)",
	},
	"...": "...",
	'... "{name}" ...': '... "{name}" ...',
	"1 vault, 2 devices": "1 sejf, 2 urządzenia",
	"1. Make an account": "1. Załóż konto",
	"10 GB attachments": "10 GB załączników",
	"10 vaults, unlimited devices": "10 sejfów, nieograniczona liczba urządzeń",
	"2,000 notes searchable": "2000 notatek do wyszukiwania",
	"2. Connect your vault to Engram": "2. Połącz swój sejf z Engram",
	"3. Connect your AI": "3. Połącz swoje AI",
	"50 GB attachments": "50 GB załączników",
	"A browser window has opened. Sign in and enter this code to link your vault.":
		"Otwarto okno przeglądarki. Zaloguj się i wprowadź ten kod, aby połączyć swój sejf.",
	"A frontmatter key could not be parsed as YAML.":
		"Nie można zinterpretować klucza nagłówka jako YAML.",
	"A temporary server problem — retrying automatically.":
		"Tymczasowy problem z serwerem — ponawiam próbę automatycznie.",
	"AI / MCP setup guide": "Przewodnik konfiguracji AI / MCP",
	"AI searches": "Wyszukiwanie AI",
	"API access": "Dostęp do API",
	"API key": "Klucz API",
	"API keys need a Pro plan. Sign in with your Engram account instead.":
		"Klucze API wymagają planu Pro. Zaloguj się za pomocą swojego konta Engram.",
	About: "O programie",
	"Accept it to keep syncing.": "Zaakceptuj, aby kontynuować synchronizację.",
	"Access token": "Token dostępu",
	"Account setup incomplete.": "Konfiguracja konta nie została ukończona.",
	"Account suspended. Contact support.":
		"Konto zawieszone. Skontaktuj się z działem pomocy technicznej.",
	"Activity ({count})": "Aktywność ({count})",
	"Add to ignores": "Dodaj do ignorowanych",
	"Added {pattern} to ignore patterns": "Dodano {pattern} do ignorowanych wzorców",
	"Advanced sync options": "Zaawansowane opcje synchronizacji",
	"All synced. Your vault and the cloud now match.":
		"Wszystko zsynchronizowane. Twój sejf i chmura są teraz zsynchronizowane.",
	"Already in sync. Nothing is deleted.": "Już zsynchronizowane. Nic nie jest usuwane.",
	"Already signed in on another device. Upgrade for multi-device.":
		"Jesteś już zalogowany na innym urządzeniu. Zaktualizuj, aby korzystać z wielu urządzeń.",
	"Already up to date. Nothing needed syncing.": "Już aktualne. Nie wymaga synchronizacji.",
	"An unexpected error — retrying automatically.":
		"Nieoczekiwany błąd — ponawiam próbę automatycznie.",
	"Attachment storage full": "Brak miejsca na przechowywanie załączników",
	"Attachment storage is full — upgrade for more.":
		"Przestrzeń do przechowywania załączników jest pełna — zaktualizuj, aby mieć więcej miejsca.",
	"Attachment sync is disabled for this account.":
		"Synchronizacja załączników jest wyłączona dla tego konta.",
	Attachments: "Załączniki",
	"Attachments need a paid plan": "Załączniki wymagają płatnego planu",
	"Attachments on this device": "Załączniki na tym urządzeniu",
	"Authenticated via Engram account (OAuth).": "Uwierzytelnienie za pomocą konta Engram (OAuth).",
	"Authenticated via manual API key.": "Uwierzytelnienie za pomocą ręcznego klucza API.",
	Authentication: "Uwierzytelnianie",
	Back: "Wstecz",
	"Bearer token from your Engram account.": "Token uwierzytelniający z Twojego konta Engram.",
	Both: "Oba",
	Bug: "Błąd",
	"Build output": "Wynik kompilacji",
	"Can't reach the server — retrying automatically.":
		"Nie można połączyć się z serwerem — ponawiam próbę automatycznie.",
	Cancel: "Anuluj",
	"Cargo cache": "Pamięć podręczna Cargo",
	Change: "Zmień",
	"Change vault": "Zmień sejf",
	"Check sync status": "Sprawdź status synchronizacji",
	"Checking for changes.": "Sprawdzam zmiany.",
	"Checking server…": "Sprawdzanie serwera…",
	"Choose sync direction": "Wybierz kierunek synchronizacji",
	Clear: "Wyczyść",
	"Clear all": "Wyczyść wszystko",
	"Clear key": "Usuń klucz",
	"Clear search": "Wyczyść wyszukiwanie",
	"Click to copy": "Kliknij, aby skopiować",
	"Click to sync": "Kliknij, aby zsynchronizować",
	Close: "Zamknij",
	"Cloud server": "Serwer w chmurze",
	"CocoaPods dependencies": "Zależności CocoaPods",
	"Code copied!": "Kod skopiowany!",
	"Comparing your vault with the cloud…": "Porównywanie twojego sejfu z chmurą…",
	Complete: "Zakończono",
	Confirm: "Potwierdź",
	"Confirm destructive sync": "Potwierdź synchronizację z usuwaniem",
	Conflict: "Konflikt",
	Confusing: "Niejasne",
	"Connect any AI (MCP)": "Połącz dowolnego AI (MCP)",
	"Connect to Engram first to send feedback.":
		"Najpierw połącz się z Engram, aby przesłać opinię.",
	"Connected — live sync active": "Połączono — aktywna synchronizacja w czasie rzeczywistym",
	"Connected — polling": "Połączono — sprawdzanie",
	"Connected — waiting for first sync decision":
		"Połączono — oczekuje na pierwszą decyzję synchronizacji",
	"Connection failed": "Nie udało się połączyć",
	"Could not compare with the cloud. Check your connection.":
		"Nie można porównać z chmurą. Sprawdź połączenie.",
	"Could not create the vault — check your connection and try again.":
		"Nie udało się utworzyć sejfu — sprawdź połączenie i spróbuj ponownie.",
	"Could not load vaults: {error}": "Nie udało się załadować sejfów: {error}",
	"Could not reach Engram — check connection": "Nie można połączyć z Engram — sprawdź połączenie",
	"Couldn't create vault — the name may be invalid or already in use.":
		"Nie można utworzyć sejfu – nazwa może być nieprawidłowa lub już w użyciu.",
	"Couldn't send your feedback, please try again.":
		"Nie udało się przesłać Twojej opinii, spróbuj ponownie.",
	Create: "Utwórz",
	"Create a hosted account at {signup}, or self-host the server ({guide}).":
		"Utwórz konto na {signup} lub uruchom serwer samodzielnie ({guide}).",
	"Create a new empty vault on the server, then sync this Obsidian vault into it.":
		"Utwórz nowy, pusty sejf na serwerze, a następnie zsynchronizuj z nim ten sejf Obsidian.",
	"Custom patterns": "Własne wzorce",
	"Daily AI search limit reached. Free includes 20 per day across Obsidian, the web app and MCP. Upgrade for unlimited.":
		"Osiągnięto dzienny limit wyszukiwania AI. Darmowa wersja obejmuje 20 zapytań dziennie dla Obsidian, aplikacji internetowej i MCP. Rozszerz plan, aby uzyskać nieograniczoną liczbę.",
	"Dart tool cache": "Pamięć podręczna narzędzi Dart",
	"Debug (verbose)": "Debug (szczegółowy)",
	"Delete all local files, then download from remote":
		"Usuń wszystkie lokalne pliki, a następnie pobierz ze zdalnego",
	"Delete all on remote, then upload local files":
		"Usuń wszystko na zdalnym, a następnie wyślij lokalne pliki",
	"Delete all {count} files currently on the server": {
		one: "Usuń wszystkie {count} pliki aktualnie na serwerze",
		few: "Usuń wszystkie {count} pliki znajdujące się obecnie na serwerze",
		many: "Usuń wszystkie {count} plików z serwera",
		other: "Usuń wszystkie pliki {count} znajdujące się obecnie na serwerze",
	},
	"Delete all {count} files in this vault": {
		one: "Usuń wszystkie {count} plik w tym sejfie",
		few: "Usuń wszystkie {count} pliki w tym sejfie",
		many: "Usuń wszystkie {count} plików w tym sejfie",
		other: "Usuń wszystkie pliki {count} w tym sejfie",
	},
	Deleted: "Usunięto",
	Deleting: "Usuwanie",
	"Deleting {count} local files.": {
		one: "Usuwanie {count} lokalnego pliku.",
		few: "Usuwanie {count} lokalnych plików.",
		many: "Usuwanie {count} lokalnych plików.",
		other: "Usuwanie {count} lokalnych plików.",
	},
	"Deleting {count} on the cloud.": {
		one: "Usuwanie {count} z chmury.",
		few: "Usuwanie {count} z chmury.",
		many: "Usuwanie {count} z chmury.",
		other: "Usuwanie wersji {count} z chmury.",
	},
	"Device swap cooldown active. Wait or upgrade.":
		"Czas oczekiwania po zmianie urządzenia jest aktywny. Poczekaj lub zaktualizuj.",
	Diagnostics: "Diagnostyka",
	"Diagnostics detail": "Szczegóły diagnostyki",
	"Disconnect (clear login)": "Odłącz (usuń dane logowania)",
	Disconnected: "Odłączono",
	Dismiss: "Anuluj",
	"Distribution build output": "Wynik kompilacji dystrybucyjnej",
	Documentation: "Dokumentacja",
	Done: "Zakończono",
	"Download everything": "Pobierz wszystko",
	"Download remote files without uploading the local":
		"Pobierz zdalne pliki bez wysyłania lokalnych",
	"Download {count} files from the server": {
		one: "Pobierz {count} plik z serwera",
		few: "Pobierz {count} pliki z serwera",
		many: "Pobierz {count} plików z serwera",
		other: "Pobierz {count} plików z serwera",
	},
	Downloading: "Pobieranie",
	"Downloading {count}.": {
		one: "Pobieranie {count}.",
		few: "Pobieranie {count}.",
		many: "Pobieranie {count}.",
		other: "Pobieranie {count}.",
	},
	"Engram Cloud": "Engram Chmura",
	"Engram Sync: pulled {count} changes": {
		one: "Engram Synchronizacja: pobrano {count} zmianę",
		few: "Engram Synchronizacja: pobrano {count} zmiany",
		many: "Engram Synchronizacja: pobrano {count} zmian",
		other: "Engram Synchronizacja: pobrano {count} zmian",
	},
	"Engram Sync: pulled {count} files from server": {
		one: "Engram Synchronizacja: pobrano {count} plik z serwera",
		few: "Engram Synchronizacja: pobrano {count} pliki z serwera",
		many: "Engram Synchronizacja: pobrano {count} plików z serwera",
		other: "Engram Synchronizacja: pobrano {count} plików z serwera",
	},
	"Engram Sync: pulled {pulled}": "Engram Synchronizacja: pobrano {pulled}",
	"Engram Sync: pulled {pulled} (local extras deleted)":
		"Engram Synchronizacja: pobrano {pulled} (lokalne dodatki usunięte)",
	"Engram Sync: pulled {pulled}, pushed {pushed}":
		"Engram Synchronizacja: pobrano {pulled}, wysłano {pushed}",
	"Engram Sync: pushed {count} files": {
		one: "Engram Synchronizacja: przesłano {count} plik",
		few: "Engram Synchronizacja: przesłano {count} pliki",
		many: "Engram Synchronizacja: przesłano {count} plików",
		other: "Engram Synchronizacja: przesłano {count} plików",
	},
	"Engram Sync: pushed {pushed}": "Engram Synchronizacja: przesłano {pushed}",
	'Engram Sync: renamed "{name}" (unsupported characters)':
		'Engram: Synchronizacja: zmiana nazwy "{name}" (niedozwolone znaki)',
	"Engram Sync: replaced remote with local ({pushed} uploaded)":
		"Engram Synchronizacja: zastąpiono zdalną wersję lokalną ({pushed} przesłanych)",
	'Engram Sync: sync state for "{name}" was unreadable — using the on-disk copy.':
		'Engram Synchronizacja: stan synchronizacji dla "{name}" był nieczytelny — użyto kopii z dysku.',
	"Engram Sync: {details}": "Engram Synchronizacja: {details}",
	"Engram URL": "Engram adres URL",
	"Engram Vault Sync {version} is available. {link}.":
		"Engram Vault Sync {version} jest dostępne. {link}.",
	"Engram indexes {indexed} of your {all} notes. The rest match on this device only. Upgrade to index everything.":
		"Engram indeksuje {indexed} z twoich {all} notatek. Reszta pasuje tylko na tym urządzeniu. Zaktualizuj, aby indeksować wszystko.",
	"Engram is the backend that powers sync and semantic search.":
		"Engram to backend, który umożliwia synchronizację i wyszukiwanie semantyczne.",
	"Engram search": "Engram wyszukiwanie",
	"Engram server changed — sign in again to continue.":
		"Serwer Engram został zmieniony – zaloguj się ponownie, aby kontynuować.",
	"Engram sync: checking...": "Engram Synchronizacja: sprawdzanie...",
	"Engram sync: everything in sync": "Engram Synchronizacja: wszystko zsynchronizowane",
	"Engram sync: live sync requires a plugin update — please update the Engram vault sync plugin.":
		"Engram synchronizacja: synchronizacja w czasie rzeczywistym wymaga aktualizacji wtyczki — zaktualizuj wtyczkę synchronizacji Engram.",
	"Engram sync: pulling all from server...":
		"Engram synchronizacja: pobieranie wszystkich danych z serwera...",
	"Engram sync: server does not support reconciliation (update backend)":
		"Engram Synchronizacja: serwer nie obsługuje synchronizacji (zaktualizuj backend)",
	"Engram sync: sync failed": "Engram synchronizacja: synchronizacja nie powiodła się",
	"Engram sync: syncing...": "Engram Synchronizacja: synchronizacja w toku...",
	"Engram unreachable. Showing matches from this device only.":
		"Engram niedostępny. Wyświetlane są tylko wyniki z tego urządzenia.",
	"Engram's {document} update, effective {date}.":
		"Aktualizacja Engram dla {document}, obowiązuje od {date}.",
	"Engram: This vault has been deleted on the server.":
		"Engram: Ten sejf został usunięty z serwera.",
	"Engram: disconnected. Open Engram settings to reconnect.":
		"Engram: odłączono. Otwórz ustawienia Engram, aby ponownie połączyć.",
	"Engram: error": "Engram: błąd",
	"Engram: finish setup": "Engram: zakończ konfigurację",
	'Engram: frontmatter problem in "{name}"': 'Engram: problem z frontmatter w "{name}"',
	"Engram: live": "Engram: aktywna",
	"Engram: not connected": "Engram: niepołączone",
	"Engram: offline": "Engram: w trybie offline",
	"Engram: offline ({count} queued)": {
		one: "Engram: offline ({count} w kolejce)",
		few: "Engram: offline ({count} w kolejce)",
		many: "Engram: offline ({count} w kolejce)",
		other: "Engram: offline ({count} w kolejce)",
	},
	"Engram: pending ({count})": "Engram: oczekuje ({count})",
	"Engram: plan upgraded — syncing {count} attachments…": {
		one: "Engram: plan ulepszony — synchronizacja {count} załącznika…",
		few: "Engram: plan uaktualniony — synchronizacja {count} załączników…",
		many: "Engram: plan ulepszony — synchronizacja {count} załączników…",
		other: "Engram: plan uaktualniony — synchronizacja {count} załączników…",
	},
	"Engram: plugin settings file was corrupted and could not be recovered. You may need to reconnect in settings.":
		"Engram: plik ustawień wtyczki został uszkodzony i nie można go odzyskać. Być może będziesz musiał ponownie połączyć w ustawieniach.",
	"Engram: ready": "Engram: gotowe",
	"Engram: recovered plugin settings from a backup after a corrupted save.":
		"Engram: odzyskane ustawienia wtyczki z kopii zapasowej po uszkodzeniu podczas zapisu.",
	"Engram: settings tab failed to render ({error})":
		"Engram: Nie udało się wyświetlić zakładki ustawień ({error})",
	"Engram: sign-in failed ({error})": "Engram: logowanie nie powiodło się ({error})",
	"Engram: signed out": "Engram: wylogowano",
	"Engram: sync conflict on {path} — your local edit was saved as {copy}":
		"Engram: konflikt synchronizacji w {path} — twoja lokalna edycja została zapisana jako {copy}",
	"Engram: sync failed. Open the sync log for details.":
		"Engram: synchronizacja nie powiodła się. Otwórz dziennik synchronizacji, aby zobaczyć szczegóły.",
	"Engram: sync is not set up yet, so nothing in this vault will sync.":
		"Engram: synchronizacja nie została jeszcze skonfigurowana, więc nic z tego sejfu nie zostanie zsynchronizowane.",
	"Engram: sync is paused. This edit was not synced. Choose a sync direction to resume.":
		"Engram: synchronizacja jest wstrzymana. Ta edycja nie została zsynchronizowana. Wybierz kierunek synchronizacji, aby wznowić.",
	"Engram: sync paused": "Engram: synchronizacja wstrzymana",
	"Engram: syncing": "Engram: synchronizacja",
	"Engram: syncing ({count})": "Engram: synchronizacja w toku ({count})",
	"Engram: this plugin is too old to sync (needs {version} or newer). Update it to continue.":
		"Engram: ten wtyczek jest zbyt stary, aby synchronizować (wymaga {version} lub nowszej). Zaktualizuj go, aby kontynuować.",
	"Engram: this plugin is too old to sync. Update it to continue.":
		"Engram: ten wtyczek jest zbyt stary, aby synchronizować. Zaktualizuj go, aby kontynuować.",
	"Engram: this vault no longer exists on the server. Pick or create a vault to continue.":
		"Engram: ten sejf nie istnieje już na serwerze. Wybierz lub utwórz sejf, aby kontynuować.",
	"Engram: update required": "Engram: wymagana aktualizacja",
	"Engram: your login expired — open Engram settings to reconnect.":
		"Engram: Twoje logowanie wygasło — otwórz ustawienia Engram, aby ponownie się połączyć.",
	"Engram: {count} attachments skipped — upgrade your plan to sync images & PDFs.": {
		one: "Engram: pominięto {count} załącznik — rozwiń swój plan, aby synchronizować obrazy i pliki PDF.",
		few: "Engram: pominięto {count} załączniki — rozwiń swój plan, aby synchronizować obrazy i pliki PDF.",
		many: "Engram: pominięto {count} załączników — rozważ aktualizację planu, aby synchronizować obrazy i pliki PDF.",
		other: "Engram: Pominięto {count} załączników — rozważ aktualizację planu, aby synchronizować obrazy i pliki PDF.",
	},
	"Engram: {count} files failed to sync{detail} — open Sync Center": {
		one: "Engram: Nie udało się zsynchronizować {count} pliku{detail} — otwórz Centrum synchronizacji",
		few: "Engram: Synchronizacja nie powiodła się dla {count} plików{detail} — otwórz Centrum synchronizacji",
		many: "Engram: Nie udało się zsynchronizować {count} plików{detail} — otwórz Centrum synchronizacji",
		other: "Engram: Nie udało się zsynchronizować {count} plików{detail} — otwórz Centrum synchronizacji",
	},
	"Engram: {count} notes have frontmatter problems. Open Sync Center to fix.": {
		one: "Engram: {count} notatka ma problemy z nagłówkiem. Otwórz Centrum synchronizacji, aby je naprawić.",
		few: "Engram: {count} notatki mają problemy z frontmatterem. Otwórz Centrum synchronizacji, aby je naprawić.",
		many: "Engram: {count} notatek ma problemy z frontmatterem. Otwórz Centrum synchronizacji, aby je naprawić.",
		other: "Engram: {count} notatek mają problemy z nagłówkiem. Otwórz Centrum synchronizacji, aby je naprawić.",
	},
	"Engram: ⚠ {count} sync errors": {
		one: "Engram: ⚠ {count} błąd synchronizacji",
		few: "Engram: ⚠ {count} błędy synchronizacji",
		many: "Engram: ⚠ {count} błędów synchronizacji",
		other: "Engram: ⚠ {count} błędów synchronizacji",
	},
	"Enter a name for the new vault": "Wpisz nazwę dla nowego sejfu",
	"Enter an API key first": "Najpierw wprowadź klucz API",
	Error: "Błąd",
	"Error: {error}": "Błąd: {error}",
	"Errors only": "Tylko błędy",
	"Everything is in sync": "Wszystko jest zsynchronizowane",
	"Failed to start device flow. Check your Engram URL and try again.":
		"Nie udało się uruchomić procesu autoryzacji. Sprawdź swój adres URL Engram i spróbuj ponownie.",
	"Failed to switch vault: {error}": "Nie udało się przełączyć sejfu: {error}",
	"File exceeds the {limit} limit": "Plik przekracza limit {limit}",
	"File not found locally: {path}": "Plik nie znaleziony lokalnie: {path}",
	"File too large for your plan.": "Plik jest zbyt duży dla twojego planu.",
	"File type not accepted": "Nieobsługiwany typ pliku",
	"Files that will be deleted:": "Pliki, które zostaną usunięte:",
	"Filter by folder…": "Filtruj po folderze…",
	"Filter by tags…": "Filtruj po tagach…",
	"Finish setting up your account at app.engram.page to start syncing.":
		"Zakończ konfigurację swojego konta na stronie app.engram.page, aby rozpocząć synchronizację.",
	"Finish sync setup": "Zakończ konfigurację synchronizacji",
	"Finished with some errors. Open the sync log to see what failed.":
		"Zakończono z błędami. Otwórz dziennik synchronizacji, aby zobaczyć, co się nie udało.",
	"First sync, this may take a moment.": "Pierwsza synchronizacja, może to potrwać chwilę.",
	Free: "Bezpłatny",
	"Free syncs notes only — images & PDFs need a paid plan.":
		"Synchronizacja notatek jest darmowa — obrazy i pliki PDF wymagają płatnego planu.",
	"Free syncs notes only — {count} attachments will be skipped.": {
		one: "Darmowa synchronizacja dotyczy tylko notatek — jeden załącznik zostanie pominięty.",
		few: "Darmowa synchronizacja dotyczy tylko notatek — {count} załączniki zostaną pominięte.",
		many: "Darmowa synchronizacja dotyczy tylko notatek — {count} załączników zostanie pominiętych.",
		other: "Darmowa synchronizacja dotyczy tylko notatek — {count} załączników zostanie pominiętych.",
	},
	"Frontmatter could not be parsed": "Nie można przetworzyć nagłówka",
	"Frontmatter isn't valid YAML.": "Nagłówek nie jest poprawnym YAML.",
	'Frontmatter key "{key}" could not be parsed as YAML.':
		'Nie można zinterpretować klucza nagłówka "{key}" jako YAML.',
	"Frontmatter needs a fix": "Wymagane poprawki w nagłówku",
	"Generate new code": "Wygeneruj nowy kod",
	"Generic cache directory": "Ogólny katalog pamięci podręcznej",
	"Getting set up": "Konfiguracja",
	"Getting started…": "Rozpocznij…",
	"GitHub Sponsors": "GitHub Sponsoring",
	"Gradle build cache": "Pamięć podręczna kompilacji Gradle",
	"How do you feel about Engram?": "Jakie masz odczucia dotyczące Engram?",
	Idea: "Pomysł",
	"If this plugin saves you time, consider supporting development.":
		"Jeśli ten plugin oszczędza ci czas, rozważ wsparcie rozwoju.",
	Ignore: "Ignoruj",
	"Ignore patterns": "Ignoruj wzorce",
	"Ignored ({count})": "Ignorowane ({count})",
	"Ignored {path} — won't sync until restored from Sync Center.":
		"Zignorowano {path} — synchronizacja zostanie wznowiona po przywróceniu z Centrum synchronizacji.",
	"Info (default)": "Info (domyślnie)",
	"Invalid API key": "Nieprawidłowy klucz API",
	"It's OK to email me about this": "Możesz śmiało napisać do mnie w sprawie tego",
	"Join our Discord": "Dołącz do naszego Discorda",
	Keyword: "Słowo kluczowe",
	"Last sync: {when}": "Ostatnia synchronizacja: {when}",
	"Learn more": "Dowiedz się więcej",
	"License: {name}": "Licencja: {name}",
	"Limit reached. Upgrade to continue.": "Osiągnięto limit. Rozszerz plan, aby kontynuować.",
	"Link Claude, Cursor, ChatGPT, or any MCP app so it can read and write your notes. ":
		"Połącz Claude, Cursor, ChatGPT lub dowolną aplikację MCP, aby mogła czytać i zapisywać twoje notatki. ",
	"Link Obsidian to Engram": "Połącz Obsidian z Engram",
	"Loading vaults…": "Ładowanie sejfów…",
	"Love it": "Bardzo mi się podoba",
	"Make new vault": "Utwórz nowy sejf",
	"Manage account": "Zarządzaj kontem",
	"Minimum severity that ships while diagnostics are on. Higher levels send fewer lines. Default: Info.":
		"Minimalna ważność, która jest przesyłana, gdy diagnostyka jest włączona. Wyższe poziomy wysyłają mniej wierszy. Domyślnie: Info.",
	"Missing on the server": "Brakujące na serwerze",
	"Needs attention ({count})": "Wymaga uwagi ({count})",
	"Network unavailable": "Brak połączenia z siecią",
	"New here? Watch the setup video": "Jesteś tu pierwszy raz? Obejrzyj film instruktażowy",
	"New vault": "Nowy sejf",
	"Next.js build output": "Wynik kompilacji Next.js",
	"No activity yet. Push or pull to see entries here.":
		"Brak aktywności. Wyślij lub pobierz, aby zobaczyć wpisy.",
	"No files ignored. Use the ignore button on a failure row to stop syncing it.":
		'Brak ignorowanych plików. Użyj przycisku "ignoruj" w wierszu z błędem, aby przerwać jego synchronizację.',
	"No other vaults available.": "Brak innych dostępnych sejfów.",
	"No results found": "Brak wyników",
	"No source path for this result": "Brak ścieżki źródłowej dla tego wyniku",
	"No sync activity this session.": "Brak aktywności synchronizacji w tej sesji.",
	"No vaults found — first sync will create one":
		"Nie znaleziono żadnych sejfów — pierwsza synchronizacja utworzy jeden",
	"Node.js dependencies": "Zależności Node.js",
	"Not configured": "Nie skonfigurowano",
	"Not connected yet. Click to open settings and link this vault.":
		"Nie połączono jeszcze. Kliknij, aby otworzyć ustawienia i połączyć ten sejf.",
	"Not connected. Enter your Engram server URL below to start syncing.":
		"Niepołączone. Wprowadź adres serwera Engram poniżej, aby rozpocząć synchronizację.",
	"Not now": "Nie teraz",
	"Not signed in, or the session expired. Sign in again in Engram settings.":
		"Nie zalogowano, lub sesja wygasła. Zaloguj się ponownie w ustawieniach Engram.",
	"Not signed in. Click to open settings and reconnect.":
		"Nie zalogowano. Kliknij, aby otworzyć ustawienia i połączyć ponownie.",
	"Not synced on your plan ({count})": "Nie zsynchronizowano w Twoim planie ({count})",
	"Not syncing: this plugin version is too old (needs {version} or newer). Click to update.":
		"Nie synchronizuje: ta wersja wtyczki jest zbyt stara (wymagana wersja {version} lub nowsza). Kliknij, aby zaktualizować.",
	"Not syncing: this plugin version is too old. Click to update.":
		"Nie synchronizuje: ta wersja wtyczki jest zbyt stara. Kliknij, aby zaktualizować.",
	"Note couldn't be processed": "Nie można przetworzyć notatki",
	"Note limit reached. Upgrade to keep adding notes.":
		"Osiągnięto limit notatek. Zaktualizuj, aby dodawać więcej notatek.",
	"Note not synced locally": "Notatka nie zsynchronizowana lokalnie",
	"Notes on this device": "Notatki na tym urządzeniu",
	"Notes past this still sync and open normally, they are just not in the search index. The index keeps your oldest notes, so it is your newest ones that fall outside.":
		"Notatki znajdujące się dalej są nadal synchronizowane i otwierane normalnie, ale nie znajdują się w indeksie wyszukiwania. Indeks przechowuje twoje najstarsze notatki, więc to najnowsze notatki nie są w nim uwzględnione.",
	"Notes searchable": "Notatki są przeszukiwalne",
	"Notes stored": "Notatki zapisane",
	"Nothing in this vault syncs until you choose how to merge it with the server.":
		"Nic z tego sejfu nie jest synchronizowane, dopóki nie wybierzesz, jak go połączyć z serwerem.",
	"Nothing is deleted.": "Nic nie jest usuwane.",
	"Nothing needs your attention. 🎉": "Nic nie wymaga twojej uwagi. 🎉",
	"Nothing to sync yet — this vault is empty on both sides. Start syncing and everything you write appears on your other devices.":
		"Nie ma nic do zsynchronizowania – ten sejf jest pusty po obu stronach. Rozpocznij synchronizację, a wszystko, co napiszesz, pojawi się na twoich innych urządzeniach.",
	"Nothing to sync yet: every file here is on your ignore list. Start syncing and everything you write appears on your other devices.":
		"Nie ma nic do synchronizacji: każdy plik tutaj znajduje się na twojej liście ignorowanych. Rozpocznij synchronizację, a wszystko, co napiszesz, pojawi się na twoich innych urządzeniach.",
	"Nothing will be deleted.": "Nic nie zostanie usunięte.",
	"Nothing will be removed from this device.": "Nic nie zostanie usunięte z tego urządzenia.",
	Open: "Otwórz",
	"Open Connection": "Otwórz połączenie",
	"Open Engram": "Otwórz Engram",
	"Open Engram settings": "Otwórz ustawienia Engram",
	"Open Engram to check your vault and confirm everything synced.":
		"Otwórz Engram, aby sprawdzić swój sejf i potwierdzić, że wszystko się zsynchronizowało.",
	"Open connection tab": "Otwórz zakładkę połączenia",
	"Open note": "Otwórz notatkę",
	"Open search sidebar": "Otwórz pasek boczny wyszukiwania",
	"Open sync center": "Otwórz centrum synchronizacji",
	"Open sync setup": "Otwórz konfigurację synchronizacji",
	"Open the file to resolve the conflict, then sync again.":
		"Otwórz plik, aby rozwiązać konflikt, a następnie zsynchronizuj ponownie.",
	"Opens your browser to sign in, or create an account if you don't have one yet, then links this vault.":
		"Otwiera przeglądarkę do logowania lub tworzenia konta, jeśli jeszcze go nie masz, a następnie łączy ten sejf.",
	"Or authenticate with a token instead of signing in.":
		"Lub uwierzytelnij się za pomocą tokena zamiast logowania.",
	"Or authenticate with a token instead of signing in. Engram Cloud API keys require the Pro plan; on Free and Starter, sign in above.":
		"Lub uwierzytelnij się za pomocą tokena zamiast logowania. Engram Klucze API wymagają planu Pro; na planach Free i Starter użyj logowania powyżej.",
	"Paths to skip (one per line). Folder patterns end with /. Built-in: {configDir}/, .trash/, .git/":
		"Ścieżki do pominięcia (jedna na linię). Wzorce folderów kończą się /. Wbudowane: {configDir}/, .trash/, .git/",
	"Pick a vault": "Wybierz sejf",
	"Pick a vault (previous: '{name}' not found)":
		"Wybierz sejf (poprzedni: '{name}' nie znaleziono)",
	"Pick a vault (previous: id {id} not found)":
		"Wybierz sejf (poprzedni: id {id} nie znaleziono)",
	"Pick a vault to sync with. We will recalculate the sync preview after you choose.":
		"Wybierz sejf do synchronizacji. Przeprowadzimy ponowne obliczenia podglądu synchronizacji po wyborze.",
	"Plan usage": "Plan użytkowania",
	Plans: "Plany",
	"Privacy Policy": "Polityka prywatności",
	Pro: "Pro",
	"Pull all (delete extras) aborted: could not obtain an exclusive server snapshot (replay contention). Nothing was trashed.":
		"Przerwanie pobierania wszystkich (usuwanie duplikatów): nie można uzyskać wyłącznego obrazu serwera (konflikt). Nic nie zostało usunięte.",
	"Pull all aborted: another sync is running (replay contention). Try again when it finishes.":
		"Przerwanie pobierania wszystkich: inna synchronizacja jest w toku (konflikt). Spróbuj ponownie, gdy się zakończy.",
	"Pull all failed: {error}": "Błąd pobierania wszystkich: {error}",
	"Pull all from server (force overwrite)": "Pobierz wszystko z serwera (wymuszone nadpisanie)",
	Pulled: "Pobrano",
	"Push entire vault": "Synchronizuj cały sejf",
	Pushed: "Wysłano",
	"Python bytecode cache": "Pamięć podręczna kodu Pythona",
	"Python virtual environment": "Wirtualne środowisko Python",
	"Read it": "Przeczytaj to",
	"Real-time sync": "Synchronizacja w czasie rzeczywistym",
	"Reconnect your account to resume syncing.":
		"Połącz ponownie swoje konto, aby wznowić synchronizację.",
	Refresh: "Odśwież",
	"Remote vault": "Zdalny sejf",
	"Remove tag {tag}": "Usuń tag {tag}",
	"Replacing the remote stopped early: the ignore list changed during sync. Some remote notes were not removed; run it again.":
		"Synchronizacja zakończona przedwcześnie: lista ignorowanych elementów została zmieniona podczas synchronizacji. Niektóre notatki nie zostały usunięte; uruchom ponownie.",
	"Report an issue": "Zgłoś problem",
	"Report an issue on GitHub": "Zgłoś problem na GitHub",
	"Request failed ({status})": "Wystąpił błąd ({status})",
	Restore: "Przywróć",
	"Restored {path} — will sync on next push.":
		"Przywrócono {path} — synchronizacja nastąpi przy następnym przesłaniu.",
	"Retry all now": "Ponów wszystkie teraz",
	"Retrying automatically ({count})": "Ponawianie automatycznie ({count})",
	"Review and accept": "Zapoznaj się i zaakceptuj",
	"Run in background": "Działaj w tle",
	"Run your own Engram server": "Uruchom swój własny serwer Engram",
	"Rust/Java build output": "Wynik kompilacji Rust/Java",
	"Safe choice: combines both sides, nothing is deleted.":
		"Bezpieczny wybór: łączy obie strony, nic nie jest usuwane.",
	Save: "Zapisz",
	"Search across all vaults at once": "Wyszukuj we wszystkich sejfach jednocześnie",
	"Search all your notes": "Wyszukuj wszystkie swoje notatki",
	"Search failed — check connection": "Wyszukiwanie nie powiodło się — sprawdź połączenie",
	"Search settings": "Ustawienia wyszukiwania",
	"Search your vault…": "Wyszukaj w swoim sejfie…",
	"Searching {indexed} of {all} notes. Upgrade to search everything.":
		"Wyszukiwanie w {indexed} z {all} notatek. Zaktualizuj, aby wyszukiwać wszystko.",
	"See full pricing": "Zobacz pełne ceny",
	"See the AI setup guide": "Sprawdź przewodnik konfiguracji AI",
	"Select which vault this plugin syncs with.":
		"Wybierz, z którym sejfem plugin ma synchronizować.",
	"Self-hosted": "Samodzielnie hostowane",
	Semantic: "Semantyczne",
	"Semantic search": "Wyszukiwanie semantyczne",
	Send: "Wyślij",
	"Send debug logs. Note content stays private.":
		"Wyślij logi debugowania. Treść notatek pozostaje prywatna.",
	"Send detailed sync, vault, and connection activity to the server for troubleshooting, with distributed tracing on requests. Metadata only, never note content. Leave off for normal use.":
		"Wysyłaj szczegółowe informacje o synchronizacji, sejfie i połączeniu do serwera w celu rozwiązywania problemów, z rozproszonym śledzeniem żądań. Tylko metadane, nigdy treść notatek. Wyłącz dla normalnego użytkowania.",
	"Send feedback": "Wyślij opinię",
	"Sending…": "Wysyłam…",
	"Server error": "Błąd serwera",
	"Server error ({status}) — check Engram logs": "Błąd serwera ({status}) — sprawdź logi Engram",
	"Server unreachable — changes will sync when connected":
		"Serwer niedostępny — zmiany zostaną zsynchronizowane po ponownym połączeniu",
	"Set up sync for this vault": "Skonfiguruj synchronizację dla tego sejfu",
	"Setup is not finished — nothing will sync until you choose a sync direction. Click to finish.":
		"Konfiguracja nie została zakończona — nic nie zostanie zsynchronizowane, dopóki nie wybierzesz kierunku synchronizacji. Kliknij, aby zakończyć.",
	"Show files ({count}) ▾": "Pokaż pliki ({count}) ▾",
	"Show sync log": "Pokaż dziennik synchronizacji",
	"Showing {count} entries": {
		one: "Wyświetlam {count} wpis",
		few: "Wyświetlam {count} wpisy",
		many: "Wyświetlam {count} wpisów",
		other: "Wyświetlam {count} wpisów",
	},
	"Sign in": "Zaloguj się",
	"Sign in (or enter your server URL and key) on the connection tab, then run your first sync.":
		"Zaloguj się (lub wprowadź adres URL serwera i klucz) na zakładce połączenia, a następnie uruchom pierwszą synchronizację.",
	"Sign in or create an account": "Zaloguj się lub utwórz konto",
	"Sign out": "Wyloguj się",
	"Sign-in expired": "Sesja wygasła",
	"Sign-in required to load vaults": "Logowanie wymagane do ładowania sejfów",
	"Signed in as {email}": "Zalogowany jako {email}",
	Skipped: "Pominięto",
	"Source: {link}": "Źródło: {link}",
	"Start syncing": "Rozpocznij synchronizację",
	Starter: "Starter",
	"Starting...": "Rozpoczynam...",
	Stats: "Statystyki",
	"Support development": "Wspieraj rozwój",
	"Switch to sign in": "Przełącz na logowanie",
	"Switch vault": "Zmień sejf",
	"Switched to {mode}.": "Przełączono na {mode}.",
	Sync: "Synchronizacja",
	"Sync complete": "Synchronizacja zakończona",
	"Sync failed": "Synchronizacja nie powiodła się",
	"Sync in progress...": "Synchronizacja w toku...",
	"Sync log": "Dziennik synchronizacji",
	"Sync now": "Synchronizuj teraz",
	"Sync paused — click to choose a sync direction":
		"Synchronizacja wstrzymana — kliknij, aby wybrać kierunek synchronizacji",
	"Sync preview": "Podgląd synchronizacji",
	"Sync server": "Serwer synchronizacji",
	"Sync these now": "Synchronizuj to teraz",
	"Sync...": "Synchronizacja...",
	"Synced. Some attachments need a paid plan to sync (see below).":
		"Zsynchronizowano. Niektóre załączniki wymagają płatnego planu, aby je zsynchronizować (zobacz poniżej).",
	"Syncing attachments": "Synchronizacja załączników",
	"Syncing your vault": "Synchronizacja twojego sejfu",
	"Syncing...": "Synchronizacja...",
	"Syncing…": "Synchronizacja…",
	"Tell us anything": "Możesz nam o wszystkim powiedzieć",
	"Temporary errors. These clear themselves once the server recovers.":
		"Tymczasowe błędy. Znikną one, gdy serwer odzyska sprawność.",
	"Terms of Service": "Regulamin",
	"Thanks, we read every message.": "Dziękujemy, czytamy każdą wiadomość.",
	"That does not look like a complete server address. Include the scheme, for example http://127.0.0.1:4000":
		"To nie wygląda na pełny adres serwera. Dodaj schemat, np. http://127.0.0.1:4000",
	"That does not look like an Engram API key (expected {prefix}…).":
		"To nie wygląda na klucz API Engram (oczekiwano {prefix}…).",
	"The Engram server no longer accepts this plugin version (it needs {version} or newer), so notes are not being sent or received. Your notes are safe; they will sync once you update.":
		"Serwer Engram nie obsługuje już tej wersji wtyczki (wymagana wersja {version} lub nowsza), więc notatki nie są wysyłane ani odbierane. Twoje notatki są bezpieczne; zostaną zsynchronizowane po aktualizacji.",
	"The Engram server no longer accepts this plugin version, so notes are not being sent or received. Your notes are safe; they will sync once you update.":
		"Serwer Engram nie obsługuje już tej wersji wtyczki, więc notatki nie są wysyłane ani odbierane. Twoje notatki są bezpieczne; zostaną zsynchronizowane po aktualizacji.",
	"The Free tier syncs notes only. Upgrade to sync images and PDFs.":
		"W wersji darmowej synchronizowane są tylko notatki. Zaktualizuj, aby synchronizować obrazy i pliki PDF.",
	"The file is over the server's size limit. Compress or split it, then it will sync.":
		"Plik przekracza limit rozmiaru serwera. Skompresuj lub podziel go, a następnie synchronizacja się wykona.",
	"The file is too large for the server.": "Plik jest zbyt duży dla serwera.",
	"The note synced, but its frontmatter could not be fully parsed. Open it to fix the highlighted line.":
		"Notatka została zsynchronizowana, ale jej nagłówek nie mógł zostać w pełni przetworzony. Otwórz ją, aby poprawić zaznaczony wiersz.",
	"The server couldn't process this note. Check its contents, then edit and save to try again.":
		"Serwer nie mógł przetworzyć tej notatki. Sprawdź jej zawartość, a następnie edytuj i zapisz, aby spróbować ponownie.",
	"The server does not accept this type of file. It will retry if the file changes.":
		"Serwer nie akceptuje tego typu pliku. Spróbuje ponownie, jeśli plik się zmieni.",
	"The server lost this file's stored content and will try to restore it. Nothing on this device was changed.":
		"Serwer utracił zawartość tego pliku i spróbuje go odzyskać. Na tym urządzeniu nic się nie zmieniło.",
	"The server took too long to respond. Try again.":
		"Serwer zbyt długo odpowiadał. Spróbuj ponownie.",
	"These files are fine. They just need a paid plan to sync.":
		"Te pliki są w porządku. Potrzebują płatnego planu, aby je zsynchronizować.",
	"This account was deleted. Contact support if that is wrong.":
		"To konto zostało usunięte. Skontaktuj się z działem pomocy technicznej, jeśli to nieprawda.",
	"This cannot be undone.": "Nie można tego cofnąć.",
	"This code expired before the link finished. Generate a new code to try again.":
		"Ten kod wygasł zanim link został ukończony. Wygeneruj nowy kod i spróbuj ponownie.",
	"This device's vault is empty. Download {what} from the server?":
		"Sejf tego urządzenia jest pusty. Czy chcesz pobrać {what} z serwera?",
	"This file type isn't accepted by this server.":
		"Ten typ pliku nie jest akceptowany przez ten serwer.",
	"This note could not be processed and was skipped.":
		"Nie można było przetworzyć tej notatki i pominięto ją.",
	"This server is self-hosted, so feedback is not collected here. ":
		"Ten serwer jest hostowany samodzielnie, więc tutaj nie są zbierane żadne dane. ",
	"This vault": "Ten sejf",
	"This vault is empty on the server. Upload your {what}?":
		"Ten sejf jest pusty na serwerze. Czy chcesz przesłać swoje {what}?",
	"Too large for the server": "Zbyt duży dla serwera",
	"Too many connected AI clients. Disconnect one or upgrade.":
		"Zbyt wielu podłączonych klientów AI. Odłącz jednego lub rozszerz plan.",
	"Too many connected Obsidian vaults. Disconnect one or upgrade.":
		"Zbyt wiele połączonych sejfów Obsidian. Odłącz jeden lub rozszerz plan.",
	"Too many requests. Wait a moment and try again.":
		"Zbyt wiele zapytań. Poczekaj chwilę i spróbuj ponownie.",
	"Type {keyword} to confirm:": "Wpisz {keyword} aby potwierdzić:",
	"Unknown error": "Nieznany błąd",
	"Unlimited AI searches": "Nieograniczone wyszukiwania AI",
	"Unlimited vaults": "Nieograniczona liczba sejfów",
	"Unresolved conflict": "Nierozwiązany konflikt",
	Untitled: "Bez tytułu",
	Update: "Aktualizacja",
	"Update in settings": "Zaktualizuj w ustawieniach",
	"Update required, not syncing": "Wymagana aktualizacja, nie synchronizuje",
	"Update required: Engram is not syncing": "Wymagana aktualizacja: Engram nie synchronizuje",
	Upgrade: "Rozszerz plan",
	"Upload everything": "Prześlij wszystko",
	"Upload local files without downloading the remote":
		"Wysyłaj lokalne pliki bez pobierania zdalnych",
	"Upload {count} files from this vault": {
		one: "Wgraj {count} plik z tego sejfu",
		few: "Wgraj {count} pliki z tego sejfu",
		many: "Wgraj {count} plików z tego sejfu",
		other: "Wgraj {count} pliku z tego sejfu",
	},
	Uploading: "Wysyłanie",
	"Uploading {count}.": {
		one: "Wgrywanie {count}.",
		few: "Wgrywanie {count}.",
		many: "Wgrywanie {count}.",
		other: "Wgrywanie {count}.",
	},
	"Uploads {up}, downloads {down}.": "Wysyłanie {up}, pobieranie {down}.",
	"Using API key": "Używany klucz API",
	Vault: "Sejf",
	"Vault ID: {id}": "ID sejfu: {id}",
	"Vault limit reached. Upgrade for more vaults.":
		"Osiągnięto limit sejfów. Zaktualizuj, aby mieć więcej sejfów.",
	"Vault name": "Nazwa sejfu",
	"Vault selection": "Wybór sejfu",
	"Vendored dependencies": "Zależności wbudowane",
	"Version: {version}": "Wersja: {version}",
	"Waiting for authorization — connected, this will complete instantly.":
		"Oczekuje na autoryzację — połączono, proces zostanie zakończony natychmiast.",
	"Waiting for authorization — no live connection, checking every 30s.":
		"Oczekuje na autoryzację – brak aktywnego połączenia, sprawdzane co 30 sekund.",
	"Warnings and errors": "Ostrzeżenia i błędy",
	"WebSocket connected — live sync active": "Połączenie WebSocket — aktywna synchronizacja",
	"What Engram does, and how to connect your vault, start to finish.":
		"Co robi Engram i jak połączyć twój sejf, od początku do końca.",
	"What kind of feedback?": "Jaki rodzaj opinii?",
	"What's working, what's frustrating, what do you wish Engram did?":
		"Co działa, co jest frustrujące, czego chciałbyś, żeby Engram robił?",
	"Where this vault syncs to. Each backend keeps its own sign-in.":
		"Gdzie ten sejf jest synchronizowany. Każdy backend wymaga osobnego logowania.",
	"Will download {count} files.": {
		one: "Pobierze {count} plik.",
		few: "Pobierze {count} pliki.",
		many: "Pobierze {count} plików.",
		other: "Pobierze {count} plików.",
	},
	"Will upload {count} files.": {
		one: "Wgranie {count} pliku.",
		few: "Wgranie {count} plików.",
		many: "Wgranie {count} plików.",
		other: "Wgranie {count} plików.",
	},
	"You are about to:": "Właśnie zamierzasz:",
	"You are now pointing at a different cloud vault": "Teraz wskazujesz na inny zdalny sejf",
	"You can close this and the sync keeps running in the background.":
		"Możesz zamknąć to okno, a synchronizacja będzie działać w tle.",
	"You've used all the attachment storage on your plan. Upgrade for more.":
		"Wykorzystano całą przestrzeń na załączniki w Twoim planie. Zaktualizuj, aby uzyskać więcej miejsca.",
	"Your code:": "Twój kod:",
	"Your feedback": "Twoja opinia",
	"Your login expired. Sign in again in Engram settings to continue.":
		"Twoje logowanie wygasło. Zaloguj się ponownie w ustawieniach Engram, aby kontynuować.",
	"Your plan's file limit is {limit}. Compress or split the file, then it will sync.":
		"Limit plików w twoim planie to {limit}. Skompresuj lub podziel plik, a następnie synchronizacja się wykona.",
	"Your vault shares {percent} of its data with Engram":
		"Twój sejf udostępnia {percent} swoich danych do Engram",
	attachments: "załączniki",
	exact: "dokładne",
	files: "pliki",
	folders: "foldery",
	"match strength: {pct}%": "siła dopasowania: {pct}%",
	"matches meaning. Finds notes that never use the words you typed.":
		"pasuje do znaczenia. Znajduje notatki, które w ogóle nie używają wprowadzonych słów.",
	"matches words and meaning together, plus this device. Widest results.":
		"pasuje zarówno do słów, jak i do znaczenia, plus do tego urządzenia. Najszersze wyniki.",
	"matches your words and their other forms — 'run' finds 'running' — plus this device.":
		'pasuje do wprowadzonych słów i ich innych form – np. "run" znajdzie "running" – oraz do tego urządzenia.',
	meaning: "znaczenie",
	"meaning + exact": "znaczenie + dokładne",
	"not linked": "nie połączono",
	notes: "notatki",
	"setup guide": "przewodnik konfiguracji",
	"sync is paused": "synchronizacja wstrzymana",
	"syncing now": "synchronizacja w toku",
	unknown: "nieznane",
	"waiting for a connection": "oczekiwanie na połączenie",
	"waiting to retry": "oczekiwanie na ponowną próbę",
	"{count} attachments": {
		one: "{count} załącznik",
		few: "{count} załączniki",
		many: "{count} załączników",
		other: "{count} załączniki",
	},
	"{count} attachments need a paid plan to sync. See Sync Center.": {
		one: "{count} załącznik wymaga płatnego planu, aby zsynchronizować go. Zobacz Centrum synchronizacji.",
		few: "{count} załączniki wymagają płatnego planu, aby zsynchronizować je. Zobacz Centrum synchronizacji.",
		many: "{count} załączników wymaga płatnego planu, aby je zsynchronizować. Zobacz Centrum synchronizacji.",
		other: "{count} Załączniki wymagają płatnego planu, aby synchronizować. Zobacz Centrum synchronizacji.",
	},
	"{count} attempts": {
		one: "{count} próba",
		few: "{count} próby",
		many: "{count} prób",
		other: "{count} prób",
	},
	"{count} conflicts need resolution": {
		one: "{count} konflikt wymaga rozwiązania",
		few: "{count} konflikty do rozwiązania",
		many: "{count} konfliktów wymaga rozwiązania",
		other: "{count} Konflikty wymagają rozwiązania",
	},
	"{count} conflicts to resolve.": {
		one: "{count} konflikt do rozwiązania.",
		few: "{count} konflikty do rozwiązania.",
		many: "{count} konfliktów do rozwiązania.",
		other: "{count} konfliktów do rozwiązania.",
	},
	"{count} diverged": {
		one: "{count}. różnica",
		few: "{count} rozbieżności",
		many: "{count} rozbieżności",
		other: "{count} różni się",
	},
	'{count} failed. Run "{command}" for details.': {
		one: '{count} nie powiódł się. Uruchom "{command}", aby zobaczyć szczegóły.',
		few: '{count} nieudane. Uruchom "{command}" aby zobaczyć szczegóły.',
		many: '{count} nieudanych. Uruchom "{command}" aby zobaczyć szczegóły.',
		other: '{count} nie powiódł się. Uruchom "{command}", aby zobaczyć szczegóły.',
	},
	"{count} files": {
		one: "{count} plik",
		few: "{count} pliki",
		many: "{count} plików",
		other: "{count} plików",
	},
	"{count} files not included in your plan": {
		one: "{count} plik nie jest uwzględniony w twoim planie",
		few: "{count} pliki nie wchodzą w zakres twojej subskrypcji",
		many: "{count} plików nie wchodzi w zakres twojej subskrypcji",
		other: "{count} plików nie wchodzących w zakres twojej subskrypcji",
	},
	"{count} files queued": {
		one: "{count} plik w kolejce",
		few: "{count} pliki w kolejce",
		many: "{count} plików w kolejce",
		other: "{count} plików w kolejce",
	},
	"{count} ignored": {
		one: "{count} zignorowano",
		few: "{count} zignorowane",
		many: "{count} ignorowanych",
		other: "{count} zignorowano",
	},
	"{count} missing on server": {
		one: "{count} brakujący na serwerze",
		few: "{count} brakujące na serwerze",
		many: "{count} brakujących na serwerze",
		other: "{count} brakujące na serwerze",
	},
	"{count} need attention": {
		one: "{count} wymaga uwagi",
		few: "{count} wymagają uwagi",
		many: "{count} wymaga uwagi",
		other: "{count} wymaga uwagi",
	},
	"{count} notes": {
		one: "{count} notatka",
		few: "{count} notatki",
		many: "{count} notatek",
		other: "{count} notatki",
	},
	"{count} only on server": {
		one: "{count} tylko na serwerze",
		few: "{count} tylko na serwerze",
		many: "{count} tylko na serwerze",
		other: "{count} tylko na serwerze",
	},
	"{count} queued — {reason}": {
		one: "{count} w kolejce — {reason}",
		few: "{count} w kolejce — {reason}",
		many: "{count} w kolejce — {reason}",
		other: "{count} w kolejce — {reason}",
	},
	"{count} retrying": {
		one: "{count} ponawiana próba",
		few: "{count} ponawianie",
		many: "{count} ponawianych",
		other: "{count} ponawianie",
	},
	"{desc} — should not be synced": "{desc} — nie będzie synchronizowany",
	"{first} and {second}": "{first} i {second}",
	"{formatted} per day": "{formatted} dziennie",
	"{label} ({count} queued)": {
		one: "{label} ({count} w kolejce)",
		few: "{label} ({count} w kolejce)",
		many: "{label} ({count} w kolejce)",
		other: "{label} ({count} w kolejce)",
	},
	"{n} of 5": "{n} z 5",
	"▶ Watch on YouTube": "▶ Obejrzyj na YouTube",
	"⚙️ Advanced": "⚙️ Zaawansowane",
	"⚠ Detected: {label}/ ({formatted} files)": "⚠ Wykryto: {label}/ ({formatted} plików)",
	"✓ Engram server reachable (v{version})": "✓ Serwer Engram dostępny (v{version})",
	"✓ {count} synced": {
		one: "✓ {count} zsynchronizowany",
		few: "✓ {count} zsynchronizowane",
		many: "✓ {count} zsynchronizowanych",
		other: "✓ {count} zsynchronizowano",
	},
	"✕ {count} failed": {
		one: "✕ {count} nieudane",
		few: "✕ {count} nieudane",
		many: "✕ {count} nieudanych",
		other: "✕ {count} nie powiódł się",
	},
	"✗ couldn't reach a server at this URL": "✗ Nie można połączyć z serwerem pod tym adresem",
	"✗ server responded but isn't an Engram server":
		"✗ Serwer odpowiedział, ale nie jest serwerem Engram",
	"⤳ {count} skipped (Free plan)": {
		one: "⤳ {count} pominięto (Plan darmowy)",
		few: "⤳ Pominięto {count} (Plan darmowy)",
		many: "⤳ Pominięto {count} (Plan darmowy)",
		other: "⤳ {count} pomijane (Plan darmowy)",
	},
	"👋 Welcome": "👋 Witaj",
	"💬 Feedback": "💬 Opinia",
	"🔄 Sync Center": "🔄 Centrum synchronizacji",
	"🔌 Connection": "🔌 Połączenie",
};

export default pl;
