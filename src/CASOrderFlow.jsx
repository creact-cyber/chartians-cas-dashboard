import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";

/* ============================================================================
   THE CHARTIANS  ·  CAS LIVE ORDER FLOW
   NSE Closing Auction Session, 15:15 to 15:35 IST

   DATA MODE
   ---------
   This build ships with a deterministic auction simulator so the interface can
   be reviewed outside market hours. Every value the UI renders passes through
   buildFrame(), which returns the exact shape your backend should push over
   WebSocket. To go live, replace runSimulationTick() with your socket handler
   and keep buildFrame()'s contract identical.

   FRAME CONTRACT (what the backend must send, roughly 2 to 4 times a second):
   {
     ts: 1754654400000,          // epoch ms, exchange clock
     phase: "ENTRY_LIMIT_ONLY",  // derived server side from segmentStatus + clock
     index: { indicative, ref, futures, futBasis },
     stocks: [{
       sym, weight, ref, iep, matchedQty, buyQty, sellQty, mktImbalance
     }]
   }
   ========================================================================== */

/* ---------------------------------------------------------------- tokens --- */

const C = {
  abyss: "#080F1C",
  hull: "#0E1728",
  slate: "#16233A",
  rule: "#22334F",
  champagne: "#E4D9B4",
  champagneDim: "#8C876F",
  verdigris: "#3FA89B",
  verdigrisDim: "#1F4F4A",
  oxide: "#BF4436",
  oxideDim: "#5C241E",
  muted: "#5A6B82",
  paper: "#C9D4E4",
};

const FONT_LINK =
  "https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap";

const DISPLAY = "'Archivo', ui-sans-serif, system-ui, sans-serif";
const MONO = "'IBM Plex Mono', ui-monospace, 'SF Mono', Menlo, monospace";

/* ------------------------------------------------------------ auction map --- */

const T = (h, m, s = 0) => h * 3600 + m * 60 + s;

const PHASES = [
  {
    id: "REFERENCE",
    from: T(15, 15),
    to: T(15, 20),
    label: "Reference price",
    detail: "VWAP of 15:00 to 15:15 locks in. Continuous trading has stopped.",
    tone: C.muted,
  },
  {
    id: "ENTRY_ALL",
    from: T(15, 20),
    to: T(15, 25),
    label: "Market + limit entry",
    detail: "Both order types can be placed, modified or cancelled.",
    tone: C.champagne,
  },
  {
    id: "ENTRY_LIMIT_ONLY",
    from: T(15, 25),
    to: T(15, 30),
    label: "Limit orders only",
    detail: "Market orders are frozen. Session ends at a random point after 15:28.",
    tone: C.oxide,
  },
  {
    id: "MATCHING",
    from: T(15, 30),
    to: T(15, 35),
    label: "Matching",
    detail: "Equilibrium price is struck. Everyone fills at that one price.",
    tone: C.verdigris,
  },
];

const RAIL_FROM = T(15, 15);
const RAIL_TO = T(15, 35);
const RANDOM_FROM = T(15, 28);
const RANDOM_TO = T(15, 30);
const DERIV_TO = T(15, 40);

const phaseAt = (t) =>
  PHASES.find((p) => t >= p.from && t < p.to) || (t < RAIL_FROM ? PHASES[0] : PHASES[3]);

/* --------------------------------------------------------------- universe --- */
/* Indicative Nifty 50 weights. Replace with the live NSE weight file in prod. */

