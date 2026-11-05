# Model danych (stan: Etap 3)

Baza: jeden zaszyfrowany plik SQLite (SQLCipher). Schemat zmieniają numerowane migracje w `apps/server/src/db/migrations/` (przed migracją powstaje kopia zapasowa).

## Konwencje

- Tabele `STRICT`. Pełne rekordy treści trzymamy jako JSON w kolumnie `data`, a wyszukiwane pola w osobnych kolumnach (nowe pola opcjonalne nie wymagają migracji).
- Daty: ISO 8601 (UTC dla momentów, `RRRR-MM-DD` dla dni nauki).
- Dzień nauki to data lokalna z uwzględnieniem ustawienia „początek dnia” (domyślnie 03:00).
- Dane treści (paczki) i dane użytkownika są w osobnych tabelach. Import dotyka wyłącznie treści.

## Migracja 001 – fundament

| Tabela              | Opis                               |
| ------------------- | ---------------------------------- |
| `meta`              | `device_id` (UUIDv7), `created_at` |
| `settings`          | ustawienia (JSON na klucz)         |
| `schema_migrations` | zastosowane migracje               |

## Migracja 002 – treści i temat dnia

| Tabela              | Opis                                                                                                                                                               |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `content_meta`      | `taxonomy` (JSON), `taxonomy_version`, `base_version`, `schema_version`                                                                                            |
| `sources`           | rejestr źródeł (`id`, `data`)                                                                                                                                      |
| `topics`            | bieżąca wersja tematu: kolumny indeksowane + `data` (pełny rekord), `content_hash`, `revision`, `is_example`                                                       |
| `topic_versions`    | historia treści (klucz: `topic_id` + `content_hash`)                                                                                                               |
| `topic_relations`   | `prerequisites` / `related` / `next`                                                                                                                               |
| `imports`           | historia importów + raport (JSON) + nazwa kopii sprzed importu                                                                                                     |
| `catalog_entries`   | zaplanowane tytuły                                                                                                                                                 |
| `topic_user_state`  | stan u użytkownika: `in_progress`, `completed`, `skipped`, `postponed` (+`postponed_until`), `known`, `not_interesting`, flaga `deepen`. Brak wiersza = temat nowy |
| `daily_assignments` | temat dnia przypisany do daty (+ uzasadnienie losowania w JSON)                                                                                                    |

## Migracja 003 – sesje nauki i notatki

| Tabela           | Opis                                                                                                                                                 |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `study_sessions` | sesja tematu (UUIDv7): etap (`research`/`check`/`speaking`/`done`), status (`active`/`finished`), aktywny czas, wynik (`completed`/`partial`), oceny |
| `quiz_answers`   | odpowiedzi w quizie (klucz: sesja + pytanie), poprawność liczona na serwerze                                                                         |
| `notes`          | notatki (`note`/`summary`/`speaking`/`question`), miękkie usuwanie (`deleted_at`)                                                                    |

Zasady: dla tematu może istnieć jedna aktywna sesja (indeks częściowy). Etap tylko rośnie. Czas aktywny nie przekracza czasu od startu. Odpowiedzi do quizu, zadanie wypowiedzi i warstwa rozszerzona są wysyłane do przeglądarki dopiero po osiągnięciu odpowiedniego etapu. Dzień jest zaliczony, gdy zakończono jako `completed` sesję tematu dnia. Oceny zasilają losowanie (`categoryInterest`, `tooEasy`/`tooHard` z 10 ostatnich ocen).

## Losowanie

Czysta funkcja `selectTopic` (`packages/core/src/selection.ts`), wejście: tematy, historia, konfiguracja, ziarno. Wyjście: temat + rozbicie wag. Ziarno dnia: `daily:<device_id>:<data>`, więc wynik jest powtarzalny, a przypisanie dodatkowo zapisywane.

Reguły twarde: tylko tematy aktywne; bez ukończonych, znanych, nieinteresujących i w toku; bez odłożonych do przyszłej daty; pominięte wracają po 60 dniach; bez wcześniej przypisanych jako temat dnia; bez przykładowych (poza trybem demo); ta sama kategoria najwyżej 2 dni z rzędu (poluzowana, gdy nie ma innych).

Wagi miękkie (mnożniki): równowaga kategorii z 30 dni (0,25–3), dopasowanie trudności (`e^(-0,7·odległość)`), zainteresowanie kategorią (0,6–1,4, ze średniej oceny sesji), pogłębienie (×2 dla tematów powiązanych z oznaczonym „do pogłębienia”), niezrealizowane wymagania wstępne (×0,5 za każde, min. 0,15), minął termin przeglądu (×0,5).

## Przygotowanie pod synchronizację

Rekordy użytkownika będą miały UUIDv7, `updated_at` i znaczniki usunięcia (od Etapu 3). Tabela `meta.device_id` identyfikuje urządzenie. Szczegóły: `docs/SYNC.md` (do napisania w Etapie 7).
