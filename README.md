# Lumen

Osobista aplikacja do codziennego, około 15-minutowego rozwijania wiedzy: własny research, krytyczne myślenie, notatki i osobista baza wiedzy. **Local-first, szyfrowana, bez telemetrii i bez zewnętrznego AI.**

> Stan: **Etap 2 z 8** (fundament i zabezpieczenia, import bazy tematów, temat dnia). Sesje nauki, notatki i statystyki pojawią się w kolejnych etapach. Zobacz [`PROJECT_STATUS.md`](PROJECT_STATUS.md).

## Jak to działa

Lokalny serwer (Node.js) na `127.0.0.1` obsługuje aplikację w przeglądarce. Dane leżą w jednym zaszyfrowanym pliku SQLite (SQLCipher) w `%LOCALAPPDATA%\Lumen\`. Klucz powstaje z hasła (Argon2id). Przeglądarka nie przechowuje żadnych danych użytkownika.

## Wymagania

- Windows 10/11, dowolna nowoczesna przeglądarka (testowane: Firefox).
- Node.js 24 lub nowszy **albo** przenośny Node pobierany automatycznie przez instalator.

## Instalacja i uruchamianie

1. Pobierz zależności (jednorazowo, wymaga Node/npm): `npm install`
2. Dwuklik w `launcher\Zainstaluj.cmd`: buduje interfejs, tworzy folder danych i skrót **Lumen** na pulpicie (w razie braku Node pobiera wersję przenośną z nodejs.org i weryfikuje sumę SHA-256).
3. Kliknij skrót **Lumen**. Otworzy się przeglądarka. Przy pierwszym uruchomieniu ustawisz hasło i zapiszesz klucz odzyskiwania.

Zatrzymanie: przycisk **Zakończ aplikację** w Ustawieniach, `launcher\Zatrzymaj.cmd` albo zamknięcie okna serwera. Po 30 minutach bez żadnej aktywności serwer kończy pracę sam.

## Dla programistów

```
npm install
npm run dev:server     # serwer API na 127.0.0.1:47831
npm run dev:web        # Vite na 127.0.0.1:5173 (proxy do serwera)
npm run build          # buduje apps/web/dist
npm test               # testy jednostkowe i integracyjne (Vitest)
npx playwright test    # testy end-to-end w Firefoksie (osobna, tymczasowa baza)
npm run typecheck && npm run lint
```

Zmienne środowiskowe: `LUMEN_DATA_DIR` (katalog danych), `LUMEN_PORT`, `LUMEN_IDLE_EXIT_MINUTES`, `LUMEN_NO_BROWSER`.

## Struktura

| Katalog         | Zawartość                                                           |
| --------------- | ------------------------------------------------------------------- |
| `apps/server`   | serwer Fastify, vault (klucze), baza, kopie zapasowe                |
| `apps/web`      | interfejs React + Tailwind                                          |
| `packages/core` | wspólne typy, schematy i czysta logika (bez zależności od Node/DOM) |
| `launcher`      | skrypty uruchamiania, instalator, ikona                             |
| `e2e`           | testy end-to-end                                                    |
| `docs`          | architektura, bezpieczeństwo, kopie, instrukcja użytkownika         |

## Dokumentacja

[Architektura](docs/ARCHITECTURE.md) · [Bezpieczeństwo](docs/SECURITY.md) · [Model danych](docs/DATA_MODEL.md) · [Import](docs/IMPORT.md) · [Kopie zapasowe](docs/BACKUP.md) · [Instrukcja użytkownika](docs/USER_GUIDE.md) · [Historia zmian](CHANGELOG.md)

## Prywatność

Repozytorium zawiera wyłącznie kod i dokumentację. Dane użytkownika (baza, vault, kopie, logi) leżą poza katalogiem projektu i są wykluczone w `.gitignore`.
