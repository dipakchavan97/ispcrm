'use client';

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Activity,
  ArrowDown,
  ArrowUp,
  Router as RouterIcon,
  Wifi,
  AlertTriangle,
  RefreshCw,
  SlidersHorizontal,
  Radio,
  Cpu,
  HardDrive,
  Clock,
  Users,
  Server,
  Play,
  Pause,
  Layers,
} from 'lucide-react';
import { apiFetch } from '../../lib/api';

interface RouterItem {
  id: string;
  name: string;
  host: string;
  port: number;
  status: 'ONLINE' | 'OFFLINE' | 'UNREACHABLE' | 'ERROR';
  model?: string | null;
  rosVersion?: string | null;
  lastSeen?: string | null;
  capabilities?: any;
}

interface RouterInterface {
  name: string;
  type: string;
  running: boolean;
  disabled: boolean;
  comment?: string;
  macAddress?: string;
}

interface InterfaceTraffic {
  name: string;
  rxBps: number;
  txBps: number;
  rxPacketsPerSecond?: number;
  txPacketsPerSecond?: number;
}

interface SystemResources {
  platform?: string;
  boardName?: string;
  version: string;
  uptime: string;
  cpuLoad: number;
  totalMemory: number;
  freeMemory: number;
  totalHddSpace: number;
  freeHddSpace: number;
  architectureName?: string;
  cpuCount?: number;
  cpuFrequency?: number;
  isStale?: boolean;
}

interface ActivePppSession {
  id?: string;
  name: string;
  service: string;
  address: string;
  uptime: string;
}

interface TrafficSample {
  timestamp: number;
  rxBps: number;
  txBps: number;
  rxPps: number;
  txPps: number;
}

// ---------------------------------------------------------------------------
// Human-readable formatters (Zero fake numbers, authentic rates only)
// ---------------------------------------------------------------------------

function formatBps(bps: number): { value: string; unit: string } {
  if (!bps || isNaN(bps) || bps <= 0) return { value: '0.0', unit: 'Mbps' };
  if (bps >= 1_000_000_000) {
    return { value: (bps / 1_000_000_000).toFixed(2), unit: 'Gbps' };
  }
  if (bps >= 1_000_000) {
    return { value: (bps / 1_000_000).toFixed(1), unit: 'Mbps' };
  }
  if (bps >= 1_000) {
    return { value: (bps / 1_000).toFixed(1), unit: 'Kbps' };
  }
  return { value: bps.toFixed(0), unit: 'bps' };
}

