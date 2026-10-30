import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api';
import { useCurrentUser } from './session';
export interface ReadyRoom {
  number: string; floor?: number; arrivalTime?: string; guestStatus?: string;
  cleanliness: string; ready: boolean; releaseStatus: string; restrictions: string[];
  token: string; version: number; occupied: boolean; dnd: boolean; maintenanceBlocked: boolean; otherRestriction: string;
  canInspect: boolean; inspectedAt?: string; inspectedBy?: string; releasedAt?: string; releasedBy?: string;
  openTasks: { id: string; title: string; status: string }[];
  issues: { id: string; title: string; status: string }[];
  history: { id: string; at: string; actor: string; action: string; note: string }[];
}
export function useReadiness() {
  const user = useCurrentUser();
  const [rooms, setRooms] = useState<ReadyRoom[]>([]), [error, setError] = useState(''), [loading, setLoading] = useState(true);
  const sequence = useRef(0);
  const load = useCallback(async () => {
    if (!user?.id) return;
    const seq = ++sequence.current, token = localStorage.getItem('token'); setLoading(true);
    try { const result = await api.getRoomReadiness(); if (!result) throw new Error('Room readiness could not be loaded'); if (seq === sequence.current && token === localStorage.getItem('token')) { setRooms(result.rooms); setError(''); } }
    catch (err) { if (seq === sequence.current) setError(err instanceof Error ? err.message : 'Room readiness unavailable'); }
    finally { if (seq === sequence.current) setLoading(false); }
  }, [user?.id]);
  useEffect(() => {
    setRooms([]); void load(); const refresh = () => { void load(); };
    const events = ['hotelogx:readiness-updated', 'hotelogx:operations-updated', 'hotelogx:maintenance-updated', 'focus'];
    events.forEach(e => window.addEventListener(e, refresh)); const timer = window.setInterval(refresh, 60000);
    return () => { sequence.current++; events.forEach(e => window.removeEventListener(e, refresh)); window.clearInterval(timer); };
  }, [load]);
  return { rooms, error, loading, load };
}
