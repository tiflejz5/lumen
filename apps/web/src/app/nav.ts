import {
  Award,
  CircleDashed,
  Database,
  History,
  House,
  Library,
  NotebookPen,
  Repeat,
  Settings,
  TrendingUp,
  type LucideIcon,
} from 'lucide-react';

export type NavItem = { to: string; label: string; icon: LucideIcon; primary?: boolean };

export const NAV: NavItem[] = [
  { to: '/', label: 'Dziś', icon: House, primary: true },
  { to: '/powtorki', label: 'Powtórki', icon: Repeat, primary: true },
  { to: '/historia', label: 'Historia', icon: History },
  { to: '/baza-wiedzy', label: 'Baza wiedzy', icon: Library },
  { to: '/notatki', label: 'Notatki', icon: NotebookPen, primary: true },
  { to: '/statystyki', label: 'Statystyki', icon: TrendingUp, primary: true },
  { to: '/osiagniecia', label: 'Osiągnięcia', icon: Award },
  { to: '/niedokonczone', label: 'Niedokończone', icon: CircleDashed },
  { to: '/tematy', label: 'Baza tematów', icon: Database },
  { to: '/ustawienia', label: 'Ustawienia', icon: Settings },
];
