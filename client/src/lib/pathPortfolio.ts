/** Export saved writing as data, without turning a draft into a reviewed submission. */
import type { PathDraft } from '../../../shared/learning-path-api';
import type { EvidenceState, LearningPathManifest } from '../../../shared/learning-paths';

export interface PortfolioEntry {
  module: string;
  activityId: string;
  title: string;
  recordedState: EvidenceState;
  saved: PathDraft | null;
}
export const PORTFOLIO_NOTE = 'The latest saved version of each written piece, drafts included. Saved text may differ from the last submission. The writing is self-reviewed, and this export is not an independent assessment.';

export function portfolioDocument(manifest: LearningPathManifest, entries: PortfolioEntry[]) {
  return { format: 'devshark-path-writing-v1', path: manifest.id, curriculumVersion: manifest.version,
    title: manifest.title, note: PORTFOLIO_NOTE, entries };
}

/** Fences prevent saved Markdown/HTML from becoming embedded links or images. */
function literal(value: string): string {
  const longest = Math.max(0, ...Array.from(value.matchAll(/`+/g), match => match[0].length));
  const fence = '`'.repeat(Math.max(3, longest + 1));
  return `${fence}text\n${value}\n${fence}`;
}
/** Old draft writes allowed non-text fields. Preserve their data in the same
 * literal fence so one legacy field cannot stop the entire export. */
function savedText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && value.every((item) => typeof item === 'string')) return value.join('\n');
  return JSON.stringify(value) ?? '';
}
/** Draft field keys are caller-authored too; keep them on one escaped heading line. */
function fieldLabel(id: string): string {
  return id.replace(/-/g, ' ').replace(/[\r\n]/g, ' ').replace(/[\\`*_{}\[\]<>#+.!|]/g, '\\$&');
}
/** Markdown is read by people, so states use their display labels; JSON keeps the raw value. */
export function portfolioMarkdown(manifest: LearningPathManifest, entries: PortfolioEntry[],
  stateLabel: (state: EvidenceState) => string = state => state): string {
  return [`# ${manifest.title} — saved writing`, '', PORTFOLIO_NOTE, '', `Curriculum version: ${manifest.version}`, '',
    ...entries.flatMap(entry => [
      `## ${entry.title}`, '', `Module: ${entry.module}`, `Activity: ${entry.activityId}`,
      `Recorded state: ${stateLabel(entry.recordedState)}`, `Saved revision: ${entry.saved?.revision ?? 'none'}`,
      `Saved at: ${entry.saved?.updatedAt ?? 'not saved'}`, '',
      ...(entry.saved?.content.artifact ? Object.entries(entry.saved.content.artifact).flatMap(([id, value]) => [
        `### ${fieldLabel(id)}`, '', literal(savedText(value)), '',
      ]) : ['No saved writing for this activity.', '']),
    ]),
  ].join('\n');
}
