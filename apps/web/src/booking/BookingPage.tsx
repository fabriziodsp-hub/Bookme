import { addDays, daysBetween, findService, formatHm, offeredServices, startOfWeek, type LocalDate, type Minute, type Selection } from '@salon/engine';
import { de } from '@salon/i18n';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { DurationBar } from '../components/DurationBar';
import { api, ApiError } from '../lib/api';
import { blocksFor, priceFor, priceFromFor, selectionQuery } from '../lib/booking';
import { priceText } from '../lib/format';
import { useT } from '../lib/i18n';
import { useLabels } from '../lib/labels';
import { useSalon } from '../lib/salon';
import type { DayAvailability, PublicAppointment } from '../lib/types';
import { DetailsForm, type Details } from './DetailsForm';
import { MonthSheet } from './MonthSheet';
import { Result } from './Result';
import { WeekCalendar } from './WeekCalendar';

type Audience = 'women' | 'men';

export function BookingPage() {
  const t = useT();
  const L = useLabels();
  const salon = useSalon();
  const cfg = salon.config;
  const today = salon.now.date;
  const qc = useQueryClient();

  // Deep link from the homepage (D-065): /buchen?service=…&audience=… preselects the service.
  const params = new URLSearchParams(location.search);
  const linked = findService(cfg, params.get('service') ?? '');
  const linkedAudience = params.get('audience');
  const [audience, setAudience] = useState<Audience>(
    linkedAudience === 'men' || linkedAudience === 'women' ? linkedAudience : linked && !linked.audiences.includes('women') ? 'men' : 'women',
  );
  const [serviceId, setServiceId] = useState<string | null>(linked && !linked.hidden && linked.audiences.includes(audience) ? linked.id : null);
  // Optional wish for a person (D-063): only people shown on the homepage, "" = anyone.
  const [stylistId, setStylistId] = useState('');
  const [variant, setVariant] = useState<string | undefined>();
  const [finish, setFinish] = useState(false);
  const [weekStart, setWeekStart] = useState(startOfWeek(today));
  const [slot, setSlot] = useState<{ date: LocalDate; start: Minute } | null>(null);
  const [view, setView] = useState<'calendar' | 'list'>('calendar');
  const [monthOpen, setMonthOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [result, setResult] = useState<{ appointment: PublicAppointment; manageToken: string } | null>(null);
  const detailsRef = useRef<HTMLDivElement>(null);
  const calRef = useRef<HTMLDivElement>(null);

  const service = serviceId ? findService(cfg, serviceId) : undefined;
  // No age question any more (D-062): every service is offered; chemical ones show the under-16 notice.
  const sel: Selection | null = service
    ? { serviceId: service.id, audience, adult: true, variant: service.variants ? (variant ?? service.defaultVariant) : undefined, finish: service.finishOption ? finish : undefined }
    : null;
  const blocks = sel ? blocksFor(cfg, sel) : null;
  const services = offeredServices(cfg, audience, true);
  const team = salon.team ?? [];
  const who = stylistId ? `&stylistId=${stylistId}` : '';
  const maxWeek = startOfWeek(addDays(today, cfg.horizonDays));

  // Reset dependent steps when an earlier one changes (prototype behaviour, spec C-1 AC2).
  const resetFrom = (level: 'service' | 'option') => {
    if (level === 'service') {
      setServiceId(null);
      setVariant(undefined);
      setFinish(false);
    }
    setSlot(null);
  };

  const avail = useQuery({
    queryKey: ['avail', salon.slug, sel && selectionQuery(sel), weekStart, stylistId],
    queryFn: () => api<{ days: DayAvailability[] }>(`/s/${salon.slug}/availability?${selectionQuery(sel!)}&from=${weekStart}&days=7${who}`),
    enabled: !!sel,
    placeholderData: (prev) => prev,
  });
  // Without a service the calendar still shows opening hours, breaks and closed days.
  const days: DayAvailability[] | undefined = sel
    ? avail.data?.days
    : Array.from({ length: 7 }, (_, i) => {
        const date = addDays(weekStart, i);
        const h = cfg.weeklyHours[(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const)[i]!];
        const toM = (x: string) => Number(x.slice(0, 2)) * 60 + Number(x.slice(3));
        return { date, open: !!h, hours: h ? { open: toM(h.open), close: toM(h.close), breaks: h.breaks.map(([a, b]) => ({ start: toM(a), end: toM(b) })) } : null, slots: [], busy: [] };
      });

  useEffect(() => {
    if (slot) detailsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [slot]);

  const goToDate = (d: LocalDate) => {
    setWeekStart(startOfWeek(d));
    setMonthOpen(false);
    calRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const nextFree = async () => {
    if (!sel) return;
    const r = await api<{ next: { date: LocalDate; start: Minute } | null }>(`/s/${salon.slug}/availability/next?${selectionQuery(sel)}&from=${today}${who}`);
    if (r.next) goToDate(r.next.date);
    else setNotice(t('ui.noneFound'));
    setMonthOpen(false);
  };

  const submit = async (d: Details, idempotencyKey: string, pow: { challenge: string; salt: string; number: number; signature: string }) => {
    try {
      const r = await api<{ appointment: PublicAppointment; manageToken: string }>(`/s/${salon.slug}/bookings`, {
        method: 'POST',
        headers: { 'idempotency-key': idempotencyKey },
        body: {
          selection: sel,
          stylistId: stylistId || undefined,
          date: slot!.date,
          start: formatHm(slot!.start),
          customer: { firstName: d.firstName, lastName: d.lastName, phone: d.phone || undefined, email: d.email || undefined, birthMonth: d.birthday ? d.birthMonth : undefined },
          colorNotes: d.colorNotes || undefined,
          feeConsent: service?.feeRule ? d.feeConsent : undefined,
          privacyAck: d.privacyAck,
          website: d.website || undefined,
          pow,
        },
      });
      setResult(r);
      void qc.invalidateQueries({ queryKey: ['avail'] });
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return null;
    } catch (e) {
      if (e instanceof ApiError && e.code === 'SLOT_TAKEN') {
        setSlot(null);
        setNotice(e.message);
        void qc.invalidateQueries({ queryKey: ['avail'] });
        calRef.current?.scrollIntoView({ behavior: 'smooth' });
        return null;
      }
      throw e;
    }
  };

  const price = sel ? priceFor(salon.prices, sel) : null;

  if (result) {
    return (
      <main id="main" className="wrap">
        <Result r={result} onAnother={() => (setResult(null), setSlot(null))} />
      </main>
    );
  }

  return (
    <main id="main" className="wrap">
      <h1 className="sr-only">{t('ui.appTitle')}</h1>
      {notice && (
        <div className="notice error" role="alert">
          {notice} <button type="button" className="btn ghost" onClick={() => setNotice(null)}>{t('ui.close')}</button>
        </div>
      )}

      <section className="card" aria-labelledby="st1">
        <h2 id="st1"><span className="stepno">1</span>{t('ui.step.who')}</h2>
        <div className="chips" role="radiogroup" aria-label={t('ui.step.who')}>
          {(['women', 'men'] as const).map((a) => (
            <button key={a} type="button" role="radio" className="chip" aria-checked={audience === a} onClick={() => (setAudience(a), resetFrom('service'))}>
              {t(`audience.${a}`)}
            </button>
          ))}
        </div>
      </section>

      {(
        <section className="card" aria-labelledby="st2">
          <h2 id="st2"><span className="stepno">2</span>{t('ui.step.service')}</h2>
          <div role="radiogroup" aria-labelledby="st2">
            {services.map((s) => {
              const p = priceFromFor(salon.prices, s.id);
              return (
                <button key={s.id} type="button" role="radio" className="svc" aria-checked={serviceId === s.id} onClick={() => (setServiceId(s.id), setVariant(undefined), setFinish(false), setSlot(null))}>
                  <span>{L.service(s.id)}</span>
                  <small>
                    {(de.serviceInfo as Record<string, string>)[s.id] && <>{(de.serviceInfo as Record<string, string>)[s.id]}<br /></>}
                    {L.hint(s, audience)}
                    {p && <><br />{priceText(p)}</>}
                    {s.adultOnly && <><br />{t('ui.under16Short')}</>}
                  </small>
                </button>
              );
            })}
          </div>
        </section>
      )}

      {service && (service.variants || service.finishOption) && (
        <section className="card" aria-labelledby="st3">
          <h2 id="st3"><span className="stepno">3</span>{service.variants ? t('ui.step.option') : t('ui.step.finish')}</h2>
          {service.variants && (
            <div className="chips" role="radiogroup" aria-labelledby="st3">
              {service.variants.map((v) => {
                const b = blocksFor(cfg, { serviceId: service.id, audience, adult: true, variant: v })!;
                return (
                  <button key={v} type="button" role="radio" className="chip" aria-checked={(variant ?? service.defaultVariant) === v} onClick={() => (setVariant(v), setSlot(null))}>
                    {L.variant(v)} · {b.at(-1)!.end}′
                  </button>
                );
              })}
            </div>
          )}
          {service.finishOption && (
            <>
              <div className="chips" role="radiogroup" aria-labelledby="st3">
                <button type="button" role="radio" className="chip" aria-checked={!finish} onClick={() => (setFinish(false), setSlot(null))}>{t('ui.noFinish')}</button>
                <button type="button" role="radio" className="chip" aria-checked={finish} onClick={() => (setFinish(true), setSlot(null))}>{t('finish')}</button>
              </div>
              <p className="muted small" style={{ marginTop: 8 }}>{L.finishHint(service)}</p>
            </>
          )}
        </section>
      )}

      {blocks && (
        <section className="card" aria-labelledby="dur">
          <h2 id="dur">
            {t('ui.step.duration', { n: blocks.at(-1)!.end })}
            {price && <span className="badge" style={{ marginLeft: 'auto' }}>{priceText(price)}</span>}
          </h2>
          <DurationBar blocks={blocks} serviceId={serviceId ?? undefined} />
          {blocks.some((b) => b.kind === 'free') && <p className="muted small">{t('ui.freeHint')}</p>}
          {service?.fixedStarts && <p className="muted small">{t('ui.fixedStartsHint')}</p>}
          {service?.adultOnly && <p className="notice warn small" role="note">{t('ui.under16')}</p>}
        </section>
      )}

      <section className="card" aria-labelledby="st4" ref={calRef}>
        <h2 id="st4"><span className="stepno">4</span>{t('ui.step.when')}</h2>
        {!sel && <p className="muted small">{t('ui.chooseService')}</p>}
        {team.length > 0 && (
          <div className="field">
            <p className="small muted" id="st4-who" style={{ margin: '0 0 4px' }}>{t('ui.stylistWish')}</p>
            <div className="chips" role="radiogroup" aria-labelledby="st4-who">
              <button type="button" role="radio" className="chip" aria-checked={stylistId === ''} onClick={() => (setStylistId(''), setSlot(null))}>{t('ui.anyStylist')}</button>
              {team.map((m) => (
                <button key={m.id} type="button" role="radio" className="chip" aria-checked={stylistId === m.id} onClick={() => (setStylistId(m.id), setSlot(null))}>{m.publicName}</button>
              ))}
            </div>
          </div>
        )}
        <WeekCalendar
          cfg={cfg}
          weekStart={weekStart}
          today={today}
          days={days}
          loading={avail.isFetching}
          blocks={blocks}
          selected={slot}
          onSelect={(date, start) => (setSlot({ date, start }), setNotice(null))}
          onPrev={() => setWeekStart(addDays(weekStart, -7))}
          onNext={() => setWeekStart(addDays(weekStart, 7))}
          canPrev={weekStart > startOfWeek(today)}
          canNext={weekStart < maxWeek}
          onOpenMonth={() => setMonthOpen(true)}
          view={view}
          onView={setView}
        />
        {sel && !slot && <p className="muted small" style={{ marginTop: 8 }}>{t('ui.pickSlot')}</p>}
      </section>

      {monthOpen && (
        <MonthSheet
          today={today}
          minOffset={0}
          maxOffset={12}
          initial={weekStart}
          selected={slot?.date ?? null}
          dotsPath={sel ? (from) => `/s/${salon.slug}/availability/days?${selectionQuery(sel)}&from=${from}&days=42${who}` : null}
          isSelectable={(d) => d >= today && daysBetween(today, d) <= cfg.horizonDays}
          onPick={goToDate}
          onToday={() => goToDate(today)}
          onNextFree={sel ? nextFree : undefined}
          onClose={() => setMonthOpen(false)}
        />
      )}

      {sel && slot && blocks && service && (
        <div ref={detailsRef}>
          <DetailsForm sel={sel} service={service} slot={slot} blocks={blocks} price={price} onSubmit={submit} />
        </div>
      )}
    </main>
  );
}
