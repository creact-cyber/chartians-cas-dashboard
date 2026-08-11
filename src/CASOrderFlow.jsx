/**
 * THE CHARTIANS · CLOSING AUCTION, LIVE
 *
 * The whole page answers one question: where does the Nifty close.
 * Everything below the hero is evidence for that number.
 *
 * There is no simulated fallback anywhere in this file. If the feed is down
 * the page says so. A public page that quietly substitutes invented figures
 * is worse than one showing nothing, because the reader cannot tell.
 */

import React, {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
} from "react";
import useLiveFeed from "./useLiveFeed.js";

/* ---------------------------------------------------------------- tokens --- */

// Brand gradient stays the same violet -> magenta hexes in both themes: it's
// self-contained (always paired with white text or used as a whole gradient),
// so it needs no re-stepping. What DOES change between themes is anything
// that sits as flat text/surface directly on the page background — those get
// their own steps per mode rather than an automatic invert.
const BRAND_DEEP = "#5B21B6";
const BRAND_MID = "#9D1DFF";
const BRAND_BRIGHT = "#E619C4";
const BRAND_GRADIENT = `linear-gradient(90deg, ${BRAND_DEEP}, ${BRAND_MID}, ${BRAND_BRIGHT})`;

const LIGHT = {
  page: "#F8F5FC",
  hull: "#FFFFFF",
  slate: "#F1E9FB",
  rule: "#E2D6F5",
  champagne: "#5B21B6",
  champagneDim: "#8B7CAC",
  muted: "#7C6D96",
  paper: "#241A3D",
  // Chip/badge backgrounds: self-contained with white text, same in both modes.
  verdigris: "#0CA30C",
  oxide: "#D03B3B",
  // Flat text/stroke on the page or panel background: needs its own contrast
  // per surface, so these diverge from the chip colors in dark mode.
  positive: "#0CA30C",
  negative: "#D03B3B",
  neutralChip: "#8B7CAC",
  brandDeep: BRAND_DEEP,
  brandMid: BRAND_MID,
  brandBright: BRAND_BRIGHT,
  onAccent: "#FFFFFF",
  warnBg: "#FDECEC",
  warnText: "#8A2424",
  panelShadow: "0 1px 2px rgba(30, 19, 51, 0.04)",
};

const DARK = {
  page: "#120B1F",
  hull: "#1B1230",
  slate: "#2A1D45",
  rule: "#3C2A5C",
  champagne: "#C9A6FF",
  champagneDim: "#A996C9",
  muted: "#8F82AC",
  paper: "#EDE7F9",
  verdigris: "#0CA30C",
  oxide: "#D03B3B",
  positive: "#22D65A",
  negative: "#FF6B6B",
  neutralChip: "#8B7CAC",
  brandDeep: BRAND_DEEP,
  brandMid: BRAND_MID,
  brandBright: BRAND_BRIGHT,
  onAccent: "#FFFFFF",
  warnBg: "#3A1414",
  warnText: "#FFC2C2",
  panelShadow: "none",
};

const ThemeContext = createContext(LIGHT);

const DISPLAY = "'Archivo', ui-sans-serif, system-ui, sans-serif";
const MONO = "'IBM Plex Mono', ui-monospace, 'SF Mono', Menlo, monospace";
const FONTS =
  "https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap";

const T = (h, m) => h * 3600 + m * 60;

const PHASES = [
  { id: "REFERENCE", from: T(15, 15), to: T(15, 20), label: "Reference price", toneKey: "neutralChip" },
  { id: "ENTRY_ALL", from: T(15, 20), to: T(15, 25), label: "Market + limit", toneKey: "brandDeep" },
  { id: "ENTRY_LIMIT_ONLY", from: T(15, 25), to: T(15, 30), label: "Limit only", toneKey: "brandBright" },
  { id: "MATCHING", from: T(15, 30), to: T(15, 35), label: "Matching", toneKey: "verdigris" },
];

