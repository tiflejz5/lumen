import type { ReactNode } from 'react';
import { Logo } from '../components/ui';

export function AuthLayout({ children, wide }: { children: ReactNode; wide?: boolean }) {
  return (
    <main className="grid min-h-dvh place-items-center px-4 py-10">
      <div className={`w-full ${wide ? 'max-w-xl' : 'max-w-md'}`}>
        <div className="mb-8 flex justify-center">
          <Logo className="text-lg" />
        </div>
        {children}
        <p className="mt-6 text-center text-xs text-subtle">
          Dane zostają na tym komputerze i są szyfrowane. Aplikacja nie wysyła nic do internetu.
        </p>
      </div>
    </main>
  );
}
