// Merchandise operations in the admin console (#229): the quotes and coin
// prices, this month's caps, and the fulfilment queue.
//
// Spreadshop (sprd.net AG) prints and ships devShark merchandise and has no
// order API. A coin redemption or a claimed learning-path package is a
// merch_orders row; the owner orders the item at base price from the
// Spreadshop preview ("order product samples") to the learner's address, marks
// it ordered here, and records the carrier and tracking number when it ships.
//
// Every figure is validated again on the server: a quote missing any field is
// dropped there and the item goes back to "not on sale yet", and a cap below
// what paid orders hold is refused. Cash checkout stays off; cash sales happen
// in the Spreadshop checkout.

import { useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import { useQuery } from '@tanstack/react-query';
import { TextInput } from '@astryxdesign/core/TextInput';
import { Switch } from '@astryxdesign/core/Switch';
import { Button } from '@astryxdesign/core/Button';
import { Badge } from '@astryxdesign/core/Badge';
import { Banner } from '@astryxdesign/core/Banner';
import LoadingScreen from '../LoadingScreen';
import ErrorRetry from '../ErrorRetry';
import { AppToast } from '../ui/AppToast';
import { friendlyError } from '../../lib/api';
import { queryClient } from '../../lib/queryClient';
import { useT } from '../../i18n/LanguageContext';
import type { TranslationKey } from '../../i18n/translations';
import {
  advanceOrder,
  getAdminSettings,
  getFulfilment,
  saveAdminSettings,
  setMerchStock,
  type FulfilmentOrder,
  type FulfilmentView,
  type GameSettings,
} from '../../lib/devApi';
import {
  DEFAULT_MERCH_SETTINGS,
  MERCH_ENABLED,
  MERCH_CATALOGUE,
  MERCH_SKUS,
  merchMarginMinor,
  type MerchPricing,
  type MerchSettings,
  type MerchSku,
} from '../../../../shared/rewards';
import { Section, captionStyle } from './DevSettings';

const SETTINGS_KEY = ['admin', 'settings'] as const;
const fulfilmentKey = (view: FulfilmentView) => ['admin', 'fulfilment', view] as const;

/** Spreadshop's EU base prices as quoted in September 2026, shown as a hint
 * beside the field. A hint, not a value: the owner enters the price the shop
 * actually shows. */
const QUOTED_BASE_PRICE: Partial<Record<MerchSku, string>> = {
  't-shirt': '17.49 (premium 20.99)',
  hoodie: '29.99 (premium 31.99)',
  mug: '13.49',
  'sticker-set': '2.49 per 10 × 10 cm sticker, 1.99 per XS',
};

interface QuoteDraft {
  priced: boolean;
  base: string;
  print: string;
  shipping: string;
  packaging: string;
  retail: string;
  currency: string;
  taxIncluded: boolean;
  coins: string;
  regions: string;
  vendor: string;
  effectiveFrom: string;
}

const today = () => new Date().toISOString().slice(0, 10);
const money = (minor: number) => (minor / 100).toFixed(2);
const toMinor = (text: string): number | null => {
  const value = Number(text.trim().replace(',', '.'));
  return text.trim() !== '' && Number.isFinite(value) && value >= 0 ? Math.round(value * 100) : null;
};

const toDraft = (pricing: MerchPricing | undefined): QuoteDraft => pricing
  ? {
      priced: true,
      base: money(pricing.unitCostMinor),
      print: money(pricing.printCostMinor),
      shipping: money(pricing.shippingCostMinor),
      packaging: money(pricing.packagingCostMinor),
      retail: money(pricing.priceMinor),
      currency: pricing.currency,
      taxIncluded: pricing.taxIncluded,
      coins: pricing.tokenPrice ? String(pricing.tokenPrice) : '',
      regions: pricing.regions.join(', '),
      vendor: pricing.vendor,
      effectiveFrom: pricing.effectiveFrom,
    }
  : {
      priced: false, base: '', print: '0', shipping: '', packaging: '0', retail: '', currency: 'EUR',
      taxIncluded: true, coins: '', regions: '', vendor: 'sprd.net AG', effectiveFrom: today(),
    };

/** A draft as the server's pricing shape, or the field that stops it. */
export function draftToPricing(draft: QuoteDraft): { pricing: MerchPricing } | { missing: string } {
  const base = toMinor(draft.base);
  if (base === null) return { missing: 'base price' };
  const print = toMinor(draft.print);
  if (print === null) return { missing: 'print cost' };
  const shipping = toMinor(draft.shipping);
  if (shipping === null) return { missing: 'shipping' };
  const packaging = toMinor(draft.packaging);
  if (packaging === null) return { missing: 'packaging' };
  const retail = toMinor(draft.retail);
  if (retail === null) return { missing: 'retail price' };
  const currency = draft.currency.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) return { missing: 'currency' };
  const regions = draft.regions.split(',').map((one) => one.trim().toUpperCase()).filter(Boolean);
  if (regions.length === 0 || regions.some((one) => !/^[A-Z]{2}$/.test(one))) return { missing: 'countries' };
  if (!draft.vendor.trim()) return { missing: 'vendor' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.effectiveFrom.trim())) return { missing: 'effective date' };
  const coins = draft.coins.trim() === '' ? undefined : Number(draft.coins);
  if (coins !== undefined && (!Number.isInteger(coins) || coins <= 0)) return { missing: 'coin price' };
  return {
    pricing: {
      unitCostMinor: base,
      printCostMinor: print,
      shippingCostMinor: shipping,
      packagingCostMinor: packaging,
      priceMinor: retail,
      currency,
      taxIncluded: draft.taxIncluded,
      ...(coins !== undefined ? { tokenPrice: coins } : {}),
      regions,
      vendor: draft.vendor.trim(),
      effectiveFrom: draft.effectiveFrom.trim(),
    },
  };
}

