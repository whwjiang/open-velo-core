/**
 * VeloCore Native WebAssembly Binary Loader & Zero-Copy Memory Bridge
 *
 * Compiles and instantiates a genuine WebAssembly module (`WebAssembly.Instance`)
 * with shared linear memory (`memory`), executing low-level binary checksum verification,
 * unsigned 16-bit & 8-bit counter rollover arithmetic, and Skiba W'bal differential
 * steps directly in the browser's WebAssembly VM.
 */

export interface VeloCoreWasmExports {
  memory: WebAssembly.Memory;
  u16_rollover_delta: (current: number, previous: number) => number;
  u8_rollover_delta: (current: number, previous: number) => number;
  ant_xor_checksum: (ptr: number, len: number) => number;
  compute_wbal_step: (
    currentWbalJ: number,
    wPrimeMaxJ: number,
    powerWatts: number,
    cpWatts: number
  ) => number;
}

/**
 * Valid WebAssembly MVP binary implementing:
 * - Exported linear memory `memory` (1 page = 64 KiB)
 * - `u16_rollover_delta(curr: i32, prev: i32) -> i32`: `(curr - prev) & 0xFFFF`
 * - `u8_rollover_delta(curr: i32, prev: i32) -> i32`: `(curr - prev) & 0xFF`
 * - `ant_xor_checksum(ptr: i32, len: i32) -> i32`: loops over `memory[ptr..ptr+len]` and returns XOR byte
 * - `compute_wbal_step(wbal: i32, wmax: i32, pwr: i32, cp: i32) -> i32`: differential W'bal update
 */
function buildWasmBinaryBytes(): Uint8Array {
  // Helper to encode unsigned LEB128
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

  // Helper to encode signed LEB128
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

  // Type section (id = 1):
  // type 0: (i32, i32) -> i32
  // type 1: (i32, i32, i32, i32) -> i32
  const typeSection = section(1, [
    2, // 2 types
    0x60, 2, I32, I32, 1, I32,
    0x60, 4, I32, I32, I32, I32, 1, I32,
  ]);

  // Function section (id = 3):
  // func 0: u16_rollover_delta (type 0)
  // func 1: u8_rollover_delta (type 0)
  // func 2: ant_xor_checksum (type 0)
  // func 3: compute_wbal_step (type 1)
  const funcSection = section(3, [4, 0, 0, 0, 1]);

  // Memory section (id = 5): 1 memory with min 1 page (64KB)
  const memorySection = section(5, [1, 0x00, 1]);

  // Export section (id = 7):
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

  // Code bodies:
  // func 0: (local.get 0, local.get 1, i32.sub, i32.const 65535, i32.and)
  const func0Body = [
    0, // 0 locals
    0x20, 0, // local.get 0
    0x20, 1, // local.get 1
    0x6b, // i32.sub
    0x41, ...sleb(0xffff), // i32.const 65535
    0x71, // i32.and
    0x0b, // end
  ];

  // func 1: (local.get 0, local.get 1, i32.sub, i32.const 255, i32.and)
  const func1Body = [
    0, // 0 locals
    0x20, 0,
    0x20, 1,
    0x6b,
    0x41, ...sleb(0xff),
    0x71,
    0x0b,
  ];

  // func 2: ant_xor_checksum(ptr: i32, len: i32) -> i32
  // locals: local 2 = acc (i32), local 3 = idx (i32)
  const func2Body = [
    1, 2, I32, // 1 local group of 2 x i32 (locals 2 and 3)
    0x02, 0x40, // block
      0x03, 0x40, // loop
        0x20, 3, // local.get 3 (idx)
        0x20, 1, // local.get 1 (len)
        0x49, // i32.ge_u
        0x0d, 1, // br_if 1 (break out of block)
        0x20, 2, // local.get 2 (acc)
        0x20, 0, // local.get 0 (ptr)
        0x20, 3, // local.get 3 (idx)
        0x6a, // i32.add
        0x2d, 0, 0, // i32.load8_u align=0 offset=0
        0x73, // i32.xor
        0x21, 2, // local.set 2 (acc)
        0x20, 3, // local.get 3 (idx)
        0x41, 1, // i32.const 1
        0x6a, // i32.add
        0x21, 3, // local.set 3 (idx)
        0x0c, 0, // br 0 (continue loop)
      0x0b, // end loop
    0x0b, // end block
    0x20, 2, // local.get 2 (acc)
    0x0b, // end func
  ];

  // func 3: compute_wbal_step(wbal: 0, wmax: 1, pwr: 2, cp: 3) -> i32
  // If pwr > cp: max(0, wbal - (pwr - cp))
  // Else: min(wmax, wbal + max(1, (wmax - wbal) / 280))
  const func3Body = [
    1, 1, I32, // local 4 = temp (i32)
    0x20, 2, // local.get 2 (pwr)
    0x20, 3, // local.get 3 (cp)
    0x4a, // i32.gt_s
    0x04, I32, // if (result i32)
      0x20, 0, // wbal
      0x20, 2, // pwr
      0x20, 3, // cp
      0x6b, // pwr - cp
      0x6b, // wbal - (pwr - cp)
      0x22, 4, // local.tee 4
      0x41, 0, // 0
      0x48, // i32.lt_s (temp < 0)
      0x04, I32,
        0x41, 0,
      0x05,
        0x20, 4,
      0x0b,
    0x05, // else (recovery)
      0x20, 0, // wbal
      0x20, 1, // wmax
      0x20, 0, // wbal
      0x6b, // wmax - wbal
      0x41, ...sleb(260), // recovery tau ~260s
      0x6d, // i32.div_s
      0x41, 1,
      0x6a, // + 1 J minimum step
      0x6a, // wbal + recovery
      0x22, 4, // local.tee 4
      0x20, 1, // wmax
      0x4a, // temp > wmax
      0x04, I32,
        0x20, 1,
      0x05,
        0x20, 4,
      0x0b,
    0x0b, // end if
    0x0b, // end func
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
    0x00, 0x61, 0x73, 0x6d, // \0asm magic
    0x01, 0x00, 0x00, 0x00, // version 1
    ...typeSection,
    ...funcSection,
    ...memorySection,
    ...exportSection,
    ...codeSection,
  ]);
}

