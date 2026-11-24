import type { VercelRequest, VercelResponse } from '../lib/vercel-types.js';
import { jsonError, withRequestContext } from '../lib/http';
import { getGameSettings } from '../lib/settings-store';
import { learningPathCapability } from '../lib/learning-paths/capability';
import { publicBillingSettings } from '../lib/billing/config';
import { getMerchPromo } from '../lib/rewards/spreadshop';
import { MERCH_ENABLED, merchRedemptionOpen } from '../shared/rewards';
import { sendPublicJson } from '../lib/public-json';

// Public, read-only subset of the game settings, so the client can render the
// configured count/time options and hide disabled features. Deliberately omits
// server-only fields (e.g. ownerEmail), unused tips and retired cosmetic prices.
// The authenticated editor keeps the complete stored settings. DB failures use defaults.
async function routeHandler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'POST' && req.query.op === 'csp-report') {
    const { handleCspReport } = await import('../lib/csp-reports');
    return handleCspReport(req, res);
  }
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return jsonError(res, 405, 'method_not_allowed', 'Method not allowed');
  }

  // While merchandise is paused (MERCH_ENABLED) Spreadshop is not asked.
  const [s, merchPromo] = await Promise.all([getGameSettings(), MERCH_ENABLED ? getMerchPromo() : Promise.resolve(null)]);
  res.setHeader('Cache-Control', 'public, s-maxage=15, stale-while-revalidate=60');
  return sendPublicJson(req, res, {
    quiz: {
      defaultCount: s.quiz.defaultCount,
      countOptions: s.quiz.countOptions,
      maxCount: s.quiz.maxCount,
      defaultDifficulty: s.quiz.defaultDifficulty,
      defaultCategoryIds: s.quiz.defaultCategoryIds,
    },
    daily: { count: s.daily.count },
    play: {
      defaultDurationS: s.play.defaultDurationS,
      durationOptionsS: s.play.durationOptionsS,
      countOptions: s.play.countOptions,
    },
    features: s.features,
    leveling: s.leveling,
    // What earns coins (#227): the welcome grant for the sign-in prompt and
    // the social grant for "Find devShark elsewhere". Rates only, no balances.
    coins: s.coins,
    // Whether coins can be redeemed for merchandise yet. The landing table
    // and the Premium list mention redemption only while this is true.
    merch: { redemptionOpen: merchRedemptionOpen(s.merch) },
    // Per path, so DSA Foundations can open while FDE content is still being
    // authored. The client reads this to decide what to show; every write is
    // authorized on the server regardless of what the client believes.
    learningPaths: learningPathCapability(),
    // Whether checkout sells Premium (BILLING_ENABLED and a complete Stripe
    // configuration) and whether the cancellation page can reach Stripe.
    billing: publicBillingSettings(),
    // Spreadshop's own promotion for the devShark shop this month (#229), or
    // null. Read server-side and cached; see lib/rewards/spreadshop.ts.
    merchPromo,
  });
}

export default function handler(req: VercelRequest, res: VercelResponse) {
  return withRequestContext(req, res, () => routeHandler(req, res));
}
