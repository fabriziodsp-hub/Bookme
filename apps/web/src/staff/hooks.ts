import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { LocalDate } from '@salon/engine';
import { api } from '../lib/api';
import type { Absence, Appointment, StaffUser, Stylist } from '../lib/types';

export interface CalendarData {
  appointments: Appointment[];
  absences: Absence[];
  stylists: Stylist[];
  counts: Record<string, number>;
  openRequests: number;
  now: { date: LocalDate; minute: number };
}

export const useMe = () =>
  useQuery({ queryKey: ['me'], queryFn: () => api<StaffUser>('/auth/me'), retry: false, staleTime: 60_000 });

export function useCalendar(from: LocalDate, days: number, stylistId?: string) {
  return useQuery({
    queryKey: ['cal', from, days, stylistId ?? 'all'],
    queryFn: () => api<CalendarData>(`/staff/calendar?from=${from}&days=${days}${stylistId ? `&stylistId=${stylistId}` : ''}`),
    placeholderData: (p) => p,
    refetchInterval: 60_000, // see new requests without reloading
  });
}

/** Active stylists with their real names – staff only (the public config has none, D-052). */
export function useStylists() {
  const today = new Date().toISOString().slice(0, 10);
  return useCalendar(today, 1).data?.stylists ?? [];
}

export function useInvalidateCalendar() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ['cal'] });
    void qc.invalidateQueries({ queryKey: ['requests'] });
  };
}
