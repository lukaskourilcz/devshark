import { Text } from '@astryxdesign/core/Text';
import { LoadingLabel } from './ui/LoadingLabel';
import { SwimmingShark } from './SharkFin';
import { sxToStyle, type SxLike } from '../lib/styleProps';

/**
 * Style object accepted by `LoadingScreen`. Mirrors the small slice of MUI `sx`
 * callers actually pass (real CSS properties plus the `p*`/`m*` spacing
 * shorthands, whose numeric values are ×8px), merged onto the centring wrapper.
 */
interface Props {
  /** Screen-reader announcement describing what is loading. */
  label: string;
  /** Fin height in px. */
  size?: number;
  /** Extra styles merged onto the centering wrapper. */
  sx?: SxLike;
}

/* ──── Study-mode loading beat (shared by Quiz, Learn, Challenge, Play) ────
 * Every question-fetching moment shows the house motto with the swimming fin
 * beneath, and holds for at least MIN_LOADING_MS so it reads as a beat, not a
 * flicker. Use `holdLoadingScreen(startedAt)` after the fetch resolves. */

export const MIN_LOADING_MS = 1200;

export const holdLoadingScreen = (startedAt: number): Promise<void> =>
  new Promise((resolve) => window.setTimeout(resolve, Math.max(0, MIN_LOADING_MS - (Date.now() - startedAt))));

/** The quote + fin loading state for study modes. Fills its flex parent. */
export function QuoteLoader({ quote, label }: { quote: string; label: string }) {
  return (
    <div
      style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16 }}
    >
      <div style={{ fontStyle: 'italic', textAlign: 'center', maxWidth: 520, padding: '0 8px' }}>
        <Text type="large" weight="semibold" color="secondary">
          {quote}
        </Text>
      </div>
      <SwimmingShark size={44} />
      <Text type="supporting" color="secondary"><LoadingLabel>{label}</LoadingLabel></Text>
    </div>
  );
}

/** Centered swimming-shark-fin indicator with a screen-reader-announced label. */
export default function LoadingScreen({ label, size, sx }: Props) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        gap: 12,
        minHeight: '50vh',
        ...sxToStyle(sx),
      }}
    >
      <SwimmingShark size={size ?? 48} />
      <Text type="supporting" color="secondary"><LoadingLabel>{label}</LoadingLabel></Text>
    </div>
  );
}
