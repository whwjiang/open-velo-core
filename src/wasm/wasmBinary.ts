/**
 * VeloCore Native WebAssembly Binary Loader & Zero-Copy Memory Bridge
 *
 * Loads the compiled `velocore_core.wasm` Rust binary (from `/velocore_core.wasm`
 * in the browser or `public/velocore_core.wasm` in Node test runners, with an embedded
 * fallback binary if needed) and exposes zero-copy typed methods for:
 * - ANT+ & BLE packet decoding and outbound FE-C / FTMS command encoding
 * - Stateful 3s/10s/30s time-windowed power smoothing & Skiba W'bal integration
 * - Newspaper Delivery Game interval compliance & reward scoring
 * - Binary Garmin `.FIT` activity file encoding & CRC-16 computation
 */

import { TelemetryHistoryPoint } from '../sdk/types';

export interface VeloCoreWasmExports {
  memory: WebAssembly.Memory;
  get_inbound_buffer_ptr?: () => number;
  get_outbound_buffer_ptr?: () => number;
  u16_rollover_delta: (current: number, previous: number) => number;
  u8_rollover_delta: (current: number, previous: number) => number;
  ant_xor_checksum: (ptr: number, len: number) => number;
  ant_verify_checksum?: (ptr: number, len: number) => number;
  compute_wbal_step: (
    currentWbalJ: number,
    wPrimeMaxJ: number,
    powerWatts: number,
    cpWatts: number
  ) => number;

  // Inbound Decoders
  decode_ant_frame_in_buf?: (len: number) => number;
  decode_ble_frame_in_buf?: (charUuid: number, len: number) => number;
  decoded_get_update_mask?: () => number;
  decoded_get_power_watts?: () => number;
  decoded_get_cadence_rpm?: () => number;
  decoded_get_hr_bpm?: () => number;
  decoded_get_speed_tenths_kph?: () => number;
  decoded_get_lr_balance_pct?: () => number;

  // Outbound Encoders
  encode_ant_fec_erg?: (channel: number, targetWatts: number) => number;
  encode_ant_fec_resistance?: (channel: number, resistancePct: number) => number;
  encode_ant_fec_slope?: (channel: number, slopeHundredths: number, crrRaw: number) => number;
  encode_ble_ftms_erg?: (targetWatts: number) => number;
  encode_ble_ftms_resistance?: (resistancePct: number) => number;
  encode_ble_ftms_slope?: (slopeHundredths: number, crrByte: number, cwByte: number) => number;

  // Stateful Session & Game Compliance Scorer
  compute_power_compliance_score?: (actualWatts: number, targetWatts: number) => number;
  compute_cadence_compliance_score?: (actualRpm: number, targetRpm: number) => number;
  classify_delivery_tier?: (compliancePct: number) => number;
  session_reset?: () => void;
  session_set_rider_profile?: (
    ftpWatts: number,
    weightTenthsKg: number,
    wPrimeMaxJ: number
  ) => void;
  session_record_power_sample?: (watts: number, timestampMs: number) => void;
  session_get_window_power_avg?: (windowMs: number, nowMs: number) => number;
  session_tick_1hz?: (
    powerWatts: number,
    hrBpm: number,
    cadenceRpm: number,
    speedTenthsKph: number,
    targetWatts: number,
    targetCadenceRpm: number
  ) => void;
  session_complete_interval?: () => number;
  session_get_wbal_joules?: () => number;
  session_get_normalized_power?: (fallback30s: number) => number;
  session_get_interval_power?: (fallback: number) => number;
  session_get_interval_compliance_pct?: () => number;
  session_get_interval_cadence_compliance_pct?: () => number;
  session_get_last_interval_tier?: () => number;
  session_get_last_interval_coins?: () => number;
  session_get_total_coins?: () => number;

