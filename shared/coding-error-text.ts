/** Error text a program produced, cut the way a console line is. A top-level
 * `throw 'x'.repeat(5e6)` came back whole as the run's error, five megabytes
 * in one Submit response. A failed `toBe` on 300 000 rendered characters went
 * into the React verdict whole, and the API refuses a verdict line past
 * 256 000 characters (lib/coding/react-guest.ts), so the learner's own mistake
 * read as a grader outage. The cut never splits a surrogate pair.
 *
 * The QuickJS grader (lib/coding/sandbox.ts), the React learner engine
 * (lib/coding/react-learner.ts) and the React runner (lib/coding/react-runner.ts)
 * share it. It imports two constants and nothing else, so the React guest
 * bundle that carries it pulls in none of the QuickJS grader's preludes. */
import { LOG_LINE_CUT, MAX_LOG_LINE_CHARS } from './coding-evaluate';

export const cutErrorText = (text: string): string => {
  if (text.length <= MAX_LOG_LINE_CHARS) return text;
  const last = text.charCodeAt(MAX_LOG_LINE_CHARS - 1);
  return text.slice(0, last >= 0xd800 && last <= 0xdbff ? MAX_LOG_LINE_CHARS - 1 : MAX_LOG_LINE_CHARS) + LOG_LINE_CUT;
};
