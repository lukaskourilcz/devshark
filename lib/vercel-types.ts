/**
 * The small portion of Vercel's Node request/response contract used by this
 * project. Keeping these structural types locally avoids shipping Vercel's
 * build toolchain as an application dependency just to type API handlers.
 */
export interface VercelRequest {
  method?: string;
  url?: string;
  headers: Record<string, string | string[] | undefined>;
  query: Record<string, string | string[] | undefined>;
  body?: any;
  socket: { remoteAddress?: string | null };
}

export interface VercelResponse {
  statusCode?: number;
  headersSent?: boolean;
  status(code: number): VercelResponse;
  json(body: unknown): VercelResponse;
  send(body: unknown): VercelResponse;
  end(body?: unknown): void;
  setHeader(name: string, value: string | readonly string[] | number): VercelResponse;
  getHeader?(name: string): string | readonly string[] | number | undefined;
  redirect(statusOrUrl: number | string, url?: string): VercelResponse;
}
