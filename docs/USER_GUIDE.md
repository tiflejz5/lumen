# Instrukcja użytkownika (Etap 2)

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

## Baza tematów i import

1. **Baza tematów** (menu) → **Importuj**.
2. Wybierz **folder wydania** (z plikiem `manifest.json`), plik **ZIP** albo pojedyncze pliki paczek. Możesz dołączyć `catalog.json` z listą zaplanowanych tytułów.
3. Zobaczysz **podgląd**: które tematy są nowe, które to aktualizacje, konflikty wersji, rekordy z błędami (zostaną odrzucone). Nowe tematy są zaznaczone, a zmiany istniejących musisz zaznaczyć sam. Rozwiń strzałką szczegóły (błędy, zmienione sekcje, uwagi).
4. **Zaimportuj zaznaczone.** Przed zapisem aplikacja robi kopię zapasową, a po imporcie pokazuje raport (zapisany też w historii importów).

Import nigdy nie zmienia Twoich oznaczeń, notatek ani historii. Tematów się nie usuwa.

> Paczki przykładowe są pomijane. Zaznacz „Importuj także paczki przykładowe”, aby je wypróbować, i włącz **Tryb demonstracyjny** w Ustawieniach, żeby były losowane.

## Temat dnia

Ekran **Dziś** pokazuje jeden temat na dzień (zmienia się o 03:00; godzinę można zmienić w Ustawieniach). Temat wybierają jawne reguły: równowaga kategorii, dopasowanie trudności, brak powtórek, rotacja kategorii (ta sama najwyżej 2 dni z rzędu). Przycisk **Dlaczego ten temat?** pokazuje składniki wyboru.

- **Otwórz temat** pokazuje kartę z pytaniem głównym, pytaniami badawczymi, zapytaniami do wyszukiwarki, źródłami i wskazówkami weryfikacji. Opracowanie i quiz są ukryte do czasu sesji nauki.
- **Już go znam / Nieinteresujący / Odłóż na tydzień** wyłącza temat z losowania. Jeśli to temat dnia, losowany jest inny na dziś.
- **Wylosuj dodatkowy temat** nie zastępuje tematu dnia i nie wpływa na postęp.
- Linki do wyszukiwarki otwierają DuckDuckGo w nowej karcie, bez przekazywania żadnych Twoich danych.

## Sesja nauki

**Rozpocznij sesję** (na ekranie _Dziś_ albo na karcie tematu) otwiera sesję w czterech etapach:

1. **Research** – pytanie główne, pytania badawcze, wyszukiwania, źródła i wskazówki weryfikacji.
2. **Sprawdzenie** – krótki quiz. Poprawna odpowiedź i wyjaśnienie pokazują się dopiero po Twojej odpowiedzi.
3. **Wypowiedź** – zadanie do powiedzenia na głos (z opcjonalnym zapisem), opracowanie tematu i oceny: zainteresowanie, pewność, trudność.
4. **Zakończenie** – _Zakończ i zalicz temat_ zalicza temat (a dla tematu dnia – cały dzień) albo _Dokończę później_ zostawia go w **Niedokończonych**.

Timer mierzy aktywny czas nauki i można go wstrzymać; jest zapisywany co kilkanaście sekund, więc przerwana sesja niczego nie traci. Oceny wpływają na kolejne losowania (średnie zainteresowanie kategorii, dopasowanie trudności). **Historia** pokazuje zakończone sesje, a **Notatki** – podsumowania i wypowiedzi z sesji (można je edytować i usuwać).

## Baza wiedzy

**Baza wiedzy** to Twoja mini-encyklopedia. Dodajesz pojęcia własnymi słowami (_Nowe pojęcie_) albo zapisujesz je z sesji: w kroku „Wypowiedź” rozwiń _Pojęcia, mity i granice wiedzy_ i kliknij _Zapisz do bazy wiedzy_. W definicji możesz powiązać pojęcia, wpisując nazwę w podwójnych nawiasach, np. `[[Inflacja]]`. Istniejące pojęcia stają się linkami, brakujące są podkreślone, a na stronie pojęcia widać, które inne pojęcia się do niego odwołują. Wyszukiwanie ignoruje wielkość liter i polskie znaki. Notatki możesz dodawać także na karcie każdego tematu.

## Powtórki, statystyki i osiągnięcia

- **Powtórki:** po ukończeniu tematu aplikacja planuje powtórki w rosnących odstępach. Na ekranie _Dziś_ widzisz, ile ich czeka. Najpierw próbujesz przypomnieć sobie odpowiedź, potem ją odsłaniasz i oceniasz, jak poszło.
- **Statystyki:** seria dni, czas nauki, trafność quizów, wykres ostatnich 30 dni i postęp w kategoriach. Seria jest łagodna: jeden dzień wolny w tygodniu jej nie przerywa.
- **Osiągnięcia:** odznaki za regularność i postęp; zdobyte zostają na stałe.

## Aktualizacja aplikacji

Dwuklik w `launcher\Aktualizuj.cmd` pobiera najnowszą wersję z GitHuba. Interfejs zbuduje się sam przy najbliższym uruchomieniu skrótu **Lumen** – nie trzeba nic budować ręcznie.

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
