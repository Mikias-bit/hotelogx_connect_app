import { useEffect, useRef } from "react";
import { applyPmsLiveUpdate } from "./store";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:5000/api";

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