const rowStyle: CSSProperties = { display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end', width: '100%' };
const cardStyle: CSSProperties = {
  width: '100%',
  padding: 14,
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-inner)',
  background: 'var(--color-background-default)',
};

export default function DevMerch() {
  const [snack, setSnack] = useState<string | null>(null);
  return (
    <div style={{ maxWidth: 960 }}>
      {/* Owner decision 10: merchandise is off until next quarter. The console
          stays so quotes and caps can be prepared, and says that nothing here
          reaches a learner yet. */}
      {!MERCH_ENABLED && (
        <Banner
          status="warning"
          title="Merchandise is off until next quarter"
          description="Learners see no merchandise, no coin redemption and no learning-path package, and the server refuses orders and package claims with merch_unavailable, whatever is saved here. Turn it on with MERCH_ENABLED in shared/rewards.ts."
          style={{ marginBottom: 16 }}
        />
      )}
      <p style={{ ...captionStyle, marginTop: 0, marginBottom: 16 }}>
        Spreadshop prints, sells and ships the merchandise. Anyone buys with money in the devShark shop there; Premium
        members redeem coins here, and you order each redemption at base price from the Spreadshop preview (Order product
        samples) to the address in the queue below.
      </p>
      <Quotes onDone={setSnack} />
      <Caps onDone={setSnack} />
      <Queue onDone={setSnack} />
      <AppToast open={!!snack} onClose={() => setSnack(null)} message={snack ?? ''} severity="info" autoHideDuration={3500} />
    </div>
  );
}

/* ── quotes and coin prices ─────────────────────────────────────────────── */

