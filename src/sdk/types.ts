export type TransportProtocol = 'ANT+_USB' | 'BLE_GATT' | 'SYNTHETIC_WIRE';

export type TrainerControlMode = 'ERG' | 'RESISTANCE' | 'SLOPE';

export type SensorChannelType =
  | 'SMART_TRAINER_FEC_FTMS'
  | 'CYCLING_POWER'
  | 'HEART_RATE'
  | 'SPEED_CADENCE';

export interface ConnectedSensorDevice {
  id: string;
  name: string;
  protocol: TransportProtocol;
  channelOrUuid: string;
  type: SensorChannelType;
  status: 'CONNECTED' | 'RECONNECTING' | 'STALE' | 'SIMULATED';
  packetCount: number;
  errorCount: number;
  lastSeenMs: number;
  rssiOrEndpoint: string;
  batteryPct?: number;
}

export interface DecodedByteField {
  offset: number;
  length: number;
  label: string;
  rawHex: string;
  decodedValue: string;
  category: 'SYNC' | 'HEADER' | 'PAGE_OPCODE' | 'TELEMETRY' | 'CHECKSUM';
}

export interface ProtocolFrameAudit {
  id: number;
  timestampMs: number;
  direction: 'INBOUND' | 'OUTBOUND';
  protocol: 'ANT+' | 'BLE';
  source: TransportProtocol;
  channelOrCharacteristic: string;
  messageName: string;
  rawBytes: number[];
  hexString: string;
  checksumValid: boolean;
  wasmDecodeTimeUs: number;
  summary: string;
  fields: DecodedByteField[];
}

export interface IntervalCompletionReport {
  intervalIndex: number;
  segmentId: string;
  segmentName: string;
  compliancePct: number;
  deliveryTier: 0 | 1 | 2 | 3; // 0 = Missed, 1 = Bronze/Lawn, 2 = Silver/Porch, 3 = Gold/Mailbox
  coinsEarned: number;
  totalCoins: number;
  averagePowerWatts: number;
  targetPowerWatts: number;
}

export interface TelemetrySnapshot {
  timestampMs: number;
  elapsedSec: number;
  intervalElapsedSec: number;
  intervalRemainingSec: number;
  intervalProgress01: number; // 0.0 to 1.0 progress within current interval for 60 FPS game sprites
  activeIntervalIndex: number;

  // Instant & Smoothed Power
  instantPowerWatts: number;
  power3sWatts: number;
  power10sWatts: number;
  power30sWatts: number;
  intervalPowerWatts: number;
  normalizedPowerWatts: number;
  averagePowerWatts: number;
  maxPowerWatts: number;
  wattsPerKg: number;

  // Target, Trainer State & Game Compliance (Plug-and-Play Frontend Support)
  targetPowerWatts: number;
  trainerMode: TrainerControlMode;
  targetSlopePct: number;
  targetResistancePct: number;
  intensityBiasPct: number;
  intervalCompliancePct: number;
  intervalCadenceCompliancePct: number;
  totalCoinsEarned: number;

  // Biometrics & Kinematics
  heartRateBpm: number;
  averageHeartRateBpm: number;
  maxHeartRateBpm: number;
  cadenceRpm: number;
  averageCadenceRpm: number;
  speedKph: number;
  distanceMeters: number;
  leftRightBalancePct: number; // e.g., 51 means 51% L / 49% R

  // Physiological Load & W'bal
  ftpWatts: number;
  riderWeightKg: number;
  wPrimeMaxJoules: number;
  wPrimeBalanceJoules: number;
  wPrimeBalancePct: number;
  intensityFactor: number;
  trainingStressScore: number;
  kilojoules: number;

  // WASM Engine Telemetry
  totalFramesProcessed: number;
  checksumErrors: number;
  avgWasmDecodeUs: number;
  frameRateHz: number;
}

export interface TelemetryHistoryPoint {
  timestampMs?: number;
  elapsedSec: number;
  powerWatts: number;
  power3sWatts: number;
  targetWatts: number;
  heartRateBpm: number;
  cadenceRpm: number;
  speedKph: number;
  wPrimeBalancePct: number;
}

export interface WorkoutIntervalSegment {
  id: string;
  name: string;
  durationSec: number;
  targetFtpPct: number; // e.g. 0.95 for 95% FTP
  endTargetFtpPct?: number; // present for ramps
  targetCadenceRpm?: number;
  zoneLabel: 'Z1 Recovery' | 'Z2 Endurance' | 'Z3 Tempo' | 'Z4 Threshold' | 'Z5 VO2max' | 'Z6 Anaerobic';
  coachCue: string;
}

export interface StructuredWorkout {
  id: string;
  title: string;
  category: 'Threshold' | 'VO2max' | 'Sweet Spot' | 'Anaerobic' | 'Endurance' | 'Custom Import';
  description: string;
  author: string;
  totalDurationSec: number;
  intensityFactor: number;
  tss: number;
  segments: WorkoutIntervalSegment[];
}

export interface SyntheticGeneratorConfig {
  enabled: boolean;
  frequencyHz: 4 | 8 | 16;
  protocolMix: 'BOTH' | 'ANT_ONLY' | 'BLE_ONLY';
  baseRiderEffortOffsetWatts: number;
  simulateCadenceNaturalWave: boolean;
  injectPacketCorruptionPct: number; // 0 to 15%
}
