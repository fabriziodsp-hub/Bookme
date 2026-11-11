/**
 * Public salon homepage (D-052): first page clients see, before booking.
 * Everything comes from data the salon already maintains (services, prices, hours, profile) plus the
 * owner's own texts; empty texts hide their section. No third-party embeds (map = plain link).
 */
import { addDays, durationRange, parseHm, weekdayOf, WEEKDAYS, type Audience, type Service } from '@salon/engine';
import { de } from '@salon/i18n';
import { useEffect, useRef, type ReactNode } from 'react';
import { Link } from 'react-router';
import { priceFromFor } from '../lib/booking';
import { formatPhone, priceText, weekdayLong } from '../lib/format';
import { useT } from '../lib/i18n';
import { formatRange, useLabels } from '../lib/labels';
import { useLiveNow, useSalon } from '../lib/salon';

/** Fades a section in when it scrolls into view. Without IntersectionObserver (or with reduced motion) it is simply shown. */
function Reveal({ children, className = '', as: Tag = 'section', ...rest }: { children: ReactNode; className?: string; as?: 'section' | 'div'; [k: string]: unknown }) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || !('IntersectionObserver' in window)) return;
    // Already on screen at load: show at once (it may be the largest paint – no delay, no flash).
    if (el.getBoundingClientRect().top < window.innerHeight) return;
    el.classList.add('reveal');
    const io = new IntersectionObserver(
      (entries) => entries.forEach((e) => e.isIntersecting && (e.target.classList.add('in'), io.unobserve(e.target))),
      { rootMargin: '0px 0px -8% 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <Tag ref={ref as never} className={className} {...rest}>
      {children}
    </Tag>
  );
}

/** "Jetzt geöffnet · bis 17:00 Uhr" etc., from the weekly hours and the salon's live clock. */
function useOpenStatus(): { text: string; open: boolean } {
  const t = useT();
  const salon = useSalon();
  const now = useLiveNow();
  const hours = salon.config.weeklyHours;
  const today = hours[weekdayOf(now.date)];
  if (today) {
    const open = parseHm(today.open);
    const close = parseHm(today.close);
    if (now.minute < open) return { text: t('home.opensToday', { time: today.open }), open: false };
    if (now.minute < close) {
      const br = today.breaks.find(([a, b]) => now.minute >= parseHm(a) && now.minute < parseHm(b));
      if (br) return { text: t('home.onBreak', { time: br[1] }), open: false };
      return { text: t('home.openNow', { time: today.close }), open: true };
    }
  }
  for (let i = 1; i <= 7; i++) {
    const d = addDays(now.date, i);
    const h = hours[weekdayOf(d)];
    if (h) return { text: t('home.closedNow', { day: i === 1 ? t('home.tomorrow') : weekdayLong(d), time: h.open }), open: false };
  }
  return { text: t('home.closed'), open: false };
}

function ServiceCard({ s }: { s: Service }) {
  const t = useT();
  const L = useLabels();
  const salon = useSalon();
  const ranges = s.audiences.map((a: Audience) => durationRange(s, a));
  const min = Math.min(...ranges.map((r) => r.min));
  const max = Math.max(...ranges.map((r) => r.max));
  const price = priceText(priceFromFor(salon.prices, s.id));
  const info = (de.serviceInfo as Record<string, string>)[s.id];
  // The whole card starts the booking with this service (D-065).
  return (
    <li className="h-svc">
      <Link className="h-svc-link" to={`/${salon.slug}/buchen?service=${encodeURIComponent(s.id)}`}>
        <h3>{L.service(s.id)}</h3>
        {info && <p className="small" style={{ margin: '0 0 4px' }}>{info}</p>}
        <p className="muted small">
          {t('home.forWhom', { who: s.audiences.map((a) => t(`audience.${a}`)).join(' & ') })} · {formatRange(min, max)}
          {ranges.some((r) => r.hasFree) ? ` · ${t('ui.inclProcessing')}` : ''}
        </p>
        {price && <p className="h-price">{price}</p>}
        <span className="h-svc-cta">{t('home.bookThis')} <span aria-hidden="true">›</span></span>
      </Link>
    </li>
  );
}

