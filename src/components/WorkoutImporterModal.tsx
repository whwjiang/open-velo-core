import React, { useMemo, useRef, useState } from 'react';
import { StructuredWorkout } from '../sdk/types';
import {
  parseUniversalWorkout,
  SupportedWorkoutFormat,
} from '../sdk/workouts';

interface WorkoutImporterModalProps {
  isOpen: boolean;
  onClose: () => void;
  ftpWatts: number;
  onImportSuccess: (workout: StructuredWorkout, persistToTxt?: boolean) => void;
}

const FORMAT_SAMPLES: Record<
  Exclude<SupportedWorkoutFormat, 'FIT'>,
  { label: string; ext: string; code: string }
> = {
  SHORTHAND: {
    label: 'Shorthand Builder',
    ext: 'txt',
    code: `Title: Alpe du Zwift · Threshold & VO2max Ladder
Description: Progressive threshold ladder with 4x2m VO2max peaks.

- 5m 50-75% 90rpm Progressive Warmup
- 1m 105% 96rpm Neuromuscular Opener
- 2m 50% 85rpm Recovery Spin

3x
- 3m 96% 92rpm Sub-Threshold Under
- 1m 112% 98rpm Over-Threshold Surge
- 90s 52% 85rpm Recovery Float

- 4m 55-40% 85rpm Cooldown Taper`,
  },
  ZWO: {
    label: '.ZWO (Zwift XML)',
    ext: 'zwo',
    code: `<workout_file>
  <author>VeloCore Performance Studio</author>
  <name>Goddard · Mixed Criss-Cross &amp; Sprint</name>
  <description>Alternating threshold efforts with high-cadence anaerobic kicks.</description>
  <sportType>bike</sportType>
  <workout>
    <Warmup Duration="180" PowerLow="0.50" PowerHigh="0.82" Cadence="90"/>
    <IntervalsT Repeat="4" OnDuration="60" OffDuration="60" OnPower="1.15" OffPower="0.88" Cadence="98" CadenceResting="88"/>
    <SteadyState Duration="120" Power="0.50" Cadence="85"/>
    <SteadyState Duration="240" Power="0.95" Cadence="92"/>
    <Cooldown Duration="150" PowerLow="0.60" PowerHigh="0.40" Cadence="85"/>
  </workout>
</workout_file>`,
  },
  MRC: {
    label: '.MRC (% FTP)',
    ext: 'mrc',
    code: `[COURSE HEADER]
VERSION = 2
UNITS = ENGLISH
DESCRIPTION = TrainerRoad / GoldenCheetah Relative % FTP Course
FILE NAME = Palisade_Over_Under.mrc
MINUTES PERCENT
[END COURSE HEADER]
[COURSE DATA]
0.00	50
3.00	75
3.00	95
5.00	95
5.00	106
6.00	106
6.00	95
8.00	95
8.00	108
9.00	108
9.00	50
12.00	50
12.00	40
[END COURSE DATA]`,
  },
  ERG: {
    label: '.ERG (Watts)',
    ext: 'erg',
    code: `[COURSE HEADER]
VERSION = 2
UNITS = ENGLISH
DESCRIPTION = Absolute Wattage Smart Trainer ERG Course
FILE NAME = Anaerobic_Power_Steps.erg
FTP = 280
MINUTES WATTS
[END COURSE HEADER]
[COURSE DATA]
0.00	140
3.00	210
3.00	280
6.00	280
6.00	140
8.00	140
8.00	335
10.00	335
10.00	130
13.00	110
[END COURSE DATA]`,
  },
  JSON: {
    label: '.JSON (Structured)',
    ext: 'json',
    code: `{
  "title": "Carpathian Peak · Over-Under JSON",
  "author": "VeloCore SDK",
  "description": "Portable JSON workout schema for custom frontend integrations.",
  "segments": [
    { "name": "Warmup Ramp", "durationSec": 180, "targetFtpPct": 0.50, "endTargetFtpPct": 0.80, "targetCadenceRpm": 90 },
    { "name": "Threshold Base", "durationSec": 180, "targetFtpPct": 0.96, "targetCadenceRpm": 92 },
    { "name": "Anaerobic Surge", "durationSec": 60, "targetFtpPct": 1.18, "targetCadenceRpm": 98 },
    { "name": "Threshold Clearance", "durationSec": 180, "targetFtpPct": 0.94, "targetCadenceRpm": 90 },
    { "name": "Cooldown", "durationSec": 150, "targetFtpPct": 0.50, "endTargetFtpPct": 0.40, "targetCadenceRpm": 85 }
  ]
}`,
  },
};

