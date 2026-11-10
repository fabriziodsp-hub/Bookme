/** Platform operator area (/admin): salons, logo upload (only here, D-023), activation, services editor (D-048). */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { api, errorMessage } from '../lib/api';
import { Login } from '../staff/Login';
import { ServicesEditor } from '../staff/ServicesEditor';
import { useMe } from '../staff/hooks';
import '../staff/staff.css';

interface TenantRow {
  id: string;
  slug: string;
  name: string;
  active: boolean;
  hasLogo: boolean;
}

export default function PlatformAdmin() {
  const me = useMe();
  const qc = useQueryClient();
  const tenants = useQuery({ queryKey: ['tenants'], queryFn: () => api<{ tenants: TenantRow[] }>('/platform/tenants'), enabled: me.data?.role === 'platform_admin' });
  const [f, setF] = useState({ slug: '', name: '', ownerName: '', ownerEmail: '', ownerPassword: '' });
  const [msg, setMsg] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  if (me.isLoading) return <div className="spin" />;
  if (!me.data) return <Login title="Plattform-Verwaltung" />;
  if (me.data.role !== 'platform_admin') return <main className="wrap"><p className="notice error">Kein Zugriff.</p></main>;

  const create = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await api('/platform/tenants', { method: 'POST', body: f });
      setMsg('Salon angelegt.');
      void tenants.refetch();
    } catch (err) {
      setMsg(errorMessage(err));
    }
  };
  const upload = async (t: TenantRow, file: File) => {
    const res = await fetch(`/api/platform/tenants/${t.id}/logo`, { method: 'PUT', headers: { 'x-requested-with': 'salon', 'content-type': 'application/octet-stream' }, body: await file.arrayBuffer() });
    setMsg(res.ok ? `Logo für ${t.name} gespeichert.` : ((await res.json()).error?.message ?? 'Fehler'));
    void tenants.refetch();
    void qc.invalidateQueries({ queryKey: ['salon', t.slug] });
  };
  return (
    <main id="main" className="wrap">
      <div className="row" style={{ padding: '12px 0' }}>
        <h1 style={{ margin: 0 }}>Plattform-Verwaltung</h1>
        <span className="spacer" />
        <button type="button" className="btn" onClick={async () => { await api('/auth/logout', { method: 'POST' }); qc.setQueryData(['me'], null); }}>Abmelden</button>
      </div>
      {msg && <p className="notice" role="status">{msg}</p>}
      <section className="card">
        <h2>Salons</h2>
        {(tenants.data?.tenants ?? []).map((t) => (
          <div key={t.id} className="list-item">
            <div style={{ flex: '1 1 220px' }}>
              <strong>{t.name}</strong> <a href={`/${t.slug}`}>/{t.slug}</a> {t.hasLogo && <span className="badge">Logo</span>} {!t.active && <span className="badge danger">inaktiv</span>}
            </div>
            <label className="btn">
              Logo hochladen
              <input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" className="sr-only" onChange={(e) => e.target.files?.[0] && upload(t, e.target.files[0])} />
            </label>
            <button type="button" className="btn" aria-expanded={editing === t.id} onClick={() => setEditing(editing === t.id ? null : t.id)}>
              Leistungen bearbeiten
            </button>
            <button type="button" className="btn" onClick={async () => { await api(`/platform/tenants/${t.id}/active`, { method: 'POST', body: { active: !t.active } }); void tenants.refetch(); }}>
              {t.active ? 'Deaktivieren' : 'Aktivieren'}
            </button>
            {editing === t.id && (
              <div style={{ flexBasis: '100%' }}>
                <ServicesEditor endpoint={`/platform/tenants/${t.id}/catalog`} queryKey={['catalog', t.id]} />
              </div>
            )}
          </div>
        ))}
      </section>
      <form className="card" onSubmit={create}>
        <h2>Neuer Salon</h2>
        {(
          [
            ['slug', 'Adresse (z. B. salon-muster)', 'text'],
            ['name', 'Name des Salons', 'text'],
            ['ownerName', 'Name Inhaber/in', 'text'],
            ['ownerEmail', 'E-Mail Inhaber/in', 'email'],
            ['ownerPassword', 'Startpasswort (min. 12 Zeichen)', 'password'],
          ] as const
        ).map(([k, label, type]) => (
          <div className="field" key={k}>
            <label htmlFor={`pa-${k}`}>{label}</label>
            <input id={`pa-${k}`} type={type} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} required autoComplete={type === 'password' ? 'new-password' : 'off'} />
          </div>
        ))}
        <button className="btn primary">Anlegen</button>
        <p className="muted small">Leistungen und Dauern starten mit der Vorlage aus der Konfiguration; Öffnungszeiten und Preise pflegt der Salon selbst.</p>
      </form>
    </main>
  );
}
