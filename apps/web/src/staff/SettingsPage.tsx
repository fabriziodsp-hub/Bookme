/** Settings (S-10, D-058): account for everyone; services & durations, prices, opening hours, homepage, theme, team for the owner. */
import { WEEKDAYS, type Weekday } from '@salon/engine';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { Link, Navigate, NavLink, Route, Routes, useParams } from 'react-router';
import { api, errorMessage } from '../lib/api';
import { dateLong, hm } from '../lib/format';
import { useT } from '../lib/i18n';
import { useLabels } from '../lib/labels';
import { useSalon } from '../lib/salon';
import { ServicesEditor } from './ServicesEditor';
import type { PriceEntry, StaffUser } from '../lib/types';
import { ProfileSwitch, type LoginTarget } from './UserMenu';
import { ACCENTS, contrast, type Accent, type Preset } from '../theme/palette';

export type SettingsCategory = 'konto' | 'leistungen' | 'preise' | 'oeffnungszeiten' | 'startseite' | 'aussehen' | 'team';

/** Categories in menu order; `owner` = only for the salon owner (D-058). */
export const CATEGORIES: { id: SettingsCategory; owner: boolean }[] = [
  { id: 'konto', owner: false },
  { id: 'leistungen', owner: true },
  { id: 'preise', owner: true },
  { id: 'oeffnungszeiten', owner: true },
  { id: 'startseite', owner: true },
  { id: 'aussehen', owner: true },
  { id: 'team', owner: true },
];

/**
 * Settings by category (D-058): an overview with one large link per category, and one page per
 * category with the category list beside it (desktop) or above it (phone). Everyone has "Konto"
 * (logout, switch profile); the salon settings are for the owner only.
 */
