// Shared by the roadmap router and its concern modules. No API import.
import type { VercelRequest, VercelResponse } from '../vercel-types.js';
import { AuthError } from '../auth';
import { createLogger, createServiceClient, jsonError, tryAuthOnce } from '../http';

export const logEvent = createLogger('quiz/roadmap');
export const supabase = createServiceClient();
export const PROGRESS_TABLE = 'roadmap_progress';

export async function optionalAuthSub(req: VercelRequest, res: VercelResponse): Promise<string | null | undefined> {
  try {
    return (await tryAuthOnce(req))?.sub ?? null;
  } catch (error) {
    if (error instanceof AuthError) {
      jsonError(res, error.status, error.code, error.message);
      return undefined;
    }
    throw error;
  }
}
