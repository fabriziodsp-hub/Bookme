import type { PartialMessages } from './index.js';

/** Italian – prepared, partial. Missing keys fall back to German. */
export const it: PartialMessages = {
  service: {
    cut: 'Taglio',
    wash_set: 'Lavaggio e messa in piega',
    color_root: 'Taglio e colore – ricrescita',
    color_full: 'Taglio e colore – dalle radici alle punte',
    highlights: 'Colpi di sole',
    balayage: 'Balayage',
    perm: 'Permanente (ricci)',
  },
  variant: { dry: 'senza lavaggio', wash: 'con lavaggio', partial: 'parte superiore e contorni', full: 'testa intera' },
  audience: { women: 'Donna', men: 'Uomo' },
  weekdayShort: ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom'],
};
