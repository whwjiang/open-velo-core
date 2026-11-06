import { VeloCoreWasmRuntime } from '../wasm/wasmBinary';
import {
  ConnectedSensorDevice,
  DecodedByteField,
  ProtocolFrameAudit,
  StructuredWorkout,
  SyntheticGeneratorConfig,
  TelemetryHistoryPoint,
  TelemetrySnapshot,
  TrainerControlMode,
  TransportProtocol,
} from './types';
import { BUILTIN_WORKOUTS } from './workouts';

type TelemetryListener = (snapshot: TelemetrySnapshot) => void;
type FrameAuditListener = (frames: ProtocolFrameAudit[]) => void;
type DeviceRosterListener = (devices: ConnectedSensorDevice[]) => void;

const toHex = (b: number) => b.toString(16).toUpperCase().padStart(2, '0');
const bytesToHex = (arr: Uint8Array | number[]) =>
  Array.from(arr)
    .map((b) => toHex(b))
    .join(' ');

/**
 * Headless, framework-agnostic Rust/WASM Cycling Telemetry & Smart Trainer Engine.
 * Can be mounted into React, Vue, Svelte, Canvas, or Three.js frontends.
 */
export class VeloCoreEngine {
  private wasm = new VeloCoreWasmRuntime();
  private telemetryListeners = new Set<TelemetryListener>();
  private frameListeners = new Set<FrameAuditListener>();
  private deviceListeners = new Set<DeviceRosterListener>();

  // Workout & Clock State
  private activeWorkout: StructuredWorkout = BUILTIN_WORKOUTS[0];
  private isRiding = true;
  private elapsedSec = 0;
  private tickTimer: number | null = null;
  private synthTimer: number | null = null;

  // Rider Profile & Trainer Control
  private ftpWatts = 280;
  private riderWeightKg = 72;
  private wPrimeMaxJoules = 22000;
  private wPrimeBalanceJoules = 22000;
  private trainerMode: TrainerControlMode = 'ERG';
  private manualErgWatts = 200;
  private targetSlopePct = 2.5;
  private targetResistancePct = 35;
  private intensityBiasPct = 100;

  // Rolling Power & Biometric Accumulators
  private powerRing3s: number[] = [];
  private powerRing10s: number[] = [];
  private powerRing30s: number[] = [];
  private fourthPowerSum = 0;
  private fourthPowerCount = 0;
  private powerSum = 0;
  private powerSamples = 0;
  private maxPowerWatts = 0;
  private hrSum = 0;
  private hrSamples = 0;
  private maxHrBpm = 0;
  private cadenceSum = 0;
  private cadenceSamples = 0;
  private distanceMeters = 0;
  private kilojoules = 0;

  // Sensor State & 16-bit Rollover Accumulators
  private prevAntPowerEventCount = -1;
  private prevAntAccumulatedPower = 0;
  private prevBleCrankRevs = -1;
  private prevBleCrankTime1024 = 0;
  private prevAntSpeedTime1024 = 0;
  private prevAntWheelRevs = -1;

  // Instantaneous Sensor Values
  private currentPowerWatts = 165;
  private currentHrBpm = 128;
  private currentCadenceRpm = 90;
  private currentSpeedKph = 31.4;
  private currentLRBalance = 50;

  // Synthetic Wire Counter State
  private synthConfig: SyntheticGeneratorConfig = {
    enabled: true,
    frequencyHz: 4,
    protocolMix: 'BOTH',
    baseRiderEffortOffsetWatts: 0,
    simulateCadenceNaturalWave: true,
    injectPacketCorruptionPct: 0,
  };
  private synthTick = 0;
  private synthEventCount = 0;
  private synthAccumPower = 0;
  private synthCrankRevs = 0;
  private synthCrankTime1024 = 0;
  private synthPhysiologicalHr = 124;
  private synthPhysiologicalPower = 160;

  // Audit & Performance Profiling
  private frameCounter = 0;
  private checksumErrors = 0;
  private decodeTimeTotalUs = 0;
  private recentFrameTimestamps: number[] = [];
  private frameAuditLog: ProtocolFrameAudit[] = [];
  private telemetryHistory: TelemetryHistoryPoint[] = [];
  private devices: Map<string, ConnectedSensorDevice> = new Map();

  // Hardware Handles (WebUSB & WebBluetooth)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private usbDevice: any = null;
  private usbOutEndpoint = 1;
  private usbInEndpoint = 1;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private bleFtmsControlChar: any = null;

  constructor() {
    this.registerDefaultSimulatedDevices();
  }

  async start(): Promise<void> {
    await this.wasm.init();
    this.startWorkoutClock();
    this.restartSyntheticWireLoop();
    // Dispatch initial ERG command frame so the protocol inspector immediately shows outbound wire encoding
    this.dispatchSmartTrainerCommand();
  }

