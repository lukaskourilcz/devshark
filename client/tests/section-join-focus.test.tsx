// The section join's focus (components/learn/SectionSwitcher.tsx). A retry
// removes the Try again that held focus; the saving join button takes it in
// that same commit, so focus never rests on <body> during the save, where the
// app's first-page route focus (App.tsx) would read it as nobody's and move
// it to the page. The saved line then takes it.
import { trackAnnouncement } from './announcement';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SectionHeader, type JoinState } from '../src/components/learn/SectionSwitcher';

function header(join: JoinState | null, isMember = false) {
  return (
    <SectionHeader
      section="software-engineer"
      name="Software Engineer"
      isMember={isMember}
      hasPlan
      signedIn
      authLoading={false}
      online
      join={join}
      onJoin={() => {}}
      onRetry={() => {}}
      onSignIn={() => {}}
      premiumLabel="Premium"
      retryLabel="Try again"
    />
  );
}

describe('the section join’s focus', () => {
  it('goes from Try again to the saving button, then to the saved line, never to <body>', () => {
    const { rerender } = render(header(null));
    const verifyAnnouncement = trackAnnouncement('.rm-section-status');
    rerender(header({ status: 'error', step: 'save' }));
    expect(screen.getByRole('button', { name: 'Try again' })).toHaveFocus();

    rerender(header({ status: 'saving' }));
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Adding…' })).toHaveFocus();

    rerender(header({ status: 'saved' }, true));
    expect(screen.getByRole('status')).toHaveTextContent('Software Engineer is in your plan.');
    verifyAnnouncement('Software Engineer is in your plan.');
    expect(screen.getByRole('status')).toHaveFocus();
  });

  it('leaves focus where the learner moved it during the save', () => {
    const { rerender } = render(
      <>
        <button type="button">Elsewhere</button>
        {header(null)}
      </>,
    );
    rerender(<><button type="button">Elsewhere</button>{header({ status: 'error', step: 'save' })}</>);
    rerender(<><button type="button">Elsewhere</button>{header({ status: 'saving' })}</>);
    screen.getByRole('button', { name: 'Elsewhere' }).focus();
    rerender(<><button type="button">Elsewhere</button>{header({ status: 'saved' }, true)}</>);
    expect(screen.getByRole('button', { name: 'Elsewhere' })).toHaveFocus();
  });
});
