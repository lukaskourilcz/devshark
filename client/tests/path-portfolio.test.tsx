import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PortfolioExport } from '../src/components/paths/PortfolioExport';
import { portfolioDocument, portfolioMarkdown, type PortfolioEntry } from '../src/lib/pathPortfolio';
import type { LearningPathManifest } from '../../shared/learning-paths';

const calls = vi.hoisted(() => ({ fetch: vi.fn(), download: vi.fn() }));
vi.mock('../src/lib/api', () => ({ apiFetch: calls.fetch, friendlyError: (error: Error) => error.message }));
vi.mock('../src/lib/shareCard', () => ({ downloadShareFile: calls.download }));
const ids = ['fde-v1-c01-executive-update', 'fde-v1-c01-walkthrough-script'];
const manifest = { id: 'fde', version: 1, title: 'Forward Deployed Engineer', modules: [{
  id: 'fde-v1-c01', title: 'Capstone', activities: ids.map((id, i) => ({ id, kind: 'artifact', title: i ? 'Walkthrough script' : 'Executive update' })),
}] } as unknown as LearningPathManifest;
const states = new Map([[ids[0], 'self_reviewed' as const]]);
const saved = (id: string) => ({ draft: { activityId: id, revision: 3, updatedAt: '2026-10-22T04:00:00Z', content: { artifact: { decision: 'Keep tenant isolation.\n```\n<img src="https://example.invalid">' } } } });
const setup = (path = manifest) => render(<PortfolioExport manifest={path} enrollmentId="enrollment-1" states={states} />);

beforeEach(() => { calls.fetch.mockReset(); calls.download.mockReset(); calls.fetch.mockImplementation((url: string) => Promise.resolve(saved(new URL(url, 'https://local.invalid').searchParams.get('activityId')!))); });

describe('saved portfolio writing', () => {
  it('includes both new artifacts with revision and evidence limits in JSON and literal Markdown', () => {
    const entries: PortfolioEntry[] = ids.map(id => ({ module: 'Capstone', activityId: id, title: id, recordedState: 'self_reviewed', saved: saved(id).draft }));
    const json = portfolioDocument(manifest, entries);
    expect(json.entries.map(entry => entry.activityId)).toEqual(ids);
    expect(json.note).toContain('may differ from the last submission');
    const md = portfolioMarkdown(manifest, entries);
    for (const id of ids) expect(md).toContain(id);
    expect(md).toContain('Saved revision: 3');
    expect(md).toContain('Recorded state: self_reviewed');
    expect(portfolioMarkdown(manifest, entries, state => (state === 'self_reviewed' ? 'Self-reviewed' : state))).toContain('Recorded state: Self-reviewed');
    expect(md).toContain('````text\nKeep tenant isolation.\n```\n<img');
    const maliciousKey = 'decision\n\n![image](https://example.invalid)';
    const withUntrustedKey = [{ ...entries[0], saved: { ...saved(ids[0]).draft, content: { artifact: { [maliciousKey]: 'Saved writing' } } } }];
    expect(portfolioMarkdown(manifest, withUntrustedKey)).toContain('### decision  \\!\\[image\\](https://example\\.invalid)');
  });
  it('reads saved drafts without starting attempts and downloads both formats', async () => {
    setup();
    for (const [label, suffix] of [['JSON', '.json'], ['Markdown', '.md']]) {
      fireEvent.click(screen.getByRole('button', { name: `Export writing as ${label}` }));
      await waitFor(() => expect(calls.download).toHaveBeenCalledTimes(suffix === '.json' ? 1 : 2));
      expect(calls.download.mock.lastCall![0].name).toBe(`devshark-fde-saved-writing${suffix}`);
      await waitFor(() => expect(screen.getByRole('button', { name: `Export writing as ${label}` })).toBeEnabled());
    }
    expect(calls.fetch).toHaveBeenCalledTimes(4);
    for (const [url, init] of calls.fetch.mock.calls) {
      expect(url).toContain('op=learning-path-draft'); expect(url).toContain('enrollmentId=enrollment-1');
      expect(init.method).toBeUndefined();
    }
  });
  it('exports other writing when an older draft contains non-text fields', async () => {
    calls.fetch.mockResolvedValueOnce({ draft: {
      ...saved(ids[0]).draft,
      content: { artifact: { decision: 'Keep valid writing', oldField: { result: '<img src="https://example.invalid">' } } },
    } });
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Export writing as Markdown' }));
    await waitFor(() => expect(calls.download).toHaveBeenCalledTimes(1));
    const file = calls.download.mock.lastCall![0] as File;
    const md = await file.text();
    expect(md).toContain('Keep valid writing');
    expect(md).toContain('Walkthrough script');
    expect(md).toContain('### oldField\n\n```text\n{"result":');
  });

  it('refuses a partial file after a failed read and lets the learner retry', async () => {
    calls.fetch.mockRejectedValueOnce(new Error('Could not load the draft'));
    setup(); fireEvent.click(screen.getByRole('button', { name: 'Export writing as JSON' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load the draft');
    expect(calls.download).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Export writing as JSON' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Export writing as JSON' }));
    await waitFor(() => expect(calls.download).toHaveBeenCalledTimes(1));
  });
  it('starts the next read when one lands rather than waiting for a slow pair, and keeps manifest order', async () => {
    let finishSlow!: (value: unknown) => void;
    calls.fetch.mockReturnValueOnce(new Promise(resolve => { finishSlow = resolve; }));
    const third = { id: 'fde-v1-c01-third-writing', kind: 'artifact' as const, title: 'More writing' };
    const withThird = { ...manifest, modules: manifest.modules.map(module => ({ ...module, activities: [
      ...module.activities, third as typeof module.activities[number],
    ] })) };
    setup(withThird); fireEvent.click(screen.getByRole('button', { name: 'Export writing as JSON' }));
    await waitFor(() => expect(calls.fetch).toHaveBeenCalledTimes(3));
    expect(calls.download).not.toHaveBeenCalled();
    await act(async () => { finishSlow(saved(ids[0])); });
    await waitFor(() => expect(calls.download).toHaveBeenCalledTimes(1));
    const file = calls.download.mock.lastCall![0] as File;
    const document = JSON.parse(await file.text()) as { entries: { activityId: string }[] };
    expect(document.entries.map(entry => entry.activityId)).toEqual([...ids, third.id]);
  });
  it('aborts pending reads and produces no file when the account/enrollment screen unmounts', async () => {
    let finish!: (value: unknown) => void;
    calls.fetch.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    const withAnotherBatch = { ...manifest, modules: manifest.modules.map(module => ({ ...module, activities: [
      ...module.activities, { id: 'fde-v1-c01-third-writing', kind: 'artifact' as const, title: 'More writing' } as typeof module.activities[number],
    ] })) };
    const view = setup(withAnotherBatch);fireEvent.click(screen.getByRole('button', { name: 'Export writing as JSON' }));
    const signal = calls.fetch.mock.calls[0][1].signal as AbortSignal;
    view.unmount(); expect(signal.aborted).toBe(true);
    await act(async () => { finish(saved(ids[0])); });
    expect(calls.download).not.toHaveBeenCalled();
    expect(calls.fetch).toHaveBeenCalledTimes(2);
  });
});
