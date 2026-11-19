// Presentation only. Full values have already been evaluated and compared.
import { LOG_LINE_CUT, MAX_LOG_LINE_CHARS, type EvaluateResult } from '../../../../shared/coding-evaluate';
import { cutErrorText } from '../../../../shared/coding-error-text';

const displayText = (text: string | null): string | null => {
  if (text === null) return null;
  // A prior compiler/error boundary may already have cut at a surrogate.
  // Recutting that marker-bearing prefix can add a space at the old boundary.
  if (text.length <= MAX_LOG_LINE_CHARS + LOG_LINE_CUT.length && text.endsWith(LOG_LINE_CUT)) return text;
  return cutErrorText(text);
};

export function cutRunDisplay(run: EvaluateResult): EvaluateResult {
  return {
    ...run,
    results: run.results.map(result => ({ ...result, actual: displayText(result.actual), error: displayText(result.error) })),
    codeError: displayText(run.codeError),
  };
}