  stop(): void {
    if (this.tickTimer !== null) {
      window.clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
    if (this.synthTimer !== null) {
      window.clearInterval(this.synthTimer);
      this.synthTimer = null;
    }
  }

  // ============================================================================
  // Subscriptions (Framework-Agnostic Pub/Sub)
  // ============================================================================

  subscribeTelemetry(cb: TelemetryListener): () => void {
    this.telemetryListeners.add(cb);
    cb(this.getSnapshot());
    return () => this.telemetryListeners.delete(cb);
  }

  subscribeFrames(cb: FrameAuditListener): () => void {
    this.frameListeners.add(cb);
    cb(this.frameAuditLog);
    return () => this.frameListeners.delete(cb);
  }

  subscribeDevices(cb: DeviceRosterListener): () => void {
    this.deviceListeners.add(cb);
    cb(Array.from(this.devices.values()));
    return () => this.deviceListeners.delete(cb);
  }

  private emitTelemetry(): void {
    const snap = this.getSnapshot();
    for (const cb of this.telemetryListeners) cb(snap);
  }

  private emitFrames(): void {
    for (const cb of this.frameListeners) cb(this.frameAuditLog);
  }

  private emitDevices(): void {
    const list = Array.from(this.devices.values());
    for (const cb of this.deviceListeners) cb(list);
  }

  // ============================================================================
  // Hardware Transports: WebUSB ANT+ & WebBluetooth GATT
  // ============================================================================

  private registerDefaultSimulatedDevices(): void {
    const now = Date.now();
    this.devices.set('sim-ant-fec', {
      id: 'sim-ant-fec',
      name: 'ANT+ FE-C Smart Trainer (Ch 0 · 0x11)',
      protocol: 'SYNTHETIC_WIRE',
      channelOrUuid: 'ANT+ Ch #0 (DevType 17)',
      type: 'SMART_TRAINER_FEC_FTMS',
      status: 'SIMULATED',
      packetCount: 0,
      errorCount: 0,
      lastSeenMs: now,
      rssiOrEndpoint: '2457 MHz · EP 0x81',
      batteryPct: 100,
    });
    this.devices.set('sim-ble-cps', {
      id: 'sim-ble-cps',
      name: 'BLE Dual-Sided Power Crank (0x1818)',
      protocol: 'SYNTHETIC_WIRE',
      channelOrUuid: 'UUID 0x2A63 (CPS)',
      type: 'CYCLING_POWER',
      status: 'SIMULATED',
      packetCount: 0,
      errorCount: 0,
      lastSeenMs: now,
      rssiOrEndpoint: '-54 dBm · GATT Notify',
      batteryPct: 92,
    });
    this.devices.set('sim-ant-hrm', {
      id: 'sim-ant-hrm',
      name: 'ANT+ Chest Strap HRM (Ch 2 · 0x78)',
      protocol: 'SYNTHETIC_WIRE',
      channelOrUuid: 'ANT+ Ch #2 (DevType 120)',
      type: 'HEART_RATE',
      status: 'SIMULATED',
      packetCount: 0,
      errorCount: 0,
      lastSeenMs: now,
      rssiOrEndpoint: '2457 MHz · EP 0x81',
      batteryPct: 86,
    });
  }

  /**
   * Connects to a physical ANT+ USB stick (Garmin / Dynastream / CYCPLUS / Wahoo) via WebUSB
   */
  async connectWebUsbAntDongle(): Promise<{ ok: boolean; message: string }> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const nav = navigator as any;
    if (!nav.usb) {
      return {
        ok: false,
        message:
          'WebUSB is not available in this browser context. Ensure Chromium desktop or use the Synthetic ANT+ Wire Generator.',
      };
    }

    try {
      const device = await nav.usb.requestDevice({
        filters: [
          { vendorId: 0x0fcf, productId: 0x1008 }, // Dynastream ANT USB-2
          { vendorId: 0x0fcf, productId: 0x1009 }, // Dynastream ANT USB-m
          { vendorId: 0x0fcf, productId: 0x1004 }, // Dynastream ANT2USB
          { vendorId: 0x0fcf }, // Any Dynastream/Garmin ANT+ stick
        ],
      });

      try {
        await device.open();
      } catch (openErr) {
        const openMsg = openErr instanceof Error ? openErr.message : String(openErr);
        if (openMsg.toLowerCase().includes('access denied')) {
          return {
            ok: false,
            message:
              "WebUSB 'Access denied': The operating system kernel driver is claiming the ANT+ USB stick. On Windows: use Zadig (zadig.akeo.ie) to replace the default driver with 'WinUSB' on the ANT+ USB stick. On Linux: add a udev rule (SUBSYSTEM==\"usb\", ATTR{idVendor}==\"0fcf\", MODE=\"0666\"). On Mac: unplug and replug after closing Garmin Express.",
          };
        }
        throw openErr;
      }

      if (device.configuration === null) {
        try {
          await device.selectConfiguration(1);
        } catch {
          // Some devices don't allow re-selecting existing configuration 1
        }
      }

      // Find suitable interface (usually interface 0)
      const interfaces = device.configuration?.interfaces || [];
      let claimedInterfaceNumber = 0;
      let claimedAlternate = null;
      let claimSuccess = false;

      for (const iface of interfaces) {
        try {
          await device.claimInterface(iface.interfaceNumber);
          claimedInterfaceNumber = iface.interfaceNumber;
          claimedAlternate = iface.alternates[0];
          claimSuccess = true;
          break;
        } catch {
          // Try next interface if available
        }
      }

      if (!claimSuccess) {
        // Try fallback to interface 0 explicitly
        try {
          await device.claimInterface(0);
          claimedInterfaceNumber = 0;
          claimedAlternate = device.configuration?.interfaces?.[0]?.alternates?.[0] || null;
          claimSuccess = true;
        } catch (claimErr) {
          const claimMsg = claimErr instanceof Error ? claimErr.message : String(claimErr);
          return {
            ok: false,
            message: `WebUSB 'Unable to claim interface': Another process (such as a system ANT driver, Garmin Express, or Zwift) currently owns Interface #${claimedInterfaceNumber}. Close background cycling apps or replug the stick. Error details: ${claimMsg}`,
          };
        }
      }

      if (claimedAlternate) {
        for (const ep of claimedAlternate.endpoints) {
          if (ep.direction === 'in') this.usbInEndpoint = ep.endpointNumber;
          if (ep.direction === 'out') this.usbOutEndpoint = ep.endpointNumber;
        }
      }
      this.usbDevice = device;

      // Register real WebUSB ANT+ device in roster
      this.devices.set('usb-ant-dongle', {
        id: 'usb-ant-dongle',
        name: device.productName || 'Garmin / Dynastream ANT+ USB Stick',
        protocol: 'ANT+_USB',
        channelOrUuid: `USB VID 0x${device.vendorId.toString(16)} · PID 0x${device.productId.toString(16)}`,
        type: 'SMART_TRAINER_FEC_FTMS',
        status: 'CONNECTED',
        packetCount: 0,
        errorCount: 0,
        lastSeenMs: Date.now(),
        rssiOrEndpoint: `Bulk IN EP #${this.usbInEndpoint} / OUT EP #${this.usbOutEndpoint}`,
      });
      this.emitDevices();

      // Send ANT+ ResetSystem (0x4A) and SetNetworkKey (0x46) for official ANT+ key
      await this.sendAntUsbRaw(new Uint8Array([0xa4, 0x01, 0x4a, 0x00, 0xef]));
      await this.sendAntUsbRaw(
        new Uint8Array([
          0xa4, 0x09, 0x46, 0x00, 0xb9, 0xa5, 0x21, 0xfb, 0xbd, 0x72, 0xc3, 0x45, 0x64,
        ])
      );

      // Start background bulk IN read loop
      this.pollAntUsbLoop();
      return {
        ok: true,
        message: `Connected to ${device.productName || 'ANT+ USB Dongle'} on Bulk EP #${this.usbInEndpoint}.`,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        message: `WebUSB connection canceled or blocked: ${msg}`,
      };
    }
  }

  private async sendAntUsbRaw(frame: Uint8Array): Promise<void> {
    if (!this.usbDevice) return;
    try {
      await this.usbDevice.transferOut(this.usbOutEndpoint, frame);
    } catch {
      // Ignore transient USB write errors
    }
  }

  private async pollAntUsbLoop(): Promise<void> {
    while (this.usbDevice && this.usbDevice.opened) {
      try {
        const result = await this.usbDevice.transferIn(this.usbInEndpoint, 64);
        if (result.data && result.data.byteLength > 0) {
          const bytes = new Uint8Array(result.data.buffer);
          this.ingestAntUsbStream(bytes, 'ANT+_USB');
        }
      } catch {
        break;
      }
    }
  }

  /**
   * Connects to a Bluetooth Low Energy sensor or FTMS Smart Trainer via WebBluetooth
   */
  async connectWebBluetoothSensor(
    targetRole: 'FTMS' | 'CPS' | 'HRM' | 'CSCS'
  ): Promise<{ ok: boolean; message: string }> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const nav = navigator as any;
    if (!nav.bluetooth) {
      const isSecure = window.isSecureContext;
      const isIframe = window.self !== window.top;
      let reason = 'WebBluetooth is not supported in this browser.';
      if (!isSecure) {
        reason = 'WebBluetooth requires a secure context (HTTPS or localhost).';
      } else if (isIframe) {
        reason =
          'WebBluetooth is blocked inside an embedded preview iframe. Open the app in a standalone tab/window via the top-level URL.';
      } else {
        reason =
          'WebBluetooth is not available. Please use Google Chrome, Edge, or Chromium with Bluetooth turned on in your OS.';
      }
      return {
        ok: false,
        message: `${reason} Falling back to Synthetic BLE GATT stream.`,
      };
    }

    const serviceMap = {
      FTMS: { serviceUuid: 0x1826, charUuid: 0x2ad2, label: 'FTMS Smart Trainer' },
      CPS: { serviceUuid: 0x1818, charUuid: 0x2a63, label: 'BLE Cycling Power Meter' },
      HRM: { serviceUuid: 0x180d, charUuid: 0x2a37, label: 'BLE Heart Rate Monitor' },
      CSCS: { serviceUuid: 0x1816, charUuid: 0x2a5b, label: 'BLE Speed & Cadence Sensor' },
    }[targetRole];

