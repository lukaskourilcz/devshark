// Owner decisions 10, 11 and 12 (1 October 2026), run by `npm run test:launch`.
//
//   * merchandise is paused until next quarter: one switch (MERCH_ENABLED in
//     shared/rewards.ts), and with it off every merchandise order and listing
//     answers 404 merch_unavailable, the shop lists no item and the settings
//     say redemption is closed, even with the owner's shop settings all on
//   * the yearly saving on /premium is worked out from the prices on show
//   * Shark Cards are saved questions: /api/flashcards keeps what the grading
//     showed the learner, never reads an answer or explanation out of the
//     bank, and serves a learner only their own cards; the card packs are
//     retired (op=cards answers 410 and nothing calls grant_daily_queue_cards)
//
// The handlers are called directly against stand-ins for Supabase, under the
// local development auth fallback (a `user_id` in the query or body).

import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { handleOrders, handleShopCatalogue } from '../lib/rewards/handlers';
import { DEFAULT_SETTINGS, setGameSettingsForTests } from '../lib/settings-store';
import settingsHandler from '../api/settings';
import { DEFAULT_MERCH_SETTINGS, MERCH_ENABLED, merchRedemptionOpen, type MerchSettings } from '../shared/rewards';
import { en as shellEnglish } from '../client/src/i18n/translations';
import { termsEn } from '../client/src/i18n/translations.terms';
import { annualSaving, launchOfferDisplay } from '../shared/launch-offer';
import { PREMIUM_PRICE } from '../shared/tiers';
import { handleFlashcards } from '../api/flashcards';
import { UpstreamTimeoutError } from '../lib/http';
import { retiredCardPacks } from '../api/user/[op]';
import { getEffectiveQuestions } from '../lib/questions-store';
import { isRoadmapTopic, levelQuestionIds } from '../lib/roadmap';
import { LEARN_ID_PREFIXES, learnLevelOfQuestion, sharkCardStudyLink } from '../shared/shark-cards';
import { SUBJECT_SCOPE_CATALOG } from '../shared/subject-catalog';

const ENGLISH = { ...shellEnglish, ...termsEn };

function mockResponse() {
  const headers = new Map<string, string>();
  return {
    statusCode: 200,
    body: undefined as unknown,
    setHeader(name: string, value: string) { headers.set(name.toLowerCase(), String(value)); },
    status(code: number) { this.statusCode = code; return this; },
    json(value: unknown) { this.body = value; return this; },
    end() { return this; },
    headers,
  };
}
type Captured = ReturnType<typeof mockResponse>;
const errorCode = (res: Captured) => (res.body as { error?: { code?: string } } | undefined)?.error?.code;

let caller = 0;
const request = (method: string, body: Record<string, unknown> = {}, query: Record<string, unknown> = {}) => {
  const user = `contract-merch-${++caller}`;
  return {
    method,
    headers: { 'x-forwarded-for': `10.57.${caller % 250}.${(caller * 3) % 250}` },
    query: { user_id: user, ...query },
    body: { user_id: user, ...body },
    socket: {},
  } as never;
};

/** A stand-in that records every table and routine a handler touches. */
function recordingDatabase() {
  const touched: string[] = [];
  const chain = (table: string) => {
    touched.push(`from:${table}`);
    const link = {
      select: () => link,
      eq: () => link,
      in: () => link,
      order: () => link,
      limit: () => link,
      like: () => link,
      maybeSingle: async () => ({ data: null, error: null }),
      then: <A>(resolve: (value: { data: unknown[]; error: null }) => A) => resolve({ data: [], error: null }),
    };
    return link;
  };
  return {
    touched,
    db: {
      from: chain,
      rpc: async (name: string) => { touched.push(`rpc:${name}`); return { data: 'cancelled', error: null }; },
    } as never,
  };
}

/** The owner's shop with everything switched on: open, cash checkout on and a
 * mug priced in coins for Czechia. The pause must hold against all of it. */
