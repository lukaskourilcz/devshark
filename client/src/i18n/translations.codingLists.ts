// What the Coding lists say (UX audit U3, #575): the project and path rows'
// verbs, a long list's fold, the Premium rule said once per list, the
// challenge-run row and the status filter. English only, like
// translations.ts. Only the Coding pages read these keys, and they are lazy;
// the app shell has no budget to spare for them (docs/quality/bundle-budget.json),
// as the coding frame's copy lives in translations.workbench.ts.
// codingListCopy fills `{name}` placeholders the way t() does.

export const codingListEn = {
  'coding.evolving.start': 'Start',
  'coding.evolving.review': 'Review',
  'coding.evolving.showAll': 'Show all {n} challenges',
  'coding.evolving.showFewer': 'Show fewer',
  'premium.pathsRule': 'Level 1 of every path comes with the free plan. Premium opens the rest.',
  'premium.projectsRule': 'Stages {stages} of every project come with the free plan. Premium opens the rest.',
  'premium.pathsProjectsRule': 'Level 1 of every path, and stages {stages} of every project, come with the free plan. Premium opens the rest.',
  'coding.run.lead': 'Pick a track and a time, and we line up the tasks.',
  'coding.run.open': 'Plan a run',
  'coding.run.hide': 'Hide the planner',
  'coding.filter.anyStatus': 'Any status',
  'coding.progress.unavailable': 'Progress unavailable',
  'coding.progress.stale': 'Progress could not be refreshed. Showing your last saved progress.',
  'coding.saved.stale': 'Saved challenges could not be refreshed. Showing your last saved list.',
  'coding.saved.saveFailed': 'Could not save this challenge. Try again.',
  'coding.saved.loading': 'Loading saved challenges…',
  'coding.project.open': 'Open project',
  'coding.fullstack.title': 'FullStack projects',
  'coding.project.action': '{action} {title}',
  'coding.filter.taskType': 'Any task type',
  'coding.filter.write': 'Write code',
} as const;

export type CodingListKey = keyof typeof codingListEn;

export function codingListCopy(key: CodingListKey, vars?: Record<string, string | number>): string {
  const template: string = codingListEn[key];
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (_, name: string) => (name in vars ? String(vars[name]) : `{${name}}`));
}