const RAIL_FROM = T(15, 15);
const RAIL_TO = T(15, 35);

const THEME_STORAGE_KEY = "cas-theme";

function getInitialDark() {
  if (typeof window === "undefined") return false;
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === "dark") return true;
    if (stored === "light") return false;
  } catch {
    /* localStorage can be unavailable (private mode, etc); fall through */
  }
  return !!(window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches);
}

/* ---------------------------------------------------------------- format --- */

const nf = (v, d = 2) =>
  Number(v || 0).toLocaleString("en-IN", {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  });

const qty = (v) => {
  const a = Math.abs(v || 0);
  const s = v < 0 ? "-" : "";
  if (a >= 1e7) return `${s}${(a / 1e7).toFixed(2)} Cr`;
  if (a >= 1e5) return `${s}${(a / 1e5).toFixed(2)} L`;
  if (a >= 1e3) return `${s}${(a / 1e3).toFixed(1)}k`;
  return `${s}${Math.round(a)}`;
};

const mmss = (s) => {
  const v = Math.max(0, Math.round(s));
  return `${Math.floor(v / 60)}:${String(v % 60).padStart(2, "0")}`;
};

const tone = (t, v) => (v > 0 ? t.positive : v < 0 ? t.negative : t.muted);

/* ------------------------------------------------------------ primitives --- */

function Eyebrow({ children, color }) {
  const t = useContext(ThemeContext);
  return (
    <div
      style={{
        fontFamily: DISPLAY,
        fontSize: 12,
        fontWeight: 600,
        letterSpacing: "0.16em",
        textTransform: "uppercase",
        color: color || t.champagneDim,
      }}
    >
      {children}
    </div>
  );
}

