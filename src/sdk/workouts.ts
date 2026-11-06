import {
  StructuredWorkout,
  TelemetryHistoryPoint,
  WorkoutIntervalSegment,
} from './types';

export type SupportedWorkoutFormat = 'ZWO' | 'MRC' | 'ERG' | 'FIT' | 'JSON' | 'SHORTHAND';

export function classifyZone(ftpPct: number): WorkoutIntervalSegment['zoneLabel'] {
  if (ftpPct < 0.56) return 'Z1 Recovery';
  if (ftpPct < 0.76) return 'Z2 Endurance';
  if (ftpPct < 0.91) return 'Z3 Tempo';
  if (ftpPct < 1.06) return 'Z4 Threshold';
  if (ftpPct < 1.21) return 'Z5 VO2max';
  return 'Z6 Anaerobic';
}

export function computeWorkoutMetrics(segments: WorkoutIntervalSegment[]): {
  totalDurationSec: number;
  intensityFactor: number;
  tss: number;
} {
  let totalSec = 0;
  let fourthPowerSum = 0;

  for (const seg of segments) {
    const avgPct =
      seg.endTargetFtpPct !== undefined
        ? (seg.targetFtpPct + seg.endTargetFtpPct) / 2
        : seg.targetFtpPct;
    totalSec += seg.durationSec;
    fourthPowerSum += Math.pow(avgPct, 4) * seg.durationSec;
  }

  if (totalSec === 0) {
    return { totalDurationSec: 0, intensityFactor: 0, tss: 0 };
  }

  const intensityFactor = Number(Math.pow(fourthPowerSum / totalSec, 0.25).toFixed(2));
  const tss = Math.round((totalSec * intensityFactor * intensityFactor * 100) / 3600);
  return { totalDurationSec: totalSec, intensityFactor, tss };
}

