"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useOptimization, SeriesPoint, GridSample } from "./hooks/useOptimization";

// ─── Types ────────────────────────────────────────────────────────────────────
type Dataset = "solar" | "wind" | "wind_raw" | "both";
type Point   = { date: string; value: number };
type ApiResponse = {
  dataset: "solar" | "wind" | "wind_raw";
  year: number | null;
  years: number[];
  points: Point[];
  stats: { min: number | null; max: number | null; avg: number | null; count: number };
  error?: string;
};

// ─── Data hook ────────────────────────────────────────────────────────────────
function useTimeSeries(dataset: "solar" | "wind" | "wind_raw", year: number | null) {
  const [data, setData]       = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    async function run() {
      try {
        setLoading(true); setError(null);
        const params = new URLSearchParams({ dataset });
        if (dataset === "wind_raw" && year != null) params.set("year", String(year));
        const res  = await fetch(`/api/data?${params}`);
        const json = (await res.json()) as ApiResponse;
        if (!res.ok || json.error) throw new Error(json.error || `HTTP ${res.status}`);
        if (!cancelled) setData(json);
      } catch (e) { if (!cancelled) setError(String(e)); }
      finally     { if (!cancelled) setLoading(false); }
    }
    run();
    return () => { cancelled = true; };
  }, [dataset, year]);
  return { data, loading, error };
}

