import { Button } from '@astryxdesign/core/Button';
import { useEffect, useRef, useState } from 'react';
import type { EvidenceState, LearningPathManifest } from '../../../../shared/learning-paths';
import type { DraftGetResponse } from '../../../../shared/learning-path-api';
import { apiFetch, friendlyError } from '../../lib/api';
import { downloadShareFile } from '../../lib/shareCard';
import { portfolioDocument, portfolioMarkdown, type PortfolioEntry } from '../../lib/pathPortfolio';
import { pathsEn as copy } from '../../i18n/translations.paths';
import { translateShell } from '../../i18n/LanguageContext';

export function PortfolioExport({ manifest, enrollmentId, states }: {
  manifest: LearningPathManifest; enrollmentId: string; states: Map<string, EvidenceState>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const active = useRef<AbortController | null>(null);
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    setBusy(false); setError(null); setReady(false);
    return () => {
      live.current = false;
      active.current?.abort();
      active.current = null;
    };
  }, [enrollmentId]);

  async function download(format: 'json' | 'md') {
    if (active.current) return;
    const controller = new AbortController(); active.current = controller;
    setBusy(true); setError(null); setReady(false);
    try {
      const artifacts = manifest.modules.flatMap(module => module.activities
        .filter(activity => activity.kind === 'artifact').map(activity => ({ module, activity })));
      const entries: PortfolioEntry[] = new Array(artifacts.length);
      // At most two caller-owned reads at once; no attempt is started or
      // submitted. Each lane takes the next piece as soon as its own read
      // lands, instead of every pair waiting for its slower half.
      let next = 0;
      const lane = async () => {
        while (next < artifacts.length && !controller.signal.aborted) {
          const index = next++;
          const { module, activity } = artifacts[index];
          const query = new URLSearchParams({ op: 'learning-path-draft', enrollmentId, activityId: activity.id });
          const response = await apiFetch<DraftGetResponse>(`/api/user/[op]?${query}`, { signal: controller.signal });
          entries[index] = { module: module.title, activityId: activity.id, title: activity.title,
            recordedState: states.get(activity.id) ?? 'not_started', saved: response.draft };
        }
      };
      await Promise.all([lane(), lane()]);
      if (controller.signal.aborted) return;
      const body = format === 'json' ? JSON.stringify(portfolioDocument(manifest, entries), null, 2) : portfolioMarkdown(manifest, entries, state => translateShell(`paths.state.${state}`));
      downloadShareFile(new File([body], `devshark-${manifest.id}-saved-writing.${format}`, {
        type: format === 'json' ? 'application/json' : 'text/markdown;charset=utf-8',
      }));
      setReady(true);
    } catch (cause) {
      if (live.current && !controller.signal.aborted) setError(friendlyError(cause));
      controller.abort();
    } finally {
      if (active.current === controller) {
        active.current = null;
        if (live.current) setBusy(false);
      }
    }
  }
  return <div className="lp-portfolio-export">
    <p className="lp-completion__note">{copy['paths.export.note']}</p>
    <div className="lp-portfolio-export__actions" aria-busy={busy}>
      <Button variant="secondary" isDisabled={busy} onClick={() => void download('md')} label={copy['paths.export.markdown']} />
      <Button variant="secondary" isDisabled={busy} onClick={() => void download('json')} label={copy['paths.export.json']} />
    </div>
    {busy && <p role="status">{copy['paths.export.busy']}</p>}
    {ready && <p role="status">{copy['paths.export.ready']}</p>}
    {error && <p role="alert">{error}</p>}
  </div>;
}