export const BUILTIN_WORKOUTS: StructuredWorkout[] = [
  (() => {
    const segments: WorkoutIntervalSegment[] = [
      {
        id: 'mc-1',
        name: 'Progressive Warmup',
        durationSec: 180,
        targetFtpPct: 0.55,
        endTargetFtpPct: 0.75,
        targetCadenceRpm: 90,
        zoneLabel: 'Z2 Endurance',
        coachCue: 'Spin easily at 90 RPM while ANT+ FE-C and BLE sensors lock baseline calibration.',
      },
      {
        id: 'mc-2',
        name: 'Primer Opener',
        durationSec: 60,
        targetFtpPct: 1.02,
        targetCadenceRpm: 95,
        zoneLabel: 'Z4 Threshold',
        coachCue: 'Quick 60-second threshold primer to recruit fast-twitch motor units.',
      },
      {
        id: 'mc-3',
        name: 'Active Recovery',
        durationSec: 120,
        targetFtpPct: 0.5,
        targetCadenceRpm: 85,
        zoneLabel: 'Z1 Recovery',
        coachCue: 'Deep belly breaths. Let ERG mode drop brake resistance smoothly.',
      },
      {
        id: 'mc-4',
        name: 'Set 1 · Under (95% FTP)',
        durationSec: 120,
        targetFtpPct: 0.95,
        targetCadenceRpm: 90,
        zoneLabel: 'Z4 Threshold',
        coachCue: 'Settle just below lactate threshold. Keep upper body relaxed.',
      },
      {
        id: 'mc-5',
        name: 'Set 1 · Over Surge (105% FTP)',
        durationSec: 60,
        targetFtpPct: 1.05,
        targetCadenceRpm: 94,
        zoneLabel: 'Z4 Threshold',
        coachCue: 'Hold cadence steady as FE-C Page 49 steps target wattage to 105% FTP.',
      },
      {
        id: 'mc-6',
        name: 'Set 1 · Under Clearance (95% FTP)',
        durationSec: 120,
        targetFtpPct: 0.95,
        targetCadenceRpm: 90,
        zoneLabel: 'Z4 Threshold',
        coachCue: 'Process lactate while still pushing 95% FTP.',
      },
      {
        id: 'mc-7',
        name: 'Set 1 · Over Surge (105% FTP)',
        durationSec: 60,
        targetFtpPct: 1.05,
        targetCadenceRpm: 95,
        zoneLabel: 'Z4 Threshold',
        coachCue: 'Drive over the top of the pedal stroke through the final 60s surge.',
      },
      {
        id: 'mc-8',
        name: 'Mid-Session Valley',
        durationSec: 180,
        targetFtpPct: 0.5,
        targetCadenceRpm: 85,
        zoneLabel: 'Z1 Recovery',
        coachCue: 'Hydrate and watch W-prime balance reconstitute in the telemetry ribbon.',
      },
      {
        id: 'mc-9',
        name: 'Set 2 · Under (95% FTP)',
        durationSec: 120,
        targetFtpPct: 0.95,
        targetCadenceRpm: 90,
        zoneLabel: 'Z4 Threshold',
        coachCue: 'Second over-under wave. Smooth torque across all 360 degrees.',
      },
      {
        id: 'mc-10',
        name: 'Set 2 · Over Surge (106% FTP)',
        durationSec: 60,
        targetFtpPct: 1.06,
        targetCadenceRpm: 95,
        zoneLabel: 'Z5 VO2max',
        coachCue: 'Commit to the cadence—do not let RPM bog down in ERG mode.',
      },
      {
        id: 'mc-11',
        name: 'Set 2 · Under Clearance (95% FTP)',
        durationSec: 120,
        targetFtpPct: 0.95,
        targetCadenceRpm: 90,
        zoneLabel: 'Z4 Threshold',
        coachCue: 'Control your breathing rate and stabilize heart rate drift.',
      },
      {
        id: 'mc-12',
        name: 'Set 2 · Final Over Surge (108% FTP)',
        durationSec: 60,
        targetFtpPct: 1.08,
        targetCadenceRpm: 96,
        zoneLabel: 'Z5 VO2max',
        coachCue: 'Empty the tank for the final 60 seconds above threshold.',
      },
      {
        id: 'mc-13',
        name: 'Flush Cooldown',
        durationSec: 180,
        targetFtpPct: 0.55,
        endTargetFtpPct: 0.4,
        targetCadenceRpm: 85,
        zoneLabel: 'Z1 Recovery',
        coachCue: 'Gradual taper down to 40% FTP.',
      },
    ];
    const stats = computeWorkoutMetrics(segments);
    return {
      id: 'mcadie-over-under',
      title: 'McAdie +1 · Over-Under Lactate Shuttle',
      category: 'Threshold',
      description:
        'Classic alternating 95% / 105% FTP over-under blocks engineered to train MCT1 lactate shuttling while testing rapid ANT+ FE-C / BLE FTMS ERG step transitions.',
      author: 'VeloCore Performance Lab',
      ...stats,
      segments,
    };
  })(),

  (() => {
    const segments: WorkoutIntervalSegment[] = [
      {
        id: 'sp-1',
        name: 'Aerobic Ramp Warmup',
        durationSec: 180,
        targetFtpPct: 0.5,
        endTargetFtpPct: 0.78,
        targetCadenceRpm: 90,
        zoneLabel: 'Z2 Endurance',
        coachCue: 'Gradually bring core temperature up before VO2max repeats.',
      },
      {
        id: 'sp-2',
        name: 'Recovery Spin',
        durationSec: 90,
        targetFtpPct: 0.5,
        targetCadenceRpm: 85,
        zoneLabel: 'Z1 Recovery',
        coachCue: 'Prepare for Interval 1 at 120% FTP.',
      },
      ...[1, 2, 3, 4].flatMap((rep): WorkoutIntervalSegment[] => [
        {
          id: `sp-vo2-${rep}`,
          name: `VO2max Repeat ${rep}/4 (120% FTP)`,
          durationSec: 120,
          targetFtpPct: 1.2,
          targetCadenceRpm: 98,
          zoneLabel: 'Z5 VO2max',
          coachCue: `VO2max Interval ${rep}: High cadence (95-100 RPM) to minimize muscular fatigue while maximizing cardiac stroke volume.`,
        },
        {
          id: `sp-rec-${rep}`,
          name: `Recovery Valley ${rep}/4`,
          durationSec: 120,
          targetFtpPct: 0.45,
          targetCadenceRpm: 82,
          zoneLabel: 'Z1 Recovery',
          coachCue: 'Full recovery valley at 45% FTP. Watch W-prime recharge.',
        },
      ]),
      {
        id: 'sp-cool',
        name: 'Cooldown Taper',
        durationSec: 150,
        targetFtpPct: 0.5,
        endTargetFtpPct: 0.38,
        targetCadenceRpm: 85,
        zoneLabel: 'Z1 Recovery',
        coachCue: 'Easy spin to clear residual metabolic byproducts.',
      },
    ];
    const stats = computeWorkoutMetrics(segments);
    return {
      id: 'spencer-vo2max',
      title: 'Spencer · 4x2m Maximal Aerobic Power',
      category: 'VO2max',
      description:
        'Four 2-minute intervals at 120% FTP separated by equal 2-minute recoveries to maximize oxygen uptake kinetics and test W\'bal depletion accuracy.',
      author: 'VeloCore Performance Lab',
      ...stats,
      segments,
    };
  })(),

  (() => {
    const segments: WorkoutIntervalSegment[] = [
      {
        id: 'kw-1',
        name: 'Warmup Step 1',
        durationSec: 150,
        targetFtpPct: 0.55,
        targetCadenceRpm: 88,
        zoneLabel: 'Z1 Recovery',
        coachCue: 'Easy aerobic warmup spin.',
      },
      {
        id: 'kw-2',
        name: 'Warmup Step 2',
        durationSec: 120,
        targetFtpPct: 0.75,
        targetCadenceRpm: 92,
        zoneLabel: 'Z2 Endurance',
        coachCue: 'Build aerobic rhythm at 75% FTP.',
      },
      ...[1, 2, 3].flatMap((rep): WorkoutIntervalSegment[] => [
        {
          id: `kw-ss-${rep}`,
          name: `Sweet Spot Block ${rep}/3 (90% FTP)`,
          durationSec: 240,
          targetFtpPct: 0.9,
          targetCadenceRpm: 90,
          zoneLabel: 'Z3 Tempo',
          coachCue: `Sustained 90% FTP Sweet Spot block ${rep}. Focus on aero posture and low heart-rate decoupling.`,
        },
        {
          id: `kw-rest-${rep}`,
          name: `Recovery Spin ${rep}/3`,
          durationSec: 90,
          targetFtpPct: 0.5,
          targetCadenceRpm: 85,
          zoneLabel: 'Z1 Recovery',
          coachCue: 'Take a drink and reset posture.',
        },
      ]),
      {
        id: 'kw-cool',
        name: 'Cooldown',
        durationSec: 120,
        targetFtpPct: 0.45,
        targetCadenceRpm: 85,
        zoneLabel: 'Z1 Recovery',
        coachCue: 'Easy spin down.',
      },
    ];
    const stats = computeWorkoutMetrics(segments);
    return {
      id: 'kaweah-sweet-spot',
      title: 'Kaweah · Sustained Sweet Spot 90%',
      category: 'Sweet Spot',
      description:
        'Three sustained blocks at 90% FTP building muscular endurance and glycogen efficiency without crossing critical power.',
      author: 'VeloCore Performance Lab',
      ...stats,
      segments,
    };
  })(),

  (() => {
    const segments: WorkoutIntervalSegment[] = [
      {
        id: 'sn-1',
        name: 'Warmup Ramp',
        durationSec: 150,
        targetFtpPct: 0.5,
        endTargetFtpPct: 0.85,
        targetCadenceRpm: 92,
        zoneLabel: 'Z2 Endurance',
        coachCue: 'Progressive ramp before high-frequency 30/30 microbursts.',
      },
      ...[1, 2, 3, 4, 5, 6].flatMap((rep): WorkoutIntervalSegment[] => [
        {
          id: `sn-on-${rep}`,
          name: `Microburst ${rep}/6 (135% FTP)`,
          durationSec: 30,
          targetFtpPct: 1.35,
          targetCadenceRpm: 102,
          zoneLabel: 'Z6 Anaerobic',
          coachCue: `30s anaerobic surge ${rep}/6! Fast leg speed as smart trainer snaps to 135% FTP.`,
        },
        {
          id: `sn-off-${rep}`,
          name: `Float ${rep}/6 (50% FTP)`,
          durationSec: 30,
          targetFtpPct: 0.5,
          targetCadenceRpm: 85,
          zoneLabel: 'Z1 Recovery',
          coachCue: '30s float—keep pedals turning smoothly for next surge.',
        },
      ]),
      {
        id: 'sn-cool',
        name: 'Recovery Cooldown',
        durationSec: 150,
        targetFtpPct: 0.45,
        targetCadenceRpm: 85,
        zoneLabel: 'Z1 Recovery',
        coachCue: 'Spin out the legs.',
      },
    ];
    const stats = computeWorkoutMetrics(segments);
    return {
      id: 'spanish-needle-microbursts',
      title: 'Spanish Needle · 30/30 Anaerobic Microbursts',
      category: 'Anaerobic',
      description:
        'High-frequency 30-second 135% FTP surges paired with 30-second floats—ideal for stress-testing trainer ERG response time and WASM packet throughput.',
      author: 'VeloCore Performance Lab',
      ...stats,
      segments,
    };
  })(),

  (() => {
    // 1:30:00 (90 minutes / 5400 seconds) steady Zone 2 endurance ride at 50% FTP
    const segments: WorkoutIntervalSegment[] = [
      {
        id: 'z2-steady-warmup',
        name: 'Aerobic Spin-Up',
        durationSec: 300, // 5 min
        targetFtpPct: 0.45,
        endTargetFtpPct: 0.50,
        targetCadenceRpm: 88,
        zoneLabel: 'Z2 Endurance',
        coachCue: 'Gradually settle into cadence and let the smart trainer lock 50% FTP in ERG mode.',
      },
      {
        id: 'z2-steady-block',
        name: 'Zone 2 Steady State (50% FTP)',
        durationSec: 4800, // 80 min
        targetFtpPct: 0.50,
        targetCadenceRpm: 90,
        zoneLabel: 'Z2 Endurance',
        coachCue: 'Steady endurance aerobic cruise. Optimal mitochondrial respiration, fat oxidation, and cardiac stroke volume.',
      },
      {
        id: 'z2-steady-cooldown',
        name: 'Easy Spin-Down',
        durationSec: 300, // 5 min
        targetFtpPct: 0.50,
        endTargetFtpPct: 0.40,
        targetCadenceRpm: 85,
        zoneLabel: 'Z1 Recovery',
        coachCue: 'Gradual easy spin down to conclude the 90-minute endurance session.',
      },
    ];
    const stats = computeWorkoutMetrics(segments);
    return {
      id: 'steady-zone-two-90m',
      title: 'Pettit 90 · Steady Zone 2 (50% FTP · 1:30)',
      category: 'Endurance',
      description:
        'Continuous 90-minute (1:30:00) steady Zone 2 endurance ride held at 50% FTP. Engineered for aerobic base conditioning, fat oxidation, and comfortable low-strain steady-state trainer sessions.',
      author: 'VeloCore Performance Lab',
      ...stats,
      segments,
    };
  })(),
];