const UNIVERSE = [
  { sym: "HDFCBANK", weight: 13.2, base: 1690.4, beta: 0.9 },
  { sym: "ICICIBANK", weight: 8.9, base: 1310.2, beta: 1.0 },
  { sym: "RELIANCE", weight: 8.4, base: 1425.6, beta: 1.1 },
  { sym: "INFY", weight: 5.1, base: 1580.3, beta: 1.2 },
  { sym: "BHARTIARTL", weight: 4.6, base: 1920.8, beta: 0.8 },
  { sym: "LT", weight: 4.0, base: 3650.5, beta: 1.1 },
  { sym: "TCS", weight: 3.6, base: 3180.9, beta: 1.0 },
  { sym: "ITC", weight: 3.4, base: 415.7, beta: 0.7 },
  { sym: "AXISBANK", weight: 3.1, base: 1155.4, beta: 1.2 },
  { sym: "KOTAKBANK", weight: 2.9, base: 1985.1, beta: 1.0 },
  { sym: "SBIN", weight: 2.8, base: 840.3, beta: 1.3 },
  { sym: "M&M", weight: 2.5, base: 3120.6, beta: 1.2 },
  { sym: "HINDUNILVR", weight: 2.2, base: 2380.4, beta: 0.6 },
  { sym: "BAJFINANCE", weight: 2.1, base: 940.2, beta: 1.4 },
  { sym: "NTPC", weight: 1.8, base: 335.8, beta: 0.9 },
  { sym: "MARUTI", weight: 1.7, base: 12850.0, beta: 1.0 },
  { sym: "HCLTECH", weight: 1.6, base: 1620.5, beta: 1.1 },
  { sym: "SUNPHARMA", weight: 1.5, base: 1680.7, beta: 0.8 },
  { sym: "TATAMOTORS", weight: 1.3, base: 690.4, beta: 1.5 },
  { sym: "TITAN", weight: 1.2, base: 3540.2, beta: 1.1 },
];

const WEIGHT_SUM = UNIVERSE.reduce((a, s) => a + s.weight, 0);
const INDEX_AT_315 = 24463.45;
const BAND = 0.03;

/* -------------------------------------------------------------- simulator --- */
/* Seeded so a demo replays identically. Mersenne-lite LCG is plenty here. */

function makeRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function initState(seed) {
  const rng = makeRng(seed);
  return {
    rng,
    stocks: UNIVERSE.map((u) => {
      // Institutional intent, fixed for the session. This is the hidden variable
      // the dashboard is trying to make visible.
      const intent = (rng() - 0.42) * 2;
      return {
        ...u,
        ref: u.base,
        drift: 0,
        intent,
        buyQty: Math.round((60000 + rng() * 240000) * (u.weight / 4)),
        sellQty: Math.round((60000 + rng() * 240000) * (u.weight / 4)),
        mktImbalance: 0,
      };
    }),
    futDrift: -0.0011,
  };
}

function runSimulationTick(st, t) {
  const { rng } = st;
  const ph = phaseAt(t);
  const progress = Math.min(1, Math.max(0, (t - T(15, 20)) / (T(15, 30) - T(15, 20))));

  st.stocks.forEach((s) => {
    if (ph.id === "REFERENCE") {
      s.drift = 0;
      return;
    }
    if (ph.id === "MATCHING") return; // book is frozen, price is struck

    // Order flow keeps arriving. Weight-heavy names attract the size.
    const flowScale = 1 + s.weight / 3;
    const buyIn = (rng() * 26000 + 4000) * flowScale * (1 + Math.max(0, s.intent));
    const sellIn = (rng() * 26000 + 4000) * flowScale * (1 + Math.max(0, -s.intent));
    s.buyQty += Math.round(buyIn);
    s.sellQty += Math.round(sellIn);

    // Market-order imbalance only accumulates while market orders are allowed.
    if (ph.id === "ENTRY_ALL") {
      s.mktImbalance += Math.round((rng() - 0.5 + s.intent * 0.35) * 18000 * flowScale);
    }

    // Late size. Institutions load the last stretch, which is the whole story.
    const lateKick = progress > 0.72 ? (rng() - 0.5 + s.intent * 0.9) * 0.0016 : 0;
    const noise = (rng() - 0.5) * 0.0007 * s.beta;
    s.drift += s.intent * 0.00055 * s.beta + noise + lateKick;
    s.drift = Math.max(-BAND * 0.97, Math.min(BAND * 0.97, s.drift));
  });

  st.futDrift += (rng() - 0.5) * 0.0004;
  return st;
}

function buildFrame(st, t) {
  const ph = phaseAt(t);

  const stocks = st.stocks.map((s) => {
    const iep = +(s.ref * (1 + s.drift)).toFixed(2);
    const matchedQty = Math.round(Math.min(s.buyQty, s.sellQty) * 0.82);
    return {
      sym: s.sym,
      weight: s.weight,
      ref: s.ref,
      iep,
      pct: (iep / s.ref - 1) * 100,
      matchedQty,
      buyQty: s.buyQty,
      sellQty: s.sellQty,
      imbalance: s.buyQty - s.sellQty,
      mktImbalance: s.mktImbalance,
      points: ((s.weight / 100) * (iep / s.ref - 1) * INDEX_AT_315 * 100) / WEIGHT_SUM,
    };
  });

  const points = stocks.reduce((a, s) => a + s.points, 0);
  const indicative = INDEX_AT_315 + points;
  const futures = INDEX_AT_315 * (1 + st.futDrift);

  return {
    ts: Date.now(),
    phase: ph.id,
    index: {
      indicative,
      ref: INDEX_AT_315,
      futures,
      futBasis: futures - indicative,
    },
    stocks,
  };
}

