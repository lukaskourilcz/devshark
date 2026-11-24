// What a task screen says about the copies of its code (coding/drafts.ts),
// and the learner's ways back: to a copy on this device that did not open,
// past a draft the account refused to overwrite, and, after a sign-out they
// did not choose, to the code kept for their account. The task screen and a
// Learn level's coding step share it.
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { useLanguage } from '../i18n/LanguageContext';
import { codingEn } from '../i18n/translations.codingRoute';
import { draftsEn as copy } from '../i18n/translations.drafts';
import { accountEpoch } from '../lib/accountData';
import { openSignIn } from '../lib/signInDialog';
import { createStore, useStore } from '../lib/store';
import {
  deviceDraft,
  draftConflict,
  keepDraftOverConflict,
  keptDraftTasks,
  restoreDeviceDraft,
  subscribeDraftConflicts,
  takeConflictingDraft,
  type OpeningDraft,
} from './drafts';

const kept = createStore(keptDraftTasks);

interface Choice {
  id: string | null;
  /** What opened since the task loaded, by the learner's choice: the copy
   * from this device taken back, or the account's draft a save from here
   * could not replace. Null until they choose. */
  opening: OpeningDraft | null;
  accountAt: string | null;
  restored: boolean;
  /** Moves whenever the editor must read its code again. */
  version: number;
}
const fresh = (id: string | null): Choice => ({ id, opening: null, accountAt: null, restored: false, version: 0 });

/** The code the editor opens with, the account draft's time it builds on,
 * and the learner's choices about the other copies. The choice lasts while
 * this task is open, through a refetch of its draft, and starts over on
 * another task. The editor reads its code once, so the caller keys it by
 * `version`. */
export function useDraftChoice(id: string | null, opening: OpeningDraft | null, accountAt: string | null | undefined, { signedIn, keepOnDevice = false }: { signedIn: boolean; keepOnDevice?: boolean }) {
  const [choice, setChoice] = useState<Choice>(() => fresh(id));
  if (choice.id !== id) setChoice(fresh(id));
  const [other, setOther] = useState<'loading' | 'failed' | null>(null);
  const conflict = useSyncExternalStore(subscribeDraftConflicts, () => draftConflict(id));
  const keptHere = useStore(kept);
  const chosen = choice.id === id ? choice.opening : null;
  const current = chosen ?? opening;
  const base = chosen ? choice.accountAt : accountAt ?? null;
  const epoch = current?.epoch ?? accountEpoch();
  const reopen = (next: OpeningDraft, at: string | null, restored: boolean) =>
    setChoice((was) => ({ id, opening: next, accountAt: at, restored, version: was.version + 1 }));
  return {
    code: current?.code ?? null,
    opening: current,
    base,
    epoch,
    restored: choice.id === id && choice.restored,
    version: choice.id === id ? choice.version : 0,
    conflict,
    other,
    /** Signed out by the session, with this task's code kept for the account. */
    kept: !signedIn && id !== null && keptHere.includes(id),
    restore: () => {
      if (!id || current?.setAside === undefined) return;
      restoreDeviceDraft(id, current.setAside, base);
      reopen({ code: current.setAside, conflict: null, epoch }, base, true);
    },
    keepMine: () => { if (id) keepDraftOverConflict(id, { signedIn, epoch, keepOnDevice }); },
    openOther: () => {
      if (!id) return;
      setOther('loading');
      // The draft belongs to the account that asked: one that arrives after
      // a sign-out or another sign-in is not opened for whoever is here now.
      const askedAs = accountEpoch();
      takeConflictingDraft(id).then((draft) => {
        setOther(null);
        if (askedAs !== accountEpoch()) return;
        const device = deviceDraft(id);
        const differs = device !== null && device !== draft.code;
        reopen({ code: draft.code, conflict: differs ? 'account' : null, ...(differs ? { setAside: device } : {}), epoch }, draft.updatedAt, false);
      }, () => setOther('failed'));
    },
  };
}

export function DraftNote({ choice }: { choice: ReturnType<typeof useDraftChoice> }) {
  const { t } = useLanguage(codingEn);
  const note = useRef<HTMLParagraphElement | null>(null);
  const { opening, restored } = choice;
  // The button that asked is gone once the copy is back, so focus goes to
  // the line that says so.
  useEffect(() => { if (restored) note.current?.focus(); }, [restored]);
  const restore = <Button variant="secondary" onClick={choice.restore} label={t('coding.draft.restore')} />;
  return (
    <>
      {restored
        ? <p className="cd-note" role="status" tabIndex={-1} ref={note}>{t('coding.draft.deviceRestored')}</p>
        : opening?.conflict === 'account'
          ? <p className="cd-note" role="status">{t('coding.draft.accountNewer')} {restore}</p>
          : (opening?.conflict === 'device' || opening?.setAside !== undefined) && (
            <p className="cd-note" role="status">
              {opening.conflict === 'device' && t('coding.draft.deviceNewer')}
              {opening.setAside !== undefined && <> {copy['coding.draft.aside']} {restore}</>}
            </p>
          )}
      {choice.conflict && (
        <p className="cd-note cd-note--warn" role="status">
          {copy['coding.draft.conflict']}{' '}
          <Button variant="secondary" onClick={choice.keepMine} label={copy['coding.draft.keepMine']} />{' '}
          <Button variant="secondary" onClick={choice.openOther} isLoading={choice.other === 'loading'} isInterruptible label={copy['coding.draft.openOther']} />
          {choice.other === 'failed' && <> {copy['coding.draft.otherFailed']}</>}
        </p>
      )}
      {choice.kept && (
        <p className="cd-note cd-note--warn" role="status">
          {copy['coding.draft.kept']} <Button variant="secondary" onClick={() => openSignIn()} label={t('auth.logIn')} />
        </p>
      )}
    </>
  );
}
