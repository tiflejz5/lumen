# Historia zmian

## 0.4.0 – Etap 4: baza wiedzy (2026-11-05)

- Osobista baza wiedzy: pojęcia z definicjami własnymi słowami, powiązania `[[termin]]` (czytane z treści, więc nie mogą się rozjechać), odnośniki zwrotne, brakujące pojęcia wyróżnione.
- Zapis pojęć z tematu jednym kliknięciem w kroku „Wypowiedź” sesji.
- Notatki przy karcie tematu; wyszukiwanie w pojęciach i notatkach niewrażliwe na wielkość liter i polskie znaki.
- Migracja 004 (miękkie usuwanie, unikalny znormalizowany termin); testy jednostkowe, HTTP i end-to-end.

## 0.3.0 – Etap 3: sesja nauki (2026-11-05)

- Sesja nauki w etapach research, sprawdzenie, wypowiedź, zakończenie; elastyczny timer z pauzą i zapisem postępu.
- Quiz oceniany po stronie serwera (normalizacja odpowiedzi krótkich); odpowiedzi i opracowanie odkrywane stopniowo.
- Oceny (zainteresowanie, pewność, trudność) zasilają losowanie; zaliczenie dnia po ukończeniu tematu dnia.
- Notatki (podsumowanie, wypowiedź) z edycją i miękkim usuwaniem; Historia, Notatki i Niedokończone.
- Migracja 003; testy: jednostkowe, HTTP i end-to-end (Firefox).

## 0.2.0 – Etap 2: import tematów i temat dnia (2026-11-05)

- Import wydań bazy (folder, ZIP, pojedyncze pliki, `catalog.json`) z podglądem, klasyfikacją (nowy, aktualizacja, konflikt, odświeżenie, bez zmian, starsza rewizja, nieprawidłowy) i zatwierdzaniem. Zmiany istniejących tematów wymagają zgody.
- Walidacja schematami autora bazy (Ajv, JSON Schema 2020-12) oraz reguły poziomu 2 portowane z `validate.py`; testy różnicowe względem oryginału (Python).
- Sumy SHA-256 z manifestu, kontrola wersji głównej schematu, bezpieczne ścieżki plików.
- Zapis w jednej transakcji po automatycznej kopii zapasowej; raport i historia importów; historia wersji treści; dane użytkownika nietykalne.
- Baza tematów: statystyki wydania, postęp katalogu, lista z filtrami i wyszukiwaniem (z obsługą ł), karta tematu z warstwą podstawową (bez odpowiedzi).
- Temat dnia i dodatkowe losowanie: algorytm regułowy z ziarnem, rotacja kategorii, równowaga, trudność, pogłębianie, uzasadnienie „Dlaczego ten temat?”.
- Oznaczenia „znam”, „nieinteresujący”, „odłóż”; tryb demonstracyjny dla paczek przykładowych.
- Migracja 002; wspólne typy API w `@lumen/core`.

## 0.1.0 – Etap 1: fundament (2026-11-05)

- Monorepo (npm workspaces), TypeScript strict, Vitest, Playwright (Firefox), ESLint, Prettier.
- Vault: Argon2id → KEK, losowy klucz bazy (DEK) opakowany hasłem i kluczem odzyskiwania (XChaCha20-Poly1305), zmiana hasła, rotacja klucza odzyskiwania, normalizacja Unicode hasła.
- Baza SQLCipher (AES-256 + HMAC na stronę), WAL, migracje z automatycznym snapshotem przed zmianą schematu.
- Kopie zapasowe `.bazabak` z weryfikacją i bezpiecznym przywracaniem (silnik).
- Serwer: kontrola Host/Origin, CSP bez zasobów zewnętrznych, `no-store`, ciasteczko sesji HttpOnly/SameSite=Strict, limit prób odblokowania, auto-blokada, auto-zakończenie po bezczynności.
- Interfejs po polsku: konfiguracja z potwierdzeniem klucza, odblokowanie, odzyskiwanie, ustawienia, nawigacja (pasek boczny / dolna nawigacja).
- Launcher Windows: skrót, start, zatrzymanie, opcjonalny przenośny Node z weryfikacją SHA-256.
