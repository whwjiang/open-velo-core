import React, { useMemo, useState } from 'react';
import {
  StructuredWorkout,
  TelemetryHistoryPoint,
  TelemetrySnapshot,
  WorkoutIntervalSegment,
} from '../sdk/types';

interface WorkoutCanvasProps {
  workout: StructuredWorkout;
  snapshot: TelemetrySnapshot;
  history: TelemetryHistoryPoint[];
  onSelectSegment: (index: number) => void;
}

function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function getZoneFill(zone: WorkoutIntervalSegment['zoneLabel']): {
  fill: string;
  stroke: string;
  labelColor: string;
} {
  switch (zone) {
    case 'Z1 Recovery':
      return {
        fill: 'rgba(100, 116, 139, 0.32)',
        stroke: '#64748B',
        labelColor: 'text-slate-500 dark:text-slate-400',
      };
    case 'Z2 Endurance':
      return {
        fill: 'rgba(59, 130, 246, 0.35)',
        stroke: '#3B82F6',
        labelColor: 'text-blue-600 dark:text-blue-400',
      };
    case 'Z3 Tempo':
      return {
        fill: 'rgba(16, 185, 129, 0.36)',
        stroke: '#10B981',
        labelColor: 'text-emerald-600 dark:text-emerald-400',
      };
    case 'Z4 Threshold':
      return {
        fill: 'rgba(6, 182, 212, 0.40)',
        stroke: '#06B6D4',
        labelColor: 'text-cyan-600 dark:text-cyan-400',
      };
    case 'Z5 VO2max':
      return {
        fill: 'rgba(245, 158, 11, 0.42)',
        stroke: '#F59E0B',
        labelColor: 'text-amber-600 dark:text-amber-400',
      };
    case 'Z6 Anaerobic':
      return {
        fill: 'rgba(244, 63, 94, 0.44)',
        stroke: '#F43F5E',
        labelColor: 'text-rose-600 dark:text-rose-400',
      };
  }
}