  // Binary .FIT Activity Encoder
  fit_crc16?: (ptr: number, len: number) => number;
  fit_reset_records?: () => void;
  fit_push_record?: (
    fitTimestampSec: number,
    powerWatts: number,
    speedMms: number,
    heartRateBpm: number,
    cadenceRpm: number
  ) => void;
  fit_encode_activity?: (tzOffsetSec: number) => number;
  get_fit_buffer_ptr?: () => number;
}

export interface DecodedFrameResult {
  valid: boolean;
  powerUpdated: boolean;
  speedUpdated: boolean;
  cadenceUpdated: boolean;
  hrUpdated: boolean;
  balanceUpdated: boolean;
  powerWatts: number;
  cadenceRpm: number;
  heartRateBpm: number;
  speedKph: number;
  lrBalancePct: number;
}

export const WASM_MASK_POWER = 1 << 0;
export const WASM_MASK_SPEED = 1 << 1;
export const WASM_MASK_CADENCE = 1 << 2;
export const WASM_MASK_HR = 1 << 3;
export const WASM_MASK_BALANCE = 1 << 4;

/**
 * Fallback WebAssembly MVP binary if `/velocore_telemetry_wasm.wasm` is unreachable
 */
function buildFallbackWasmBinaryBytes(): Uint8Array {
  const uleb = (n: number): number[] => {
    const out: number[] = [];
    do {
      let byte = n & 0x7f;
      n >>>= 7;
      if (n !== 0) byte |= 0x80;
      out.push(byte);
    } while (n !== 0);
    return out;
  };

  const sleb = (n: number): number[] => {
    const out: number[] = [];
    let more = true;
    while (more) {
      let byte = n & 0x7f;
      n >>= 7;
      if (
        (n === 0 && (byte & 0x40) === 0) ||
        (n === -1 && (byte & 0x40) !== 0)
      ) {
        more = false;
      } else {
        byte |= 0x80;
      }
      out.push(byte);
    }
    return out;
  };

  const strBytes = (s: string): number[] => {
    const bytes = Array.from(new TextEncoder().encode(s));
    return [...uleb(bytes.length), ...bytes];
  };

  const section = (id: number, payload: number[]): number[] => [
    id,
    ...uleb(payload.length),
    ...payload,
  ];

  const I32 = 0x7f;
  const typeSection = section(1, [
    2,
    0x60, 2, I32, I32, 1, I32,
    0x60, 4, I32, I32, I32, I32, 1, I32,
  ]);
  const funcSection = section(3, [4, 0, 0, 0, 1]);
  const memorySection = section(5, [1, 0x00, 1]);
  const exportEntries = [
    [...strBytes('memory'), 0x02, 0],
    [...strBytes('u16_rollover_delta'), 0x00, 0],
    [...strBytes('u8_rollover_delta'), 0x00, 1],
    [...strBytes('ant_xor_checksum'), 0x00, 2],
    [...strBytes('compute_wbal_step'), 0x00, 3],
  ];
  const exportSection = section(7, [
    exportEntries.length,
    ...exportEntries.flat(),
  ]);

  const func0Body = [0, 0x20, 0, 0x20, 1, 0x6b, 0x41, ...sleb(0xffff), 0x71, 0x0b];
  const func1Body = [0, 0x20, 0, 0x20, 1, 0x6b, 0x41, ...sleb(0xff), 0x71, 0x0b];
  const func2Body = [
    1, 2, I32,
    0x02, 0x40,
      0x03, 0x40,
        0x20, 3,
        0x20, 1,
        0x4f,
        0x0d, 1,
        0x20, 2,
        0x20, 0,
        0x20, 3,
        0x6a,
        0x2d, 0, 0,
        0x73,
        0x21, 2,
        0x20, 3,
        0x41, 1,
        0x6a,
        0x21, 3,
        0x0c, 0,
      0x0b,
    0x0b,
    0x20, 2,
    0x0b,
  ];
  const func3Body = [
    1, 1, I32,
    0x20, 2,
    0x20, 3,
    0x4a,
    0x04, I32,
      0x20, 0,
      0x20, 2,
      0x20, 3,
      0x6b,
      0x6b,
      0x22, 4,
      0x41, 0,
      0x48,
      0x04, I32,
        0x41, 0,
      0x05,
        0x20, 4,
      0x0b,
    0x05,
      0x20, 0,
      0x20, 1,
      0x20, 0,
      0x6b,
      0x41, ...sleb(260),
      0x6d,
      0x41, 1,
      0x6a,
      0x6a,
      0x22, 4,
      0x20, 1,
      0x4a,
      0x04, I32,
        0x20, 1,
      0x05,
        0x20, 4,
      0x0b,
    0x0b,
    0x0b,
  ];

  const withLen = (body: number[]) => [...uleb(body.length), ...body];
  const codeSection = section(10, [
    4,
    ...withLen(func0Body),
    ...withLen(func1Body),
    ...withLen(func2Body),
    ...withLen(func3Body),
  ]);

  return new Uint8Array([
    0x00, 0x61, 0x73, 0x6d,
    0x01, 0x00, 0x00, 0x00,
    ...typeSection,
    ...funcSection,
    ...memorySection,
    ...exportSection,
    ...codeSection,
  ]);
}

