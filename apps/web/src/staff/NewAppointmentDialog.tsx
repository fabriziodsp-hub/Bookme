import { findService, formatHm, offeredServices, parseHm, type LocalDate } from '@salon/engine';
import { useQuery } from '@tanstack/react-query';
import { useDeferredValue, useEffect, useRef, useState, type FormEvent } from 'react';
import { Dialog } from '../components/Dialog';
import { api, errorMessage } from '../lib/api';
import { formatPhone } from '../lib/format';
import { useT } from '../lib/i18n';
import { useLabels } from '../lib/labels';
import { useSalon } from '../lib/salon';
import { useStylists } from './hooks';
import type { Appointment } from '../lib/types';

interface Found {
  id: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  email: string | null;
}

/**
 * Phone / walk-in appointment: confirmed directly, 5′ grid (S-6). First the client: search the
 * client cards, or "+" for a new client (D-064). `start` comes from a click into the calendar (D-067).
 */
export function NewAppointmentDialog(p: { date: LocalDate; stylistId: string; start?: number | undefined; onClose: () => void; onCreated: (a: Appointment) => void }) {
  const t = useT();
  const L = useLabels();
  const salon = useSalon();
  const stylists = useStylists();
  const cfg = salon.config;
  const [audience, setAudience] = useState<'women' | 'men'>('women');
  const [serviceId, setServiceId] = useState('cut');
  const [variant, setVariant] = useState<string>('');
  const [finish, setFinish] = useState(false);
  const [stylistId, setStylistId] = useState(p.stylistId);
  const [date, setDate] = useState(p.date);
  const [time, setTime] = useState(formatHm(p.start ?? 540));
  const [q, setQ] = useState('');
  const dq = useDeferredValue(q.trim());
  const [picked, setPicked] = useState<Found | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [c, setC] = useState({ firstName: '', lastName: '', phone: '', email: '' });
  const [internalNote, setInternalNote] = useState('');
  const [notify, setNotify] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const services = offeredServices(cfg, audience, true);
  const service = findService(cfg, serviceId) ?? services[0];
  const searchRef = useRef<HTMLInputElement>(null);
  const firstRef = useRef<HTMLInputElement>(null);
  useEffect(() => searchRef.current?.focus(), []);
  useEffect(() => {
    if (isNew) firstRef.current?.focus();
  }, [isNew]);
  const found = useQuery({
    queryKey: ['customers', dq, 'name', 'pick'],
    queryFn: () => api<{ customers: Found[] }>(`/staff/customers?q=${encodeURIComponent(dq)}&limit=8`),
    enabled: dq.length >= 2 && !picked && !isNew,
  });

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!picked && !isNew) return setError(t('staff.na.pickFirst'));
    try {
      const a = await api<Appointment>('/staff/appointments', {
        method: 'POST',
        body: {
          selection: { serviceId: service!.id, audience, adult: true, variant: service?.variants ? variant || service.defaultVariant : undefined, finish: service?.finishOption ? finish : undefined },
          date,
          start: parseHm(time),
          stylistId,
          ...(picked
            ? { customerId: picked.id }
            : { customer: { firstName: c.firstName, lastName: c.lastName, phone: c.phone || undefined, email: c.email || undefined } }),
          internalNote: internalNote || undefined,
          notifyCustomer: notify,
        },
      });
      p.onCreated(a);
      p.onClose();
    } catch (err) {
      setError(errorMessage(err));
    }
  }
  return (
    <Dialog title={t('staff.newAppointment')} onClose={p.onClose}>
      <form onSubmit={submit}>
        <h2>{t('staff.newAppointment')}</h2>

        <fieldset className="field" style={{ border: 0, padding: 0, margin: '0 0 12px' }}>
          <legend style={{ fontWeight: 650, marginBottom: 4 }}>{t('staff.customer')}</legend>
          {picked ? (
            <div className="row">
              <span className="badge ac" style={{ fontSize: '0.95rem', padding: '6px 12px' }}>
                {picked.firstName} {picked.lastName}
              </span>
              <span className="small muted">{[picked.phone && formatPhone(picked.phone), picked.email].filter(Boolean).join(' · ')}</span>
              <button type="button" className="btn ghost" onClick={() => (setPicked(null), setQ(''), setTimeout(() => searchRef.current?.focus()))}>{t('staff.na.change')}</button>
            </div>
          ) : isNew ? (
            <>
              <div className="row">
                {(['firstName', 'lastName', 'phone', 'email'] as const).map((k) => (
                  <div key={k} className="field" style={{ flex: '1 1 160px' }}>
                    <label htmlFor={`na-${k}`}>{t(`ui.${k}`)}</label>
                    <input ref={k === 'firstName' ? firstRef : undefined} id={`na-${k}`} type={k === 'email' ? 'email' : k === 'phone' ? 'tel' : 'text'} value={c[k]} onChange={(e) => setC({ ...c, [k]: e.target.value })} required={k === 'firstName' || k === 'lastName'} />
                  </div>
                ))}
              </div>
              <button type="button" className="btn ghost" onClick={() => (setIsNew(false), setTimeout(() => searchRef.current?.focus()))}>{t('staff.na.backToSearch')}</button>
            </>
          ) : (
            <>
              <div className="row" style={{ flexWrap: 'nowrap' }}>
                <label htmlFor="na-q" className="sr-only">{t('staff.na.search')}</label>
                <input ref={searchRef} id="na-q" type="search" role="combobox" aria-expanded={!!found.data?.customers.length} aria-controls="na-results" aria-autocomplete="list" autoComplete="off" placeholder={t('staff.na.search')} value={q} onChange={(e) => setQ(e.target.value)} style={{ flex: 1 }} />
                <button
                  type="button"
                  className="btn primary"
                  aria-label={t('staff.na.newClient')}
                  title={t('staff.na.newClient')}
                  onClick={() => {
                    // carry over a typed name: "Anna Muster" → first/last name
                    const [first = '', ...rest] = q.trim().split(/\s+/);
                    setC({ ...c, firstName: rest.length ? first : c.firstName, lastName: rest.length ? rest.join(' ') : first || c.lastName });
                    setIsNew(true);
                  }}
                >
                  +
                </button>
              </div>
              <ul id="na-results" className="na-results" aria-label={t('staff.na.results')}>
                {dq.length >= 2 && found.data?.customers.map((x) => (
                  <li key={x.id}>
                    <button type="button" className="btn block-l" onClick={() => setPicked(x)}>
                      <strong>{x.firstName} {x.lastName}</strong>
                      <span className="small muted">&nbsp;{[x.phone && formatPhone(x.phone), x.email].filter(Boolean).join(' · ')}</span>
                    </button>
                  </li>
                ))}
              </ul>
              {dq.length >= 2 && found.isSuccess && !found.data.customers.length && <p className="small muted">{t('staff.na.none')}</p>}
              {dq.length < 2 && <p className="small muted">{t('staff.na.hint')}</p>}
            </>
          )}
        </fieldset>

        <div className="chips" role="group" aria-label={t('ui.step.who')} style={{ marginBottom: 8 }}>
          {(['women', 'men'] as const).map((x) => (
            <button key={x} type="button" className="chip" aria-pressed={audience === x} onClick={() => setAudience(x)}>{t(`audience.${x}`)}</button>
          ))}
        </div>
        <div className="field">
          <label htmlFor="na-svc">{t('ui.step.service')}</label>
          <select id="na-svc" value={service?.id} onChange={(e) => setServiceId(e.target.value)}>
            {services.map((s) => <option key={s.id} value={s.id}>{L.service(s.id)}</option>)}
          </select>
        </div>
        {service?.adultOnly && <p className="notice warn small">{t('ui.under16')}</p>}
        {service?.variants && (
          <div className="field">
            <label htmlFor="na-var">{t('ui.step.option')}</label>
            <select id="na-var" value={variant || service.defaultVariant} onChange={(e) => setVariant(e.target.value)}>
              {service.variants.map((v) => <option key={v} value={v}>{L.variant(v)}</option>)}
            </select>
          </div>
        )}
        {service?.finishOption && (
          <label className="check"><input type="checkbox" checked={finish} onChange={(e) => setFinish(e.target.checked)} /> <span>{t('finish')}</span></label>
        )}
        <div className="row">
          <div className="field" style={{ flex: '1 1 140px' }}>
            <label htmlFor="na-st">{t('staff.stylist')}</label>
            <select id="na-st" value={stylistId} onChange={(e) => setStylistId(e.target.value)}>
              {stylists.map((s) => <option key={s.id} value={s.id}>{s.displayName}</option>)}
            </select>
          </div>
          <div className="field" style={{ flex: '1 1 140px' }}>
            <label htmlFor="na-date">Datum</label>
            <input id="na-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
          </div>
          <div className="field" style={{ flex: '1 1 100px' }}>
            <label htmlFor="na-time">Start</label>
            <input id="na-time" type="time" step={300} value={time} onChange={(e) => setTime(e.target.value || formatHm(540))} required />
          </div>
        </div>
        <div className="field">
          <label htmlFor="na-note">{t('staff.note')}</label>
          <textarea id="na-note" value={internalNote} onChange={(e) => setInternalNote(e.target.value)} />
        </div>
        <label className="check"><input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} /> <span>{t('staff.notifyCustomer')}</span></label>
        {error && <p className="notice error" role="alert">{error}</p>}
        <div className="row">
          <button className="btn primary" disabled={!picked && !isNew}>{t('staff.create')}</button>
          <button type="button" className="btn" onClick={p.onClose}>{t('ui.close')}</button>
        </div>
      </form>
    </Dialog>
  );
}