export const WorkoutCanvas: React.FC<WorkoutCanvasProps> = ({
  workout,
  snapshot,
  history,
  onSelectSegment,
}) => {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const [showHrOverlay, setShowHrOverlay] = useState(true);
  const [showWbalOverlay, setShowWbalOverlay] = useState(true);

  const width = 1000;
  const height = 300;
  const padLeft = 46;
  const padRight = 38;
  const padTop = 20;
  const padBottom = 28;
  const plotW = width - padLeft - padRight;
  const plotH = height - padTop - padBottom;

  const totalSec = Math.max(60, workout.totalDurationSec);
  const biasFactor = snapshot.intensityBiasPct / 100;
  const maxWattsScale = Math.max(
    Math.round(snapshot.ftpWatts * 1.45),
    snapshot.maxPowerWatts + 30,
    380
  );

  const segmentBlocks = useMemo(() => {
    let accSec = 0;
    return workout.segments.map((seg, index) => {
      const startSec = accSec;
      const endSec = accSec + seg.durationSec;
      accSec = endSec;

      const x0 = padLeft + (startSec / totalSec) * plotW;
      const x1 = padLeft + (endSec / totalSec) * plotW;
      const w = Math.max(2, x1 - x0);

      const startWatts = Math.round(seg.targetFtpPct * snapshot.ftpWatts * biasFactor);
      const endWatts =
        seg.endTargetFtpPct !== undefined
          ? Math.round(seg.endTargetFtpPct * snapshot.ftpWatts * biasFactor)
          : startWatts;

      const yStart = padTop + plotH - Math.min(1, startWatts / maxWattsScale) * plotH;
      const yEnd = padTop + plotH - Math.min(1, endWatts / maxWattsScale) * plotH;
      const yBottom = padTop + plotH;

      const points = `${x0.toFixed(1)},${yBottom.toFixed(1)} ${x0.toFixed(1)},${yStart.toFixed(1)} ${x1.toFixed(1)},${yEnd.toFixed(1)} ${x1.toFixed(1)},${yBottom.toFixed(1)}`;
      const topEdge = `${x0.toFixed(1)},${yStart.toFixed(1)} ${x1.toFixed(1)},${yEnd.toFixed(1)}`;

      return {
        index,
        seg,
        startSec,
        endSec,
        x0,
        x1,
        w,
        startWatts,
        endWatts,
        points,
        topEdge,
        colors: getZoneFill(seg.zoneLabel),
      };
    });
  }, [workout, snapshot.ftpWatts, biasFactor, totalSec, plotW, plotH, maxWattsScale]);

  // Live telemetry polylines
  const powerPolyline = useMemo(() => {
    if (history.length < 2) return '';
    return history
      .map((pt) => {
        const x = padLeft + (Math.min(totalSec, pt.elapsedSec) / totalSec) * plotW;
        const y = padTop + plotH - Math.min(1, pt.power3sWatts / maxWattsScale) * plotH;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');
  }, [history, totalSec, plotW, plotH, maxWattsScale]);

  const hrPolyline = useMemo(() => {
    if (!showHrOverlay || history.length < 2) return '';
    return history
      .map((pt) => {
        const x = padLeft + (Math.min(totalSec, pt.elapsedSec) / totalSec) * plotW;
        const normHr = Math.max(0, Math.min(1, (pt.heartRateBpm - 60) / 150));
        const y = padTop + plotH - normHr * plotH;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');
  }, [history, showHrOverlay, totalSec, plotW, plotH]);

  const wbalPolyline = useMemo(() => {
    if (!showWbalOverlay || history.length < 2) return '';
    return history
      .map((pt) => {
        const x = padLeft + (Math.min(totalSec, pt.elapsedSec) / totalSec) * plotW;
        const normW = Math.max(0, Math.min(1, pt.wPrimeBalancePct / 100));
        const y = padTop + plotH - normW * plotH;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');
  }, [history, showWbalOverlay, totalSec, plotW, plotH]);

  const playheadX =
    padLeft + (Math.min(totalSec, snapshot.elapsedSec) / totalSec) * plotW;
  const ftpY =
    padTop + plotH - Math.min(1, snapshot.ftpWatts / maxWattsScale) * plotH;

  const activeBlock =
    segmentBlocks[snapshot.activeIntervalIndex] ?? segmentBlocks[0];
  const inspectedBlock =
    hoveredIdx !== null ? segmentBlocks[hoveredIdx] : activeBlock;

  const yAxisTicks = [0, 0.25, 0.5, 0.75, 1].map((frac) => {
    const watts = Math.round(maxWattsScale * frac);
    const y = padTop + plotH - frac * plotH;
    return { watts, y };
  });

  return (
    <div className="border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 rounded-lg p-4">
      {/* Header Row: Active Coach Cue & Trace Toggles */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-3 mb-3 border-b border-slate-200 dark:border-slate-800">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
            <span className="font-semibold text-slate-900 dark:text-slate-100">
              {inspectedBlock?.seg.name}
            </span>
            <span aria-hidden="true">·</span>
            <span className={inspectedBlock?.colors.labelColor}>
              {inspectedBlock?.seg.zoneLabel}
            </span>
            <span aria-hidden="true">·</span>
            <span className="font-mono tabular-nums">
              {inspectedBlock?.startWatts === inspectedBlock?.endWatts
                ? `${inspectedBlock?.startWatts} W`
                : `${inspectedBlock?.startWatts}→${inspectedBlock?.endWatts} W`}{' '}
              ({formatDuration(inspectedBlock?.seg.durationSec ?? 0)})
            </span>
            {inspectedBlock?.seg.targetCadenceRpm && (
              <>
                <span aria-hidden="true">·</span>
                <span className="font-mono tabular-nums">
                  Target {inspectedBlock.seg.targetCadenceRpm} RPM
                </span>
              </>
            )}
          </div>
          <p className="text-xs text-slate-600 dark:text-slate-300 mt-1 truncate">
            {inspectedBlock?.seg.coachCue}
          </p>
        </div>

        {/* Trace Visibility Controls */}
        <div className="flex items-center gap-1.5 bg-slate-100 dark:bg-slate-800/80 p-1 rounded-md shrink-0">
          <button
            type="button"
            onClick={() => setShowHrOverlay((v) => !v)}
            className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
              showHrOverlay
                ? 'bg-white dark:bg-slate-900 text-rose-600 dark:text-rose-400 shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            HR Trace
          </button>
          <button
            type="button"
            onClick={() => setShowWbalOverlay((v) => !v)}
            className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
              showWbalOverlay
                ? 'bg-white dark:bg-slate-900 text-emerald-600 dark:text-emerald-400 shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            W&apos;bal Reserve
          </button>
        </div>
      </div>

      {/* SVG Structured Interval Profile & Telemetry Stage */}
      <div className="relative select-none">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="w-full h-64 md:h-72 overflow-visible cursor-crosshair"
        >
          {/* Horizontal Wattage Gridlines */}
          {yAxisTicks.map((t) => (
            <g key={t.watts}>
              <line
                x1={padLeft}
                y1={t.y}
                x2={width - padRight}
                y2={t.y}
                className="stroke-slate-200 dark:stroke-slate-800/90"
                strokeWidth="1"
              />
              <text
                x={padLeft - 8}
                y={t.y + 4}
                textAnchor="end"
                className="fill-slate-400 dark:fill-slate-500 text-[10px] font-mono tabular-nums"
              >
                {t.watts}W
              </text>
            </g>
          ))}

          {/* Right Axis W'bal / HR % scale */}
          {[0, 50, 100].map((pct) => {
            const y = padTop + plotH - (pct / 100) * plotH;
            return (
              <text
                key={pct}
                x={width - padRight + 6}
                y={y + 4}
                textAnchor="start"
                className="fill-slate-400 dark:fill-slate-500 text-[10px] font-mono tabular-nums"
              >
                {pct}%
              </text>
            );
          })}

          {/* 100% FTP Reference Threshold Line */}
          <line
            x1={padLeft}
            y1={ftpY}
            x2={width - padRight}
            y2={ftpY}
            stroke="#F59E0B"
            strokeWidth="1"
            strokeDasharray="4 4"
            opacity="0.75"
          />
          <text
            x={padLeft + 6}
            y={ftpY - 5}
            className="fill-amber-500 text-[10px] font-mono tabular-nums"
          >
            FTP {snapshot.ftpWatts}W
          </text>

          {/* Workout Interval Polygons */}
          {segmentBlocks.map((b) => {
            const isCurrent = b.index === snapshot.activeIntervalIndex;
            const isHovered = b.index === hoveredIdx;
            return (
              <g
                key={b.seg.id}
                onMouseEnter={() => setHoveredIdx(b.index)}
                onMouseLeave={() => setHoveredIdx(null)}
                onClick={() => onSelectSegment(b.index)}
                className="cursor-pointer transition-opacity"
              >
                <polygon
                  points={b.points}
                  fill={b.colors.fill}
                  opacity={isHovered ? 0.95 : isCurrent ? 0.85 : 0.62}
                />
                <polyline
                  points={b.topEdge}
                  fill="none"
                  stroke={b.colors.stroke}
                  strokeWidth={isCurrent || isHovered ? '2.5' : '1.5'}
                />
              </g>
            );
          })}

          {/* Live W'bal Anaerobic Reserve Curve */}
          {wbalPolyline && (
            <polyline
              points={wbalPolyline}
              fill="none"
              stroke="#10B981"
              strokeWidth="1.75"
              strokeDasharray="3 2"
              opacity="0.9"
            />
          )}

          {/* Live Heart Rate Curve */}
          {hrPolyline && (
            <polyline
              points={hrPolyline}
              fill="none"
              stroke="#F43F5E"
              strokeWidth="1.75"
              opacity="0.9"
            />
          )}

          {/* Live 3s Smoothed Power Curve */}
          {powerPolyline && (
            <polyline
              points={powerPolyline}
              fill="none"
              stroke="#22D3EE"
              strokeWidth="2.25"
            />
          )}

          {/* Active Workout Playhead */}
          <line
            x1={playheadX}
            y1={padTop}
            x2={playheadX}
            y2={padTop + plotH}
            stroke="#06B6D4"
            strokeWidth="1.75"
          />
          <circle
            cx={playheadX}
            cy={
              padTop +
              plotH -
              Math.min(1, snapshot.power3sWatts / maxWattsScale) * plotH
            }
            r="4"
            fill="#06B6D4"
            stroke="#0F172A"
            strokeWidth="1.5"
          />

          {/* Time Axis Labels */}
          {[0, 0.25, 0.5, 0.75, 1].map((frac) => {
            const x = padLeft + frac * plotW;
            const sec = Math.round(totalSec * frac);
            return (
              <text
                key={frac}
                x={x}
                y={height - 6}
                textAnchor="middle"
                className="fill-slate-400 dark:fill-slate-500 text-[10px] font-mono tabular-nums"
              >
                {formatDuration(sec)}
              </text>
            );
          })}
        </svg>
      </div>

      {/* Bottom Legend & Interval Jump Strip */}
      <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-200 dark:border-slate-800 text-xs text-slate-500 dark:text-slate-400">
        <div className="flex items-center gap-3">
          <span>Click any interval block to jump playhead &amp; transmit new ANT+ FE-C / BLE FTMS target</span>
        </div>
        <div className="flex items-center gap-3 font-mono tabular-nums">
          <span className="text-cyan-600 dark:text-cyan-400">━ 3s Power ({snapshot.power3sWatts}W)</span>
          <span aria-hidden="true">·</span>
          <span className="text-rose-600 dark:text-rose-400">━ Heart Rate ({snapshot.heartRateBpm} BPM)</span>
          <span aria-hidden="true">·</span>
          <span className="text-emerald-600 dark:text-emerald-400">┄ W&apos;bal ({snapshot.wPrimeBalancePct}%)</span>
        </div>
      </div>
    </div>
  );
};
