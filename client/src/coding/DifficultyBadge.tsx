// The Easy, Medium or Hard label on a listed challenge (#224). The label is
// text in every theme; the badge never relies on colour, and a screen reader
// hears "Difficulty Easy" rather than a bare adjective.
import { Badge } from '@astryxdesign/core/Badge';
import { useLanguage } from '../i18n/LanguageContext';
import { codingEn } from '../i18n/translations.codingRoute';
import type { Difficulty } from '../../../shared/coding-catalog';
import './DifficultyBadge.css';

export function DifficultyBadge({ difficulty }: { difficulty: Difficulty }) {
  const { t } = useLanguage(codingEn);
  return (
    <Badge
      variant="neutral"
      className="cd-difficulty"
      data-difficulty={difficulty}
      label={<><span className="cd-difficulty__prefix">{t('coding.difficulty.prefix')} </span>{t(`coding.difficulty.${difficulty}`)}</>}
    />
  );
}
