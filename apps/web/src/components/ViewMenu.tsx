import { useState } from 'react';
import { useT } from '../lib/i18n';
import { DEFAULT_PREFS } from '../theme/palette';
import { useTheme } from '../theme/ThemeProvider';
import { Dialog } from './Dialog';

/** "Ansicht": text size, colour scheme, high contrast, reduced motion – per device (D-022). */
export function ViewMenu() {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="btn" aria-haspopup="dialog" onClick={() => setOpen(true)}>
        <span aria-hidden="true">Aa</span> {t('ui.view.button')}
      </button>
      {open && (
        <Dialog title={t('ui.view.title')} onClose={() => setOpen(false)}>
          <div className="row" style={{ marginBottom: 12 }}>
            <h2 style={{ margin: 0 }}>{t('ui.view.title')}</h2>
            <span className="spacer" />
            <button type="button" className="btn" onClick={() => setOpen(false)}>{t('ui.close')}</button>
          </div>
          <ViewSettings />
        </Dialog>
      )}
    </>
  );
}

/** The view settings themselves – in the "Ansicht" dialog and in Einstellungen › Ansicht (D-059). */
export function ViewSettings() {
  const t = useT();
  const { prefs, setPrefs, reducedMotion } = useTheme();
  return (
    <>
    <fieldset className="field" style={{ border: 0, padding: 0 }}>
      <legend className="small muted">{t('ui.view.textSize')}</legend>
      <div className="chips">
        {([100, 125, 150] as const).map((s) => (
          <button key={s} type="button" className="chip" aria-pressed={prefs.textScale === s} onClick={() => setPrefs({ ...prefs, textScale: s })}>
            <span style={{ fontSize: `${s / 100}rem` }}>A</span> {s} %
          </button>
        ))}
      </div>
    </fieldset>
    <fieldset className="field" style={{ border: 0, padding: 0 }}>
      <legend className="small muted">{t('ui.view.scheme')}</legend>
      <div className="chips">
        {(['auto', 'light', 'dark'] as const).map((s) => (
          <button key={s} type="button" className="chip" aria-pressed={prefs.scheme === s} onClick={() => setPrefs({ ...prefs, scheme: s })}>
            {t(`ui.view.${s}`)}
          </button>
        ))}
      </div>
    </fieldset>
    <label className="check">
      <input type="checkbox" checked={prefs.contrast} onChange={(e) => setPrefs({ ...prefs, contrast: e.target.checked })} />
      <span>{t('ui.view.contrast')}</span>
    </label>
    <label className="check">
      <input type="checkbox" checked={reducedMotion} onChange={(e) => setPrefs({ ...prefs, reducedMotion: e.target.checked })} />
      <span>{t('ui.view.motion')}</span>
    </label>
    <button type="button" className="btn ghost" onClick={() => setPrefs(DEFAULT_PREFS)}>{t('ui.view.reset')}</button>
    </>
  );
}
