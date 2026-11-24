import { useEffect, useRef, type RefObject } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@astryxdesign/core/Button';
import { Tooltip } from '@astryxdesign/core/Tooltip';
import { useT } from '../i18n/LanguageContext';
import { codingEn } from '../i18n/translations.codingRoute';
import { InfoIcon } from '../components/ui/icons';
import { workbenchCopy } from '../i18n/translations.workbench';
import { openSignIn } from '../lib/signInDialog';
import type { ComplexityGuidance, ComplexityReport } from '../../../shared/coding-complexity';
import './Coding.css';

export function ComplexityInfo({ guidance }: { guidance: ComplexityGuidance }) {
  const t = useT(codingEn);
  return <Tooltip placement="above" content={<div className="cd-complexity__tip"><p>{guidance.note}</p><p>{t('coding.complexity.learn')}</p></div>}>
    <Button as={Link} href="/big-o" variant="ghost" isIconOnly icon={<InfoIcon size={16} />} label={t('coding.complexity.info')} className="cd-complexity__info" />
  </Tooltip>;
}

/** Every coding screen renders the actual server award and the same two actions. */
export function CodingCompletion({ xp, complexity, nextHref, onNext, backHref, sectionRef, signInToRecord = false }: {
  xp: number; complexity?: ComplexityReport | null; nextHref?: string; onNext?: () => void; backHref: string;
  /** Signed out: the pass was checked but not recorded, so say so here, with
   * Sign in, the moment it matters (UX audit coding-10). */
  signInToRecord?: boolean;
  sectionRef?: RefObject<HTMLElement | null>;
}) {
  const t = useT(codingEn);
  const ownRef = useRef<HTMLElement>(null);
  const ref = sectionRef ?? ownRef;
  useEffect(() => { ref.current?.focus(); }, [ref]);
  const above = complexity?.assessment === 'above-target' && Boolean(complexity.time);
  return <div className="cd-complete">
    <section ref={ref} tabIndex={-1} className={`cd-verdict cd-verdict--${above ? 'warning' : 'passed'}`}>
      <h1 className="cd-verdict__title">{t('coding.verdict.passed')} <span>{t('coding.verdict.xp', { xp })}</span></h1>
      {complexity?.time && <p className="cd-verdict__row">{t('coding.complexity.result', { complexity: complexity.time })}</p>}
      {signInToRecord && <p className="cd-verdict__row cd-verdict__signin">{t('coding.verdict.signIn')} <Button variant="secondary" aria-haspopup="dialog" onClick={() => openSignIn()} label={workbenchCopy('coding.verdict.signInAction')} /></p>}
    </section>
    <div className="cd-verdict__actions">
      {onNext ? <Button variant="primary" onClick={onNext} label={t('coding.verdict.next')} />
        : nextHref ? <Button variant="primary" as={Link} href={nextHref} label={t('coding.verdict.next')} />
        : <Button variant="primary" isDisabled label={t('coding.verdict.next')} />}
      <Button variant="secondary" as={Link} href={backHref} label={t('coding.verdict.back')} />
    </div>
  </div>;
}
