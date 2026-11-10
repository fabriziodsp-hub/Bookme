import { useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { api, errorMessage } from '../lib/api';
import { useT } from '../lib/i18n';

/** Staff login: e-mail or user name in one field (D-049). `slug` = salon of this login page (user names are per salon). */
export function Login({ title, slug }: { title: string; slug?: string | undefined }) {
  const t = useT();
  const qc = useQueryClient();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const me = await api('/auth/login', { method: 'POST', body: { login: email, password, slug } });
      qc.setQueryData(['me'], me);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <main id="main" className="wrap" style={{ maxWidth: 440, paddingTop: 24 }}>
      <form className="card" onSubmit={submit}>
        <h1>{title}</h1>
        <div className="field">
          <label htmlFor="li-email">{t('staff.loginName')}</label>
          <input id="li-email" type="text" autoComplete="username" autoCapitalize="none" spellCheck={false} value={email} onChange={(e) => setEmail(e.target.value)} required />
        </div>
        <div className="field">
          <label htmlFor="li-pw">{t('staff.password')}</label>
          <input id="li-pw" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </div>
        {error && <p className="notice error" role="alert">{error}</p>}
        <button className="btn primary block" disabled={busy}>{t('staff.login')}</button>
      </form>
    </main>
  );
}
