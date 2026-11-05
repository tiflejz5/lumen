import { WifiOff } from 'lucide-react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Button, EmptyState, Spinner } from '../components/ui';
import { StatusProvider, useStatus } from '../lib/status';
import { Home, More, Soon } from '../routes/Pages';
import { SettingsPage } from '../routes/Settings';
import { Setup } from '../routes/Setup';
import { Unlock } from '../routes/Unlock';
import { Shell } from './Shell';

function Gate() {
  const { status, offline, refresh } = useStatus();

  if (!status && !offline) {
    return (
      <div className="grid min-h-dvh place-items-center">
        <Spinner label="Łączenie z Lumen…" />
      </div>
    );
  }

  if (offline) {
    return (
      <main className="grid min-h-dvh place-items-center px-4">
        <EmptyState
          icon={WifiOff}
          title="Brak połączenia z serwerem Lumen"
          action={<Button onClick={() => void refresh()}>Spróbuj ponownie</Button>}
        >
          Jeśli aplikacja została zakończona albo okno serwera zamknięte, możesz zamknąć tę kartę.
          Aby wrócić do nauki, uruchom Lumen skrótem na pulpicie.
        </EmptyState>
      </main>
    );
  }

  if (status?.state === 'uninitialized') return <Setup />;
  if (status?.state === 'locked') return <Unlock />;

  return (
    <Routes>
      <Route element={<Shell />}>
        <Route index element={<Home />} />
        <Route
          path="historia"
          element={
            <Soon
              title="Historia"
              stage={3}
              description="Tu zobaczysz wcześniejsze sesje nauki i wrócisz do tematów."
            />
          }
        />
        <Route
          path="baza-wiedzy"
          element={
            <Soon
              title="Baza wiedzy"
              stage={4}
              description="Twoja osobista mini-encyklopedia z notatek, definicji i powiązań."
            />
          }
        />
        <Route
          path="notatki"
          element={
            <Soon
              title="Notatki"
              stage={3}
              description="Własne wnioski, pytania i podsumowania sesji."
            />
          }
        />
        <Route
          path="statystyki"
          element={
            <Soon
              title="Statystyki"
              stage={5}
              description="Regularność, postęp w kategoriach i obszary do pogłębienia."
            />
          }
        />
        <Route
          path="osiagniecia"
          element={
            <Soon
              title="Osiągnięcia"
              stage={5}
              description="Odznaki i kamienie milowe za regularną naukę."
            />
          }
        />
        <Route
          path="niedokonczone"
          element={
            <Soon
              title="Niedokończone"
              stage={3}
              description="Tematy, do których warto wrócić – bez presji nadrabiania."
            />
          }
        />
        <Route
          path="tematy"
          element={
            <Soon
              title="Baza tematów"
              stage={2}
              description="Import paczek z tematami, podgląd zmian i aktualizacje."
            />
          }
        />
        <Route path="ustawienia" element={<SettingsPage />} />
        <Route path="wiecej" element={<More />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

export function App() {
  return (
    <StatusProvider>
      <BrowserRouter>
        <Gate />
      </BrowserRouter>
    </StatusProvider>
  );
}
