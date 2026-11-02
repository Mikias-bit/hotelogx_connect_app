import { useEffect, useState } from 'react';
import { useApp } from './store';
import { greeting } from './utils';

export function useDashboardGreeting() {
  const timeZone = useApp(state => state.hotelProfile.timezone);
  // Keep server output and initial hydration identical; compute hotel time on mount.
  const [label, setLabel] = useState('Welcome');
  useEffect(() => {
    const refresh = () => setLabel(greeting(timeZone));
    refresh();
    const timer = window.setInterval(refresh, 60_000);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [timeZone]);
  return label;
}
