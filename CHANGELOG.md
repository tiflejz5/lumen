# Historia zmian

## 0.1.0 – Etap 1: fundament (2026-11-05)

- Monorepo (npm workspaces), TypeScript strict, Vitest, Playwright (Firefox), ESLint, Prettier.
- Vault: Argon2id → KEK, losowy klucz bazy (DEK) opakowany hasłem i kluczem odzyskiwania (XChaCha20-Poly1305), zmiana hasła, rotacja klucza odzyskiwania, normalizacja Unicode hasła.
- Baza SQLCipher (AES-256 + HMAC na stronę), WAL, migracje z automatycznym snapshotem przed zmianą schematu.
- Kopie zapasowe `.bazabak` z weryfikacją i bezpiecznym przywracaniem (silnik).
- Serwer: kontrola Host/Origin, CSP bez zasobów zewnętrznych, `no-store`, ciasteczko sesji HttpOnly/SameSite=Strict, limit prób odblokowania, auto-blokada, auto-zakończenie po bezczynności.
- Interfejs po polsku: konfiguracja z potwierdzeniem klucza, odblokowanie, odzyskiwanie, ustawienia, nawigacja (pasek boczny / dolna nawigacja).
- Launcher Windows: skrót, start, zatrzymanie, opcjonalny przenośny Node z weryfikacją SHA-256.