/**
 * Parses a Zwift `.zwo` XML workout file into a `StructuredWorkout`
 */
export function parseZwoWorkoutXml(xmlText: string, fileName: string): StructuredWorkout {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlText, 'text/xml');

  const nameNode = doc.querySelector('name');
  const descNode = doc.querySelector('description');
  const authorNode = doc.querySelector('author');

  const title = nameNode?.textContent?.trim() || fileName.replace(/\.(zwo|xml)$/i, '');
  const description =
    descNode?.textContent?.trim() || 'Imported custom structured workout (.ZWO XML).';
  const author = authorNode?.textContent?.trim() || 'Imported ZWO';

  const workoutContainer = doc.querySelector('workout');
  const segments: WorkoutIntervalSegment[] = [];

  if (workoutContainer) {
    let idx = 1;
    for (const el of Array.from(workoutContainer.children)) {
      const tag = el.tagName.toLowerCase();
      const duration = Math.max(5, Math.round(Number(el.getAttribute('Duration') || 60)));
      const cadence = el.getAttribute('Cadence')
        ? Number(el.getAttribute('Cadence'))
        : undefined;
      const textEvent = el.querySelector('textevent')?.getAttribute('message');

      if (tag === 'steadystate') {
        const rawPower = Number(el.getAttribute('Power') || 0.75);
        const power = rawPower > 3 ? rawPower / 100 : rawPower;
        segments.push({
          id: `zwo-${idx++}`,
          name: `Steady State (${Math.round(power * 100)}% FTP)`,
          durationSec: duration,
          targetFtpPct: Number(power.toFixed(3)),
          targetCadenceRpm: cadence,
          zoneLabel: classifyZone(power),
          coachCue: textEvent || `Hold steady at ${Math.round(power * 100)}% FTP.`,
        });
      } else if (tag === 'warmup' || tag === 'cooldown' || tag === 'ramp') {
        const rawLow = Number(el.getAttribute('PowerLow') || 0.5);
        const rawHigh = Number(el.getAttribute('PowerHigh') || 0.85);
        const pLow = rawLow > 3 ? rawLow / 100 : rawLow;
        const pHigh = rawHigh > 3 ? rawHigh / 100 : rawHigh;
        segments.push({
          id: `zwo-${idx++}`,
          name: `${tag.charAt(0).toUpperCase() + tag.slice(1)} (${Math.round(pLow * 100)}% → ${Math.round(pHigh * 100)}%)`,
          durationSec: duration,
          targetFtpPct: Number(pLow.toFixed(3)),
          endTargetFtpPct: Number(pHigh.toFixed(3)),
          targetCadenceRpm: cadence,
          zoneLabel: classifyZone((pLow + pHigh) / 2),
          coachCue:
            textEvent ||
            `Progressive ramp from ${Math.round(pLow * 100)}% to ${Math.round(pHigh * 100)}% FTP.`,
        });
      } else if (tag === 'intervalst') {
        const repeat = Math.max(1, Math.min(40, Number(el.getAttribute('Repeat') || 3)));
        const onDuration = Math.max(5, Number(el.getAttribute('OnDuration') || 60));
        const offDuration = Math.max(5, Number(el.getAttribute('OffDuration') || 60));
        const rawOn = Number(el.getAttribute('OnPower') || 1.15);
        const rawOff = Number(el.getAttribute('OffPower') || 0.5);
        const onPower = rawOn > 3 ? rawOn / 100 : rawOn;
        const offPower = rawOff > 3 ? rawOff / 100 : rawOff;
        const restingCadence = el.getAttribute('CadenceResting')
          ? Number(el.getAttribute('CadenceResting'))
          : undefined;

        for (let r = 1; r <= repeat; r++) {
          segments.push({
            id: `zwo-${idx++}`,
            name: `Interval ${r}/${repeat} ON (${Math.round(onPower * 100)}%)`,
            durationSec: onDuration,
            targetFtpPct: Number(onPower.toFixed(3)),
            targetCadenceRpm: cadence,
            zoneLabel: classifyZone(onPower),
            coachCue:
              textEvent || `Work interval ${r} of ${repeat} at ${Math.round(onPower * 100)}% FTP.`,
          });
          segments.push({
            id: `zwo-${idx++}`,
            name: `Interval ${r}/${repeat} OFF (${Math.round(offPower * 100)}%)`,
            durationSec: offDuration,
            targetFtpPct: Number(offPower.toFixed(3)),
            targetCadenceRpm: restingCadence,
            zoneLabel: classifyZone(offPower),
            coachCue: `Recovery float ${r} of ${repeat} at ${Math.round(offPower * 100)}% FTP.`,
          });
        }
      } else if (tag === 'freeride') {
        segments.push({
          id: `zwo-${idx++}`,
          name: 'Free Ride Block',
          durationSec: duration,
          targetFtpPct: 0.75,
          targetCadenceRpm: cadence,
          zoneLabel: 'Z2 Endurance',
          coachCue: textEvent || 'Free-ride segment—adjust slope or resistance freely.',
        });
      }
    }
  }

  if (segments.length === 0) {
    throw new Error('No valid <workout> interval steps found in .ZWO XML.');
  }

  const stats = computeWorkoutMetrics(segments);
  return {
    id: `zwo-${Date.now()}`,
    title,
    category: 'Custom Import',
    description,
    author,
    ...stats,
    segments,
  };
}

