import React, { useEffect, useState } from 'react';
import { HardwareModal } from './components/HardwareModal';
import { ProtocolInspector } from './components/ProtocolInspector';
import { RustSdkView } from './components/RustSdkView';
import { WorkoutCanvas } from './components/WorkoutCanvas';
import { WorkoutImporterModal } from './components/WorkoutImporterModal';
import { WorkoutLibraryView } from './components/WorkoutLibraryView';
import {
  ConnectedSensorDevice,
  ProtocolFrameAudit,
  StructuredWorkout,
  SyntheticGeneratorConfig,
  TelemetrySnapshot,
  TrainerControlMode,
} from './sdk/types';
import { veloCoreEngine } from './sdk/VeloCoreEngine';
import { BUILTIN_WORKOUTS, encodeTelemetryToFitBinary } from './sdk/workouts';

type ActiveWorkspaceTab = 'COCKPIT' | 'WORKOUTS' | 'PROTOCOL_LAB' | 'RUST_SDK';

function formatClock(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

export default function App() {
  const [activeTab, setActiveTab] = useState<ActiveWorkspaceTab>('COCKPIT');
  const [isDark, setIsDark] = useState<boolean>(true);
  const [isHardwareModalOpen, setIsHardwareModalOpen] = useState<boolean>(false);
  const [isWorkoutImporterOpen, setIsWorkoutImporterOpen] =
    useState<boolean>(false);

  const [workouts, setWorkouts] = useState<StructuredWorkout[]>(BUILTIN_WORKOUTS);
  const [activeWorkout, setActiveWorkout] = useState<StructuredWorkout>(
    veloCoreEngine.getActiveWorkout()
  );
  const [snapshot, setSnapshot] = useState<TelemetrySnapshot>(
    veloCoreEngine.getSnapshot()
  );
  const [frames, setFrames] = useState<ProtocolFrameAudit[]>([]);
  const [devices, setDevices] = useState<ConnectedSensorDevice[]>([]);
  const [synthConfig, setSynthConfig] = useState<SyntheticGeneratorConfig>(
    veloCoreEngine.getSyntheticConfig()
  );
  const [isRiding, setIsRiding] = useState<boolean>(veloCoreEngine.getIsRiding());

  // Sync dark mode class on <html>
  useEffect(() => {
    const root = document.documentElement;
    if (isDark) {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
  }, [isDark]);

  // Boot the Rust-to-WASM telemetry engine & subscribe to streams
  useEffect(() => {
    veloCoreEngine.start();

    const unsubTel = veloCoreEngine.subscribeTelemetry((snap) => {
      setSnapshot({ ...snap });
      setIsRiding(veloCoreEngine.getIsRiding());
    });
    const unsubFrames = veloCoreEngine.subscribeFrames((auditList) => {
      setFrames([...auditList]);
    });
    const unsubDevs = veloCoreEngine.subscribeDevices((devList) => {
      setDevices([...devList]);
    });

    return () => {
      unsubTel();
      unsubFrames();
      unsubDevs();
    };
  }, []);

  const handleSelectWorkout = (workout: StructuredWorkout) => {
    veloCoreEngine.selectWorkout(workout);
    setActiveWorkout(workout);
    setActiveTab('COCKPIT');
  };

  const handleAddCustomWorkout = (workout: StructuredWorkout) => {
    setWorkouts((prev) => [workout, ...prev]);
    veloCoreEngine.selectWorkout(workout);
    setActiveWorkout(workout);
    setActiveTab('COCKPIT');
  };

  const handleUpdateSynth = (patch: Partial<SyntheticGeneratorConfig>) => {
    veloCoreEngine.updateSyntheticConfig(patch);
    setSynthConfig(veloCoreEngine.getSyntheticConfig());
  };

  const handleQuickExportFit = () => {
    const history = veloCoreEngine.getTelemetryHistory();
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
    a.download = `velocore_${activeWorkout.id}_${Date.now()}.fit`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const powerDelta = snapshot.power3sWatts - snapshot.targetPowerWatts;

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-[#07090E] text-slate-900 dark:text-slate-100 flex flex-col">
      {/* Top Bar Contract: Strictly 3 zones separated by gap-8 */}
      <header className="flex items-center justify-between gap-8 px-6 py-3.5 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0B0F17]">
        {/* Zone 1: Single text element wordmark */}
        <a
          href="#cockpit"
          onClick={(e) => {
            e.preventDefault();
            setActiveTab('COCKPIT');
          }}
          className="text-lg font-bold tracking-tight text-slate-900 dark:text-slate-100 whitespace-nowrap shrink-0"
        >
          VeloCore WASM
        </a>

        {/* Zone 2: 4 concise single-line text navigation links */}
        <nav className="flex items-center gap-6 text-sm font-medium text-slate-600 dark:text-slate-400">
          <a
            href="#cockpit"
            onClick={(e) => {
              e.preventDefault();
              setActiveTab('COCKPIT');
            }}
            className={`transition-colors whitespace-nowrap shrink-0 ${
              activeTab === 'COCKPIT'
                ? 'text-slate-900 dark:text-white underline underline-offset-8 decoration-cyan-500 decoration-2'
                : 'hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            Cockpit
          </a>
          <a
            href="#workouts"
            onClick={(e) => {
              e.preventDefault();
              setActiveTab('WORKOUTS');
            }}
            className={`transition-colors whitespace-nowrap shrink-0 ${
              activeTab === 'WORKOUTS'
                ? 'text-slate-900 dark:text-white underline underline-offset-8 decoration-cyan-500 decoration-2'
                : 'hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            Workouts
          </a>
          <a
            href="#protocol-debug"
            onClick={(e) => {
              e.preventDefault();
              setActiveTab('PROTOCOL_LAB');
            }}
            className={`transition-colors whitespace-nowrap shrink-0 flex items-center gap-1.5 ${
              activeTab === 'PROTOCOL_LAB'
                ? 'text-slate-900 dark:text-white underline underline-offset-8 decoration-cyan-500 decoration-2'
                : 'hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            <span>Protocol &amp; Debug</span>
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                synthConfig.enabled ? 'bg-emerald-500 animate-pulse' : 'bg-slate-400'
              }`}
            />
          </a>
          <a
            href="#rust-sdk"
            onClick={(e) => {
              e.preventDefault();
              setActiveTab('RUST_SDK');
            }}
            className={`transition-colors whitespace-nowrap shrink-0 ${
              activeTab === 'RUST_SDK'
                ? 'text-slate-900 dark:text-white underline underline-offset-8 decoration-cyan-500 decoration-2'
                : 'hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            Rust SDK
          </a>
        </nav>

        {/* Zone 3: 1 primary action */}
        <div className="flex items-center shrink-0">
          <button
            type="button"
            onClick={() => setIsHardwareModalOpen(true)}
            className="px-4 py-2 text-xs font-medium text-white bg-cyan-600 hover:bg-cyan-500 rounded-lg transition-colors whitespace-nowrap shrink-0"
          >
            Connect Hardware
          </button>
        </div>
      </header>

      {/* Sub-Header Session Control & Workout Import Toolbar */}
      <div className="border-b border-slate-200 dark:border-slate-800/90 bg-slate-100/70 dark:bg-slate-900/60 px-6 py-2.5">
        <div className="max-w-[1440px] mx-auto flex flex-wrap items-center justify-between gap-4">
          {/* Active Workout & Interval Progress */}
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600 dark:text-slate-400">
            <span className="font-semibold text-slate-900 dark:text-slate-100">
              {activeWorkout.title}
            </span>
            <span aria-hidden="true">·</span>
            <span className="font-mono tabular-nums">
              Elapsed {formatClock(snapshot.elapsedSec)} /{' '}
              {formatClock(activeWorkout.totalDurationSec)}
            </span>
            <span aria-hidden="true">·</span>
            <span className="font-mono tabular-nums text-cyan-600 dark:text-cyan-400">
              Step {snapshot.activeIntervalIndex + 1}/{activeWorkout.segments.length} (
              {formatClock(snapshot.intervalRemainingSec)} rem)
            </span>
          </div>

          {/* Playback, Import Workout & Workspace Actions */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setActiveTab('PROTOCOL_LAB')}
              className={`px-2.5 py-1 text-xs font-mono font-medium rounded border transition-colors whitespace-nowrap shrink-0 flex items-center gap-1.5 ${
                synthConfig.enabled
                  ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                  : 'border-slate-300 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  synthConfig.enabled ? 'bg-emerald-500 animate-pulse' : 'bg-slate-400'
                }`}
              />
              <span>Synth Wire: {synthConfig.enabled ? 'ON' : 'OFF'}</span>
            </button>

            <button
              type="button"
              onClick={() => setIsWorkoutImporterOpen(true)}
              className="px-3 py-1 text-xs font-medium bg-cyan-600/15 text-cyan-700 dark:text-cyan-300 border border-cyan-500/40 hover:bg-cyan-600/25 rounded transition-colors whitespace-nowrap shrink-0"
            >
              Import Workout
            </button>

            <button
              type="button"
              onClick={() => veloCoreEngine.toggleRidePause()}
              className={`px-3 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
                isRiding
                  ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/40'
                  : 'bg-emerald-600 text-white hover:bg-emerald-500'
              }`}
            >
              {isRiding ? 'Pause Ride' : 'Resume Ride'}
            </button>

            <button
              type="button"
              onClick={() =>
                veloCoreEngine.skipToSegment(snapshot.activeIntervalIndex - 1)
              }
              className="px-2.5 py-1 text-xs font-medium border border-slate-300 dark:border-slate-700 rounded hover:bg-white dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 transition-colors whitespace-nowrap shrink-0"
            >
              Prev Interval
            </button>

            <button
              type="button"
              onClick={() =>
                veloCoreEngine.skipToSegment(snapshot.activeIntervalIndex + 1)
              }
              className="px-2.5 py-1 text-xs font-medium border border-slate-300 dark:border-slate-700 rounded hover:bg-white dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 transition-colors whitespace-nowrap shrink-0"
            >
              Skip Interval
            </button>

            <button
              type="button"
              onClick={() => veloCoreEngine.resetSession()}
              className="px-2.5 py-1 text-xs font-medium border border-slate-300 dark:border-slate-700 rounded hover:bg-white dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 transition-colors whitespace-nowrap shrink-0"
            >
              Reset
            </button>

            <button
              type="button"
              onClick={handleQuickExportFit}
              className="px-2.5 py-1 text-xs font-medium border border-slate-300 dark:border-slate-700 rounded hover:bg-white dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 transition-colors whitespace-nowrap shrink-0"
            >
              Export .FIT
            </button>

            <button
              type="button"
              onClick={() => setIsDark((d) => !d)}
              className="px-2.5 py-1 text-xs font-medium border border-slate-300 dark:border-slate-700 rounded hover:bg-white dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 transition-colors whitespace-nowrap shrink-0"
            >
              {isDark ? 'Light Theme' : 'Dark Theme'}
            </button>
          </div>
        </div>
      </div>

      {/* Main Content Container (1440px Desktop Baseline) */}
      <main className="flex-1 max-w-[1440px] w-full mx-auto px-6 py-5 space-y-5">
        {/* Top Precision Telemetry Ribbon (6-Column Tabular Instrument Grid) */}
        <section
          aria-label="Live Telemetry Ribbon"
          className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 rounded-lg divide-y md:divide-y-0 md:divide-x divide-slate-200 dark:divide-slate-800"
        >
          {/* 1. 3s Smoothed Power */}
          <div className="p-4">
            <div className="text-xs text-slate-500 dark:text-slate-400">
              Power (3s Rolling)
            </div>
            <div className="mt-1 flex items-baseline">
              <span className="text-3xl font-mono font-bold tabular-nums text-cyan-600 dark:text-cyan-400">
                {snapshot.power3sWatts}
              </span>
              <span className="text-xs uppercase font-mono text-slate-400 ml-1.5">
                W
              </span>
            </div>
            <div className="mt-1 text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400">
              {snapshot.wattsPerKg.toFixed(2)} W/kg · NP {snapshot.normalizedPowerWatts}W
            </div>
          </div>

          {/* 2. Smart Trainer Target */}
          <div className="p-4">
            <div className="text-xs text-slate-500 dark:text-slate-400">
              Trainer Target ({snapshot.trainerMode})
            </div>
            <div className="mt-1 flex items-baseline">
              <span className="text-3xl font-mono font-bold tabular-nums text-slate-900 dark:text-slate-100">
                {snapshot.targetPowerWatts}
              </span>
              <span className="text-xs uppercase font-mono text-slate-400 ml-1.5">
                W
              </span>
            </div>
            <div
              className={`mt-1 text-xs font-mono tabular-nums ${
                Math.abs(powerDelta) <= 12
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : powerDelta > 12
                    ? 'text-amber-600 dark:text-amber-400'
                    : 'text-cyan-600 dark:text-cyan-400'
              }`}
            >
              Delta: {powerDelta >= 0 ? `+${powerDelta}` : powerDelta} W · Bias{' '}
              {snapshot.intensityBiasPct}%
            </div>
          </div>

          {/* 3. Heart Rate */}
          <div className="p-4">
            <div className="text-xs text-slate-500 dark:text-slate-400">
              Heart Rate (ANT+ / BLE)
            </div>
            <div className="mt-1 flex items-baseline">
              <span className="text-3xl font-mono font-bold tabular-nums text-rose-600 dark:text-rose-400">
                {snapshot.heartRateBpm}
              </span>
              <span className="text-xs uppercase font-mono text-slate-400 ml-1.5">
                BPM
              </span>
            </div>
            <div className="mt-1 text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400">
              Avg {snapshot.averageHeartRateBpm} · Max {snapshot.maxHeartRateBpm} BPM
            </div>
          </div>

          {/* 4. Cadence & Pedal Balance */}
          <div className="p-4">
            <div className="text-xs text-slate-500 dark:text-slate-400">
              Crank Cadence
            </div>
            <div className="mt-1 flex items-baseline">
              <span className="text-3xl font-mono font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
                {snapshot.cadenceRpm}
              </span>
              <span className="text-xs uppercase font-mono text-slate-400 ml-1.5">
                RPM
              </span>
            </div>
            <div className="mt-1 text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400">
              L/R {snapshot.leftRightBalancePct}/
              {100 - snapshot.leftRightBalancePct}% · Avg {snapshot.averageCadenceRpm}
            </div>
          </div>

          {/* 5. Virtual Speed & Work */}
          <div className="p-4">
            <div className="text-xs text-slate-500 dark:text-slate-400">
              FE-C Speed &amp; Work
            </div>
            <div className="mt-1 flex items-baseline">
              <span className="text-3xl font-mono font-bold tabular-nums text-slate-900 dark:text-slate-100">
                {snapshot.speedKph.toFixed(1)}
              </span>
              <span className="text-xs uppercase font-mono text-slate-400 ml-1.5">
                km/h
              </span>
            </div>
            <div className="mt-1 text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400">
              {(snapshot.distanceMeters / 1000).toFixed(2)} km · {snapshot.kilojoules} kJ
            </div>
          </div>

          {/* 6. Anaerobic W'bal Reserve */}
          <div className="p-4">
            <div className="text-xs text-slate-500 dark:text-slate-400">
              W&apos;bal Reserve (Skiba)
            </div>
            <div className="mt-1 flex items-baseline">
              <span className="text-3xl font-mono font-bold tabular-nums text-amber-600 dark:text-amber-400">
                {snapshot.wPrimeBalancePct.toFixed(0)}
              </span>
              <span className="text-xs uppercase font-mono text-slate-400 ml-1.5">
                %
              </span>
            </div>
            <div className="mt-1 text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400">
              {(snapshot.wPrimeBalanceJoules / 1000).toFixed(1)} kJ · IF{' '}
              {snapshot.intensityFactor.toFixed(2)}
            </div>
          </div>
        </section>

        {/* Workspace Tab Switcher */}
        {activeTab === 'COCKPIT' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
            {/* Left Control & Parameter Column (4 cols) */}
            <aside className="lg:col-span-4 space-y-5">
              {/* Active Workout Selector & Quick Import Card */}
              <div className="border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 rounded-lg p-4 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    Active Structured Workout
                  </h2>
                  <button
                    type="button"
                    onClick={() => setIsWorkoutImporterOpen(true)}
                    className="text-xs font-medium text-cyan-600 dark:text-cyan-400 hover:underline whitespace-nowrap shrink-0"
                  >
                    + Import File / DSL
                  </button>
                </div>

                <select
                  value={activeWorkout.id}
                  onChange={(e) => {
                    const found = workouts.find((w) => w.id === e.target.value);
                    if (found) handleSelectWorkout(found);
                  }}
                  className="w-full px-2.5 py-1.5 text-xs font-medium bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded text-slate-900 dark:text-slate-100 focus:outline-none focus:border-cyan-500"
                >
                  {workouts.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.title} ({Math.round(w.totalDurationSec / 60)}m · IF{' '}
                      {w.intensityFactor.toFixed(2)})
                    </option>
                  ))}
                </select>

                <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                  <span>{activeWorkout.category}</span>
                  <span>
                    {activeWorkout.segments.length} steps · {activeWorkout.tss} TSS
                  </span>
                </div>
              </div>

              {/* Smart Trainer Mode & Target Controller */}
              <div className="border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 rounded-lg p-4 space-y-4">
                <div>
                  <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    Smart Trainer Control (FE-C / FTMS)
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    Encodes ANT+ FE-C Pages 48/49/51 &amp; BLE 0x2AD9 frames via Rust WASM.
                  </p>
                </div>

                {/* Mode Segmented Buttons */}
                <div className="grid grid-cols-3 gap-1 bg-slate-100 dark:bg-slate-800 p-1 rounded-md">
                  {(
                    [
                      ['ERG', 'ERG Lock'],
                      ['SLOPE', 'Slope %'],
                      ['RESISTANCE', 'Brake %'],
                    ] as [TrainerControlMode, string][]
                  ).map(([modeKey, label]) => (
                    <button
                      key={modeKey}
                      type="button"
                      onClick={() => veloCoreEngine.setTrainerControlMode(modeKey)}
                      className={`py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
                        snapshot.trainerMode === modeKey
                          ? 'bg-white dark:bg-slate-900 text-cyan-600 dark:text-cyan-400 shadow-xs'
                          : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                {/* Mode-Specific Parameter Controls */}
                {snapshot.trainerMode === 'ERG' && (
                  <div className="space-y-3 pt-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-600 dark:text-slate-400">
                        Workout Intensity Bias
                      </span>
                      <span className="font-mono font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                        {snapshot.intensityBiasPct}% ({snapshot.targetPowerWatts} W)
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          veloCoreEngine.setIntensityBiasPct(
                            snapshot.intensityBiasPct - 2
                          )
                        }
                        className="px-3 py-1.5 text-xs font-mono font-medium border border-slate-300 dark:border-slate-700 rounded hover:bg-slate-100 dark:hover:bg-slate-800"
                      >
                        -2%
                      </button>
                      <input
                        type="range"
                        min={80}
                        max={120}
                        step={1}
                        value={snapshot.intensityBiasPct}
                        onChange={(e) =>
                          veloCoreEngine.setIntensityBiasPct(Number(e.target.value))
                        }
                        className="flex-1 accent-cyan-500"
                      />
                      <button
                        type="button"
                        onClick={() =>
                          veloCoreEngine.setIntensityBiasPct(
                            snapshot.intensityBiasPct + 2
                          )
                        }
                        className="px-3 py-1.5 text-xs font-mono font-medium border border-slate-300 dark:border-slate-700 rounded hover:bg-slate-100 dark:hover:bg-slate-800"
                      >
                        +2%
                      </button>
                    </div>
                  </div>
                )}

                {snapshot.trainerMode === 'SLOPE' && (
                  <div className="space-y-3 pt-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-600 dark:text-slate-400">
                        Simulated Road Grade (FE-C Page 51)
                      </span>
                      <span className="font-mono font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                        {snapshot.targetSlopePct >= 0
                          ? `+${snapshot.targetSlopePct.toFixed(1)}%`
                          : `${snapshot.targetSlopePct.toFixed(1)}%`}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          veloCoreEngine.setTargetSlopePct(
                            snapshot.targetSlopePct - 0.5
                          )
                        }
                        className="px-3 py-1.5 text-xs font-mono font-medium border border-slate-300 dark:border-slate-700 rounded hover:bg-slate-100 dark:hover:bg-slate-800"
                      >
                        -0.5%
                      </button>
                      <input
                        type="range"
                        min={-10}
                        max={20}
                        step={0.5}
                        value={snapshot.targetSlopePct}
                        onChange={(e) =>
                          veloCoreEngine.setTargetSlopePct(Number(e.target.value))
                        }
                        className="flex-1 accent-cyan-500"
                      />
                      <button
                        type="button"
                        onClick={() =>
                          veloCoreEngine.setTargetSlopePct(
                            snapshot.targetSlopePct + 0.5
                          )
                        }
                        className="px-3 py-1.5 text-xs font-mono font-medium border border-slate-300 dark:border-slate-700 rounded hover:bg-slate-100 dark:hover:bg-slate-800"
                      >
                        +0.5%
                      </button>
                    </div>
                  </div>
                )}

                {snapshot.trainerMode === 'RESISTANCE' && (
                  <div className="space-y-3 pt-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-600 dark:text-slate-400">
                        Linear Brake Resistance (FE-C Page 48)
                      </span>
                      <span className="font-mono font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                        {snapshot.targetResistancePct}%
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          veloCoreEngine.setTargetResistancePct(
                            snapshot.targetResistancePct - 5
                          )
                        }
                        className="px-3 py-1.5 text-xs font-mono font-medium border border-slate-300 dark:border-slate-700 rounded hover:bg-slate-100 dark:hover:bg-slate-800"
                      >
                        -5%
                      </button>
                      <input
                        type="range"
                        min={0}
                        max={100}
                        step={1}
                        value={snapshot.targetResistancePct}
                        onChange={(e) =>
                          veloCoreEngine.setTargetResistancePct(
                            Number(e.target.value)
                          )
                        }
                        className="flex-1 accent-cyan-500"
                      />
                      <button
                        type="button"
                        onClick={() =>
                          veloCoreEngine.setTargetResistancePct(
                            snapshot.targetResistancePct + 5
                          )
                        }
                        className="px-3 py-1.5 text-xs font-mono font-medium border border-slate-300 dark:border-slate-700 rounded hover:bg-slate-100 dark:hover:bg-slate-800"
                      >
                        +5%
                      </button>
                    </div>
                  </div>
                )}

                {/* Rider FTP & Mass Calibration */}
                <div className="pt-3 border-t border-slate-200 dark:border-slate-800 grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">
                      Rider FTP (Watts)
                    </label>
                    <input
                      type="number"
                      min={100}
                      max={550}
                      value={snapshot.ftpWatts}
                      onChange={(e) =>
                        veloCoreEngine.setRiderProfile(
                          Number(e.target.value),
                          snapshot.riderWeightKg
                        )
                      }
                      className="w-full px-2.5 py-1.5 text-xs font-mono tabular-nums bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded text-slate-900 dark:text-slate-100"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">
                      Rider Mass (kg)
                    </label>
                    <input
                      type="number"
                      min={40}
                      max={140}
                      step={0.5}
                      value={snapshot.riderWeightKg}
                      onChange={(e) =>
                        veloCoreEngine.setRiderProfile(
                          snapshot.ftpWatts,
                          Number(e.target.value)
                        )
                      }
                      className="w-full px-2.5 py-1.5 text-xs font-mono tabular-nums bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded text-slate-900 dark:text-slate-100"
                    />
                  </div>
                </div>
              </div>

              {/* Active Hardware Channels & Synthetic Wire Stress Controls */}
              <div className="border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 rounded-lg p-4 space-y-3.5">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    Active Sensor Channels
                  </h2>
                  <button
                    type="button"
                    onClick={() => setIsHardwareModalOpen(true)}
                    className="text-xs font-medium text-cyan-600 dark:text-cyan-400 hover:underline whitespace-nowrap shrink-0"
                  >
                    Configure USB / BLE
                  </button>
                </div>

                <div className="divide-y divide-slate-200 dark:divide-slate-800 border border-slate-200 dark:border-slate-800 rounded-md">
                  {devices.map((dev) => (
                    <div
                      key={dev.id}
                      className="px-3 py-2.5 flex items-center justify-between gap-2 text-xs"
                    >
                      <div className="min-w-0">
                        <div className="font-medium text-slate-900 dark:text-slate-100 truncate">
                          {dev.name}
                        </div>
                        <div className="text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400">
                          {dev.channelOrUuid}
                        </div>
                      </div>
                      <div className="text-right font-mono tabular-nums shrink-0">
                        <div
                          className={
                            dev.status === 'CONNECTED'
                              ? 'text-emerald-600 dark:text-emerald-400'
                              : 'text-cyan-600 dark:text-cyan-400'
                          }
                        >
                          {dev.status === 'CONNECTED' ? '● USB/BLE' : '● Synth'}
                        </div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400">
                          {dev.packetCount} pkts
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Quick Synthetic Wire Generator Rate & Effort Offset */}
                <div className="pt-2 border-t border-slate-200 dark:border-slate-800 space-y-2.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-600 dark:text-slate-400">
                      Synthetic Wire Stream
                    </span>
                    <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 p-0.5 rounded font-mono">
                      {([4, 8, 16] as const).map((hz) => (
                        <button
                          key={hz}
                          type="button"
                          onClick={() => handleUpdateSynth({ frequencyHz: hz })}
                          className={`px-2 py-0.5 text-[11px] rounded transition-colors ${
                            synthConfig.frequencyHz === hz
                              ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100'
                              : 'text-slate-500 dark:text-slate-400'
                          }`}
                        >
                          {hz}Hz
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <div className="flex items-center justify-between text-xs mb-1">
                      <span className="text-slate-500 dark:text-slate-400">
                        Simulated Rider Surge / Fade
                      </span>
                      <span className="font-mono tabular-nums text-slate-700 dark:text-slate-300">
                        {synthConfig.baseRiderEffortOffsetWatts >= 0
                          ? `+${synthConfig.baseRiderEffortOffsetWatts} W`
                          : `${synthConfig.baseRiderEffortOffsetWatts} W`}
                      </span>
                    </div>
                    <input
                      type="range"
                      min={-50}
                      max={50}
                      step={5}
                      value={synthConfig.baseRiderEffortOffsetWatts}
                      onChange={(e) =>
                        handleUpdateSynth({
                          baseRiderEffortOffsetWatts: Number(e.target.value),
                        })
                      }
                      className="w-full accent-cyan-500"
                    />
                  </div>
                </div>
              </div>
            </aside>

            {/* Right Main Viewport Stage (8 cols): Workout Canvas + Protocol Inspector */}
            <div className="lg:col-span-8 space-y-5">
              <WorkoutCanvas
                workout={activeWorkout}
                snapshot={snapshot}
                history={veloCoreEngine.getTelemetryHistory()}
                onSelectSegment={(idx) => veloCoreEngine.skipToSegment(idx)}
              />

              <ProtocolInspector
                frames={frames}
                snapshot={snapshot}
                synthConfig={synthConfig}
                onUpdateSynth={handleUpdateSynth}
                onInjectHexFrame={(hex, proto) =>
                  veloCoreEngine.injectRawHexFrame(hex, proto)
                }
              />
            </div>
          </div>
        )}

        {activeTab === 'WORKOUTS' && (
          <WorkoutLibraryView
            workouts={workouts}
            activeWorkoutId={activeWorkout.id}
            snapshot={snapshot}
            history={veloCoreEngine.getTelemetryHistory()}
            onSelectWorkout={handleSelectWorkout}
            onAddCustomWorkout={handleAddCustomWorkout}
            onOpenImporterModal={() => setIsWorkoutImporterOpen(true)}
          />
        )}

        {activeTab === 'PROTOCOL_LAB' && (
          <div className="space-y-5">
            <ProtocolInspector
              frames={frames}
              snapshot={snapshot}
              synthConfig={synthConfig}
              onUpdateSynth={handleUpdateSynth}
              onInjectHexFrame={(hex, proto) =>
                veloCoreEngine.injectRawHexFrame(hex, proto)
              }
            />
          </div>
        )}

        {activeTab === 'RUST_SDK' && <RustSdkView />}
      </main>

      {/* Universal Workout Importer & Interval Builder Modal */}
      <WorkoutImporterModal
        isOpen={isWorkoutImporterOpen}
        onClose={() => setIsWorkoutImporterOpen(false)}
        ftpWatts={snapshot.ftpWatts}
        onImportSuccess={handleAddCustomWorkout}
      />

      {/* Hardware & Transport Modal */}
      <HardwareModal
        isOpen={isHardwareModalOpen}
        onClose={() => setIsHardwareModalOpen(false)}
        devices={devices}
        synthConfig={synthConfig}
        onUpdateSynth={handleUpdateSynth}
        onConnectAntUsb={() => veloCoreEngine.connectWebUsbAntDongle()}
        onConnectBle={(role) => veloCoreEngine.connectWebBluetoothSensor(role)}
      />
    </div>
  );
}
