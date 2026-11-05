import { Lock, Menu } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { Banner, Button, Logo, cx } from '../components/ui';
import { api } from '../lib/api';
import { useStatus } from '../lib/status';
import { NAV } from './nav';

const PING_EVERY_MS = 20_000;

/** Zgłasza serwerowi aktywność użytkownika (odnawia licznik automatycznej blokady). */
function useActivityPing() {
  const { refresh } = useStatus();
  const last = useRef(0);
  useEffect(() => {
    const ping = () => {
      const now = Date.now();
      if (now - last.current < PING_EVERY_MS) return;
      last.current = now;
      api('POST', '/api/session/touch', {}).then(
        () => refresh(),
        () => refresh(),
      );
    };
    const events = ['pointerdown', 'keydown', 'wheel', 'touchstart', 'mousemove'] as const;
    events.forEach((e) => window.addEventListener(e, ping, { passive: true }));
    return () => events.forEach((e) => window.removeEventListener(e, ping));
  }, [refresh]);
}

export function Shell() {
  const { status, refresh } = useStatus();
  const location = useLocation();
  const [locking, setLocking] = useState(false);
  useActivityPing();

  async function lockNow() {
    setLocking(true);
    try {
      await api('POST', '/api/lock', {});
    } finally {
      setLocking(false);
      await refresh();
    }
  }

  const seconds = status?.autoLockInSeconds ?? null;
  const warn = seconds !== null && seconds <= 60;
  const mobilePrimary = NAV.filter((n) => n.primary);
  const onMore = !mobilePrimary.some((n) =>
    n.to === '/' ? location.pathname === '/' : location.pathname.startsWith(n.to),
  );

  return (
    <div className="min-h-dvh md:grid md:grid-cols-[15rem_1fr]">
      {/* Pasek boczny (komputer) */}
      <aside className="sticky top-0 hidden h-dvh flex-col border-r border-line bg-surface/60 p-4 md:flex">
        <Logo className="mb-6 px-2 pt-1 text-lg" />
        <nav aria-label="Główna nawigacja" className="flex-1 space-y-0.5">
          {NAV.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                cx(
                  'flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors',
                  isActive ? 'bg-white/8 text-fg' : 'text-muted hover:bg-white/5 hover:text-fg',
                )
              }
            >
              <Icon className="size-4" aria-hidden />
              {label}
            </NavLink>
          ))}
        </nav>
        <Button
          icon={Lock}
          variant="ghost"
          busy={locking}
          onClick={lockNow}
          className="justify-start"
        >
          Zablokuj
        </Button>
      </aside>

      <div className="flex min-w-0 flex-col pb-20 md:pb-0">
        {/* Górny pasek (telefon) */}
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-line bg-bg/90 px-4 py-2.5 backdrop-blur md:hidden">
          <Logo />
          <Button
            icon={Lock}
            variant="ghost"
            busy={locking}
            onClick={lockNow}
            aria-label="Zablokuj bazę"
          />
        </div>

        <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-6 sm:px-8 sm:py-10">
          {warn ? (
            <div className="mb-6">
              <Banner tone="warn" title="Baza zaraz się zablokuje">
                Z powodu bezczynności zablokuje się za <span className="tabular">{seconds}</span> s.
                Ruszenie myszą lub dotknięcie ekranu przedłuży sesję.
              </Banner>
            </div>
          ) : null}
          <Outlet />
        </main>
      </div>

      {/* Dolna nawigacja (telefon) */}
      <nav
        aria-label="Nawigacja mobilna"
        className="fixed inset-x-0 bottom-0 z-10 grid grid-cols-5 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
      >
        {mobilePrimary.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              cx(
                'flex flex-col items-center gap-1 py-2.5 text-[11px]',
                isActive ? 'text-accent' : 'text-muted',
              )
            }
          >
            <Icon className="size-5" aria-hidden />
            {label}
          </NavLink>
        ))}
        <NavLink
          to="/wiecej"
          className={cx(
            'flex flex-col items-center gap-1 py-2.5 text-[11px]',
            onMore ? 'text-accent' : 'text-muted',
          )}
        >
          <Menu className="size-5" aria-hidden />
          Więcej
        </NavLink>
      </nav>
    </div>
  );
}