function Quotes({ onDone }: { onDone: (message: string) => void }) {
  const t = useT();
  const settingsQuery = useQuery({ queryKey: SETTINGS_KEY, queryFn: getAdminSettings });
  const base = settingsQuery.data?.settings ?? null;
  const merch: MerchSettings = base?.merch ?? DEFAULT_MERCH_SETTINGS;
  const [enabled, setEnabled] = useState(false);
  const [testMode, setTestMode] = useState(true);
  const [policyUrl, setPolicyUrl] = useState('');
  const [drafts, setDrafts] = useState<Record<MerchSku, QuoteDraft> | null>(null);
  const [saving, setSaving] = useState(false);

  // Fill the form from each new copy of the settings, unless it holds unsaved
  // edits: a re-read that landed mid-edit (a reconnect, App settings saving)
  // used to throw the quotes being typed away. Its own save refills it.
  const formRef = useRef<string | null>(null);
  const hydratedRef = useRef<string | null>(null);
  formRef.current = drafts ? JSON.stringify({ enabled, testMode, policyUrl, drafts }) : null;
  useEffect(() => {
    if (!settingsQuery.data) return;
    const current = settingsQuery.data.settings.merch ?? DEFAULT_MERCH_SETTINGS;
    const next = {
      enabled: current.enabled,
      testMode: current.testMode,
      policyUrl: current.policyUrl,
      drafts: Object.fromEntries(MERCH_SKUS.map((sku) => [sku, toDraft(current.pricing[sku])])) as Record<MerchSku, QuoteDraft>,
    };
    const previous = hydratedRef.current;
    hydratedRef.current = JSON.stringify(next);
    if (formRef.current !== null && previous !== null && formRef.current !== previous) return;
    setEnabled(next.enabled);
    setTestMode(next.testMode);
    setPolicyUrl(next.policyUrl);
    setDrafts(next.drafts);
  }, [settingsQuery.data]);

  if (settingsQuery.isPending) return <LoadingScreen label="Loading merchandise settings…" />;
  if (settingsQuery.error) {
    return <ErrorRetry message={friendlyError(settingsQuery.error)} onRetry={() => settingsQuery.refetch()} />;
  }
  if (!base || !drafts) return null;

  const setDraft = (sku: MerchSku, patch: Partial<QuoteDraft>) =>
    setDrafts((current) => (current ? { ...current, [sku]: { ...current[sku], ...patch } } : current));

  const save = async () => {
    const pricing: MerchSettings['pricing'] = {};
    for (const sku of MERCH_SKUS) {
      if (!drafts[sku].priced) continue;
      const result = draftToPricing(drafts[sku]);
      if ('missing' in result) {
        onDone(`${t(`shop.merch.${sku}.name` as TranslationKey)}: check the ${result.missing}. Nothing was saved.`);
        return;
      }
      pricing[sku] = result.pricing;
    }
    setSaving(true);
    try {
      const next: GameSettings = { ...base, merch: { ...merch, enabled, testMode, policyUrl: policyUrl.trim(), pricing } };
      const { settings } = await saveAdminSettings(next);
      hydratedRef.current = null;
      queryClient.setQueryData(SETTINGS_KEY, { settings });
      const dropped = Object.keys(pricing).filter((sku) => !settings.merch?.pricing[sku as MerchSku]);
      onDone(dropped.length ? `Saved, but the server refused the quote for ${dropped.join(', ')}.` : 'Merchandise settings saved');
    } catch (err) {
      onDone(friendlyError(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Section title="Coin redemption">
        <Switch label="Open coin redemption" value={enabled} onChange={setEnabled} />
        <Switch label="Test mode (orders are marked as tests)" value={testMode} onChange={setTestMode} />
        <TextInput
          label="Delivery and returns page (https URL)"
          value={policyUrl}
          onChange={setPolicyUrl}
          size="sm"
          style={{ flex: 1, minWidth: 260 }}
        />
        <span style={{ ...captionStyle, width: '100%' }}>
          Cash checkout here stays off: money is paid in the Spreadshop checkout. An item without a complete quote reads
          &ldquo;Not on sale yet&rdquo; whatever these switches say.
        </span>
      </Section>

      <Section title="Quotes and coin prices">
        <span style={{ ...captionStyle, width: '100%' }}>
          Amounts in the currency below, with decimals. Base price is what Spreadshop charges you for a sample order (print
          and packaging are inside it, so they stay 0); shipping is what its checkout shows; retail is the price in the
          devShark shop. Coin prices: a steady Premium learner earns 100 to 200 coins a day, so 1,500 is about two weeks.
        </span>
        {MERCH_CATALOGUE.map((item) => (
          <QuoteCard key={item.sku} sku={item.sku} draft={drafts[item.sku]} onChange={(patch) => setDraft(item.sku, patch)} />
        ))}
        <div style={{ display: 'flex', gap: 12, width: '100%' }}>
          <Button variant="primary" label={saving ? 'Saving…' : 'Save merchandise settings'} onClick={save} isDisabled={saving} />
          <Button
            variant="secondary"
            label="Revert"
            isDisabled={saving}
            onClick={() => setDrafts(Object.fromEntries(MERCH_SKUS.map((sku) => [sku, toDraft(merch.pricing[sku])])) as Record<MerchSku, QuoteDraft>)}
          />
        </div>
      </Section>
    </>
  );
}

function QuoteCard({ sku, draft, onChange }: { sku: MerchSku; draft: QuoteDraft; onChange: (patch: Partial<QuoteDraft>) => void }) {
  const t = useT();
  const priced = draftToPricing(draft);
  const field = (key: keyof QuoteDraft, label: string, width = 140, description?: string) => (
    <TextInput
      label={label}
      value={String(draft[key])}
      onChange={(value) => onChange({ [key]: value } as Partial<QuoteDraft>)}
      size="sm"
      description={description}
      style={{ width }}
    />
  );
  return (
    <div style={cardStyle}>
      <div style={{ ...rowStyle, alignItems: 'center', marginBottom: draft.priced ? 12 : 0 }}>
        <h3 style={{ margin: 0, fontSize: '1rem' }}>{t(`shop.merch.${sku}.name` as TranslationKey)}</h3>
        <Switch label="Priced" value={draft.priced} onChange={(value) => onChange({ priced: value })} />
        {!draft.priced && <Badge variant="neutral" label="Not on sale yet" />}
        {draft.priced && 'pricing' in priced && (
          <span style={captionStyle}>
            Margin at the retail price: {money(merchMarginMinor(priced.pricing))} {priced.pricing.currency}
          </span>
        )}
        {draft.priced && 'missing' in priced && <span style={captionStyle}>Missing: {priced.missing}</span>}
      </div>
      {draft.priced && (
        <div style={rowStyle}>
          {field('base', 'Base price', 160, QUOTED_BASE_PRICE[sku] ? `Quoted Sept 2026: ${QUOTED_BASE_PRICE[sku]}` : undefined)}
          {field('shipping', 'Shipping')}
          {field('print', 'Print')}
          {field('packaging', 'Packaging')}
          {field('retail', 'Retail price')}
          {field('currency', 'Currency', 100)}
          <Switch label="VAT included" value={draft.taxIncluded} onChange={(value) => onChange({ taxIncluded: value })} />
          {field('coins', 'Coin price', 140)}
          {field('regions', 'Countries (CZ, SK, …)', 200)}
          {field('vendor', 'Vendor', 180)}
          {field('effectiveFrom', 'Effective from', 160)}
        </div>
      )}
    </div>
  );
}

/* ── this month's caps ──────────────────────────────────────────────────── */

function Caps({ onDone }: { onDone: (message: string) => void }) {
  const t = useT();
  const query = useQuery({ queryKey: fulfilmentKey('queue'), queryFn: () => getFulfilment('queue') });
  const rows = MERCH_CATALOGUE.flatMap((item) =>
    (item.variants.length > 0 ? item.variants : ['']).map((variant) => ({ sku: item.sku, variant })));

  return (
    <Section title="This month's caps">
      <span style={{ ...captionStyle, width: '100%' }}>
        How many of each item and size you will still post this month. A redemption holds one until it ships; shipping
        uses it up. Set the caps again at the start of each month. Nothing can be redeemed where the cap is 0.
      </span>
      {query.isPending && <span style={captionStyle}>Loading caps…</span>}
      {query.isError && <ErrorRetry message={friendlyError(query.error)} onRetry={() => query.refetch()} />}
      {query.data && (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
          <thead>
            <tr style={{ textAlign: 'left' }}>
              <th scope="col" style={{ padding: '6px 8px' }}>Item</th>
              <th scope="col" style={{ padding: '6px 8px' }}>Left to post</th>
              <th scope="col" style={{ padding: '6px 8px' }}>Held by orders</th>
              <th scope="col" style={{ padding: '6px 8px' }}>Free to redeem</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ sku, variant }) => {
              const row = query.data.stock.find((one) => one.sku === sku && one.variant === variant);
              return (
                <CapRow
                  key={`${sku}|${variant}`}
                  label={`${t(`shop.merch.${sku}.name` as TranslationKey)}${variant ? ` · ${variant}` : ''}`}
                  onHand={row?.onHand ?? 0}
                  reserved={row?.reserved ?? 0}
                  onSave={async (onHand) => {
                    try {
                      await setMerchStock(sku, variant, onHand);
                      await queryClient.invalidateQueries({ queryKey: ['admin', 'fulfilment'] });
                      onDone('Cap saved');
                    } catch (err) {
                      onDone(friendlyError(err));
                    }
                  }}
                />
              );
            })}
          </tbody>
        </table>
      )}
    </Section>
  );
}

