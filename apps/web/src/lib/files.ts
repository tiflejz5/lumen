import { unzipSync } from 'fflate';

export type PickedFile = { path: string; data: string };

const MAX_FILE_BYTES = 15 * 1024 * 1024;
const MAX_FILES = 200;
const MAX_TOTAL_BYTES = 40 * 1024 * 1024;

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

const IGNORED = /(^|\/)(node_modules|\.git|__MACOSX)(\/|$)/;

export type ReadResult = { files: PickedFile[]; ignored: number; error: string | null };

/**
 * Zamienia wybrane pliki (folder, pliki .json lub archiwum .zip) na listę plików do wysłania.
 * Do wysłania trafiają tylko pliki JSON; reszta (np. skrypty i dokumentacja pakietu) jest pomijana.
 * Bajty są kodowane w base64, żeby serwer mógł dokładnie sprawdzić sumy SHA-256 z manifestu.
 */
export async function readPicked(selected: File[]): Promise<ReadResult> {
  const out: PickedFile[] = [];
  let ignored = 0;
  let total = 0;

  const add = (path: string, bytes: Uint8Array): string | null => {
    if (bytes.length > MAX_FILE_BYTES)
      return `Plik „${path}” jest zbyt duży (limit ${MAX_FILE_BYTES / 1024 / 1024} MB).`;
    total += bytes.length;
    if (total > MAX_TOTAL_BYTES)
      return `Wybrane pliki są zbyt duże (limit ${MAX_TOTAL_BYTES / 1024 / 1024} MB łącznie).`;
    out.push({ path, data: toBase64(bytes) });
    return null;
  };

  for (const file of selected) {
    const relative =
      (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
    if (IGNORED.test(relative)) {
      ignored += 1;
      continue;
    }
    if (/\.zip$/i.test(file.name)) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      let entries: Record<string, Uint8Array>;
      try {
        entries = unzipSync(bytes, {
          // Odrzucamy wpisy o nadmiernym rozmiarze po rozpakowaniu (ochrona przed „bombą ZIP”).
          filter: (entry) =>
            entry.originalSize <= MAX_FILE_BYTES &&
            /\.json$/i.test(entry.name) &&
            !IGNORED.test(entry.name),
        });
      } catch {
        return { files: [], ignored, error: `Nie udało się odczytać archiwum „${file.name}”.` };
      }
      for (const [name, content] of Object.entries(entries)) {
        const error = add(name, content);
        if (error) return { files: [], ignored, error };
      }
    } else if (/\.json$/i.test(file.name)) {
      const error = add(relative, new Uint8Array(await file.arrayBuffer()));
      if (error) return { files: [], ignored, error };
    } else {
      ignored += 1;
    }
    if (out.length > MAX_FILES)
      return { files: [], ignored, error: `Zbyt wiele plików (limit ${MAX_FILES}).` };
  }
  return { files: out, ignored, error: null };
}
