# PROJECT_STATUS

Aplikacja: **Lumen** (nazwa wybrana przez użytkownika). Ostatnia aktualizacja: 2026-11-05.

## Stan etapów

| Etap                                         | Stan                                                        |
| -------------------------------------------- | ----------------------------------------------------------- |
| 0 Architektura                               | zatwierdzony                                                |
| 1 Fundament, zabezpieczenia, kopie, launcher | **zaimplementowany i przetestowany, czeka na akceptację**   |
| 2–8                                          | nie rozpoczęte (czekają na plan i akceptację każdego etapu) |

## Decyzje użytkownika

- Nazwa: Lumen. Przeglądarka: Firefox. Pobieranie przenośnego Node: tak.
- Repozytorium GitHub publiczne z Pages (dokumentacja z `docs/`; aplikacja działa tylko lokalnie).
- Streak: łagodny (1 dzień wolny w tygodniu nie przerywa serii), do dopracowania w Etapie 5.

## Wynik testów Etapu 1

- 95 testów jednostkowych i integracyjnych (Vitest), 6 testów end-to-end w Firefoksie (Playwright), `tsc` i ESLint bez błędów, `npm audit --omit=dev`: 0 podatności.

## Uruchamianie

Patrz `README.md` i `docs/USER_GUIDE.md`. Dane: `%LOCALAPPDATA%\Lumen\`.

## Ważne informacje techniczne

- Serwer uruchamiany jest bez kompilacji (`node src/main.ts`, natywne usuwanie typów Node 24+), więc w kodzie obowiązuje `erasableSyntaxOnly` (bez enumów i parametrów-właściwości).
- `better-sqlite3-multiple-ciphers`: gotowe pliki binarne, skrypt `node-gyp` jest celowo wyłączony (`allowScripts`).
- Zod działa w trybie `jitless` (CSP zabrania `eval`); `packages/core/src/zod-config.ts` musi być importowany pierwszy.
- Kopie robione przez `VACUUM INTO` (API `backup()` nie obsługuje szyfrowanego celu).
- Przywracanie wymaga zamkniętej bazy (Windows blokuje pliki w użyciu).

## Znane ograniczenia

Patrz `docs/SECURITY.md` (sekcja „Znane ograniczenia”). Dodatkowo: brak interfejsu przywracania i automatycznych kopii (Etap 6), brak testu automatycznej blokady w Firefoksie (pokryta testami integracyjnymi z zegarem testowym), instalator przetestowany częściowo (patrz raport Etapu 1).

## Materiały treści od użytkownika (nieużyte w Etapie 1)

- `wiedza-baza-0.1.0/` (schematy, taksonomia, walidator, pakiet przykładowy `pack-000-example.json`).
- `catalog.json` + `KATALOG.md`: katalog 240 tytułów (wersja robocza 0.1.0, „do akceptacji”). Sprawdzony: brak duplikatów ID i tytułów, podkategorie zgodne z taksonomią, zgodny z pakietem przykładowym.

## Następne zadania

Etap 2: import paczek JSON z podglądem i raportem, katalog tematów, algorytm losowania, temat dnia.
