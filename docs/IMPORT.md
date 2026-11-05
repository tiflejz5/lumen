# Import bazy tematów

Opis działania importu w aplikacji (specyfikacja formatu paczek jest w pakiecie bazy: `IMPORT.md`, `VALIDATION.md`, `VERSIONING.md`).

## Co można wczytać

- **Folder wydania** (z plikiem `manifest.json`): „Wybierz folder wydania”. Może to być folder nadrzędny; manifest jest wyszukiwany automatycznie.
- **Archiwum ZIP** wydania lub **pojedyncze pliki** paczek: „Wybierz ZIP lub pliki”.
- **`catalog.json`** (katalog zaplanowanych tytułów) razem z wydaniem albo osobno.

Do serwera trafiają tylko pliki `.json` (reszta pakietu, np. skrypty i opisy, jest pomijana). Pliki są wysyłane jako bajty, żeby sumy SHA-256 z manifestu zgadzały się dokładnie.

## Etapy

1. **Wczytanie i kontrola** (bez zapisu do bazy):
   - ścieżki plików (odrzucane: `..`, ścieżki bezwzględne, litery dysków, podwójne ukośniki), limity (200 plików, 15 MB na plik, 40 MB razem);
   - `manifest.json` względem schematu; **wersja główna schematu** musi być obsługiwana (obecnie 1.x), inaczej import jest blokowany;
   - **suma SHA-256** każdego pliku z manifestu. Niezgodność lub brak pliku blokuje cały import (plik zmieniono po wydaniu);
   - taksonomia, rejestr źródeł (schemat, unikalność ID);
   - paczki i tematy względem Twoich schematów JSON (Ajv, JSON Schema 2020-12). Błąd w jednym temacie odrzuca **tylko ten temat**;
   - reguły poziomu 2 portowane z `validate.py` (trudność = suma ocen, czas ≤ 20 min, źródła w rejestrze, daty, quiz, rewizje, relacje, cykle w wymaganiach wstępnych, identyczne pytania główne, podobne tytuły/pytania/tagi);
   - slug unikalny także względem tematów już zapisanych.
2. **Podgląd.** Każdy temat dostaje klasyfikację:

   | Klasa           | Znaczenie                                                              | Domyślnie         |
   | --------------- | ---------------------------------------------------------------------- | ----------------- |
   | Nowy            | brak w bazie                                                           | zaznaczony        |
   | Aktualizacja    | wyższa rewizja                                                         | **niezaznaczona** |
   | Konflikt wersji | ta sama rewizja, inna treść                                            | **niezaznaczony** |
   | Odświeżenie     | ta sama treść, nowsza data weryfikacji (zmienia się tylko `freshness`) | **niezaznaczone** |
   | Bez zmian       | identyczny                                                             | –                 |
   | Starsza rewizja | w bazie jest nowsza                                                    | pomijany          |
   | Nieprawidłowy   | nie przeszedł walidacji                                                | odrzucony         |

   Dla zmian widać zmienione sekcje (np. „opis”, „źródła”) i opis zmiany z `changelog`. Temat z bazy, którego brakuje w wydaniu, jest tylko zgłaszany (nie jest usuwany).

3. **Zatwierdzenie.** Wybierasz tematy i klikasz „Zaimportuj zaznaczone”. Podgląd żyje 30 minut wyłącznie w pamięci i znika przy blokadzie bazy.
4. **Zapis** w jednej transakcji, po automatycznej kopii zapasowej (`pre-operation`, etykieta „przed importem”):
   taksonomia, rejestr źródeł (rekordy zastępowane po ID), katalog tytułów, tematy (+ historia wersji, relacje), raport.
   Błąd w trakcie wycofuje wszystko.
5. **Raport** zapisany w historii importów (Baza tematów → Historia importów).

## Gwarancje

- Import **nigdy** nie zmienia danych użytkownika (`topic_user_state`, `daily_assignments`; w kolejnych etapach także sesji, ocen i notatek).
- Każda zatwierdzona wersja treści zostaje w `topic_versions` (klucz: temat + skrót treści).
- Skrót treści liczony jest bez bloku `freshness`, więc sama ponowna weryfikacja nie tworzy nowej wersji.
- Tematów się nie usuwa. Wycofanie to `status: deprecated` (+ `superseded_by`).

## Paczki przykładowe

Pomijane domyślnie. Po zaznaczeniu „Importuj także paczki przykładowe” trafiają do bazy z flagą `is_example`: nie liczą się w statystykach, nie są losowane (chyba że włączysz **tryb demonstracyjny** w Ustawieniach). Prawdziwy temat o tym samym ID zastępuje przykładowy (akcja „Aktualizacja – zastępuje przykładowy”), a przykładowy nigdy nie nadpisze prawdziwego.

## Katalog tytułów

`catalog.json` (`catalog_version`, `entries[]`) zapisuje zaplanowane tytuły. Służy do: sprawdzania relacji (`related`/`next`/`prerequisites` mogą wskazywać zarezerwowane ID), wskaźnika „napisane X z Y” oraz wyświetlania powiązanych tematów, które jeszcze nie powstały. Zaplanowane tytuły nie są losowane.

## Ograniczenia

- Reguły poziomu 2 są portem walidatora z pakietu 1.0.0; przy zmianie schematu głównego trzeba port zaktualizować (testy różnicowe wskażą rozbieżności).
- Rola `paths` w manifeście nie ma jeszcze obsługi (plik jest pomijany z informacją).
- Katalog nie jest objęty sumami manifestu (nie ma dla niego roli w schemacie manifestu).
