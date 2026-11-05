// What the coding frame says (UX audit U3, #575): the capped brief's toggle,
// the More actions menu, the empty preview and the run summaries. English
// only, like translations.ts. Only the coding workbench and a path's code
// activity read these keys, both lazy, and the app shell has no budget to
// spare for them (docs/quality/bundle-budget.json), as the coding draft notes
// live in translations.drafts.ts. workbenchCopy fills `{name}` placeholders
// the way t() does.

export const workbenchEn = {
  'coding.tab.description': 'Description',
  'coding.output.label': 'Task information and results',
  'coding.reference.label': 'Task information',
  'coding.reference.resize': 'Resize the editor and task information panes',
  'coding.feedback.label': 'Code feedback',
  'coding.feedback.show': 'Show output',
  'coding.feedback.hide': 'Hide output',
  'coding.feedback.resize': 'Resize the code feedback panel',
  'coding.brief.examples': 'Examples',
  'coding.brief.showFull': 'Show full brief',
  'coding.brief.showLess': 'Show less',
  'coding.brief.label': 'Task brief',
  'coding.moreActions': 'More actions',
  'coding.preview.idle': 'Run to see the component.',
  'coding.results.got': 'got {value}',
  'coding.types.compilerError': '{n} compiler error',
  'coding.types.compilerErrors': '{n} compiler errors',
  'coding.types.checkFails': '{failing} of {total} type check fails',
  'coding.types.checksFail': '{failing} of {total} type checks fail',
  'coding.verdict.signInAction': 'Sign in',
} as const;

export type WorkbenchKey = keyof typeof workbenchEn;

export function workbenchCopy(key: WorkbenchKey, vars?: Record<string, string | number>): string {
  const template: string = workbenchEn[key];
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (_, name: string) => (name in vars ? String(vars[name]) : `{${name}}`));
}