/* ----------------------------------------------------------------- format --- */

const nf = (v, d = 2) =>
  v.toLocaleString("en-IN", { minimumFractionDigits: d, maximumFractionDigits: d });

const qty = (v) => {
  const a = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  if (a >= 1e7) return `${sign}${(a / 1e7).toFixed(2)} Cr`;
  if (a >= 1e5) return `${sign}${(a / 1e5).toFixed(2)} L`;
  if (a >= 1e3) return `${sign}${(a / 1e3).toFixed(1)}k`;
  return `${sign}${Math.round(a)}`;
};

const clock = (t) => {
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = Math.floor(t % 60);
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
};

const toneFor = (v) => (v > 0 ? C.verdigris : v < 0 ? C.oxide : C.muted);

/* ------------------------------------------------------------- primitives --- */

function Eyebrow({ children, tone = C.champagneDim }) {
  return (
    <div
      style={{
        fontFamily: DISPLAY,
        fontSize: 10,
        fontWeight: 600,
        letterSpacing: "0.16em",
        textTransform: "uppercase",
        color: tone,
      }}
    >
      {children}
    </div>
  );
}

function Panel({ children, style }) {
  return (
    <div
      style={{
        background: C.hull,
        border: `1px solid ${C.rule}`,
        borderRadius: 3,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

/* -------------------------------------------------------- SIGNATURE: rail --- */
/* The auction rail. Phase structure and the indicative index path share one
   horizontal ruler, so you read "where we are" and "where it went" as a single
   gesture. The hatched zone is the random closure window, which is the only
   part of the session where you genuinely cannot know when the book shuts. */

function AuctionRail({ t, trail, reduced }) {
  const W = 1000;
  const H = 172;
  const padL = 8;
  const padR = 8;
  const railY = 34;
  const railH = 22;
  const plotTop = 74;
  const plotH = 76;

  const x = (time) =>
    padL + ((time - RAIL_FROM) / (RAIL_TO - RAIL_FROM)) * (W - padL - padR);

  const ext = useMemo(() => {
    if (trail.length < 2) return { lo: INDEX_AT_315 - 60, hi: INDEX_AT_315 + 60 };
    const vals = trail.map((p) => p.v).concat([INDEX_AT_315]);
    const lo = Math.min(...vals);
    const hi = Math.max(...vals);
    const pad = Math.max(18, (hi - lo) * 0.22);
    return { lo: lo - pad, hi: hi + pad };
  }, [trail]);

  const y = (v) => plotTop + plotH - ((v - ext.lo) / (ext.hi - ext.lo)) * plotH;

  const path = useMemo(() => {
    if (!trail.length) return "";
    return trail.map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join(" ");
  }, [trail, ext]);

  const last = trail[trail.length - 1];
  const dir = last ? last.v - INDEX_AT_315 : 0;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      style={{ width: "100%", height: "auto", display: "block" }}
      role="img"
      aria-label="Auction phase rail with indicative index path"
    >
      <defs>
        <pattern id="hatch" width="6" height="6" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
          <line x1="0" y1="0" x2="0" y2="6" stroke={C.oxide} strokeWidth="1.4" opacity="0.5" />
        </pattern>
        <linearGradient id="fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={dir >= 0 ? C.verdigris : C.oxide} stopOpacity="0.26" />
          <stop offset="100%" stopColor={dir >= 0 ? C.verdigris : C.oxide} stopOpacity="0" />
        </linearGradient>
      </defs>

      {/* phase blocks */}
      {PHASES.map((p) => {
        const active = t >= p.from && t < p.to;
        return (
          <g key={p.id}>
            <rect
              x={x(p.from)}
              y={railY}
              width={x(p.to) - x(p.from) - 2}
              height={railH}
              fill={active ? p.tone : C.slate}
              opacity={active ? 0.9 : 1}
              rx="1.5"
            />
            <text
              x={x(p.from) + 8}
              y={railY + 15}
              fontFamily={DISPLAY}
              fontSize="10.5"
              fontWeight="600"
              letterSpacing="0.08em"
              fill={active ? C.abyss : C.muted}
            >
              {p.label.toUpperCase()}
            </text>
            <text
              x={x(p.from)}
              y={railY - 9}
              fontFamily={MONO}
              fontSize="10"
              fill={active ? p.tone : C.muted}
            >
              {clock(p.from).slice(0, 4)}
            </text>
          </g>
        );
      })}
      <text x={x(RAIL_TO) - 26} y={railY - 9} fontFamily={MONO} fontSize="10" fill={C.muted}>
        3:35
      </text>

      {/* random closure window */}
      <rect
        x={x(RANDOM_FROM)}
        y={railY}
        width={x(RANDOM_TO) - x(RANDOM_FROM) - 2}
        height={railH}
        fill="url(#hatch)"
      />
      <text
        x={x(RANDOM_FROM) + 2}
        y={railY + railH + 12}
        fontFamily={DISPLAY}
        fontSize="9"
        fontWeight="600"
        letterSpacing="0.1em"
        fill={C.oxide}
      >
        RANDOM CLOSE
      </text>

      {/* index path */}
      <line
        x1={padL}
        y1={y(INDEX_AT_315)}
        x2={W - padR}
        y2={y(INDEX_AT_315)}
        stroke={C.rule}
        strokeWidth="1"
        strokeDasharray="3 4"
      />
      <text
        x={W - padR}
        y={y(INDEX_AT_315) - 5}
        textAnchor="end"
        fontFamily={MONO}
        fontSize="9.5"
        fill={C.champagneDim}
      >
        3:15 print {nf(INDEX_AT_315)}
      </text>

      {path && (
        <>
          <path
            d={`${path} L${x(last.t)},${y(INDEX_AT_315)} L${x(trail[0].t)},${y(INDEX_AT_315)} Z`}
            fill="url(#fill)"
          />
          <path d={path} fill="none" stroke={dir >= 0 ? C.verdigris : C.oxide} strokeWidth="1.9" />
          <circle
            cx={x(last.t)}
            cy={y(last.v)}
            r="3.4"
            fill={dir >= 0 ? C.verdigris : C.oxide}
            stroke={C.abyss}
            strokeWidth="1.4"
          />
          {!reduced && (
            <circle cx={x(last.t)} cy={y(last.v)} r="3.4" fill="none" stroke={dir >= 0 ? C.verdigris : C.oxide}>
              <animate attributeName="r" values="3.4;10;3.4" dur="2.2s" repeatCount="indefinite" />
              <animate attributeName="opacity" values="0.7;0;0.7" dur="2.2s" repeatCount="indefinite" />
            </circle>
          )}
        </>
      )}

      {/* playhead */}
      <line x1={x(t)} y1={railY - 6} x2={x(t)} y2={plotTop + plotH + 6} stroke={C.champagne} strokeWidth="1" />
      <polygon
        points={`${x(t) - 4},${railY - 6} ${x(t) + 4},${railY - 6} ${x(t)},${railY}`}
        fill={C.champagne}
      />
    </svg>
  );
}

/* ---------------------------------------------------- per stock band strip --- */
/* Each row carries its own +/- 3% band. The tick is the IEP, the bar under it
   is the buy minus sell imbalance. You read direction and conviction together. */

function BandStrip({ pct, imbalance, maxImb }) {
  const W = 128;
  const H = 22;
  const mid = W / 2;
  const px = mid + (Math.max(-3, Math.min(3, pct)) / 3) * (mid - 4);
  const imbW = maxImb ? (Math.abs(imbalance) / maxImb) * (mid - 4) : 0;
  const tone = toneFor(pct);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} style={{ display: "block" }}>
      <rect x="0" y="4" width={W} height="7" fill={C.slate} rx="1" />
      <line x1={mid} y1="2" x2={mid} y2="13" stroke={C.champagneDim} strokeWidth="1" />
      <rect
        x={Math.min(mid, px)}
        y="4"
        width={Math.abs(px - mid)}
        height="7"
        fill={tone}
        opacity="0.45"
      />
      <rect x={px - 1} y="1.5" width="2" height="12" fill={tone} />
      <rect
        x={imbalance >= 0 ? mid : mid - imbW}
        y="15"
        width={imbW}
        height="4"
        fill={toneFor(imbalance)}
        opacity="0.85"
        rx="0.5"
      />
    </svg>
  );
}

/* ------------------------------------------------------------ contribution --- */

function Waterfall({ stocks }) {
  const ranked = useMemo(() => {
    const sorted = [...stocks].sort((a, b) => b.points - a.points);
    return [...sorted.slice(0, 5), null, ...sorted.slice(-5)];
  }, [stocks]);

  const max = Math.max(...stocks.map((s) => Math.abs(s.points)), 0.5);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
      {ranked.map((s, i) =>
        s === null ? (
          <div key="gap" style={{ height: 1, background: C.rule, margin: "5px 0" }} />
        ) : (
          <div key={s.sym} style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div
              style={{
                fontFamily: MONO,
                fontSize: 10.5,
                color: C.paper,
                width: 84,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {s.sym}
            </div>
            <div style={{ flex: 1, position: "relative", height: 11 }}>
              <div
                style={{
                  position: "absolute",
                  left: "50%",
                  top: 0,
                  bottom: 0,
                  width: 1,
                  background: C.rule,
                }}
              />
              <div
                style={{
                  position: "absolute",
                  top: 1,
                  height: 9,
                  left: s.points >= 0 ? "50%" : `calc(50% - ${(Math.abs(s.points) / max) * 50}%)`,
                  width: `${(Math.abs(s.points) / max) * 50}%`,
                  background: toneFor(s.points),
                  opacity: 0.82,
                  transition: "width 320ms ease, left 320ms ease",
                }}
              />
            </div>
            <div
              style={{
                fontFamily: MONO,
                fontSize: 10.5,
                fontWeight: 500,
                color: toneFor(s.points),
                width: 50,
                textAlign: "right",
              }}
            >
              {s.points >= 0 ? "+" : ""}
              {s.points.toFixed(1)}
            </div>
          </div>
        )
      )}
    </div>
  );
}

/* =============================================================== dashboard === */

export default function CASOrderFlow() {
  const [t, setT] = useState(T(15, 15));
  const [running, setRunning] = useState(true);
  const [speed, setSpeed] = useState(12);
  const [sortKey, setSortKey] = useState("points");
  const [frame, setFrame] = useState(null);
  const [trail, setTrail] = useState([]);

  const stateRef = useRef(initState(20260808));
  const reduced =
    typeof window !== "undefined" &&
    window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  useEffect(() => {
    const el = document.createElement("link");
    el.rel = "stylesheet";
    el.href = FONT_LINK;
    document.head.appendChild(el);
    return () => {
      if (el.parentNode) el.parentNode.removeChild(el);
    };
  }, []);

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => {
      setT((prev) => {
        const next = prev + speed / 4;
        if (next >= RAIL_TO) {
          setRunning(false);
          return RAIL_TO;
        }
        return next;
      });
    }, 250);
    return () => clearInterval(id);
  }, [running, speed]);

  useEffect(() => {
    runSimulationTick(stateRef.current, t);
    const f = buildFrame(stateRef.current, t);
    setFrame(f);
    setTrail((prev) => {
      if (prev.length && t <= prev[prev.length - 1].t) return prev;
      return [...prev, { t, v: f.index.indicative }].slice(-420);
    });
  }, [t]);

  const reset = useCallback(() => {
    stateRef.current = initState(Math.floor(Math.random() * 1e9));
    setTrail([]);
    setT(T(15, 15));
    setRunning(true);
  }, []);

  const ph = phaseAt(t);
  const stocks = frame?.stocks ?? [];

  const sorted = useMemo(() => {
    const arr = [...stocks];
    const dir = sortKey === "sym" ? 1 : -1;
    arr.sort((a, b) => {
      if (sortKey === "sym") return a.sym.localeCompare(b.sym);
      if (sortKey === "imbalance") return (Math.abs(b.imbalance) - Math.abs(a.imbalance)) * 1;
      return (b[sortKey] - a[sortKey]) * (dir > 0 ? 1 : 1);
    });
    return arr;
  }, [stocks, sortKey]);

  const maxImb = useMemo(
    () => Math.max(...stocks.map((s) => Math.abs(s.imbalance)), 1),
    [stocks]
  );

  const totals = useMemo(() => {
    const buy = stocks.reduce((a, s) => a + s.buyQty, 0);
    const sell = stocks.reduce((a, s) => a + s.sellQty, 0);
    const matched = stocks.reduce((a, s) => a + s.matchedQty, 0);
    return { buy, sell, matched, tilt: buy + sell ? (buy / (buy + sell)) * 100 : 50 };
  }, [stocks]);

  if (!frame) return null;

  const delta = frame.index.indicative - frame.index.ref;
  const deltaPct = (delta / frame.index.ref) * 100;
  const tone = toneFor(delta);

  const secsLeft = Math.max(0, Math.round(T(15, 30) - t));
  const inRandom = t >= RANDOM_FROM && t < RANDOM_TO;

  return (
    <div
      style={{
        background: C.abyss,
        color: C.paper,
        fontFamily: DISPLAY,
        minHeight: "100%",
        padding: "18px 20px 26px",
      }}
    >
      {/* ------------------------------------------------------------ header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-end",
          flexWrap: "wrap",
          gap: 12,
          borderBottom: `1px solid ${C.rule}`,
          paddingBottom: 12,
          marginBottom: 16,
        }}
      >
        <div>
          <Eyebrow>The Chartians</Eyebrow>
          <div
            style={{
              fontSize: 26,
              fontWeight: 700,
              letterSpacing: "-0.02em",
              color: C.champagne,
              lineHeight: 1.05,
              marginTop: 3,
            }}
          >
            Closing Auction, live
          </div>
          <div style={{ fontSize: 12, color: C.muted, marginTop: 4 }}>
            NSE cash segment, F&amp;O eligible stocks. Derivatives run to 3:40.
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "flex-end", gap: 22 }}>
          <div style={{ textAlign: "right" }}>
            <Eyebrow>Exchange clock</Eyebrow>
            <div
              style={{
                fontFamily: MONO,
                fontSize: 30,
                fontWeight: 500,
                color: C.champagne,
                lineHeight: 1.05,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {clock(t)}
            </div>
          </div>
          <div style={{ textAlign: "right", minWidth: 132 }}>
            <Eyebrow tone={inRandom ? C.oxide : C.champagneDim}>
              {inRandom ? "Book may shut now" : "Entry closes in"}
            </Eyebrow>
            <div
              style={{
                fontFamily: MONO,
                fontSize: 30,
                fontWeight: 500,
                color: inRandom ? C.oxide : C.paper,
                lineHeight: 1.05,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {t >= T(15, 30) ? "matched" : `${Math.floor(secsLeft / 60)}:${String(secsLeft % 60).padStart(2, "0")}`}
            </div>
          </div>
        </div>
      </div>

      {/* -------------------------------------------------------------- rail */}
      <Panel style={{ padding: "12px 12px 6px", marginBottom: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
          <Eyebrow tone={ph.tone}>Now · {ph.label}</Eyebrow>
          <div style={{ fontSize: 11, color: C.muted }}>{ph.detail}</div>
        </div>
        <AuctionRail t={t} trail={trail} reduced={reduced} />
      </Panel>

      {/* ------------------------------------------------------- top row */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(260px, 1fr) minmax(260px, 1.4fr)",
          gap: 14,
          marginBottom: 14,
        }}
      >
        <Panel style={{ padding: 16, display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <Eyebrow>Indicative Nifty 50</Eyebrow>
            <div
              style={{
                fontFamily: MONO,
                fontSize: 44,
                fontWeight: 600,
                color: C.champagne,
                lineHeight: 1.02,
                marginTop: 4,
                fontVariantNumeric: "tabular-nums",
                transition: "color 300ms",
              }}
            >
              {nf(frame.index.indicative)}
            </div>
            <div
              style={{
                fontFamily: MONO,
                fontSize: 16,
                fontWeight: 500,
                color: tone,
                marginTop: 3,
              }}
            >
              {delta >= 0 ? "+" : ""}
              {nf(delta)} ({deltaPct >= 0 ? "+" : ""}
              {deltaPct.toFixed(2)}%)
            </div>
            <div style={{ fontSize: 11, color: C.muted, marginTop: 3 }}>
              versus the 3:15 continuous print
            </div>
          </div>

          <div style={{ height: 1, background: C.rule }} />

          <div>
            <Eyebrow>Futures, still trading</Eyebrow>
            <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginTop: 4 }}>
              <div style={{ fontFamily: MONO, fontSize: 21, color: C.paper }}>
                {nf(frame.index.futures)}
              </div>
              <div
                style={{
                  fontFamily: MONO,
                  fontSize: 13,
                  color: toneFor(frame.index.futBasis),
                }}
              >
                {frame.index.futBasis >= 0 ? "+" : ""}
                {nf(frame.index.futBasis)} basis
              </div>
            </div>
            <div style={{ fontSize: 11, color: C.muted, marginTop: 4, lineHeight: 1.45 }}>
              {Math.abs(frame.index.futBasis) > 30
                ? "Futures disagree with the auction. One of them is wrong."
                : "Futures are tracking the indicative close."}
            </div>
          </div>

          <div style={{ height: 1, background: C.rule }} />

          <div>
            <Eyebrow>Cash order tilt, all CAS names</Eyebrow>
            <div style={{ display: "flex", height: 26, marginTop: 7, gap: 2 }}>
              <div
                style={{
                  width: `${totals.tilt}%`,
                  background: C.verdigris,
                  display: "flex",
                  alignItems: "center",
                  paddingLeft: 7,
                  fontFamily: MONO,
                  fontSize: 11,
                  color: C.abyss,
                  fontWeight: 600,
                  transition: "width 400ms ease",
                }}
              >
                {totals.tilt.toFixed(0)}%
              </div>
              <div
                style={{
                  width: `${100 - totals.tilt}%`,
                  background: C.oxide,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "flex-end",
                  paddingRight: 7,
                  fontFamily: MONO,
                  fontSize: 11,
                  color: C.abyss,
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
                fontSize: 10.5,
                color: C.muted,
                marginTop: 5,
              }}
            >
              <span>buy {qty(totals.buy)}</span>
              <span>matchable {qty(totals.matched)}</span>
              <span>sell {qty(totals.sell)}</span>
            </div>
          </div>
        </Panel>

        <Panel style={{ padding: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 11 }}>
            <Eyebrow>Where the close is coming from</Eyebrow>
            <div style={{ fontSize: 11, color: C.muted }}>index points, top and bottom five</div>
          </div>
          <Waterfall stocks={stocks} />
        </Panel>
      </div>

      {/* -------------------------------------------------------------- tape */}
      <Panel style={{ padding: "14px 16px 8px" }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 10,
            flexWrap: "wrap",
            gap: 10,
          }}
        >
          <Eyebrow>The tape</Eyebrow>
          <div style={{ display: "flex", gap: 6 }}>
            {[
              ["points", "Index impact"],
              ["imbalance", "Imbalance"],
              ["matchedQty", "Matched size"],
              ["pct", "Move from ref"],
              ["sym", "A to Z"],
            ].map(([k, label]) => (
              <button
                key={k}
                onClick={() => setSortKey(k)}
                style={{
                  fontFamily: DISPLAY,
                  fontSize: 10.5,
                  fontWeight: 600,
                  letterSpacing: "0.05em",
                  padding: "4px 9px",
                  borderRadius: 2,
                  cursor: "pointer",
                  background: sortKey === k ? C.champagne : "transparent",
                  color: sortKey === k ? C.abyss : C.muted,
                  border: `1px solid ${sortKey === k ? C.champagne : C.rule}`,
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 780 }}>
            <thead>
              <tr>
                {[
                  ["Stock", "left", 96],
                  ["Ref", "right", 78],
                  ["Indicative", "right", 84],
                  ["Move", "right", 66],
                  ["Band and imbalance", "center", 138],
                  ["Buy less sell", "right", 86],
                  ["Matchable", "right", 82],
                  ["Mkt orders", "right", 84],
                  ["Points", "right", 62],
                ].map(([h, align, w]) => (
                  <th
                    key={h}
                    style={{
                      textAlign: align,
                      width: w,
                      fontSize: 9.5,
                      fontWeight: 600,
                      letterSpacing: "0.12em",
                      textTransform: "uppercase",
                      color: C.champagneDim,
                      padding: "0 8px 7px",
                      borderBottom: `1px solid ${C.rule}`,
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
                <tr key={s.sym} style={{ borderBottom: `1px solid ${C.abyss}` }}>
                  <td
                    style={{
                      padding: "6px 8px",
                      fontFamily: MONO,
                      fontSize: 11.5,
                      color: C.paper,
                      whiteSpace: "nowrap",
                    }}
                  >
                    {s.sym}
                    <span style={{ color: C.muted, fontSize: 9.5, marginLeft: 5 }}>
                      {s.weight.toFixed(1)}%
                    </span>
                  </td>
                  <td style={{ padding: "6px 8px", textAlign: "right", fontFamily: MONO, fontSize: 11.5, color: C.muted }}>
                    {nf(s.ref)}
                  </td>
                  <td
                    style={{
                      padding: "6px 8px",
                      textAlign: "right",
                      fontFamily: MONO,
                      fontSize: 11.5,
                      color: C.champagne,
                      fontWeight: 500,
                    }}
                  >
                    {nf(s.iep)}
                  </td>
                  <td
                    style={{
                      padding: "6px 8px",
                      textAlign: "right",
                      fontFamily: MONO,
                      fontSize: 11.5,
                      color: toneFor(s.pct),
                    }}
                  >
                    {s.pct >= 0 ? "+" : ""}
                    {s.pct.toFixed(2)}%
                  </td>
                  <td style={{ padding: "3px 8px" }}>
                    <div style={{ display: "flex", justifyContent: "center" }}>
                      <BandStrip pct={s.pct} imbalance={s.imbalance} maxImb={maxImb} />
                    </div>
                  </td>
                  <td
                    style={{
                      padding: "6px 8px",
                      textAlign: "right",
                      fontFamily: MONO,
                      fontSize: 11.5,
                      color: toneFor(s.imbalance),
                    }}
                  >
                    {s.imbalance >= 0 ? "+" : ""}
                    {qty(s.imbalance)}
                  </td>
                  <td style={{ padding: "6px 8px", textAlign: "right", fontFamily: MONO, fontSize: 11.5, color: C.muted }}>
                    {qty(s.matchedQty)}
                  </td>
                  <td
                    style={{
                      padding: "6px 8px",
                      textAlign: "right",
                      fontFamily: MONO,
                      fontSize: 11.5,
                      color: toneFor(s.mktImbalance),
                      opacity: 0.75,
                    }}
                  >
                    {s.mktImbalance >= 0 ? "+" : ""}
                    {qty(s.mktImbalance)}
                  </td>
                  <td
                    style={{
                      padding: "6px 8px",
                      textAlign: "right",
                      fontFamily: MONO,
                      fontSize: 11.5,
                      fontWeight: 500,
                      color: toneFor(s.points),
                    }}
                  >
                    {s.points >= 0 ? "+" : ""}
                    {s.points.toFixed(1)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      {/* ------------------------------------------------------------ footer */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 12,
          marginTop: 14,
          paddingTop: 12,
          borderTop: `1px solid ${C.rule}`,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span
            style={{
              fontFamily: DISPLAY,
              fontSize: 9.5,
              fontWeight: 700,
              letterSpacing: "0.14em",
              padding: "3px 8px",
              background: C.oxideDim,
              color: C.oxide,
              borderRadius: 2,
            }}
          >
            SIMULATED FEED
          </span>
          <span style={{ fontSize: 11, color: C.muted }}>
            Replay engine, not live exchange data. Swap runSimulationTick for the socket handler to go live.
          </span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button
            onClick={() => setRunning((r) => !r)}
            style={{
              fontFamily: DISPLAY,
              fontSize: 11,
              fontWeight: 600,
              padding: "5px 14px",
              background: C.champagne,
              color: C.abyss,
              border: "none",
              borderRadius: 2,
              cursor: "pointer",
            }}
          >
            {running ? "Pause" : "Play"}
          </button>
          <button
            onClick={reset}
            style={{
              fontFamily: DISPLAY,
              fontSize: 11,
              fontWeight: 600,
              padding: "5px 14px",
              background: "transparent",
              color: C.paper,
              border: `1px solid ${C.rule}`,
              borderRadius: 2,
              cursor: "pointer",
            }}
          >
            New session
          </button>
          <div style={{ display: "flex", gap: 4, marginLeft: 4 }}>
            {[4, 12, 30].map((sp) => (
              <button
                key={sp}
                onClick={() => setSpeed(sp)}
                style={{
                  fontFamily: MONO,
                  fontSize: 10.5,
                  padding: "5px 9px",
                  background: speed === sp ? C.slate : "transparent",
                  color: speed === sp ? C.champagne : C.muted,
                  border: `1px solid ${C.rule}`,
                  borderRadius: 2,
                  cursor: "pointer",
                }}
              >
                {sp}x
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
