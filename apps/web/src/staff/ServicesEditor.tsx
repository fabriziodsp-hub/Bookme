/**
 * Services editor (D-048): names, audiences, age limit, visibility, phases and durations.
 * Used by the owner (Einstellungen) and by the platform admin (/admin) – the caller passes the endpoint.
 * Durations are edited as a table: one row per phase, one column per audience/variant combination.
 */
import {
  durationColumns,
  durationMatrix,
  newKey,
  withAudiences,
  withDurations,
  type Audience,
  type DurationColumn,
  type Phase,
  type SalonConfig,
  type Service,
} from '@salon/engine';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { api, errorMessage } from '../lib/api';
import { useT } from '../lib/i18n';
import { formatDuration, formatRange, makeLabels } from '../lib/labels';

interface Catalog {
  services: Service[];
  version: string;
  inUse: string[];
  step: number;
}

const AUDIENCES: Audience[] = ['women', 'men'];

/** Trimmed names; empty names fall back to the default name (label removed). */
function normalize(services: Service[]): Service[] {
  return services.map((s) => ({
    ...s,
    label: s.label?.trim() || undefined,
    phases: s.phases.map((p) => ({ ...p, label: p.label?.trim() || undefined })),
  }));
}

export function ServicesEditor({ endpoint, queryKey }: { endpoint: string; queryKey: unknown[] }) {
  const t = useT();
  const qc = useQueryClient();
  const q = useQuery({ queryKey, queryFn: () => api<Catalog>(endpoint) });
  const [draft, setDraft] = useState<Service[] | null>(null);
  const [msg, setMsg] = useState<{ text: string; error: boolean; conflict?: boolean } | null>(null);
  const services = useMemo(() => draft ?? q.data?.services ?? [], [draft, q.data]);
  const labels = useMemo(() => makeLabels({ services } as SalonConfig, t), [services, t]);

  if (q.isLoading) return <div className="spin" />;
  if (!q.data) return <p className="notice error">{q.error ? errorMessage(q.error) : ''}</p>;
  const { version, inUse, step } = q.data;

  const update = (id: string, fn: (s: Service) => Service) => {
    setMsg(null);
    setDraft(services.map((s) => (s.id === id ? fn(s) : s)));
  };
  const add = () => {
    const name = t('staff.svc.newService');
    const s: Service = {
      id: newKey(name, services.map((x) => x.id)),
      label: name,
      audiences: ['women', 'men'],
      adultOnly: false,
      hidden: false,
      collectsColorNotes: false,
      finishOption: false,
      phases: [{ key: newKey(t('staff.svc.newStep'), [], 'p'), label: t('staff.svc.newStep'), kind: 'busy', minutes: 30 }],
    };
    setMsg(null);
    setDraft([...services, s]);
  };
  const save = async () => {
    try {
      const r = await api<Catalog>(endpoint, { method: 'PUT', body: { services: normalize(services), version } });
      qc.setQueryData(queryKey, r);
      setDraft(null);
      setMsg({ text: t('staff.saved'), error: false });
      void qc.invalidateQueries({ queryKey: ['salon'] });
    } catch (e) {
      const conflict = (e as { code?: string }).code === 'CATALOG_CONFLICT';
      setMsg({ text: errorMessage(e), error: true, conflict });
    }
  };
  const reload = async () => {
    setDraft(null);
    setMsg(null);
    await q.refetch();
  };

  return (
    <div className="svc-editor">
      <p className="muted small">{t('staff.svc.intro')}</p>
      {services.map((s) => (
        <ServiceCard
          key={s.id}
          s={s}
          step={step}
          labels={labels}
          canRemove={!inUse.includes(s.id)}
          onChange={(fn) => update(s.id, fn)}
          onRemove={() => {
            if (window.confirm(t('staff.svc.confirmRemove', { name: labels.service(s.id) }))) setDraft(services.filter((x) => x.id !== s.id));
          }}
        />
      ))}
      <div className="row" style={{ marginTop: 12 }}>
        <button type="button" className="btn" onClick={add}>+ {t('staff.svc.addService')}</button>
        <span className="spacer" />
        {draft && <span className="badge warn">{t('staff.svc.unsaved')}</span>}
        <button type="button" className="btn primary" disabled={!draft} onClick={save}>{t('staff.save')}</button>
      </div>
      {msg && (
        <div className={`notice${msg.error ? ' error' : ''}`} role={msg.error ? 'alert' : 'status'} style={{ marginTop: 8 }}>
          {msg.text}
          {msg.conflict && <> <button type="button" className="btn" onClick={reload}>{t('staff.svc.reload')}</button></>}
        </div>
      )}
    </div>
  );
}