const SHOP_ALL_ON: MerchSettings = {
  ...DEFAULT_MERCH_SETTINGS,
  enabled: true,
  cashCheckoutEnabled: true,
  testMode: false,
  pricing: {
    mug: {
      unitCostMinor: 1349, printCostMinor: 0, shippingCostMinor: 490, packagingCostMinor: 0,
      priceMinor: 1999, currency: 'EUR', taxIncluded: true, tokenPrice: 900, regions: ['CZ'],
      vendor: 'sprd.net AG', effectiveFrom: '2026-10-01',
    },
  },
};

const ADDRESS = { name: 'Ann', line1: 'Street 1', city: 'Brno', postalCode: '60200', country: 'CZ' };

async function merchPausedContracts() {
  assert.equal(MERCH_ENABLED, false, 'merchandise ships switched off until next quarter (owner decision 10)');
  setGameSettingsForTests({ ...DEFAULT_SETTINGS, merch: SHOP_ALL_ON });
  const realEnv = { key: process.env.SPREADSHOP_API_KEY, shop: process.env.SPREADSHOP_SHOP_ID };
  try {
    // Placing an order: refused before the database, coins or address.
    {
      const { db, touched } = recordingDatabase();
      const res = mockResponse();
      await handleOrders(request('POST', { items: [{ sku: 'mug', quantity: 1 }], address: ADDRESS, paymentKind: 'tokens' }), res as never, db);
      assert.equal(res.statusCode, 404, 'a coin redemption while merchandise is paused is a 404');
      assert.equal(errorCode(res), 'merch_unavailable');
      assert.deepEqual(touched, [], 'a refused redemption reaches no table and no routine (create_merch_order)');
    }
    // Listing orders: the same answer.
    {
      const { db, touched } = recordingDatabase();
      const res = mockResponse();
      await handleOrders(request('GET'), res as never, db);
      assert.equal(res.statusCode, 404);
      assert.equal(errorCode(res), 'merch_unavailable');
      assert.deepEqual(touched, []);
    }
    // Cancelling an order from before the pause still works, so its coins can
    // come back.
    {
      const { db, touched } = recordingDatabase();
      const res = mockResponse();
      await handleOrders(request('DELETE', {}, { id: 'order-0123456789abcdef' }), res as never, db);
      assert.equal(res.statusCode, 200, 'cancelling stays open while merchandise is paused');
      assert.deepEqual(touched, ['rpc:cancel_merch_order']);
    }
    // A signed-out request is still asked to sign in first.
    {
      const res = mockResponse();
      await handleOrders({ method: 'POST', headers: { 'x-forwarded-for': '10.57.9.9' }, query: {}, body: {}, socket: {} } as never, res as never, recordingDatabase().db);
      assert.equal(res.statusCode, 401);
    }
    // The catalogue: no item, the shop reported off, no stock read. The crown
    // and streak protection are untouched.
    {
      const { db, touched } = recordingDatabase();
      const res = mockResponse();
      await handleShopCatalogue(request('GET'), res as never, db);
      const body = res.body as { enabled: boolean; cashCheckoutEnabled: boolean; items: unknown[]; crown: { available: boolean }; protection: { available: boolean } };
      assert.equal(res.statusCode, 200);
      assert.deepEqual(body.items, [], 'the shop lists no merchandise while it is paused');
      assert.equal(body.enabled, false);
      assert.equal(body.cashCheckoutEnabled, false);
      assert.equal(body.crown.available, true, 'the crown stays on sale');
      assert.equal(body.protection.available, true, 'streak protection stays on sale');
      assert.deepEqual(touched, [], 'merch_stock is not read');
    }
    // With the switch on, the same settings list the catalogue and take an
    // order to the database, so the switch is the only thing in the way.
    {
      const { db } = recordingDatabase();
      const res = mockResponse();
      await handleShopCatalogue(request('GET'), res as never, db, true);
      const body = res.body as { enabled: boolean; items: { sku: string }[] };
      assert.equal(body.enabled, true);
      assert.ok(body.items.some((item) => item.sku === 'mug'), 'with the switch on the catalogue comes back');
      assert.equal(merchRedemptionOpen(SHOP_ALL_ON, true), true);
    }
    // With the switch on, an order that names the same item and size twice is
    // refused before the database: merch_order_items keys on (order, sku,
    // variant), so the second line failed the insert with 23505, a 500.
    {
      const { db, touched } = recordingDatabase();
      const res = mockResponse();
      await handleOrders(request('POST', { items: [{ sku: 'mug', quantity: 5 }, { sku: 'mug', quantity: 5 }], address: ADDRESS, paymentKind: 'tokens' }), res as never, db, true);
      assert.equal(res.statusCode, 400, 'a repeated line is a bad request');
      assert.deepEqual(touched, [], 'and reaches no table or routine');
    }
    // With the switch on, a failed read of an order's items is an error, not
    // an order with nothing in it.
    {
      const order = { order_id: 'order-0123456789abcdef', payment_kind: 'tokens', state: 'paid', total_minor: 1999, currency: 'EUR', token_total: 900, ship_country: 'CZ', carrier: null, tracking_ref: null, test_mode: false, created_at: '2026-10-01T10:00:00Z' };
      const answers: Record<string, { data: unknown; error: unknown }> = {
        merch_orders: { data: [order], error: null },
        merch_order_items: { data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } },
        path_reward_claims: { data: [], error: null },
      };
      const db = {
        from: (table: string) => {
          const link = {
            select: () => link, eq: () => link, in: () => link, order: () => link, limit: () => link,
            then: <A>(resolve: (value: { data: unknown; error: unknown }) => A) => resolve(answers[table]),
          };
          return link;
        },
      } as never;
      const res = mockResponse();
      await handleOrders(request('GET'), res as never, db, true);
      assert.equal(res.statusCode, 500, 'a failed items read is not an empty order');
      answers.merch_order_items = { data: [{ order_id: order.order_id, sku: 'mug', variant: '', quantity: 1 }], error: null };
      const listed = mockResponse();
      await handleOrders(request('GET'), listed as never, db, true);
      assert.deepEqual((listed.body as { orders: { items: unknown[] }[] }).orders[0].items, [{ sku: 'mug', variant: '', quantity: 1 }]);
    }
    // Redemption is closed whatever the owner saved, and Spreadshop is not
    // asked for its promotion.
    assert.equal(merchRedemptionOpen(SHOP_ALL_ON), false, 'redemption stays closed while merchandise is paused');
    {
      process.env.SPREADSHOP_API_KEY = 'abcdefgh-1234-5678';
      process.env.SPREADSHOP_SHOP_ID = '123456';
      const realFetch = globalThis.fetch;
      let fetched = 0;
      globalThis.fetch = (async () => { fetched += 1; return new Response('{}', { status: 404 }); }) as typeof fetch;
      try {
        const res = mockResponse();
        await settingsHandler({ method: 'GET', headers: {}, query: {}, socket: {} } as never, res as never);
        const body = res.body as { merch: { redemptionOpen: boolean }; merchPromo: unknown };
        assert.equal(body.merch.redemptionOpen, false, '/api/settings says redemption is closed');
        assert.equal(body.merchPromo, null, '/api/settings carries no Spreadshop promotion');
        assert.equal(fetched, 0, 'Spreadshop is not asked while merchandise is paused');
      } finally {
        globalThis.fetch = realFetch;
      }
    }
  } finally {
    setGameSettingsForTests(null);
    if (realEnv.key === undefined) delete process.env.SPREADSHOP_API_KEY; else process.env.SPREADSHOP_API_KEY = realEnv.key;
    if (realEnv.shop === undefined) delete process.env.SPREADSHOP_SHOP_ID; else process.env.SPREADSHOP_SHOP_ID = realEnv.shop;
  }

  // The Terms promise no merchandise while it is paused.
  for (const key of ['legal.terms.plans.premium', 'legal.terms.refund.takeBack'] as const) {
    assert.doesNotMatch(ENGLISH[key], /merchandise|redeem/i, `${key} mentions merchandise while it is paused`);
  }
}

