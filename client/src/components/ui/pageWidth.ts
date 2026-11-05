/** The route shell chooses a shared width. Operational learning screens use
 * wide (1200px); the public home keeps standard (1000px), and auth, billing,
 * policy and unknown routes keep narrow (800px). /dev is uncapped.
 * Inside a page, question content uses --ss-width-question (880px); auth,
 * checkout and gates retain --ss-width-task (640px).
 */
export function pageMaxWidth(pathname: string): string {
  return pathname.startsWith('/dev')
    ? 'none'
    : `var(--ss-width-${/^\/(coding|learn|quiz|challenge|today|profile|play|typing|cards|collection|shop|leaderboard|roadmap)(\/|$)/.test(pathname) ? 'wide' : pathname === '/' ? 'standard' : 'narrow'})`;
}
