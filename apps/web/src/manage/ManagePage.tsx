import { addDays, formatHm, rescheduleNeedsReconfirmation, startOfWeek, type LocalDate, type Minute } from '@salon/engine';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useParams } from 'react-router';
import { MonthSheet } from '../booking/MonthSheet';
import { WeekCalendar } from '../booking/WeekCalendar';
import { AddToCalendar } from '../components/AddToCalendar';
import { Dialog } from '../components/Dialog';
import { DurationBar } from '../components/DurationBar';
import { api, errorMessage } from '../lib/api';
import { dateLong, hm, priceText } from '../lib/format';
import { useT } from '../lib/i18n';
import { useSalon } from '../lib/salon';
import type { DayAvailability, PublicAppointment } from '../lib/types';

export function ManagePage() {
  const { token = '' } = useParams();
  const t = useT();
  const salon = useSalon();
  const qc = useQueryClient();
  const base = `/s/${salon.slug}/appointments/${token}`;
  const q = useQuery({ queryKey: ['appt', token], queryFn: () => api<PublicAppointment>(base) });
  const [moving, setMoving] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [weekStart, setWeekStart] = useState<LocalDate>(startOfWeek(salon.now.date));
  const [slot, setSlot] = useState<{ date: LocalDate; start: Minute } | null>(null);
  const [view, setView] = useState<'calendar' | 'list'>('calendar');
  const [month, setMonth] = useState(false);

  const avail = useQuery({
    queryKey: ['re-avail', token, weekStart],
    queryFn: () => api<{ days: DayAvailability[] }>(`${base}/availability?from=${weekStart}&days=7`),
    enabled: moving,
  });
  const cancel = useMutation({
    mutationFn: () => api<PublicAppointment>(`${base}/cancel`, { method: 'POST' }),
    onSuccess: (d) => (qc.setQueryData(['appt', token], d), setConfirmCancel(false)),
  });
  const move = useMutation({
    mutationFn: () => api<PublicAppointment>(`${base}/reschedule`, { method: 'POST', body: { date: slot!.date, start: formatHm(slot!.start) } }),
    onSuccess: (d) => (qc.setQueryData(['appt', token], d), setMoving(false), setSlot(null)),
  });

  if (q.isLoading) return <div className="spin" role="status" aria-label={t('ui.loading')} />;
  if (q.error || !q.data) {
    return (
      <main id="main" className="wrap">
        <div className="card"><h1>{errorMessage(q.error)}</h1></div>
      </main>
    );
  }
  const a = q.data;
  const rel = a.blocks.map((b) => ({ ...b, start: b.start - a.start, end: b.end - a.start }));
  const statusClass = a.status === 'confirmed' ? 'ac' : a.status === 'requested' || a.status === 'discuss' ? 'warn' : 'danger';
  return (
    <main id="main" className="wrap">
      <section className="card" aria-labelledby="m-h">
        <h1 id="m-h">{t('ui.manage.title')}</h1>
        <p><span className={`badge ${statusClass}`} role="status">{t(`ui.status.${a.status}`)}</span></p>
        <dl className="kv">
          <dt>Termin</dt>
          <dd><strong>{dateLong(a.date)}, {hm(a.start)} Uhr</strong> · {t('ui.endApprox', { time: hm(a.end) })}</dd>
          <dt>{t('ui.step.service')}</dt>
          <dd>{a.serviceLabel}</dd>
          {a.price && (<><dt>{t('ui.price')}</dt><dd>{priceText(a.price)}{a.price.birthdayDiscount && ` – ${t('ui.birthdayPrice')}`}</dd></>)}
          <dt>{t('ui.refCode')}</dt>
          <dd>{a.refCode}</dd>
          <dt>Name</dt>
          <dd>{a.firstName} {a.lastName}</dd>
        </dl>
        {a.clientNote && (
          <div className="notice">
            <strong>{t('ui.manage.salonNote')}:</strong> {a.clientNote}
          </div>
        )}
        <DurationBar blocks={a.blocks} serviceId={a.serviceId} />
        {a.fee && <p className="notice warn small">{salon.feeConsentText[a.serviceId]}</p>}
        {a.restricted && <p className="notice warn small">{t('ui.under16')}</p>}
      </section>

      {a.status === 'confirmed' && (
        <section className="card"><AddToCalendar a={a} token={token} /></section>
      )}

      {['requested', 'discuss', 'confirmed'].includes(a.status) && (
        <section className="card">
          {a.canChange ? (
            <>
              <p className="muted small">{t('ui.manage.cutoff', { time: new Date(a.cutoffAt).toLocaleString('de-DE', { timeZone: salon.config.timeZone, dateStyle: 'full', timeStyle: 'short' }) })}</p>
              <div className="row">
                <button type="button" className="btn" aria-expanded={moving} onClick={() => setMoving(!moving)}>{t('ui.manage.reschedule')}</button>
                <button type="button" className="btn danger" onClick={() => setConfirmCancel(true)}>{t('ui.manage.cancel')}</button>
              </div>
            </>
          ) : (
            <p className="notice">{t('ui.manage.tooLate', { phone: a.salonPhone })} <a href={`tel:${salon.profile.phone}`}>{a.salonPhone}</a></p>
          )}
        </section>
      )}

      {moving && (
        <section className="card" aria-labelledby="mv-h">
          <h2 id="mv-h">{t('ui.manage.newTime')}</h2>
          <p className="muted small">{t(a.status === 'confirmed' && !rescheduleNeedsReconfirmation(salon.config, a.end - a.start) ? 'ui.manage.movedNoteShort' : 'ui.manage.movedNote')}</p>
          <WeekCalendar
            cfg={salon.config}
            weekStart={weekStart}
            today={salon.now.date}
            days={avail.data?.days}
            loading={avail.isFetching}
            blocks={rel}
            selected={slot}
            onSelect={(date, start) => setSlot({ date, start })}
            onPrev={() => setWeekStart(addDays(weekStart, -7))}
            onNext={() => setWeekStart(addDays(weekStart, 7))}
            canPrev={weekStart > startOfWeek(salon.now.date)}
            canNext={weekStart < startOfWeek(addDays(salon.now.date, salon.config.horizonDays))}
            onOpenMonth={() => setMonth(true)}
            view={view}
            onView={setView}
          />
          {month && (
            <MonthSheet
              today={salon.now.date}
              minOffset={0}
              maxOffset={12}
              initial={weekStart}
              selected={slot?.date ?? null}
              dotsPath={null}
              isSelectable={(d) => d >= salon.now.date}
              onPick={(d) => (setWeekStart(startOfWeek(d)), setMonth(false))}
              onToday={() => (setWeekStart(startOfWeek(salon.now.date)), setMonth(false))}
              onClose={() => setMonth(false)}
            />
          )}
          {slot && (
            <button type="button" className="btn primary block" style={{ marginTop: 12 }} disabled={move.isPending} onClick={() => move.mutate()}>
              {t('ui.manage.confirmMove', { when: `${dateLong(slot.date)}, ${hm(slot.start)} Uhr` })}
            </button>
          )}
          {move.error && <p className="notice error" role="alert">{errorMessage(move.error)}</p>}
        </section>
      )}

      {confirmCancel && (
        <Dialog title={t('ui.manage.confirmCancel')} onClose={() => setConfirmCancel(false)}>
          <h2>{t('ui.manage.confirmCancel')}</h2>
          <p>{dateLong(a.date)}, {hm(a.start)} Uhr – {a.serviceLabel}</p>
          {cancel.error && <p className="notice error" role="alert">{errorMessage(cancel.error)}</p>}
          <div className="row">
            <button type="button" className="btn danger" disabled={cancel.isPending} onClick={() => cancel.mutate()}>{t('ui.manage.yesCancel')}</button>
            <button type="button" className="btn" onClick={() => setConfirmCancel(false)}>{t('ui.manage.keep')}</button>
          </div>
        </Dialog>
      )}
    </main>
  );
}
