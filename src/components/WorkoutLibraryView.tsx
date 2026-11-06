import React, { useRef, useState } from 'react';
import {
  StructuredWorkout,
  TelemetryHistoryPoint,
  TelemetrySnapshot,
} from '../sdk/types';
import {
  encodeTelemetryToFitBinary,
  encodeTelemetryToTcxXml,
  parseUniversalWorkout,
} from '../sdk/workouts';

interface WorkoutLibraryViewProps {
  workouts: StructuredWorkout[];
  activeWorkoutId: string;
  snapshot: TelemetrySnapshot;
  history: TelemetryHistoryPoint[];
  onSelectWorkout: (workout: StructuredWorkout) => void;
  onAddCustomWorkout: (workout: StructuredWorkout) => void;
  onOpenImporterModal: () => void;
}

function formatDurationMinutes(sec: number): string {
  const mins = Math.round(sec / 60);
  return `${mins} min`;
}

export const WorkoutLibraryView: React.FC<WorkoutLibraryViewProps> = ({
  workouts,
  activeWorkoutId,
  snapshot,
  history,
  onSelectWorkout,
  onAddCustomWorkout,
  onOpenImporterModal,
}) => {
  const [categoryFilter, setCategoryFilter] = useState<string>('ALL');
  const [importNotice, setImportNotice] = useState<string | null>(null);
  const [isDraggingOver, setIsDraggingOver] = useState<boolean>(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const filteredWorkouts = workouts.filter((w) =>
    categoryFilter === 'ALL' ? true : w.category === categoryFilter
  );

  const ingestWorkoutFile = async (file: File) => {
    try {
      if (file.name.toLowerCase().endsWith('.fit')) {
        const buf = await file.arrayBuffer();
        const { workout, detectedFormat } = parseUniversalWorkout(
          buf,
          file.name,
          snapshot.ftpWatts
        );
        onAddCustomWorkout(workout);
        setImportNotice(
          `Imported ${detectedFormat} workout "${workout.title}" (${workout.segments.length} intervals, IF ${workout.intensityFactor}, ${workout.tss} TSS).`
        );
      } else {
        const text = await file.text();
        const { workout, detectedFormat } = parseUniversalWorkout(
          text,
          file.name,
          snapshot.ftpWatts
        );
        onAddCustomWorkout(workout);
        setImportNotice(
          `Imported ${detectedFormat} workout "${workout.title}" (${workout.segments.length} intervals, IF ${workout.intensityFactor}, ${workout.tss} TSS).`
        );
      }
    } catch (err) {
      setImportNotice(
        `Failed to parse workout file: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      await ingestWorkoutFile(file);
    }
  };

  const handleDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDraggingOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      await ingestWorkoutFile(file);
    }
  };

  const handleExportFit = () => {
    const pts =
      history.length > 0
        ? history
        : [
            {
              elapsedSec: 1,
              powerWatts: snapshot.instantPowerWatts,
              power3sWatts: snapshot.power3sWatts,
              targetWatts: snapshot.targetPowerWatts,
              heartRateBpm: snapshot.heartRateBpm,
              cadenceRpm: snapshot.cadenceRpm,
              speedKph: snapshot.speedKph,
              wPrimeBalancePct: snapshot.wPrimeBalancePct,
            },
          ];
    const bytes = encodeTelemetryToFitBinary(pts);
    const blob = new Blob([bytes.buffer as ArrayBuffer], {
      type: 'application/octet-stream',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `velocore_session_${Date.now()}.fit`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportTcx = () => {
    const pts =
      history.length > 0
        ? history
        : [
            {
              elapsedSec: 1,
              powerWatts: snapshot.instantPowerWatts,
              power3sWatts: snapshot.power3sWatts,
              targetWatts: snapshot.targetPowerWatts,
              heartRateBpm: snapshot.heartRateBpm,
              cadenceRpm: snapshot.cadenceRpm,
              speedKph: snapshot.speedKph,
              wPrimeBalancePct: snapshot.wPrimeBalancePct,
            },
          ];
    const active = workouts.find((w) => w.id === activeWorkoutId) ?? workouts[0];
    const xml = encodeTelemetryToTcxXml(active.title, pts);
    const blob = new Blob([xml], { type: 'application/xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `velocore_session_${Date.now()}.tcx`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      {/* Header & Session Export Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 rounded-lg p-4">
        <div>
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
            Structured Workout Library &amp; Multi-Format Importer
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Supports Zwift (<code className="font-mono">.ZWO</code>), TrainerRoad / GoldenCheetah (<code className="font-mono">.MRC</code> / <code className="font-mono">.ERG</code>), Garmin (<code className="font-mono">.FIT</code>), <code className="font-mono">.JSON</code>, and Intervals.icu Shorthand.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleExportFit}
            className="px-3 py-1.5 text-xs font-medium border border-slate-300 dark:border-slate-700 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-200 transition-colors whitespace-nowrap shrink-0"
          >
            Export Ride (.FIT Binary)
          </button>
          <button
            type="button"
            onClick={handleExportTcx}
            className="px-3 py-1.5 text-xs font-medium border border-slate-300 dark:border-slate-700 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-200 transition-colors whitespace-nowrap shrink-0"
          >
            Export Ride (.TCX XML)
          </button>
          <button
            type="button"
            onClick={onOpenImporterModal}
            className="px-3.5 py-1.5 text-xs font-medium bg-cyan-600 hover:bg-cyan-500 text-white rounded-md transition-colors whitespace-nowrap shrink-0"
          >
            Open Workout Importer &amp; Builder
          </button>
        </div>
      </div>

      {/* Quick Drag-and-Drop Multi-Format Import Banner */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setIsDraggingOver(true);
        }}
        onDragLeave={() => setIsDraggingOver(false)}
        onDrop={handleDrop}
        className={`border-2 border-dashed rounded-lg p-4 flex flex-wrap items-center justify-between gap-4 transition-colors ${
          isDraggingOver
            ? 'border-cyan-500 bg-cyan-500/10'
            : 'border-slate-300 dark:border-slate-800 bg-white/60 dark:bg-slate-900/50'
        }`}
      >
        <div>
          <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">
            Quick File Dropzone (.ZWO · .MRC · .ERG · .FIT · .JSON · .TXT)
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Drag any workout file onto this card to parse intervals and scale targets to your {snapshot.ftpWatts} W FTP.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept=".zwo,.erg,.mrc,.fit,.json,.xml,.txt"
            onChange={handleFileUpload}
            className="hidden"
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="px-3 py-1.5 text-xs font-medium border border-slate-300 dark:border-slate-700 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-200 transition-colors whitespace-nowrap shrink-0"
          >
            Browse Disk...
          </button>
          <button
            type="button"
            onClick={onOpenImporterModal}
            className="px-3 py-1.5 text-xs font-medium border border-cyan-500/50 text-cyan-600 dark:text-cyan-400 rounded-md hover:bg-cyan-500/10 transition-colors whitespace-nowrap shrink-0"
          >
            Paste Shorthand / XML / MRC
          </button>
        </div>
      </div>

      {/* Category Filter Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 p-1 rounded-md">
          {[
            'ALL',
            'Threshold',
            'VO2max',
            'Sweet Spot',
            'Anaerobic',
            'Custom Import',
          ].map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => setCategoryFilter(cat)}
              className={`px-3 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
                categoryFilter === cat
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              {cat === 'ALL' ? 'All Workouts' : cat}
            </button>
          ))}
        </div>
      </div>

      {importNotice && (
        <div className="px-3.5 py-2.5 text-xs font-mono border border-cyan-500/40 bg-cyan-500/10 rounded-md text-cyan-800 dark:text-cyan-200">
          {importNotice}
        </div>
      )}

      {/* Workout Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {filteredWorkouts.map((w) => {
          const isSelected = w.id === activeWorkoutId;
          return (
            <div
              key={w.id}
              className={`border rounded-lg p-4 flex flex-col justify-between gap-4 transition-colors ${
                isSelected
                  ? 'border-cyan-500 bg-white dark:bg-slate-900'
                  : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/80'
              }`}
            >
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                  <span className="font-sans font-medium text-cyan-600 dark:text-cyan-400">
                    {w.category}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>{formatDurationMinutes(w.totalDurationSec)}</span>
                  <span aria-hidden="true">·</span>
                  <span>IF {w.intensityFactor.toFixed(2)}</span>
                  <span aria-hidden="true">·</span>
                  <span>{w.tss} TSS</span>
                </div>

                <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                  {w.title}
                </h3>

                <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                  {w.description}
                </p>

                {/* Mini Sparkline of Interval Heights */}
                <div className="flex items-end gap-0.5 h-10 pt-2">
                  {w.segments.map((seg) => {
                    const pct =
                      seg.endTargetFtpPct !== undefined
                        ? (seg.targetFtpPct + seg.endTargetFtpPct) / 2
                        : seg.targetFtpPct;
                    const heightPct = Math.max(
                      18,
                      Math.min(100, Math.round((pct / 1.4) * 100))
                    );
                    const widthWeight = Math.max(
                      1,
                      Math.round(seg.durationSec / 30)
                    );
                    return (
                      <div
                        key={seg.id}
                        style={{
                          height: `${heightPct}%`,
                          flexGrow: widthWeight,
                        }}
                        className={`rounded-t-xs ${
                          pct >= 1.15
                            ? 'bg-amber-500/80'
                            : pct >= 0.92
                              ? 'bg-cyan-500/80'
                              : pct >= 0.75
                                ? 'bg-emerald-500/70'
                                : 'bg-slate-400/50 dark:bg-slate-700'
                        }`}
                        title={`${seg.name}: ${Math.round(pct * snapshot.ftpWatts)}W (${seg.durationSec}s)`}
                      />
                    );
                  })}
                </div>
              </div>

              <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-100 dark:border-slate-800/80">
                <span className="text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                  {w.segments.length} intervals · Peak{' '}
                  {Math.round(
                    Math.max(
                      ...w.segments.map(
                        (s) => s.endTargetFtpPct ?? s.targetFtpPct
                      )
                    ) * snapshot.ftpWatts
                  )}{' '}
                  W
                </span>
                <button
                  type="button"
                  onClick={() => onSelectWorkout(w)}
                  className={`px-3.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                    isSelected
                      ? 'bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900'
                      : 'bg-cyan-600 hover:bg-cyan-500 text-white'
                  }`}
                >
                  {isSelected ? 'Active in Cockpit' : 'Load into Cockpit'}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
