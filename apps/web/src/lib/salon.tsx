import { useQuery } from '@tanstack/react-query';
import { addDays, type LocalDate, type Minute } from '@salon/engine';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from './api';
import type { SalonData } from './types';

const Ctx = createContext<SalonData | null>(null);

export function useSalonQuery(slug: string) {
  return useQuery({ queryKey: ['salon', slug], queryFn: () => api<SalonData>(`/s/${slug}/config`), staleTime: 60_000 });
}

export function SalonProvider({ value, children }: { value: SalonData; children: ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSalon(): SalonData {
  const s = useContext(Ctx);
  if (!s) throw new Error('useSalon outside SalonProvider');
  return s;
}

/**
 * Salon wall-clock "now" that keeps running: the server's time at load (correct time zone, frozen in tests)
 * plus the time elapsed in the browser since then. Re-renders every 30 s.
 */
export function useLiveNow(): { date: LocalDate; minute: Minute } {
  const salon = useSalon();
  const base = useMemo(() => ({ ...salon.now, at: Date.now() }), [salon.now]);
  const [tick, setTick] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setTick(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);
  const total = base.minute + Math.floor(Math.max(0, tick - base.at) / 60_000);
  return { date: addDays(base.date, Math.floor(total / 1440)), minute: total % 1440 };
}
