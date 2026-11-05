# Bezpieczeństwo

## Chroni przed

Kradzież/zgubienie laptopa, skopiowanie folderu danych, zgubiony pendrive z kopią, inni użytkownicy Windows,
ataki z innych stron na localhost (DNS rebinding, CSRF).

## Nie chroni przed

Malware na koncie użytkownika przy odblokowanej bazie, przejęty system, złośliwe rozszerzenia przeglądarki,
wyciek kluczy z hibernacji/pagefile (zalecane szyfrowanie dysku, np. Szyfrowanie urządzenia w Windows 11).

## Klucze

```
Hasło --Argon2id (sól, parametry kalibrowane ~0,5-1 s, zapisane w nagłówku)--> KEK
Klucz odzyskiwania (256 bit, losowy) --> RK
DEK (256 bit, losowy, tworzony raz)
vault.json: DEK zaszyfrowany pod KEK, DEK zaszyfrowany pod RK, parametry KDF, wersja
Baza: SQLCipher (AES-256 + HMAC na stronę), klucz = DEK
Backup: kontener z manifestem, hash i MAC (HKDF z DEK); payload = zaszyfrowana baza
```

- Zmiana hasła przepakowuje tylko DEK. Stare kopie otwierają się starym hasłem; klucz odzyskiwania pozostaje ważny.
- DEK jest w pamięci serwera tylko po odblokowaniu; auto-blokada zamyka bazę. Zerowanie pamięci w JS jest best-effort.
- Brak opcji „zapamiętaj mnie".
- **Utrata hasła i klucza odzyskiwania = trwała utrata danych i kopii.** Brak resetu i backdoora.

## Serwer

Nasłuch tylko 127.0.0.1; weryfikacja Host i Origin; ciasteczko HttpOnly + SameSite=Strict; CSP bez zasobów
zewnętrznych; `Cache-Control: no-store` na API; opóźnienia przy błędnych próbach odblokowania; brak telemetrii;
logi bez treści i haseł; 401 przy zablokowanej bazie.

## Limit prób odblokowania

Po 3 nieudanych próbach serwer odmawia kolejnych przez 2, 4, 8, … do 60 s (licznik w pamięci, zerowany po sukcesie). To chroni przed zgadywaniem przez interfejs; przed atakiem na skopiowany plik chroni wyłącznie koszt Argon2id (256 MiB, ok. 0,5 s na próbę) i siła hasła.

## Sesja i zakończenie

Token sesji jest losowy (256 bit), w ciasteczku HttpOnly/SameSite=Strict, a serwer trzyma tylko jego skrót SHA-256. Blokada (ręczna lub po bezczynności) zamyka bazę, zeruje klucz i unieważnia wszystkie tokeny. Zatrzymanie z poziomu launchera wymaga tokenu z pliku `server.lock` (dostępnego tylko właścicielowi konta Windows).

## Znane ograniczenia (stan: Etap 1)

- Klucz bazy musi istnieć w pamięci procesu serwera podczas pracy. JavaScript nie gwarantuje wyzerowania pamięci (kopie w stercie, w tym zapis szesnastkowy klucza przekazany do SQLCipher, mogą przetrwać do działania GC lub zamknięcia procesu).
- Pamięć WASM po pierwszym haszowaniu Argon2id pozostaje zarezerwowana, więc proces serwera zajmuje stale ok. 330 MB RSS.
- Plik hibernacji i pagefile mogą zawierać klucz. Zalecane szyfrowanie dysku.
- Malware działające na koncie użytkownika przy odblokowanej bazie i złośliwe rozszerzenia przeglądarki są poza modelem zagrożeń.
- Inni użytkownicy tego samego komputera mogą połączyć się z portem lokalnym, ale bez hasła nic nie odczytają (kontrola Host/Origin, sesja, limit prób).
- Ocena siły hasła jest orientacyjna (długość i różnorodność znaków), nie szacuje odporności na słowniki.
- Setup nie zapisuje niczego na dysk przed potwierdzeniem klucza odzyskiwania; jeśli zamkniesz kartę w trakcie, zaczynasz od nowa.

## Treść paczek

Traktowana jako niezaufana: Markdown bez surowego HTML, linki tylko http/https z `noopener`.
Opracowania generowane przez AI oznaczone i wymagają weryfikacji.

## Zasada

Żadnych własnych algorytmów kryptograficznych; tylko libsodium i SQLCipher.
Sekrety (hasła, klucze) nigdy nie trafiają do dokumentacji, logów ani repozytorium.