export function HomePage() {
  const t = useT();
  const salon = useSalon();
  const status = useOpenStatus();
  const now = useLiveNow();
  const p = salon.profile;
  const { tagline, about } = salon.homepage;
  const services = salon.config.services.filter((s) => !s.hidden);
  const book = `/${salon.slug}/buchen`;
  const address = `${p.street}, ${p.postalCode} ${p.city}`;
  const todayKey = weekdayOf(now.date);
  const weekdayNames = t.list('weekdayLong');

  return (
    <main id="main" className="home">
      <header className="h-hero">
        <div className="h-hero-bg" aria-hidden="true" />
        <div className="wrap h-hero-in">
          {salon.hasLogo && <img className="h-logo" src={`/api/s/${salon.slug}/logo`} alt="" width={96} height={96} />}
          <h1>{p.name}</h1>
          {tagline && <p className="h-tagline">{tagline}</p>}
          <p className={`h-status ${status.open ? 'open' : ''}`}>
            <span className="dot" aria-hidden="true" /> {status.text}
          </p>
          <div className="row h-cta">
            <Link className="btn primary h-btn" to={book}>{t('home.book')}</Link>
            <a className="btn h-btn" href={`tel:${p.phone}`}>{t('home.call')}</a>
          </div>
        </div>
      </header>

      <div className="wrap h-body">
        <Reveal aria-labelledby="h-svc">
          <h2 id="h-svc">{t('home.services')}</h2>
          <p className="muted small">{t('home.servicesIntro')}</p>
          <ul className="h-grid">{services.map((s) => <ServiceCard key={s.id} s={s} />)}</ul>
        </Reveal>

        <div className="h-two">
          <Reveal className="card" aria-labelledby="h-hours">
            <h2 id="h-hours">{t('home.hours')}</h2>
            <dl className="h-hours">
              {WEEKDAYS.map((d, i) => {
                const h = salon.config.weeklyHours[d];
                const isToday = d === todayKey;
                return (
                  <div key={d} className={isToday ? 'today' : ''} aria-current={isToday ? 'date' : undefined}>
                    <dt>{weekdayNames[i]}{isToday && <span className="badge ac">{t('home.today')}</span>}</dt>
                    <dd>
                      {h ? (
                        <>
                          {h.open}–{h.close}
                          {h.breaks.length > 0 && <span className="muted small">{t('ui.break')} {h.breaks.map(([a, b]) => `${a}–${b}`).join(', ')}</span>}
                        </>
                      ) : (
                        <span className="muted">{t('home.closed')}</span>
                      )}
                    </dd>
                  </div>
                );
              })}
            </dl>
          </Reveal>

          <Reveal className="card" aria-labelledby="h-contact">
            <h2 id="h-contact">{t('home.contact')}</h2>
            <address className="h-address">
              {p.street}<br />{p.postalCode} {p.city}
            </address>
            <p><a href={`tel:${p.phone}`}>{p.phoneDisplay || formatPhone(p.phone)}</a><br /><a href={`mailto:${p.email}`}>{p.email}</a></p>
            <a className="btn" href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`} target="_blank" rel="noopener noreferrer">
              {t('home.route')} <span className="sr-only">({t('home.routeHint')})</span>↗
            </a>
          </Reveal>
        </div>

        {about && (
          <Reveal aria-labelledby="h-about">
            <h2 id="h-about">{t('home.about')}</h2>
            <p className="h-about">{about}</p>
          </Reveal>
        )}

        {salon.team.length > 0 && (
          <Reveal aria-labelledby="h-team">
            <h2 id="h-team">{t('home.team')}</h2>
            <ul className="h-team">
              {salon.team.map((m) => (
                <li key={m.publicName}>
                  <span className="h-avatar" aria-hidden="true">{m.publicName.slice(0, 1).toUpperCase()}</span>
                  {m.publicName}
                </li>
              ))}
            </ul>
          </Reveal>
        )}

        <Reveal className="card h-final" aria-labelledby="h-final">
          <h2 id="h-final">{t('home.ctaTitle')}</h2>
          <p>{t('home.ctaText')}</p>
          <Link className="btn primary h-btn" to={book}>{t('home.book')}</Link>
        </Reveal>
      </div>

      {/* phones: booking always one tap away */}
      <div className="h-sticky">
        <Link className="btn primary block" to={book}>{t('home.book')}</Link>
      </div>
    </main>
  );
}
