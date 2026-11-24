// The account widget in the header: avatar, sign-in / out, and the account menu.
//
// Redesigned on the Astryx design system: Astryx Avatar + a level Badge for the
// signed-in identity and Astryx Text for the name / rank. The account dropdown
// uses an Astryx Popover (trigger = the account button, content = a column of
// action buttons). The signed-out call to action is SignInButton, which the
// header draws without this chunk.

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Avatar } from '@astryxdesign/core/Avatar';
import { Badge } from '@astryxdesign/core/Badge';
import { Text } from '@astryxdesign/core/Text';
import { Skeleton } from '@astryxdesign/core/Skeleton';
import { Popover } from '@astryxdesign/core/Popover';
import { AppToast } from './ui/AppToast';
import SignInButton, { focusSignInAfterSignOut } from './SignInButton';
import { useT } from '../i18n/LanguageContext';
import { useAuth, getUserProfile } from '../lib/auth';
import { useQuestXp } from '../lib/xp';
import { useRoadmapProgress } from '../lib/roadmap';
import { computeLearningXp, levelForXp } from '../lib/leveling';
import { useTrack, rankLabelKeyFor } from '../lib/tracks';
import { useEquippedRingColor } from '../lib/shop';
import { useWallet } from '../lib/rewards';
import { CrownBadge } from './ui/Crown';
import { useActiveSubject, topicSetForSubject } from '../lib/subjects';
import './AuthButton.css';

// A single row in the account dropdown — a full-width, left-aligned button that
// mimics a menu item without pulling in MUI's MenuItem.
//
// The fill is CSS rather than a React hover flag on purpose: a flag set by
// onMouseEnter never fires for a keyboard user, so tabbing to Log out gave no
// indication of where you were. `:hover, :focus-visible` covers both, and the
// focus ring stays on top of the fill.
function MenuAction({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" className="ss-account-menu__item" onClick={onClick}>
      {label}
    </button>
  );
}

function AuthButton() {
  const { isAuthenticated, isLoading, user, signOut } = useAuth();
  const profile = getUserProfile(user);
  // Subscribe to roadmap progress once; derive total XP locally rather than
  // calling useTotalXp() (which would set up a second subscription). XP is
  // per subject, so only the active subject's topics count.
  const progress = useRoadmapProgress();
  const questXp = useQuestXp();
  const subject = useActiveSubject();
  const totalXp = computeLearningXp(progress, topicSetForSubject(subject.id)) + questXp;
  const ringColor = useEquippedRingColor();
  const wallet = useWallet(true);
  const wearsCrown = (wallet.data?.cosmetics ?? []).some((one) => one.id === 'crown' && one.equipped);
  const [track] = useTrack();
  const levelInfo = levelForXp(totalXp);
  const navigate = useNavigate();
  const t = useT();
  const rankKeys = rankLabelKeyFor(levelInfo.rank, track);
  const rankTitle = t(rankKeys.key, rankKeys.vars);
  const [menuOpen, setMenuOpen] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const open = menuOpen;

  const handleProfile = () => {
    setMenuOpen(false);
    navigate('/profile');
  };
  const handleLogout = () => {
    setMenuOpen(false);
    focusSignInAfterSignOut();
    void signOut().catch(() => {
      focusSignInAfterSignOut(false);
      setAuthError(t('auth.signOutFailed'));
    });
  };

  if (isLoading) {
    // Mirror the signed-in footprint (48px avatar + text column on wide
    // screens) so the toolbar doesn't reflow when auth resolves.
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 4 }} aria-label={t('auth.loadingAccount')}>
        <Skeleton width={48} height={48} radius="rounded" />
        <div className="ss-show-wide" style={{ flexDirection: 'column', gap: 4 }}>
          <Skeleton width={96} height={12} radius={2} />
          <Skeleton width={128} height={10} radius={2} />
        </div>
      </div>
    );
  }

  // The header renders SignInButton itself for a signed-out visitor and
  // mounts this widget only while a session loads or exists; the branch keeps
  // the widget right on its own.
  if (!isAuthenticated) return <SignInButton />;

  const displayName = profile.name?.split(' ')[0] || profile.email?.split('@')[0] || t('auth.account');

  return (
    <>
    <Popover
      isOpen={menuOpen}
      onOpenChange={setMenuOpen}
      placement="below"
      alignment="end"
      width={168}
      label={t('auth.accountMenu', { name: displayName })}
      content={
        // No minWidth here. The popover surface is 168px wide and carries
        // 12px of padding on every side, so its content box is 144px; a child
        // asking for 168 is 24px wider than the space it has, and the rows'
        // hover fill was painting that overflow outside the popover's rounded
        // edge. Filling the content box is the whole fix.
        <div className="ss-account-menu">
          <MenuAction label={t('auth.profile')} onClick={handleProfile} />
          <MenuAction label={t('auth.logOut')} onClick={handleLogout} />
        </div>
      }
    >
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          maxWidth: 240,
          margin: 0,
          padding: 4,
          background: 'transparent',
          border: 'none',
          borderRadius: 14,
          cursor: 'pointer',
        }}
      >
        <span className="ss-sr-only">{t('auth.accountMenu', { name: displayName })} </span>
        <div
          aria-hidden="true"
          style={{
            display: 'flex',
            flexShrink: 0,
            borderRadius: '50%',
            position: 'relative',
            ...(ringColor
              ? { padding: 2, background: `${ringColor}22`, boxShadow: `0 0 0 1.5px ${ringColor}` }
              : null),
          }}
        >
          <Avatar src={profile.picture} name={displayName} alt="" size="medium" />
          {/* The crown sits on the avatar, and the avatar carries the name: the
              crown itself is decorative, described once in the label below
              rather than announced as a second thing. */}
          {wearsCrown && <CrownBadge size={16} />}
        </div>
        {/* Name + rank are a wide-desktop luxury: below 1080px the widget is
            the avatar alone, so it can never crowd the centre nav. The rank
            stays on ONE ellipsized line (full title on hover + in Profile) so
            the 56px toolbar height never changes with title length. */}
        <div
          className="ss-show-wide"
          style={{
            flexDirection: 'column',
            alignItems: 'flex-start',
            minWidth: 0,
            maxWidth: 170,
            gap: '2px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, maxWidth: '100%' }}>
            <Text aria-hidden="true" type="body" weight="medium" color="primary" maxLines={1}>
              {displayName}
            </Text>
            <Badge variant="green" label={levelInfo.level} />{' '}
          </div>
          <span title={rankTitle} style={{ display: 'block', maxWidth: '100%', minWidth: 0 }}>
            <Text type="supporting" size="xsm" color="accent" weight="semibold" maxLines={1}>
              {rankTitle}
            </Text>
          </span>
          {/* Thin progress bar toward the next rank — ambient goal feedback
              with zero extra copy. Hidden at the ladder cap. */}
          {!levelInfo.isMax && (
            <div
              aria-hidden
              style={{
                marginTop: 2,
                width: '100%',
                height: 3,
                borderRadius: 2,
                background: 'rgba(128,128,128,0.25)',
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  width: `${levelInfo.progressPct}%`,
                  height: '100%',
                  borderRadius: 2,
                  background: 'var(--brand-accent)',
                  transition: 'width 0.4s ease',
                }}
              />
            </div>
          )}
        </div>
      </button>
    </Popover>
    <AppToast open={!!authError} onClose={() => setAuthError(null)} severity="error" message={authError} autoHideDuration={8000} />
    </>
  );
}

export default AuthButton;
