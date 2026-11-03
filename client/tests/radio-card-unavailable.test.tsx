import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { RadioCard, RadioCardGroup } from '../src/components/ui/RadioCards';

describe('inspecting an unavailable radio card', () => {
  it('lets arrows focus the reason without selecting or activating gated content', () => {
    const select = vi.fn();
    const activate = vi.fn();
    const inspect = vi.fn();
    render(<RadioCardGroup value="open" onChange={select} onActivate={activate} label="Topics" orientation="horizontal">
      <RadioCard index={0} value="open" label="Open">Open</RadioCard>
      <RadioCard index={1} value="locked" label="Locked" unavailable onUnavailable={inspect} describedBy="why">Locked</RadioCard>
      <RadioCard index={2} value="next" label="Next">Next</RadioCard>
      <p id="why">Pass the first part test.</p>
    </RadioCardGroup>);
    const open = screen.getByRole('radio', { name: 'Open' });
    const locked = screen.getByRole('radio', { name: 'Locked' });
    fireEvent.keyDown(open, { key: 'ArrowRight' });
    expect(locked).toHaveFocus();
    expect(locked).toHaveAttribute('aria-disabled', 'true');
    expect(locked).toHaveAccessibleDescription('Pass the first part test.');
    expect(open).toHaveAttribute('aria-checked', 'true');
    expect(locked).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(locked);
    expect(inspect).toHaveBeenCalledOnce();
    expect(select).not.toHaveBeenCalled();
    expect(activate).not.toHaveBeenCalled();
    fireEvent.keyDown(locked, { key: 'ArrowRight' });
    expect(screen.getByRole('radio', { name: 'Next' })).toHaveFocus();
    expect(select).toHaveBeenCalledWith('next');
  });

  it('keeps ordinary disabled choices outside arrow navigation', () => {
    const select = vi.fn();
    render(<RadioCardGroup value="first" onChange={select} label="Answers">
      <RadioCard index={0} value="first" label="First">First</RadioCard>
      <RadioCard index={1} value="disabled" label="Disabled" disabled>Disabled</RadioCard>
      <RadioCard index={2} value="last" label="Last">Last</RadioCard>
    </RadioCardGroup>);
    fireEvent.keyDown(screen.getByRole('radio', { name: 'First' }), { key: 'ArrowDown' });
    expect(screen.getByRole('radio', { name: 'Disabled' })).toBeDisabled();
    expect(screen.getByRole('radio', { name: 'Last' })).toHaveFocus();
    expect(select).toHaveBeenCalledWith('last');
  });

  it('keeps the first gated item reachable when nothing is selected', () => {
    render(<RadioCardGroup value={null} onChange={() => {}} label="Closed topics">
      <RadioCard index={0} value="locked" label="Locked" unavailable>Locked</RadioCard>
    </RadioCardGroup>);
    expect(screen.getByRole('radio', { name: 'Locked' })).toHaveAttribute('tabindex', '0');
  });
});
