// The reviewer overlay is served only through the existing private admin API.
import { queryOptions } from '@tanstack/react-query';
import { adminFetch } from './devApi';
import type { TriageData } from '../../../shared/triage';
export type { TriageData, TriageMeta, TriageVerdict } from '../../../shared/triage';

export const loadTriageVerdicts = (signal?: AbortSignal): Promise<TriageData> =>
  adminFetch<TriageData>('triage', { signal });

export const triageVerdictsQuery = queryOptions({
  queryKey: ['admin', 'triage'] as const,
  queryFn: ({ signal }) => loadTriageVerdicts(signal),
});

export const GATE_LABEL: Record<string, string> = {
  ambiguous: 'Ambiguous',
  wrong_or_outdated: 'Wrong / outdated',
  trivial_recall: 'Trivial recall',
};