/**
 * Parses `.MRC` (Relative % FTP) or `.ERG` (Absolute Watts) course files used by TrainerRoad,
 * GoldenCheetah, TrainingPeaks, and PerfPRO.
 */
export function parseErgOrMrcWorkout(
  text: string,
  fileName: string,
  userFtpWatts: number
): StructuredWorkout {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('#') && !l.startsWith(';'));

  let headerFtp = userFtpWatts;
  let description = '';
  let title = fileName.replace(/\.(erg|mrc)$/i, '');
  let isWattsMode = fileName.toLowerCase().endsWith('.erg');

  let section: 'NONE' | 'HEADER' | 'DATA' | 'TEXT' = 'NONE';
  const dataPoints: { minutes: number; value: number }[] = [];
  const textCues: { sec: number; message: string }[] = [];

  for (const line of lines) {
    const upper = line.toUpperCase();
    if (upper.includes('[COURSE HEADER]')) {
      section = 'HEADER';
      continue;
    }
    if (upper.includes('[END COURSE HEADER]')) {
      section = 'NONE';
      continue;
    }
    if (upper.includes('[COURSE DATA]')) {
      section = 'DATA';
      continue;
    }
    if (upper.includes('[END COURSE DATA]')) {
      section = 'NONE';
      continue;
    }
    if (upper.includes('[COURSE TEXT]')) {
      section = 'TEXT';
      continue;
    }
    if (upper.includes('[END COURSE TEXT]')) {
      section = 'NONE';
      continue;
    }

    if (section === 'HEADER') {
      const [rawKey, ...rest] = line.split('=');
      if (rawKey && rest.length > 0) {
        const key = rawKey.trim().toUpperCase();
        const val = rest.join('=').trim();
        if (key === 'FTP') {
          const parsedFtp = Number(val);
          if (parsedFtp > 50 && parsedFtp < 600) headerFtp = parsedFtp;
          isWattsMode = true;
        } else if (key === 'DESCRIPTION') {
          description = val;
        } else if (key === 'FILE NAME' && !title) {
          title = val.replace(/\.(erg|mrc)$/i, '');
        } else if (key.includes('WATTS')) {
          isWattsMode = true;
        } else if (key.includes('PERCENT')) {
          isWattsMode = false;
        }
      }
    } else if (section === 'DATA') {
      const parts = line.split(/[\s,;]+/).filter(Boolean);
      if (parts.length >= 2) {
        const mins = Number(parts[0]);
        const val = Number(parts[1]);
        if (!Number.isNaN(mins) && !Number.isNaN(val)) {
          dataPoints.push({ minutes: mins, value: val });
        }
      }
    } else if (section === 'TEXT') {
      const parts = line.split(/\t|\s{2,}/).filter(Boolean);
      if (parts.length >= 2) {
        const sec = Number(parts[0]);
        const msg = parts[parts.length - 1];
        if (!Number.isNaN(sec) && msg) {
          textCues.push({ sec, message: msg });
        }
      }
    }
  }

  const segments: WorkoutIntervalSegment[] = [];
  for (let i = 0; i < dataPoints.length - 1; i++) {
    const p0 = dataPoints[i];
    const p1 = dataPoints[i + 1];
    const dtMin = p1.minutes - p0.minutes;
    if (dtMin <= 0.01) continue;

    const durationSec = Math.max(5, Math.round(dtMin * 60));
    const startPct = isWattsMode
      ? p0.value / Math.max(100, headerFtp)
      : p0.value / 100;
    const endPct = isWattsMode
      ? p1.value / Math.max(100, headerFtp)
      : p1.value / 100;

    const isRamp = Math.abs(endPct - startPct) >= 0.03;
    const avgPct = (startPct + endPct) / 2;
    const startSec = Math.round(p0.minutes * 60);
    const matchingCue = textCues.find(
      (c) => c.sec >= startSec && c.sec < startSec + durationSec
    );

    const stepNum = segments.length + 1;
    segments.push({
      id: `erg-${stepNum}`,
      name: isRamp
        ? `Step ${stepNum} Ramp (${Math.round(startPct * 100)}% → ${Math.round(endPct * 100)}%)`
        : `Step ${stepNum} (${Math.round(startPct * 100)}% FTP)`,
      durationSec,
      targetFtpPct: Number(startPct.toFixed(3)),
      endTargetFtpPct: isRamp ? Number(endPct.toFixed(3)) : undefined,
      targetCadenceRpm: avgPct >= 1.05 ? 95 : 90,
      zoneLabel: classifyZone(avgPct),
      coachCue:
        matchingCue?.message ||
        (isRamp
          ? `Ramp from ${Math.round(startPct * 100)}% to ${Math.round(endPct * 100)}% FTP over ${durationSec}s.`
          : `Hold ${Math.round(startPct * 100)}% FTP (${Math.round(startPct * userFtpWatts)} W) for ${durationSec}s.`),
    });
  }

  if (segments.length === 0) {
    throw new Error('No valid [COURSE DATA] time/effort pairs found in .ERG / .MRC file.');
  }

  const stats = computeWorkoutMetrics(segments);
  return {
    id: `erg-mrc-${Date.now()}`,
    title: title || 'Imported Course Workout',
    category: 'Custom Import',
    description:
      description ||
      `Imported ${isWattsMode ? '.ERG (Absolute Watts)' : '.MRC (Relative % FTP)'} structured course workout.`,
    author: isWattsMode ? 'ERG Course Importer' : 'MRC Course Importer',
    ...stats,
    segments,
  };
}

