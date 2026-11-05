import { WifiOff } from 'lucide-react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Button, EmptyState, Spinner } from '../components/ui';
import { StatusProvider, useStatus } from '../lib/status';
import { TaxonomyProvider } from '../lib/taxonomy';
import { Home } from '../routes/Home';
import { KnowledgeEntryPage, KnowledgePage } from '../routes/Knowledge';
import { ImportHistory, ImportReportPage, ImportWizard } from '../routes/ImportWizard';
import { More, Soon } from '../routes/Pages';
import { SessionPage } from '../routes/Session';
import { SettingsPage } from '../routes/Settings';
import { Setup } from '../routes/Setup';
import { HistoryPage, NotesPage, UnfinishedPage } from '../routes/Study';
import { TopicDetail } from '../routes/TopicDetail';
import { Topics } from '../routes/Topics';
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
    <TaxonomyProvider>
      <Routes>
        <Route element={<Shell />}>
          <Route index element={<Home />} />
          <Route path="historia" element={<HistoryPage />} />
          <Route path="baza-wiedzy" element={<KnowledgePage />} />
          <Route path="baza-wiedzy/:id" element={<KnowledgeEntryPage />} />
          <Route path="notatki" element={<NotesPage />} />
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
          <Route path="niedokonczone" element={<UnfinishedPage />} />
          <Route path="sesja/:id" element={<SessionPage />} />
          <Route path="tematy" element={<Topics />} />
          <Route path="tematy/import" element={<ImportWizard />} />
          <Route path="tematy/importy" element={<ImportHistory />} />
          <Route path="tematy/importy/:id" element={<ImportReportPage />} />
          <Route path="tematy/:id" element={<TopicDetail />} />
          <Route path="ustawienia" element={<SettingsPage />} />
          <Route path="wiecej" element={<More />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </TaxonomyProvider>
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
