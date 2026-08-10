/**
 * useLiveFeed
 *
 * Connects the dashboard to the Railway backend and hands back the latest
 * frame, plus an honest connection state.
 *
 * DESIGN NOTE, and this one matters for a public page:
 * when the socket is down, this returns live=false and NO data. It never
 * silently falls back to simulated numbers. A page showing invented figures
 * that look real is worse than a page showing nothing, because the reader
 * cannot tell the difference. The dashboard must render a visible "feed
 * offline" state rather than pretend.
 *
 * Usage:
 *   const { frame, live, status, lastUpdate } = useLiveFeed();
 */

import { useCallback, useEffect, useRef, useState } from "react";

// Set VITE_FEED_URL in Vercel. Falls back to the Railway domain.
const FEED_URL =
  import.meta.env.VITE_FEED_URL ||
  "wss://web-production-07a55.up.railway.app/ws";

const STALE_MS = 8000; // no frame for this long means the feed is dead

export default function useLiveFeed() {
  const [frame, setFrame] = useState(null);
  const [status, setStatus] = useState("connecting");
  const [lastUpdate, setLastUpdate] = useState(0);
  // Forces a re-render on a clock, independent of whether new frames arrive,
  // so staleness gets re-checked even if the socket dies silently (no close
  // event) instead of freezing the page on a falsely-green "LIVE" badge.
  const [, forceTick] = useState(0);

  const wsRef = useRef(null);
  const retryRef = useRef(0);
  const timerRef = useRef(null);
  const closedRef = useRef(false);

  const connect = useCallback(() => {
    if (closedRef.current) return;

    let ws;
    try {
      ws = new WebSocket(FEED_URL);
    } catch {
      setStatus("error");
      scheduleRetry();
      return;
    }

    wsRef.current = ws;
    setStatus(retryRef.current === 0 ? "connecting" : "reconnecting");

    ws.onopen = () => {
      retryRef.current = 0;
      setStatus("live");
      // The backend reads from the socket to keep it honest, so send a ping.
      try {
        ws.send("hello");
      } catch {
        /* ignore */
      }
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        setFrame(data);
        setLastUpdate(Date.now());
        setStatus("live");
      } catch {
        /* a malformed frame is not worth tearing the socket down for */
      }
    };

    ws.onerror = () => setStatus("error");

    ws.onclose = () => {
      if (closedRef.current) return;
      setStatus("offline");
      scheduleRetry();
    };

    function scheduleRetry() {
      retryRef.current += 1;
      const delay = Math.min(1000 * 2 ** retryRef.current, 20000);
      clearTimeout(timerRef.current);
      timerRef.current = setTimeout(connect, delay);
    }
  }, []);

  useEffect(() => {
    closedRef.current = false;
    connect();

    // Browsers suspend sockets on backgrounded tabs. Reconnect on return,
    // otherwise someone who switches away at 3:20 comes back to a frozen page
    // at 3:28 and believes the stale number.
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        const ws = wsRef.current;
        if (!ws || ws.readyState > 1) connect();
      }
    };
    document.addEventListener("visibilitychange", onVisible);

    const staleCheck = setInterval(() => forceTick((x) => x + 1), 1000);

    return () => {
      closedRef.current = true;
      clearTimeout(timerRef.current);
      clearInterval(staleCheck);
      document.removeEventListener("visibilitychange", onVisible);
      try {
        wsRef.current?.close();
      } catch {
        /* ignore */
      }
    };
  }, [connect]);

  // Treat a silent socket as offline even if it never formally closed.
  const stale = lastUpdate > 0 && Date.now() - lastUpdate > STALE_MS;
  const live = status === "live" && !stale && frame !== null;

  return {
    frame,
    live,
    status: stale ? "stale" : status,
    lastUpdate,
  };
}
