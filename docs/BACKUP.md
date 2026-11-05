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
- **Kopia leżąca obok bazy nie chroni przed awarią dysku.** Skopiuj plik na nośnik zewnętrzny. Automatyczne ostrzeżenia i miejsca docelowe: Etap 6.
- Kopia zawiera własną migawkę vaulta, więc otwiera się hasłem **i** kluczem odzyskiwania z chwili jej utworzenia. Zmiana hasła nie unieważnia tego, co było aktualne wtedy; po wygenerowaniu nowego klucza odzyskiwania starsze kopie nadal otwierają się dawnym kluczem. Jeśli hasło zmieniłeś, bo uznałeś je za ujawnione, usuń starsze kopie.

## Przywracanie (silnik gotowy, interfejs w Etapie 6)

Funkcje `previewRestore` i `applyRestore` (`apps/server/src/modules/backup/backup.ts`):

1. Weryfikacja kopii poświadczeniami (hasło lub klucz odzyskiwania z jej chwili).
2. Odmowa, gdy kopia pochodzi z nowszej wersji aplikacji (nowszy schemat).
3. Podgląd: data, wersja, liczba rekordów w tabelach, informacja czy zmieni się hasło.
4. Zastosowanie, tylko przy zamkniętej bazie: kopia bieżących plików do `backups\pre-restore-…\`, usunięcie starego `-wal`/`-shm` (zastosowany do nowej bazy uszkodziłby ją), atomowa podmiana pliku.
5. Gdy aplikacja była odblokowana i klucz bazy się zgadza, zostaje bieżące hasło; w przeciwnym razie przywracany jest też `vault.json` z kopii (hasło z jej chwili).

Nic nie jest nadpisywane bez kopii stanu sprzed przywrócenia.

## Utrata danych

Jeśli stracisz **zarówno hasło, jak i klucz odzyskiwania, nie da się odzyskać ani bazy, ani żadnej kopii**. Nie ma resetu ani tylnych drzwi.
