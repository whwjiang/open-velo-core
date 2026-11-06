import React, { useMemo, useState } from 'react';
import { ProtocolFrameAudit, SyntheticGeneratorConfig, TelemetrySnapshot } from '../sdk/types';
import { veloCoreEngine } from '../sdk/VeloCoreEngine';

interface ProtocolInspectorProps {
  frames: ProtocolFrameAudit[];
  snapshot: TelemetrySnapshot;
  synthConfig: SyntheticGeneratorConfig;
  onUpdateSynth: (patch: Partial<SyntheticGeneratorConfig>) => void;
  onInjectHexFrame: (hex: string, protocol: 'ANT+' | 'BLE') => { ok: boolean; summary: string };
}

type FrameFilter = 'ALL' | 'ANT+' | 'BLE' | 'OUTBOUND' | 'CRC_ERR';

const PRESET_FRAMES: { label: string; protocol: 'ANT+' | 'BLE'; hex: string }[] = [
  {
    label: 'ANT+ FE-C Page 25 (310W · 96 RPM)',
    protocol: 'ANT+',
    hex: 'A4 09 4E 00 19 42 60 E0 12 36 01 30 98',
  },
  {
    label: 'ANT+ HRM Page 4 (168 BPM)',
    protocol: 'ANT+',
    hex: 'A4 09 4E 02 84 FF FF FF 40 2A 18 A8 09',
  },
  {
    label: 'BLE CPS 0x2A63 (340W · 51/49% Balance)',
    protocol: 'BLE',
    hex: '21 00 54 01 66 9A 04 00 38',
  },
  {
    label: 'Corrupted ANT+ Frame (Bad XOR CRC)',
    protocol: 'ANT+',
    hex: 'A4 09 4E 00 19 42 60 E0 12 36 01 30 FF',
  },
];