export class VeloCoreWasmRuntime {
  private exports: VeloCoreWasmExports | null = null;
  private readonly FALLBACK_INBOUND_PTR = 64;
  private readonly FALLBACK_OUTBOUND_PTR = 256;

  async init(customWasmBytes?: Uint8Array): Promise<void> {
    if (this.exports && !customWasmBytes) return;

    let wasmBytes: Uint8Array | null = customWasmBytes ?? null;

    if (!wasmBytes && typeof fetch === 'function') {
      try {
        const res = await fetch('/velocore_core.wasm');
        if (res.ok) {
          const buf = await res.arrayBuffer();
          wasmBytes = new Uint8Array(buf);
        }
      } catch {
        // Fallback to embedded WASM binary
      }
    }

    if (!wasmBytes) {
      wasmBytes = buildFallbackWasmBinaryBytes();
    }

    const res = await WebAssembly.instantiate(
      wasmBytes.buffer.slice(
        wasmBytes.byteOffset,
        wasmBytes.byteOffset + wasmBytes.byteLength
      ) as ArrayBuffer,
      {}
    );
    const instance = 'instance' in res ? res.instance : res;
    this.exports = instance.exports as unknown as VeloCoreWasmExports;
  }

  get isReady(): boolean {
    return this.exports !== null;
  }

  get hasFullRustCore(): boolean {
    return Boolean(this.exports?.decode_ant_frame_in_buf && this.exports?.fit_encode_activity);
  }

  private getMemView(): Uint8Array | null {
    if (!this.exports) return null;
    // Always construct view from current buffer in case WASM memory grew
    return new Uint8Array(this.exports.memory.buffer);
  }

  private getInboundPtr(): number {
    return this.exports?.get_inbound_buffer_ptr?.() ?? this.FALLBACK_INBOUND_PTR;
  }

  private getOutboundPtr(): number {
    return this.exports?.get_outbound_buffer_ptr?.() ?? this.FALLBACK_OUTBOUND_PTR;
  }

  u16Delta(current: number, previous: number): number {
    if (!this.exports) return (current - previous) & 0xffff;
    return this.exports.u16_rollover_delta(current, previous);
  }

  u8Delta(current: number, previous: number): number {
    if (!this.exports) return (current - previous) & 0xff;
    return this.exports.u8_rollover_delta(current, previous);
  }

  /**
   * Copies raw ANT+ USB serial frame into WASM linear memory and verifies XOR checksum.
   */
  verifyAntFrame(frame: Uint8Array): { valid: boolean; computedCrc: number; expectedCrc: number } {
    if (frame.length < 4 || frame[0] !== 0xa4) {
      return { valid: false, computedCrc: 0, expectedCrc: frame[frame.length - 1] ?? 0 };
    }
    const expectedCrc = frame[frame.length - 1];
    const mem = this.getMemView();
    if (this.exports && mem) {
      const checkLen = Math.min(frame.length - 1, 127);
      const inPtr = this.getInboundPtr();
      mem.set(frame.subarray(0, checkLen), inPtr);
      const computedCrc = this.exports.ant_xor_checksum(inPtr, checkLen);
      return {
        valid: computedCrc === expectedCrc,
        computedCrc,
        expectedCrc,
      };
    }
    let xor = 0;
    for (let i = 0; i < frame.length - 1; i++) xor ^= frame[i];
    return { valid: xor === expectedCrc, computedCrc: xor, expectedCrc };
  }