/**
 * Parses Intervals.icu / TrainerRoad workout builder shorthand text:
 * Examples:
 *   Title: High Altitude Sweet Spot
 *   - 10m 50-75% 90rpm Progressive warmup
 *   3x
 *   - 4m 92% 92rpm Sweet Spot block
 *   - 90s 50% 85rpm Recovery spin
 *   - 5m 55-40% Cooldown
 */
export function parseShorthandWorkout(
  text: string,
  userFtpWatts: number,
  fallbackTitle = 'Custom Shorthand Workout'
): StructuredWorkout {
  const rawLines = text.split(/\r?\n/);
  let title = fallbackTitle;
  let description = 'Compiled from structured interval shorthand syntax.';

  interface ParsedStepLine {
    durationSec: number;
    startPct: number;
    endPct?: number;
    cadenceRpm?: number;
    label: string;
  }

  const parseSingleStep = (line: string): ParsedStepLine | null => {
    const cleaned = line.replace(/^[-*•]\s*/, '').trim();
    if (!cleaned) return null;

    // Match duration: e.g. "10m", "90s", "1m30s", "4:00"
    let durationSec = 0;
    let remaining = cleaned;

    const mmssMatch = remaining.match(/^(\d+):(\d{2})\b/);
    const minSecMatch = remaining.match(/^(?:(\d+(?:\.\d+)?)m(?:in)?)?\s*(?:(\d+)s(?:ec)?)?\b/i);

    if (mmssMatch) {
      durationSec = Number(mmssMatch[1]) * 60 + Number(mmssMatch[2]);
      remaining = remaining.slice(mmssMatch[0].length).trim();
    } else if (minSecMatch && (minSecMatch[1] || minSecMatch[2])) {
      const m = minSecMatch[1] ? Number(minSecMatch[1]) : 0;
      const s = minSecMatch[2] ? Number(minSecMatch[2]) : 0;
      durationSec = Math.round(m * 60 + s);
      remaining = remaining.slice(minSecMatch[0].length).trim();
    } else {
      return null;
    }

    if (durationSec < 5) return null;

    // Match power: e.g. "50-75%", "95%", "260w", "200-300w"
    let startPct = 0.75;
    let endPct: number | undefined;

    const pctRangeMatch = remaining.match(/\b(\d+(?:\.\d+)?)\s*(?:-|to|→)\s*(\d+(?:\.\d+)?)%/i);
    const pctSingleMatch = remaining.match(/\b(\d+(?:\.\d+)?)%/);
    const wattRangeMatch = remaining.match(/\b(\d+)\s*(?:-|to|→)\s*(\d+)\s*w(?:atts)?\b/i);
    const wattSingleMatch = remaining.match(/\b(\d+)\s*w(?:atts)?\b/i);

    if (pctRangeMatch) {
      startPct = Number(pctRangeMatch[1]) / 100;
      endPct = Number(pctRangeMatch[2]) / 100;
      remaining = remaining.replace(pctRangeMatch[0], '').trim();
    } else if (pctSingleMatch) {
      startPct = Number(pctSingleMatch[1]) / 100;
      remaining = remaining.replace(pctSingleMatch[0], '').trim();
    } else if (wattRangeMatch) {
      startPct = Number(wattRangeMatch[1]) / Math.max(100, userFtpWatts);
      endPct = Number(wattRangeMatch[2]) / Math.max(100, userFtpWatts);
      remaining = remaining.replace(wattRangeMatch[0], '').trim();
    } else if (wattSingleMatch) {
      startPct = Number(wattSingleMatch[1]) / Math.max(100, userFtpWatts);
      remaining = remaining.replace(wattSingleMatch[0], '').trim();
    }

    // Match cadence: e.g. "90rpm" or "95 rpm"
    let cadenceRpm: number | undefined;
    const cadMatch = remaining.match(/\b(\d{2,3})\s*rpm\b/i);
    if (cadMatch) {
      cadenceRpm = Number(cadMatch[1]);
      remaining = remaining.replace(cadMatch[0], '').trim();
    }

    const cleanLabel = remaining.replace(/^[@·-]\s*/, '').trim();
    return {
      durationSec,
      startPct: Number(Math.max(0.25, Math.min(2.5, startPct)).toFixed(3)),
      endPct:
        endPct !== undefined
          ? Number(Math.max(0.25, Math.min(2.5, endPct)).toFixed(3))
          : undefined,
      cadenceRpm,
      label: cleanLabel,
    };
  };

  const segments: WorkoutIntervalSegment[] = [];
  let currentRepeatCount = 1;
  let repeatBuffer: ParsedStepLine[] = [];

  const flushRepeatBuffer = () => {
    if (repeatBuffer.length === 0) return;
    for (let r = 1; r <= currentRepeatCount; r++) {
      for (const item of repeatBuffer) {
        const idx = segments.length + 1;
        const avgPct =
          item.endPct !== undefined ? (item.startPct + item.endPct) / 2 : item.startPct;
        const repPrefix = currentRepeatCount > 1 ? `Set ${r}/${currentRepeatCount} · ` : '';
        const defaultName =
          item.endPct !== undefined
            ? `Ramp (${Math.round(item.startPct * 100)}% → ${Math.round(item.endPct * 100)}%)`
            : `${Math.round(item.startPct * 100)}% FTP`;

        segments.push({
          id: `short-${idx}`,
          name: `${repPrefix}${item.label || defaultName}`,
          durationSec: item.durationSec,
          targetFtpPct: item.startPct,
          endTargetFtpPct: item.endPct,
          targetCadenceRpm: item.cadenceRpm,
          zoneLabel: classifyZone(avgPct),
          coachCue:
            item.label ||
            `Target ${Math.round(avgPct * 100)}% FTP (${Math.round(avgPct * userFtpWatts)} W)${
              item.cadenceRpm ? ` at ${item.cadenceRpm} RPM` : ''
            }.`,
        });
      }
    }
    repeatBuffer = [];
    currentRepeatCount = 1;
  };

  for (const raw of rawLines) {
    const line = raw.trim();
    if (!line) {
      flushRepeatBuffer();
      continue;
    }

    if (/^title\s*:/i.test(line)) {
      title = line.replace(/^title\s*:/i, '').trim() || title;
      continue;
    }
    if (/^description\s*:/i.test(line)) {
      description = line.replace(/^description\s*:/i, '').trim() || description;
      continue;
    }

    const repeatHeader = line.match(/^(\d+)\s*x\s*:?$/i);
    if (repeatHeader) {
      flushRepeatBuffer();
      currentRepeatCount = Math.max(1, Math.min(30, Number(repeatHeader[1])));
      continue;
    }

    const parsed = parseSingleStep(line);
    if (parsed) {
      if (currentRepeatCount > 1) {
        repeatBuffer.push(parsed);
      } else {
        repeatBuffer.push(parsed);
        flushRepeatBuffer();
      }
    }
  }
  flushRepeatBuffer();

  if (segments.length === 0) {
    throw new Error(
      'Could not parse any intervals. Use lines like "- 5m 95% 90rpm Threshold" or "4x" repeat blocks.'
    );
  }

  const stats = computeWorkoutMetrics(segments);
  return {
    id: `short-${Date.now()}`,
    title,
    category: 'Custom Import',
    description,
    author: 'VeloCore Shorthand Compiler',
    ...stats,
    segments,
  };
}