function formatMinSec(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return s === 0 ? `${m}m` : `${m}m ${s}s`;
}

export const WorkoutImporterModal: React.FC<WorkoutImporterModalProps> = ({
  isOpen,
  onClose,
  ftpWatts,
  onImportSuccess,
}) => {
  const [activePreset, setActivePreset] =
    useState<Exclude<SupportedWorkoutFormat, 'FIT'>>('SHORTHAND');
  const [editorText, setEditorText] = useState<string>(
    FORMAT_SAMPLES.SHORTHAND.code
  );
  const [fileNameLabel, setFileNameLabel] = useState<string>(
    'Alpe_du_Zwift_Ladder.txt'
  );
  const [binaryParsedWorkout, setBinaryParsedWorkout] =
    useState<StructuredWorkout | null>(null);
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [persistToTxt, setPersistToTxt] = useState<boolean>(true);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Live preview compilation
  const livePreview = useMemo<{
    workout: StructuredWorkout | null;
    format: SupportedWorkoutFormat | null;
    error: string | null;
  }>(() => {
    if (binaryParsedWorkout) {
      return { workout: binaryParsedWorkout, format: 'FIT', error: null };
    }
    try {
      const res = parseUniversalWorkout(editorText, fileNameLabel, ftpWatts);
      return { workout: res.workout, format: res.detectedFormat, error: null };
    } catch (err) {
      return {
        workout: null,
        format: null,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }, [editorText, fileNameLabel, ftpWatts, binaryParsedWorkout]);

  if (!isOpen) return null;

  const handleSelectFormatTab = (
    fmt: Exclude<SupportedWorkoutFormat, 'FIT'>
  ) => {
    setActivePreset(fmt);
    setBinaryParsedWorkout(null);
    setUploadError(null);
    setEditorText(FORMAT_SAMPLES[fmt].code);
    setFileNameLabel(`Sample_Workout.${FORMAT_SAMPLES[fmt].ext}`);
  };

  const processUploadedFile = async (file: File) => {
    setUploadError(null);
    setFileNameLabel(file.name);
    try {
      if (file.name.toLowerCase().endsWith('.fit')) {
        const buffer = await file.arrayBuffer();
        const res = parseUniversalWorkout(buffer, file.name, ftpWatts);
        setBinaryParsedWorkout(res.workout);
      } else {
        const text = await file.text();
        setBinaryParsedWorkout(null);
        setEditorText(text);
      }
    } catch (err) {
      setUploadError(
        `Failed to parse ${file.name}: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
  };

  const handleDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      await processUploadedFile(file);
    }
  };

  const handleDownloadSample = () => {
    const sample = FORMAT_SAMPLES[activePreset];
    const blob = new Blob([editorText], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `velocore_workout.${sample.ext}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleConfirmImport = () => {
    if (!livePreview.workout) return;
    onImportSuccess(livePreview.workout, persistToTxt);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="workout-import-title"
    >
      <div className="w-full max-w-5xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 rounded-lg p-6 space-y-5 max-h-[92vh] overflow-y-auto">
        {/* Modal Header */}
        <div className="flex flex-wrap items-center justify-between gap-4 pb-3 border-b border-slate-200 dark:border-slate-800">
          <div>
            <h2
              id="workout-import-title"
              className="text-base font-semibold text-slate-900 dark:text-slate-100"
            >
              Import or Create Workout
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Drop a workout file (<code className="font-mono">.TXT</code>,{' '}
              <code className="font-mono">.ZWO</code>,{' '}
              <code className="font-mono">.MRC</code>,{' '}
              <code className="font-mono">.ERG</code>,{' '}
              <code className="font-mono">.FIT</code>,{' '}
              <code className="font-mono">.JSON</code>) or author intervals in plain text scaled to your {ftpWatts} W FTP.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-1.5 text-xs text-slate-700 dark:text-slate-300 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={persistToTxt}
                onChange={(e) => setPersistToTxt(e.target.checked)}
                className="rounded border-slate-300 dark:border-slate-700 accent-cyan-600"
              />
              <span>Persist to workouts.txt</span>
            </label>
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 text-xs font-medium rounded-md border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={!livePreview.workout}
              onClick={handleConfirmImport}
              className="px-4 py-1.5 text-xs font-medium rounded-md bg-cyan-600 hover:bg-cyan-500 disabled:opacity-40 text-white transition-colors whitespace-nowrap shrink-0"
            >
              {persistToTxt ? 'Save to workouts.txt & Load' : 'Load into Cockpit'}
            </button>
          </div>
        </div>

        {/* Drag-and-Drop File Zone */}
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`border-2 border-dashed rounded-lg p-4 text-center cursor-pointer transition-colors ${
            isDragging
              ? 'border-cyan-500 bg-cyan-500/10'
              : 'border-slate-300 dark:border-slate-700 hover:border-cyan-500/70 bg-slate-50/60 dark:bg-slate-950/50'
          }`}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".zwo,.erg,.mrc,.fit,.json,.xml,.txt"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) processUploadedFile(f);
            }}
            className="hidden"
          />
          <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">
            Drag &amp; drop a workout file here, or click to browse disk
          </div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono mt-1">
            Supported formats: Zwift (.zwo) · TrainerRoad / GoldenCheetah (.mrc / .erg) · Garmin Binary (.fit) · Structured (.json / .txt)
          </div>
        </div>

        {uploadError && (
          <div className="px-3 py-2 text-xs font-mono border border-rose-500/40 bg-rose-500/10 text-rose-600 dark:text-rose-300 rounded">
            {uploadError}
          </div>
        )}

        {/* Two-Column Split: Left Source Editor / Format Switcher + Right Live Visual & Step Preview */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch">
          {/* Left 6 Cols: Format Presets & Source Editor */}
          <div className="lg:col-span-6 flex flex-col justify-between space-y-3 border border-slate-200 dark:border-slate-800 rounded-lg p-4">
            <div className="space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                  Workout Source / Template
                </span>
                <button
                  type="button"
                  onClick={handleDownloadSample}
                  className="text-xs text-cyan-600 dark:text-cyan-400 hover:underline whitespace-nowrap shrink-0"
                >
                  Download .{FORMAT_SAMPLES[activePreset].ext} File
                </button>
              </div>

              {/* Format Selector Buttons */}
              <div className="flex flex-wrap items-center gap-1 bg-slate-100 dark:bg-slate-800 p-1 rounded-md">
                {(
                  Object.keys(FORMAT_SAMPLES) as Exclude<
                    SupportedWorkoutFormat,
                    'FIT'
                  >[]
                ).map((fmtKey) => (
                  <button
                    key={fmtKey}
                    type="button"
                    onClick={() => handleSelectFormatTab(fmtKey)}
                    className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
                      activePreset === fmtKey && !binaryParsedWorkout
                        ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                    }`}
                  >
                    {FORMAT_SAMPLES[fmtKey].label}
                  </button>
                ))}
              </div>
            </div>

            {binaryParsedWorkout ? (
              <div className="flex-1 flex flex-col items-center justify-center p-6 border border-slate-200 dark:border-slate-800 rounded bg-slate-50 dark:bg-slate-950 text-center space-y-2">
                <div className="text-xs font-mono font-semibold text-cyan-600 dark:text-cyan-400">
                  Binary Garmin .FIT Workout Loaded ({fileNameLabel})
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Decoded {binaryParsedWorkout.segments.length} binary workout steps. Click any text format tab above to switch back to the text compiler.
                </p>
              </div>
            ) : (
              <textarea
                rows={13}
                value={editorText}
                onChange={(e) => setEditorText(e.target.value)}
                spellCheck={false}
                className="w-full flex-1 p-3 text-xs font-mono bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded-md text-slate-900 dark:text-slate-100 focus:outline-none focus:border-cyan-500 leading-relaxed"
              />
            )}
          </div>

          {/* Right 6 Cols: Live Compiled Interval Profile & Step Table */}
          <div className="lg:col-span-6 border border-slate-200 dark:border-slate-800 rounded-lg p-4 flex flex-col justify-between space-y-4">
            {livePreview.workout ? (
              <>
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                    <span className="text-cyan-600 dark:text-cyan-400 font-semibold">
                      Detected Format: {livePreview.format}
                    </span>
                    <span>
                      {formatMinSec(livePreview.workout.totalDurationSec)} · IF{' '}
                      {livePreview.workout.intensityFactor.toFixed(2)} ·{' '}
                      {livePreview.workout.tss} TSS
                    </span>
                  </div>

                  <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    {livePreview.workout.title}
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 line-clamp-2">
                    {livePreview.workout.description}
                  </p>

                  {/* Visual Interval Profile Bar Chart */}
                  <div className="h-24 flex items-end gap-0.5 pt-3 px-2 pb-1 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-md">
                    {livePreview.workout.segments.map((seg) => {
                      const avgPct =
                        seg.endTargetFtpPct !== undefined
                          ? (seg.targetFtpPct + seg.endTargetFtpPct) / 2
                          : seg.targetFtpPct;
                      const heightPct = Math.max(
                        15,
                        Math.min(100, Math.round((avgPct / 1.4) * 100))
                      );
                      const flexWeight = Math.max(
                        1,
                        Math.round(seg.durationSec / 15)
                      );
                      return (
                        <div
                          key={seg.id}
                          style={{
                            height: `${heightPct}%`,
                            flexGrow: flexWeight,
                          }}
                          className={`rounded-t-xs transition-all ${
                            avgPct >= 1.15
                              ? 'bg-amber-500'
                              : avgPct >= 0.92
                                ? 'bg-cyan-500'
                                : avgPct >= 0.75
                                  ? 'bg-emerald-500'
                                  : 'bg-slate-400 dark:bg-slate-600'
                          }`}
                          title={`${seg.name}: ${Math.round(avgPct * ftpWatts)} W (${formatMinSec(seg.durationSec)})`}
                        />
                      );
                    })}
                  </div>
                </div>

                {/* Decoded Interval Step Table */}
                <div className="border border-slate-200 dark:border-slate-800 rounded-md overflow-hidden flex-1">
                  <div className="max-h-52 overflow-y-auto divide-y divide-slate-200 dark:divide-slate-800 text-xs font-mono tabular-nums">
                    <div className="grid grid-cols-12 gap-2 px-3 py-1.5 bg-slate-50 dark:bg-slate-950 text-slate-500 dark:text-slate-400 font-sans text-[11px] font-medium sticky top-0">
                      <div className="col-span-5">Interval Step</div>
                      <div className="col-span-2 text-right">Duration</div>
                      <div className="col-span-3 text-right">Target Watts</div>
                      <div className="col-span-2 text-right">Cadence</div>
                    </div>
                    {livePreview.workout.segments.map((seg, i) => {
                      const wStart = Math.round(seg.targetFtpPct * ftpWatts);
                      const wEnd =
                        seg.endTargetFtpPct !== undefined
                          ? Math.round(seg.endTargetFtpPct * ftpWatts)
                          : wStart;
                      return (
                        <div
                          key={seg.id}
                          className="grid grid-cols-12 gap-2 px-3 py-1.5 items-center text-slate-700 dark:text-slate-300"
                        >
                          <div className="col-span-5 truncate font-sans text-xs">
                            <span className="font-mono text-slate-400 mr-1.5">
                              {i + 1}.
                            </span>
                            {seg.name}
                          </div>
                          <div className="col-span-2 text-right text-slate-500">
                            {formatMinSec(seg.durationSec)}
                          </div>
                          <div className="col-span-3 text-right font-semibold text-cyan-600 dark:text-cyan-400">
                            {wStart === wEnd ? `${wStart} W` : `${wStart}→${wEnd} W`}
                          </div>
                          <div className="col-span-2 text-right text-slate-500">
                            {seg.targetCadenceRpm ? `${seg.targetCadenceRpm}rpm` : '—'}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center p-6 text-xs font-mono text-rose-600 dark:text-rose-400 border border-rose-500/30 bg-rose-500/5 rounded-md">
                {livePreview.error || 'Unable to parse workout syntax.'}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