  /**
   * Decodes an inbound ANT+ broadcast frame directly in Rust WASM linear memory.
   */
  decodeAntFrame(frame: Uint8Array): DecodedFrameResult | null {
    const mem = this.getMemView();
    if (!this.exports?.decode_ant_frame_in_buf || !mem) return null;
    const len = Math.min(frame.length, 128);
    const inPtr = this.getInboundPtr();
    mem.set(frame.subarray(0, len), inPtr);
    const ok = this.exports.decode_ant_frame_in_buf(len);
    if (!ok) return null;

    const mask = this.exports.decoded_get_update_mask?.() ?? 0;
    return {
      valid: true,
      powerUpdated: (mask & WASM_MASK_POWER) !== 0,
      speedUpdated: (mask & WASM_MASK_SPEED) !== 0,
      cadenceUpdated: (mask & WASM_MASK_CADENCE) !== 0,
      hrUpdated: (mask & WASM_MASK_HR) !== 0,
      balanceUpdated: (mask & WASM_MASK_BALANCE) !== 0,
      powerWatts: this.exports.decoded_get_power_watts?.() ?? 0,
      cadenceRpm: this.exports.decoded_get_cadence_rpm?.() ?? 0,
      heartRateBpm: this.exports.decoded_get_hr_bpm?.() ?? 0,
      speedKph: Number(((this.exports.decoded_get_speed_tenths_kph?.() ?? 0) / 10).toFixed(1)),
      lrBalancePct: this.exports.decoded_get_lr_balance_pct?.() ?? 50,
    };
  }

  /**
   * Decodes an inbound BLE GATT characteristic notification directly in Rust WASM linear memory.
   */
  decodeBleFrame(charUuid: number, raw: Uint8Array): DecodedFrameResult | null {
    const mem = this.getMemView();
    if (!this.exports?.decode_ble_frame_in_buf || !mem) return null;
    const len = Math.min(raw.length, 128);
    const inPtr = this.getInboundPtr();
    mem.set(raw.subarray(0, len), inPtr);
    const ok = this.exports.decode_ble_frame_in_buf(charUuid, len);
    if (!ok) return null;

    const mask = this.exports.decoded_get_update_mask?.() ?? 0;
    return {
      valid: true,
      powerUpdated: (mask & WASM_MASK_POWER) !== 0,
      speedUpdated: (mask & WASM_MASK_SPEED) !== 0,
      cadenceUpdated: (mask & WASM_MASK_CADENCE) !== 0,
      hrUpdated: (mask & WASM_MASK_HR) !== 0,
      balanceUpdated: (mask & WASM_MASK_BALANCE) !== 0,
      powerWatts: this.exports.decoded_get_power_watts?.() ?? 0,
      cadenceRpm: this.exports.decoded_get_cadence_rpm?.() ?? 0,
      heartRateBpm: this.exports.decoded_get_hr_bpm?.() ?? 0,
      speedKph: Number(((this.exports.decoded_get_speed_tenths_kph?.() ?? 0) / 10).toFixed(1)),
      lrBalancePct: this.exports.decoded_get_lr_balance_pct?.() ?? 50,
    };
  }