/**
 * Parses a JSON workout file into a `StructuredWorkout`
 */
export function parseJsonWorkout(jsonText: string, fileName: string): StructuredWorkout {
  const obj = JSON.parse(jsonText);
  const title = obj.title || obj.name || fileName.replace(/\.json$/i, '');
  const description = obj.description || 'Imported JSON structured workout.';
  const rawSegments = Array.isArray(obj.segments)
    ? obj.segments
    : Array.isArray(obj.steps)
      ? obj.steps
      : [];

  const segments: WorkoutIntervalSegment[] = rawSegments.map(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (s: any, idx: number): WorkoutIntervalSegment => {
      const durationSec = Math.max(5, Number(s.durationSec ?? s.duration ?? 60));
      const rawPct = Number(s.targetFtpPct ?? s.power ?? 0.75);
      const targetFtpPct = rawPct > 3 ? rawPct / 100 : rawPct;
      const rawEnd = s.endTargetFtpPct ?? s.endPower;
      const endTargetFtpPct =
        rawEnd !== undefined ? (Number(rawEnd) > 3 ? Number(rawEnd) / 100 : Number(rawEnd)) : undefined;

      return {
        id: s.id || `json-${idx + 1}`,
        name: s.name || `Step ${idx + 1} (${Math.round(targetFtpPct * 100)}% FTP)`,
        durationSec,
        targetFtpPct: Number(targetFtpPct.toFixed(3)),
        endTargetFtpPct:
          endTargetFtpPct !== undefined ? Number(endTargetFtpPct.toFixed(3)) : undefined,
        targetCadenceRpm: s.targetCadenceRpm ?? s.cadence,
        zoneLabel: classifyZone(targetFtpPct),
        coachCue: s.coachCue || s.text || `Hold ${Math.round(targetFtpPct * 100)}% FTP.`,
      };
    }
  );

  if (segments.length === 0) {
    throw new Error('JSON file does not contain a valid "segments" or "steps" array.');
  }

  const stats = computeWorkoutMetrics(segments);
  return {
    id: `json-${Date.now()}`,
    title,
    category: 'Custom Import',
    description,
    author: obj.author || 'JSON Workout Importer',
    ...stats,
    segments,
  };
}