export class VeloCoreWasmRuntime {
  private exports: VeloCoreWasmExports | null = null;
  private memView: Uint8Array | null = null;
  private readonly INBOUND_PTR = 64;
  private readonly OUTBOUND_PTR = 256;

  async init(): Promise<void> {
    if (this.exports) return;
    const bytes = buildWasmBinaryBytes();
    const res = await WebAssembly.instantiate(bytes.buffer as ArrayBuffer, {});
    const instance = 'instance' in res ? res.instance : res;
    this.exports = instance.exports as unknown as VeloCoreWasmExports;
    this.memView = new Uint8Array(this.exports.memory.buffer);
  }

  get isReady(): boolean {
    return this.exports !== null;
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
    if (this.exports && this.memView) {
      const checkLen = Math.min(frame.length - 1, 128);
      this.memView.set(frame.subarray(0, checkLen), this.INBOUND_PTR);
      const computedCrc = this.exports.ant_xor_checksum(this.INBOUND_PTR, checkLen);
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
   * Encodes an outbound ANT+ FE-C Page 49 (0x31) Target Power (ERG) USB frame via WASM linear memory
   */
  encodeAntFecErg(channel: number, targetWatts: number): Uint8Array {
    const clampedWatts = Math.max(0, Math.min(4000, Math.round(targetWatts)));
    const quarterWattUnits = clampedWatts * 4; // 0.25W resolution
    const lo = quarterWattUnits & 0xff;
    const hi = (quarterWattUnits >> 8) & 0xff;
    const payload = new Uint8Array([
      0xa4, // Sync
      0x09, // Length (channel + 8 data bytes)
      0x4f, // Acknowledged Data (0x4F)
      channel & 0xff,
      0x31, // Page 49: Target Power
      0xff,
      0xff,
      0xff,
      0xff,
      0xff,
      lo,
      hi,
      0x00, // CRC placeholder
    ]);
    if (this.exports && this.memView) {
      this.memView.set(payload.subarray(0, 12), this.OUTBOUND_PTR);
      payload[12] = this.exports.ant_xor_checksum(this.OUTBOUND_PTR, 12);
    } else {
      let crc = 0;
      for (let i = 0; i < 12; i++) crc ^= payload[i];
      payload[12] = crc;
    }
    return payload;
  }

  /**
   * Encodes an outbound ANT+ FE-C Page 48 (0x30) Basic Resistance USB frame via WASM linear memory
   */
  encodeAntFecResistance(channel: number, resistancePercent: number): Uint8Array {
    const clamped = Math.max(0, Math.min(100, resistancePercent));
    const halfPctUnits = Math.round(clamped * 2); // 0.5% resolution (0..200)
    const payload = new Uint8Array([
      0xa4,
      0x09,
      0x4f,
      channel & 0xff,
      0x30, // Page 48: Basic Resistance
      0xff,
      0xff,
      0xff,
      0xff,
      0xff,
      0xff,
      halfPctUnits & 0xff,
      0x00,
    ]);
    if (this.exports && this.memView) {
      this.memView.set(payload.subarray(0, 12), this.OUTBOUND_PTR);
      payload[12] = this.exports.ant_xor_checksum(this.OUTBOUND_PTR, 12);
    } else {
      let crc = 0;
      for (let i = 0; i < 12; i++) crc ^= payload[i];
      payload[12] = crc;
    }
    return payload;
  }

  /**
   * Encodes an outbound ANT+ FE-C Page 51 (0x33) Track Resistance (Slope/Grade) USB frame
   */
  encodeAntFecSlope(channel: number, gradePercent: number, crr = 0.004): Uint8Array {
    const clampedGrade = Math.max(-20, Math.min(20, gradePercent));
    // ANT+ FE-C grade is encoded in 0.01% units offset by +200.00%
    const rawGrade = Math.round((clampedGrade + 200.0) * 100);
    const lo = rawGrade & 0xff;
    const hi = (rawGrade >> 8) & 0xff;
    const rawCrr = Math.max(0, Math.min(254, Math.round(crr / 0.00005)));
    const payload = new Uint8Array([
      0xa4,
      0x09,
      0x4f,
      channel & 0xff,
      0x33, // Page 51: Track Resistance
      0xff,
      0xff,
      0xff,
      0xff,
      lo,
      hi,
      rawCrr & 0xff,
      0x00,
    ]);
    if (this.exports && this.memView) {
      this.memView.set(payload.subarray(0, 12), this.OUTBOUND_PTR);
      payload[12] = this.exports.ant_xor_checksum(this.OUTBOUND_PTR, 12);
    } else {
      let crc = 0;
      for (let i = 0; i < 12; i++) crc ^= payload[i];
      payload[12] = crc;
    }
    return payload;
  }

  /**
   * Encodes BLE FTMS Fitness Machine Control Point (0x2AD9) outbound packets
   */
  encodeBleFtmsTargetPower(targetWatts: number): Uint8Array {
    // Opcode 0x05: Set Target Power (sint16 little-endian, 1W resolution)
    const w = Math.max(0, Math.min(4000, Math.round(targetWatts)));
    return new Uint8Array([0x05, w & 0xff, (w >> 8) & 0xff]);
  }

  encodeBleFtmsResistance(resistancePercent: number): Uint8Array {
    // Opcode 0x04: Set Target Resistance Level (uint8 in 0.1 units, 0..1000 -> 0..200)
    const level = Math.max(0, Math.min(200, Math.round(resistancePercent * 2)));
    return new Uint8Array([0x04, level & 0xff]);
  }

  encodeBleFtmsSimulation(gradePercent: number, crr = 0.004, cw = 0.51): Uint8Array {
    // Opcode 0x11: Set Indoor Bike Simulation Parameters
    // Wind speed (sint16, 0.001 m/s), Grade (sint16, 0.01%), Crr (uint8, 0.0001), Cw (uint8, 0.01 kg/m)
    const gradeInt = Math.round(Math.max(-20, Math.min(20, gradePercent)) * 100);
    const gradeU16 = gradeInt < 0 ? 0x10000 + gradeInt : gradeInt;
    const crrByte = Math.max(0, Math.min(255, Math.round(crr / 0.0001)));
    const cwByte = Math.max(0, Math.min(255, Math.round(cw / 0.01)));
    return new Uint8Array([
      0x11,
      0x00,
      0x00, // wind speed = 0
      gradeU16 & 0xff,
      (gradeU16 >> 8) & 0xff,
      crrByte,
      cwByte,
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
}
