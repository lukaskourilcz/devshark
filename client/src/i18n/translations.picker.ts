import { FDE_SECTION_VISIBLE } from '../../../shared/learn-section-ids';

// The learning-path picker (components/PathPickerDialog.tsx) and the Profile
// card that opens it (components/paths/LearningPathsCard.tsx). English only,
// like translations.ts. Only the Profile chunk reads these words, and the app
// shell has no budget to spare for them (docs/quality/bundle-budget.json), so
// they live here as the privacy policy's words live in translations.privacy.ts.
// The four picker keys the Career page and the route titles read stay in
// translations.ts.

export const pickerEn = {
  'home.pathDialogTitle': 'Choose your learning path',
  'home.pathCurrent': 'Current',
  'paths.picker.trackSubtitle': 'This is your Web Developer focus. It decides which topics come first.',
  'paths.picker.trackFootnote': 'Switching tracks later reorders what is recommended. It never deletes progress.',

  // Step 2: the sections beside the track. Software Engineer is free to join;
  // the Forward Deployed Engineer card keeps the Premium mark on a free plan.
  'paths.picker.sectionsTitle': 'Add a section?',
  'paths.picker.sectionsSubtitle': FDE_SECTION_VISIBLE ? 'Web Developer comes with your track. Both of these are optional.' : 'Web Developer comes with your track. Software Engineer is optional.',
  'paths.picker.seBlurb': 'Data structures, algorithms, system design, DevOps and security, beside your track.',
  'paths.picker.seFree': 'Free to join. Each topic keeps its own free and Premium levels.',
  'paths.picker.specializationLegend': 'Specialization',
  'paths.picker.noneLabel': 'Continue without a specialization',
  'paths.picker.noneBlurb': 'Stay with the foundations and the coding challenges. You can add a specialization later without losing anything.',
  'paths.picker.fdeBlurb': 'devShark’s flagship section: scope a customer problem, integrate their systems, set limits on what a model may do, evaluate, ship and hand over.',
  // The requirement itself is the FDE manifest's `entryRequirement`, the text
  // the path page shows, so the two cannot drift apart.
  'paths.picker.fdeEntry': 'Before you start: {requirement}',
  'paths.picker.sectionsFootnote': 'Leave a section later and its topics drop out of your plan, while every level you passed stays passed.' + (FDE_SECTION_VISIBLE ? ' Removing the specialization pauses its path and keeps your work.' : ''),

  'paths.picker.continue': 'Continue',
  'paths.picker.back': 'Back',
  'paths.picker.cancel': 'Cancel',
  'paths.picker.save': 'Save',
  'paths.picker.accountSaveFailed': 'Your track and specialization are kept on this device. Your sections and answers are not saved to your account yet. Try again.',
  'paths.picker.enrollFailed': 'A path could not be started or paused, so your choices are not saved to your account yet. Try again.',

  'profile.picker.title': 'A little about your learning',
  'profile.picker.subtitle': 'Three answers size your daily plan.',
  'profile.picker.goalsLegend': 'What are you working towards?',
  'profile.picker.goalsHint': 'Pick up to {max}.',
  'profile.picker.experienceLegend': 'How much have you built so far?',
  'profile.picker.experienceHint': 'Changes how things are explained. It never skips a level.',
  'profile.picker.studyTimeLegend': 'On a day you study, how long do you have?',
  'profile.picker.studyTimeHint': 'Sets the size of your daily plan.',
  'profile.picker.incomplete': 'Answer all three to finish.',
  'profile.picker.footnote': 'Change any of this later in your profile.',
  'profile.goal.first-job': 'Get my first developer job',
  'profile.goal.change-track': 'Move into a different part of the stack',
  'profile.goal.level-up': 'Get better at what I already do',
  'profile.goal.interview-prep': 'Prepare for interviews',
  'profile.goal.side-projects': 'Build my own projects',
  'profile.experience.unsure': "I'm not sure yet",
  'profile.experience.new': 'New to programming',
  'profile.experience.some': 'I have built a few things',
  'profile.experience.professional': 'I write code professionally',
  'profile.studyTime.under-15': 'Under 15 minutes',
  'profile.studyTime.15-30': '15 to 30 minutes',
  'profile.studyTime.30-60': '30 to 60 minutes',
  'profile.studyTime.60-plus': 'An hour or more',

  // The Profile card.
  'profile.pathTitle': 'Track and sections',
  'profile.pathHelp': FDE_SECTION_VISIBLE ? 'Your track orders the Web Developer section. Software Engineer and Forward Deployed Engineer are optional sections beside it.' : 'Your track orders the Web Developer section. Software Engineer is an optional section beside it.',
  'profile.pathChoose': 'Choose your path',
  'profile.completePrompt': 'A few answers are missing, so your daily plan is not sized to you yet.',
  'profile.completeAction': 'Finish your profile',
  'profile.sectionsJoined': 'Sections: {sections}',
  'profile.fdeRefused': 'Forward Deployed Engineer needs Premium, so it is not on your plan yet.',
  'profile.inventory.goals': 'Goals',
  'profile.inventory.experience': 'Experience',
  'profile.inventory.studyTime': 'Study time',
  'profile.section.web-developer': 'Web Developer',
  'profile.section.software-engineer': 'Software Engineer',
  'profile.section.forward-deployed-engineer': 'Forward Deployed Engineer',
} as const;

export type PickerKey = keyof typeof pickerEn;

/** A picker string with its `{name}` placeholders filled, as `t()` fills them.
 * A key with no entry (one built at runtime from an option id the dictionary
 * does not name yet) reads as the key itself, as it does through `t()`. */
export function pickerCopy(key: PickerKey, vars?: Record<string, string | number>): string {
  const template: string = (pickerEn as Record<string, string>)[key] ?? key;
  return vars ? template.replace(/\{(\w+)\}/g, (match, name: string) => (name in vars ? String(vars[name]) : match)) : template;
}
