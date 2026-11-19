/** Code snippets as a question format, rather than as a subject.
 *
 * Code Snippets used to be a devShark topic: a collection of language tricks
 * with nothing tying any of them to what the learner was building. The
 * confusion underneath it was between the *subject* — what is being learned —
 * and the *format* — how it is practised. Reading a piece of code and
 * predicting what it does is a format. It belongs inside JavaScript when it
 * teaches closures, inside React when it teaches state updates, and inside DSA
 * when it teaches what a queue costs.
 *
 * So the topic is retired and this is what replaced it: metadata a question in
 * any topic can carry, saying what language the code is in, which kind of
 * reading it asks for, and what it is teaching. Declared, not inferred — a
 * fenced code block is not by itself a snippet question, and guessing from the
 * text would make the count and the pacing meaningless.
 *
 * Reading is not writing. A snippet question is evidence that the learner can
 * follow code; the coding tasks remain the evidence that they can produce it,
 * and neither stands in for the other. That is why this lives beside the
 * question rather than inside the coding contracts. */

/** What kind of reading the snippet asks for. One per question. */
const SNIPPET_SUBTYPES = [
  /** What does this produce, or what state does it end in? */
  'predict',
  /** Which line is wrong, or what is the smallest correct repair? */
  'find-bug',
  /** Which implementation satisfies the stated requirement? */
  'choose-implementation',
  /** Follow the order of execution, the data flow, or an operation on a structure. */
  'trace',
  /** Which expression or line completes it? */
  'complete',
] as const;
export type SnippetSubtype = (typeof SNIPPET_SUBTYPES)[number];

/** The notation the code is written in. `pseudocode` and `sql` are here because
 * not every readable snippet is a program in a language we run. */
const SNIPPET_LANGUAGES = [
  'javascript', 'typescript', 'jsx', 'html', 'css', 'sql', 'bash', 'yaml', 'diff', 'pseudocode',
] as const;
export type SnippetLanguage = (typeof SNIPPET_LANGUAGES)[number];

/** Versioned so a later change to what the metadata means is a new version
 * rather than a silent reinterpretation of what authors already wrote. */
const SNIPPET_METADATA_VERSION = 1;

export interface SnippetMeta {
  version: typeof SNIPPET_METADATA_VERSION;
  language: SnippetLanguage;
  subtype: SnippetSubtype;
  /** One line on what this question teaches. Not shown to the learner; it is
   * what makes a coverage report possible and a duplicate obvious. */
  objective: string;
  /** Concepts the learner needs before this makes sense, so a snippet is never
   * placed ahead of the lesson that explains it. */
  requires?: string[];
  /** Anything the reader has to assume — a runtime, a version, an ordering —
   * stated rather than left for them to guess wrong. */
  assumes?: string;
}
