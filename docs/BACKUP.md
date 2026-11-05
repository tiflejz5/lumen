# Kopie zapasowe i przywracanie

## Co jest kopią

Plik `lumen-RRRRMMDD-GGMMSS-<rodzaj>.bazabak` w `%LOCALAPPDATA%\Lumen\backups\`. Zawiera:

- zaszyfrowaną bazę (snapshot z `VACUUM INTO`, spójny także podczas pracy aplikacji),
- kopię `vault.json` z chwili wykonania kopii (klucz bazy opakowany hasłem i kluczem odzyskiwania),
- nagłówek z metadanymi, sumą SHA-256 bazy i znacznikiem MAC (BLAKE2b z kluczem pochodnym od klucza bazy).

Układ pliku: `"LUMENBAK"` · długość nagłówka (u32 BE) · nagłówek JSON · MAC (32 B) · baza.

Rodzaje: `manual` (z Ustawień), `auto` (Etap 6), `pre-operation` (automatycznie przed migracją schematu, a w kolejnych etapach także przed importem i przywracaniem).

## Weryfikacja

Po każdym utworzeniu kopia jest sprawdzana: suma SHA-256, MAC, otwarcie bazy w pliku tymczasowym, `PRAGMA quick_check` i zliczenie wierszy w tabelach. Kopia, która nie przejdzie kontroli, jest usuwana, a użytkownik dostaje błąd. W Ustawieniach można sprawdzić dowolną kopię (przycisk **Sprawdź**).

## Co chroni, a czego nie

- Kopia bez hasła i bez klucza odzyskiwania jest nieczytelna. Można ją bezpiecznie trzymać na pendrive lub w folderze synchronizowanym z chmurą (to zwykły plik).
- **Kopia leżąca obok bazy nie chroni przed awarią dysku.** Skopiuj plik na nośnik zewnętrzny. Dlatego Ustawienia ostrzegają, gdy kopie leżą tylko na tym komputerze, i pozwalają ustawić dodatkowy folder (pendrive, chmura).
- Kopia zawiera własną migawkę vaulta, więc otwiera się hasłem **i** kluczem odzyskiwania z chwili jej utworzenia. Zmiana hasła nie unieważnia tego, co było aktualne wtedy; po wygenerowaniu nowego klucza odzyskiwania starsze kopie nadal otwierają się dawnym kluczem. Jeśli hasło zmieniłeś, bo uznałeś je za ujawnione, usuń starsze kopie.

## Przywracanie

Funkcje `previewRestore` i `applyRestore` (`apps/server/src/modules/backup/backup.ts`):

1. Weryfikacja kopii poświadczeniami (hasło lub klucz odzyskiwania z jej chwili).
2. Odmowa, gdy kopia pochodzi z nowszej wersji aplikacji (nowszy schemat).
3. Podgląd: data, wersja, liczba rekordów w tabelach, informacja czy zmieni się hasło.
4. Zastosowanie, tylko przy zamkniętej bazie: kopia bieżących plików do `backups\pre-restore-…\`, usunięcie starego `-wal`/`-shm` (zastosowany do nowej bazy uszkodziłby ją), atomowa podmiana pliku.
5. Gdy aplikacja była odblokowana i klucz bazy się zgadza, zostaje bieżące hasło; w przeciwnym razie przywracany jest też `vault.json` z kopii (hasło z jej chwili).

Nic nie jest nadpisywane bez kopii stanu sprzed przywrócenia.

## Automatyczne kopie i folder dodatkowy

- Raz na dobę (po odblokowaniu aplikacji i co godzinę podczas pracy) powstaje kopia `auto`. Zachowywana jest liczba ostatnich kopii z Ustawień (domyślnie 7); kopii ręcznych i „przed zmianą” aplikacja sama nie usuwa.
- **Dodatkowy folder** (np. `E:\Lumen` na pendrive lub folder synchronizowany z chmurą): każda nowa kopia jest tam kopiowana. Gdy nośnik jest odłączony, kopia lokalna i tak powstaje, a Ustawienia pokazują ostrzeżenie.
- Stan widać w Ustawieniach → Kopie zapasowe (brak kopii, kopia starsza niż 3 dni, brak kopii poza komputerem, błąd kopiowania).

## Przywracanie z interfejsu

Ustawienia → Kopie zapasowe → **Przywróć…** przy wybranej kopii (lokalnej lub z folderu dodatkowego): podaj hasło (albo klucz odzyskiwania) z chwili wykonania kopii, sprawdź podgląd, zaznacz potwierdzenie. Aplikacja zrobi kopię obecnego stanu w `backups\pre-restore-…`, zablokuje się i zaloguje Cię do przywróconej bazy.

**Po awarii dysku / na nowym komputerze:** zainstaluj Lumen, na ekranie pierwszej konfiguracji wybierz **„Mam kopię zapasową – przywróć dane”**, skopiuj plik `.bazabak` do wskazanego folderu kopii i wybierz go z listy. Zalogujesz się hasłem z chwili wykonania kopii.

## Eksport i import danych użytkownika

Ustawienia → **Eksportuj dane** zapisuje plik JSON z sesjami, ocenami, notatkami, pojęciami, powtórkami i odznakami (bez treści bazy tematów). Plik **nie jest szyfrowany**. **Importuj dane** scala plik z bieżącą bazą: rekordy mają UUID, nowszy `updated_at` wygrywa, usunięcia są zachowywane, rekordy tematów, których nie ma w bazie, są pomijane (z raportem). Import jest idempotentny, a przed nim powstaje kopia zapasowa.

## Utrata danych

Jeśli stracisz **zarówno hasło, jak i klucz odzyskiwania, nie da się odzyskać ani bazy, ani żadnej kopii**. Nie ma resetu ani tylnych drzwi.
