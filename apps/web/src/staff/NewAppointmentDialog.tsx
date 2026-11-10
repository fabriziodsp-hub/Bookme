import { findService, formatHm, offeredServices, parseHm, type LocalDate } from '@salon/engine';
import { useState, type FormEvent } from 'react';
import { Dialog } from '../components/Dialog';
import { api, errorMessage } from '../lib/api';
import { useT } from '../lib/i18n';
import { useLabels } from '../lib/labels';
import { useSalon } from '../lib/salon';
import { useStylists } from './hooks';
import type { Appointment } from '../lib/types';

/** Phone / walk-in appointment: confirmed directly, 5′ grid (S-6). */
export function NewAppointmentDialog(p: { date: LocalDate; stylistId: string; onClose: () => void; onCreated: (a: Appointment) => void }) {
  const t = useT();
  const L = useLabels();
  const salon = useSalon();
  const stylists = useStylists();
  const cfg = salon.config;
  const [audience, setAudience] = useState<'women' | 'men'>('women');
  const [adult, setAdult] = useState(true);
  const [serviceId, setServiceId] = useState('cut');
  const [variant, setVariant] = useState<string>('');
  const [finish, setFinish] = useState(false);
  const [stylistId, setStylistId] = useState(p.stylistId);
  const [date, setDate] = useState(p.date);
  const [time, setTime] = useState('09:00');
  const [c, setC] = useState({ firstName: '', lastName: '', phone: '', email: '' });
  const [internalNote, setInternalNote] = useState('');
  const [notify, setNotify] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const services = offeredServices(cfg, audience, adult);
  const service = findService(cfg, serviceId) ?? services[0];

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const a = await api<Appointment>('/staff/appointments', {
        method: 'POST',
        body: {
          selection: { serviceId: service!.id, audience, adult, variant: service?.variants ? variant || service.defaultVariant : undefined, finish: service?.finishOption ? finish : undefined },
          date,
          start: parseHm(time),
          stylistId,
          customer: { firstName: c.firstName, lastName: c.lastName, phone: c.phone || undefined, email: c.email || undefined },
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
        <div className="chips" style={{ marginBottom: 8 }}>
          {(['women', 'men'] as const).map((x) => (
            <button key={x} type="button" className="chip" aria-pressed={audience === x} onClick={() => setAudience(x)}>{t(`audience.${x}`)}</button>
          ))}
          <button type="button" className="chip" aria-pressed={adult} onClick={() => setAdult(true)}>{t('ui.adult')}</button>
          <button type="button" className="chip" aria-pressed={!adult} onClick={() => setAdult(false)}>{t('ui.minor')}</button>
        </div>
        <div className="field">
          <label htmlFor="na-svc">{t('ui.step.service')}</label>
          <select id="na-svc" value={service?.id} onChange={(e) => setServiceId(e.target.value)}>
            {services.map((s) => <option key={s.id} value={s.id}>{L.service(s.id)}</option>)}
          </select>
        </div>
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
        <div className="row">
          {(['firstName', 'lastName', 'phone', 'email'] as const).map((k) => (
            <div key={k} className="field" style={{ flex: '1 1 160px' }}>
              <label htmlFor={`na-${k}`}>{t(`ui.${k}`)}</label>
              <input id={`na-${k}`} type={k === 'email' ? 'email' : k === 'phone' ? 'tel' : 'text'} value={c[k]} onChange={(e) => setC({ ...c, [k]: e.target.value })} required={k === 'firstName' || k === 'lastName'} />
            </div>
          ))}
        </div>
        <div className="field">
          <label htmlFor="na-note">{t('staff.note')}</label>
          <textarea id="na-note" value={internalNote} onChange={(e) => setInternalNote(e.target.value)} />
        </div>
        <label className="check"><input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} /> <span>{t('staff.notifyCustomer')}</span></label>
        {error && <p className="notice error" role="alert">{error}</p>}
        <div className="row">
          <button className="btn primary">{t('staff.create')}</button>
          <button type="button" className="btn" onClick={p.onClose}>{t('ui.close')}</button>
        </div>
      </form>
    </Dialog>
  );
}
