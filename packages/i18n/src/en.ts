import type { PartialMessages } from './index.js';

/** English – prepared, partial. Missing keys fall back to German. */
export const en: PartialMessages = {
  service: {
    cut: 'Haircut',
    wash_set: 'Wash & set',
    color_root: 'Cut & colour – roots',
    color_full: 'Cut & colour – roots to ends',
    highlights: 'Highlights',
    balayage: 'Balayage',
    perm: 'Perm (curls)',
  },
  variant: { dry: 'without wash', wash: 'with wash', partial: 'top & contours', full: 'full head' },
  audience: { women: 'Women', men: 'Men' },
  weekdayShort: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
};
