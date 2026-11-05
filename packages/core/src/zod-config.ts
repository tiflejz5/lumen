import { z } from 'zod';

// Zod 4 domyślnie próbuje kompilować walidatory przez `new Function` (tryb JIT). Nasze CSP celowo
// zabrania `eval`, więc wyłączamy JIT – dla tak małych schematów różnica wydajności jest pomijalna.
// Ten plik musi być importowany jako pierwszy, zanim powstanie jakikolwiek schemat.
z.config({ jitless: true });