function formatBytes(bytes: number): string {
  if (!bytes || isNaN(bytes) || bytes <= 0) return '0 MB';
  if (bytes >= 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  }
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(0)} MB`;
  }
  return `${(bytes / 1024).toFixed(0)} KB`;
}

function formatPps(pps?: number): string {
  if (!pps || isNaN(pps)) return '0';
  if (pps >= 1_000_000) return `${(pps / 1_000_000).toFixed(1)}M`;
  if (pps >= 1_000) return `${(pps / 1_000).toFixed(1)}k`;
  return pps.toLocaleString();
}

function formatUptime(uptimeStr?: string): string {
  if (!uptimeStr) return '0s';
  return uptimeStr
    .replace(/(\d+w)/g, '$1 ')
    .replace(/(\d+d)/g, '$1 ')
    .replace(/(\d+h)/g, '$1 ')
    .replace(/(\d+m)/g, '$1 ')
    .trim();
}

// ---------------------------------------------------------------------------
// Speedometer Radial Gauge Component (Grafana / ISP NOC Style)
// ---------------------------------------------------------------------------

function SpeedometerGauge({
  label,
  direction,
  bps,
  maxBps,
  peakBps,
  pps,
  isStale,
  isOffline,
}: {
  label: string;
  direction: 'down' | 'up';
  bps: number;
  maxBps: number;
  peakBps: number;
  pps?: number;
  isStale: boolean;
  isOffline: boolean;
}) {
  const { value, unit } = formatBps(bps);
  const peakFormatted = formatBps(peakBps);
  const scaleFormatted = formatBps(maxBps);

  // 240 degree gauge (from 150° to 390°)
  const radius = 60;
  const strokeWidth = 10;
  const totalAngle = 240;
  const totalArc = (totalAngle / 360) * (2 * Math.PI * radius); // ~251.3
  const ratio = isOffline ? 0 : maxBps > 0 ? Math.min(Math.max(bps / maxBps, 0), 1) : 0;
  const filledArc = ratio * totalArc;
  const strokeDashoffset = totalArc - filledArc;

  const isDown = direction === 'down';
  const glowColor = isDown ? 'rgba(6, 182, 212, 0.45)' : 'rgba(139, 92, 246, 0.45)';

  // Generate 9 gauge tick marks around the 240° arc
  const ticks = useMemo(() => {
    const tickCount = 9;
    const items = [];
    const startAngle = 150;
    const step = totalAngle / (tickCount - 1);
    for (let i = 0; i < tickCount; i++) {
      const angleDeg = startAngle + i * step;
      const angleRad = (angleDeg * Math.PI) / 180;
      const cx = 80;
      const cy = 76;
      const r1 = radius - 16;
      const r2 = radius - 10;
      const x1 = cx + r1 * Math.cos(angleRad);
      const y1 = cy + r1 * Math.sin(angleRad);
      const x2 = cx + r2 * Math.cos(angleRad);
      const y2 = cy + r2 * Math.sin(angleRad);
      items.push({ x1, y1, x2, y2 });
    }
    return items;
  }, [radius, totalAngle]);

  return (
    <div className="flex flex-col items-center justify-between p-3.5 sm:p-4 rounded-xl bg-slate-950/60 border border-slate-800/90 shadow-lg relative overflow-hidden group">
      {/* Top Header Label */}
      <div className="flex items-center justify-between w-full mb-1">
        <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider">
          {isDown ? (
            <div className="h-5 w-5 rounded-md bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-cyan-400">
              <ArrowDown className="h-3.5 w-3.5" />
            </div>
          ) : (
            <div className="h-5 w-5 rounded-md bg-purple-500/10 border border-purple-500/30 flex items-center justify-center text-purple-400">
              <ArrowUp className="h-3.5 w-3.5" />
            </div>
          )}
          <span className="text-slate-300 font-semibold">{label}</span>
        </div>

        {isStale && !isOffline && (
          <span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-amber-500/15 border border-amber-500/30 text-amber-400">
            STALE
          </span>
        )}
      </div>

      {/* SVG Radial Speedometer Gauge */}
      <div className="relative w-40 h-36 flex items-center justify-center my-0.5">
        <svg className="w-40 h-40 -rotate-[210deg]" viewBox="0 0 160 160">
          <defs>
            <linearGradient id={`gauge-grad-${direction}`} x1="0%" y1="0%" x2="100%" y2="100%">
              {isDown ? (
                <>
                  <stop offset="0%" stopColor="#06b6d4" />
                  <stop offset="100%" stopColor="#10b981" />
                </>
              ) : (
                <>
                  <stop offset="0%" stopColor="#8b5cf6" />
                  <stop offset="100%" stopColor="#38bdf8" />
                </>
              )}
            </linearGradient>
          </defs>

          {/* Background Track */}
          <circle
            cx="80"
            cy="80"
            r={radius}
            fill="none"
            stroke="currentColor"
            className="text-slate-800/80"
            strokeWidth={strokeWidth}
            strokeDasharray={`${totalArc} 999`}
            strokeLinecap="round"
          />

          {/* Active Value Arc */}
          {!isOffline && (
            <circle
              cx="80"
              cy="80"
              r={radius}
              fill="none"
              stroke={`url(#gauge-grad-${direction})`}
              strokeWidth={strokeWidth}
              strokeDasharray={`${totalArc} 999`}
              strokeDashoffset={strokeDashoffset}
              strokeLinecap="round"
              style={{
                transition: 'stroke-dashoffset 0.6s cubic-bezier(0.4, 0, 0.2, 1)',
                filter: `drop-shadow(0 0 8px ${glowColor})`,
              }}
            />
          )}

          {/* Speedometer Radial Ticks */}
          {ticks.map((t, idx) => (
            <line
              key={idx}
              x1={t.x1}
              y1={t.y1}
              x2={t.x2}
              y2={t.y2}
              stroke="currentColor"
              className="text-slate-700/60"
              strokeWidth="1.5"
            />
          ))}
        </svg>

        {/* Center Digital Odometer Readout */}
        <div className="absolute inset-0 flex flex-col items-center justify-center pt-2 pointer-events-none text-center">
          {isOffline ? (
            <>
              <AlertTriangle className="h-6 w-6 text-rose-400 mb-1" />
              <span className="text-xs font-bold uppercase tracking-wider text-rose-400">Offline</span>
            </>
          ) : (
            <>
              <span className="text-2xl sm:text-3xl font-extrabold font-mono tracking-tight text-white leading-none drop-shadow-md">
                {value}
              </span>
              <span
                className={`text-xs font-bold tracking-wider mt-1 uppercase font-mono ${
                  isDown ? 'text-cyan-400' : 'text-purple-400'
                }`}
              >
                {unit}
              </span>
            </>
          )}
        </div>
      </div>

      {/* Footer Metrics: Peak, Pkt Rate, Adaptive Scale */}
      <div className="w-full grid grid-cols-2 gap-2 pt-2 border-t border-slate-800/80 text-[11px] font-mono">
        <div className="flex flex-col">
          <span className="text-[10px] text-slate-400">Peak Observed</span>
          <span className="font-bold text-slate-200">
            {peakFormatted.value} {peakFormatted.unit}
          </span>
        </div>
        <div className="flex flex-col text-right">
          <span className="text-[10px] text-slate-400">Packets</span>
          <span className="font-bold text-slate-200">{formatPps(pps)}/s</span>
        </div>
      </div>
      <div className="w-full text-center mt-1.5 text-[9px] font-mono text-slate-400">
        Scale: 0 – {scaleFormatted.value} {scaleFormatted.unit}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pure SVG Rolling Realtime Horizon Area & Line Graph (90s window)
// ---------------------------------------------------------------------------

