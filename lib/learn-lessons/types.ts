/** The authored lesson shape. One shape serves Learn levels and the learning
 * paths: a Learn level may carry a `lessonId` (lib/learn-lessons/levels.ts),
 * and a path module lists its lessons. `lib/learning-paths/types.ts`
 * re-exports everything here, so path content keeps importing it from there.
 *
 * Lessons hold no answers. Reading one is free, never gates a step and
 * records nothing; the public projection in `./index.ts` still names its
 * fields one by one, so nothing authored later leaks by default. */

import type { SourceReference } from '../../shared/learning-paths';
import type { LessonSection, TraceFrame, TraceSpec } from '../../shared/learning-path-api';

export type LessonSectionSource =
  | { kind: 'prose'; body: string }
  | { kind: 'code'; language: string; code: string; caption: string }
  | { kind: 'table'; caption: string; headers: string[]; rows: string[][] }
  | { kind: 'trace'; caption: string; trace: TraceSource }
  /** A snippet the learner may change and run. Exploration only: nothing about
   * it is graded or recorded, which the note says in the learner's language. */
  | { kind: 'example'; language: string; code: string; caption: string; note: string }
  | { kind: 'callout'; tone: 'note' | 'warning'; body: string };

/** @public Reexported by the learning-path lesson authoring facade in lib/learning-paths/types.ts. */
export interface TraceSource {
  shape: TraceSpec['shape'];
  legend?: string[];
  frames: {
    cells: string[];
    marks?: TraceFrame['marks'];
    note: string;
    counter?: { label: string; value: number };
  }[];
}

export interface LessonSource {
  id: string;
  title: string;
  summary: string;
  estimatedMinutes: number;
  sources: SourceReference[];
  sections: LessonSectionSource[];
}

export function mergeLessonSection(section: LessonSectionSource): LessonSection {
  switch (section.kind) {
    case 'prose':
      return { kind: 'prose', body: section.body };
    case 'callout':
      return { kind: 'callout', tone: section.tone, body: section.body };
    case 'code':
      return { kind: 'code', language: section.language, code: section.code, caption: section.caption };
    case 'example':
      return {
        kind: 'example',
        language: section.language,
        code: section.code,
        caption: section.caption,
        note: section.note,
      };
    case 'table':
      return {
        kind: 'table',
        caption: section.caption,
        headers: section.headers,
        rows: section.rows,
      };
    case 'trace':
      return {
        kind: 'trace',
        caption: section.caption,
        trace: {
          shape: section.trace.shape,
          ...(section.trace.legend ? { legend: section.trace.legend } : {}),
          frames: section.trace.frames.map((frame) => ({
            cells: frame.cells,
            ...(frame.marks ? { marks: frame.marks } : {}),
            note: frame.note,
            ...(frame.counter
              ? { counter: { label: frame.counter.label, value: frame.counter.value } }
              : {}),
          })),
        },
      };
  }
}

export interface MergedLesson {
  id: string;
  title: string;
  summary: string;
  estimatedMinutes: number;
  sources: SourceReference[];
  sections: LessonSection[];
}

export function mergeLesson(lesson: LessonSource): MergedLesson {
  return {
    id: lesson.id,
    title: lesson.title,
    summary: lesson.summary,
    estimatedMinutes: lesson.estimatedMinutes,
    sources: lesson.sources,
    sections: lesson.sections.map(mergeLessonSection),
  };
}