export function SettingsPage({ me, onLogout, onSwitch }: { me: StaffUser; onLogout: () => void; onSwitch: (to: LoginTarget) => void }) {
  const t = useT();
  const { slug = '' } = useParams();
  const owner = me.role === 'owner';
  const cats = CATEGORIES.filter((c) => owner || !c.owner);
  const base = `/${slug}/team/einstellungen`;
  return (
    <Routes>
      <Route
        index
        element={
          <main id="main" className="wrap">
            <h1>{t('staff.nav.settings')}</h1>
            <ul className="set-grid">
              {cats.map((c) => (
                <li key={c.id}>
                  <Link className="set-tile" to={`${base}/${c.id}`}>
                    <span className="set-tile-t">{t(`staff.set.${c.id}`)}</span>
                    <span className="small muted">{t(`staff.set.${c.id}Hint`)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </main>
        }
      />
      {cats.map((c) => (
        <Route
          key={c.id}
          path={c.id}
          element={
            <div className="wrap-wide set-layout">
              <nav className="set-nav" aria-label={t('staff.nav.settings')} ref={showActive}>
                <Link to={base} className="set-back">‹ {t('staff.set.all')}</Link>
                <ul>
                  {cats.map((x) => (
                    <li key={x.id}><NavLink to={`${base}/${x.id}`} className="set-link">{t(`staff.set.${x.id}`)}</NavLink></li>
                  ))}
                </ul>
              </nav>
              <main id="main" className="set-main">
                <h1>{t(`staff.set.${c.id}`)}</h1>
                {/* one section per category: its own heading would repeat the h1 → only for screen readers */}
                <div className={c.id === 'konto' ? undefined : 'set-single'}>
                  <Category id={c.id} me={me} onLogout={onLogout} onSwitch={onSwitch} />
                </div>
              </main>
            </div>
          }
        />
      ))}
      <Route path="*" element={<Navigate to={base} replace />} />
    </Routes>
  );
}

/** Phones: the category row scrolls sideways – bring the current category into view. */
function showActive(nav: HTMLElement | null) {
  const a = nav?.querySelector<HTMLElement>('.set-link.active');
  const ul = a?.closest('ul');
  if (a && ul && ul.scrollWidth > ul.clientWidth) ul.scrollLeft += a.getBoundingClientRect().left - ul.getBoundingClientRect().left - (ul.clientWidth - a.offsetWidth) / 2;
}

function Category({ id, me, onLogout, onSwitch }: { id: SettingsCategory; me: StaffUser; onLogout: () => void; onSwitch: (to: LoginTarget) => void }) {
  const t = useT();
  switch (id) {
    case 'konto':
      return <Account me={me} onLogout={onLogout} onSwitch={onSwitch} />;
    case 'leistungen':
      return (
        <section className="card" aria-labelledby="svc-h">
          <h2 id="svc-h">{t('staff.svc.title')}</h2>
          <ServicesEditor endpoint="/staff/admin/services" queryKey={['catalog']} />
        </section>
      );
    case 'preise':
      return <Prices />;
    case 'oeffnungszeiten':
      return <Hours />;
    case 'startseite':
      return <HomepageTexts />;
    case 'aussehen':
      return <ThemePicker />;
    case 'team':
      return <Team me={me} />;
  }
}

/** Konto (everyone): who is logged in, switch to a colleague's profile, log out (D-055). */
function Account({ me, onLogout, onSwitch }: { me: StaffUser; onLogout: () => void; onSwitch: (to: LoginTarget) => void }) {
  const t = useT();
  return (
    <>
      <section className="card" aria-labelledby="ac-h">
        <h2 id="ac-h">{t('staff.account.signedInAs')}</h2>
        <p style={{ margin: 0 }}><strong>{me.displayName}</strong> · {me.role === 'owner' ? t('staff.owner') : t('staff.stylistRole')}</p>
        <p className="small muted">{me.email}</p>
        <button type="button" className="btn" onClick={onLogout}>{t('staff.logout')}</button>
      </section>
      <section className="card" aria-labelledby="sw-h">
        <h2 id="sw-h">{t('staff.account.switch')}</h2>
        <p className="small muted">{t('staff.account.switchHint')}</p>
        <ProfileSwitch me={me} onSwitch={onSwitch} />
      </section>
    </>
  );
}

function Prices() {
  const t = useT();
  const salon = useSalon();
  const L = useLabels();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['prices'], queryFn: () => api<{ prices: PriceEntry[] }>('/staff/admin/prices') });
  const [rows, setRows] = useState<PriceEntry[] | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const list = rows ?? q.data?.prices ?? [];
  // One editable line per service and per variant.
  const lines = salon.config.services.flatMap((s) => (s.variants ? s.variants.map((v) => ({ s, v })) : [{ s, v: '' }]));
  const get = (sid: string, v: string) => list.find((p) => p.serviceId === sid && p.variant === v);
  const set = (sid: string, v: string, patch: Partial<PriceEntry> | null) => {
    const others = list.filter((p) => !(p.serviceId === sid && p.variant === v));
    const cur = get(sid, v) ?? { serviceId: sid, variant: v, priceCents: 0, isFrom: false, finishSurchargeCents: null };
    setRows(patch === null ? others : [...others, { ...cur, ...patch }]);
  };
  const save = async () => {
    try {
      await api('/staff/admin/prices', { method: 'PUT', body: { prices: list } });
      setMsg(t('staff.saved'));
      setRows(null);
      void qc.invalidateQueries({ queryKey: ['prices'] });
      void qc.invalidateQueries({ queryKey: ['salon'] });
    } catch (e) {
      setMsg(errorMessage(e));
    }
  };
  return (
    <section className="card" aria-labelledby="pr-h">
      <h2 id="pr-h">{t('staff.prices')}</h2>
      <div style={{ overflowX: 'auto' }}>
        <table className="prices">
          <thead>
            <tr><th>{t('ui.step.service')}</th><th>€</th><th>{t('staff.priceFrom')}</th><th>{t('staff.finishSurcharge')}</th></tr>
          </thead>
          <tbody>
            {lines.map(({ s, v }) => {
              const p = get(s.id, v);
              const label = `${L.service(s.id)}${v ? ` – ${L.variant(v)}` : ''}`;
              return (
                <tr key={`${s.id}|${v}`}>
                  <th scope="row" style={{ fontWeight: 400 }}>{label}</th>
                  <td>
                    <input type="number" min={0} step={0.5} inputMode="decimal" aria-label={`${label} Preis in Euro`} value={p ? p.priceCents / 100 : ''} placeholder="–"
                      onChange={(e) => (e.target.value === '' ? set(s.id, v, null) : set(s.id, v, { priceCents: Math.round(Number(e.target.value) * 100) }))} />
                  </td>
                  <td><input type="checkbox" aria-label={`${label}: ab-Preis`} disabled={!p} checked={!!p?.isFrom} onChange={(e) => set(s.id, v, { isFrom: e.target.checked })} style={{ width: 24, height: 24 }} /></td>
                  <td>
                    {s.finishOption && (
                      <input type="number" min={0} step={0.5} aria-label={`${label}: Aufpreis Veredelung in Euro`} disabled={!p} value={p?.finishSurchargeCents != null ? p.finishSurchargeCents / 100 : ''}
                        onChange={(e) => set(s.id, v, { finishSurchargeCents: e.target.value === '' ? null : Math.round(Number(e.target.value) * 100) })} />
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="muted small">Leere Felder = kein Preis angezeigt. Preise dienen nur der Information; in der App wird nichts bezahlt.</p>
      <div className="row"><button type="button" className="btn primary" onClick={save}>{t('staff.save')}</button>{msg && <span role="status">{msg}</span>}</div>
    </section>
  );
}

type DayH = { open: string; close: string; breaks: [string, string][] } | null;

function Hours() {
  const t = useT();
  const salon = useSalon();
  const qc = useQueryClient();
  const [hours, setHours] = useState<Record<Weekday, DayH>>(salon.config.weeklyHours as Record<Weekday, DayH>);
  const [conflicts, setConflicts] = useState<{ refCode: string; date: string; start: number; customer: string }[] | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const send = async (dryRun: boolean) => {
    setMsg(null);
    try {
      const r = await api<{ conflicts: { refCode: string; date: string; start: number; customer: string }[] }>('/staff/admin/opening-hours', { method: 'PUT', body: { dryRun, weeklyHours: hours } });
      setConflicts(r.conflicts);
      if (!dryRun) {
        setMsg(t('staff.saved'));
        void qc.invalidateQueries({ queryKey: ['salon'] });
      }
    } catch (e) {
      setMsg(errorMessage(e));
    }
  };
  const upd = (d: Weekday, v: DayH) => setHours({ ...hours, [d]: v });
  return (
    <section className="card" aria-labelledby="oh-h">
      <h2 id="oh-h">{t('staff.hours')}</h2>
      {WEEKDAYS.map((d, i) => {
        const h = hours[d];
        const name = t.list('weekdayLong')[i] ?? d;
        return (
          <fieldset key={d} className="list-item" style={{ border: 0, margin: 0 }}>
            <legend style={{ fontWeight: 650, minWidth: 110 }}>{name}</legend>
            <label className="check" style={{ padding: 0 }}>
              <input type="checkbox" checked={!h} onChange={(e) => upd(d, e.target.checked ? null : { open: '08:00', close: '17:00', breaks: [] })} />
              <span>{t('staff.closedDay')}</span>
            </label>
            {h && (
              <div className="row">
                <input type="time" step={300} aria-label={`${name} öffnet`} value={h.open} onChange={(e) => upd(d, { ...h, open: e.target.value })} style={{ width: 120 }} />
                –
                <input type="time" step={300} aria-label={`${name} schließt`} value={h.close} onChange={(e) => upd(d, { ...h, close: e.target.value })} style={{ width: 120 }} />
                {h.breaks.map((b, bi) => (
                  <span key={bi} className="row">
                    {t('ui.break')}
                    <input type="time" step={300} aria-label={`${name} Pause ${bi + 1} Beginn`} value={b[0]} onChange={(e) => upd(d, { ...h, breaks: h.breaks.map((x, j) => (j === bi ? [e.target.value, x[1]] : x)) as [string, string][] })} style={{ width: 120 }} />
                    –
                    <input type="time" step={300} aria-label={`${name} Pause ${bi + 1} Ende`} value={b[1]} onChange={(e) => upd(d, { ...h, breaks: h.breaks.map((x, j) => (j === bi ? [x[0], e.target.value] : x)) as [string, string][] })} style={{ width: 120 }} />
                    <button type="button" className="btn" aria-label={`${name} Pause ${bi + 1} entfernen`} onClick={() => upd(d, { ...h, breaks: h.breaks.filter((_, j) => j !== bi) })}>✕</button>
                  </span>
                ))}
                <button type="button" className="btn" onClick={() => upd(d, { ...h, breaks: [...h.breaks, ['12:00', '13:00']] })}>{t('staff.addBreak')}</button>
              </div>
            )}
          </fieldset>
        );
      })}
      {conflicts && conflicts.length > 0 && (
        <div className="notice warn">
          <p>{t('staff.conflicts')}</p>
          <ul>{conflicts.map((c) => <li key={c.refCode}>{dateLong(c.date)}, {hm(c.start)} – {c.customer} ({c.refCode})</li>)}</ul>
        </div>
      )}
      {conflicts && conflicts.length === 0 && <p className="muted small">Keine Konflikte.</p>}
      <div className="row">
        <button type="button" className="btn" onClick={() => send(true)}>{t('staff.preview')}</button>
        <button type="button" className="btn primary" onClick={() => send(false)}>{t('staff.save')}</button>
        {msg && <span role="status">{msg}</span>}
      </div>
    </section>
  );
}

function ThemePicker() {
  const t = useT();
  const salon = useSalon();
  const qc = useQueryClient();
  const [preset, setPreset] = useState<Preset>(salon.theme.preset);
  const [accent, setAccent] = useState<Accent>(salon.theme.accent);
  const [msg, setMsg] = useState<string | null>(null);
  const save = async () => {
    try {
      await api('/staff/admin/theme', { method: 'PUT', body: { preset, accent } });
      setMsg(t('staff.saved'));
      void qc.invalidateQueries({ queryKey: ['salon'] });
    } catch (e) {
      setMsg(errorMessage(e));
    }
  };
  const presetNames: Record<Preset, string> = { dark: 'Dunkel', light: 'Hell', warm: 'Warm', contrast: 'Kontrast' };
  const accentNames: Record<Accent, string> = { emerald: 'Smaragd', violet: 'Violett', rose: 'Rosé', amber: 'Bernstein', sky: 'Himmelblau', slate: 'Schiefer' };
  return (
    <section className="card" aria-labelledby="th-h">
      <h2 id="th-h">{t('staff.theme')}</h2>
      <div className="chips" role="radiogroup" aria-label="Stil">
        {(Object.keys(presetNames) as Preset[]).map((p) => (
          <button key={p} type="button" role="radio" className="chip" aria-checked={preset === p} onClick={() => setPreset(p)}>{presetNames[p]}</button>
        ))}
      </div>
      <div className="chips" role="radiogroup" aria-label="Akzentfarbe" style={{ marginTop: 8 }}>
        {(Object.keys(ACCENTS) as Accent[]).map((a) => (
          <button key={a} type="button" role="radio" className="chip" aria-checked={accent === a} onClick={() => setAccent(a)}>
            <span aria-hidden="true" style={{ width: 16, height: 16, borderRadius: 8, background: ACCENTS[a].light.ac, display: 'inline-block' }} />
            {accentNames[a]}
          </button>
        ))}
      </div>
      <p className="muted small">Alle Kombinationen erfüllen WCAG 2.2 AA (Kontrast z. B. {contrast(ACCENTS[accent].dark.ink, ACCENTS[accent].dark.ac).toFixed(1)} : 1). Das Logo wird vom Plattformbetreiber hinterlegt.</p>
      <div className="row"><button type="button" className="btn primary" onClick={save}>{t('staff.save')}</button>{msg && <span role="status">{msg}</span>}</div>
    </section>
  );
}

function Team({ me }: { me: StaffUser }) {
  const t = useT();
  const [del, setDel] = useState<{ id: string; displayName: string } | null>(null);
  const q = useQuery({ queryKey: ['staff'], queryFn: () => api<{ staff: { id: string; displayName: string; email: string | null; username: string | null; role: string | null; active: boolean; color: string; publicName: string | null; showPublic: boolean }[] }>('/staff/admin/staff') });
  const [f, setF] = useState({ displayName: '', email: '', username: '', password: '', role: 'stylist' });
  const [msg, setMsg] = useState<string | null>(null);
  const add = async () => {
    try {
      await api('/staff/admin/staff', { method: 'POST', body: { displayName: f.displayName, email: f.email || undefined, username: f.username || undefined, password: f.password || undefined, role: f.role } });
      setF({ displayName: '', email: '', username: '', password: '', role: 'stylist' });
      setMsg(t('staff.saved'));
      void q.refetch();
    } catch (e) {
      setMsg(errorMessage(e));
    }
  };
  return (
    <section className="card" aria-labelledby="tm-h">
      <h2 id="tm-h">{t('staff.staffList')}</h2>
      {(q.data?.staff ?? []).map((s) => (
        <div key={s.id} className="list-item">
          <span aria-hidden="true" style={{ width: 14, height: 14, borderRadius: 7, background: s.color, marginTop: 4 }} />
          <span style={{ flex: 1 }}>{s.displayName} <span className="muted small">{s.email ?? '–'}{s.username ? ` · ${t('staff.username')}: ${s.username}` : ''} · {s.role === 'owner' ? t('staff.owner') : t('staff.stylistRole')}{s.active ? '' : ' · inaktiv'}</span></span>
          {s.email && <UsernameEdit id={s.id} name={s.displayName} current={s.username} onSaved={() => void q.refetch()} />}
          <PublicToggle id={s.id} name={s.displayName} show={s.showPublic} publicName={s.publicName} onSaved={() => void q.refetch()} />
          <button type="button" className="btn" onClick={async () => { await api(`/staff/admin/staff/${s.id}/active`, { method: 'POST', body: { active: !s.active } }); void q.refetch(); }}>{s.active ? 'Deaktivieren' : 'Aktivieren'}</button>
          {s.id !== me.stylistId && (
            <button type="button" className="btn danger" aria-label={`${t('staff.del.button')}: ${s.displayName}`} onClick={() => setDel({ id: s.id, displayName: s.displayName })}>{t('staff.del.button')}</button>
          )}
        </div>
      ))}
      {del && (
        <DeleteStaffDialog
          person={del}
          onClose={(result) => {
            setDel(null);
            if (result) {
              setMsg(result);
              void q.refetch();
            }
          }}
        />
      )}
      <h3 style={{ marginTop: 12 }}>{t('staff.addStaff')}</h3>
      <div className="row">
        <input aria-label={t('staff.displayName')} placeholder={t('staff.displayName')} value={f.displayName} onChange={(e) => setF({ ...f, displayName: e.target.value })} style={{ flex: '1 1 160px' }} />
        <input aria-label={`${t('staff.email')} (nötig für den Zugang zur App)`} placeholder={`${t('staff.email')} (für den Zugang)`} type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} style={{ flex: '1 1 200px' }} />
        <input aria-label={`${t('staff.username')} (optional)`} placeholder={`${t('staff.username')} (optional)`} type="text" autoCapitalize="none" spellCheck={false} value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} style={{ flex: '1 1 160px' }} />
        <input aria-label={t('staff.password')} placeholder={`${t('staff.password')} (min. 12)`} type="password" autoComplete="new-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} style={{ flex: '1 1 160px' }} />
        <select aria-label={t('staff.role')} value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })} style={{ flex: '0 1 160px' }}>
          <option value="stylist">{t('staff.stylistRole')}</option>
          <option value="owner">{t('staff.owner')}</option>
        </select>
        <button type="button" className="btn primary" disabled={!f.displayName} onClick={add}>{t('staff.create')}</button>
      </div>
      {msg && <p role="status">{msg}</p>}
    </section>
  );
}

/** Owner: set, change or remove a login's user name (D-049). */
function UsernameEdit({ id, name, current, onSaved }: { id: string; name: string; current: string | null; onSaved: () => void }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [v, setV] = useState(current ?? '');
  const [msg, setMsg] = useState<string | null>(null);
  if (!open) return <button type="button" className="btn" onClick={() => (setV(current ?? ''), setMsg(null), setOpen(true))}>{t('staff.username')}</button>;
  const save = async () => {
    try {
      await api(`/staff/admin/staff/${id}/username`, { method: 'PUT', body: { username: v.trim() || null } });
      setOpen(false);
      onSaved();
    } catch (e) {
      setMsg(errorMessage(e));
    }
  };
  return (
    <span className="row" style={{ flexBasis: '100%' }}>
      <input type="text" autoCapitalize="none" spellCheck={false} aria-label={`${name}: ${t('staff.username')}`} aria-describedby={`un-${id}`} value={v} onChange={(e) => setV(e.target.value)} style={{ flex: '1 1 160px' }} />
      <button type="button" className="btn primary" onClick={save}>{t('staff.save')}</button>
      <button type="button" className="btn" onClick={() => setOpen(false)}>{t('staff.abort')}</button>
      <span id={`un-${id}`} className="muted small">{t('staff.usernameHint')}</span>
      {msg && <span role="alert" className="notice error">{msg}</span>}
    </span>
  );
}

/** Owner: texts of the public homepage (D-052). Plain text; empty fields hide their section. */
function HomepageTexts() {
  const t = useT();
  const salon = useSalon();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['homepage'], queryFn: () => api<{ tagline: string; about: string }>('/staff/admin/homepage') });
  const [draft, setDraft] = useState<{ tagline: string; about: string } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const v = draft ?? q.data ?? { tagline: '', about: '' };
  const save = async () => {
    try {
      const r = await api<{ tagline: string; about: string }>('/staff/admin/homepage', { method: 'PUT', body: v });
      qc.setQueryData(['homepage'], r);
      setDraft(null);
      setMsg(t('staff.saved'));
      void qc.invalidateQueries({ queryKey: ['salon'] });
    } catch (e) {
      setMsg(errorMessage(e));
    }
  };
  return (
    <section className="card" aria-labelledby="hp-h">
      <h2 id="hp-h">{t('staff.home.title')}</h2>
      <p className="muted small">{t('staff.home.intro')}</p>
      <div className="field">
        <label htmlFor="hp-tag">{t('staff.home.tagline')}</label>
        <input id="hp-tag" type="text" maxLength={120} value={v.tagline} onChange={(e) => setDraft({ ...v, tagline: e.target.value })} />
      </div>
      <div className="field">
        <label htmlFor="hp-about">{t('staff.home.about')}</label>
        <textarea id="hp-about" rows={5} maxLength={1500} value={v.about} onChange={(e) => setDraft({ ...v, about: e.target.value })} />
      </div>
      <div className="row">
        <button type="button" className="btn primary" disabled={!draft} onClick={save}>{t('staff.save')}</button>
        <a className="btn" href={`/${salon.slug}`} target="_blank" rel="noopener">{t('staff.home.view')} ↗</a>
        {msg && <span role="status">{msg}</span>}
      </div>
    </section>
  );
}

/** Owner: show a person on the homepage – only with their consent, only under a public name (D-052). */
function PublicToggle({ id, name, show, publicName, onSaved }: { id: string; name: string; show: boolean; publicName: string | null; onSaved: () => void }) {
  const t = useT();
  const [on, setOn] = useState(show);
  const [pn, setPn] = useState(publicName ?? name.split(' ')[0] ?? '');
  const [msg, setMsg] = useState<string | null>(null);
  const dirty = on !== show || (on && pn.trim() !== (publicName ?? ''));
  const save = async () => {
    try {
      await api(`/staff/admin/staff/${id}/public`, { method: 'PUT', body: { show: on, publicName: pn.trim() || null } });
      setMsg(null);
      onSaved();
    } catch (e) {
      setMsg(errorMessage(e));
    }
  };
  return (
    <span className="row" style={{ flexBasis: '100%' }}>
      <label className="check" style={{ padding: 0 }}>
        <input type="checkbox" checked={on} onChange={(e) => setOn(e.target.checked)} aria-describedby={`pub-${id}`} />
        <span>{name}: {t('staff.home.publicLabel')}</span>
      </label>
      {on && <input type="text" maxLength={40} aria-label={`${name}: ${t('staff.home.publicName')}`} placeholder={t('staff.home.publicName')} value={pn} onChange={(e) => setPn(e.target.value)} style={{ flex: '1 1 160px' }} />}
      {dirty && <button type="button" className="btn primary" onClick={save}>{t('staff.save')}</button>}
      <span id={`pub-${id}`} className="muted small">{t('staff.home.publicHint')}</span>
      {msg && <span role="alert" className="notice error">{msg}</span>}
    </span>
  );
}


/**
 * Owner: delete a staff profile after an explicit confirmation (D-054). Modal <dialog>: focus stays
 * inside, Escape cancels. Past appointments stay in the history; upcoming ones wait in the requests.
 */
function DeleteStaffDialog({ person, onClose }: { person: { id: string; displayName: string }; onClose: (result: string | null) => void }) {
  const t = useT();
  const qc = useQueryClient();
  const ref = useRef<HTMLDialogElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);
  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ removed: 'deleted' | 'anonymized'; toReassign: number }>(`/staff/admin/staff/${person.id}`, { method: 'DELETE' });
      void qc.invalidateQueries({ queryKey: ['requests'] });
      void qc.invalidateQueries({ queryKey: ['cal'] });
      ref.current?.close();
      onClose(r.toReassign ? t('staff.del.doneReassign', { name: person.displayName, n: r.toReassign }) : t('staff.del.done', { name: person.displayName }));
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };
  return (
    <dialog ref={ref} className="del-dialog" aria-labelledby="del-h" aria-describedby="del-d" onClose={() => onClose(null)}>
      <h2 id="del-h">{t('staff.del.title', { name: person.displayName })}</h2>
      <div id="del-d">
        <ul className="small">
          <li>{t('staff.del.past')}</li>
          <li>{t('staff.del.future')}</li>
          <li>{t('staff.del.login')}</li>
        </ul>
        <p><strong>{t('staff.del.final')}</strong></p>
      </div>
      {error && <p className="notice error" role="alert">{error}</p>}
      <div className="row">
        <button type="button" className="btn danger" disabled={busy} onClick={confirm}>{t('staff.del.confirm')}</button>
        <button type="button" className="btn" autoFocus onClick={() => ref.current?.close()}>{t('staff.abort')}</button>
      </div>
    </dialog>
  );
}
