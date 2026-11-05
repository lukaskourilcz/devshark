import { useQuery } from '@tanstack/react-query';
import { apiFetch } from './api';
import { setRankThresholds, DEFAULT_RANK_THRESHOLDS } from './leveling';
import { queryClient } from './queryClient';
import { DEFAULT_COIN_SETTINGS, MERCH_ENABLED, type CoinSettings, type MerchPromo } from '../../../shared/rewards';

// Public, read-only game configuration (from /api/settings) that the UI uses to
// render the configured count/time options and hide disabled features. Backed by
// TanStack Query so it's fetched once and shared by every consumer (replacing a
// hand-rolled module cache + in-flight de-dup), while DEFAULT_CONFIG renders the
// app correctly before the fetch resolves or if it fails.

export interface GameConfig {
  quiz: {
    defaultCount: number;
    countOptions: number[];
    maxCount: number;
    defaultDifficulty: string;
    /** Legacy category subset, retained on the wire for older clients. The current picker shows all permitted categories. */
    defaultCategoryIds: string[];
  };
  daily: { count: number };
  play: { defaultDurationS: number; durationOptionsS: number[]; countOptions: number[] };
  features: { dailyChallenge: boolean; multiplayer: boolean; leaderboard: boolean; flashcards: boolean };
  leveling: { rankThresholds: number[] };
  /** Token prices for the shop — per-product overrides + the path-unlock price. */
  shop: { prices: Record<string, number>; pathUnlockPrice: number };
  /** One-liner dev tips shown on the full-page loading screen; empty = none. */
  devTips: string[];
  /** Billing (#221): whether checkout sells Premium, and whether the
   * cancellation page can reach Stripe. Both false until the server says so.
   * `cancelByEmail`: the cancellation page can email its confirmation link, so
   * nobody has to sign in to cancel; absent from an older server.
   * `seller` (#222) names the seller of record for the Terms: Stripe as Link
   * under Managed Payments, or the trader; null or absent means unsaid.
   * `launchOffer`: Checkout applies the launch coupon right now (the window
   * is open, billing is on and the coupon is set); absent means off. */
  billing: { enabled: boolean; cancellable: boolean; cancelByEmail?: boolean; seller?: 'link' | 'trader' | null; launchOffer?: boolean };
  /** What earns coins (#227): the rates, milestones and the social grant. */
  coins: CoinSettings;
  /** Spreadshop's own promotion in the devShark shop this month (#229), or
   * null. Absent from a server that predates it. */
  merchPromo?: MerchPromo | null;
  /** Whether coins can be redeemed for merchandise yet. Absent from an older
   * server, which reads as closed. */
  merch?: { redemptionOpen: boolean };
  /** Per learning path, whether it is open (the server publishes it). */
  learningPaths?: { paths: Record<string, { enabled: boolean }> };
}

const DEFAULT_QUIZ_CATEGORY_IDS = [
  'javascript', 'typescript', 'react', 'nodejs', 'nextjs', 'html',
  'css', 'git', 'dsa', 'databases', 'system-design', 'devops',
];

// Default shop token prices (mirrors lib/settings-store.ts and the shop catalogue).
const DEFAULT_SHOP_PRICES: Record<string, number> = {
  'double-xp': 75,
  'ring-emerald': 200,
  'ring-gold': 250,
  'ring-violet': 375,
  'flair-rocket': 150,
  'flair-flame': 300,
  'flair-crown': 500,
};
const DEFAULT_PATH_UNLOCK_PRICE = 200;


export const DEFAULT_CONFIG: GameConfig = {
  quiz: {
    defaultCount: 10,
    countOptions: [10, 20, 30, 40, 50],
    maxCount: 50,
    defaultDifficulty: 'zero-to-hero',
    defaultCategoryIds: DEFAULT_QUIZ_CATEGORY_IDS,
  },
  daily: { count: 5 },
  play: { defaultDurationS: 60, durationOptionsS: [30, 60, 120, 300, 0], countOptions: [5, 10, 15, 20] },
  features: { dailyChallenge: true, multiplayer: true, leaderboard: true, flashcards: true },
  leveling: { rankThresholds: DEFAULT_RANK_THRESHOLDS },
  shop: { prices: { ...DEFAULT_SHOP_PRICES }, pathUnlockPrice: DEFAULT_PATH_UNLOCK_PRICE },
  // No screen shows dev tips since design review 2 (R2-P1.18); the setting
  // stays so saved settings still parse, and /dev edits the server's list
  // (lib/settings-store.ts) through its own read. The ten defaults copied here
  // rode in the initial chunk unread.
  devTips: [],
  billing: { enabled: false, cancellable: false, cancelByEmail: false, seller: null, launchOffer: false },
  coins: DEFAULT_COIN_SETTINGS,
  merchPromo: null,
  merch: { redemptionOpen: false },
};

export const GAME_CONFIG_KEY = ['game-config'] as const;

async function fetchConfig(): Promise<GameConfig> {
  const c = await apiFetch<GameConfig>('/api/settings');
  // Apply the configured career-rank thresholds to the leveling module.
  setRankThresholds(c.leveling?.rankThresholds);
  // Defensively fill in any section an older server might omit (e.g. shop).
  return {
    ...DEFAULT_CONFIG,
    ...c,
    shop: c.shop ?? DEFAULT_CONFIG.shop,
    billing: c.billing ?? DEFAULT_CONFIG.billing,
    coins: c.coins ?? DEFAULT_CONFIG.coins,
  };
}

const CONFIG_QUERY = {
  queryKey: GAME_CONFIG_KEY,
  queryFn: fetchConfig,
  // The config rarely changes within a session; fetch once and keep it.
  staleTime: Infinity,
  gcTime: Infinity,
  placeholderData: DEFAULT_CONFIG,
} as const;

export function useGameConfig(): GameConfig {
  const { data } = useQuery(CONFIG_QUERY);
  return data ?? DEFAULT_CONFIG;
}

/** The config plus whether it is the server's answer rather than the
 * defaults, for a screen that must not act on a default (the billing pages). */
export function useGameConfigStatus(): { config: GameConfig; fromServer: boolean; failed: boolean; retry: () => void } {
  const { data, isPlaceholderData, isSuccess, isError, refetch } = useQuery(CONFIG_QUERY);
  return {
    config: data ?? DEFAULT_CONFIG,
    fromServer: isSuccess && !isPlaceholderData,
    // The settings never arrived (offline, or the API is down): a screen
    // that waits on them says so instead of waiting for ever.
    failed: isError,
    retry: () => { void refetch(); },
  };
}

/** Whether coin redemption for merchandise is open: never while merchandise
 * is paused (MERCH_ENABLED), whatever a cached settings answer says. */
export const redemptionOpen = (config: GameConfig): boolean => MERCH_ENABLED && config.merch?.redemptionOpen === true;

/** Whether any learning path is open. */
export const anyLearningPathOpen = (config: GameConfig): boolean =>
  Object.values(config.learningPaths?.paths ?? {}).some((path) => path.enabled);

/** Imperative snapshot for non-React callers (e.g. shop purchase). */
export function getGameConfig(): GameConfig {
  return queryClient.getQueryData<GameConfig>(GAME_CONFIG_KEY) ?? DEFAULT_CONFIG;
}
