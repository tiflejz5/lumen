# Instrukcja użytkownika (Etap 1)

## Pierwsze uruchomienie

1. Kliknij skrót **Lumen** na pulpicie. Otworzy się mały, zminimalizowany czarny panel serwera. Nie zamykaj go podczas nauki. Za chwilę otworzy się przeglądarka.
2. **Hasło.** Wybierz frazę, którą zapamiętasz (np. kilka słów). Minimum to 10 znaków.
3. **Klucz odzyskiwania.** Zapisz go poza komputerem (wydruk lub menedżer haseł). To jedyna druga droga do danych.
4. **Potwierdzenie.** Przepisz trzy wskazane fragmenty klucza. Dopiero wtedy powstaje zaszyfrowana baza.

> Bez hasła i klucza odzyskiwania nikt, także autor aplikacji, nie odzyska Twoich danych.

## Codzienne użycie

- Przy każdym uruchomieniu wpisujesz hasło.
- Po wybranym czasie bezczynności baza blokuje się sama (Ustawienia → Blokada, domyślnie 15 minut). Na minutę przed blokadą zobaczysz ostrzeżenie. Ruch myszą lub dotyk przedłuża sesję.
- **Zablokuj** (menu boczne) blokuje bazę natychmiast.

## Zapomniałem hasła

Ekran odblokowania → **Nie pamiętam hasła** → wpisz klucz odzyskiwania i ustaw nowe hasło. Dane zostają nietknięte.

## Kopie zapasowe

Ustawienia → **Kopie zapasowe** → _Utwórz kopię teraz_. Skopiuj plik z podanego folderu na pendrive lub dysk zewnętrzny. Przycisk _Sprawdź_ weryfikuje kopię.

## Zatrzymywanie

Ustawienia → **Zakończ aplikację**, albo dwuklik `launcher\Zatrzymaj.cmd`, albo zamknięcie okna serwera. Gdy przeglądarka zostanie zamknięta przypadkiem, serwer czeka, a po 30 minutach bez aktywności sam się wyłączy.

## Gdy coś nie działa

| Objaw                                       | Co zrobić                                                                                       |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| „Brak połączenia z serwerem Lumen”          | Uruchom ponownie skrótem **Lumen**                                                              |
| Okno serwera zamyka się z błędem            | Przeczytaj komunikat; szczegóły w `%LOCALAPPDATA%\Lumen\logs\server.log`                        |
| Komunikat o braku interfejsu                | Uruchom `launcher\Zainstaluj.cmd`                                                               |
| Ekran konfiguracji mimo istniejących danych | Pokaże ostrzeżenie o bazie bez pliku klucza. **Nie kontynuuj**; przywróć `vault.json` lub kopię |
| „Zbyt wiele nieudanych prób”                | Odczekaj podany czas (rośnie od 2 do 60 s)                                                      |

## Zalecenia bezpieczeństwa

- Używaj osobnego profilu przeglądarki bez rozszerzeń (rozszerzenia mogą czytać strony).
- Włącz szyfrowanie dysku (Windows: Ustawienia → Prywatność i zabezpieczenia → Szyfrowanie urządzenia, jeśli dostępne).
- Skopiowany klucz zostaje w historii schowka Windows (Win+V); wyczyść ją po wklejeniu.
