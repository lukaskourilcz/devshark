import { createHash } from 'node:crypto';
import type { AdminQuestion } from './questions-store';

type QualityIssueKind =
  | 'weak_distractor'
  | 'duplicate'
  | 'ambiguous_wording'
  | 'freshness_review'
  | 'importance_mismatch';

export interface QualityIssue {
  questionId: string;
  questionHash: string;
  kind: QualityIssueKind;
  severity: 'high' | 'medium' | 'low';
  message: string;
  suggestion: string;
}

const normalize = (value: string): string =>
  value.toLowerCase().replace(/```[\s\S]*?```/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();

const wordCount = (value: string): number => normalize(value).split(/\s+/).filter(Boolean).length;

const unseriousDistractor = /\b(cpu temperature|physical coin|color scheme|developer(?:'s|’s) mood|make buttons blue|random chance|magic happens|faster css|slow css)\b/i;

const hashQuestion = (question: AdminQuestion): string => createHash('sha256').update(JSON.stringify({
  question: question.question,
  options: question.options,
  correctAnswer: question.correctAnswer,
  explanation: question.explanation,
})).digest('hex');

/** Deterministic first-pass content checks. Never edits data. */
export function inspectQuestionQuality(questions: AdminQuestion[]): QualityIssue[] {
  const issues: QualityIssue[] = [];
  const duplicates = new Map<string, string[]>();
  for (const question of questions.filter((item) => !item.deleted)) {
    const normalized = normalize(question.question);
    if (normalized) duplicates.set(normalized, [...(duplicates.get(normalized) ?? []), question.id]);
  }

  for (const question of questions.filter((item) => !item.deleted)) {
    const questionHash = hashQuestion(question);
    const add = (
      kind: QualityIssueKind,
      severity: QualityIssue['severity'],
      message: string,
      suggestion: string,
    ) => issues.push({ questionId: question.id, questionHash, kind, severity, message, suggestion });

    const duplicateIds = duplicates.get(normalize(question.question)) ?? [];
    if (duplicateIds.length > 1 && duplicateIds[0] !== question.id) {
      add('duplicate', 'high', `Matches ${duplicateIds[0]} after normalization.`, 'Compare both items and keep the clearest, most current version.');
    }

    const normalizedOptions = question.options.map(normalize);
    if (new Set(normalizedOptions).size !== normalizedOptions.length || question.options.some((option) => option.trim().length < 2)) {
      add('weak_distractor', 'high', 'One or more distractors are empty, duplicated, or too short.', 'Replace distractors with plausible misconceptions at a similar level of specificity.');
    } else if (question.options.some((option, index) => index !== question.correctAnswer && normalize(option).includes(normalize(question.options[question.correctAnswer])))) {
      add('weak_distractor', 'medium', 'A distractor substantially contains the accepted answer.', 'Make every option mutually exclusive and comparable in scope.');
    } else {
      const correctWords = wordCount(question.options[question.correctAnswer] ?? '');
      const distractorWords = question.options
        .filter((_, index) => index !== question.correctAnswer)
        .map(wordCount);
      const averageDistractorWords = distractorWords.reduce((sum, count) => sum + count, 0) /
        Math.max(1, distractorWords.length);
      if (correctWords >= 8 && correctWords >= averageDistractorWords * 3) {
        add('weak_distractor', 'medium', 'The accepted answer is much more specific than the distractors, which may reveal it by shape.', 'Use plausible alternatives with similar detail and scope.');
      } else if (question.options.some((option, index) => index !== question.correctAnswer && unseriousDistractor.test(option))) {
        add('weak_distractor', 'medium', 'A distractor appears unserious or unrelated to the skill being tested.', 'Use a misconception or nearby concept that a learner might reasonably choose.');
      }
    }

    if (/\b(always|never|obviously|all of the above|none of the above)\b/i.test(question.question)) {
      add('ambiguous_wording', 'medium', 'Absolute or test-taking language may make the answer guessable or context-dependent.', 'State the relevant runtime, standard, or conditions explicitly.');
    }
    if (/\b(latest|currently|today|now|deprecated|no longer)\b/i.test(`${question.question} ${question.explanation}`)) {
      add('freshness_review', 'medium', 'The wording depends on a time-sensitive technical or factual claim.', 'Verify against a primary source and add a version or date when useful.');
    }
    if ((question.importance ?? 5) <= 3 && question.difficulty >= 4) {
      add('importance_mismatch', 'low', 'A difficult question has low curriculum importance.', 'Confirm it belongs in scored rotation or reserve it for optional advanced practice.');
    }
  }

  const severityRank = { high: 0, medium: 1, low: 2 } as const;
  return issues.sort((a, b) => severityRank[a.severity] - severityRank[b.severity] || a.questionId.localeCompare(b.questionId) || a.kind.localeCompare(b.kind));
}
