// The small public pages that share one layout (`Page`): the classroom
// invitation and the not-found page. The Terms and the privacy policy live in
// LegalPages.tsx; the voluntary-support page is retired (#222) and /support
// redirects to /premium.
import { useEffect, type Ref } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { useLocation, useNavigate } from 'react-router-dom';
import { useT } from '../i18n/LanguageContext';
import { SwimmingFin } from './SharkFin';

export function Page({ kicker, title, lead, children, titleRef }: {
  kicker?: string;
  title: string;
  lead: string;
  children: React.ReactNode;
  titleRef?: Ref<HTMLHeadingElement>;
}) {
  return <article className="ss-info-page">
    <header className="ss-info-page__header">
      <SwimmingFin size={26} />
      {/* The kicker line is always drawn, empty when there is none, so the
          h1 sits at one y on every Page (UX audit shell-public-13). */}
      <span className="ss-info-page__kicker" aria-hidden={kicker ? undefined : true}>{kicker}</span>
      <h1 ref={titleRef} tabIndex={titleRef ? -1 : undefined}>{title}</h1>
      <p>{lead}</p>
    </header>
    {children}
  </article>;
}

export function ClassroomPage() {
  const t = useT(); const navigate = useNavigate();
  // One sentence and the two actions straight under it: a card around one
  // row of buttons was 920px of mostly empty surface (social-account-23).
  return <Page title={t('classroomPage.title')} lead={t('classroomPage.lead')}><div className="ss-info-actions"><Button variant="primary" label={t('classroomPage.create')} onClick={() => navigate('/play?mode=classroom')} /><Button variant="secondary" label={t('classroomPage.join')} onClick={() => navigate('/play')} /></div></Page>;
}

export function NotFoundPage() {
  const t = useT(); const navigate = useNavigate(); const location = useLocation();
  // A missing page opened in a new tab has nothing behind it, and "Go back"
  // did nothing at all: there it goes home instead.
  const back = () => {
    if (location.key === 'default' && window.history.length <= 1) navigate('/');
    else navigate(-1);
  };
  // A missing page stays out of search results: noindex while it shows, gone
  // once it does not. The mark keeps the shell's head (lib/routeHead.ts),
  // which rewrites the robots line on every route, off this one.
  useEffect(() => {
    const robots = document.createElement('meta');
    robots.name = 'robots'; robots.content = 'noindex'; robots.dataset.notFound = '';
    document.head.append(robots);
    return () => robots.remove();
  }, []);
  return <Page kicker={t('notFoundPage.kicker')} title={t('notFoundPage.title')} lead={t('notFoundPage.lead')}><div className="ss-info-actions"><Button variant="primary" label={t('notFoundPage.home')} onClick={() => navigate('/')} /><Button variant="secondary" label={t('notFoundPage.back')} onClick={back} /></div></Page>;
}