export const ProtocolInspector: React.FC<ProtocolInspectorProps> = ({
  frames,
  snapshot,
  synthConfig,
  onUpdateSynth,
  onInjectHexFrame,
}) => {
  const [filter, setFilter] = useState<FrameFilter>('ALL');
  const [isPaused, setIsPaused] = useState(false);
  const [pausedSnapshot, setPausedSnapshot] = useState<ProtocolFrameAudit[]>([]);
  const [selectedFrameId, setSelectedFrameId] = useState<number | null>(null);
  const [showDebugTuning, setShowDebugTuning] = useState(true);

  // Custom Hex Injector State
  const [injectProtocol, setInjectProtocol] = useState<'ANT+' | 'BLE'>('ANT+');
  const [injectHex, setInjectHex] = useState(PRESET_FRAMES[0].hex);
  const [injectFeedback, setInjectFeedback] = useState<string | null>(null);

  const displayedFrames = useMemo(() => {
    const sourceList = isPaused ? pausedSnapshot : frames;
    return sourceList.filter((f) => {
      if (filter === 'ANT+') return f.protocol === 'ANT+';
      if (filter === 'BLE') return f.protocol === 'BLE';
      if (filter === 'OUTBOUND') return f.direction === 'OUTBOUND';
      if (filter === 'CRC_ERR') return !f.checksumValid;
      return true;
    });
  }, [frames, isPaused, pausedSnapshot, filter]);

  const inspectedFrame = useMemo(() => {
    if (selectedFrameId !== null) {
      const found = displayedFrames.find((f) => f.id === selectedFrameId);
      if (found) return found;
    }
    return displayedFrames[0] ?? null;
  }, [displayedFrames, selectedFrameId]);

  const handleTogglePause = () => {
    if (!isPaused) {
      setPausedSnapshot(frames);
      setIsPaused(true);
    } else {
      setIsPaused(false);
    }
  };

  const handleRunInject = (e: React.FormEvent) => {
    e.preventDefault();
    const res = onInjectHexFrame(injectHex, injectProtocol);
    setInjectFeedback(
      `${res.ok ? 'Decoded in WASM' : 'CRC Rejected in WASM'}: ${res.summary}`
    );
  };

  return (
    <div className="border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 rounded-lg p-4 space-y-4">
      {/* Unified Debug & Synthetic Wire Control Banner */}
      <div className="border border-slate-200 dark:border-slate-800 rounded-lg p-3.5 bg-slate-50/70 dark:bg-slate-950/60 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={() => onUpdateSynth({ enabled: !synthConfig.enabled })}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 flex items-center gap-1.5 ${
                synthConfig.enabled
                  ? 'bg-emerald-600 text-white hover:bg-emerald-500 shadow-xs'
                  : 'bg-rose-600 text-white hover:bg-rose-500 shadow-xs'
              }`}
            >
              <span
                className={`w-2 h-2 rounded-full ${
                  synthConfig.enabled ? 'bg-white animate-pulse' : 'bg-white/80'
                }`}
              />
              <span>Synthetic Wire Generator: {synthConfig.enabled ? 'ON' : 'OFF (Zeroed)'}</span>
            </button>
            <span className="text-xs text-slate-500 dark:text-slate-400">
              {synthConfig.enabled
                ? 'Emitting simulated ANT+ & BLE frames into WASM buffer'
                : 'Synthetic data stopped; steady-state zeroed for physical USB/BLE reception'}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowDebugTuning((v) => !v)}
              className="text-xs font-mono text-cyan-600 dark:text-cyan-400 hover:underline"
            >
              {showDebugTuning ? 'Hide Debug Tuning' : 'Show Debug Tuning'}
            </button>
          </div>
        </div>

        {/* Expandable Debug Tuning Bar */}
        {showDebugTuning && (
          <div className="pt-2 border-t border-slate-200 dark:border-slate-800/80 grid grid-cols-1 md:grid-cols-12 gap-3 text-xs items-center">
            {/* Frequency */}
            <div className="md:col-span-3 flex items-center gap-2">
              <span className="text-slate-500 dark:text-slate-400 shrink-0 font-medium">Rate:</span>
              <div className="flex items-center gap-0.5 bg-slate-200/70 dark:bg-slate-800 p-0.5 rounded font-mono flex-1">
                {([4, 8, 16] as const).map((hz) => (
                  <button
                    key={hz}
                    type="button"
                    onClick={() => onUpdateSynth({ frequencyHz: hz })}
                    disabled={!synthConfig.enabled}
                    className={`flex-1 py-0.5 text-[11px] rounded transition-colors disabled:opacity-40 ${
                      synthConfig.frequencyHz === hz
                        ? 'bg-white dark:bg-slate-900 text-cyan-600 dark:text-cyan-400 font-bold shadow-xs'
                        : 'text-slate-600 dark:text-slate-400'
                    }`}
                  >
                    {hz}Hz
                  </button>
                ))}
              </div>
            </div>

            {/* Protocol Mix */}
            <div className="md:col-span-3 flex items-center gap-2">
              <span className="text-slate-500 dark:text-slate-400 shrink-0 font-medium">Wire:</span>
              <div className="flex items-center gap-0.5 bg-slate-200/70 dark:bg-slate-800 p-0.5 rounded flex-1">
                {(
                  [
                    ['BOTH', 'Both'],
                    ['ANT_ONLY', 'ANT+'],
                    ['BLE_ONLY', 'BLE'],
                  ] as const
                ).map(([mixKey, label]) => (
                  <button
                    key={mixKey}
                    type="button"
                    onClick={() => onUpdateSynth({ protocolMix: mixKey })}
                    disabled={!synthConfig.enabled}
                    className={`flex-1 py-0.5 text-[11px] rounded transition-colors disabled:opacity-40 ${
                      synthConfig.protocolMix === mixKey
                        ? 'bg-white dark:bg-slate-900 text-cyan-600 dark:text-cyan-400 font-bold shadow-xs'
                        : 'text-slate-600 dark:text-slate-400'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* Corruption Rate */}
            <div className="md:col-span-3 flex items-center gap-2">
              <span className="text-slate-500 dark:text-slate-400 shrink-0 font-medium">
                Bad CRC ({synthConfig.injectPacketCorruptionPct}%):
              </span>
              <input
                type="range"
                min={0}
                max={20}
                step={1}
                disabled={!synthConfig.enabled}
                value={synthConfig.injectPacketCorruptionPct}
                onChange={(e) =>
                  onUpdateSynth({ injectPacketCorruptionPct: Number(e.target.value) })
                }
                className="w-full accent-rose-500 disabled:opacity-40"
              />
            </div>

            {/* Quick Test Injections */}
            <div className="md:col-span-3 flex items-center justify-end gap-1.5 font-mono">
              <button
                type="button"
                onClick={() =>
                  onUpdateSynth({
                    baseRiderEffortOffsetWatts: synthConfig.baseRiderEffortOffsetWatts + 30,
                  })
                }
                disabled={!synthConfig.enabled}
                className="px-2 py-0.5 text-[11px] border border-slate-300 dark:border-slate-700 rounded hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40"
                title="Add +30W rider effort offset"
              >
                +30W
              </button>
              <button
                type="button"
                onClick={() =>
                  onUpdateSynth({
                    baseRiderEffortOffsetWatts: synthConfig.baseRiderEffortOffsetWatts - 30,
                  })
                }
                disabled={!synthConfig.enabled}
                className="px-2 py-0.5 text-[11px] border border-slate-300 dark:border-slate-700 rounded hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40"
                title="Subtract -30W rider effort offset"
              >
                -30W
              </button>
              <button
                type="button"
                onClick={() =>
                  veloCoreEngine.injectRawHexFrame(
                    'A4 09 4E 00 19 42 60 E0 12 36 01 30 FF',
                    'ANT+'
                  )
                }
                className="px-2 py-0.5 text-[11px] bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/30 rounded hover:bg-rose-500/20"
                title="Inject bad checksum frame into WASM"
              >
                CRC Err
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Top Bar: Filter Tabs, WASM Latency Metrics & Pause Stream */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-200 dark:border-slate-800">
        <div>
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            WASM Binary Protocol Inspector &amp; Hex Dissector
          </h2>
          <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums mt-0.5">
            <span>Frames: {snapshot.totalFramesProcessed}</span>
            <span aria-hidden="true">·</span>
            <span>Throughput: {snapshot.frameRateHz.toFixed(1)} Hz</span>
            <span aria-hidden="true">·</span>
            <span>Avg WASM Decode: {snapshot.avgWasmDecodeUs} µs</span>
            <span aria-hidden="true">·</span>
            <span
              className={
                snapshot.checksumErrors > 0
                  ? 'text-rose-600 dark:text-rose-400'
                  : 'text-emerald-600 dark:text-emerald-400'
              }
            >
              CRC Errors: {snapshot.checksumErrors}
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Interactive Filter Controls */}
          <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 p-1 rounded-md">
            {(
              [
                ['ALL', 'All Wire'],
                ['ANT+', 'ANT+ USB'],
                ['BLE', 'BLE GATT'],
                ['OUTBOUND', 'Trainer TX'],
                ['CRC_ERR', 'CRC Errors'],
              ] as [FrameFilter, string][]
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setFilter(key)}
                className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
                  filter === key
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={handleTogglePause}
            className={`px-3 py-1.5 text-xs font-medium rounded-md border transition-colors whitespace-nowrap shrink-0 ${
              isPaused
                ? 'bg-amber-500/15 border-amber-500/50 text-amber-600 dark:text-amber-300'
                : 'border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            {isPaused ? 'Resume Capture' : 'Freeze Buffer'}
          </button>
        </div>
      </div>

      {/* Main Split: Left Hex Ring Buffer Table + Right Byte-by-Byte Dissector & Hex Injector */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-stretch">
        {/* Left 7 cols: Ring Buffer Table */}
        <div className="lg:col-span-7 border border-slate-200 dark:border-slate-800 rounded-md overflow-hidden flex flex-col">
          <div className="max-h-72 overflow-y-auto divide-y divide-slate-200 dark:divide-slate-800/80 font-mono text-xs tabular-nums">
            <div className="grid grid-cols-12 gap-2 px-3 py-2 bg-slate-50 dark:bg-slate-950/70 text-slate-500 dark:text-slate-400 font-sans text-[11px] font-medium sticky top-0">
              <div className="col-span-2">Seq / Dir</div>
              <div className="col-span-2">Channel</div>
              <div className="col-span-5">Raw Wire Bytes (Hex)</div>
              <div className="col-span-3 text-right">Decoded / µs</div>
            </div>

            {displayedFrames.length === 0 ? (
              <div className="p-8 text-center text-xs font-sans text-slate-500 dark:text-slate-400">
                No protocol frames match the current filter.
              </div>
            ) : (
              displayedFrames.slice(0, 45).map((frame) => {
                const isSelected = inspectedFrame?.id === frame.id;
                return (
                  <button
                    key={frame.id}
                    type="button"
                    onClick={() => setSelectedFrameId(frame.id)}
                    className={`w-full grid grid-cols-12 gap-2 px-3 py-2 text-left transition-colors items-center ${
                      isSelected
                        ? 'bg-cyan-500/10 dark:bg-cyan-500/15 text-slate-900 dark:text-slate-100'
                        : 'hover:bg-slate-50 dark:hover:bg-slate-800/50 text-slate-700 dark:text-slate-300'
                    }`}
                  >
                    <div className="col-span-2 flex items-center gap-1.5 truncate">
                      <span
                        className={
                          frame.direction === 'OUTBOUND'
                            ? 'text-amber-600 dark:text-amber-400 font-semibold'
                            : frame.protocol === 'ANT+'
                              ? 'text-cyan-600 dark:text-cyan-400'
                              : 'text-emerald-600 dark:text-emerald-400'
                        }
                      >
                        {frame.direction === 'OUTBOUND' ? 'TX' : 'RX'}
                      </span>
                      <span className="text-slate-400 dark:text-slate-500">
                        #{frame.id}
                      </span>
                    </div>
                    <div className="col-span-2 truncate text-[11px] text-slate-500 dark:text-slate-400">
                      {frame.protocol}
                    </div>
                    <div className="col-span-5 truncate tracking-tight text-[11px]">
                      {frame.hexString}
                    </div>
                    <div className="col-span-3 text-right truncate text-[11px]">
                      <span
                        className={
                          frame.checksumValid
                            ? 'text-slate-600 dark:text-slate-300'
                            : 'text-rose-600 dark:text-rose-400 font-semibold'
                        }
                      >
                        {frame.checksumValid ? `${frame.wasmDecodeTimeUs}µs` : 'CRC ERR'}
                      </span>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Right 5 cols: Byte-Level Frame Dissector & Custom Hex Injector */}
        <div className="lg:col-span-5 flex flex-col justify-between gap-4">
          {inspectedFrame ? (
            <div className="border border-slate-200 dark:border-slate-800 rounded-md p-3 space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-slate-900 dark:text-slate-100 truncate">
                  {inspectedFrame.messageName}
                </span>
                <span className="text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400 shrink-0">
                  Frame #{inspectedFrame.id} · {inspectedFrame.wasmDecodeTimeUs} µs
                </span>
              </div>

              <p className="text-xs font-mono tabular-nums text-cyan-600 dark:text-cyan-400">
                {inspectedFrame.summary}
              </p>

              {/* Byte Breakdown Grid */}
              <div className="space-y-1.5 pt-1">
                {inspectedFrame.fields.map((f, idx) => (
                  <div
                    key={idx}
                    className="flex items-center justify-between gap-2 text-xs py-1 border-t border-slate-100 dark:border-slate-800/70"
                  >
                    <div className="min-w-0">
                      <span className="text-slate-500 dark:text-slate-400">
                        [{f.offset}..{f.offset + f.length - 1}] {f.label}:
                      </span>{' '}
                      <span className="font-mono font-semibold text-slate-900 dark:text-slate-200">
                        {f.rawHex}
                      </span>
                    </div>
                    <span className="font-mono text-[11px] text-slate-600 dark:text-slate-300 truncate">
                      {f.decodedValue}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {/* Manual Hex Frame Injector */}
          <form
            onSubmit={handleRunInject}
            className="border border-slate-200 dark:border-slate-800 rounded-md p-3 space-y-2.5"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                Inject Custom Wire Frame into Rust WASM
              </span>
              <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 p-0.5 rounded">
                {(['ANT+', 'BLE'] as const).map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setInjectProtocol(p)}
                    className={`px-2 py-0.5 text-[11px] font-medium rounded transition-colors ${
                      injectProtocol === p
                        ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100'
                        : 'text-slate-500 dark:text-slate-400'
                    }`}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-wrap gap-1.5">
              {PRESET_FRAMES.map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  onClick={() => {
                    setInjectProtocol(preset.protocol);
                    setInjectHex(preset.hex);
                  }}
                  className="text-[11px] text-slate-600 dark:text-slate-400 hover:text-cyan-600 dark:hover:text-cyan-400 underline underline-offset-2 transition-colors"
                >
                  {preset.label}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2">
              <input
                type="text"
                value={injectHex}
                onChange={(e) => setInjectHex(e.target.value)}
                placeholder="A4 09 4E 00 19 ..."
                className="flex-1 min-w-0 px-2.5 py-1.5 text-xs font-mono bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded text-slate-900 dark:text-slate-100 focus:outline-none focus:border-cyan-500"
              />
              <button
                type="submit"
                className="px-3 py-1.5 text-xs font-medium bg-cyan-600 hover:bg-cyan-500 text-white rounded transition-colors whitespace-nowrap shrink-0"
              >
                Decode Frame
              </button>
            </div>

            {injectFeedback && (
              <p className="text-[11px] font-mono text-slate-600 dark:text-slate-300 truncate">
                {injectFeedback}
              </p>
            )}
          </form>
        </div>
      </div>
    </div>
  );
};