type Labels = ReturnType<typeof makeLabels>;

function ServiceCard({ s, step, labels, canRemove, onChange, onRemove }: { s: Service; step: number; labels: Labels; canRemove: boolean; onChange: (fn: (s: Service) => Service) => void; onRemove: () => void }) {
  const t = useT();
  const name = labels.service(s.id);
  const cols = durationColumns(s);
  const matrix = durationMatrix(s);
  const colLabel = (c: DurationColumn) =>
    [c.audience ? t(`audience.${c.audience}`) : null, c.variant ? labels.variant(c.variant) : null].filter(Boolean).join(' · ') || t('staff.svc.duration');
  const totals = cols.map((_, ci) => matrix.reduce((a, row) => a + row[ci]!, 0));
  const setMinutes = (pi: number, ci: number, n: number) =>
    onChange((x) => withDurations(x, durationMatrix(x).map((row, i) => (i === pi ? row.map((m, j) => (j === ci ? n : m)) : row))));
  const setPhase = (pi: number, patch: Partial<Phase>) => onChange((x) => ({ ...x, phases: x.phases.map((p, i) => (i === pi ? { ...p, ...patch } : p)) }));
  const move = (pi: number, d: -1 | 1) =>
    onChange((x) => {
      const ph = [...x.phases];
      [ph[pi], ph[pi + d]] = [ph[pi + d]!, ph[pi]!];
      return { ...x, phases: ph };
    });
  const addPhase = () =>
    onChange((x) => {
      const label = t('staff.svc.newStep');
      const key = newKey(label, x.phases.map((p) => p.key), 'p');
      // New step: 15 minutes in every column (same row for every audience/variant).
      const m = durationMatrix(x);
      const next: Service = { ...x, phases: [...x.phases, { key, label, kind: 'busy', minutes: 15 }] };
      return withDurations(next, [...m, durationColumns(x).map(() => 15)]);
    });
  const removePhase = (pi: number) =>
    onChange((x) => withDurations({ ...x, phases: x.phases.filter((_, i) => i !== pi) }, durationMatrix(x).filter((_, i) => i !== pi)));
  const toggleAudience = (a: Audience, on: boolean) =>
    onChange((x) => withAudiences(x, AUDIENCES.filter((y) => (y === a ? on : x.audiences.includes(y)))));

  return (
    <details className="card svc-card">
      <summary>
        <strong>{name}</strong>
        <span className="muted small"> · {s.audiences.map((a) => t(`audience.${a}`)).join(', ')} · {formatRange(Math.min(...totals), Math.max(...totals))}</span>
        {s.hidden && <span className="badge"> {t('staff.svc.hiddenBadge')}</span>}
      </summary>

      <div className="field" style={{ marginTop: 12 }}>
        <label htmlFor={`svc-${s.id}-name`}>{t('staff.svc.name')}</label>
        <input id={`svc-${s.id}-name`} type="text" maxLength={60} value={s.label ?? name} onChange={(e) => onChange((x) => ({ ...x, label: e.target.value }))} />
      </div>
      <fieldset className="row" style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="small" style={{ marginBottom: 4 }}>{t('staff.svc.audiences')}</legend>
        {AUDIENCES.map((a) => (
          <label key={a} className="check">
            <input type="checkbox" checked={s.audiences.includes(a)} onChange={(e) => toggleAudience(a, e.target.checked)} />
            <span>{t(`audience.${a}`)}</span>
          </label>
        ))}
      </fieldset>
      <label className="check">
        <input type="checkbox" checked={s.adultOnly} onChange={(e) => onChange((x) => ({ ...x, adultOnly: e.target.checked }))} />
        <span>{t('staff.svc.adultOnly')}</span>
      </label>
      <label className="check">
        <input type="checkbox" checked={s.hidden} onChange={(e) => onChange((x) => ({ ...x, hidden: e.target.checked }))} />
        <span>{t('staff.svc.hidden')}</span>
      </label>

      <h3 className="small" style={{ margin: '12px 0 4px' }}>{t('staff.svc.steps')}</h3>
      <div style={{ overflowX: 'auto' }}>
        <table className="prices svc-table">
          <thead>
            <tr>
              <th scope="col">{t('staff.svc.step')}</th>
              <th scope="col">{t('staff.svc.kind')}</th>
              {cols.map((c, ci) => <th key={ci} scope="col">{colLabel(c)}</th>)}
              {s.finishOption && <th scope="col">{t('staff.svc.withFinish')}</th>}
              <th scope="col"><span className="sr-only">{t('staff.svc.step')}</span></th>
            </tr>
          </thead>
          <tbody>
            {s.phases.map((p, pi) => {
              const stepName = labels.phase(p.key, s.id);
              return (
                <tr key={p.key}>
                  <td><input type="text" maxLength={40} aria-label={`${name}: ${t('staff.svc.step')} ${pi + 1} – ${t('staff.svc.name')}`} value={p.label ?? stepName} onChange={(e) => setPhase(pi, { label: e.target.value })} style={{ minWidth: 140 }} /></td>
                  <td>
                    <select aria-label={`${name}, ${stepName}: ${t('staff.svc.kind')}`} value={p.kind} onChange={(e) => setPhase(pi, { kind: e.target.value as Phase['kind'] })} style={{ minWidth: 130 }}>
                      <option value="busy">{t('staff.svc.busy')}</option>
                      <option value="free">{t('staff.svc.free')}</option>
                    </select>
                  </td>
                  {cols.map((c, ci) => (
                    <td key={ci}>
                      <input type="number" min={step} max={600} step={step} inputMode="numeric" aria-label={`${name}, ${stepName}, ${colLabel(c)}: Minuten`} value={matrix[pi]![ci]} onChange={(e) => setMinutes(pi, ci, Math.round(Number(e.target.value)))} style={{ width: 90 }} />
                    </td>
                  ))}
                  {s.finishOption && (
                    <td>
                      <input type="number" min={step} max={600} step={step} inputMode="numeric" aria-label={`${name}, ${stepName}, ${t('staff.svc.withFinish')}: Minuten`} value={p.finishMinutes ?? ''} placeholder="–"
                        onChange={(e) => setPhase(pi, { finishMinutes: e.target.value === '' ? undefined : Math.round(Number(e.target.value)) })} style={{ width: 90 }} />
                    </td>
                  )}
                  <td className="svc-actions">
                    <button type="button" className="btn" disabled={pi === 0} aria-label={t('staff.svc.moveUp', { step: stepName })} onClick={() => move(pi, -1)}>↑</button>
                    <button type="button" className="btn" disabled={pi === s.phases.length - 1} aria-label={t('staff.svc.moveDown', { step: stepName })} onClick={() => move(pi, 1)}>↓</button>
                    <button type="button" className="btn" disabled={s.phases.length === 1} aria-label={t('staff.svc.removeStep', { step: stepName })} onClick={() => removePhase(pi)}>✕</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row" colSpan={2}>{t('staff.svc.total')}</th>
              {totals.map((m, ci) => <td key={ci}>{formatDuration(m)}</td>)}
              {s.finishOption && <td />}
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
      <div className="row" style={{ marginTop: 8 }}>
        <button type="button" className="btn" onClick={addPhase}>+ {t('staff.svc.addStep')}</button>
        <span className="spacer" />
        {canRemove ? (
          <button type="button" className="btn" onClick={onRemove}>{t('staff.svc.remove')}</button>
        ) : (
          <span className="muted small">{t('staff.svc.inUse')}</span>
        )}
      </div>
    </details>
  );
}