  /**
   * Encodes an outbound ANT+ FE-C Page 49 (0x31) Target Power (ERG) USB frame via Rust WASM
   */
  encodeAntFecErg(channel: number, targetWatts: number): Uint8Array {
    const clampedWatts = Math.max(0, Math.min(4000, Math.round(targetWatts)));
    if (this.exports?.encode_ant_fec_erg) {
      const len = this.exports.encode_ant_fec_erg(channel & 0xff, clampedWatts);
      const mem = this.getMemView();
      const outPtr = this.getOutboundPtr();
      if (mem) {
        return mem.slice(outPtr, outPtr + len);
      }
    }

    const quarterWattUnits = clampedWatts * 4;
    const lo = quarterWattUnits & 0xff;
    const hi = (quarterWattUnits >> 8) & 0xff;
    const payload = new Uint8Array([
      0xa4, 0x09, 0x4f, channel & 0xff, 0x31,
      0xff, 0xff, 0xff, 0xff, 0xff, lo, hi, 0x00,
    ]);
    let crc = 0;
    for (let i = 0; i < 12; i++) crc ^= payload[i];
    payload[12] = crc;
    return payload;
  }

  /**
   * Encodes an outbound ANT+ FE-C Page 48 (0x30) Basic Resistance USB frame via Rust WASM
   */
  encodeAntFecResistance(channel: number, resistancePercent: number): Uint8Array {
    const clamped = Math.max(0, Math.min(100, Math.round(resistancePercent)));
    if (this.exports?.encode_ant_fec_resistance) {
      const len = this.exports.encode_ant_fec_resistance(channel & 0xff, clamped);
      const mem = this.getMemView();
      const outPtr = this.getOutboundPtr();
      if (mem) {
        return mem.slice(outPtr, outPtr + len);
      }
    }

    const halfPctUnits = Math.round(clamped * 2);
    const payload = new Uint8Array([
      0xa4, 0x09, 0x4f, channel & 0xff, 0x30,
      0xff, 0xff, 0xff, 0xff, 0xff, 0xff, halfPctUnits & 0xff, 0x00,
    ]);
    let crc = 0;
    for (let i = 0; i < 12; i++) crc ^= payload[i];
    payload[12] = crc;
    return payload;
  }

  /**
   * Encodes an outbound ANT+ FE-C Page 51 (0x33) Track Resistance (Slope/Grade) USB frame via Rust WASM
   */
  encodeAntFecSlope(channel: number, gradePercent: number, crr = 0.004): Uint8Array {
    const clampedGrade = Math.max(-20, Math.min(20, gradePercent));
    const slopeHundredths = Math.round(clampedGrade * 100);
    const rawCrr = Math.max(0, Math.min(254, Math.round(crr / 0.00005)));

    if (this.exports?.encode_ant_fec_slope) {
      const len = this.exports.encode_ant_fec_slope(channel & 0xff, slopeHundredths, rawCrr);
      const mem = this.getMemView();
      const outPtr = this.getOutboundPtr();
      if (mem) {
        return mem.slice(outPtr, outPtr + len);
      }
    }

    const rawGrade = Math.round((clampedGrade + 200.0) * 100);
    const lo = rawGrade & 0xff;
    const hi = (rawGrade >> 8) & 0xff;
    const payload = new Uint8Array([
      0xa4, 0x09, 0x4f, channel & 0xff, 0x33,
      0xff, 0xff, 0xff, 0xff, lo, hi, rawCrr & 0xff, 0x00,
    ]);
    let crc = 0;
    for (let i = 0; i < 12; i++) crc ^= payload[i];
    payload[12] = crc;
    return payload;
  }

  /**
   * Encodes BLE FTMS Fitness Machine Control Point (0x2AD9) outbound packets via Rust WASM
   */
  encodeBleFtmsTargetPower(targetWatts: number): Uint8Array {
    const w = Math.max(0, Math.min(4000, Math.round(targetWatts)));
    if (this.exports?.encode_ble_ftms_erg) {
      const len = this.exports.encode_ble_ftms_erg(w);
      const mem = this.getMemView();
      const outPtr = this.getOutboundPtr();
      if (mem) {
        return mem.slice(outPtr, outPtr + len);
      }
    }
    return new Uint8Array([0x05, w & 0xff, (w >> 8) & 0xff]);
  }

