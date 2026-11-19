import { isRetiredTopic } from './retired-content';

/** Pure subject ownership data shared by browser and server code. Keep visual,
 * localized, and persistence concerns out of this module. devShark teaches one
 * subject, `webdev`. It stays an explicit key because progress, XP, tokens and
 * the database are all keyed by subject. */
export const SUBJECT_SCOPE_CATALOG = {
  webdev: {
    // The landing prints this as the number of questions. It counts what a
    // learner can be served from the static bank: the audit's gate applied,
    // the retired sections left out. `npm run test:launch` recomputes it.
    questionCount: 2134,
    // Active challenges listed in the Coding section, excluding hidden tracks.
    // The launch contract recomputes this from the server's active catalogue.
    codingChallengeCount: 769,
    // `abbreviations`, `testing` and `code-snippets` are gone from `topics`:
    // they are no longer taught as paths of their own (see
    // shared/retired-content.ts). They stay in `categories` on purpose, so
    // every attempt, receipt and progress row written before the retirement
    // still resolves to devShark exactly as it did.
    topics: ['javascript', 'typescript', 'react', 'nextjs', 'nodejs', 'html', 'css', 'git', 'dsa', 'dsa-advanced', 'algorithms', 'general', 'ai', 'databases', 'system-design', 'devops', 'security'],
    categories: ['html', 'css', 'javascript', 'typescript', 'react', 'nextjs', 'nodejs', 'git', 'dsa', 'dsa-advanced', 'algorithms', 'abbreviations', 'general', 'ai', 'databases', 'system-design', 'testing', 'devops', 'security', 'code-snippets'],
  },
} as const;

export type ScopeSubjectId = keyof typeof SUBJECT_SCOPE_CATALOG;
const SCOPE_SUBJECT_ORDER = Object.keys(SUBJECT_SCOPE_CATALOG) as ScopeSubjectId[];

const CATEGORY_OWNER = new Map<string, ScopeSubjectId>();
const TOPIC_OWNER = new Map<string, ScopeSubjectId>();
for (const subject of SCOPE_SUBJECT_ORDER) {
  for (const category of SUBJECT_SCOPE_CATALOG[subject].categories) CATEGORY_OWNER.set(category, subject);
  for (const topic of SUBJECT_SCOPE_CATALOG[subject].topics) TOPIC_OWNER.set(topic, subject);
}

export const subjectForCategory = (category: string): ScopeSubjectId | undefined => CATEGORY_OWNER.get(category);
export const subjectForTopic = (topic: string): ScopeSubjectId | undefined => TOPIC_OWNER.get(topic);
export const isScopeSubject = (value: unknown): value is ScopeSubjectId =>
  typeof value === 'string' && Object.prototype.hasOwnProperty.call(SUBJECT_SCOPE_CATALOG, value);

/** The subjects this deployment serves: devShark's one subject. The
 * database's subject checks still accept subjects this repository no longer
 * knows; it holds no rows for them, and nothing here would read one. */
export function allowedDeploymentSubjects(): ScopeSubjectId[] {
  return ['webdev'];
}

export function allowedDeploymentCategories(): Set<string> {
  return new Set(allowedDeploymentSubjects().flatMap((id) => [...SUBJECT_SCOPE_CATALOG[id].categories]));
}

/** The categories a subject serves questions from: its catalogue without the
 * retired sections. Those stay in `categories` so old rows still resolve, but
 * the server refuses them for delivery, and one retired category in a request
 * gets the whole request refused. Build every request for questions (quiz,
 * challenge, daily set) from this list, not from `categories`. */
export function deliveryCategories(subject: ScopeSubjectId): string[] {
  return SUBJECT_SCOPE_CATALOG[subject].categories.filter((category) => !isRetiredTopic(category));
}
