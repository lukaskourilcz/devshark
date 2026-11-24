import type { VercelRequest } from './vercel-types';

// Only these declared operation names can reach request summaries. IDs, search
// strings, tokens, unrecognized slugs and repeated selectors never become labels.
const known = new Map<string, { key: string; values: Set<string> }>([
  ['/api/quiz/roadmap', { key: 'resource', values: new Set([
    'answer', 'attempt-status', 'coding-approaches', 'coding-brief', 'coding-reset',
    'coding-reveal', 'coding-state', 'coding-submit', 'coding-task', 'complete', 'eligibility',
    'learning-path-catalog', 'learning-path-start', 'learning-path-submit', 'lesson', 'placement',
    'progress', 'skill-check'
  ]) }],
  ['/api/quiz/questions', { key: 'resource', values: new Set(['curation', 'due', 'marketing-source', 'review']) }],
  ['/api/quiz/challenge', { key: 'resource', values: new Set(['assessment', 'complete', 'leaderboard']) }],
  ['/api/quiz/submit', { key: 'resource', values: new Set(['report']) }],
  ['/api/settings', { key: 'op', values: new Set(['csp-report']) }],
  ['/api/leaderboard', { key: 'period', values: new Set(['global', 'daily', 'category', '7d', '30d', 'month']) }],
  ['/api/user', { key: 'op', values: new Set([
    'advisor', 'authevent', 'badges', 'billing-cancel', 'billing-checkout', 'billing-portal',
    'billing-webhook', 'cards', 'category-stats', 'coding-bookmarks', 'coding-draft',
    'coding-progress', 'coding-skip', 'cosmetic', 'delete-account', 'entitlement', 'freezes',
    'fulfilment', 'friends-handle', 'friends-list', 'friends-lookup', 'friends-remove',
    'friends-request', 'friends-respond', 'github-connect-finish', 'github-connect-start',
    'github-connection', 'github-disconnect', 'github-repo', 'github-sync', 'identity',
    'leaderboard-name', 'leaderboard-visibility', 'learning-path-draft',
    'learning-path-enrollment', 'learning-path-progress', 'learning-path-reward',
    'learning-preference', 'orders', 'payment-webhook', 'practice-session', 'protection',
    'referral', 'shop', 'stats', 'streak', 'voucher', 'wallet', 'xp'
  ]) }],
  ['/api/admin', { key: 'op', values: new Set([
    'bulkhide', 'delete', 'emails', 'entitlements', 'learning-paths', 'logs', 'quality',
    'questions', 'reports', 'reset', 'save', 'settings', 'triage', 'users', 'vouchers'
  ]) }],
  ['/api/play', { key: 'action', values: new Set([
    'answer', 'control', 'create', 'distribution', 'heartbeat', 'join', 'state'
  ]) }],
]);

export function requestOperation(req: Pick<VercelRequest, 'url' | 'query'>): string {
  const path = req.url?.split('?', 1)[0] ?? '';
  if (path === '/api/quiz/daily') return req.query?.qotd === undefined ? 'quiz/daily' : 'quiz/daily:qotd';
  if (path === '/api/health' || path === '/api/flashcards') return path.slice(5);
  const dynamic = /^\/api\/(user|admin|play)\/([^/]+)$/.exec(path);
  const route = dynamic ? `/api/${dynamic[1]}` : path;
  const config = known.get(route);
  if (!config) return 'other';
  let raw = req.query?.[config.key];
  if (dynamic) raw = typeof raw === 'string' ? raw.toLowerCase() : raw ?? dynamic[2].toLowerCase();
  const name = route.slice(5);
  if (raw === undefined || raw === '') {
    if (route === '/api/leaderboard') return 'leaderboard:global';
    if (route === '/api/quiz/roadmap' && req.query?.topic) return 'quiz/roadmap:topic';
    return name;
  }
  return `${name}:${typeof raw === 'string' && config.values.has(raw) ? raw : 'other'}`;
}
