import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { api } from './api';
import { store } from './store';
import { useCurrentUser } from './session';

export interface GuestHandoff {
  id: string; workKind: string; workId: string; conversationId?: string; state: string; cycle: number; version: number;
  title: string; room?: string; department: string; workStatus: string; awaitingFrontOffice: boolean;
  workCompletedAt?: string; workCompletedBy?: string; foInformedAt?: string; foInformedBy?: string;
  contactStatus: string; contactedAt?: string; contactedBy?: string; contactChannel?: string; contactNote?: string;
  resolvedAt?: string; resolvedBy?: string; resolutionNote?: string;
  history: { id: string; at: string; actor: string; action: string; note: string; cycle: number }[];
}
const Context = createContext<{ rows: GuestHandoff[]; error: string; loading: boolean; reload: () => Promise<void> }>({ rows: [], error: '', loading: true, reload: async () => {} });
export const useGuestHandoffs = () => useContext(Context);
export function GuestHandoffProvider({ children }: { children: React.ReactNode }) {
  const user = useCurrentUser();
  const [rows, setRows] = useState<GuestHandoff[]>([]), [error, setError] = useState(''), [loading, setLoading] = useState(true);
  const seq = useRef(0);
  const reload = useCallback(async () => {
    const current = ++seq.current, token = localStorage.getItem('token');
    if (!token) { setRows([]); setLoading(false); return; }
    try { const result = await api.getGuestHandoffs(); if (!result) throw new Error('Guest follow-ups unavailable'); if (current === seq.current && token === localStorage.getItem('token')) { setRows(result); setError(''); } }
    catch (err) { if (current === seq.current) setError(err instanceof Error ? err.message : 'Guest follow-ups unavailable'); }
    finally { if (current === seq.current) setLoading(false); }
  }, []);
  useEffect(() => {
    setRows([]); setLoading(true); void reload();
    const refresh = () => { void reload(); };
    const refreshWork = () => {
      refresh(); const token = localStorage.getItem('token');
      void Promise.all([api.getTasks(), api.getConversations()]).then(([tasks, conversations]) => {
        if (token === localStorage.getItem('token')) store.setState(s => ({ ...s, ...(tasks ? { tasks: tasks as typeof s.tasks } : {}), ...(conversations ? { conversations: conversations as typeof s.conversations } : {}) }));
      }).catch(() => {});
    };
    const events = ['hotelogx:maintenance-updated', 'hotelogx:operations-updated', 'focus'];
    events.forEach(e => window.addEventListener(e, refreshWork));
    window.addEventListener('hotelogx:handoffs-updated', refreshWork);
    const timer = setInterval(refreshWork, 60000);
    return () => { seq.current++; clearInterval(timer); events.forEach(e => window.removeEventListener(e, refreshWork)); window.removeEventListener('hotelogx:handoffs-updated', refreshWork); };
  }, [reload, user?.id]);
  return <Context.Provider value={{ rows, error, loading, reload }}>{children}</Context.Provider>;
}
