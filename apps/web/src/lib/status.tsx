import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { StatusResponse } from '@lumen/core';
import { api } from './api';

type StatusContext = {
  status: StatusResponse | null;
  /** true, gdy nie da się połączyć z serwerem (np. został zamknięty) */
  offline: boolean;
  refresh: () => Promise<void>;
};

const Ctx = createContext<StatusContext | null>(null);

const POLL_MS = 15_000;

export function StatusProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [offline, setOffline] = useState(false);
  const inFlight = useRef(false);

  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      setStatus(await api<StatusResponse>('GET', '/api/status'));
      setOffline(false);
    } catch {
      setOffline(true);
    } finally {
      inFlight.current = false;
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void refresh();
    }, POLL_MS);
    const onVisible = () => document.visibilityState === 'visible' && void refresh();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [refresh]);

  const value = useMemo(() => ({ status, offline, refresh }), [status, offline, refresh]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStatus(): StatusContext {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useStatus poza StatusProvider');
  return ctx;
}
