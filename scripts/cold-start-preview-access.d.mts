export class PreviewAccessError extends Error {}

export function validatePreviewOrigin(origin: string): URL;

export function loadPreviewAccess(origin: string, file: string, nowMs?: number): Readonly<{
  kind: 'approved-vercel-preview-state';
  headersFor(url: URL): { Cookie: string; 'x-vercel-skip-toolbar': string };
  assertOutputAllowed(file: string): void;
  writeReport(file: string, content: string): void;
  dispose(): void;
}>;
