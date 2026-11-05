# Architektura (zatwierdzona w Etapie 0)

Nazwa robocza: **Sedno** (do potwierdzenia).

## Model

Lokalny serwer (Node.js + Fastify) na `127.0.0.1` + aplikacja React w przeglądarce.
Dane trzyma serwer w jednym zaszyfrowanym pliku SQLite (SQLCipher). Przeglądarka nie przechowuje danych
użytkownika (tylko preferencje UI w `localStorage`).

## Stack

| Warstwa      | Wybór                                                                                   |
| ------------ | --------------------------------------------------------------------------------------- |
| Język        | TypeScript (strict)                                                                     |
| Runtime      | Node.js LTS, wersja przypięta, dołączona jako przenośna (wersję potwierdzić w Etapie 1) |
| Serwer       | Fastify + Zod                                                                           |
| Baza         | SQLite + SQLCipher (`better-sqlite3-multiple-ciphers`), WAL                             |
| Kryptografia | libsodium (`libsodium-wrappers-sumo`): Argon2id, XChaCha20-Poly1305, secretstream       |
| Frontend     | React + Vite + Tailwind + Radix UI (komponenty kopiowane)                               |
| Testy        | Vitest, Playwright, fast-check, axe                                                     |
| Repo         | npm workspaces                                                                          |

## Moduły i zależności

Moduły serwera: `vault`, `topics`, `importer`, `daily`, `sessions`, `notes`, `reviews`, `stats`,
`achievements`, `backup`, `settings`, `audio` (miejsce na Etap 8).

- `packages/core`: czysta logika (losowanie, streak, powtórki, podobieństwo, schematy). Zero zależności od Node/DOM.
- `server` → `core`; `web` → `core` (tylko typy i schematy).
- `backup` używa `vault` i `db`; moduły domenowe nie znają szczegółów backupu.

## Przepływ danych

```
Przeglądarka (React) <-HTTP 127.0.0.1-> Fastify (Host/Origin/sesja/CSP/no-store)
   -> moduły domenowe -> core
   -> Vault (hasło -> Argon2id -> KEK -> DEK w RAM) -> SQLite+SQLCipher
Paczka JSON -> limity -> schemat -> klasyfikacja -> PODGLĄD -> zgoda -> snapshot -> transakcja -> raport
```

## Import i temat dnia (Etap 2)

Potok importu (`apps/server/src/modules/importer`): `release.ts` (parser, manifest, SHA-256, schemat Ajv, reguły poziomu 2) → `preview.ts` (klasyfikacja względem bazy) → `staging.ts` (pamięć, 30 min, czyszczone przy blokadzie) → `apply.ts` (transakcja po kopii zapasowej). Losowanie: `packages/core/src/selection.ts` (czysta funkcja), `modules/daily` (przypisanie na dzień nauki, stany tematów). Szczegóły: `docs/IMPORT.md`, `docs/DATA_MODEL.md`.

## Zasady danych

- UUIDv7, `created_at`, `updated_at`, `deleted_at` (tombstone), `device_id` w rekordach użytkownika.
- Streak, poziomy i statystyki są liczone z sesji, nie przechowywane.
- Import nigdy nie zmienia danych użytkownika. Sesje zapisują użytą wersję tematu.
- Dane użytkownika w `%LOCALAPPDATA%\<Nazwa>\`, poza katalogiem kodu.
- FTS5 z własną normalizacją tekstu (m.in. `ł -> l`).

## Etapy

0 Architektura | 1 Fundament + vault + rdzeń backupu + launcher | 2 Import i losowanie |
3 Sesja + podstawowe notatki | 4 Baza wiedzy | 5 Powtórki, statystyki, odznaki |
6 Backup (automatyka, UI), eksport, offline, dopracowanie | 7 Dostęp z iPhone'a (S1) | 8 Moduł głosowy.

Zmiany względem propozycji użytkownika: rdzeń backupu w Etapie 1; podstawowe notatki w Etapie 3;
iPhone jako osobny etap po przeglądzie bezpieczeństwa.

## Synchronizacja (przyszłość)

S1: iPhone jako klient serwera na PC (prywatna sieć, HTTPS). S2: ręczny transfer zaszyfrowanego eksportu.
S3: replika E2EE (duży osobny projekt). Szczegóły w `docs/SYNC.md` (do napisania).
