import type { Block } from '@salon/engine';
import { useT } from '../lib/i18n';
import { useLabels } from '../lib/labels';

/** Proportional, solid segments (no hatching): busy = accent, free (Einwirkzeit) = warm yellow. */
/** `serviceId` lets the salon's own phase names (services editor) win. */
export function DurationBar({ blocks, serviceId }: { blocks: Block[]; serviceId?: string | undefined }) {
  const t = useT();
  const L = useLabels();
  const total = blocks.at(-1)!.end - blocks[0]!.start;
  return (
    <div>
      <div className="bar" role="img" aria-label={blocks.map((b) => `${L.phase(b.phase, serviceId)} ${b.end - b.start} Minuten${b.kind === 'free' ? ' (Einwirkzeit, frei)' : ''}`).join(', ')}>
        {blocks.map((b, i) => (
          <div key={i} className={b.kind === 'free' ? 'free' : ''} style={{ flex: b.end - b.start }} title={`${L.phase(b.phase, serviceId)} · ${b.end - b.start}′`}>
            {L.phase(b.phase, serviceId)} · {b.end - b.start}′
          </div>
        ))}
      </div>
      <span className="sr-only">{t('ui.step.duration', { n: total })}</span>
    </div>
  );
}
