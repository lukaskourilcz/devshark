import type { CodingVerdictResponse } from '../../../shared/coding-api';
import { useLanguage } from '../i18n/LanguageContext';
import { codingEn } from '../i18n/translations.codingRoute';
import { clockTime } from '../lib/xp';

/** One line under a verified pass about earning the task's XP again
 * (migration 058): after a reset, from an hour after the task last paid its
 * XP. It says why this pass paid nothing when the reason is the rule, and
 * stays out of the way of a pass after a reveal, whose title already says so.
 * A pass that paid nothing is also told in a toast (`submitCoding`); this line
 * stays on the card after the toast goes. */
export function RepeatXpNote({ verdict }: { verdict: CodingVerdictResponse }) {
  const { t } = useLanguage(codingEn);
  const repeat = verdict.repeatXp;
  if (verdict.verdict !== 'passed' || !repeat || verdict.xpForfeited) return null;
  const time = repeat.availableAt ? clockTime(repeat.availableAt) : null;
  const line = repeat.withheld === 'reset'
    ? t('coding.repeat.needsReset')
    : repeat.withheld === 'cooldown' && time
      ? t('coding.repeat.cooldown', { time })
      : time ? t('coding.repeat.next', { time }) : null;
  return line ? <p className="cd-verdict__row">{line}</p> : null;
}