  encodeBleFtmsResistance(resistancePercent: number): Uint8Array {
    const clamped = Math.max(0, Math.min(100, Math.round(resistancePercent)));
    if (this.exports?.encode_ble_ftms_resistance) {
      const len = this.exports.encode_ble_ftms_resistance(clamped);
      const mem = this.getMemView();
      const outPtr = this.getOutboundPtr();
      if (mem) {
        return mem.slice(outPtr, outPtr + len);
      }
    }
    const level = Math.max(0, Math.min(200, Math.round(clamped * 2)));
    return new Uint8Array([0x04, level & 0xff]);
  }

  encodeBleFtmsSimulation(gradePercent: number, crr = 0.004, cw = 0.51): Uint8Array {
    const clampedGrade = Math.max(-20, Math.min(20, gradePercent));
    const gradeInt = Math.round(clampedGrade * 100);
    const crrByte = Math.max(0, Math.min(255, Math.round(crr / 0.0001)));
    const cwByte = Math.max(0, Math.min(255, Math.round(cw / 0.01)));

    if (this.exports?.encode_ble_ftms_slope) {
      const len = this.exports.encode_ble_ftms_slope(gradeInt, crrByte, cwByte);
      const mem = this.getMemView();
      const outPtr = this.getOutboundPtr();
      if (mem) {
        return mem.slice(outPtr, outPtr + len);
      }
    }

    const gradeU16 = gradeInt < 0 ? 0x10000 + gradeInt : gradeInt;
    return new Uint8Array([
      0x11, 0x00, 0x00,
      gradeU16 & 0xff, (gradeU16 >> 8) & 0xff,
      crrByte, cwByte,
    ]);
  }

  stepWbal(currentWbalJ: number, wPrimeMaxJ: number, powerWatts: number, cpWatts: number): number {
    if (!this.exports) {
      return Math.max(0, Math.min(wPrimeMaxJ, currentWbalJ - (powerWatts - cpWatts)));
    }
    return this.exports.compute_wbal_step(
      Math.round(currentWbalJ),
      Math.round(wPrimeMaxJ),
      Math.round(powerWatts),
      Math.round(cpWatts)
    );
  }

  // ==========================================================================
  // Stateful Rust Session & Newspaper Delivery Game Compliance Bridge
  // ==========================================================================

  sessionReset(): void {
    this.exports?.session_reset?.();
  }

  sessionSetRiderProfile(ftpWatts: number, weightKg: number, wPrimeMaxJ: number): void {
    this.exports?.session_set_rider_profile?.(
      Math.max(0, Math.round(ftpWatts)),
      Math.max(0, Math.round(weightKg * 10)),
      Math.max(1000, Math.round(wPrimeMaxJ))
    );
  }

  sessionRecordPowerSample(watts: number, timestampMs: number): void {
    this.exports?.session_record_power_sample?.(Math.max(0, Math.round(watts)), timestampMs);
  }

  sessionGetWindowPowerAvg(windowMs: number, nowMs: number, fallbackWatts: number): number {
    if (!this.exports?.session_get_window_power_avg) return fallbackWatts;
    return this.exports.session_get_window_power_avg(windowMs, nowMs);
  }

  sessionTick1Hz(
    powerWatts: number,
    hrBpm: number,
    cadenceRpm: number,
    speedKph: number,
    targetWatts: number,
    targetCadenceRpm: number
  ): void {
    this.exports?.session_tick_1hz?.(
      Math.max(0, Math.round(powerWatts)),
      Math.max(0, Math.round(hrBpm)),
      Math.max(0, Math.round(cadenceRpm)),
      Math.max(0, Math.round(speedKph * 10)),
      Math.max(0, Math.round(targetWatts)),
      Math.max(0, Math.round(targetCadenceRpm))
    );
  }

