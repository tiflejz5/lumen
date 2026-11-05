# PROJECT_STATUS

Aplikacja: **Lumen**. Ostatnia aktualizacja: 2026-11-05.

## Stan etapów

| Etap                                                        | Stan                                                      |
| ----------------------------------------------------------- | --------------------------------------------------------- |
| 0 Architektura                                              | zatwierdzony                                              |
| 1 Fundament, zabezpieczenia, kopie, launcher                | zatwierdzony                                              |
| 2 Import bazy tematów, katalog, temat dnia                  | **zaimplementowany i przetestowany, czeka na akceptację** |
| 3 Sesja nauki, timer, aktywności, oceny, podstawowe notatki | nie rozpoczęty                                            |
| 4–8                                                         | nie rozpoczęte                                            |

## Decyzje użytkownika

- Nazwa: Lumen. Przeglądarka: Firefox. Pobieranie przenośnego Node: tak.
- Repozytorium publiczne z Pages: https://github.com/tiflejz5/lumen · https://tiflejz5.github.io/lumen/. Autor commitów: adres noreply GitHuba.
- **Treści użytkownika są prywatne i poza repozytorium** (`wiedza-baza-*/`, `catalog.json`, `KATALOG.md`, `pack-*.json`, `FIELDS.md` w `.gitignore`). W repozytorium są tylko schematy JSON potrzebne walidatorowi (`packages/core/schema/`) i syntetyczne dane testowe.
- Streak: łagodny (1 dzień wolny w tygodniu nie przerywa serii), do dopracowania w Etapie 5.
- Format dostarczania paczek: folder, ZIP lub pojedyncze pliki. Paczki przykładowe: opcjonalny import + tryb demonstracyjny. Katalog 240 tytułów: importowany jako „zaplanowane tytuły”.

## Wynik testów Etapu 2

- Vitest: 192 testy (rdzeń, vault, baza, kopie, HTTP, import, losowanie, treści).
- Testy różnicowe: port `difflib.SequenceMatcher` i reguły poziomu 2 kontra oryginalny `validate.py` (Python 3.14 + `jsonschema`).
- Playwright (Firefox): 15 testów end-to-end (Etap 1: 6, Etap 2: 9), osobne serwery i tymczasowe bazy.
- `tsc`, ESLint: bez błędów. `npm audit --omit=dev`: 0 podatności.
- Prawdziwe wydanie `wiedza-baza-0.1.0` + `catalog.json`: sumy SHA-256 poprawne, 240 wpisów katalogu, 5 źródeł, przykładowy temat 0 błędów/0 ostrzeżeń (jak `validate.py`).

## Uruchamianie

Patrz `README.md` i `docs/USER_GUIDE.md`. Dane: `%LOCALAPPDATA%\Lumen\`. Po aktualizacji kodu: `npm run build`, potem skrót **Lumen**. Migracje bazy wykonują się same (z kopią zapasową).

## Ważne informacje techniczne

- Serwer działa bez kompilacji (`node src/main.ts`, natywne usuwanie typów Node 24+): obowiązuje `erasableSyntaxOnly` (bez enumów i parametrów-właściwości).
- Walidacja poziomu 1: Ajv 2020-12 na schematach autora (kopia w `packages/core/schema/`). Poziom 2: `packages/core/src/pack-rules.ts` (czysty TS, komunikaty identyczne z `validate.py`).
- Ajv musi być w wersji 8 (`apps/server`); npm potrafi podłączyć hoistowaną 6 z ESLint.
- Zod działa w trybie `jitless` (CSP zabrania `eval`); `packages/core/src/zod-config.ts` musi być importowany pierwszy.
- Typy DTO odpowiedzi API są w `packages/core/src/content-api.ts` (serwer i UI).
- Kopie robione przez `VACUUM INTO`; przywracanie wymaga zamkniętej bazy.

## Znane ograniczenia

- Patrz `docs/SECURITY.md`. Brak sesji nauki, ocen i notatek (Etap 3); losowanie nie uwzględnia jeszcze ocen zainteresowania ani trudności (dane pojawią się z sesjami).
- Port `difflib` zweryfikowany na ok. 800 parach, w tym napisach ≥200 znaków; ewentualne różnice w skrajnych przypadkach wyłapią testy różnicowe.
- Rola `paths` z manifestu jest pomijana. Katalog tytułów nie jest objęty sumami manifestu (brak roli w schemacie).
- Oznaczenie „odłóż/znam/nieinteresujący” na temacie dnia losuje inny temat; po rozpoczęciu sesji (Etap 3) zasada może wymagać doprecyzowania.
- Brak interfejsu przywracania kopii i automatycznych kopii (Etap 6).

## Następne zadania

Etap 3: karta tematu → sesja (timer elastyczny, etapy research/sprawdzenie/wypowiedź), aktywności końcowe, oceny, zaliczenie dnia, niedokończone tematy, podstawowe notatki.