function Panel({ children, style }) {
  const t = useContext(ThemeContext);
  return (
    <div
      className="cas-panel"
      style={{
        background: t.hull,
        border: `1px solid ${t.rule}`,
        borderRadius: 10,
        boxShadow: t.panelShadow,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

function SunIcon({ size = 13 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round">
      <circle cx="12" cy="12" r="4.3" />
      <path d="M12 2.6v3M12 18.4v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2.6 12h3M18.4 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" />
    </svg>
  );
}

function MoonIcon({ size = 13 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="#fff">
      <path d="M20.8 14.5A9 9 0 1 1 9.5 3.2a7 7 0 0 0 11.3 11.3Z" />
    </svg>
  );
}

function ThemeToggle({ dark, onToggle }) {
  const t = useContext(ThemeContext);
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
      aria-pressed={dark}
      className="cas-theme-toggle"
      style={{
        width: 50,
        height: 27,
        borderRadius: 999,
        border: `1px solid ${t.rule}`,
        background: t.slate,
        position: "relative",
        cursor: "pointer",
        padding: 0,
        flexShrink: 0,
      }}
    >
      <span
        style={{
          position: "absolute",
          top: 2,
          left: dark ? 25 : 2,
          width: 21,
          height: 21,
          borderRadius: "50%",
          backgroundImage: BRAND_GRADIENT,
          transition: "left 200ms ease",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {dark ? <MoonIcon /> : <SunIcon />}
      </span>
    </button>
  );
}

/* ------------------------------------------------------------------ hero --- */

function Hero({ frame }) {
  const t = useContext(ThemeContext);
  const c = frame.closing;
  const secs = frame.secs || 0;
  const lockIn = T(15, 28) - secs;

  if (!c) {
    const toStart = RAIL_FROM - secs;
    return (
      <Panel style={{ padding: "32px 24px", textAlign: "center" }}>
        <Eyebrow>Nifty 50</Eyebrow>
        <div
          style={{
            fontFamily: MONO,
            fontSize: "clamp(40px, 10vw, 60px)",
            fontWeight: 600,
            color: t.champagne,
            marginTop: 8,
          }}
        >
          {frame.nifty ? nf(frame.nifty) : "----"}
        </div>
        <div style={{ color: t.muted, fontSize: 15, marginTop: 10 }}>
          {!frame.marketHours
            ? "Market closed. The closing number appears during the auction, 3:15 to 3:35."
            : toStart > 0
            ? `Auction opens in ${mmss(toStart)}. Reference prices lock at 3:15.`
            : "Locking reference prices. The closing number appears from 3:20."}
        </div>
      </Panel>
    );
  }

  const up = c.changePoints >= 0;

  return (
    <Panel style={{ padding: "28px 26px 24px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
        <Eyebrow>Nifty 50 will close at</Eyebrow>
        <Eyebrow color={lockIn > 0 ? t.champagneDim : t.negative}>
          {lockIn > 0 ? `book can lock in ${mmss(lockIn)}` : "book may lock at any moment"}
        </Eyebrow>
      </div>

      <div
        className="cas-hero-figure"
        style={{
          fontFamily: MONO,
          fontSize: "clamp(52px, 11vw, 92px)",
          fontWeight: 700,
          backgroundImage: BRAND_GRADIENT,
          lineHeight: 1.02,
          letterSpacing: "-0.02em",
          marginTop: 10,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {nf(c.indicative)}
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: 16,
          flexWrap: "wrap",
          marginTop: 10,
        }}
      >
        <div style={{ fontFamily: MONO, fontSize: 23, fontWeight: 600, color: tone(t, c.changePoints) }}>
          {up ? "+" : ""}
          {nf(c.changePoints)} ({up ? "+" : ""}
          {c.changePct}%)
        </div>
        <div style={{ fontFamily: MONO, fontSize: 17, color: t.paper }}>
          &plusmn; {c.bandPoints} pts
        </div>
        <div style={{ fontFamily: MONO, fontSize: 15, color: t.muted }}>
          {nf(c.low)} to {nf(c.high)}
        </div>
      </div>

      {!!frame.nifty && (
        <div style={{ fontFamily: MONO, fontSize: 13.5, color: t.muted, marginTop: 8 }}>
          Live spot {nf(frame.nifty)}
          {(() => {
            const spotGap = frame.nifty - c.indicative;
            const significant = Math.abs(spotGap) > c.bandPoints;
            return (
              <>
                {" "}
                <span style={{ color: tone(t, spotGap), fontWeight: 600 }}>
                  {spotGap >= 0 ? "+" : ""}
                  {nf(spotGap)}
                </span>{" "}
                vs the indicative close{significant ? ", exceeds the band" : ""}
              </>
            );
          })()}
        </div>
      )}

      {/* band as a physical range, so the uncertainty is felt not read */}
      <div style={{ marginTop: 16, position: "relative", height: 30 }}>
        <div
          style={{
            position: "absolute",
            top: 13,
            left: 0,
            right: 0,
            height: 3,
            background: t.slate,
          }}
        />
        <div
          style={{
            position: "absolute",
            top: 13,
            left: "26%",
            width: "48%",
            height: 3,
            background: tone(t, c.changePoints),
            opacity: 0.45,
          }}
        />
        <div
          style={{
            position: "absolute",
            top: 7,
            left: "50%",
            width: 2,
            height: 15,
            background: t.champagne,
            transform: "translateX(-1px)",
          }}
        />
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            display: "flex",
            justifyContent: "space-between",
            fontFamily: MONO,
            fontSize: 11.5,
            color: t.muted,
          }}
        >
          <span>{nf(c.low, 0)}</span>
          <span>{nf(c.high, 0)}</span>
        </div>
      </div>

      <div style={{ fontSize: 13, color: t.muted, marginTop: 12, lineHeight: 1.55 }}>
        Anchored to the 3:15 print of {nf(c.anchor)}. Band {c.bandBasis}. Covering{" "}
        {c.coverage}% of index weight. The figure is exact if the order book stops
        changing, and orders can still arrive until the book locks.
      </div>
    </Panel>
  );
}

/* ------------------------------------------------------------------ rail --- */

function Rail({ frame }) {
  const t = useContext(ThemeContext);
  const trail = frame.trail || [];
  const secs = frame.secs || 0;
  const W = 1000;
  const H = 150;
  const railY = 30;
  const railH = 20;
  const plotTop = 66;
  const plotH = 70;

  const x = (time) => 8 + ((time - RAIL_FROM) / (RAIL_TO - RAIL_FROM)) * (W - 16);

  const ext = useMemo(() => {
    const anchor = frame.closing?.anchor;
    if (!trail.length || !anchor) return null;
    const vals = trail.map((p) => p.v).concat([anchor]);
    const lo = Math.min(...vals);
    const hi = Math.max(...vals);
    const pad = Math.max(12, (hi - lo) * 0.25);
    return { lo: lo - pad, hi: hi + pad, anchor };
  }, [trail, frame.closing]);

  const y = (v) => (ext ? plotTop + plotH - ((v - ext.lo) / (ext.hi - ext.lo)) * plotH : 0);
  const path = ext
    ? trail.map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join(" ")
    : "";
  const last = trail[trail.length - 1];
  const dir = last && ext ? last.v - ext.anchor : 0;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", display: "block" }}>
      <defs>
        <pattern id="hx" width="6" height="6" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
          <line x1="0" y1="0" x2="0" y2="6" stroke={t.negative} strokeWidth="1.4" opacity="0.5" />
        </pattern>
      </defs>

      {PHASES.map((p) => {
        const on = secs >= p.from && secs < p.to;
        return (
          <g key={p.id}>
            <rect
              x={x(p.from)}
              y={railY}
              width={x(p.to) - x(p.from) - 2}
              height={railH}
              fill={on ? t[p.toneKey] : t.slate}
              rx="1.5"
            />
            <text
              x={x(p.from) + 7}
              y={railY + 14}
              fontFamily={DISPLAY}
              fontSize="11"
              fontWeight="600"
              letterSpacing="0.07em"
              fill={on ? t.onAccent : t.muted}
            >
              {p.label.toUpperCase()}
            </text>
          </g>
        );
      })}

      <rect
        x={x(T(15, 28))}
        y={railY}
        width={x(T(15, 30)) - x(T(15, 28)) - 2}
        height={railH}
        fill="url(#hx)"
      />
      <text
        x={x(T(15, 28))}
        y={railY + railH + 12}
        fontFamily={DISPLAY}
        fontSize="10"
        fontWeight="600"
        letterSpacing="0.1em"
        fill={t.negative}
      >
        RANDOM CLOSE
      </text>

      {ext && (
        <>
          <line
            x1="8"
            y1={y(ext.anchor)}
            x2={W - 8}
            y2={y(ext.anchor)}
            stroke={t.rule}
            strokeDasharray="3 4"
          />
          <text
            x={W - 8}
            y={y(ext.anchor) - 5}
            textAnchor="end"
            fontFamily={MONO}
            fontSize="10.5"
            fill={t.champagneDim}
          >
            3:15 print {nf(ext.anchor)}
          </text>
          <path d={path} fill="none" stroke={dir >= 0 ? t.positive : t.negative} strokeWidth="1.9" />
          {last && (
            <circle cx={x(last.t)} cy={y(last.v)} r="3.4" fill={dir >= 0 ? t.positive : t.negative} />
          )}
        </>
      )}

      {secs >= RAIL_FROM && secs <= RAIL_TO && (
        <line x1={x(secs)} y1={railY - 5} x2={x(secs)} y2={plotTop + plotH + 5} stroke={t.champagne} />
      )}
    </svg>
  );
}

/* --------------------------------------------------------------- candle --- */

// One OHLC candle for the whole session: open at the 3:15 print, high/low
// from the actual indicative path recorded so far, close at the live
// indicative. Same shape a 20-minute candle would take on any chart — this
// is just the CAS session viewed as a single bar instead of a line.
function CasCandle({ frame }) {
  const t = useContext(ThemeContext);
  const c = frame.closing;
  if (!c) return null;

  const trail = frame.trail || [];
  const vals = trail.map((p) => p.v).concat([c.anchor, c.indicative]);
  const open = c.anchor;
  const close = c.indicative;
  const hi = Math.max(...vals);
  const lo = Math.min(...vals);
  const up = close >= open;
  const color = up ? t.positive : t.negative;

  const range = Math.max(hi - lo, 0.01);
  const H = 34;
  const pad = 3;
  const y = (v) => pad + (1 - (v - lo) / range) * (H - pad * 2);
  const bodyTop = y(Math.max(open, close));
  const bodyBottom = y(Math.min(open, close));

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <svg width="16" height={H} viewBox={`0 0 16 ${H}`} style={{ flexShrink: 0 }}>
        <line x1="8" y1={y(hi)} x2="8" y2={y(lo)} stroke={color} strokeWidth="1.5" />
        <rect
          x="3"
          y={bodyTop}
          width="10"
          height={Math.max(bodyBottom - bodyTop, 1.5)}
          fill={color}
          rx="1.5"
        />
      </svg>
      <div style={{ fontFamily: MONO, fontSize: 10.5, color: t.muted, lineHeight: 1.6 }}>
        <div>
          O {nf(open)} &nbsp; H {nf(hi)}
        </div>
        <div>
          L {nf(lo)} &nbsp; C{" "}
          <span style={{ color, fontWeight: 700 }}>{nf(close)}</span>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ status bar --- */

function StatusBar({ frame, live, status }) {
  const t = useContext(ThemeContext);
  const chip = (label, color, bg, key) => (
    <span
      key={key}
      style={{
        fontFamily: DISPLAY,
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: "0.12em",
        padding: "4px 10px",
        borderRadius: 4,
        background: bg,
        color,
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </span>
  );

  // "live" only means our socket is delivering frames. The exchange feed can be
  // dead while frames keep arriving, so freshness is judged on tick age.
  const age = frame?.feedAgeSec;
  const dataFresh = age !== null && age !== undefined && age < 10;
  const chips = [];

  if (!live) {
    chips.push(chip(status === "stale" ? "FEED STALLED" : "FEED OFFLINE", t.onAccent, t.oxide, "l"));
  } else if (frame?.marketHours && !dataFresh) {
    chips.push(chip("EXCHANGE DATA STALE", t.onAccent, t.oxide, "l"));
  } else if (!frame?.marketHours) {
    chips.push(chip("MARKET CLOSED", t.champagne, t.slate, "l"));
  } else {
    chips.push(chip("LIVE", t.onAccent, t.verdigris, "l"));
  }
  if (frame?.segmentStatus && frame.segmentStatus !== "UNKNOWN") {
    chips.push(chip(frame.segmentStatus.replace("_", " "), t.champagne, t.slate, "s"));
  }
  if (frame?.iep) {
    chips.push(
      chip(
        `IEP ${frame.iep.confirmed ? "CONFIRMED" : "UNCONFIRMED"} ${frame.iep.movingWithFrozenVolume}/${frame.iep.sampled}`,
        t.onAccent,
        frame.iep.confirmed ? t.verdigris : t.oxide,
        "i"
      )
    );
  }

  return <div style={{ display: "flex", gap: 7, alignItems: "center", flexWrap: "wrap" }}>{chips}</div>;
}

/* ============================================================== dashboard === */

function Dashboard({ dark, onToggle }) {
  const { frame, live, status } = useLiveFeed();
  const [sortKey, setSortKey] = useState("points");
  const t = useContext(ThemeContext);

  useEffect(() => {
    const el = document.createElement("link");
    el.rel = "stylesheet";
    el.href = FONTS;
    document.head.appendChild(el);
    return () => {
      if (el.parentNode) el.parentNode.removeChild(el);
    };
  }, []);

  const stocks = frame?.stocks || [];

  const sorted = useMemo(() => {
    const a = [...stocks];
    if (sortKey === "sym") a.sort((x, y) => x.sym.localeCompare(y.sym));
    else a.sort((x, y) => Math.abs(y[sortKey] || 0) - Math.abs(x[sortKey] || 0));
    return a;
  }, [stocks, sortKey]);

  const totals = useMemo(() => {
    const b = stocks.reduce((a, s) => a + (s.buyQty || 0), 0);
    const s2 = stocks.reduce((a, s) => a + (s.sellQty || 0), 0);
    return { b, s: s2, tilt: b + s2 ? (b / (b + s2)) * 100 : 50 };
  }, [stocks]);

  const wrap = {
    background: t.page,
    color: t.paper,
    fontFamily: DISPLAY,
    minHeight: "100vh",
    padding: "clamp(14px, 3vw, 28px) clamp(14px, 4vw, 32px) 36px",
  };

  if (!frame) {
    return (
      <div style={wrap}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            flexWrap: "wrap",
            gap: 12,
          }}
        >
          <Eyebrow>The Chartians</Eyebrow>
          <ThemeToggle dark={dark} onToggle={onToggle} />
        </div>
        <div style={{ marginTop: 20, color: t.muted, fontSize: 16 }}>
          {live ? "Waiting for the first frame." : "Connecting to the live feed."}
        </div>
      </div>
    );
  }

  return (
    <div style={wrap}>
      <div
        style={{
          height: 4,
          borderRadius: 4,
          marginBottom: 16,
          backgroundImage: BRAND_GRADIENT,
        }}
      />
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-end",
          flexWrap: "wrap",
          gap: 14,
          borderBottom: `1px solid ${t.rule}`,
          paddingBottom: 14,
          marginBottom: 16,
        }}
      >
        <div>
          <Eyebrow>The Chartians</Eyebrow>
          <div
            style={{
              fontSize: "clamp(22px, 4vw, 30px)",
              fontWeight: 700,
              letterSpacing: "-0.02em",
              color: t.champagne,
              marginTop: 4,
            }}
          >
            Closing Auction, live
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 18, flexWrap: "wrap" }}>
          <StatusBar frame={frame} live={live} status={status} />
          <div style={{ textAlign: "right" }}>
            <Eyebrow>IST</Eyebrow>
            <div
              style={{
                fontFamily: MONO,
                fontSize: "clamp(20px, 3.5vw, 27px)",
                color: t.champagne,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {frame.clock}
            </div>
          </div>
          <ThemeToggle dark={dark} onToggle={onToggle} />
        </div>
      </div>

      {live && frame.marketHours && !(frame.feedAgeSec < 10) && (
        <div
          style={{
            background: t.warnBg,
            border: `1px solid ${t.negative}`,
            padding: "12px 16px",
            marginBottom: 16,
            borderRadius: 8,
            fontSize: 14,
            color: t.warnText,
          }}
        >
          The exchange feed has gone quiet
          {frame.feedAgeSec ? ` for ${Math.round(frame.feedAgeSec)}s` : ""}. Prices below
          are frozen at their last received values and are not current.
        </div>
      )}

      {!live && (
        <div
          style={{
            background: t.warnBg,
            border: `1px solid ${t.negative}`,
            padding: "12px 16px",
            marginBottom: 16,
            borderRadius: 8,
            fontSize: 14,
            color: t.warnText,
          }}
        >
          The feed has stopped. These numbers are the last received and are no longer
          updating. Nothing on this page is being simulated.
        </div>
      )}

      <div style={{ marginBottom: 16 }}>
        <Hero frame={frame} />
      </div>

      <div
        className="cas-two-col"
        style={{
          marginBottom: 16,
        }}
      >
        <Panel style={{ padding: "12px 12px 4px" }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              flexWrap: "wrap",
              gap: 10,
            }}
          >
            <Eyebrow>Auction path</Eyebrow>
            <CasCandle frame={frame} />
          </div>
          <Rail frame={frame} />
        </Panel>

        <Panel style={{ padding: 16, display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <Eyebrow>Futures, trading until 3:40</Eyebrow>
            {frame.futures ? (
              <>
                <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginTop: 6 }}>
                  <div style={{ fontFamily: MONO, fontSize: 25, color: t.paper }}>
                    {nf(frame.futures.futures)}
                  </div>
                  <div
                    style={{
                      fontFamily: MONO,
                      fontSize: 15,
                      fontWeight: 600,
                      color: tone(t, frame.futures.gapPoints),
                    }}
                  >
                    {frame.futures.gapPoints >= 0 ? "+" : ""}
                    {nf(frame.futures.gapPoints)}
                  </div>
                </div>
                <div
                  style={{
                    fontSize: 13,
                    color: frame.futures.significant ? t.champagne : t.muted,
                    marginTop: 6,
                    lineHeight: 1.5,
                  }}
                >
                  {frame.futures.read}
                  {frame.futures.significant ? ". The gap exceeds the band." : "."}
                </div>
              </>
            ) : (
              <div style={{ color: t.muted, fontSize: 13.5, marginTop: 6 }}>
                Available once the auction anchors.
              </div>
            )}
          </div>

          <div style={{ height: 1, background: t.rule }} />

          <div>
            <Eyebrow>Cash order tilt</Eyebrow>
            {!frame.anchored ? (
              <div style={{ color: t.muted, fontSize: 13.5, marginTop: 6, lineHeight: 1.5 }}>
                Meaningful only during the auction. Outside it, the book carries
                leftovers from the previous session.
              </div>
            ) : (
            <>
            <div style={{ display: "flex", height: 28, marginTop: 8, gap: 2, borderRadius: 6, overflow: "hidden" }}>
              <div
                style={{
                  width: `${totals.tilt}%`,
                  backgroundImage: `linear-gradient(90deg, ${t.brandDeep}, ${t.brandMid})`,
                  display: "flex",
                  alignItems: "center",
                  paddingLeft: 9,
                  fontFamily: MONO,
                  fontSize: 12.5,
                  color: t.onAccent,
                  fontWeight: 600,
                  transition: "width 400ms ease",
                }}
              >
                {totals.tilt.toFixed(0)}%
              </div>
              <div
                style={{
                  width: `${100 - totals.tilt}%`,
                  background: t.brandBright,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "flex-end",
                  paddingRight: 9,
                  fontFamily: MONO,
                  fontSize: 12.5,
                  color: t.onAccent,
                  fontWeight: 600,
                  transition: "width 400ms ease",
                }}
              >
                {(100 - totals.tilt).toFixed(0)}%
              </div>
            </div>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                fontFamily: MONO,
                fontSize: 12,
                color: t.muted,
                marginTop: 6,
              }}
            >
              <span>buy {qty(totals.b)}</span>
              <span>sell {qty(totals.s)}</span>
            </div>
            </>
            )}
          </div>
        </Panel>
      </div>

      <Panel style={{ padding: "16px 18px 10px" }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            gap: 12,
            marginBottom: 12,
          }}
        >
          <Eyebrow>
            {frame.anchored ? "Where the close is coming from" : "Last traded, awaiting the auction"}
          </Eyebrow>
          <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
            {[
              ["points", "Index impact"],
              ["imbalance", "Imbalance"],
              ["pct", "Move"],
              ["sym", "A to Z"],
            ].map(([k, l]) => (
              <button
                key={k}
                className="cas-sort-btn"
                onClick={() => setSortKey(k)}
                style={{
                  fontFamily: DISPLAY,
                  fontSize: 12,
                  fontWeight: 600,
                  padding: "6px 12px",
                  borderRadius: 6,
                  cursor: "pointer",
                  background: sortKey === k ? BRAND_GRADIENT : "transparent",
                  color: sortKey === k ? t.onAccent : t.muted,
                  border: `1px solid ${sortKey === k ? "transparent" : t.rule}`,
                }}
              >
                {l}
              </button>
            ))}
          </div>
        </div>

        <div className="cas-table-scroll" style={{ overflowX: "auto", opacity: frame.anchored ? 1 : 0.55 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 640 }}>
            <thead>
              <tr>
                {[
                  ["Stock", "left"],
                  [frame.anchored ? "3:15 ref" : "Prev close", "right"],
                  [frame.anchored ? "Indicative" : "Last price", "right"],
                  ["Move", "right"],
                  ["Buy less sell", "right"],
                  ["Index pts", "right"],
                ].map(([h, a]) => (
                  <th
                    key={h}
                    style={{
                      textAlign: a,
                      fontSize: 11,
                      fontWeight: 600,
                      letterSpacing: "0.1em",
                      textTransform: "uppercase",
                      color: t.champagneDim,
                      padding: "0 10px 9px",
                      borderBottom: `1px solid ${t.rule}`,
                      whiteSpace: "nowrap",
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map((s) => (
                <tr key={s.sym} className="cas-row" style={{ borderBottom: `1px solid ${t.rule}` }}>
                  <td
                    style={{
                      padding: "9px 10px",
                      fontFamily: MONO,
                      fontSize: 13.5,
                      whiteSpace: "nowrap",
                    }}
                  >
                    {s.sym}
                    <span style={{ color: t.muted, fontSize: 11, marginLeft: 6 }}>
                      {s.weight}%
                    </span>
                  </td>
                  <td
                    style={{
                      padding: "9px 10px",
                      textAlign: "right",
                      fontFamily: MONO,
                      fontSize: 13.5,
                      color: t.muted,
                    }}
                  >
                    {nf(s.ref)}
                  </td>
                  <td
                    style={{
                      padding: "9px 10px",
                      textAlign: "right",
                      fontFamily: MONO,
                      fontSize: 13.5,
                      fontWeight: 600,
                      color: t.champagne,
                    }}
                  >
                    {nf(s.iep)}
                  </td>
                  <td
                    style={{
                      padding: "9px 10px",
                      textAlign: "right",
                      fontFamily: MONO,
                      fontSize: 13.5,
                      color: tone(t, s.pct),
                    }}
                  >
                    {s.pct >= 0 ? "+" : ""}
                    {Number(s.pct).toFixed(2)}%
                  </td>
                  <td
                    style={{
                      padding: "9px 10px",
                      textAlign: "right",
                      fontFamily: MONO,
                      fontSize: 13.5,
                      color: tone(t, s.imbalance),
                    }}
                  >
                    {s.imbalance >= 0 ? "+" : ""}
                    {qty(s.imbalance)}
                  </td>
                  <td
                    style={{
                      padding: "9px 10px",
                      textAlign: "right",
                      fontFamily: MONO,
                      fontSize: 13.5,
                      fontWeight: 600,
                      color: tone(t, s.points),
                    }}
                  >
                    {s.points >= 0 ? "+" : ""}
                    {Number(s.points).toFixed(1)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <div
        style={{
          marginTop: 16,
          paddingTop: 14,
          borderTop: `1px solid ${t.rule}`,
          fontSize: 12.5,
          color: t.muted,
          lineHeight: 1.6,
        }}
      >
        Indicative figures derived from a broker data feed, not the exchange&apos;s official
        dissemination. Market data only. Nothing here is investment advice or a
        recommendation to buy or sell any security.
        <br />
        The Chartians Pvt Ltd &middot; SEBI Research Analyst INH000024231 &middot; BSE
        Enlistment 6874
      </div>
    </div>
  );
}

export default function CASOrderFlow() {
  const [dark, setDark] = useState(getInitialDark);

  useLayoutEffect(() => {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, dark ? "dark" : "light");
    } catch {
      /* localStorage can be unavailable; the toggle still works for this visit */
    }
  }, [dark]);

  return (
    <ThemeContext.Provider value={dark ? DARK : LIGHT}>
      <Dashboard dark={dark} onToggle={() => setDark((d) => !d)} />
    </ThemeContext.Provider>
  );
}
