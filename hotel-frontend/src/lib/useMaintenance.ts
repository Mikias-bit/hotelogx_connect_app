import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api';
import { useCurrentUser } from './session';
import type { MaintenanceData } from './types';

export function useMaintenance() {
  const user = useCurrentUser();
  const [data, setData] = useState<MaintenanceData | null>(null);
  const [error, setError] = useState(''), [loading, setLoading] = useState(false);
  const sequence = useRef(0);
  const load = useCallback(async () => {
    if (!user?.id || !['manager', 'maintenance'].includes(user.role)) return;
    const id = ++sequence.current;
    setLoading(true);
    try {
      const value = await api.getMaintenance();
      if (!value) throw new Error('Unable to load maintenance records.');
      if (id === sequence.current) { setData(value); setError(''); }
    } catch (err) { if (id === sequence.current) setError(err instanceof Error ? err.message : 'Unable to load maintenance records.'); }
    finally { if (id === sequence.current) setLoading(false); }
  }, [user?.id, user?.role]);
  useEffect(() => {
    setData(null); void load();
    const refresh = () => { void load(); };
    window.addEventListener('hotelogx:maintenance-updated', refresh);
    window.addEventListener('focus', refresh);
    const timer = window.setInterval(refresh, 60000);
    return () => { sequence.current++; clearInterval(timer); window.removeEventListener('hotelogx:maintenance-updated', refresh); window.removeEventListener('focus', refresh); };
  }, [load]);
  return { data, loading, error, load };
}
