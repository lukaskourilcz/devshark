// The FDE path's share of its section's progress figure (sections.ts,
// `pathSteps`), read by the Learn switcher and the Career page's FDE group so
// both show one figure.
//
// The path counts only while it is open for enrollment: a switched-off path,
// or a catalogue that did not load, leaves the figure to the Learn topics, as
// it was before #489. `pending` is true while an answer that would change the
// figure is still on its way, so a caller can hold the figure back instead of
// showing one number and then another.
//
// Whether the path is open is first read from the public settings the app
// asks for as it starts (`learningPaths` in /api/settings, the same verdict
// the catalogue carries per entry). While they say the path is closed, the
// 30 KB catalogue, the account's enrollments and its path progress are not
// asked at all (perf baseline #587 C06, C20): every Learn section and the
// Career page used to read them for a figure that then ignored them. The
// FDE section still reads the catalogue for its path shelf, which shows it.

import { FDE_SECTION_VISIBLE } from '../../../../shared/learn-section-ids';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../lib/auth';
import { GAME_CONFIG_KEY, type GameConfig } from '../../lib/gameConfig';
import { entryFor, isOpen, useEnrollments, usePathCatalog, usePathProgress } from '../../lib/learningPaths';
import { pathSteps, type PathSteps } from './sections';

/** What the settings say about the FDE path: 'open' or 'closed' once they
 * have answered; 'asking' while their first read is on its way; 'unknown'
 * when they failed, are paused offline or were never asked (the catalogue
 * then decides, as before). This only watches the app's own settings read
 * (lib/gameConfig.ts) and never starts one. */
export type FdeSettingsVerdict = 'open' | 'closed' | 'asking' | 'unknown';

export function useFdeOpenInSettings(): FdeSettingsVerdict {
  const settings = useQuery<GameConfig>({ queryKey: GAME_CONFIG_KEY, enabled: false });
  if (!FDE_SECTION_VISIBLE) return 'closed';
  const capability = settings.data?.learningPaths;
  if (capability) return capability.paths.fde?.enabled === true ? 'open' : 'closed';
  if (settings.data) return 'unknown';
  return settings.fetchStatus === 'fetching' ? 'asking' : 'unknown';
}

export function useFdePathSteps(): { steps: PathSteps | null; pending: boolean } {
  const { user, isAuthenticated } = useAuth();
  const verdict = useFdeOpenInSettings();
  const ask = verdict === 'open' || verdict === 'unknown';
  const userId = ask && isAuthenticated ? user?.id : undefined;
  const catalog = usePathCatalog(ask);
  const enrollments = useEnrollments(userId);
  const entry = entryFor(catalog.data, 'fde');
  const enrollment = enrollments.data?.enrollments.find(
    (one) => one.pathId === 'fde' && one.curriculumVersion === entry?.manifest.version,
  );
  const progress = usePathProgress(userId, enrollment?.enrollmentId, enrollment?.curriculumVersion);

  if (verdict === 'closed') return { steps: null, pending: false };
  if (verdict === 'asking') return { steps: null, pending: true };
  // Offline a read pauses; the figure then keeps to the topics instead of
  // waiting for a connection.
  const waiting = (query: { isPending: boolean; fetchStatus: string }) => query.isPending && query.fetchStatus === 'fetching';
  if (waiting(catalog)) return { steps: null, pending: true };
  if (!entry || !isOpen(entry.availability)) return { steps: null, pending: false };
  if (userId && waiting(enrollments)) return { steps: null, pending: true };
  if (enrollment && waiting(progress)) return { steps: null, pending: true };
  // An account whose enrollments or progress did not arrive: the figure keeps
  // to the topics rather than counting recorded work as not done.
  if ((userId && !enrollments.data) || (enrollment && !progress.data)) return { steps: null, pending: false };
  return { steps: pathSteps(entry.manifest.modules, progress.data), pending: false };
}