/** Owner decision 11: the yearly saving is worked out from the prices on show,
 * and the refund promise says it applies once per account. */
function premiumCopyContracts() {
  assert.equal(annualSaving('3.99', '39.99'), '7.89', '3.99 × 12 − 39.99');
  assert.equal(annualSaving('1.80', '18.00'), '3.60', '1.80 × 12 − 18.00 at the launch price');
  assert.equal(annualSaving('5.00', '70.00'), '0.00', 'a yearly plan dearer than twelve months saves nothing, never a negative amount');
  assert.equal(annualSaving(PREMIUM_PRICE.monthly, PREMIUM_PRICE.annual), '0.00');
  const offer = launchOfferDisplay();
  assert.equal(offer.offerAnnualSaving, annualSaving(offer.offerMonthly, offer.offerAnnual));
  assert.equal(offer.offerAnnualSaving, '0.05');
  assert.equal(offer.currency, 'EUR');
  // The sentence carries no amount of its own and no "months free".
  assert.equal(ENGLISH['premium.page.annualSaving'], 'Save {saving} {currency} a year');
  for (const [key, value] of Object.entries(ENGLISH)) {
    assert.doesNotMatch(value, /months? free/i, `${key} promises free months the prices do not give`);
  }
  // Every promise of the 14-day refund says once per account, as the Terms
  // and claimRefund (lib/billing/cancel.ts) do.
  for (const key of ['premium.page.smallPrint.refund', 'premium.page.faq.refundA', 'profile.deletePremium', 'legal.terms.refund.body', 'billing.cancel.optionWithdrawBody'] as const) {
    assert.match(ENGLISH[key], /once per account/, `${key} says the refund applies once per account`);
  }
}