function RollingTrafficGraph({
  samples,
  maxBps,
  isStale,
  isOffline,
}: {
  samples: TrafficSample[];
  maxBps: number;
  isStale: boolean;
  isOffline: boolean;
}) {
  const width = 720;
  const height = 190;
  const padLeft = 68;
  const padRight = 24;
  const padTop = 16;
  const padBottom = 28;

  const chartW = width - padLeft - padRight;
  const chartH = height - padTop - padBottom;

  const [hoveredSample, setHoveredSample] = useState<TrafficSample | null>(null);
  const [hoverX, setHoverX] = useState<number | null>(null);

  // 30 slots spaced evenly across 90 seconds (each tick ~3s)
  const numSlots = 30;
  const points = useMemo(() => {
    const filled: TrafficSample[] = [];
    const missing = numSlots - samples.length;
    for (let i = 0; i < missing; i++) {
      filled.push({ timestamp: 0, rxBps: 0, txBps: 0, rxPps: 0, txPps: 0 });
    }
    const combined = [...filled, ...samples];

    return combined.map((s, idx) => {
      const x = padLeft + (idx / (numSlots - 1)) * chartW;
      const rxRatio = maxBps > 0 ? Math.min(s.rxBps / maxBps, 1) : 0;
      const txRatio = maxBps > 0 ? Math.min(s.txBps / maxBps, 1) : 0;
      const rxY = padTop + chartH - rxRatio * chartH;
      const txY = padTop + chartH - txRatio * chartH;
      return { x, rxY, txY, s };
    });
  }, [samples, maxBps, chartW, chartH, padLeft, padTop]);

  // Cubic Bézier smoothing
  const rxPath = useMemo(() => {
    if (points.length < 2) return '';
    let d = `M ${points[0].x} ${points[0].rxY}`;
    for (let i = 0; i < points.length - 1; i++) {
      const curr = points[i];
      const next = points[i + 1];
      const cx1 = curr.x + (next.x - curr.x) / 2;
      const cy1 = curr.rxY;
      const cx2 = curr.x + (next.x - curr.x) / 2;
      const cy2 = next.rxY;
      d += ` C ${cx1} ${cy1}, ${cx2} ${cy2}, ${next.x} ${next.rxY}`;
    }
    return d;
  }, [points]);

  const rxAreaPath = useMemo(() => {
    if (!rxPath || points.length < 2) return '';
    const bottomY = padTop + chartH;
    return `${rxPath} L ${points[points.length - 1].x} ${bottomY} L ${points[0].x} ${bottomY} Z`;
  }, [rxPath, points, padTop, chartH]);

  const txPath = useMemo(() => {
    if (points.length < 2) return '';
    let d = `M ${points[0].x} ${points[0].txY}`;
    for (let i = 0; i < points.length - 1; i++) {
      const curr = points[i];
      const next = points[i + 1];
      const cx1 = curr.x + (next.x - curr.x) / 2;
      const cy1 = curr.txY;
      const cx2 = curr.x + (next.x - curr.x) / 2;
      const cy2 = next.txY;
      d += ` C ${cx1} ${cy1}, ${cx2} ${cy2}, ${next.x} ${next.txY}`;
    }
    return d;
  }, [points]);

  const txAreaPath = useMemo(() => {
    if (!txPath || points.length < 2) return '';
    const bottomY = padTop + chartH;
    return `${txPath} L ${points[points.length - 1].x} ${bottomY} L ${points[0].x} ${bottomY} Z`;
  }, [txPath, points, padTop, chartH]);

  // Y-axis ticks
  const yTicks = [
    { ratio: 1.0, bps: maxBps },
    { ratio: 0.66, bps: maxBps * 0.66 },
    { ratio: 0.33, bps: maxBps * 0.33 },
    { ratio: 0.0, bps: 0 },
  ];

  const latestSample = samples[samples.length - 1];

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = ((e.clientX - rect.left) / rect.width) * width;
    if (clickX >= padLeft && clickX <= padLeft + chartW) {
      let nearest = points[0];
      let minDist = Math.abs(points[0].x - clickX);
      for (let i = 1; i < points.length; i++) {
        const dist = Math.abs(points[i].x - clickX);
        if (dist < minDist) {
          minDist = dist;
          nearest = points[i];
        }
      }
      if (nearest && nearest.s.timestamp > 0) {
        setHoveredSample(nearest.s);
        setHoverX(nearest.x);
      }
    }
  };

  const handleMouseLeave = () => {
    setHoveredSample(null);
    setHoverX(null);
  };

  return (
    <div className="w-full overflow-hidden rounded-xl bg-slate-950/60 border border-slate-800/90 p-3.5 sm:p-4 shadow-lg">
      {/* Graph Header & Legend */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-4 text-xs">
          <div className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm bg-cyan-400 shadow-sm" />
            <span className="font-semibold text-slate-300">Download (Rx)</span>
            {latestSample && (
              <span className="font-mono text-cyan-400 font-bold ml-1">
                {formatBps(latestSample.rxBps).value} {formatBps(latestSample.rxBps).unit}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm bg-purple-400 shadow-sm" />
            <span className="font-semibold text-slate-300">Upload (Tx)</span>
            {latestSample && (
              <span className="font-mono text-purple-400 font-bold ml-1">
                {formatBps(latestSample.txBps).value} {formatBps(latestSample.txBps).unit}
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {hoveredSample ? (
            <span className="text-[10px] font-mono text-cyan-300 bg-cyan-950/40 border border-cyan-800/40 px-2 py-0.5 rounded">
              Point: &darr;{formatBps(hoveredSample.rxBps).value} {formatBps(hoveredSample.rxBps).unit} | &uarr;{formatBps(hoveredSample.txBps).value} {formatBps(hoveredSample.txBps).unit}
            </span>
          ) : (
            <span className="text-[10px] font-mono text-slate-400">
              90s Live Horizon &bull; 3s Sampling
            </span>
          )}
        </div>
      </div>

      {/* SVG Canvas */}
      <div className="relative w-full h-44 sm:h-52">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="w-full h-full cursor-crosshair"
          preserveAspectRatio="none"
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
        >
          <defs>
            <linearGradient id="rxAreaGrad" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#06b6d4" stopOpacity="0.28" />
              <stop offset="100%" stopColor="#06b6d4" stopOpacity="0.0" />
            </linearGradient>
            <linearGradient id="txAreaGrad" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#8b5cf6" stopOpacity="0.22" />
              <stop offset="100%" stopColor="#8b5cf6" stopOpacity="0.0" />
            </linearGradient>
          </defs>

          {/* Y-axis Grid Lines & Labels */}
          {yTicks.map((tick, idx) => {
            const y = padTop + chartH - tick.ratio * chartH;
            const { value, unit } = formatBps(tick.bps);
            return (
              <g key={idx}>
                <line
                  x1={padLeft}
                  y1={y}
                  x2={width - padRight}
                  y2={y}
                  stroke="currentColor"
                  className="text-slate-800/70"
                  strokeDasharray="3 3"
                  strokeWidth="1"
                />
                <text
                  x={padLeft - 8}
                  y={y + 3}
                  textAnchor="end"
                  className="text-[9px] fill-slate-400 font-mono font-medium"
                >
                  {value} {unit}
                </text>
              </g>
            );
          })}

          {/* Baseline */}
          <line
            x1={padLeft}
            y1={padTop + chartH}
            x2={width - padRight}
            y2={padTop + chartH}
            stroke="currentColor"
            className="text-slate-700/80"
            strokeWidth="1.2"
          />

          {/* X-axis Timeline Marks */}
          {[
            { label: '-90s', x: padLeft },
            { label: '-60s', x: padLeft + chartW * 0.33 },
            { label: '-30s', x: padLeft + chartW * 0.66 },
            { label: 'NOW', x: padLeft + chartW },
          ].map((mark, idx) => (
            <text
              key={idx}
              x={mark.x}
              y={height - 8}
              textAnchor={idx === 0 ? 'start' : idx === 3 ? 'end' : 'middle'}
              className="text-[9px] fill-slate-400 font-mono font-semibold"
            >
              {mark.label}
            </text>
          ))}

          {/* Download (Rx) Path & Gradient Area */}
          {rxAreaPath && <path d={rxAreaPath} fill="url(#rxAreaGrad)" />}
          {rxPath && (
            <path
              d={rxPath}
              fill="none"
              stroke="#06b6d4"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}

          {/* Upload (Tx) Path & Gradient Area */}
          {txAreaPath && <path d={txAreaPath} fill="url(#txAreaGrad)" />}
          {txPath && (
            <path
              d={txPath}
              fill="none"
              stroke="#8b5cf6"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}

          {/* Hover Vertical Line */}
          {hoverX !== null && (
            <line
              x1={hoverX}
              y1={padTop}
              x2={hoverX}
              y2={padTop + chartH}
              stroke="#e2e8f0"
              strokeDasharray="2 2"
              strokeWidth="1"
              opacity="0.8"
            />
          )}

          {/* Pulsing Coordinates Node on Current Sample */}
          {points.length > 0 && points[points.length - 1].s.timestamp > 0 && !isOffline && (
            <>
              <circle
                cx={points[points.length - 1].x}
                cy={points[points.length - 1].rxY}
                r="4.5"
                fill="#06b6d4"
                className="animate-ping opacity-75"
              />
              <circle
                cx={points[points.length - 1].x}
                cy={points[points.length - 1].rxY}
                r="3.5"
                fill="#06b6d4"
              />
              <circle
                cx={points[points.length - 1].x}
                cy={points[points.length - 1].txY}
                r="3.5"
                fill="#8b5cf6"
              />
            </>
          )}
        </svg>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Hardware Health Tile (Row 3 NOC Metric)
// ---------------------------------------------------------------------------

function HealthTile({
  icon: Icon,
  label,
  value,
  subtext,
  percent,
  badge,
  badgeColor = 'emerald',
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  subtext?: string;
  percent?: number;
  badge?: string;
  badgeColor?: 'emerald' | 'amber' | 'rose' | 'blue';
}) {
  const getBarColor = (p?: number) => {
    if (p === undefined) return 'bg-blue-500';
    if (p > 80) return 'bg-rose-500';
    if (p > 50) return 'bg-amber-500';
    return 'bg-emerald-500';
  };

  const getBadgeClasses = (color: string) => {
    switch (color) {
      case 'rose':
        return 'bg-rose-500/10 border-rose-500/30 text-rose-400';
      case 'amber':
        return 'bg-amber-500/10 border-amber-500/30 text-amber-400';
      case 'blue':
        return 'bg-blue-500/10 border-blue-500/30 text-blue-400';
      default:
        return 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400';
    }
  };

  return (
    <div className="bg-slate-950/50 border border-slate-800/80 rounded-xl p-3 flex flex-col justify-between shadow-sm min-w-0">
      <div className="flex items-center justify-between gap-1 mb-1.5">
        <div className="flex items-center gap-1.5 text-slate-400 text-xs font-semibold uppercase tracking-wider truncate">
          <Icon className="h-3.5 w-3.5 text-blue-400 shrink-0" />
          <span className="truncate">{label}</span>
        </div>
        {badge && (
          <span
            className={`px-1.5 py-0.2 rounded text-[9px] font-mono font-bold border uppercase shrink-0 ${getBadgeClasses(
              badgeColor,
            )}`}
          >
            {badge}
          </span>
        )}
      </div>

      <div className="my-0.5">
        <span className="text-base sm:text-lg font-bold text-white font-mono tracking-tight truncate block">
          {value}
        </span>
        {subtext && (
          <p className="text-[10px] text-slate-400 font-mono mt-0.5 truncate">{subtext}</p>
        )}
      </div>

      {percent !== undefined && (
        <div className="w-full bg-slate-800/80 h-1.5 rounded-full overflow-hidden mt-1.5">
          <div
            className={`h-full transition-all duration-500 ${getBarColor(percent)}`}
            style={{ width: `${Math.min(Math.max(percent, 0), 100)}%` }}
          />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Live Router Traffic Widget
// ---------------------------------------------------------------------------

export function LiveRouterTrafficWidget() {
  const [selectedRouterId, setSelectedRouterId] = useState<string>('');
  const [selectedInterface, setSelectedInterface] = useState<string>('');
  const [history, setHistory] = useState<TrafficSample[]>([]);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date | null>(null);
  const [isPaused, setIsPaused] = useState<boolean>(false);

  // Peak tracking across current session
  const [sessionPeakRx, setSessionPeakRx] = useState<number>(0);
  const [sessionPeakTx, setSessionPeakTx] = useState<number>(0);

  // 1. Fetch Tenant Routers
  const { data: routers = [], isLoading: isLoadingRouters } = useQuery<RouterItem[]>({
    queryKey: ['routers'],
    queryFn: () => apiFetch<RouterItem[]>('/routers'),
    staleTime: 60000,
  });

  // Auto-select primary or first online router
  useEffect(() => {
    if (routers.length > 0 && !selectedRouterId) {
      const online = routers.find((r) => r.status === 'ONLINE');
      setSelectedRouterId(online ? online.id : routers[0].id);
    }
  }, [routers, selectedRouterId]);

  // 2. Fetch Interfaces for selected router
  const { data: rawInterfaces = [], isLoading: isLoadingInterfaces } = useQuery<RouterInterface[]>({
    queryKey: ['router-interfaces', selectedRouterId],
    queryFn: () => apiFetch<RouterInterface[]>(`/routers/${selectedRouterId}/interfaces`),
    enabled: Boolean(selectedRouterId),
    staleTime: 30000,
    refetchInterval: (query) => (query.state.data && query.state.data.length > 0 ? false : 10000),
  });

  // Filter interfaces: separate physical/trunk interfaces from the ~100 dynamic <pppoe-*> sessions
  const { physicalInterfaces, pppoeInterfaces } = useMemo(() => {
    const physical: RouterInterface[] = [];
    const pppoe: RouterInterface[] = [];

    (rawInterfaces || []).forEach((iface) => {
      if (iface.name.startsWith('<pppoe')) {
        pppoe.push(iface);
      } else {
        physical.push(iface);
      }
    });

    return { physicalInterfaces: physical, pppoeInterfaces: pppoe };
  }, [rawInterfaces]);

  // Smart Auto-selection of WAN / Uplink interface
  useEffect(() => {
    if (rawInterfaces && rawInterfaces.length > 0) {
      const currentExists = rawInterfaces.some((i) => i.name === selectedInterface);
      if (!currentExists) {
        // Look for running WAN or SFP interface
        const running = rawInterfaces.filter((i) => i.running && !i.disabled);
        const wanCandidate = running.find(
          (i) =>
            i.comment?.toLowerCase().includes('wan') ||
            i.name.toLowerCase().includes('sfp') ||
            i.name.toLowerCase().includes('wan') ||
            i.name.toLowerCase().includes('ether1')
        );

        setSelectedInterface(
          wanCandidate
            ? wanCandidate.name
            : running[0]?.name || physicalInterfaces[0]?.name || rawInterfaces[0].name
        );
        setHistory([]);
      }
    }
  }, [rawInterfaces, physicalInterfaces, selectedInterface]);

  // 3. Poll Real Interface Traffic (Every 3 seconds, stops on tab blur or when paused)
  const {
    data: trafficData,
    isError: isTrafficError,
    error: trafficError,
    refetch: refetchTraffic,
  } = useQuery<InterfaceTraffic>({
    queryKey: ['router-traffic', selectedRouterId, selectedInterface],
    queryFn: async () => {
      if (!selectedRouterId || !selectedInterface || !selectedInterface.trim()) {
        return null as any;
      }
      return apiFetch<InterfaceTraffic>(
        `/routers/${selectedRouterId}/interfaces/${encodeURIComponent(selectedInterface)}/traffic`
      );
    },
    enabled: Boolean(selectedRouterId && selectedInterface && selectedInterface.trim().length > 0 && !isPaused),
    refetchInterval: isPaused ? false : 5000,
    refetchIntervalInBackground: false,
    retry: 0,
  });

  // 4. Poll Router System Resources (Every 10 seconds to avoid CPU strain)
  const { data: sysResources, isError: isSysError } = useQuery<SystemResources>({
    queryKey: ['router-resources', selectedRouterId],
    queryFn: () => apiFetch<SystemResources>(`/routers/${selectedRouterId}/system-resources`),
    enabled: Boolean(selectedRouterId),
    refetchInterval: 10000,
    refetchIntervalInBackground: false,
    retry: 1,
  });

  // 5. Poll Active PPPoE Sessions Count (Every 10 seconds)
  const { data: pppSessions = [] } = useQuery<ActivePppSession[]>({
    queryKey: ['router-active-ppp', selectedRouterId],
    queryFn: () => apiFetch<ActivePppSession[]>(`/routers/${selectedRouterId}/active-ppp-sessions`),
    enabled: Boolean(selectedRouterId),
    refetchInterval: 10000,
    refetchIntervalInBackground: false,
    retry: 1,
  });

  // Append new sample to rolling history (max 30 samples = 90 seconds)
  useEffect(() => {
    if (trafficData && !isPaused) {
      const rx = Number(trafficData.rxBps) || 0;
      const tx = Number(trafficData.txBps) || 0;

      const newSample: TrafficSample = {
        timestamp: Date.now(),
        rxBps: rx,
        txBps: tx,
        rxPps: Number(trafficData.rxPacketsPerSecond) || 0,
        txPps: Number(trafficData.txPacketsPerSecond) || 0,
      };

      setHistory((prev) => {
        const next = [...prev, newSample];
        return next.slice(-30);
      });

      setSessionPeakRx((prev) => Math.max(prev, rx));
      setSessionPeakTx((prev) => Math.max(prev, tx));
      setLastRefreshedAt(new Date());
    }
  }, [trafficData, isPaused]);

  // Compute adaptive peak scale with 20% headroom
  const peakBps = useMemo(() => {
    let max = 10_000_000; // minimum 10 Mbps scale baseline
    history.forEach((s) => {
      if (s.rxBps > max) max = s.rxBps;
      if (s.txBps > max) max = s.txBps;
    });
    return max * 1.2;
  }, [history]);

  const activeRouter = routers.find((r) => r.id === selectedRouterId);
  const currentRx = trafficData ? Number(trafficData.rxBps) || 0 : 0;
  const currentTx = trafficData ? Number(trafficData.txBps) || 0 : 0;

  // Determine State: LIVE, CONNECTING, DEGRADED/RETRYING, UNREACHABLE, STALE
  const caps = (activeRouter?.capabilities as any) || {};
  const consecutiveFailures = Number(caps.consecutiveFailures || 0);

  // Confirmed failure: 3 or more consecutive failures or explicit DB UNREACHABLE/OFFLINE
  const isConfirmedFailure =
    consecutiveFailures >= 3 ||
    activeRouter?.status === 'OFFLINE' ||
    activeRouter?.status === 'UNREACHABLE';

  // Transient failure: 1 or 2 probe failures, marked degraded/stale in capabilities, or temporary error
  const isTransientFailure =
    !isConfirmedFailure &&
    (consecutiveFailures > 0 ||
      Boolean(caps.isDegraded) ||
      Boolean(caps.isStale) ||
      Boolean(sysResources?.isStale) ||
      activeRouter?.status === 'ERROR');

  const isStale = Boolean(
    (!isConfirmedFailure && sysResources?.isStale) ||
    (!isConfirmedFailure && isTransientFailure) ||
    (isTrafficError && history.length > 0 && !isConfirmedFailure)
  );

  const isConnecting = isLoadingRouters || (isLoadingInterfaces && !activeRouter);
  const isLive = !isConfirmedFailure && !isTransientFailure && !isConnecting && Boolean(trafficData);

  // Selected interface object
  const activeInterfaceObj = rawInterfaces.find((i) => i.name === selectedInterface);

  // RAM calculations (preserve cached values if live poll temporarily fails)
  const totalMemory = sysResources?.totalMemory || caps.totalMemory || 0;
  const freeMemory = sysResources?.freeMemory || caps.freeMemory || 0;
  const usedMemory = Math.max(totalMemory - freeMemory, 0);
  const memoryPercent = totalMemory > 0 ? Math.round((usedMemory / totalMemory) * 100) : undefined;
  const effectiveCpuLoad = sysResources?.cpuLoad !== undefined ? sysResources.cpuLoad : caps.cpuLoad;
  const effectiveUptime = sysResources?.uptime || caps.uptime;

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 sm:p-6 shadow-xl w-full">
      {/* =========================================================================
          TOP: Control Header, Router & Interface Selectors, Status Badge
          ========================================================================= */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-slate-800">
        {/* Left Title & Status Indicator */}
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400 shrink-0">
            <Radio className="h-5 w-5 animate-pulse" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-sm sm:text-base font-bold text-slate-100 tracking-tight">
                Live MikroTik Router Telemetry
              </h2>

              {/* Dynamic Status Badges */}
              {isLive ? (
                <span className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[10px] font-bold">
                  <span className="h-2 w-2 rounded-full bg-emerald-400 animate-ping" />
                  LIVE
                </span>
              ) : isConnecting ? (
                <span className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-sky-500/10 border border-sky-500/20 text-sky-400 text-[10px] font-bold">
                  <RefreshCw className="h-3 w-3 animate-spin" />
                  CONNECTING
                </span>
              ) : isTransientFailure ? (
                <span className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-400 text-[10px] font-bold">
                  <AlertTriangle className="h-3 w-3" />
                  DEGRADED / RETRYING
                </span>
              ) : isConfirmedFailure ? (
                <span className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-rose-500/10 border border-rose-500/20 text-rose-400 text-[10px] font-bold">
                  <AlertTriangle className="h-3 w-3" />
                  ROUTER UNREACHABLE
                </span>
              ) : (
                <span className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-400 text-[10px] font-bold">
                  <AlertTriangle className="h-3 w-3" />
                  STALE TELEMETRY
                </span>
              )}

              {isPaused && (
                <span className="px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 text-[10px] font-mono">
                  PAUSED
                </span>
              )}
            </div>

            <p className="text-[11px] text-slate-400 mt-0.5">
              {activeRouter?.name || 'MikroTik Gateway'} &bull;{' '}
              {sysResources?.boardName || activeRouter?.model || 'RouterBOARD'} &bull;{' '}
              {sysResources?.version || activeRouter?.rosVersion || 'RouterOS'}
            </p>
          </div>
        </div>

        {/* Right Controls: Router Selector + Interface Selector + Pause/Refresh */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* Router Selector (shown when multiple routers exist) */}
          {routers.length > 1 ? (
            <div className="relative">
              <select
                value={selectedRouterId}
                onChange={(e) => {
                  setSelectedRouterId(e.target.value);
                  setHistory([]);
                  setSessionPeakRx(0);
                  setSessionPeakTx(0);
                }}
                className="bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-blue-500 min-h-[36px]"
              >
                {routers.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name} ({r.host}) {r.status === 'ONLINE' ? '●' : '○'}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-xs text-slate-300">
              <RouterIcon className="h-3.5 w-3.5 text-blue-400" />
              <span className="font-medium">{activeRouter?.name || 'Gateway Router'}</span>
            </div>
          )}

          {/* Interface Selector */}
          <div className="relative">
            <select
              value={selectedInterface}
              onChange={(e) => {
                setSelectedInterface(e.target.value);
                setHistory([]);
                setSessionPeakRx(0);
                setSessionPeakTx(0);
              }}
              disabled={rawInterfaces.length === 0}
              className="bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-blue-500 min-h-[36px] font-mono disabled:opacity-50"
            >
              {physicalInterfaces.length > 0 && (
                <optgroup label="Physical & WAN Interfaces">
                  {physicalInterfaces.map((i) => (
                    <option key={i.name} value={i.name}>
                      {i.name} {i.comment ? `[${i.comment}]` : ''} {i.running ? '●' : '○'}
                    </option>
                  ))}
                </optgroup>
              )}
              {pppoeInterfaces.length > 0 && (
                <optgroup label={`Subscriber Virtual Interfaces (${pppoeInterfaces.length})`}>
                  {pppoeInterfaces.slice(0, 20).map((i) => (
                    <option key={i.name} value={i.name}>
                      {i.name} {i.running ? '●' : '○'}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
          </div>

          {/* Pause / Resume Live Streaming Toggle */}
          <button
            type="button"
            onClick={() => setIsPaused((prev) => !prev)}
            className="p-2 rounded-lg bg-slate-950 border border-slate-800 text-slate-300 hover:text-white hover:bg-slate-800/60 transition-colors min-h-[36px] min-w-[36px] flex items-center justify-center"
            title={isPaused ? 'Resume live stream' : 'Pause live stream'}
          >
            {isPaused ? <Play className="h-3.5 w-3.5 text-emerald-400" /> : <Pause className="h-3.5 w-3.5 text-amber-400" />}
          </button>

          {/* Manual Refresh Trigger */}
          <button
            type="button"
            onClick={() => refetchTraffic()}
            className="p-2 rounded-lg bg-slate-950 border border-slate-800 text-slate-300 hover:text-white hover:bg-slate-800/60 transition-colors min-h-[36px] min-w-[36px] flex items-center justify-center"
            title="Refresh now"
          >
            <RefreshCw className="h-3.5 w-3.5 text-blue-400" />
          </button>
        </div>
      </div>

      {/* Confirmed Unreachable Alert Banner */}
      {isConfirmedFailure && (
        <div className="mt-3 p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 flex items-center gap-2.5 text-rose-300 text-xs font-medium">
          <AlertTriangle className="h-4 w-4 shrink-0 text-rose-400" />
          <span>
            The router at <strong>{activeRouter?.host}:{activeRouter?.port}</strong> is currently unreachable across 3+ attempts. Hardware, power, or VPN tunnel may be disconnected.
          </span>
        </div>
      )}

      {/* Transient Retrying / Stale Alert Banner */}
      {isTransientFailure && !isConfirmedFailure && (
        <div className="mt-3 p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-between gap-2.5 text-amber-300 text-xs font-medium">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400" />
            <span>
              Temporary communication delay — retrying probe ({consecutiveFailures > 0 ? `${consecutiveFailures}/3 attempts` : 'reconnecting'}). Showing last-known telemetry.
            </span>
          </div>
          <button
            onClick={() => refetchTraffic()}
            className="px-2 py-1 rounded bg-amber-500/20 text-amber-200 text-[11px] font-bold hover:bg-amber-500/30"
          >
            Retry
          </button>
        </div>
      )}

      {/* =========================================================================
          ROW 1 & 2: Speedometer Gauges (Left) & Realtime Traffic Graph (Right)
          ========================================================================= */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 sm:gap-6 mt-4 items-stretch">
        {/* Left: Dual Gauges (4 cols on lg, 1 col on xs, 2 cols on sm) */}
        <div className="lg:col-span-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-2 gap-3">
          <SpeedometerGauge
            label="Download (Rx)"
            direction="down"
            bps={currentRx}
            maxBps={peakBps}
            peakBps={sessionPeakRx}
            pps={trafficData?.rxPacketsPerSecond}
            isStale={isStale}
            isOffline={isConfirmedFailure}
          />
          <SpeedometerGauge
            label="Upload (Tx)"
            direction="up"
            bps={currentTx}
            maxBps={peakBps}
            peakBps={sessionPeakTx}
            pps={trafficData?.txPacketsPerSecond}
            isStale={isStale}
            isOffline={isConfirmedFailure}
          />
        </div>

        {/* Right: Rolling 90s Horizon Traffic Graph (8 cols on lg) */}
        <div className="lg:col-span-8 flex flex-col justify-center">
          <RollingTrafficGraph
            samples={history}
            maxBps={peakBps}
            isStale={isStale}
            isOffline={isConfirmedFailure}
          />
        </div>
      </div>

      {/* =========================================================================
          ROW 3: Router Health & Subscriber Status (CPU | RAM | Uptime | PPPoE | ROS)
          ========================================================================= */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mt-4 pt-4 border-t border-slate-800">
        {/* Tile 1: CPU Utilization */}
        <HealthTile
          icon={Cpu}
          label="CPU Load"
          value={effectiveCpuLoad !== undefined ? `${effectiveCpuLoad}%` : 'N/A'}
          percent={effectiveCpuLoad}
          subtext={
            sysResources?.cpuCount
              ? `${sysResources.cpuCount} Cores @ ${sysResources.cpuFrequency || 0} MHz`
              : 'Multi-core CPU'
          }
          badge={effectiveCpuLoad !== undefined && effectiveCpuLoad > 80 ? 'HIGH' : isTransientFailure ? 'STALE' : 'NORMAL'}
          badgeColor={effectiveCpuLoad !== undefined && effectiveCpuLoad > 80 ? 'rose' : isTransientFailure ? 'amber' : 'emerald'}
        />

        {/* Tile 2: Memory (RAM) */}
        <HealthTile
          icon={HardDrive}
          label="RAM Usage"
          value={memoryPercent !== undefined ? `${memoryPercent}%` : 'N/A'}
          percent={memoryPercent}
          subtext={`${formatBytes(freeMemory)} free / ${formatBytes(totalMemory)}`}
          badge={memoryPercent !== undefined && memoryPercent > 85 ? 'WARN' : isTransientFailure ? 'CACHED' : 'HEALTHY'}
          badgeColor={memoryPercent !== undefined && memoryPercent > 85 ? 'amber' : isTransientFailure ? 'amber' : 'emerald'}
        />

        {/* Tile 3: System Uptime */}
        <HealthTile
          icon={Clock}
          label="System Uptime"
          value={effectiveUptime ? formatUptime(effectiveUptime) : 'N/A'}
          subtext="Continuous operational runtime"
          badge={isTransientFailure ? 'CACHED' : 'STABLE'}
          badgeColor={isTransientFailure ? 'amber' : 'emerald'}
        />

        {/* Tile 4: Active PPPoE Subscribers */}
        <HealthTile
          icon={Users}
          label="Active PPPoE"
          value={isStale && pppSessions.length === 0 ? 'N/A' : `${pppSessions.length} Online`}
          subtext="Active subscriber tunnels"
          badge={pppSessions.length > 0 ? 'ACTIVE' : isStale ? 'STALE' : 'IDLE'}
          badgeColor={pppSessions.length > 0 ? 'emerald' : isStale ? 'amber' : 'blue'}
        />

        {/* Tile 5: RouterOS Platform */}
        <HealthTile
          icon={Server}
          label="RouterOS & Arch"
          value={sysResources?.version || activeRouter?.rosVersion || 'RouterOS 6.x'}
          subtext={`${sysResources?.boardName || activeRouter?.model || 'CCR'} (${sysResources?.architectureName || 'arm'})`}
          badge="CONNECTED"
          badgeColor="emerald"
        />
      </div>

      {/* Bottom Telemetry Footer */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mt-3 pt-3 border-t border-slate-800/80 text-[11px] text-slate-400 font-mono">
        <div className="flex items-center gap-4 flex-wrap">
          <span>
            Interface: <strong className="text-slate-200">{selectedInterface}</strong>
          </span>
          <span>
            Status: <strong className="text-emerald-400">{activeInterfaceObj?.running ? 'Running' : 'Inactive'}</strong>
          </span>
          {activeInterfaceObj?.macAddress && (
            <span>
              MAC: <strong className="text-slate-200">{activeInterfaceObj.macAddress}</strong>
            </span>
          )}
        </div>
        <div>
          <span>
            Last Sample:{' '}
            <strong className="text-slate-200">
              {lastRefreshedAt ? lastRefreshedAt.toLocaleTimeString('en-IN') : 'Waiting...'}
            </strong>
          </span>
        </div>
      </div>
    </div>
  );
}