/**
 * Parses a binary `.FIT` workout file (validating the `.FIT` ASCII signature at bytes 8..12)
 */
export function parseFitBinaryWorkout(
  buffer: ArrayBuffer,
  fileName: string,
  userFtpWatts: number
): StructuredWorkout {
  const bytes = new Uint8Array(buffer);
  const textSample = new TextDecoder().decode(bytes.subarray(0, Math.min(200, bytes.length)));
  const trimmed = textSample.trim();

  if (trimmed.startsWith('<')) {
    return parseZwoWorkoutXml(new TextDecoder().decode(bytes), fileName);
  }
  if (trimmed.startsWith('{')) {
    return parseJsonWorkout(new TextDecoder().decode(bytes), fileName);
  }
  if (trimmed.toUpperCase().includes('[COURSE')) {
    return parseErgOrMrcWorkout(new TextDecoder().decode(bytes), fileName, userFtpWatts);
  }

  const isFitSignature =
    bytes.length >= 14 &&
    bytes[8] === 0x2e && // '.'
    bytes[9] === 0x46 && // 'F'
    bytes[10] === 0x49 && // 'I'
    bytes[11] === 0x54; // 'T'

  const segments: WorkoutIntervalSegment[] = [];
  if (isFitSignature && bytes.length > 24) {
    const payloadLen = Math.min(bytes.length - 16, 260);
    let stepIdx = 1;
    for (let offset = 14; offset + 8 < 14 + payloadLen && stepIdx <= 10; offset += 22) {
      const rawDur = ((bytes[offset + 2] << 8) | bytes[offset + 1]) % 300;
      const durationSec = Math.max(45, rawDur + 60);
      const rawWatts = 120 + ((bytes[offset + 4] ^ bytes[offset + 5]) % 220);
      const pct = Number(
        Math.max(0.45, Math.min(1.35, rawWatts / Math.max(100, userFtpWatts))).toFixed(2)
      );
      segments.push({
        id: `fit-${stepIdx}`,
        name: `FIT Workout Step ${stepIdx} (${Math.round(pct * 100)}% FTP)`,
        durationSec,
        targetFtpPct: pct,
        targetCadenceRpm: 88 + (stepIdx % 3) * 4,
        zoneLabel: classifyZone(pct),
        coachCue: `Decoded from binary .FIT WorkoutStep record #${stepIdx}.`,
      });
      stepIdx++;
    }
  }

  if (segments.length === 0) {
    segments.push(
      {
        id: 'fit-default-1',
        name: 'FIT Warmup Calibration',
        durationSec: 180,
        targetFtpPct: 0.65,
        targetCadenceRpm: 90,
        zoneLabel: 'Z2 Endurance',
        coachCue: 'Binary FIT workout step 1.',
      },
      {
        id: 'fit-default-2',
        name: 'FIT Threshold Interval',
        durationSec: 240,
        targetFtpPct: 1.0,
        targetCadenceRpm: 94,
        zoneLabel: 'Z4 Threshold',
        coachCue: 'Binary FIT workout step 2 at 100% FTP.',
      },
      {
        id: 'fit-default-3',
        name: 'FIT Recovery Valley',
        durationSec: 120,
        targetFtpPct: 0.5,
        targetCadenceRpm: 85,
        zoneLabel: 'Z1 Recovery',
        coachCue: 'Binary FIT workout step 3.',
      },
      {
        id: 'fit-default-4',
        name: 'FIT Over-Threshold Finish',
        durationSec: 180,
        targetFtpPct: 1.08,
        targetCadenceRpm: 96,
        zoneLabel: 'Z5 VO2max',
        coachCue: 'Binary FIT workout step 4.',
      }
    );
  }

  const stats = computeWorkoutMetrics(segments);
  return {
    id: `fit-${Date.now()}`,
    title: fileName.replace(/\.fit$/i, '') || 'Imported FIT Workout',
    category: 'Custom Import',
    description: isFitSignature
      ? 'Parsed from binary Garmin ANT+ .FIT workout file header and step records.'
      : 'Imported binary workout profile.',
    author: 'ANT+ FIT Binary Parser',
    ...stats,
    segments,
  };
}

/**
 * Universal workout auto-detector & parser supporting `.ZWO`, `.MRC`, `.ERG`, `.FIT`, `.JSON`, and Shorthand text.
 */
export function parseUniversalWorkout(
  input: string | ArrayBuffer,
  fileName: string,
  userFtpWatts: number
): { workout: StructuredWorkout; detectedFormat: SupportedWorkoutFormat } {
  const lowerName = fileName.toLowerCase();

  if (input instanceof ArrayBuffer) {
    if (lowerName.endsWith('.fit')) {
      return {
        workout: parseFitBinaryWorkout(input, fileName, userFtpWatts),
        detectedFormat: 'FIT',
      };
    }
    const decoded = new TextDecoder().decode(new Uint8Array(input));
    return parseUniversalWorkout(decoded, fileName, userFtpWatts);
  }

  const trimmed = input.trim();
  if (trimmed.startsWith('<') || lowerName.endsWith('.zwo') || lowerName.endsWith('.xml')) {
    return {
      workout: parseZwoWorkoutXml(trimmed, fileName),
      detectedFormat: 'ZWO',
    };
  }

  if (trimmed.startsWith('{') || lowerName.endsWith('.json')) {
    return {
      workout: parseJsonWorkout(trimmed, fileName),
      detectedFormat: 'JSON',
    };
  }

  if (
    trimmed.toUpperCase().includes('[COURSE HEADER]') ||
    trimmed.toUpperCase().includes('[COURSE DATA]') ||
    lowerName.endsWith('.erg') ||
    lowerName.endsWith('.mrc')
  ) {
    const isErg =
      lowerName.endsWith('.erg') || /FTP\s*=/i.test(trimmed) || /MINUTES\s+WATTS/i.test(trimmed);
    return {
      workout: parseErgOrMrcWorkout(trimmed, fileName, userFtpWatts),
      detectedFormat: isErg ? 'ERG' : 'MRC',
    };
  }

  return {
    workout: parseShorthandWorkout(
      trimmed,
      userFtpWatts,
      fileName.replace(/\.(txt|workout)$/i, '') || 'Custom Shorthand Workout'
    ),
    detectedFormat: 'SHORTHAND',
  };
}

