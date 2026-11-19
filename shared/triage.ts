// Server-owned reviewer overlay; types only, never import the dataset into client code.
export interface TriageVerdict {
  /** category */
  cat: string;
  /** difficulty */
  diff: number;
  /** relevance 1-5 */
  rel: number;
  /** discrimination 1-5 */
  disc: number;
  /** difficulty_fit 1-5 */
  fit: number;
  /** clarity 1-5 */
  clar: number;
  /** mean of the four axes */
  mean: number;
  /** any gate tripped */
  gate: boolean;
  /** gate reasons (ambiguous | wrong_or_outdated | trivial_recall) */
  greasons: string[];
  /** flagged as a redundant near-duplicate */
  dup: boolean;
  /** 'keep' | 'cut' under the default rule */
  dec: 'keep' | 'cut';
  /** all reasons contributing to the decision */
  reasons: string[];
  /** judge note (≤1 sentence; present when cut or any score ≤2) */
  note: string;
}

export interface TriageMeta {
  total: number;
  keep: number;
  cut: number;
  generatedFrom: string;
  keepRule: string;
}

export interface TriageData {
  meta: TriageMeta;
  verdicts: Record<string, TriageVerdict>;
}
