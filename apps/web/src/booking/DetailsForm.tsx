import type { Block, LocalDate, Minute, Selection, Service } from '@salon/engine';
import { de } from '@salon/i18n';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { DurationBar } from '../components/DurationBar';
import { api, ApiError, errorMessage } from '../lib/api';
import { dateLong, euro, hm, priceText } from '../lib/format';
import { useT } from '../lib/i18n';
import { useLabels } from '../lib/labels';
import { solve, type Challenge } from '../lib/pow';
import { useSalon } from '../lib/salon';

export interface Details {
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  colorNotes: string;
  birthday: boolean;
  birthMonth: number;
  feeConsent: boolean;
  privacyAck: boolean;
  website: string; // honeypot
}

type Pow = { challenge: string; salt: string; number: number; signature: string };

export function DetailsForm(p: {
  sel: Selection;
  service: Service;
  slot: { date: LocalDate; start: Minute };
  blocks: Block[];
  price: { cents: number; isFrom: boolean } | null;
  onSubmit: (d: Details, idempotencyKey: string, pow: Pow) => Promise<null>;
}) {
  const t = useT();
  const L = useLabels();
  const salon = useSalon();
  const id = useId();
  const [d, setD] = useState<Details>({ firstName: '', lastName: '', phone: '', email: '', colorNotes: '', birthday: false, birthMonth: 1, feeConsent: false, privacyAck: false, website: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const keyRef = useRef<string>(crypto.randomUUID());
  const powRef = useRef<Promise<Pow> | null>(null);
  const firstErrorRef = useRef<HTMLDivElement>(null);

  // A new slot is a new request → new idempotency key. Solve the anti-bot puzzle in the background meanwhile.
  useEffect(() => {
    keyRef.current = crypto.randomUUID();
    powRef.current = api<Challenge>(`/s/${salon.slug}/challenge`).then(solve);
    powRef.current.catch(() => undefined);
  }, [p.slot.date, p.slot.start, salon.slug]);

  const set = <K extends keyof Details>(k: K, v: Details[K]) => setD((x) => ({ ...x, [k]: v }));
  const end = p.slot.start + (p.blocks.at(-1)!.end - p.blocks[0]!.start);
  const birthdayOn = salon.config.birthdayDiscount.enabled;
  const fee = p.service.feeRule;

  function validate(): Record<string, string> {
    const e: Record<string, string> = {};
    if (!d.firstName.trim()) e.firstName = 'Bitte Vornamen angeben.';
    if (!d.lastName.trim()) e.lastName = 'Bitte Nachnamen angeben.';
    if (!d.phone.trim() && !d.email.trim()) e.contact = 'Bitte Telefon oder E-Mail angeben.';
    if (d.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email.trim())) e.email = 'Bitte eine gültige E-Mail-Adresse angeben.';
    if (d.phone.trim() && !/^[+()\d\s/-]{6,}$/.test(d.phone.trim())) e.phone = 'Bitte eine gültige Telefonnummer angeben.';
    if (fee && !d.feeConsent) e.feeConsent = 'Bitte bestätigen Sie die Ausfallgebühr.';
    if (!d.privacyAck) e.privacyAck = 'Bitte bestätigen Sie, dass Sie die Datenschutzhinweise gelesen haben.';
    return e;
  }

  async function onSubmit(ev: FormEvent) {
    ev.preventDefault();
    setFormError(null);
    const e = validate();
    setErrors(e);
    if (Object.keys(e).length) {
      requestAnimationFrame(() => firstErrorRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus());
      return;
    }
    setBusy(true);
    try {
      let pow: Pow;
      try {
        pow = await powRef.current!;
      } catch {
        pow = await api<Challenge>(`/s/${salon.slug}/challenge`).then(solve);
      }
      await p.onSubmit(d, keyRef.current, pow);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'VALIDATION') {
        const fe = (err.details as { fieldErrors?: Record<string, string> } | undefined)?.fieldErrors;
        if (fe) setErrors(fe);
        if (err.details && (err.details as { pow?: string }).pow) powRef.current = api<Challenge>(`/s/${salon.slug}/challenge`).then(solve);
      }
      setFormError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const field = (k: 'firstName' | 'lastName' | 'phone' | 'email', type: string, autoComplete: string, opt = false) => (
    <div className="field">
      <label htmlFor={`${id}-${k}`}>
        {t(`ui.${k}`)}
        {opt && <span className="muted"> ({t('ui.optional')})</span>}
      </label>
      <input
        id={`${id}-${k}`}
        type={type}
        autoComplete={autoComplete}
        inputMode={k === 'phone' ? 'tel' : k === 'email' ? 'email' : undefined}
        value={d[k]}
        onChange={(e) => set(k, e.target.value)}
        aria-invalid={!!errors[k] || ((k === 'phone' || k === 'email') && !!errors.contact)}
        aria-describedby={errors[k] ? `${id}-${k}-err` : k === 'phone' || k === 'email' ? `${id}-contact` : undefined}
      />
      {errors[k] && <div className="err" id={`${id}-${k}-err`}>{errors[k]}</div>}
    </div>
  );

  return (
    <form className="card accent" onSubmit={onSubmit} noValidate aria-labelledby={`${id}-h`} ref={firstErrorRef as never}>
      <h2 id={`${id}-h`}><span className="stepno">5</span>{t('ui.step.details')}</h2>
      <div className="notice" aria-live="polite">
        <strong>{dateLong(p.slot.date)}, {hm(p.slot.start)} Uhr</strong> · {t('ui.endApprox', { time: hm(end) })}
        <br />
        {L.service(p.sel.serviceId)}
        {p.sel.variant ? ` (${L.variant(p.sel.variant)})` : ''}
        {p.sel.finish ? ` + ${t('finish')}` : ''}
        {p.price && <> · {priceText(p.price)}</>}
      </div>
      <DurationBar blocks={p.blocks.map((b) => ({ ...b, start: b.start + p.slot.start, end: b.end + p.slot.start }))} serviceId={p.sel.serviceId} />

      <div className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
        <div style={{ flex: '1 1 200px' }}>{field('firstName', 'text', 'given-name')}</div>
        <div style={{ flex: '1 1 200px' }}>{field('lastName', 'text', 'family-name')}</div>
      </div>
      <div className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
        <div style={{ flex: '1 1 200px' }}>{field('email', 'email', 'email', true)}</div>
        <div style={{ flex: '1 1 200px' }}>{field('phone', 'tel', 'tel', true)}</div>
      </div>
      <p id={`${id}-contact`} className={errors.contact ? 'err' : 'muted small'}>{errors.contact ?? t('ui.contactHint')}</p>

      {p.service.collectsColorNotes && (
        <div className="field">
          <label htmlFor={`${id}-notes`}>{t('ui.colorNotes')}</label>
          <textarea id={`${id}-notes`} maxLength={500} placeholder={t('ui.colorNotesHint')} value={d.colorNotes} onChange={(e) => set('colorNotes', e.target.value)} />
        </div>
      )}
      {p.service.adultOnly && <p className="notice warn small">{t('ui.under16')}</p>}

      {fee && (
        <div className="notice warn">
          <strong>{t('ui.feeTitle')}: {euro(salon.feeAmountCents[p.service.id] ?? 0)}</strong>
          <label className="check">
            <input type="checkbox" checked={d.feeConsent} onChange={(e) => set('feeConsent', e.target.checked)} aria-invalid={!!errors.feeConsent} aria-describedby={errors.feeConsent ? `${id}-fee-err` : undefined} required />
            <span>{salon.feeConsentText[p.service.id]}</span>
          </label>
          {errors.feeConsent && <div className="err" id={`${id}-fee-err`}>{errors.feeConsent}</div>}
        </div>
      )}

      {birthdayOn && (
        <div className="field">
          <label className="check">
            <input type="checkbox" checked={d.birthday} onChange={(e) => set('birthday', e.target.checked)} />
            <span>{t('ui.birthday', { p: salon.config.birthdayDiscount.percent })}</span>
          </label>
          {d.birthday && (
            <div className="field" style={{ maxWidth: 260 }}>
              <label htmlFor={`${id}-bm`}>{t('ui.birthMonth')}</label>
              <select id={`${id}-bm`} value={d.birthMonth} onChange={(e) => set('birthMonth', Number(e.target.value))}>
                {de.monthLong.map((m, i) => (
                  <option key={m} value={i + 1}>{m}</option>
                ))}
              </select>
            </div>
          )}
        </div>
      )}

      {/* Honeypot: invisible to people and assistive tech, bots tend to fill it. */}
      <div aria-hidden="true" style={{ position: 'absolute', left: '-10000px', width: 1, height: 1, overflow: 'hidden' }}>
        <label htmlFor={`${id}-web`}>Website</label>
        <input id={`${id}-web`} tabIndex={-1} autoComplete="off" value={d.website} onChange={(e) => set('website', e.target.value)} />
      </div>

      <div className="field">
        <p className="small" id={`${id}-pv-note`} style={{ margin: '0 0 6px' }}>{t('ui.privacyNote')}</p>
        <label className="check">
          <input type="checkbox" checked={d.privacyAck} onChange={(e) => set('privacyAck', e.target.checked)} aria-invalid={!!errors.privacyAck} aria-describedby={`${id}-pv-note${errors.privacyAck ? ` ${id}-pv-err` : ''}`} required />
          <span>
            {t('ui.privacyAck1')} <a href={`/${salon.slug}/datenschutz`} target="_blank" rel="noopener">{t('ui.privacyAckLink')}</a> {t('ui.privacyAck2')}
          </span>
        </label>
        {errors.privacyAck && <div className="err" id={`${id}-pv-err`}>{errors.privacyAck}</div>}
      </div>

      {formError && <p className="notice error" role="alert">{formError}</p>}
      <button type="submit" className="btn primary block" disabled={busy} aria-busy={busy}>
        {busy ? t('ui.submitting') : t('ui.submit')}
      </button>
    </form>
  );
}
