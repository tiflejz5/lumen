export const MIN_PASSWORD_LENGTH = 10;
export const MAX_PASSWORD_LENGTH = 256;

export type PasswordStrength = {
  /** 0 (bardzo słabe) … 4 (dobre) */
  score: 0 | 1 | 2 | 3 | 4;
  label: string;
};

const COMMON = ['password', 'haslo', 'qwerty', '123456', 'admin', 'lumen', 'zaq1', 'polska'];

/**
 * Orientacyjna ocena hasła. To NIE jest miara odporności na atak – sama długość i różnorodność
 * znaków to uproszczenie. Zachęcamy do frazy z kilku słów.
 */
export function passwordStrength(password: string): PasswordStrength {
  const len = [...password].length;
  if (len < MIN_PASSWORD_LENGTH) return { score: 0, label: 'Za krótkie' };
  const lower = password.toLowerCase();
  if (COMMON.some((w) => lower.includes(w)) && len < 16)
    return { score: 1, label: 'Zbyt przewidywalne' };
  const classes = [/[a-ząćęłńóśźż]/, /[A-ZĄĆĘŁŃÓŚŹŻ]/, /\d/, /[^\p{L}\d]/u].filter((r) =>
    r.test(password),
  ).length;
  const words = password.trim().split(/\s+/).length;
  let score = 1;
  if (len >= 12 && classes >= 2) score = 2;
  if (len >= 16 || (words >= 4 && len >= 14)) score = 3;
  if (len >= 20 && (classes >= 2 || words >= 4)) score = 4;
  const labels = ['Za krótkie', 'Słabe', 'Przeciętne', 'Dobre', 'Bardzo dobre'] as const;
  return { score: score as PasswordStrength['score'], label: labels[score]! };
}
