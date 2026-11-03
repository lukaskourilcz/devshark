// What the Learn page says about its sections (components/learn/*) and the
// placement rounds of its skill check (SkillCheckRunner in Roadmap.tsx).
// English only, like translations.ts. Only the Learn chunk reads these keys,
// and the app shell has no budget to spare for them
// (docs/quality/bundle-budget.json), as the privacy policy's words live in
// translations.privacy.ts and the coding draft notes in translations.drafts.ts.
// The launch contracts keep these keys out of translations.ts and keep the
// shell from importing this file.

export const learnEn = {
  'learn.preview.access': 'Preview the topics and path outline. Sign in to save progress. Activity labels distinguish free access from Premium.',
  'learn.preview.topics': 'Topics',
  'learn.preview.inventory': '{modules} modules · {lessons} lessons · {checks} check questions · {exercises} code exercises',
  'learn.preview.availability': 'The outline reflects authored content. A path opens for recorded work only when its release checks and availability switch permit it.',

  'learn.lesson.startQuestions': 'Start the questions',
  'learn.lesson.error': 'The lesson could not load. Try again or start the questions.',
  // ── Learn sections (docs/learn-sections-fde-flagship-plan.md, 5.3) ────
  'learn.section.web-developer': 'Web Developer',
  'learn.section.software-engineer': 'Software Engineer',
  'learn.section.forward-deployed-engineer': 'Forward Deployed Engineer',
  'learn.section.line.web-developer': 'The web stack from HTML to Next.js and Node.js, in the order your track sets.',
  'learn.section.line.software-engineer': 'Data structures, algorithms, system design, operations and security, for any stack.',
  'learn.section.line.forward-deployed-engineer': 'AI & LLMs and the service, data and security topics this path builds on.',
  'learn.paths.title': 'Learning paths',
  'learn.paths.card': 'Guided path',
  'learn.paths.cardOutline': 'Guided path outline',
  'learn.paths.actionAria': '{action}: {path}',
  'learn.paths.open': 'Open path',
  'learn.paths.continue': 'Continue path',
  'learn.paths.resume': 'Resume path',
  'learn.paths.outline': 'View outline',
  'learn.switcher.label': 'Learn sections',
  'learn.switcher.item': '{name} · {percent}%',
  'learn.switcher.hint': 'Use the arrow keys to move between sections, then Enter or Space to open one.',
  'learn.join.add': 'Add it to your plan',
  'learn.join.fdeStart': 'Start the FDE path',
  'learn.join.signIn': 'Sign in to add it to your plan',
  'learn.join.choosePlan': 'Choose your plan',
  'learn.join.noPlan': 'You have not chosen a plan yet, so this page lists every topic.',
  'learn.join.free': 'Free to add. Premium levels stay Premium.',
  'learn.join.saving': 'Adding…',
  'learn.join.saved': '{name} is in your plan. Its topics open as you pass what they build on.',
  'learn.join.failed': '{name} was not added to your plan. Try again.',
  'learn.join.enrollFailed': 'The FDE path did not start, so your plan is unchanged. Try again.',
  'learn.join.offline': 'You’re offline. Add it when the connection returns.',
  'learn.rail.notJoined': 'Not in your plan',
  'learn.rail.notJoinedAria': '{topic}, not in your plan. Add {section} to open it.',
  'learn.overview.next': 'Level {n} of {total} · {title}',
  'learn.overview.nextTest': 'Part {part} Test · Levels {from}–{to} completed',
  'learn.overview.premiumTest': 'Part {part} Test is part of Premium',
  'learn.overview.premium': '{topic} is part of Premium',
  'learn.overview.premiumFrom': 'From level {n}, {topic} is part of Premium',
  'learn.overview.seePremium': 'See Premium',
  'learn.empty.title': 'Nothing here is open yet',
  'learn.empty.body': 'Pass {count} levels of {prereq} to open {topic}.',
  'learn.empty.action': 'Go to {prereq}',
  'learn.empty.skillCheck': 'Take the skill check',
  'learn.notJoined.title': '{name} is not in your plan',
  'learn.notJoined.body': 'Add it to open these topics as you pass what they build on.',

  'career.section.topics': 'Topics',
  'career.section.progress': '{passed} of {total} steps completed',

  // ── Adaptive placement (skill-check rounds) ───────────────────────────
  'placement.title': 'Placement',
  'placement.kicker': 'Find your level',
  'placement.subtitle': 'A few quick rounds that adjust to you. Answer honestly — there’s no penalty for not knowing yet.',
  'placement.idkYet': 'I don’t know yet',
  'placement.idkYetHint': 'No penalty — it just helps us place you.',
  'placement.roundOf': 'Round {n} of {total}',
  'placement.steppingUp': 'Stepping up the difficulty',
  'placement.steppingUpHint': 'You’ve got this — here’s something harder.',
  'placement.steppingDown': 'Easing off a little',
  'placement.steppingDownHint': 'Let’s try a gentler one.',
  'placement.holding': 'Holding at this level',
  'placement.converging': 'Zeroing in on your level…',
  'placement.start': 'Start placement',
  'placement.next': 'Next',
  'placement.finish': 'Finish',
  'placement.done': 'Placement complete',
  'placement.applyFailed': 'Your score could not be saved to your account, so no paths opened. Try again.',
  'placement.retry': 'Retake placement',
  'placement.cancel': 'Cancel',
  'placement.loading': 'Setting up your placement…',
  'placement.error': 'Couldn’t run placement. Try again.',
  'placement.review': 'Your answers',
  'placement.yourAnswer': 'Your answer:',
  'placement.correctAnswer': 'Correct answer:',
} as const;

export type LearnKey = keyof typeof learnEn;

/** Resolve a Learn key and fill its `{name}` placeholders. A copy of the
 * interpolation in LanguageContext.tsx: exporting that one would add an export
 * to a module the shell ships. */
export function learnText(key: LearnKey, vars?: Record<string, string | number>): string {
  const template: string = learnEn[key];
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (_, name: string) => (name in vars ? String(vars[name]) : `{${name}}`));
}