function CapRow({ label, onHand, reserved, onSave }: {
  label: string;
  onHand: number;
  reserved: number;
  onSave: (onHand: number) => Promise<void>;
}) {
  const [value, setValue] = useState(String(onHand));
  const [busy, setBusy] = useState(false);
  const id = useId();
  useEffect(() => setValue(String(onHand)), [onHand]);
  const parsed = Number(value);
  const valid = value.trim() !== '' && Number.isInteger(parsed) && parsed >= reserved && parsed <= 100_000;
  return (
    <tr style={{ borderTop: '1px solid var(--color-border)' }}>
      <th scope="row" style={{ padding: '6px 8px', fontWeight: 600, textAlign: 'left' }}>
        <label htmlFor={id}>{label}</label>
      </th>
      <td style={{ padding: '6px 8px' }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            id={id}
            inputMode="numeric"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            aria-invalid={!valid || undefined}
            style={{
              width: 80, minHeight: 36, padding: '0 8px', borderRadius: 8, font: 'inherit',
              border: '1px solid var(--color-border-strong)', background: 'var(--color-background-surface)', color: 'var(--color-text-primary)',
            }}
          />
          <Button
            variant="secondary"
            size="sm"
            label={busy ? 'Saving…' : 'Save'}
            isDisabled={busy || !valid || parsed === onHand}
            onClick={async () => {
              setBusy(true);
              await onSave(parsed);
              setBusy(false);
            }}
          />
        </div>
        {!valid && <span style={captionStyle}>A whole number, at least {reserved}.</span>}
      </td>
      <td style={{ padding: '6px 8px' }}>{reserved}</td>
      <td style={{ padding: '6px 8px' }}>{Math.max(0, onHand - reserved)}</td>
    </tr>
  );
}

/* ── the fulfilment queue ───────────────────────────────────────────────── */

const VIEWS: { id: FulfilmentView; label: string }[] = [
  { id: 'queue', label: 'To order at Spreadshop' },
  { id: 'submitted', label: 'Ordered, not shipped' },
  { id: 'shipped', label: 'Shipped' },
  { id: 'refunded', label: 'Refunded' },
  { id: 'cancelled', label: 'Cancelled' },
];

function Queue({ onDone }: { onDone: (message: string) => void }) {
  const [view, setView] = useState<FulfilmentView>('queue');
  const query = useQuery({ queryKey: fulfilmentKey(view), queryFn: () => getFulfilment(view) });
  const selectId = useId();
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['admin', 'fulfilment'] });

  return (
    <Section title="Fulfilment">
      <span style={{ ...captionStyle, width: '100%' }}>
        For each order: open the Spreadshop preview, choose Order product samples, order the items at base price to the
        address shown, then mark it ordered. When Spreadshop ships it, enter the carrier and the tracking number. Check
        this queue once a week. Addresses are here only to post the parcel; do not copy them anywhere else.
      </span>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <label htmlFor={selectId} style={{ fontSize: '0.8rem', fontWeight: 600 }}>Show</label>
        <select
          id={selectId}
          value={view}
          onChange={(event) => setView(event.target.value as FulfilmentView)}
          style={{
            minHeight: 40, borderRadius: 'var(--radius-element)', border: '1px solid var(--color-border-strong)',
            background: 'var(--color-background-surface)', color: 'var(--color-text-primary)', padding: '0 12px', font: 'inherit',
          }}
        >
          {VIEWS.map((one) => <option key={one.id} value={one.id}>{one.label}</option>)}
        </select>
      </div>
      {query.isPending && <span style={{ ...captionStyle, width: '100%' }}>Loading orders…</span>}
      {query.isError && <ErrorRetry message={friendlyError(query.error)} onRetry={() => query.refetch()} />}
      {query.data && query.data.orders.length === 0 && (
        <span style={{ ...captionStyle, width: '100%' }}>Nothing here.</span>
      )}
      {query.data?.orders.map((order) => (
        <OrderCard
          key={order.order_id}
          order={order}
          items={query.data.items.filter((item) => item.order_id === order.order_id)}
          onDone={async (message) => {
            onDone(message);
            await refresh();
          }}
        />
      ))}
    </Section>
  );
}

