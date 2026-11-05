/** Typy API sesji nauki oraz czyste ocenianie odpowiedzi w quizie – wspólne dla serwera i interfejsu. */

export type SessionStage = 'research' | 'check' | 'speaking' | 'done';
export const SESSION_STAGES: readonly SessionStage[] = ['research', 'check', 'speaking', 'done'];
export type DifficultyRating = 'too_easy' | 'right' | 'too_hard';
export type NoteKind = 'note' | 'summary' | 'speaking' | 'question';

export type QuizQuestionView = {
  id: string;
  type: 'single_choice' | 'short_answer';
  prompt: string;
  options?: string[];
  /** wypełnione dopiero po udzieleniu odpowiedzi */
  result?: { answer: string; correct: boolean; explanation: string; correctAnswer: string };
};

export type SessionView = {
  id: string;
  topicId: string;
  title: string;
  date: string;
  isDaily: boolean;
  stage: SessionStage;
  status: 'active' | 'finished';
  startedAt: string;
  finishedAt: string | null;
  activeSeconds: number;
  outcome: 'completed' | 'partial' | null;
  ratings: {
    interest: number | null;
    difficulty: DifficultyRating | null;
    confidence: number | null;
  };
  /** pytania quizu (bez odpowiedzi) – dostępne od etapu „sprawdzenie” */
  quiz: QuizQuestionView[] | null;
  /** zadanie wypowiedzi – od etapu „wypowiedź” */
  speaking: { format: string; prompt: string; durationSeconds: number } | null;
  /** warstwa rozszerzona – dopiero po quizie */
  extended: {
    brief: string;
    takeaways: string[];
    keyConcepts: { term: string; definition: string }[];
    misconceptions: { claim: string; correction: string }[];
    deeperQuestions: string[];
    challenge: string;
    knowledgeLimits: string;
  } | null;
  notes: NoteView[];
};

export type NoteView = {
  id: string;
  topicId: string;
  topicTitle: string;
  sessionId: string | null;
  kind: NoteKind;
  body: string;
  createdAt: string;
  updatedAt: string;
};

export type SessionListItem = {
  id: string;
  topicId: string;
  title: string;
  category: string;
  date: string;
  status: 'active' | 'finished';
  stage: SessionStage;
  outcome: 'completed' | 'partial' | null;
  activeSeconds: number;
  isDaily: boolean;
  startedAt: string;
};

export type DayStatus = {
  date: string;
  /** czy dzisiejszy temat dnia został zaliczony (ukończona sesja tematu dnia) */
  dailyDone: boolean;
  activeSession: { id: string; topicId: string; title: string; stage: SessionStage } | null;
};

/** Normalizacja odpowiedzi krótkiej: wielkość liter, spacje, interpunkcja i znaki diakrytyczne. */
export function normalizeAnswer(text: string): string {
  return text
    .toLowerCase()
    .replace(/ł/g, 'l')
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function gradeShortAnswer(answer: string, accepted: string[]): boolean {
  const a = normalizeAnswer(answer);
  if (!a) return false;
  return accepted.some((x) => normalizeAnswer(x) === a);
}
