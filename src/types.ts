export type TransportProtocol = 'ANT+_USB' | 'BLE_GATT' | 'SYNTHETIC_WIRE';

export type TrainerControlMode = 'ERG' | 'RESISTANCE' | 'SLOPE';

export type SensorChannelType =
  | 'SMART_TRAINER_FEC_FTMS'
  | 'CYCLING_POWER'
  | 'HEART_RATE'
  | 'SPEED_CADENCE'
  | 'BIKE_CONTROLLER';

export type BikeControllerControlId =
  | 'SHIFT_UP'
  | 'SHIFT_DOWN'
  | 'DPAD_UP'
  | 'DPAD_DOWN'
  | 'DPAD_LEFT'
  | 'DPAD_RIGHT'
  | 'BUTTON_A'
  | 'BUTTON_B'
  | 'BUTTON_Y'
  | 'BUTTON_Z'
  | 'ON_OFF_HOME'
  | 'STEER_AXIS'
  | 'BRAKE_AXIS';

export type BikeControllerDeviceModel =
  | 'ZWIFT_CLICK'
  | 'ZWIFT_PLAY_LEFT'
  | 'ZWIFT_PLAY_RIGHT'
  | 'GENERIC_OBC';

export interface BikeControllerEvent {
  timestampMs: number;
  deviceId: string;
  deviceModel: BikeControllerDeviceModel;
  control: BikeControllerControlId;
  state: 'PRESSED' | 'RELEASED' | 'HELD' | 'AXIS_CHANGE';
  /** Normalized value: 1/0 for digital buttons, -1.0..+1.0 for steering, 0.0..1.0 for brake */
  value: number;
}

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

export interface IntervalCompletionSummary {
  intervalIndex: number;
  segmentId: string;
  segmentName: string;
  durationSec: number;
  powerCompliancePct: number;
  cadenceCompliancePct: number;
  overallCompliancePct: number;
  averagePowerWatts: number;
  targetPowerWatts: number;
}

export type IntervalCompletionReport = IntervalCompletionSummary;

/**
 * Pluggable Backend Lifecycle Hook.
 * External frontends or application layers can register hooks via
 * `veloCoreEngine.registerHook(hook)` to attach custom domain logic to
 * 1Hz ticks, interval transitions, ride pause/resume, and session resets.
 */
export interface VeloCoreBackendHook {
  id?: string;
  onTick?: (snapshot: TelemetrySnapshot) => void;
  onIntervalComplete?: (summary: IntervalCompletionSummary) => void;
  onRideStateChange?: (isRiding: boolean, snapshot: TelemetrySnapshot) => void;
  onSessionReset?: () => void;
  /**
   * Invoked when an OpenBikeControl / handlebar controller event is ingested.
   * Return `{ preventDefault: true }` to intercept the input and skip default trainer actions
   * (such as virtual gear shifting or ERG intensity bias nudging).
   */
  onControllerInput?: (
    event: BikeControllerEvent,
    snapshot: TelemetrySnapshot
  ) => { preventDefault?: boolean } | void;
}

export interface TelemetrySnapshot {
  timestampMs: number;
  elapsedSec: number;
  intervalElapsedSec: number;
  intervalRemainingSec: number;
  intervalProgress01: number; // 0.0 to 1.0 normalized progress within the active interval segment
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

  // Target, Trainer State, Virtual Shifting & Interval Compliance
  targetPowerWatts: number;
  trainerMode: TrainerControlMode;
  targetSlopePct: number;
  targetResistancePct: number;
  intensityBiasPct: number;
  virtualGear: number; // 1..24 (default 12)
  virtualGearRatio: number; // e.g. 1.000 at Gear 12
  steeringAngleNormalized: number; // -1.0 (left) .. +1.0 (right)
  brakeNormalized: number; // 0.0 (released) .. 1.0 (full brake)
  intervalCompliancePct: number;
  intervalCadenceCompliancePct: number;

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
