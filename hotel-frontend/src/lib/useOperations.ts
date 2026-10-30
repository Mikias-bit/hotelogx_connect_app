import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api';
import { useCurrentUser } from './session';
import type { Task } from './types';
export interface Worker { id: string; name: string; phone: string; active: boolean; whatsappEnabled: boolean; language: string }
export interface OperationalData {
  today: string; timezone: string; tasks: Task[]; workers: Worker[];
  sources: { kind: string; reportDate: string | null; status: string; stale?: boolean; latestRunFailed?: boolean }[];
  vips: { itemKey: string; taskId: string; guest: string; confirmation: string; room: string; type: string; benefits: string; additionalGuests: string }[];
  housekeeping: { roomCount: number; completed: number; inProgress: number; unassigned: number; unaccepted: number; problems: number; averageMinutes: number | null; completedRooms: string[]; noCleaningRooms: string[] };
  briefing: string[];
}
export function useOperations() {
  const user = useCurrentUser();
  const [data, setData] = useState<OperationalData | null>(null), [error, setError] = useState(''), [loading, setLoading] = useState(false);
  const sequence = useRef(0);
  const load = useCallback(async () => {
    const seq = ++sequence.current, token = localStorage.getItem('token');
    if (!user?.id) return;
    setLoading(true);
    try { const value = await api.getOperations(); if (seq === sequence.current && token === localStorage.getItem('token')) { setData(value); setError(''); } }
    catch (err) { if (seq === sequence.current) setError(err instanceof Error ? err.message : 'Unable to load operational tasks'); }
    finally { if (seq === sequence.current) setLoading(false); }
  }, [user?.id]);
  useEffect(() => {
    setData(null); void load();
    const refresh = () => { void load(); }; window.addEventListener('hotelogx:operations-updated', refresh);
    const timer = window.setInterval(refresh, 60000);
    return () => { sequence.current++; window.clearInterval(timer); window.removeEventListener('hotelogx:operations-updated', refresh); };
  }, [load]);
  return { data, error, loading, load };
}
