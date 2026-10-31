import { useEffect, useRef } from "react";
import { applyPmsLiveUpdate, store } from "./store";
import { API_BASE_URL, api } from "./api";

/**
 * Hook to maintain a live SSE connection with the backend for real-time PMS and task updates.
 * Auto-reconnects and ensures zero memory leaks on unmount.
 */
export function useRealtimeSync(hotelId: string = "hotel-mercier") {
  const eventSourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;

    let isMounted = true;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    function connect() {
      if (!isMounted) return;

      const token = typeof localStorage !== "undefined" ? localStorage.getItem("token") : null;
      const url = `${API_BASE_URL}/realtime/events?hotelId=${encodeURIComponent(hotelId)}${token ? `&token=${encodeURIComponent(token)}` : ""}`;
      const es = new EventSource(url);
      eventSourceRef.current = es;

      es.addEventListener("pms:reservation_updated", (event) => {
        try {
          const data = JSON.parse(event.data);
          applyPmsLiveUpdate("pms:reservation_updated", data);
        } catch (err) {
          console.error("[Realtime] Error parsing pms:reservation_updated", err);
        }
      });

      es.addEventListener("pms:room_updated", (event) => {
        try {
          const data = JSON.parse(event.data);
          applyPmsLiveUpdate("pms:room_updated", data);
        } catch (err) {
          console.error("[Realtime] Error parsing pms:room_updated", err);
        }
      });

      es.addEventListener("pms:synced", (event) => {
        try {
          const data = JSON.parse(event.data);
          applyPmsLiveUpdate("pms:synced", data);
        } catch (err) {
          console.error("[Realtime] Error parsing pms:synced", err);
        }
      });

      es.addEventListener("room:status_changed", (event) => {
        try {
          const data = JSON.parse(event.data);
          applyPmsLiveUpdate("room:status_changed", data);
        } catch (err) {
          console.error("[Realtime] Error parsing room:status_changed", err);
        }
      });


      es.addEventListener("activity:new", (event) => {
        try {
          const data = JSON.parse(event.data);
          applyPmsLiveUpdate("activity:new", data);
        } catch (err) {
          console.error("[Realtime] Error parsing activity:new", err);
        }
      });

      es.addEventListener("whatsapp:updated", () => {
        const currentToken = localStorage.getItem('token');
        void api.getWaThreads().then(rows => {
          if (isMounted && rows && localStorage.getItem('token') === currentToken) store.setState(s => ({ ...s, waThreads: rows }));
        });
      });
      for (const event of ['readiness:updated', 'pms:synced', 'pms:room_updated', 'pms:reservation_updated']) es.addEventListener(event, () => { if (localStorage.getItem('token') === token) window.dispatchEvent(new Event('hotelogx:readiness-updated')); });
      es.addEventListener('handoffs:updated', () => { if (localStorage.getItem('token') === token) window.dispatchEvent(new Event('hotelogx:handoffs-updated')); });
      es.addEventListener('blockers:updated', () => { if (localStorage.getItem('token') === token) window.dispatchEvent(new Event('hotelogx:blockers-updated')); });
      es.addEventListener('maintenance:updated', () => {
        if (localStorage.getItem('token') !== token) return;
        window.dispatchEvent(new Event('hotelogx:maintenance-updated'));
        void Promise.all([api.getIssues(), api.getTasks()]).then(([issues, tasks]) => {
          if (!isMounted || localStorage.getItem('token') !== token) return;
          store.setState(state => ({ ...state, ...(issues ? { issues } : {}), ...(tasks ? { tasks } : {}) }));
        }).catch(() => {});
      });
      es.addEventListener('reports:updated', () => {
        const currentToken = localStorage.getItem('token');
        if (currentToken !== token) return;
        window.dispatchEvent(new Event('hotelogx:operations-updated'));
        void api.getTasks().then(rows => {
          if (isMounted && rows && localStorage.getItem('token') === currentToken) store.setState(s => ({ ...s, tasks: rows }));
        });
      });

      es.addEventListener("conversation:updated", (event) => {
        try {
          const data = JSON.parse(event.data);
          applyPmsLiveUpdate("conversation:updated", data);
        } catch (err) {
          console.error("[Realtime] Error parsing conversation:updated", err);
        }
      });

      es.onerror = () => {
        es.close();
        eventSourceRef.current = null;
        if (isMounted) {
          retryTimer = setTimeout(connect, 5000); // Reconnect after 5s
        }
      };
    }

    connect();

    return () => {
      isMounted = false;
      if (retryTimer) clearTimeout(retryTimer);
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
    };
  }, [hotelId]);
}
