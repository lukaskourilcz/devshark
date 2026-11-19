/** Shared compiler used by cold-start contracts and the offline import lab. */
export function bundleColdEntry(
  entry: string,
  outfile: string,
  markers?: readonly string[],
  sourceRoot?: string,
  quiet?: boolean,
): Promise<void>;