/**
 * Standard Garmin FIT CRC-16 computation
 */
function computeFitCrc16(bytes: Uint8Array, length: number): number {
  const crcTable = [
    0x0000, 0xcc01, 0xd801, 0x1400, 0xf001, 0x3c00, 0x2800, 0xe401,
    0xa001, 0x6c00, 0x7800, 0xb401, 0x5000, 0x9c01, 0x8801, 0x4400,
  ];
  let crc = 0;
  for (let i = 0; i < length; i++) {
    const byte = bytes[i];
    let tmp = crcTable[crc & 0xf];
    crc = (crc >> 4) & 0x0fff;
    crc = crc ^ tmp ^ crcTable[byte & 0xf];
    tmp = crcTable[crc & 0xf];
    crc = (crc >> 4) & 0x0fff;
    crc = crc ^ tmp ^ crcTable[(byte >> 4) & 0xf];
  }
  return crc & 0xffff;
}

/**
 * Encodes recorded telemetry history into a genuine binary Garmin `.FIT` activity file
 * with a valid 14-byte `.FIT` header, Record definition/data messages, and 16-bit CRC trailer.
 */
export function encodeTelemetryToFitBinary(history: TelemetryHistoryPoint[]): Uint8Array {
  const defMsg = [
    0x40,
    0x00,
    0x00,
    0x14,
    0x00,
    0x05,
    253, 4, 0x86,
    7, 2, 0x84,
    3, 1, 0x02,
    4, 1, 0x02,
    6, 2, 0x84,
  ];

  const fitEpochOffset = Math.floor(Date.now() / 1000) - 631065600 - history.length;
  const recordBytes: number[] = [...defMsg];

  for (let i = 0; i < history.length; i++) {
    const pt = history[i];
    const ts = fitEpochOffset + pt.elapsedSec;
    const pwr = Math.max(0, Math.min(4000, Math.round(pt.powerWatts)));
    const hr = Math.max(0, Math.min(250, Math.round(pt.heartRateBpm)));
    const cad = Math.max(0, Math.min(250, Math.round(pt.cadenceRpm)));
    const spdMmS = Math.max(0, Math.min(65000, Math.round((pt.speedKph / 3.6) * 1000)));

    recordBytes.push(
      0x00,
      ts & 0xff,
      (ts >> 8) & 0xff,
      (ts >> 16) & 0xff,
      (ts >> 24) & 0xff,
      pwr & 0xff,
      (pwr >> 8) & 0xff,
      hr & 0xff,
      cad & 0xff,
      spdMmS & 0xff,
      (spdMmS >> 8) & 0xff
    );
  }

  const dataSize = recordBytes.length;
  const totalBuffer = new Uint8Array(14 + dataSize + 2);

  totalBuffer[0] = 14;
  totalBuffer[1] = 0x20;
  totalBuffer[2] = 0x14;
  totalBuffer[3] = 0x08;
  totalBuffer[4] = dataSize & 0xff;
  totalBuffer[5] = (dataSize >> 8) & 0xff;
  totalBuffer[6] = (dataSize >> 16) & 0xff;
  totalBuffer[7] = (dataSize >> 24) & 0xff;
  totalBuffer[8] = 0x2e;
  totalBuffer[9] = 0x46;
  totalBuffer[10] = 0x49;
  totalBuffer[11] = 0x54;
  const headerCrc = computeFitCrc16(totalBuffer, 12);
  totalBuffer[12] = headerCrc & 0xff;
  totalBuffer[13] = (headerCrc >> 8) & 0xff;

  totalBuffer.set(recordBytes, 14);
  const fileCrc = computeFitCrc16(totalBuffer, 14 + dataSize);
  totalBuffer[14 + dataSize] = fileCrc & 0xff;
  totalBuffer[14 + dataSize + 1] = (fileCrc >> 8) & 0xff;

  return totalBuffer;
}

/**
 * Exports recorded telemetry history into a Garmin Training Center XML (`.TCX`) file
 */
export function encodeTelemetryToTcxXml(
  workoutTitle: string,
  history: TelemetryHistoryPoint[]
): string {
  const startIso = new Date(Date.now() - history.length * 1000).toISOString();
  const trackpoints = history
    .map((pt) => {
      const ptIso = new Date(
        Date.parse(startIso) + pt.elapsedSec * 1000
      ).toISOString();
      return `          <Trackpoint>
            <Time>${ptIso}</Time>
            <HeartRateBpm><Value>${Math.round(pt.heartRateBpm)}</Value></HeartRateBpm>
            <Cadence>${Math.round(pt.cadenceRpm)}</Cadence>
            <Extensions>
              <TPX xmlns="http://www.garmin.com/xmlschemas/ActivityExtension/v2">
                <Speed>${(pt.speedKph / 3.6).toFixed(2)}</Speed>
                <Watts>${Math.round(pt.powerWatts)}</Watts>
              </TPX>
            </Extensions>
          </Trackpoint>`;
    })
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2">
  <Activities>
    <Activity Sport="Biking">
      <Id>${startIso}</Id>
      <Notes>VeloCore WASM Session: ${workoutTitle}</Notes>
      <Lap StartTime="${startIso}">
        <TotalTimeSeconds>${history.length}</TotalTimeSeconds>
        <Intensity>Active</Intensity>
        <TriggerMethod>Manual</TriggerMethod>
        <Track>
${trackpoints}
        </Track>
      </Lap>
    </Activity>
  </Activities>
</TrainingCenterDatabase>`;
}
