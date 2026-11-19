// Evaluated only for a GET that passed the existing admin router gate.
import type { TriageData } from '../shared/triage';
// Static require is traced by the server builder and bundled by Docker esbuild.
// It avoids enabling resolveJsonModule across the server TypeScript project.
const triage = require('./data/triage-verdicts.json') as TriageData;
export const readAdminTriage = (): TriageData => triage;