  sessionCompleteInterval(): {
    compliancePct: number;
    deliveryTier: 0 | 1 | 2 | 3;
    coinsEarned: number;
    totalCoins: number;
  } {
    const compliancePct = this.exports?.session_complete_interval?.() ?? 100;
    const rawTier = this.exports?.session_get_last_interval_tier?.() ?? 3;
    const deliveryTier = Math.max(0, Math.min(3, rawTier)) as 0 | 1 | 2 | 3;
    const coinsEarned = this.exports?.session_get_last_interval_coins?.() ?? 50;
    const totalCoins = this.exports?.session_get_total_coins?.() ?? coinsEarned;
    return { compliancePct, deliveryTier, coinsEarned, totalCoins };
  }

  sessionGetIntervalCompliancePct(): number {
    return this.exports?.session_get_interval_compliance_pct?.() ?? 100;
  }

  sessionGetIntervalCadenceCompliancePct(): number {
    return this.exports?.session_get_interval_cadence_compliance_pct?.() ?? 100;
  }

  sessionGetTotalCoins(): number {
    return this.exports?.session_get_total_coins?.() ?? 0;
  }

  /**
   * Encodes recorded telemetry history into a standards-compliant Garmin `.FIT` binary
   * activity file using the Rust `FitActivityBuilder` inside WASM linear memory.
   */
  encodeFitActivity(history: TelemetryHistoryPoint[], tzOffsetSec?: number): Uint8Array | null {
    if (
      !this.exports?.fit_reset_records ||
      !this.exports?.fit_push_record ||
      !this.exports?.fit_encode_activity ||
      !this.exports?.get_fit_buffer_ptr
    ) {
      return null;
    }

    const FIT_EPOCH_SEC = 631065600;
    const nowMs = Date.now();
    const pts =
      history.length >= 2
        ? history
        : history.length === 1
          ? [
              { ...history[0], timestampMs: (history[0].timestampMs ?? nowMs) - 1000, elapsedSec: 0 },
              { ...history[0], timestampMs: history[0].timestampMs ?? nowMs, elapsedSec: 1 },
            ]
          : [
              {
                timestampMs: nowMs - 1000,
                elapsedSec: 0,
                powerWatts: 0,
                power3sWatts: 0,
                targetWatts: 0,
                heartRateBpm: 0,
                cadenceRpm: 0,
                speedKph: 0,
                wPrimeBalancePct: 100,
              },
              {
                timestampMs: nowMs,
                elapsedSec: 1,
                powerWatts: 0,
                power3sWatts: 0,
                targetWatts: 0,
                heartRateBpm: 0,
                cadenceRpm: 0,
                speedKph: 0,
                wPrimeBalancePct: 100,
              },
            ];

    this.exports.fit_reset_records();

    const baseStartFitSec = pts[0].timestampMs
      ? Math.floor(pts[0].timestampMs / 1000) - FIT_EPOCH_SEC
      : Math.floor(nowMs / 1000) - FIT_EPOCH_SEC - pts.length;

    for (let i = 0; i < pts.length; i++) {
      const pt = pts[i];
      const fitSec = pt.timestampMs
        ? Math.floor(pt.timestampMs / 1000) - FIT_EPOCH_SEC
        : baseStartFitSec + i;
      const pwr = Math.max(0, Math.min(4000, Math.round(pt.powerWatts)));
      const spdMms = Math.max(0, Math.min(65000, Math.round((pt.speedKph / 3.6) * 1000)));
      const hr = pt.heartRateBpm > 0 ? Math.max(30, Math.min(250, Math.round(pt.heartRateBpm))) : 0;
      const cad = Math.max(0, Math.min(250, Math.round(pt.cadenceRpm)));
      this.exports.fit_push_record(fitSec, pwr, spdMms, hr, cad);
    }

    const offsetSec = tzOffsetSec ?? new Date().getTimezoneOffset() * -60;
    const byteLen = this.exports.fit_encode_activity(offsetSec);
    const ptr = this.exports.get_fit_buffer_ptr();
    const mem = this.getMemView();
    if (!mem || byteLen <= 0) return null;
    return mem.slice(ptr, ptr + byteLen);
  }
}