/** A stand-in for the flashcards table that answers like PostgREST and
 * records every filter, so a test can see whose rows a request touched. */
function flashcardsDatabase(rows: Record<string, unknown>[]) {
  const calls: { op: string; filters: [string, unknown][]; row?: Record<string, unknown> }[] = [];
  const table = () => {
    const call: { op: string; filters: [string, unknown][]; row?: Record<string, unknown> } = { op: 'select', filters: [] };
    calls.push(call);
    const matching = () => rows.filter((row) => call.filters.every(([column, value]) => row[column] === value));
    const link = {
      select: () => link,
      eq: (column: string, value: unknown) => { call.filters.push([column, value]); return link; },
      order: () => link,
      upsert: (row: Record<string, unknown>) => { call.op = 'upsert'; call.row = row; return link; },
      delete: () => { call.op = 'delete'; return link; },
      single: async () => ({ data: call.row ?? null, error: null }),
      then: <A>(resolve: (value: { data: unknown[]; error: null }) => A) => resolve({ data: call.op === 'select' ? matching() : [], error: null }),
    };
    return link;
  };
  return { calls, db: { from: table } as never };
}

/** Owner decision 12: Shark Cards are saved questions, and the packs are gone. */
async function sharkCardContracts() {
  const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');
  const bank = await getEffectiveQuestions('webdev');
  const quizQuestion = bank.find((q) => !q.id.startsWith('rm-'));
  const learnQuestion = bank.find((q) => /^rm-js-\d+$/.test(q.id));
  assert.ok(quizQuestion && learnQuestion, 'the bank has a quiz question and a Learn question to save');
  const owner = 'contract-cards-owner';
  const other = 'contract-cards-other';
  const call = (method: string, user: string, body: Record<string, unknown> = {}, query: Record<string, unknown> = {}) => {
    caller += 1;
    return {
      method,
      headers: { 'x-forwarded-for': `10.58.${caller % 250}.${(caller * 5) % 250}` },
      query: { user_id: user, subject: 'webdev', ...query },
      body: { user_id: user, subject: 'webdev', ...body },
      socket: {},
    } as never;
  };

  // Saving keeps what the grading showed the learner. A browser that names a
  // real question and leaves the answer and explanation out gets nothing from
  // the bank back: the bank's answer and explanation are never read.
  {
    const { db, calls } = flashcardsDatabase([]);
    const res = mockResponse();
    await handleFlashcards(call('POST', owner, { question_id: quizQuestion.id, question: quizQuestion.question, correct_answer: 'not the answer' }), res as never, db);
    assert.equal(res.statusCode, 200);
    const saved = calls.find((one) => one.op === 'upsert')?.row ?? {};
    assert.equal(saved.user_id, owner, 'a card is saved to the caller');
    assert.equal(saved.correct_answer, 'not the answer', "the stored answer is the one the learner was shown, not the bank's");
    assert.equal(saved.explanation, null, 'no explanation is filled in from the bank');
    assert.equal(saved.category, quizQuestion.category, 'the topic comes from the bank');
    const body = JSON.stringify(res.body);
    const answer = quizQuestion.options[quizQuestion.correctAnswer];
    assert.ok(!body.includes(JSON.stringify(answer).slice(1, -1)) || answer === 'not the answer', 'the answer to a saved question is not in the response');
    assert.ok(!quizQuestion.explanation || !body.includes(JSON.stringify(quizQuestion.explanation).slice(1, -1)), "the bank's explanation is not in the response");
  }
  // A question that is not in this subject's bank is refused, before any write.
  {
    const { db, calls } = flashcardsDatabase([]);
    const res = mockResponse();
    await handleFlashcards(call('POST', owner, { question_id: 'no-such-question', question: 'Q?', correct_answer: 'A' }), res as never, db);
    assert.equal(res.statusCode, 400);
    assert.equal(errorCode(res), 'invalid_question');
    assert.equal(calls.length, 0);
  }
  // Reading serves only the caller's own cards, explanations included.
  {
    const card = (user: string, id: string) => ({ user_id: user, subject: 'webdev', question_id: id, question: 'Q?', category: 'javascript', correct_answer: 'A', explanation: `Why, for ${user}`, created_at: '2026-10-01T10:00:00Z' });
    const { db, calls } = flashcardsDatabase([card(owner, learnQuestion.id), card(other, quizQuestion.id)]);
    const res = mockResponse();
    await handleFlashcards(call('GET', owner), res as never, db);
    const cards = (res.body as { cards: { question_id: string; explanation: string }[] }).cards;
    assert.deepEqual(cards.map((one) => one.question_id), [learnQuestion.id], "a learner reads their own cards and no one else's");
    assert.ok(cards.every((one) => one.explanation === `Why, for ${owner}`));
    assert.deepEqual(calls[0].filters, [['user_id', owner], ['subject', 'webdev']]);
  }
  // Got it deletes the caller's own card and nothing else.
  {
    const { db, calls } = flashcardsDatabase([]);
    const res = mockResponse();
    await handleFlashcards(call('DELETE', owner, {}, { question_id: learnQuestion.id }), res as never, db);
    assert.equal(res.statusCode, 200);
    assert.equal(calls[0].op, 'delete');
    assert.deepEqual(calls[0].filters, [['user_id', owner], ['subject', 'webdev'], ['question_id', learnQuestion.id]]);
  }
  // Deleting names a card id as saving does: one no card can have is refused
  // before the database is asked.
  for (const id of ['x'.repeat(65), 'a\u0000b']) {
    const { db, calls } = flashcardsDatabase([]);
    const res = mockResponse();
    await handleFlashcards(call('DELETE', owner, {}, { question_id: id }), res as never, db);
    assert.equal(res.statusCode, 400, `a delete for ${JSON.stringify(id.slice(0, 8))} is refused (${JSON.stringify(res.body)})`);
    assert.equal(calls.length, 0, 'and nothing is deleted');
  }
  // Postgres text cannot hold U+0000: a card carrying one is refused before
  // the write, which would otherwise fail and answer 500.
  for (const field of ['question', 'correct_answer', 'explanation'] as const) {
    const { db, calls } = flashcardsDatabase([]);
    const res = mockResponse();
    const card = { question_id: quizQuestion.id, question: 'Q?', correct_answer: 'A', explanation: 'Why', [field]: 'before\u0000after' };
    await handleFlashcards(call('POST', owner, card), res as never, db);
    assert.equal(res.statusCode, 400, `a NUL in ${field} is refused (${JSON.stringify(res.body)})`);
    assert.equal(calls.length, 0, 'and nothing is written');
  }
  // A read that times out is the service being unavailable: 503, which the
  // client may retry, not a 500 internal error.
  {
    const hung = { from: () => {
      const link = {
        select: () => link,
        eq: () => link,
        order: () => link,
        then: (_resolve: unknown, reject: (error: unknown) => unknown) => reject(new UpstreamTimeoutError()),
      };
      return link;
    } } as never;
    const res = mockResponse();
    await handleFlashcards(call('GET', owner), res as never, hung);
    assert.equal(res.statusCode, 503, JSON.stringify(res.body));
    assert.equal(errorCode(res), 'upstream_timeout');
  }
  // A signed-out request is refused.
  {
    const res = mockResponse();
    await handleFlashcards({ method: 'GET', headers: { 'x-forwarded-for': '10.58.9.9' }, query: { subject: 'webdev' }, body: {}, socket: {} } as never, res as never, flashcardsDatabase([]).db);
    assert.equal(res.statusCode, 401);
  }

  // The card packs are retired: op=cards answers 410 for a read and a claim,
  // and no server or client code names the pack routine or table, apart from
  // the erasure routine in the migrations.
  for (const method of ['GET', 'POST']) {
    const res = mockResponse();
    retiredCardPacks({ method } as never, res as never);
    assert.equal(res.statusCode, 410);
    assert.equal(errorCode(res), 'gone');
  }
  assert.match(read('api/user/[op].ts'), /if \(op === 'cards'\) return retiredCardPacks\(req, res\);/);
  const sources = (dir: string): string[] => readdirSync(join(process.cwd(), dir), { withFileTypes: true }).flatMap((entry) => {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : sources(path);
    return /\.(ts|tsx)$/.test(entry.name) ? [path] : [];
  });
  for (const file of [...sources('api'), ...sources('lib'), ...sources('shared'), ...sources('client/src')]) {
    // Comments may tell the history; code may not call it.
    const code = read(file).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    assert.doesNotMatch(code, /rpc\('grant_daily_queue_cards'|from\('user_cards'\)|op=cards/, `${file} still grants or reads card packs`);
  }
  const erasure = read('supabase/supabase-schema-051.sql');
  assert.match(erasure, /DELETE FROM public\.user_cards WHERE user_id = p_user_id;/, 'account deletion still erases the retired cards');
  assert.match(erasure, /DELETE FROM public\.flashcards WHERE user_id = p_user_id;/, 'and the Shark Cards');

  // "Learn this topic": the Learn level a Learn question comes from, the
  // Learn topic of a quiz question, and a quiz for a topic Learn does not
  // teach. The prefixes agree with the ones lib/roadmap.ts builds ids from.
  for (const topic of SUBJECT_SCOPE_CATALOG.webdev.topics) {
    assert.ok(isRoadmapTopic(topic), `${topic} is a Learn topic`);
    for (const level of [1, 2, 5]) {
      for (const id of levelQuestionIds(topic, level)) {
        assert.deepEqual(learnLevelOfQuestion(id), { topic, level }, `${id} is ${topic} level ${level}`);
      }
    }
  }
  assert.deepEqual(Object.keys(LEARN_ID_PREFIXES).sort(), [...SUBJECT_SCOPE_CATALOG.webdev.topics].sort(), 'one prefix per Learn topic');
  assert.deepEqual(sharkCardStudyLink('rm-js-17', 'javascript'), { kind: 'level', to: '/learn?topic=javascript&level=3', topic: 'javascript', level: 3 });
  assert.deepEqual(sharkCardStudyLink('42', 'react'), { kind: 'topic', to: '/learn?topic=react', topic: 'react' });
  assert.deepEqual(sharkCardStudyLink('7', 'abbreviations'), { kind: 'practice', to: '/quiz?category=abbreviations', topic: 'abbreviations' });
  assert.equal(sharkCardStudyLink('rm-abbr-3', 'abbreviations')?.kind, 'practice', 'a retired Learn topic falls back to a quiz');
  assert.equal(sharkCardStudyLink('9', 'dev-world'), null, 'a category outside the subject has no link');
  assert.equal(sharkCardStudyLink('9', null), null);
  assert.equal(learnLevelOfQuestion(learnQuestion.id)?.topic, 'javascript');
}

export async function productCleanupContracts() {
  await merchPausedContracts();
  premiumCopyContracts();
  await sharkCardContracts();
}
