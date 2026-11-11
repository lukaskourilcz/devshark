// The Big O introduction's opening screen (/learn/big-o, UX audit learn-19):
// the Learn page header with "Big O guide" as the context link above the h1
// (as the FDE module page's kicker), then the two lessons side by side, the
// first as the one SwimCta md and the second a 44px secondary, each with its
// place in the pair under it. The guide's paragraph is not repeated here.
import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@astryxdesign/core/Button';
import { SwimCta } from '../landing/LandingKit';
import { useLanguage } from '../../i18n/LanguageContext';
import { LearnPageHeader } from './LearnPageHeader';
import './BigOLessons.css';

export function BigOLessons({ onOpen, returnFocusTo }: { onOpen: (lesson: 1 | 2) => void; returnFocusTo: 1 | 2 | null }) {
  const { t } = useLanguage();
  const lessons = useRef<HTMLUListElement>(null);
  useEffect(() => {
    if (returnFocusTo !== null) {
      lessons.current?.querySelector<HTMLButtonElement>(`[data-lesson="${returnFocusTo}"] button`)?.focus();
    }
  }, [returnFocusTo]);
  return (
    <div className="de-page">
      <LearnPageHeader
        context={<Link to="/big-o">{t('bigO.guide')}</Link>}
        title={t('bigO.pathTitle')}
        lead={t('bigO.pathLead')}
      />
      <ul className="bo-lessons" ref={lessons}>
        <li className="bo-lesson" data-lesson="1">
          <SwimCta label={t('bigO.firstLesson')} onClick={() => onOpen(1)} />
          <span className="bo-lesson__count">{t('bigO.lessonOf', { n: 1, total: 2 })}</span>
        </li>
        <li className="bo-lesson" data-lesson="2">
          <Button className="ss-action" variant="secondary" label={t('bigO.secondLesson')} onClick={() => onOpen(2)} />
          <span className="bo-lesson__count">{t('bigO.lessonOf', { n: 2, total: 2 })}</span>
        </li>
      </ul>
    </div>
  );
}

export default BigOLessons;
