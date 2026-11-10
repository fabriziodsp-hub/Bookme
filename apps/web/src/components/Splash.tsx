import { useEffect, useState } from 'react';
import { useT } from '../lib/i18n';

const SEEN = 'salon.splashSeen';

/**
 * Logo splash on app start (D-023): at most 2 s, once per browser session, skippable by tap/key.
 * Not a dialog: it does not trap focus, and the page underneath is already rendered and reachable.
 */
export function Splash({ logoUrl, name }: { logoUrl: string | null; name: string }) {
  const t = useT();
  const [state, setState] = useState<'show' | 'out' | 'gone'>(() => {
    try {
      return sessionStorage.getItem(SEEN) ? 'gone' : 'show';
    } catch {
      return 'show';
    }
  });
  useEffect(() => {
    if (state !== 'show') return;
    try {
      sessionStorage.setItem(SEEN, '1');
    } catch {
      /* ignore */
    }
    const t1 = setTimeout(() => setState('out'), 2000);
    const skip = () => setState('out');
    window.addEventListener('keydown', skip, { once: true });
    return () => {
      clearTimeout(t1);
      window.removeEventListener('keydown', skip);
    };
  }, [state]);
  useEffect(() => {
    if (state === 'out') {
      const t2 = setTimeout(() => setState('gone'), 250);
      return () => clearTimeout(t2);
    }
  }, [state]);
  if (state === 'gone') return null;
  return (
    <div className={`splash ${state === 'out' ? 'out' : ''}`} onClick={() => setState('out')} aria-hidden="true" data-testid="splash">
      {logoUrl ? <img src={logoUrl} alt="" /> : <div className="name">{name}</div>}
      <span className="sr-only">{t('ui.splashSkip')}</span>
    </div>
  );
}
