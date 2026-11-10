import { useQuery } from '@tanstack/react-query';
import { useEffect, useId, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router';
import { api } from '../lib/api';
import { useT } from '../lib/i18n';
import type { StaffUser } from '../lib/types';

/** Whom the login page should be prepared for after "Profil wechseln" (D-055). */
export interface LoginTarget {
  displayName: string;
  username: string | null;
}

const TARGET_KEY = 'salon.loginTarget';

export function storeLoginTarget(t: LoginTarget) {
  try {
    sessionStorage.setItem(TARGET_KEY, JSON.stringify(t));
  } catch {
    /* private mode: the login page simply starts empty */
  }
}

export function peekLoginTarget(): LoginTarget | null {
  try {
    const raw = sessionStorage.getItem(TARGET_KEY);
    return raw ? (JSON.parse(raw) as LoginTarget) : null;
  } catch {
    return null;
  }
}

/** Forget it once the login page has shown it, so a later plain logout starts with an empty form. */
export function clearLoginTarget() {
  try {
    sessionStorage.removeItem(TARGET_KEY);
  } catch {
    /* ignore */
  }
}

interface TeamLogin extends LoginTarget {
  id: string;
}

/**
 * Account menu on the user's name, top right (D-055). Logging out is one step further away than a
 * tab (owner: it was too easy to hit by mistake). Disclosure pattern: a button with aria-expanded
 * and a panel of ordinary links and buttons; Escape and a click outside close it.
 */
export function UserMenu({ me, settingsHref, onLogout, onSwitch }: { me: StaffUser; settingsHref: string; onLogout: () => void; onSwitch: (to: LoginTarget) => void }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [switching, setSwitching] = useState(false);
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const location = useLocation();
  useEffect(() => setOpen(false), [location.pathname]);
  useEffect(() => {
    if (!open) return setSwitching(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        button.current?.focus();
      }
    };
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDown);
    };
  }, [open]);
  return (
    <div className="user-menu" ref={root}>
      <button ref={button} type="button" className="btn user-btn" aria-expanded={open} aria-controls={`${id}-p`} onClick={() => setOpen(!open)}>
        <span className="user-avatar" aria-hidden="true">{initials(me.displayName)}</span>
        <span className="user-name">{me.displayName}</span>
        <span className="sr-only">: {t('staff.account.menu')}</span>
        <svg className="ico" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true" focusable="false"><path d="M6 9l6 6 6-6" /></svg>
      </button>
      <div id={`${id}-p`} className="user-panel" hidden={!open}>
        <p className="small muted" style={{ margin: '0 0 8px' }}>
          {t('staff.account.signedInAs')} <strong style={{ color: 'var(--text)' }}>{me.displayName}</strong>
          <br />{me.role === 'owner' ? t('staff.owner') : t('staff.stylistRole')}
        </p>
        {switching ? (
          <ProfileSwitch me={me} onSwitch={onSwitch} compact />
        ) : (
          <button type="button" className="btn block-l" onClick={() => setSwitching(true)}>{t('staff.account.switch')}</button>
        )}
        <Link className="btn block-l" to={settingsHref}>{t('staff.nav.settings')}</Link>
        <hr />
        <button type="button" className="btn block-l" onClick={onLogout}>{t('staff.logout')}</button>
      </div>
    </div>
  );
}

/** List of colleagues with a login: choosing one logs out and opens the login for that person. */
export function ProfileSwitch({ me, onSwitch, compact = false }: { me: StaffUser; onSwitch: (to: LoginTarget) => void; compact?: boolean }) {
  const t = useT();
  const q = useQuery({ queryKey: ['team-logins'], queryFn: () => api<{ logins: TeamLogin[] }>('/staff/team-logins'), staleTime: 60_000 });
  const others = (q.data?.logins ?? []).filter((l) => l.id !== me.id);
  if (q.isLoading) return <div className="spin" role="status" aria-label={t('staff.customers.loading')} />;
  return (
    <ul className={compact ? 'switch-list compact' : 'switch-list'} aria-label={t('staff.account.switch')}>
      {others.map((l) => (
        <li key={l.id}>
          <button type="button" className="btn block-l" onClick={() => onSwitch({ displayName: l.displayName, username: l.username })}>
            {t('staff.account.switchTo', { name: l.displayName })}
          </button>
        </li>
      ))}
      <li>
        <button type="button" className="btn ghost block-l" onClick={() => onSwitch({ displayName: '', username: null })}>{t('staff.account.otherLogin')}</button>
      </li>
    </ul>
  );
}

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toLocaleUpperCase('de-DE')).join('');
}
