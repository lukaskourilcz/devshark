/** Server-only attempt versions. The digest is carried inside an encrypted
 * session, never exposed as an answer-key fingerprint. Bump the runtime tag
 * when grading or reward rules change without changing authored material. */
import { createHash } from 'node:crypto';
import { encodeCodingSession, type CodingSession } from '../quiz-tokens';
import { taskHash } from '../curation';
import { complexityGuidance } from '../../shared/coding-complexity';
import type { CodingTask } from '../../shared/coding-catalog';
import { codingTaskForHistory } from './catalog';
import { solutionFor } from './solutions';

export function codingAttemptVersion(task: CodingTask): string {
  return createHash('sha256').update(JSON.stringify([
    'coding-attempt:v3', taskHash(task, solutionFor(task.id)), complexityGuidance(task),
  ])).digest('hex');
}

export function createCodingSession(input: Omit<CodingSession, 'attemptId' | 'issuedAt' | 'version'> & { attemptId?: string }): string {
  const task = codingTaskForHistory(input.taskId);
  if (!task || task.track !== input.track) throw new Error('Cannot issue a session for an unavailable coding task');
  return encodeCodingSession({ ...input, version: codingAttemptVersion(task) });
}