function OrderCard({ order, items, onDone }: {
  order: FulfilmentOrder;
  items: { sku: MerchSku; variant: string; quantity: number }[];
  onDone: (message: string) => Promise<void>;
}) {
  const t = useT();
  const [carrier, setCarrier] = useState(order.carrier ?? '');
  const [tracking, setTracking] = useState(order.tracking_ref ?? '');
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [busy, setBusy] = useState(false);
  // `busy` disables the buttons a render late, so a double click sent a
  // cancel twice and the second came back as an error after the refund.
  const busyRef = useRef(false);
  const sendable = order.state === 'paid' || (order.package && order.state === 'awaiting_payment');
  const shippable = sendable || order.state === 'submitted';
  const cancellable = order.state === 'paid' || order.state === 'awaiting_payment';

  const act = async (op: 'submit' | 'ship' | 'cancel', message: string) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      await advanceOrder(order.order_id, op, op === 'ship' ? { carrier: carrier.trim(), trackingRef: tracking.trim() } : undefined);
      await onDone(message);
    } catch (err) {
      await onDone(friendlyError(err));
    } finally {
      busyRef.current = false;
      setBusy(false);
      setConfirmCancel(false);
    }
  };

  return (
    <article style={cardStyle} aria-label={`Order ${order.order_id}`}>
      <div style={{ ...rowStyle, alignItems: 'center', marginBottom: 8 }}>
        <strong>{new Date(order.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</strong>
        <code style={{ fontSize: '0.75rem' }}>{order.order_id.slice(0, 12)}…</code>
        {order.package ? <Badge variant="neutral" label="Learning-path package" /> : <Badge variant="neutral" label={`${order.token_total ?? 0} coins`} />}
        {order.test_mode && <Badge variant="neutral" label="Test" />}
      </div>
      <ul style={{ margin: '0 0 8px', paddingLeft: 18 }}>
        {items.map((item) => (
          <li key={`${item.sku}|${item.variant}`}>
            {t(`shop.merch.${item.sku}.name` as TranslationKey)}{item.variant ? ` · ${item.variant}` : ''} × {item.quantity}
          </li>
        ))}
      </ul>
      <address style={{ fontStyle: 'normal', fontSize: '0.88rem', lineHeight: 1.5, marginBottom: 10 }}>
        {order.ship_name}<br />
        {order.ship_line1}<br />
        {order.ship_line2 && <>{order.ship_line2}<br /></>}
        {order.ship_postal} {order.ship_city}<br />
        {order.ship_country}
      </address>
      {order.tracking_ref && <p style={{ ...captionStyle, margin: '0 0 8px' }}>{order.carrier} · {order.tracking_ref}</p>}
      <div style={rowStyle}>
        {sendable && (
          <Button variant="secondary" size="sm" label="Ordered at Spreadshop" isDisabled={busy} onClick={() => act('submit', 'Marked as ordered')} />
        )}
        {shippable && (
          <>
            <TextInput label="Carrier" value={carrier} onChange={setCarrier} size="sm" style={{ width: 160 }} />
            <TextInput label="Tracking number" value={tracking} onChange={setTracking} size="sm" style={{ width: 200 }} />
            <Button
              variant="primary"
              size="sm"
              label="Mark shipped"
              isDisabled={busy || !carrier.trim() || !tracking.trim()}
              onClick={() => act('ship', 'Marked as shipped')}
            />
          </>
        )}
        {cancellable && (confirmCancel ? (
          <>
            <Button
              variant="primary"
              size="sm"
              label={order.package ? 'Yes, cancel the package' : 'Yes, cancel and refund the coins'}
              isDisabled={busy}
              onClick={() => act('cancel', 'Order cancelled')}
            />
            <Button variant="secondary" size="sm" label="Keep it" isDisabled={busy} onClick={() => setConfirmCancel(false)} />
          </>
        ) : (
          <Button variant="secondary" size="sm" label="Cancel order" isDisabled={busy} onClick={() => setConfirmCancel(true)} />
        ))}
      </div>
    </article>
  );
}
