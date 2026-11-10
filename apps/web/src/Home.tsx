/** Platform landing page: no salon chosen. Intentionally plain; salons share their own link. */
export function Home() {
  return (
    <main className="wrap" id="main" style={{ paddingTop: 48 }}>
      <h1>Online-Terminbuchung für Friseursalons</h1>
      <p className="muted">Bitte nutzen Sie den Link Ihres Salons, z. B. <a href="/salon-beispiel">/salon-beispiel</a>.</p>
    </main>
  );
}