// ─── Standard line chart ──────────────────────────────────────────────────────
function Chart({
  series, labels, unit
}: {
  series: { solar?: Point[]; wind?: Point[] };
  labels?: { solar?: string; wind?: string };
  unit?: string;
}) {
  const [hover, setHover] = useState<{ key: "solar"|"wind"; index: number }|null>(null);
  const sp = useMemo(() => (series.solar??[]).map(p=>({date:new Date(p.date),value:p.value})),[series.solar]);
  const wp = useMemo(() => (series.wind ??[]).map(p=>({date:new Date(p.date),value:p.value})),[series.wind]);
  const all   = useMemo(() => [...sp.map(p=>p.value),...wp.map(p=>p.value)],[sp,wp]);
  const minY  = all.length ? Math.min(...all) : 0;
  const maxY  = all.length ? Math.max(...all) : 1;
  const spanY = maxY - minY || 1;
  const W=900, H=260, P=44;
  const xS = (i:number,n:number) => P + ((W-P*2)*i)/Math.max(1,n-1);
  const yS = (v:number) => H-P - ((H-P*2)*(v-minY))/spanY;
  const yTicks = Array.from({length:5},(_,i)=>{ const t=i/4; const v=minY+spanY*t; return {v,y:yS(v)}; });
  const ref = sp.length ? sp : wp;
  if (!sp.length && !wp.length) return <div className="state-box"><span style={{fontSize:28,opacity:.3}}>📊</span><span>No data</span></div>;
  const hovered = hover && (hover.key==="solar"?sp[hover.index]:wp[hover.index]);
  const renderLine = (key:"solar"|"wind", pts:{date:Date;value:number}[], color:string, fillId:string) => {
    if (!pts.length) return null;
    const n = pts.length;
    const d = pts.map((p,i)=>(i===0?`M ${xS(i,n)} ${yS(p.value)}`:`L ${xS(i,n)} ${yS(p.value)}`)).join(" ");
    return (
      <g key={key}>
        <path d={`${d} L ${xS(n-1,n)} ${H-P} L ${xS(0,n)} ${H-P} Z`} fill={`url(#${fillId})`} fillOpacity={.5}/>
        <path d={d} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round"/>
        {pts.map((p,i)=>(
          <g key={i} onMouseEnter={()=>setHover({key,index:i})} onMouseLeave={()=>setHover(h=>h?.key===key&&h?.index===i?null:h)}>
            <circle cx={xS(i,n)} cy={yS(p.value)} r={8} fill="transparent"/>
          </g>
        ))}
      </g>
    );
  };
  return (
    <div>
      <div style={{display:"flex",gap:16,marginBottom:8,fontSize:12,fontWeight:500}}>
        {sp.length && <span style={{color:"#22d3a5",display:"flex",alignItems:"center",gap:6}}><span style={{width:8,height:8,borderRadius:"50%",background:"#22d3a5",display:"inline-block"}}/>  {labels?.solar??"Solar"}</span>}
        {wp.length && <span style={{color:"#60a5fa",display:"flex",alignItems:"center",gap:6}}><span style={{width:8,height:8,borderRadius:"50%",background:"#60a5fa",display:"inline-block"}}/> {labels?.wind??"Wind"}</span>}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="chart-svg">
        <defs>
          <linearGradient id="fSolar" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#22d3a5" stopOpacity=".5"/><stop offset="100%" stopColor="#22d3a5" stopOpacity="0"/></linearGradient>
          <linearGradient id="fWind"  x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#60a5fa" stopOpacity=".4"/><stop offset="100%" stopColor="#60a5fa" stopOpacity="0"/></linearGradient>
        </defs>
        {yTicks.map((t,i)=>(
          <g key={i}>
            <line x1={P} x2={W-P} y1={t.y} y2={t.y} stroke="rgba(99,135,220,.1)" strokeDasharray="4 8"/>
            <text x={P-6} y={t.y+4} textAnchor="end" fill="#4b5b7a" fontSize={9} fontFamily="'JetBrains Mono',monospace">{t.v.toFixed(1)}</text>
          </g>
        ))}
        {renderLine("solar",sp,"#22d3a5","fSolar")}
        {renderLine("wind", wp,"#60a5fa","fWind")}
        {hover&&hovered&&(()=>{
          const n    = hover.key==="solar"?sp.length:wp.length;
          const cx   = xS(hover.index,n), cy = yS(hovered.value);
          const c    = hover.key==="solar"?"#22d3a5":"#60a5fa";
          const tW   = 210, tH = 56;
          const tx   = Math.min(Math.max(cx+14,P),W-P-tW), ty = Math.max(cy-tH-12,P);
          const lbl  = hover.key==="solar"?(labels?.solar??"Solar"):(labels?.wind??"Wind");
          const vu   = unit===undefined?"kWh":unit;
          return (<>
            <line x1={cx} x2={cx} y1={P} y2={H-P} stroke={c} strokeOpacity={.3} strokeDasharray="4 4"/>
            <circle cx={cx} cy={cy} r={4.5} fill={c} stroke="#eef2ff" strokeWidth={1.5}/>
            <rect x={tx} y={ty} width={tW} height={tH} rx={9} fill="rgba(6,9,22,.97)" stroke="rgba(99,135,220,.5)" strokeWidth={1}/>
            <text x={tx+10} y={ty+18} fill="#94a3b8" fontSize={10} fontFamily="'JetBrains Mono',monospace">{hovered.date.toLocaleString(undefined,{year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit"})}</text>
            <text x={tx+10} y={ty+38} fill={c} fontSize={12} fontWeight="600" fontFamily="'JetBrains Mono',monospace">{lbl}: {hovered.value.toFixed(3)}{vu?` ${vu}`:""}</text>
          </>);
        })()}
      </svg>
    </div>
  );
}

// ─── Dual-zone chart: shows curtailment (above baseload) & shortfall (below) ──
function DualZoneChart({
  series, baseloadLabel="Baseload"
}: {
  series: { date: string; production: number; baseload: number }[];
  baseloadLabel?: string;
}) {
  const [hover, setHover] = useState<number|null>(null);
  const parsed = useMemo(()=>series.map(p=>({date:new Date(p.date),prod:p.production,base:p.baseload})),[series]);
  if (!parsed.length) return <div className="state-box"><span style={{fontSize:28,opacity:.3}}>📊</span><span>No data</span></div>;
  const W=900, H=320, P=50;
  const allV = parsed.flatMap(p=>[p.prod,p.base]);
  const minY = Math.min(...allV), maxY = Math.max(...allV);
  const spanY = maxY - minY || 1;
  const xS = (i:number) => P + ((W-P*2)*i)/Math.max(1,parsed.length-1);
  const yS = (v:number) => H-P - ((H-P*2)*(v-minY))/spanY;
  const yTicks = Array.from({length:5},(_,i)=>{ const t=i/4; const v=minY+spanY*t; return {v,y:yS(v)}; });

  // Build path strings
  const prodD = parsed.map((p,i)=>(i===0?`M ${xS(i)} ${yS(p.prod)}`:`L ${xS(i)} ${yS(p.prod)}`)).join(" ");
  const baseD = parsed.map((p,i)=>(i===0?`M ${xS(i)} ${yS(p.base)}`:`L ${xS(i)} ${yS(p.base)}`)).join(" ");

  // Curtailment polygon: area between prod and base where prod > base
  // Shortfall polygon: area between base and prod where prod < base
  // We build polyline segment fills
  const curtSegments: string[] = [];
  const shrtSegments: string[] = [];

  for (let i = 0; i < parsed.length - 1; i++) {
    const a = parsed[i], b = parsed[i+1];
    const ax = xS(i), bx = xS(i+1);
    const ay_prod = yS(a.prod), ay_base = yS(a.base);
    const by_prod = yS(b.prod), by_base = yS(b.base);

    // Find crossover x if signs differ
    let crossX: number|null = null;
    const aDiff = a.prod - a.base, bDiff = b.prod - b.base;
    if ((aDiff > 0 && bDiff < 0) || (aDiff < 0 && bDiff > 0)) {
      const t = aDiff / (aDiff - bDiff);
      crossX = ax + t*(bx-ax);
    }

    if (!crossX) {
      const mid = (ax+bx)/2;
      if (a.prod > a.base) {
        curtSegments.push(`M ${ax} ${ay_base} L ${ax} ${ay_prod} L ${bx} ${by_prod} L ${bx} ${by_base} Z`);
      } else {
        shrtSegments.push(`M ${ax} ${ay_prod} L ${ax} ${ay_base} L ${bx} ${by_base} L ${bx} ${by_prod} Z`);
      }
    } else {
      const crossY_prod = yS(a.prod + (aDiff/(aDiff-bDiff))*(b.prod-a.prod));
      const crossY_base = yS(a.base + (aDiff/(aDiff-bDiff))*(b.base-a.base));
      if (a.prod > a.base) {
        curtSegments.push(`M ${ax} ${ay_base} L ${ax} ${ay_prod} L ${crossX} ${crossY_prod} L ${crossX} ${crossY_base} Z`);
        shrtSegments.push(`M ${crossX} ${crossY_prod} L ${crossX} ${crossY_base} L ${bx} ${by_base} L ${bx} ${by_prod} Z`);
      } else {
        shrtSegments.push(`M ${ax} ${ay_prod} L ${ax} ${ay_base} L ${crossX} ${crossY_base} L ${crossX} ${crossY_prod} Z`);
        curtSegments.push(`M ${crossX} ${crossY_prod} L ${crossX} ${crossY_base} L ${bx} ${by_base} L ${bx} ${by_prod} Z`);
      }
    }
  }

  const hp = hover !== null ? parsed[hover] : null;

  return (
    <div>
      {/* Legend */}
      <div style={{display:"flex",gap:20,marginBottom:10,fontSize:12,fontWeight:500,flexWrap:"wrap"}}>
        <span style={{display:"flex",alignItems:"center",gap:6,color:"#22d3a5"}}><span style={{width:22,height:3,background:"#22d3a5",display:"inline-block",borderRadius:2}}/> Combined Production</span>
        <span style={{display:"flex",alignItems:"center",gap:6,color:"#818cf8"}}><span style={{width:22,height:3,background:"#818cf8",display:"inline-block",borderRadius:2,borderTop:"2px dashed #818cf8"}}/>{baseloadLabel}</span>
        <span style={{display:"flex",alignItems:"center",gap:6,color:"#fb923c"}}><span style={{width:14,height:14,background:"rgba(251,146,60,.35)",border:"1px solid #fb923c",display:"inline-block",borderRadius:3}}/> Curtailment (surplus)</span>
        <span style={{display:"flex",alignItems:"center",gap:6,color:"#f87171"}}><span style={{width:14,height:14,background:"rgba(248,113,113,.35)",border:"1px solid #f87171",display:"inline-block",borderRadius:3}}/> Shortfall (deficit)</span>
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} className="chart-svg" style={{maxWidth:"100%"}}>
        <defs>
          <linearGradient id="curtGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#fb923c" stopOpacity=".7"/>
            <stop offset="100%" stopColor="#fb923c" stopOpacity=".1"/>
          </linearGradient>
          <linearGradient id="shrtGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#f87171" stopOpacity=".15"/>
            <stop offset="100%" stopColor="#f87171" stopOpacity=".7"/>
          </linearGradient>
          <filter id="glow2"><feGaussianBlur stdDeviation="2.5" result="b"/><feComposite in="SourceGraphic" in2="b" operator="over"/></filter>
        </defs>

        {/* Y grid */}
        {yTicks.map((t,i)=>(
          <g key={i}>
            <line x1={P} x2={W-P} y1={t.y} y2={t.y} stroke="rgba(99,135,220,.1)" strokeDasharray="4 8"/>
            <text x={P-6} y={t.y+4} textAnchor="end" fill="#4b5b7a" fontSize={9} fontFamily="'JetBrains Mono',monospace">{t.v.toFixed(1)}</text>
          </g>
        ))}

        {/* Curtailment zones */}
        {curtSegments.map((d,i)=><path key={`c${i}`} d={d} fill="url(#curtGrad)" opacity={.85}/>)}
        {/* Shortfall zones */}
        {shrtSegments.map((d,i)=><path key={`s${i}`} d={d} fill="url(#shrtGrad)" opacity={.85}/>)}

        {/* Baseload dashed line */}
        <path d={baseD} fill="none" stroke="#818cf8" strokeWidth={1.8} strokeDasharray="7 5" strokeLinejoin="round"/>

        {/* Production line */}
        <path d={prodD} fill="none" stroke="#22d3a5" strokeWidth={2.2} strokeLinejoin="round" strokeLinecap="round" filter="url(#glow2)"/>

        {/* Hover targets */}
        {parsed.map((_,i)=>(
          <rect key={i} x={xS(i)-4} y={P} width={8} height={H-2*P} fill="transparent"
            onMouseEnter={()=>setHover(i)} onMouseLeave={()=>setHover(null)}/>
        ))}

        {/* Hover tooltip */}
        {hover!==null&&hp&&(()=>{
          const cx = xS(hover), prodY = yS(hp.prod), baseY = yS(hp.base);
          const excess   = hp.prod - hp.base;
          const isCurt   = excess > 0;
          const tW=220, tH=76;
          const tx = Math.min(Math.max(cx+14,P),W-P-tW), ty=Math.max(Math.min(prodY,baseY)-tH-8,P);
          return (<>
            <line x1={cx} x2={cx} y1={P} y2={H-P} stroke="rgba(255,255,255,.2)" strokeDasharray="4 4"/>
            <circle cx={cx} cy={prodY} r={4.5} fill="#22d3a5" stroke="#eef2ff" strokeWidth={1.5}/>
            <circle cx={cx} cy={baseY} r={3.5} fill="#818cf8" stroke="#eef2ff" strokeWidth={1}/>
            <rect x={tx} y={ty} width={tW} height={tH} rx={9} fill="rgba(6,9,22,.97)" stroke="rgba(99,135,220,.5)" strokeWidth={1}/>
            <text x={tx+10} y={ty+17} fill="#94a3b8" fontSize={9.5} fontFamily="'JetBrains Mono',monospace">{hp.date.toLocaleString(undefined,{month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit"})}</text>
            <text x={tx+10} y={ty+33} fill="#22d3a5" fontSize={10} fontFamily="'JetBrains Mono',monospace">Prod: {hp.prod.toFixed(2)} MW  Base: {hp.base.toFixed(2)} MW</text>
            <text x={tx+10} y={ty+52} fill={isCurt?"#fb923c":"#f87171"} fontSize={10} fontWeight="700" fontFamily="'JetBrains Mono',monospace">
              {isCurt?`▲ Curtailment: +${excess.toFixed(2)} MW`:`▼ Shortfall: ${excess.toFixed(2)} MW`}
            </text>
          </>);
        })()}
      </svg>
    </div>
  );
}

// ─── Stats ────────────────────────────────────────────────────────────────────
function Stats({ stats, accent="var(--green)" }: { stats:{min:number|null;max:number|null;avg:number|null}; accent?:string }) {
  if (stats.min==null||stats.max==null||stats.avg==null) return null;
  return (
    <div className="stats-grid">
      {[{label:"Min",value:stats.min.toFixed(2),icon:"↓"},{label:"Avg",value:stats.avg.toFixed(2),icon:"◈"},{label:"Max",value:stats.max.toFixed(2),icon:"↑"}].map(item=>(
        <div key={item.label} className="stat-card">
          <div className="stat-icon" style={{color:accent}}>{item.icon}</div>
          <div className="stat-label">{item.label}</div>
          <div className="stat-value">{item.value}</div>
        </div>
      ))}
    </div>
  );
}

// ─── DataTable ────────────────────────────────────────────────────────────────
function DataTable({ points, label }: { points: Point[]; label?: string }) {
  const slice = points.slice(0,50);
  if (!slice.length) return null;
  return (
    <div className="data-table-wrap">
      <div className="data-table-header"><span>Date / Time</span><span>{label?`${label} `:""}Production (kWh)</span></div>
      <div className="data-table-body">
        {slice.map((p,idx)=>{
          const d=new Date(p.date);
          return (
            <div key={idx} className={`data-table-row ${idx%2===0?"even":"odd"}`}>
              <span className="data-table-date">{d.toLocaleString(undefined,{year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit"})}</span>
              <span className="data-table-val">{p.value.toFixed(3)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Filter helpers ───────────────────────────────────────────────────────────
function filterPoints(points: Point[], opts:{dataset:Dataset;year:number|null;month:number|null;day:number|null;kind:"solar"|"wind"|"wind_raw"}): Point[] {
  return points.filter(p=>{
    const d=new Date(p.date);
    if (opts.kind==="wind_raw"&&opts.year!=null&&d.getFullYear()!==opts.year) return false;
    if (opts.month!=null&&d.getMonth()+1!==opts.month) return false;
    if (opts.day!=null&&d.getDate()!==opts.day) return false;
    return true;
  });
}

function ControlSelect({ label, value, onChange, children }: { label:string; value:string|number; onChange:(v:string)=>void; children:React.ReactNode }) {
  return (
    <label className="control-label">
      {label}
      <select className="control-select" value={value} onChange={e=>onChange(e.target.value)}>{children}</select>
    </label>
  );
}

// ─── What-if Explorer ─────────────────────────────────────────────────────────
function WhatIfExplorer({ gridSamples, bestS, bestW, bestB }: { gridSamples: GridSample[]; bestS:number; bestW:number; bestB:number }) {
  const sValues = useMemo(()=>Array.from(new Set(gridSamples.map(s=>s.sMw))).sort((a,b)=>a-b),[gridSamples]);
  const wValues = useMemo(()=>Array.from(new Set(gridSamples.map(s=>s.wMw))).sort((a,b)=>a-b),[gridSamples]);
  const [sIdx, setSIdx] = useState(()=>sValues.indexOf(bestS));
  const [wIdx, setWIdx] = useState(()=>wValues.indexOf(bestW));
  useEffect(()=>{ if(sValues.length) setSIdx(sValues.indexOf(bestS)); },[bestS,sValues]);
  useEffect(()=>{ if(wValues.length) setWIdx(wValues.indexOf(bestW)); },[bestW,wValues]);

  const selS = sValues[sIdx] ?? bestS;
  const selW = wValues[wIdx] ?? bestW;
  const match = gridSamples.find(g=>g.sMw===selS&&g.wMw===selW);
  const isBest = selS===bestS&&selW===bestW;

  const baseload    = match?.baseloadMw          ?? null;
  const dailyAvg    = match?.dailyAvgProductionMw ?? null;
  const errorPct    = match?.dailyErrorPct         ?? null;
  const deltaB      = baseload!=null ? baseload - bestB : null;

  return (
    <div className="card" style={{padding:"22px 24px"}}>
      <div style={{marginBottom:16}}>
        <div className="opt-eyebrow">🎛 What-If Explorer</div>
        <div style={{fontSize:13,color:"var(--text-secondary)",marginTop:4}}>
          Adjust solar &amp; wind capacities to explore how the baseload changes across the precomputed grid.
          Every point shown here already satisfies the yearly curtailment constraint used in the optimization.
          The optimization solves: pick capacities (S,W) and baseload B that maximize B, subject to
          (1) yearly curtailment ≈ 10% of total production and (2) average daily production ≥ 70% of B.
          In this panel the next objective is to minimize the <em>daily error</em> around that baseload, using the
          trade‑off view and global plot below.
        </div>
      </div>

      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:24,marginBottom:20}}>
        {/* Solar slider */}
        <div>
          <div style={{display:"flex",justifyContent:"space-between",fontSize:11,fontWeight:700,letterSpacing:".08em",textTransform:"uppercase",color:"var(--text-muted)",marginBottom:8}}>
            <span>☀️ Solar Capacity</span>
            <span style={{color:"#22d3a5",fontFamily:"'JetBrains Mono',monospace"}}>{selS.toFixed(0)} MW</span>
          </div>
          <input type="range" min={0} max={sValues.length-1} step={1} value={sIdx} onChange={e=>setSIdx(Number(e.target.value))} style={{width:"100%"}}/>
          <div style={{display:"flex",justifyContent:"space-between",fontSize:10,color:"var(--text-muted)",marginTop:4,fontFamily:"'JetBrains Mono',monospace"}}>
            <span>{sValues[0]?.toFixed(0)} MW</span><span>{sValues[sValues.length-1]?.toFixed(0)} MW</span>
          </div>
        </div>
        {/* Wind slider */}
        <div>
          <div style={{display:"flex",justifyContent:"space-between",fontSize:11,fontWeight:700,letterSpacing:".08em",textTransform:"uppercase",color:"var(--text-muted)",marginBottom:8}}>
            <span>🌬️ Wind Capacity</span>
            <span style={{color:"#60a5fa",fontFamily:"'JetBrains Mono',monospace"}}>{selW.toFixed(0)} MW</span>
          </div>
          <input type="range" min={0} max={wValues.length-1} step={1} value={wIdx} onChange={e=>setWIdx(Number(e.target.value))} style={{width:"100%"}}/>
          <div style={{display:"flex",justifyContent:"space-between",fontSize:10,color:"var(--text-muted)",marginTop:4,fontFamily:"'JetBrains Mono',monospace"}}>
            <span>{wValues[0]?.toFixed(0)} MW</span><span>{wValues[wValues.length-1]?.toFixed(0)} MW</span>
          </div>
        </div>
      </div>

      {/* Result row */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:12}}>
        {[
          { label:"Baseload", value: baseload!=null?`${baseload.toFixed(1)} MW`:"—", highlight: deltaB!=null&&deltaB!==0, delta: deltaB, icon:"⚡", color: deltaB!=null&&deltaB>0?"#22d3a5":deltaB!=null&&deltaB<0?"#f87171":"var(--text-primary)" },
          { label:"Daily Avg Prod", value: dailyAvg!=null?`${dailyAvg.toFixed(1)} MW`:"—", icon:"📊", color:"var(--text-primary)" },
          { label:"Daily Error vs B", value: errorPct!=null?`${(errorPct*100).toFixed(1)} %`:"—", icon:"📐", color: errorPct!=null&&errorPct>0?"#fb923c":errorPct!=null&&errorPct<0?"#22d3a5":"var(--text-primary)" },
        ].map(item=>(
          <div key={item.label} style={{padding:"14px 16px",borderRadius:"var(--radius-md)",border:`1px solid ${isBest&&item.icon==="⚡"?"rgba(34,211,165,.4)":"var(--border)"}`,background:isBest&&item.icon==="⚡"?"rgba(34,211,165,.06)":"rgba(10,16,36,.8)",position:"relative",overflow:"hidden"}}>
            {isBest&&item.icon==="⚡" && <div style={{position:"absolute",top:0,left:0,right:0,height:2,background:"linear-gradient(90deg,#22d3a5,#60a5fa)"}}/>}
            <div style={{fontSize:10,fontWeight:700,letterSpacing:".1em",textTransform:"uppercase",color:"var(--text-muted)",marginBottom:6}}>{item.icon} {item.label}</div>
            <div style={{fontSize:20,fontWeight:700,color:item.color,fontFamily:"'JetBrains Mono',monospace"}}>{item.value}</div>
            {item.delta!=null&&item.delta!==0&&<div style={{fontSize:11,marginTop:4,color:item.color,fontFamily:"'JetBrains Mono',monospace"}}>{item.delta>0?`+${item.delta.toFixed(1)}`:item.delta.toFixed(1)} vs optimal</div>}
            {isBest&&item.icon==="⚡"&&<div style={{fontSize:10,color:"#22d3a5",marginTop:4}}>★ optimal</div>}
          </div>
        ))}
      </div>

      {!match && <div style={{marginTop:12,fontSize:12,color:"#fb923c"}}>⚠️ This combination was not found in the precomputed grid. Try a nearby step.</div>}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function Page() {
  const [view, setView]         = useState<"timeseries"|"optimization">("timeseries");
  const [dataset, setDataset]   = useState<Dataset>("solar");
  const [year, setYear]         = useState<number|null>(null);
  const [month, setMonth]       = useState<number|null>(null);
  const [day, setDay]           = useState<number|null>(null);
  const [solarScale, setSolar]  = useState(1);
  const [windScale,  setWind]   = useState(1);

  const solarRes   = useTimeSeries("solar", null);
  const windRes    = useTimeSeries("wind",  null);
  const windRawRes = useTimeSeries("wind_raw", year);
  const solarData  = solarRes.data;
  const windData   = windRes.data;
  const windRawData= windRawRes.data;

  const loading= dataset==="both"?solarRes.loading||windRes.loading:dataset==="solar"?solarRes.loading:dataset==="wind"?windRes.loading:windRawRes.loading;
  const error  = dataset==="both"?solarRes.error||windRes.error:dataset==="solar"?solarRes.error:dataset==="wind"?windRes.error:windRawRes.error;

  const parsedSolar = useMemo(()=>filterPoints(solarData?.points??[],{dataset,year,month,day,kind:"solar"}),[solarData,dataset,year,month,day]);
  const parsedWind  = useMemo(()=>filterPoints((dataset==="wind_raw"?windRawData?.points:windData?.points)??[],{dataset,year,month,day,kind:dataset==="wind_raw"?"wind_raw":"wind"}),[windData,windRawData,dataset,year,month,day]);
  const scaledSolar = useMemo(()=>parsedSolar.map(p=>({...p,value:p.value*solarScale})),[parsedSolar,solarScale]);
  const scaledWind  = useMemo(()=>parsedWind.map(p=>({...p,value:p.value*windScale})), [parsedWind, windScale]);
  const scaledTotal = useMemo(()=>{const l=Math.min(scaledSolar.length,scaledWind.length);return Array.from({length:l},(_,i)=>({date:scaledSolar[i].date,value:scaledSolar[i].value+scaledWind[i].value}));},[scaledSolar,scaledWind]);

  function computeStats(pts:Point[]) {
    if (!pts.length) return {min:null,max:null,avg:null,count:0};
    const v=pts.map(p=>p.value); return {min:Math.min(...v),max:Math.max(...v),avg:v.reduce((a,b)=>a+b,0)/v.length,count:v.length};
  }

  const monthOptions = useMemo(()=>{
    const set=new Set<number>();
    for (const p of solarData?.points??[]) set.add(new Date(p.date).getMonth()+1);
    const ws=dataset==="wind_raw"?windRawData?.points??[]:windData?.points??[];
    for (const p of ws){const d=new Date(p.date);if(dataset==="wind_raw"&&year!=null&&d.getFullYear()!==year)continue;set.add(d.getMonth()+1);}
    return Array.from(set).sort((a,b)=>a-b);
  },[solarData,windData,windRawData,dataset,year]);

  const dayOptions = useMemo(()=>{
    const set=new Set<number>();
    for(const p of solarData?.points??[]){const d=new Date(p.date);if(month!=null&&d.getMonth()+1!==month)continue;set.add(d.getDate());}
    const ws=dataset==="wind_raw"?windRawData?.points??[]:windData?.points??[];
    for(const p of ws){const d=new Date(p.date);if(dataset==="wind_raw"&&year!=null&&d.getFullYear()!==year)continue;if(month!=null&&d.getMonth()+1!==month)continue;set.add(d.getDate());}
    return Array.from(set).sort((a,b)=>a-b);
  },[solarData,windData,windRawData,dataset,year,month]);

  useEffect(()=>{if(month!=null&&!monthOptions.includes(month))setMonth(null);},[month,monthOptions]);
  useEffect(()=>{if(day!=null&&!dayOptions.includes(day))setDay(null);},[day,dayOptions]);

  const ptCount=dataset==="both"?`${parsedSolar.length.toLocaleString()} solar + ${parsedWind.length.toLocaleString()} wind`:`${(dataset==="solar"?parsedSolar:parsedWind).length.toLocaleString()} pts`;

  return (
    <div className="app">
      {/* Header */}
      <header className="app-header">
        <div className="header-brand">
          <div className="header-logo">⚡</div>
          <div><h1 className="header-title">Energy Explorer</h1><p className="header-sub">Solar &amp; Wind Dashboard</p></div>
        </div>
        <nav className="tab-nav">
          {([{id:"timeseries",label:"📈 Time Series"},{id:"optimization",label:"⚙ Optimization"}] as {id:typeof view;label:string}[]).map(tab=>(
            <button key={tab.id} type="button" id={`tab-${tab.id}`} className={`tab-btn ${view===tab.id?"active":""}`} onClick={()=>setView(tab.id)}>{tab.label}</button>
          ))}
        </nav>
      </header>

      <main className="app-main">
        {/* ══ TIME SERIES ══ */}
        {view==="timeseries" && (
          <>
            <div className="controls-bar">
              <div className="controls-group">
                <ControlSelect label="Dataset" value={dataset} onChange={v=>setDataset(v as Dataset)}>
                  <option value="solar">☀️ Solar (hourly)</option>
                  <option value="wind">🌬️ Wind (typical)</option>
                  <option value="wind_raw">🌀 Wind raw (yearly)</option>
                  <option value="both">⚡ Solar + Wind</option>
                </ControlSelect>
                {dataset==="wind_raw"&&<ControlSelect label="Year" value={year??""} onChange={v=>setYear(v?Number(v):null)}>
                  {(windRawData?.years??[]).map(y=><option key={y} value={y}>{y}</option>)}
                </ControlSelect>}
                <ControlSelect label="Month" value={month??""} onChange={v=>setMonth(v?Number(v):null)}>
                  <option value="">All</option>
                  {monthOptions.map(m=><option key={m} value={m}>{m.toString().padStart(2,"0")}</option>)}
                </ControlSelect>
                <ControlSelect label="Day" value={day??""} onChange={v=>setDay(v?Number(v):null)}>
                  <option value="">All</option>
                  {dayOptions.map(d=><option key={d} value={d}>{d.toString().padStart(2,"0")}</option>)}
                </ControlSelect>
              </div>
              <div className="controls-group">
                <div className="slider-wrap">
                  <div className="slider-header"><span>☀️ Solar scale</span><span className="slider-val">{solarScale.toFixed(1)}×</span></div>
                  <input type="range" min={0} max={3} step={0.1} value={solarScale} onChange={e=>setSolar(Number(e.target.value))}/>
                </div>
                <div className="slider-wrap">
                  <div className="slider-header"><span>🌬️ Wind scale</span><span className="slider-val">{windScale.toFixed(1)}×</span></div>
                  <input type="range" min={0} max={15} step={0.1} value={windScale} onChange={e=>setWind(Number(e.target.value))}/>
                </div>
              </div>
              <div className="controls-spacer"/>
              <span className="points-badge">{ptCount}</span>
            </div>

            <div style={{display:"flex",gap:20,flexWrap:"wrap"}}>
              <div style={{flex:"3 1 520px",display:"flex",flexDirection:"column",gap:16}}>
                {loading?<div className="state-box loading"><div className="spinner"/><span>Loading…</span></div>
                :error?<div className="state-box error"><span style={{fontSize:24}}>⚠️</span><span>{error}</span></div>
                :<div className="card" style={{padding:20}}>
                  <Chart series={{solar:dataset==="solar"||dataset==="both"?scaledSolar:undefined,wind:dataset==="wind"||dataset==="wind_raw"||dataset==="both"?scaledWind:undefined}}/>
                </div>}
                {!loading&&!error&&<>
                  {dataset==="solar"&&<Stats stats={computeStats(scaledSolar)} accent="var(--green)"/>}
                  {(dataset==="wind"||dataset==="wind_raw")&&<Stats stats={computeStats(scaledWind)} accent="var(--blue)"/>}
                  {dataset==="both"&&<div style={{display:"flex",flexDirection:"column",gap:12}}>
                    {scaledSolar.length>0&&<div><div className="section-eyebrow" style={{color:"var(--green)"}}>☀ Solar</div><Stats stats={computeStats(scaledSolar)} accent="var(--green)"/></div>}
                    {scaledWind.length>0&&<div><div className="section-eyebrow" style={{color:"var(--blue)"}}>🌬 Wind</div><Stats stats={computeStats(scaledWind)} accent="var(--blue)"/></div>}
                    {scaledTotal.length>0&&<div><div className="section-eyebrow" style={{color:"var(--yellow)"}}>⚡ Combined</div><Stats stats={computeStats(scaledTotal)} accent="var(--yellow)"/></div>}
                  </div>}
                </>}
              </div>
              {!loading&&!error&&<div style={{flex:"1 1 260px"}}><DataTable points={dataset==="wind"||dataset==="wind_raw"?scaledWind:scaledSolar} label={dataset==="solar"?"Solar":"Wind"}/></div>}
            </div>
          </>
        )}

        {/* ══ OPTIMIZATION ══ */}
        {view==="optimization" && (
          <div style={{width:"100%",maxWidth:1200,margin:"0 auto"}}>
            <OptimizationPanel/>
          </div>
        )}
      </main>
    </div>
  );
}

// ─── Optimization Panel ───────────────────────────────────────────────────────
function OptimizationPanel() {
  const { status, error, result, runOptimization } = useOptimization();
  const [optMonth, setOptMonth] = useState<number|null>(null);
  const [optDay,   setOptDay]   = useState<number|null>(null);
  const [showLog,  setShowLog]  = useState(false);

  const best = result?{s:result.bestS,w:result.bestW,b:result.bestB}:null;

  const monthOptions = useMemo(()=>{
    if (!result) return [] as number[];
    const set=new Set<number>();
    for(const p of result.series) set.add(new Date(p.date).getMonth()+1);
    return Array.from(set).sort((a,b)=>a-b);
  },[result]);

  const dayOptions = useMemo(()=>{
    if (!result) return [] as number[];
    const set=new Set<number>();
    for(const p of result.series){const d=new Date(p.date);if(optMonth!=null&&d.getMonth()+1!==optMonth)continue;set.add(d.getDate());}
    return Array.from(set).sort((a,b)=>a-b);
  },[result,optMonth]);

  const focusedSeries = useMemo(()=>{
    if (!result) return [] as SeriesPoint[];
    return result.series.filter((p:SeriesPoint)=>{
      const d=new Date(p.date);
      if(optMonth!=null&&d.getMonth()+1!==optMonth) return false;
      if(optDay!=null&&d.getDate()!==optDay) return false;
      return true;
    });
  },[result,optMonth,optDay]);

  const intervalStats = useMemo(()=>{
    if (!focusedSeries.length||!result) return null;
    const n=focusedSeries.length;
    return {
      avgProd: focusedSeries.reduce((a,p)=>a+p.productionCombined,0)/n,
      avgCurt: focusedSeries.reduce((a,p)=>a+p.curtailment,0)/n,
      avgShortfallFrac: focusedSeries.reduce((a,p)=>{ const diff=p.baseload-p.productionCombined; return a+(p.baseload>0?diff/p.baseload:0); },0)/n,
      totalCurtMwh: focusedSeries.reduce((a,p)=>a+p.curtailment,0),
      pctTimeShortfall: focusedSeries.filter(p=>p.productionCombined<p.baseload).length/n*100,
    };
  },[focusedSeries,result]);

  const dualZoneSeries = useMemo(()=>
    focusedSeries.map(p=>({date:p.date,production:p.productionCombined,baseload:p.baseload}))
  ,[focusedSeries]);

  return (
    <div className="opt-layout">
      {/* Header */}
      <div className="opt-header-card">
        <div className="opt-description-block">
          <div className="opt-eyebrow">⚙ Grid Search Optimization</div>
          <h2 className="opt-title">Solar + Wind Capacity Optimizer</h2>
          <p className="opt-desc">
            <strong>Question:</strong> Grid search over solar (S) and wind (W) capacities to maximize the achievable
            baseload B at roughly 10% yearly curtailment.<br/><br/>

            <strong>Constraint from the task brief — Annual curtailment ≤ 10%:</strong> For each (S, W) pair we find
            the highest B such that the fraction of production clipped above B over the full year stays at ~10%. This
            constraint comes directly from the problem statement.<br/><br/>

            <strong>My additional assumption — Daily coverage floor ≥ 70% of B:</strong> The annual constraint alone
            produced unrealistic results: the optimizer would pick very peaky solar with little or no wind, which looks
            fine on paper (annual energy is high) but leaves people without electricity during the night and early morning.
            I added the requirement that the average daily production must be at least 70% of B across the year. This
            forces the algorithm to prefer mixes that keep production reasonably close to the promised baseload throughout
            the day — because it is physically unreasonable to guarantee a baseload that demand consistently cannot be
            met by. Only (S, W) pairs that satisfy both constraints are eligible; among those we pick the highest B.<br/><br/>

            <strong>Curtailment</strong> = surplus above baseload (shown in <span style={{color:"#fb923c",fontWeight:600}}>orange</span>) ·{" "}
            <strong>Shortfall</strong> = gap below baseload (shown in <span style={{color:"#f87171",fontWeight:600}}>red</span>).
          </p>
        </div>
        <div className="opt-actions">
          <button id="btn-run-opt" type="button" className="btn btn-primary" onClick={()=>runOptimization({targetCurtailment:0.1,stepMw:10})} disabled={status==="running"}>
            <span className="btn-icon">{status==="running"?"⏳":"▶"}</span>{status==="running"?"Running…":"Run Optimization"}
          </button>
          {result?.gridSamples?.length&&<button id="btn-view-log" type="button" className="btn btn-secondary" onClick={()=>setShowLog(true)}><span className="btn-icon">📋</span>Log ({result.gridSamples.length})</button>}
        </div>
      </div>

      {status==="running"&&<div className="running-banner"><div className="spinner" style={{width:20,height:20,borderWidth:2}}/> Running grid search… this may take a few seconds.</div>}
      {error&&<div className="error-banner">⚠️ {error}</div>}

      {/* Best result */}
      {best&&<>
        <div className="section-eyebrow">🏆 Best Result</div>
        <div className="stats-grid">
          {[{label:"Solar Capacity",value:`${best.s.toFixed(1)} MW`,icon:"☀️"},{label:"Wind Capacity",value:`${best.w.toFixed(1)} MW`,icon:"🌬️"},{label:"Baseload",value:`${best.b.toFixed(1)} MW`,icon:"⚡"}].map(item=>(
            <div key={item.label} className="result-card">
              <div className="result-label">{item.icon} {item.label}</div>
              <div className="result-value">{item.value}</div>
            </div>
          ))}
        </div>
      </>}

      {/* What-if explorer */}
      {result?.gridSamples?.length&&<WhatIfExplorer gridSamples={result.gridSamples} bestS={result.bestS} bestW={result.bestW} bestB={result.bestB}/>}

      {/* Month/Day filter + chart area */}
      {result&&(
        <>
          <div className="controls-bar" style={{flexWrap:"wrap",gap:12}}>
            <span style={{fontSize:11,fontWeight:700,letterSpacing:".08em",textTransform:"uppercase",color:"var(--text-muted)"}}>🔍 Focus on</span>
            <div className="controls-group">
              <label className="control-label">Month
                <select id="opt-month" className="control-select" value={optMonth??""} onChange={e=>setOptMonth(e.target.value?Number(e.target.value):null)}>
                  <option value="">All</option>
                  {monthOptions.map(m=><option key={m} value={m}>{m.toString().padStart(2,"0")}</option>)}
                </select>
              </label>
              <label className="control-label">Day
                <select id="opt-day" className="control-select" value={optDay??""} onChange={e=>setOptDay(e.target.value?Number(e.target.value):null)}>
                  <option value="">All</option>
                  {dayOptions.map(d=><option key={d} value={d}>{d.toString().padStart(2,"0")}</option>)}
                </select>
              </label>
            </div>
            {focusedSeries.length>0&&<span className="points-badge">{focusedSeries.length.toLocaleString()} hours</span>}
          </div>

          {/* Summary stats for focused interval */}
          {intervalStats&&<>
            <div className="section-eyebrow">📊 Focused Interval</div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(180px,1fr))",gap:12}}>
              {[
                {label:"Avg Production",value:`${intervalStats.avgProd.toFixed(2)} MW`,icon:"⚡",color:"#22d3a5"},
                {label:"Avg Curtailment",value:`${intervalStats.avgCurt.toFixed(2)} MW`,icon:"✂️",color:"#fb923c"},
                {label:"Avg Shortfall",value:`${(intervalStats.avgShortfallFrac*100).toFixed(1)} %`,icon:"📉",color:"#f87171"},
                {label:"% Hours in Deficit",value:`${intervalStats.pctTimeShortfall.toFixed(1)} %`,icon:"🔴",color:intervalStats.pctTimeShortfall>30?"#f87171":"#fb923c"},
              ].map(item=>(
                <div key={item.label} className="stat-card">
                  <div className="stat-icon" style={{color:item.color}}>{item.icon}</div>
                  <div className="stat-label">{item.label}</div>
                  <div className="stat-value" style={{fontSize:18,color:item.color}}>{item.value}</div>
                </div>
              ))}
            </div>
          </>}

          {/* Main dual-zone chart */}
          {dualZoneSeries.length>0&&<>
            <div className="section-eyebrow">📈 Production vs Baseload</div>
            <div className="card" style={{padding:"20px 24px"}}>
              <DualZoneChart series={dualZoneSeries}/>
            </div>
          </>}

          {/* Two small charts */}
          {focusedSeries.length>0&&<div className="two-col">
            <div>
              <div className="section-eyebrow" style={{color:"#fb923c"}}>✂️ Curtailment above Baseload (MW)</div>
              <div className="card" style={{padding:"16px 20px"}}>
                <Chart series={{solar:focusedSeries.map(p=>({date:p.date,value:p.curtailment}))}} labels={{solar:"Curtailment"}} unit="MW"/>
              </div>
            </div>
            <div>
              <div className="section-eyebrow" style={{color:"#f87171"}}>📉 Shortfall fraction vs Baseload</div>
              <div className="card" style={{padding:"16px 20px"}}>
                <Chart series={{solar:focusedSeries.map(p=>({date:p.date,value:p.baseload>0?(p.baseload-p.productionCombined)/p.baseload:0}))}} labels={{solar:"Shortfall"}} unit=""/>
              </div>
            </div>
          </div>}
        </>
      )}

      {/* Log modal */}
      {showLog&&result?.gridSamples&&(
        <div className="modal-backdrop" onClick={()=>setShowLog(false)}>
          <div className="modal" onClick={e=>e.stopPropagation()}>
            <div className="modal-header">
              <div><h3 className="modal-title">📋 Optimization Log</h3><p className="modal-sub">{result.gridSamples.length} combinations — best highlighted</p></div>
              <button id="btn-close-log" type="button" className="btn btn-secondary" onClick={()=>setShowLog(false)} style={{padding:"6px 14px"}}>✕ Close</button>
            </div>
            <div className="modal-body">
              <table className="opt-table">
                <thead><tr>{["S (MW)","W (MW)","Baseload (MW)","Daily avg (MW)","Error (%)"].map(h=><th key={h}>{h}</th>)}</tr></thead>
                <tbody>
                  {result.gridSamples.map((s,i)=>(
                    <tr key={i} className={s.sMw===result.bestS&&s.wMw===result.bestW?"best":""}>
                      <td>{s.sMw.toFixed(1)}</td><td>{s.wMw.toFixed(1)}</td><td>{s.baseloadMw.toFixed(2)}</td>
                      <td>{s.dailyAvgProductionMw!=null?s.dailyAvgProductionMw.toFixed(2):"—"}</td>
                      <td>{s.dailyErrorPct!=null?(s.dailyErrorPct*100).toFixed(2):"—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