    try {
      const device = await nav.bluetooth.requestDevice({
        filters: [{ services: [serviceMap.serviceUuid] }],
        optionalServices: [0x1826, 0x1818, 0x180d, 0x1816, 0x180f],
      });

      const server = await device.gatt.connect();
      const service = await server.getPrimaryService(serviceMap.serviceUuid);
      const characteristic = await service.getCharacteristic(serviceMap.charUuid);

      const devId = `ble-${targetRole.toLowerCase()}-${device.id || Date.now()}`;
      this.devices.set(devId, {
        id: devId,
        name: device.name || serviceMap.label,
        protocol: 'BLE_GATT',
        channelOrUuid: `GATT 0x${serviceMap.charUuid.toString(16).toUpperCase()}`,
        type:
          targetRole === 'FTMS'
            ? 'SMART_TRAINER_FEC_FTMS'
            : targetRole === 'CPS'
              ? 'CYCLING_POWER'
              : targetRole === 'HRM'
                ? 'HEART_RATE'
                : 'SPEED_CADENCE',
        status: 'CONNECTED',
        packetCount: 0,
        errorCount: 0,
        lastSeenMs: Date.now(),
        rssiOrEndpoint: 'BLE GATT Notify',
      });
      this.emitDevices();

      // If FTMS trainer, also grab Fitness Machine Control Point (0x2AD9) and request control (0x00)
      if (targetRole === 'FTMS') {
        try {
          this.bleFtmsControlChar = await service.getCharacteristic(0x2ad9);
          await this.bleFtmsControlChar.writeValue(new Uint8Array([0x00]));
        } catch {
          // Optional control point
        }
      }

      await characteristic.startNotifications();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      characteristic.addEventListener('characteristicvaluechanged', (event: any) => {
        const dv: DataView = event.target.value;
        const raw = new Uint8Array(dv.buffer, dv.byteOffset, dv.byteLength);
        this.ingestBleGattNotification(serviceMap.charUuid, raw, 'BLE_GATT', devId);
      });

      return {
        ok: true,
        message: `Connected to ${device.name || serviceMap.label} over BLE GATT.`,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('Permissions-Policy') || msg.includes('SecurityError') || msg.includes('disallowed')) {
        return {
          ok: false,
          message: `WebBluetooth is blocked by the iframe Permissions Policy. Open the app directly in a full browser tab to pair BLE devices.`,
        };
      }
      return {
        ok: false,
        message: `WebBluetooth pairing canceled or unavailable: ${msg}`,
      };
    }
  }

  // ============================================================================
  // WASM Binary Protocol Ingestion: ANT+ USB & BLE GATT
  // ============================================================================

  /**
   * Injects a custom hex string (e.g. "A4 09 4E 00 19 12 5A 80 02 10 01 00 28") into the WASM decoder
   */
  injectRawHexFrame(hexInput: string, protocol: 'ANT+' | 'BLE'): { ok: boolean; summary: string } {
    const cleaned = hexInput
      .trim()
      .split(/[\s,]+/)
      .filter(Boolean);
    const bytes = new Uint8Array(
      cleaned.map((tok) => parseInt(tok.replace(/^0x/i, ''), 16) || 0)
    );
    if (bytes.length < 3) {
      return { ok: false, summary: 'Frame requires at least 3 hexadecimal bytes.' };
    }
    if (protocol === 'ANT+') {
      const audit = this.ingestSingleAntFrame(bytes, 'SYNTHETIC_WIRE', 'sim-ant-fec');
      return { ok: audit.checksumValid, summary: audit.summary };
    } else {
      const audit = this.ingestBleGattNotification(0x2a63, bytes, 'SYNTHETIC_WIRE', 'sim-ble-cps');
      return { ok: true, summary: audit.summary };
    }
  }

  private ingestAntUsbStream(buffer: Uint8Array, source: TransportProtocol): void {
    let offset = 0;
    while (offset < buffer.length) {
      if (buffer[offset] !== 0xa4) {
        offset++;
        continue;
      }
      if (offset + 2 >= buffer.length) break;
      const msgLen = buffer[offset + 1];
      const totalFrameLen = msgLen + 4; // Sync (1) + Len (1) + MsgID (1) + Payload (msgLen) + CRC (1)
      if (offset + totalFrameLen > buffer.length) break;

      const frame = buffer.subarray(offset, offset + totalFrameLen);
      this.ingestSingleAntFrame(frame, source, 'usb-ant-dongle');
      offset += totalFrameLen;
    }
  }

  private ingestSingleAntFrame(
    frame: Uint8Array,
    source: TransportProtocol,
    deviceId: string
  ): ProtocolFrameAudit {
    const t0 = performance.now();
    const { valid, computedCrc, expectedCrc } = this.wasm.verifyAntFrame(frame);

    const msgLen = frame[1] ?? 0;
    const msgId = frame[2] ?? 0;
    const channel = frame[3] ?? 0;
    const dataPage = frame[4] ?? 0;

    let messageName = `ANT+ Msg 0x${toHex(msgId)}`;
    let summary = '';
    const fields: DecodedByteField[] = [
      {
        offset: 0,
        length: 1,
        label: 'Sync Byte',
        rawHex: toHex(frame[0]),
        decodedValue: frame[0] === 0xa4 ? '0xA4 (ANT+ Serial Sync)' : 'Invalid Sync',
        category: 'SYNC',
      },
      {
        offset: 1,
        length: 2,
        label: 'Length & MsgID',
        rawHex: `${toHex(msgLen)} ${toHex(msgId)}`,
        decodedValue: `Len ${msgLen}B · ${msgId === 0x4e ? 'Broadcast (0x4E)' : msgId === 0x4f ? 'AckData (0x4F)' : `0x${toHex(msgId)}`}`,
        category: 'HEADER',
      },
    ];

    if (!valid) {
      this.checksumErrors++;
      summary = `XOR Checksum Mismatch (Expected 0x${toHex(computedCrc)}, Got 0x${toHex(expectedCrc)})`;
    } else if ((msgId === 0x4e || msgId === 0x4f) && frame.length >= 13) {
      // Payload starts at frame[4..12]
      if (channel === 0 && dataPage === 0x19) {
        // ANT+ FE-C Data Page 25 (0x19): Specific Stationary Bike / Trainer Data
        messageName = 'ANT+ FE-C Page 25 (Trainer Torque/Power)';
        const eventCount = frame[5];
        const instCadence = frame[6];
        const accumPower = frame[7] | (frame[8] << 8);
        const instPower = frame[9] | ((frame[10] & 0x0f) << 8);

        if (this.prevAntPowerEventCount >= 0) {
          const evtDelta = this.wasm.u8Delta(eventCount, this.prevAntPowerEventCount);
          const pwrDelta = this.wasm.u16Delta(accumPower, this.prevAntAccumulatedPower);
          if (evtDelta > 0) {
            this.currentPowerWatts = Math.max(0, Math.min(2500, instPower));
          } else if (pwrDelta >= 0) {
            this.currentPowerWatts = Math.max(0, Math.min(2500, instPower));
          }
        } else {
          this.currentPowerWatts = Math.max(0, Math.min(2500, instPower));
        }
        this.prevAntPowerEventCount = eventCount;
        this.prevAntAccumulatedPower = accumPower;

        if (instCadence !== 0xff && instCadence > 0) {
          this.currentCadenceRpm = instCadence;
        }

        summary = `FE-C Trainer · ${this.currentPowerWatts} W · ${this.currentCadenceRpm} RPM · Evt #${eventCount}`;
        fields.push(
          {
            offset: 3,
            length: 2,
            label: 'Ch & Data Page',
            rawHex: `${toHex(channel)} ${toHex(dataPage)}`,
            decodedValue: `Ch #${channel} · Page 0x19 (FE-C Bike)`,
            category: 'PAGE_OPCODE',
          },
          {
            offset: 5,
            length: 2,
            label: 'Evt & Cadence',
            rawHex: `${toHex(eventCount)} ${toHex(instCadence)}`,
            decodedValue: `Evt ${eventCount} · ${instCadence} RPM`,
            category: 'TELEMETRY',
          },
          {
            offset: 7,
            length: 4,
            label: 'Accum & Inst Power',
            rawHex: `${toHex(frame[7])} ${toHex(frame[8])} ${toHex(frame[9])} ${toHex(frame[10])}`,
            decodedValue: `Accum ${accumPower} W · Inst ${instPower} W`,
            category: 'TELEMETRY',
          }
        );
      } else if (channel === 0 && dataPage === 0x10) {
        // ANT+ FE-C Data Page 16 (0x10): General FE Speed & Distance
        messageName = 'ANT+ FE-C Page 16 (General FE Kinematics)';
        const elapsedQuarterSec = frame[5];
        const distMeters = frame[6];
        const rawSpeedMmS = frame[7] | (frame[8] << 8);
        const speedKph = Number(((rawSpeedMmS / 1000) * 3.6).toFixed(1));
        if (speedKph > 0 && speedKph < 110) {
          this.currentSpeedKph = speedKph;
        }
        summary = `FE-C Speed · ${this.currentSpeedKph.toFixed(1)} km/h · +${distMeters & 0x0f}m`;
        fields.push(
          {
            offset: 3,
            length: 2,
            label: 'Ch & Data Page',
            rawHex: `${toHex(channel)} ${toHex(dataPage)}`,
            decodedValue: `Ch #${channel} · Page 0x10 (General FE)`,
            category: 'PAGE_OPCODE',
          },
          {
            offset: 5,
            length: 4,
            label: 'Elapsed / Dist / Speed',
            rawHex: `${toHex(elapsedQuarterSec)} ${toHex(distMeters)} ${toHex(frame[7])} ${toHex(frame[8])}`,
            decodedValue: `${this.currentSpeedKph.toFixed(1)} km/h (${rawSpeedMmS} mm/s)`,
            category: 'TELEMETRY',
          }
        );
      } else if (channel === 2) {
        // ANT+ Heart Rate (Device Type 120)
        messageName = 'ANT+ HRM Page 4 (Beat Interval & BPM)';
        const beatTime1024 = frame[8] | (frame[9] << 8);
        const beatCount = frame[10];
        const computedBpm = frame[11];
        if (computedBpm > 35 && computedBpm < 240) {
          this.currentHrBpm = computedBpm;
        }
        summary = `ANT+ HRM · ${this.currentHrBpm} BPM · Beat #${beatCount} (${beatTime1024}/1024s)`;
        fields.push(
          {
            offset: 3,
            length: 2,
            label: 'Ch & HRM Page',
            rawHex: `${toHex(channel)} ${toHex(dataPage)}`,
            decodedValue: `Ch #${channel} · HRM Page ${dataPage & 0x7f}`,
            category: 'PAGE_OPCODE',
          },
          {
            offset: 8,
            length: 4,
            label: 'Beat Time / Count / BPM',
            rawHex: `${toHex(frame[8])} ${toHex(frame[9])} ${toHex(beatCount)} ${toHex(computedBpm)}`,
            decodedValue: `${computedBpm} BPM · Beat #${beatCount}`,
            category: 'TELEMETRY',
          }
        );
      } else {
        // Generic ANT+ Power Page 0x10
        const instPower = frame[10] | (frame[11] << 8);
        if (instPower > 0 && instPower < 2500) {
          this.currentPowerWatts = instPower;
        }
        summary = `ANT+ Ch #${channel} Page 0x${toHex(dataPage)} · ${instPower} W`;
      }
    }

    fields.push({
      offset: frame.length - 1,
      length: 1,
      label: 'XOR Checksum',
      rawHex: toHex(expectedCrc),
      decodedValue: valid ? `0x${toHex(expectedCrc)} (Verified in WASM)` : `Invalid (Expected 0x${toHex(computedCrc)})`,
      category: 'CHECKSUM',
    });

    const elapsedUs = Math.max(1, Math.round((performance.now() - t0) * 1000));
    return this.recordFrameAudit({
      direction: 'INBOUND',
      protocol: 'ANT+',
      source,
      channelOrCharacteristic: `ANT+ Ch #${channel}`,
      messageName,
      rawBytes: Array.from(frame),
      checksumValid: valid,
      wasmDecodeTimeUs: elapsedUs,
      summary,
      fields,
      deviceId,
    });
  }

  private ingestBleGattNotification(
    charUuid: number,
    raw: Uint8Array,
    source: TransportProtocol,
    deviceId: string
  ): ProtocolFrameAudit {
    const t0 = performance.now();
    let messageName = `BLE GATT 0x${charUuid.toString(16).toUpperCase()}`;
    let summary = '';
    const fields: DecodedByteField[] = [];

    if (charUuid === 0x2a63 && raw.length >= 8) {
      // BLE Cycling Power Measurement (0x2A63)
      // Bytes 0..1: Flags, Bytes 2..3: Instantaneous Power (sint16), Byte 4: Pedal Balance,
      // Bytes 5..6: Cumulative Crank Revolutions (uint16), Bytes 7..8: Last Crank Event Time (1/1024s uint16)
      messageName = 'BLE CPS 0x2A63 (Cycling Power + Crank Revs)';
      const flags = raw[0] | (raw[1] << 8);
      const instWatts = raw[2] | (raw[3] << 8);
      const pedalBalanceHalfPct = raw[4];
      const crankRevs = raw[5] | (raw[6] << 8);
      const crankTime1024 = raw.length >= 9 ? raw[7] | (raw[8] << 8) : 0;

      this.currentPowerWatts = Math.max(0, Math.min(2500, instWatts));
      if (pedalBalanceHalfPct > 0 && pedalBalanceHalfPct <= 200) {
        this.currentLRBalance = Math.round(pedalBalanceHalfPct / 2);
      }

      if (this.prevBleCrankRevs >= 0) {
        const revDelta = this.wasm.u16Delta(crankRevs, this.prevBleCrankRevs);
        const timeDelta1024 = this.wasm.u16Delta(crankTime1024, this.prevBleCrankTime1024);
        if (revDelta > 0 && timeDelta1024 > 0) {
          const rpm = Math.round((revDelta * 1024 * 60) / timeDelta1024);
          if (rpm >= 30 && rpm <= 190) {
            this.currentCadenceRpm = rpm;
          }
        }
      }
      this.prevBleCrankRevs = crankRevs;
      this.prevBleCrankTime1024 = crankTime1024;

      summary = `BLE Power · ${this.currentPowerWatts} W · ${this.currentCadenceRpm} RPM · Balance ${this.currentLRBalance}/${100 - this.currentLRBalance}%`;
      fields.push(
        {
          offset: 0,
          length: 2,
          label: 'GATT Flags',
          rawHex: `${toHex(raw[0])} ${toHex(raw[1])}`,
          decodedValue: `0x${flags.toString(16).padStart(4, '0')} (Balance + Crank Revs)`,
          category: 'HEADER',
        },
        {
          offset: 2,
          length: 2,
          label: 'Instantaneous Power',
          rawHex: `${toHex(raw[2])} ${toHex(raw[3])}`,
          decodedValue: `${this.currentPowerWatts} Watts (sint16 LE)`,
          category: 'TELEMETRY',
        },
        {
          offset: 4,
          length: 1,
          label: 'L/R Pedal Balance',
          rawHex: toHex(raw[4]),
          decodedValue: `${this.currentLRBalance}% Left / ${100 - this.currentLRBalance}% Right`,
          category: 'TELEMETRY',
        },
        {
          offset: 5,
          length: 4,
          label: 'Crank Revs & 1/1024s Time',
          rawHex: bytesToHex(raw.subarray(5, Math.min(9, raw.length))),
          decodedValue: `Revs ${crankRevs} · Tick ${crankTime1024} (${this.currentCadenceRpm} RPM)`,
          category: 'TELEMETRY',
        }
      );
    } else if (charUuid === 0x2a37 && raw.length >= 2) {
      // BLE Heart Rate Measurement (0x2A37)
      messageName = 'BLE HRM 0x2A37 (Heart Rate + RR Interval)';
      const flags = raw[0];
      const is16Bit = (flags & 0x01) !== 0;
      const bpm = is16Bit && raw.length >= 3 ? raw[1] | (raw[2] << 8) : raw[1];
      if (bpm > 35 && bpm < 245) {
        this.currentHrBpm = bpm;
      }
      const rrMs = raw.length >= 4 ? Math.round(((raw[2] | (raw[3] << 8)) / 1024) * 1000) : Math.round(60000 / Math.max(60, this.currentHrBpm));
      summary = `BLE HRM · ${this.currentHrBpm} BPM · RR ${rrMs} ms`;
      fields.push(
        {
          offset: 0,
          length: 1,
          label: 'HRM Flags',
          rawHex: toHex(flags),
          decodedValue: `UINT8 BPM · RR-Interval Present`,
          category: 'HEADER',
        },
        {
          offset: 1,
          length: raw.length - 1,
          label: 'Heart Rate & RR',
          rawHex: bytesToHex(raw.subarray(1)),
          decodedValue: `${this.currentHrBpm} BPM · RR ${rrMs} ms`,
          category: 'TELEMETRY',
        }
      );
    } else if (charUuid === 0x2ad2 && raw.length >= 8) {
      // BLE FTMS Indoor Bike Data (0x2AD2)
      messageName = 'BLE FTMS 0x2AD2 (Indoor Bike Data)';
      const rawSpeed = raw[2] | (raw[3] << 8); // 0.01 km/h resolution
      const rawCadence = raw[4] | (raw[5] << 8); // 0.5 rpm resolution
      const rawPower = raw[6] | (raw[7] << 8); // 1 W resolution
      this.currentSpeedKph = Number((rawSpeed / 100).toFixed(1));
      this.currentCadenceRpm = Math.round(rawCadence / 2);
      this.currentPowerWatts = rawPower;
      summary = `BLE FTMS · ${rawPower} W · ${this.currentCadenceRpm} RPM · ${this.currentSpeedKph} km/h`;
    } else {
      summary = `BLE Payload (${raw.length} bytes)`;
    }

    const elapsedUs = Math.max(1, Math.round((performance.now() - t0) * 1000));
    return this.recordFrameAudit({
      direction: 'INBOUND',
      protocol: 'BLE',
      source,
      channelOrCharacteristic: `GATT 0x${charUuid.toString(16).toUpperCase()}`,
      messageName,
      rawBytes: Array.from(raw),
      checksumValid: true,
      wasmDecodeTimeUs: elapsedUs,
      summary,
      fields,
      deviceId,
    });
  }

  private recordFrameAudit(params: {
    direction: 'INBOUND' | 'OUTBOUND';
    protocol: 'ANT+' | 'BLE';
    source: TransportProtocol;
    channelOrCharacteristic: string;
    messageName: string;
    rawBytes: number[];
    checksumValid: boolean;
    wasmDecodeTimeUs: number;
    summary: string;
    fields: DecodedByteField[];
    deviceId?: string;
  }): ProtocolFrameAudit {
    this.frameCounter++;
    this.decodeTimeTotalUs += params.wasmDecodeTimeUs;
    const now = Date.now();
    this.recentFrameTimestamps.push(now);
    while (this.recentFrameTimestamps.length > 0 && now - this.recentFrameTimestamps[0] > 3000) {
      this.recentFrameTimestamps.shift();
    }

    if (params.deviceId) {
      const dev = this.devices.get(params.deviceId);
      if (dev) {
        dev.packetCount++;
        if (!params.checksumValid) dev.errorCount++;
        dev.lastSeenMs = now;
      }
    }

    const audit: ProtocolFrameAudit = {
      id: this.frameCounter,
      timestampMs: now,
      direction: params.direction,
      protocol: params.protocol,
      source: params.source,
      channelOrCharacteristic: params.channelOrCharacteristic,
      messageName: params.messageName,
      rawBytes: params.rawBytes,
      hexString: bytesToHex(params.rawBytes),
      checksumValid: params.checksumValid,
      wasmDecodeTimeUs: params.wasmDecodeTimeUs,
      summary: params.summary,
      fields: params.fields,
    };

    this.frameAuditLog = [audit, ...this.frameAuditLog.slice(0, 119)];
    this.emitFrames();
    return audit;
  }

  // ============================================================================
  // Outbound Bidirectional Smart Trainer Control (ANT+ FE-C & BLE FTMS)
  // ============================================================================

  setTrainerControlMode(mode: TrainerControlMode): void {
    this.trainerMode = mode;
    this.dispatchSmartTrainerCommand();
    this.emitTelemetry();
  }

  setManualErgWatts(watts: number): void {
    this.manualErgWatts = Math.max(50, Math.min(1200, Math.round(watts)));
    this.dispatchSmartTrainerCommand();
    this.emitTelemetry();
  }

  setTargetSlopePct(slopePct: number): void {
    this.targetSlopePct = Number(Math.max(-10, Math.min(20, slopePct)).toFixed(1));
    if (this.trainerMode === 'SLOPE') {
      this.dispatchSmartTrainerCommand();
    }
    this.emitTelemetry();
  }

  setTargetResistancePct(resPct: number): void {
    this.targetResistancePct = Math.max(0, Math.min(100, Math.round(resPct)));
    if (this.trainerMode === 'RESISTANCE') {
      this.dispatchSmartTrainerCommand();
    }
    this.emitTelemetry();
  }

  setIntensityBiasPct(biasPct: number): void {
    this.intensityBiasPct = Math.max(75, Math.min(125, Math.round(biasPct)));
    if (this.trainerMode === 'ERG') {
      this.dispatchSmartTrainerCommand();
    }
    this.emitTelemetry();
  }

  setRiderProfile(ftpWatts: number, weightKg: number): void {
    this.ftpWatts = Math.max(100, Math.min(550, Math.round(ftpWatts)));
    this.riderWeightKg = Math.max(40, Math.min(140, Number(weightKg.toFixed(1))));
    if (this.trainerMode === 'ERG') {
      this.dispatchSmartTrainerCommand();
    }
    this.emitTelemetry();
  }

  /**
   * Computes current target power from the active workout segment + intensity bias
   */
  getCurrentTargetPowerWatts(): number {
    if (this.trainerMode !== 'ERG') {
      if (this.trainerMode === 'SLOPE') {
        // Estimate gravitational + rolling + aero power demand at current speed
        const gradeFactor = Math.max(0.4, 1 + this.targetSlopePct * 0.085);
        return Math.round(this.ftpWatts * 0.72 * gradeFactor);
      }
      return Math.round(this.ftpWatts * (0.4 + (this.targetResistancePct / 100) * 0.9));
    }

    const { segment, segmentElapsed } = this.getActiveSegmentPosition();
    if (!segment) return this.manualErgWatts;

    let pct = segment.targetFtpPct;
    if (segment.endTargetFtpPct !== undefined && segment.durationSec > 0) {
      const progress = Math.min(1, segmentElapsed / segment.durationSec);
      pct = segment.targetFtpPct + (segment.endTargetFtpPct - segment.targetFtpPct) * progress;
    }

    return Math.round(this.ftpWatts * pct * (this.intensityBiasPct / 100));
  }

  /**
   * Encodes and transmits both ANT+ FE-C (Page 48/49/51) and BLE FTMS (0x2AD9) control packets
   */
  dispatchSmartTrainerCommand(): void {
    const t0 = performance.now();
    let antFrame: Uint8Array;
    let bleFrame: Uint8Array;
    let antMsgName: string;
    let bleMsgName: string;
    let cmdSummary: string;

    if (this.trainerMode === 'ERG') {
      const targetW = this.getCurrentTargetPowerWatts();
      antFrame = this.wasm.encodeAntFecErg(0, targetW);
      bleFrame = this.wasm.encodeBleFtmsTargetPower(targetW);
      antMsgName = 'ANT+ FE-C Page 49 (0x31 Target Power)';
      bleMsgName = 'BLE FTMS 0x2AD9 (Op 0x05 Set Target Power)';
      cmdSummary = `Set ERG Target Power → ${targetW} W (${targetW * 4} × 0.25W units)`;
    } else if (this.trainerMode === 'RESISTANCE') {
      antFrame = this.wasm.encodeAntFecResistance(0, this.targetResistancePct);
      bleFrame = this.wasm.encodeBleFtmsResistance(this.targetResistancePct);
      antMsgName = 'ANT+ FE-C Page 48 (0x30 Basic Resistance)';
      bleMsgName = 'BLE FTMS 0x2AD9 (Op 0x04 Set Resistance)';
      cmdSummary = `Set Brake Resistance → ${this.targetResistancePct}% (${this.targetResistancePct * 2} × 0.5% units)`;
    } else {
      antFrame = this.wasm.encodeAntFecSlope(0, this.targetSlopePct);
      bleFrame = this.wasm.encodeBleFtmsSimulation(this.targetSlopePct);
      antMsgName = 'ANT+ FE-C Page 51 (0x33 Track Slope)';
      bleMsgName = 'BLE FTMS 0x2AD9 (Op 0x11 Bike Simulation)';
      const sign = this.targetSlopePct >= 0 ? '+' : '';
      cmdSummary = `Set Simulated Grade → ${sign}${this.targetSlopePct.toFixed(1)}% · Crr 0.0040`;
    }

    const elapsedUs = Math.max(1, Math.round((performance.now() - t0) * 1000));

    // Send over physical WebUSB / WebBluetooth if connected
    this.sendAntUsbRaw(antFrame);
    if (this.bleFtmsControlChar) {
      try {
        this.bleFtmsControlChar.writeValue(bleFrame);
      } catch {
        // Ignore transient GATT write failure
      }
    }

    // Record both outbound ANT+ FE-C and BLE FTMS frames in the Protocol Inspector
    this.recordFrameAudit({
      direction: 'OUTBOUND',
      protocol: 'ANT+',
      source: this.usbDevice ? 'ANT+_USB' : 'SYNTHETIC_WIRE',
      channelOrCharacteristic: 'ANT+ Ch #0 (0x4F AckData)',
      messageName: antMsgName,
      rawBytes: Array.from(antFrame),
      checksumValid: true,
      wasmDecodeTimeUs: elapsedUs,
      summary: cmdSummary,
      fields: [
        {
          offset: 0,
          length: 3,
          label: 'Sync / Len / AckData',
          rawHex: bytesToHex(antFrame.subarray(0, 3)),
          decodedValue: '0xA4 · Len 9 · 0x4F (Acknowledged Data)',
          category: 'HEADER',
        },
        {
          offset: 3,
          length: 2,
          label: 'Channel & FE-C Page',
          rawHex: bytesToHex(antFrame.subarray(3, 5)),
          decodedValue: `Ch #0 · FE-C Page 0x${toHex(antFrame[4])}`,
          category: 'PAGE_OPCODE',
        },
        {
          offset: 5,
          length: 7,
          label: 'Command Payload',
          rawHex: bytesToHex(antFrame.subarray(5, 12)),
          decodedValue: cmdSummary,
          category: 'TELEMETRY',
        },
        {
          offset: 12,
          length: 1,
          label: 'WASM XOR Checksum',
          rawHex: toHex(antFrame[12]),
          decodedValue: `0x${toHex(antFrame[12])} (Encoded in WASM)`,
          category: 'CHECKSUM',
        },
      ],
    });

    this.recordFrameAudit({
      direction: 'OUTBOUND',
      protocol: 'BLE',
      source: this.bleFtmsControlChar ? 'BLE_GATT' : 'SYNTHETIC_WIRE',
      channelOrCharacteristic: 'GATT 0x2AD9 (Control Pt)',
      messageName: bleMsgName,
      rawBytes: Array.from(bleFrame),
      checksumValid: true,
      wasmDecodeTimeUs: elapsedUs,
      summary: cmdSummary,
      fields: [
        {
          offset: 0,
          length: 1,
          label: 'FTMS Opcode',
          rawHex: toHex(bleFrame[0]),
          decodedValue: `Opcode 0x${toHex(bleFrame[0])}`,
          category: 'PAGE_OPCODE',
        },
        {
          offset: 1,
          length: bleFrame.length - 1,
          label: 'Control Parameter Bytes',
          rawHex: bytesToHex(bleFrame.subarray(1)),
          decodedValue: cmdSummary,
          category: 'TELEMETRY',
        },
      ],
    });
  }

  // ============================================================================
  // Synthetic Wire Packet Generator (Byte-Accurate ANT+ & BLE Frames)
  // ============================================================================

  getSyntheticConfig(): SyntheticGeneratorConfig {
    return { ...this.synthConfig };
  }

  updateSyntheticConfig(patch: Partial<SyntheticGeneratorConfig>): void {
    const freqChanged =
      patch.frequencyHz !== undefined && patch.frequencyHz !== this.synthConfig.frequencyHz;
    this.synthConfig = { ...this.synthConfig, ...patch };
    if (patch.enabled === false) {
      this.zeroOutSyntheticValues();
    }
    if (freqChanged || patch.enabled !== undefined) {
      this.restartSyntheticWireLoop();
    }
    this.emitTelemetry();
  }

  private zeroOutSyntheticValues(): void {
    // Check if any physical USB or BLE device has sent packets recently (< 2.5s)
    const now = Date.now();
    let hasPhysicalStream = false;
    for (const dev of this.devices.values()) {
      if (
        (dev.protocol === 'ANT+_USB' || dev.protocol === 'BLE_GATT') &&
        dev.status === 'CONNECTED' &&
        now - dev.lastSeenMs < 2500
      ) {
        hasPhysicalStream = true;
        break;
      }
    }

    if (!hasPhysicalStream) {
      this.currentPowerWatts = 0;
      this.currentCadenceRpm = 0;
      this.currentSpeedKph = 0;
      this.powerRing3s = [];
      this.powerRing10s = [];
      this.synthPhysiologicalPower = 0;
      // Heart rate slowly decays to resting baseline or 0
      this.synthPhysiologicalHr = 60;
      this.currentHrBpm = 0;
    }
  }

  private restartSyntheticWireLoop(): void {
    if (this.synthTimer !== null) {
      window.clearInterval(this.synthTimer);
      this.synthTimer = null;
    }
    if (!this.synthConfig.enabled) return;

    const intervalMs = Math.round(1000 / this.synthConfig.frequencyHz);
    this.synthTimer = window.setInterval(() => {
      this.emitSyntheticWireBurst();
    }, intervalMs);
  }

  private emitSyntheticWireBurst(): void {
    if (!this.synthConfig.enabled) return;
    this.synthTick++;

    const targetW = this.getCurrentTargetPowerWatts() + this.synthConfig.baseRiderEffortOffsetWatts;
    // Smoothly converge rider physiological output toward target wattage with natural micro-variation
    const noiseW = Math.round(Math.sin(this.synthTick * 0.45) * 4 + (Math.random() - 0.5) * 5);
    this.synthPhysiologicalPower = Math.max(
      45,
      Math.round(this.synthPhysiologicalPower * 0.72 + (targetW + noiseW) * 0.28)
    );

    const { segment } = this.getActiveSegmentPosition();
    const baseCadence = segment?.targetCadenceRpm ?? 90;
    const cadenceWave = this.synthConfig.simulateCadenceNaturalWave
      ? Math.round(Math.sin(this.synthTick * 0.2) * 2)
      : 0;
    const simCadence = Math.max(55, Math.min(125, baseCadence + cadenceWave));

    // First-order physiological HR lag model
    const targetHr = Math.min(
      196,
      Math.round(92 + (this.synthPhysiologicalPower / Math.max(150, this.ftpWatts)) * 74)
    );
    this.synthPhysiologicalHr += (targetHr - this.synthPhysiologicalHr) * 0.035;
    const simHr = Math.round(this.synthPhysiologicalHr);

    // Virtual speed physics from power + slope
    const grade = this.trainerMode === 'SLOPE' ? this.targetSlopePct : 0.5;
    const rawSpeedMps = Math.max(
      3.5,
      (Math.pow(this.synthPhysiologicalPower, 0.38) * 1.62) / Math.max(0.45, 1 + grade * 0.07)
    );

    // Advance cumulative counters (16-bit & 8-bit)
    this.synthEventCount = (this.synthEventCount + 1) & 0xff;
    this.synthAccumPower = (this.synthAccumPower + this.synthPhysiologicalPower) & 0xffff;
    const dtSec = 1 / this.synthConfig.frequencyHz;
    const crankRevsInc = Math.max(1, Math.round((simCadence / 60) * dtSec * 2));
    this.synthCrankRevs = (this.synthCrankRevs + crankRevsInc) & 0xffff;
    const timeInc1024 = Math.round(((crankRevsInc * 60) / simCadence) * 1024);
    this.synthCrankTime1024 = (this.synthCrankTime1024 + timeInc1024) & 0xffff;

    const shouldCorrupt =
      this.synthConfig.injectPacketCorruptionPct > 0 &&
      Math.random() * 100 < this.synthConfig.injectPacketCorruptionPct;

    const mix = this.synthConfig.protocolMix;

    // 1. Emit ANT+ FE-C Page 0x19 or Page 0x10 frame
    if (mix === 'BOTH' || mix === 'ANT_ONLY') {
      if (this.synthTick % 3 !== 0) {
        // ANT+ FE-C Page 0x19 (Specific Trainer Data)
        const pwr = this.synthPhysiologicalPower;
        const frame = new Uint8Array([
          0xa4,
          0x09,
          0x4e, // Broadcast Data
          0x00, // Channel 0
          0x19, // Data Page 25
          this.synthEventCount,
          simCadence & 0xff,
          this.synthAccumPower & 0xff,
          (this.synthAccumPower >> 8) & 0xff,
          pwr & 0xff,
          (pwr >> 8) & 0x0f,
          0x30, // Trainer status flags
          0x00,
        ]);
        let crc = 0;
        for (let i = 0; i < 12; i++) crc ^= frame[i];
        frame[12] = shouldCorrupt ? crc ^ 0xff : crc;
        this.ingestSingleAntFrame(frame, 'SYNTHETIC_WIRE', 'sim-ant-fec');
      } else {
        // ANT+ FE-C Page 0x10 (Speed & Distance) vs ANT+ HRM Page 4
        if (this.synthTick % 2 === 0) {
          const speedMmS = Math.round(rawSpeedMps * 1000) & 0xffff;
          const frame = new Uint8Array([
            0xa4,
            0x09,
            0x4e,
            0x00,
            0x10, // Data Page 16
            0x19, // Equipment Type: Trainer (25)
            (this.elapsedSec * 4) & 0xff,
            Math.round(this.distanceMeters) & 0xff,
            speedMmS & 0xff,
            (speedMmS >> 8) & 0xff,
            simHr & 0xff,
            0x30,
            0x00,
          ]);
          // Fix page 16 byte alignment per ANT+ FE-C spec:
          // Byte 4 = 0x10, Byte 5 = Elapsed Time, Byte 6 = Distance, Byte 7..8 = Speed LSB/MSB
          frame[5] = (this.elapsedSec * 4) & 0xff;
          frame[6] = Math.round(this.distanceMeters) & 0xff;
          frame[7] = speedMmS & 0xff;
          frame[8] = (speedMmS >> 8) & 0xff;
          let crc = 0;
          for (let i = 0; i < 12; i++) crc ^= frame[i];
          frame[12] = shouldCorrupt ? crc ^ 0x55 : crc;
          this.ingestSingleAntFrame(frame, 'SYNTHETIC_WIRE', 'sim-ant-fec');
        } else {
          // ANT+ HRM Channel 2 Page 4
          const beatTime = this.synthCrankTime1024;
          const frame = new Uint8Array([
            0xa4,
            0x09,
            0x4e,
            0x02, // Channel 2 (HRM)
            0x84, // Page 4 + toggle bit
            0xff,
            0xff,
            0xff,
            beatTime & 0xff,
            (beatTime >> 8) & 0xff,
            this.synthEventCount,
            simHr & 0xff,
            0x00,
          ]);
          let crc = 0;
          for (let i = 0; i < 12; i++) crc ^= frame[i];
          frame[12] = shouldCorrupt ? crc ^ 0xaa : crc;
          this.ingestSingleAntFrame(frame, 'SYNTHETIC_WIRE', 'sim-ant-hrm');
        }
      }
    }

    // 2. Emit BLE GATT Cycling Power (0x2A63) or Heart Rate (0x2A37) notification
    if (mix === 'BOTH' || mix === 'BLE_ONLY') {
      if (this.synthTick % 2 === 0) {
        const pwr = this.synthPhysiologicalPower;
        const balanceHalfPct = (50 + (this.synthTick % 3) - 1) * 2;
        const bleCps = new Uint8Array([
          0x21,
          0x00, // Flags: Pedal Power Balance + Crank Revolution Data Present
          pwr & 0xff,
          (pwr >> 8) & 0xff,
          balanceHalfPct & 0xff,
          this.synthCrankRevs & 0xff,
          (this.synthCrankRevs >> 8) & 0xff,
          this.synthCrankTime1024 & 0xff,
          (this.synthCrankTime1024 >> 8) & 0xff,
        ]);
        this.ingestBleGattNotification(0x2a63, bleCps, 'SYNTHETIC_WIRE', 'sim-ble-cps');
      } else if (mix === 'BLE_ONLY') {
        const rr1024 = Math.round((60 / Math.max(50, simHr)) * 1024);
        const bleHrm = new Uint8Array([
          0x10, // Flags: UINT8 BPM + RR-Interval present
          simHr & 0xff,
          rr1024 & 0xff,
          (rr1024 >> 8) & 0xff,
        ]);
        this.ingestBleGattNotification(0x2a37, bleHrm, 'SYNTHETIC_WIRE', 'sim-ble-cps');
      }
    }
  }

  // ============================================================================
  // Workout Clock, Smoothing Windows & W'bal Physiological Integration (1Hz)
  // ============================================================================

  private startWorkoutClock(): void {
    if (this.tickTimer !== null) return;
    this.tickTimer = window.setInterval(() => {
      if (!this.isRiding) {
        this.emitTelemetry();
        return;
      }

      // If synthetic generator is off, verify if physical sensors are active; otherwise decay/zero values
      if (!this.synthConfig.enabled) {
        const now = Date.now();
        let hasPhysical = false;
        for (const dev of this.devices.values()) {
          if (
            (dev.protocol === 'ANT+_USB' || dev.protocol === 'BLE_GATT') &&
            dev.status === 'CONNECTED' &&
            now - dev.lastSeenMs < 2500
          ) {
            hasPhysical = true;
            break;
          }
        }
        if (!hasPhysical) {
          this.currentPowerWatts = 0;
          this.currentCadenceRpm = 0;
          this.currentSpeedKph = 0;
          this.currentHrBpm = 0;
          this.powerRing3s = [];
        }
      }

      const prevSegIdx = this.getActiveSegmentPosition().index;
      this.elapsedSec++;
      const nextSegIdx = this.getActiveSegmentPosition().index;

      // If we crossed into a new workout interval in ERG mode, automatically encode & transmit new FE-C / FTMS command!
      if (nextSegIdx !== prevSegIdx && this.trainerMode === 'ERG') {
        this.dispatchSmartTrainerCommand();
      }

      // Update rolling power windows (3s, 10s, 30s)
      const pwr = this.currentPowerWatts;
      this.powerRing3s.push(pwr);
      if (this.powerRing3s.length > 3) this.powerRing3s.shift();

      this.powerRing10s.push(pwr);
      if (this.powerRing10s.length > 10) this.powerRing10s.shift();

      this.powerRing30s.push(pwr);
      if (this.powerRing30s.length > 30) this.powerRing30s.shift();

      const avg30s =
        this.powerRing30s.reduce((a, b) => a + b, 0) / Math.max(1, this.powerRing30s.length);
      this.fourthPowerSum += Math.pow(avg30s, 4);
      this.fourthPowerCount++;

      this.powerSum += pwr;
      this.powerSamples++;
      if (pwr > this.maxPowerWatts) this.maxPowerWatts = pwr;

      this.hrSum += this.currentHrBpm;
      this.hrSamples++;
      if (this.currentHrBpm > this.maxHrBpm) this.maxHrBpm = this.currentHrBpm;

      this.cadenceSum += this.currentCadenceRpm;
      this.cadenceSamples++;

      this.distanceMeters += this.currentSpeedKph / 3.6;
      this.kilojoules += pwr / 1000;

      // Step Skiba W'bal inside the Rust/WASM VM
      this.wPrimeBalanceJoules = this.wasm.stepWbal(
        this.wPrimeBalanceJoules,
        this.wPrimeMaxJoules,
        pwr,
        this.ftpWatts
      );

      const snap = this.getSnapshot();
      this.telemetryHistory.push({
        elapsedSec: this.elapsedSec,
        powerWatts: snap.instantPowerWatts,
        power3sWatts: snap.power3sWatts,
        targetWatts: snap.targetPowerWatts,
        heartRateBpm: snap.heartRateBpm,
        cadenceRpm: snap.cadenceRpm,
        speedKph: snap.speedKph,
        wPrimeBalancePct: snap.wPrimeBalancePct,
      });
      if (this.telemetryHistory.length > 1800) {
        this.telemetryHistory.shift();
      }

      this.emitTelemetry();
      this.emitDevices();
    }, 1000);
  }

  private getActiveSegmentPosition(): {
    index: number;
    segment: StructuredWorkout['segments'][number] | null;
    segmentElapsed: number;
    segmentRemaining: number;
  } {
    const segs = this.activeWorkout.segments;
    if (segs.length === 0) {
      return { index: 0, segment: null, segmentElapsed: 0, segmentRemaining: 0 };
    }
    let acc = 0;
    for (let i = 0; i < segs.length; i++) {
      const s = segs[i];
      if (this.elapsedSec < acc + s.durationSec) {
        const segmentElapsed = this.elapsedSec - acc;
        return {
          index: i,
          segment: s,
          segmentElapsed,
          segmentRemaining: s.durationSec - segmentElapsed,
        };
      }
      acc += s.durationSec;
    }
    const lastIdx = segs.length - 1;
    return {
      index: lastIdx,
      segment: segs[lastIdx],
      segmentElapsed: segs[lastIdx].durationSec,
      segmentRemaining: 0,
    };
  }

  // ============================================================================
  // Workout Playback Controls & Snapshot Getters
  // ============================================================================

  toggleRidePause(): void {
    this.isRiding = !this.isRiding;
    this.emitTelemetry();
  }

  getIsRiding(): boolean {
    return this.isRiding;
  }

  selectWorkout(workout: StructuredWorkout): void {
    this.activeWorkout = workout;
    this.elapsedSec = 0;
    this.telemetryHistory = [];
    this.wPrimeBalanceJoules = this.wPrimeMaxJoules;
    this.dispatchSmartTrainerCommand();
    this.emitTelemetry();
  }

  getActiveWorkout(): StructuredWorkout {
    return this.activeWorkout;
  }

  skipToSegment(segmentIndex: number): void {
    const segs = this.activeWorkout.segments;
    const clamped = Math.max(0, Math.min(segs.length - 1, segmentIndex));
    let elapsed = 0;
    for (let i = 0; i < clamped; i++) {
      elapsed += segs[i].durationSec;
    }
    this.elapsedSec = elapsed;
    this.dispatchSmartTrainerCommand();
    this.emitTelemetry();
  }

  resetSession(): void {
    this.elapsedSec = 0;
    this.telemetryHistory = [];
    this.wPrimeBalanceJoules = this.wPrimeMaxJoules;
    this.powerRing3s = [];
    this.powerRing10s = [];
    this.powerRing30s = [];
    this.fourthPowerSum = 0;
    this.fourthPowerCount = 0;
    this.powerSum = 0;
    this.powerSamples = 0;
    this.maxPowerWatts = 0;
    this.hrSum = 0;
    this.hrSamples = 0;
    this.maxHrBpm = 0;
    this.cadenceSum = 0;
    this.cadenceSamples = 0;
    this.distanceMeters = 0;
    this.kilojoules = 0;
    this.dispatchSmartTrainerCommand();
    this.emitTelemetry();
  }

  getTelemetryHistory(): TelemetryHistoryPoint[] {
    return this.telemetryHistory;
  }

  getSnapshot(): TelemetrySnapshot {
    const pos = this.getActiveSegmentPosition();
    const avg = (arr: number[], fallback: number) =>
      arr.length > 0 ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : fallback;

    const pwr3s = avg(this.powerRing3s, this.currentPowerWatts);
    const pwr10s = avg(this.powerRing10s, this.currentPowerWatts);
    const pwr30s = avg(this.powerRing30s, this.currentPowerWatts);
    const np =
      this.fourthPowerCount > 0
        ? Math.round(Math.pow(this.fourthPowerSum / this.fourthPowerCount, 0.25))
        : pwr30s;
    const avgPower =
      this.powerSamples > 0 ? Math.round(this.powerSum / this.powerSamples) : this.currentPowerWatts;
    const avgHr =
      this.hrSamples > 0 ? Math.round(this.hrSum / this.hrSamples) : this.currentHrBpm;
    const avgCadence =
      this.cadenceSamples > 0
        ? Math.round(this.cadenceSum / this.cadenceSamples)
        : this.currentCadenceRpm;

    const ifVal = Number((np / Math.max(100, this.ftpWatts)).toFixed(2));
    const tssVal = Number(
      (((this.elapsedSec * np * ifVal) / (this.ftpWatts * 3600)) * 100).toFixed(1)
    );
    const frameRateHz = Number((this.recentFrameTimestamps.length / 3).toFixed(1));

    return {
      timestampMs: Date.now(),
      elapsedSec: this.elapsedSec,
      intervalElapsedSec: pos.segmentElapsed,
      intervalRemainingSec: pos.segmentRemaining,
      activeIntervalIndex: pos.index,

      instantPowerWatts: this.currentPowerWatts,
      power3sWatts: pwr3s,
      power10sWatts: pwr10s,
      power30sWatts: pwr30s,
      normalizedPowerWatts: np,
      averagePowerWatts: avgPower,
      maxPowerWatts: Math.max(this.maxPowerWatts, this.currentPowerWatts),
      wattsPerKg: Number((pwr3s / Math.max(40, this.riderWeightKg)).toFixed(2)),

      targetPowerWatts: this.getCurrentTargetPowerWatts(),
      trainerMode: this.trainerMode,
      targetSlopePct: this.targetSlopePct,
      targetResistancePct: this.targetResistancePct,
      intensityBiasPct: this.intensityBiasPct,

      heartRateBpm: this.currentHrBpm,
      averageHeartRateBpm: avgHr,
      maxHeartRateBpm: Math.max(this.maxHrBpm, this.currentHrBpm),
      cadenceRpm: this.currentCadenceRpm,
      averageCadenceRpm: avgCadence,
      speedKph: this.currentSpeedKph,
      distanceMeters: Math.round(this.distanceMeters),
      leftRightBalancePct: this.currentLRBalance,

      ftpWatts: this.ftpWatts,
      riderWeightKg: this.riderWeightKg,
      wPrimeMaxJoules: this.wPrimeMaxJoules,
      wPrimeBalanceJoules: this.wPrimeBalanceJoules,
      wPrimeBalancePct: Number(
        ((this.wPrimeBalanceJoules / Math.max(1, this.wPrimeMaxJoules)) * 100).toFixed(1)
      ),
      intensityFactor: ifVal,
      trainingStressScore: tssVal,
      kilojoules: Number(this.kilojoules.toFixed(1)),

      totalFramesProcessed: this.frameCounter,
      checksumErrors: this.checksumErrors,
      avgWasmDecodeUs:
        this.frameCounter > 0
          ? Number((this.decodeTimeTotalUs / this.frameCounter).toFixed(1))
          : 1.2,
      frameRateHz,
    };
  }
}

export const veloCoreEngine = new VeloCoreEngine();
