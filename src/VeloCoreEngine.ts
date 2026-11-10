import { VeloCoreWasmRuntime } from './wasm/wasmBinary';
import {
  BikeControllerControlId,
  BikeControllerDeviceModel,
  BikeControllerEvent,
  ConnectedSensorDevice,
  DecodedByteField,
  IntervalCompletionSummary,
  ProtocolFrameAudit,
  StructuredWorkout,
  SyntheticGeneratorConfig,
  TelemetryHistoryPoint,
  TelemetrySnapshot,
  TrainerControlMode,
  TransportProtocol,
  VeloCoreBackendHook,
} from './types';
import {
  BUILTIN_WORKOUTS,
  encodeTelemetryToFitBinary,
  loadRiderProfileFromTxtFile,
  saveRiderProfileToTxtFile,
} from './workouts';

type TelemetryListener = (snapshot: TelemetrySnapshot) => void;
type FrameAuditListener = (frames: ProtocolFrameAudit[]) => void;
type DeviceRosterListener = (devices: ConnectedSensorDevice[]) => void;
type IntervalCompletionListener = (summary: IntervalCompletionSummary) => void;
type ControllerEventListener = (event: BikeControllerEvent) => void;

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
  private intervalCompletionListeners = new Set<IntervalCompletionListener>();
  private controllerListeners = new Set<ControllerEventListener>();
  private backendHooks = new Set<VeloCoreBackendHook>();

  // Workout & Clock State
  private activeWorkout: StructuredWorkout = BUILTIN_WORKOUTS[0];
  private isRiding = false;
  private userPausedManually = false;
  private elapsedSec = 0;
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private synthTimer: ReturnType<typeof setInterval> | null = null;

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
  private virtualGear = 12;
  private steeringAngleNormalized = 0;
  private brakeNormalized = 0;

  // Rolling Power & Biometric Accumulators
  private powerRing3s: number[] = [];
  private powerRing10s: number[] = [];
  private powerRing30s: number[] = [];
  private powerSampleWindow: Array<{ ts: number; watts: number }> = [];
  private intervalPowerSum = 0;
  private intervalPowerSamples = 0;
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
  private lastPowerPacketMs = 0;
  private lastHrPacketMs = 0;
  private lastSpeedPacketMs = 0;

  // Instantaneous Sensor Values
  private currentPowerWatts = 0;
  private currentHrBpm = 0;
  private currentCadenceRpm = 0;
  private currentSpeedKph = 0;
  private currentLRBalance = 50;

  // Synthetic Wire Counter State
  private synthConfig: SyntheticGeneratorConfig = {
    enabled: false,
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
  private bleWriteQueue: Promise<void> = Promise.resolve();

  constructor() {
    this.registerDefaultSimulatedDevices();
  }

  async start(): Promise<void> {
    await this.wasm.init();
    const savedProfile = await loadRiderProfileFromTxtFile();
    if (savedProfile) {
      this.ftpWatts = savedProfile.ftpWatts;
      this.riderWeightKg = savedProfile.weightKg;
    }
    this.wasm.sessionSetRiderProfile(this.ftpWatts, this.riderWeightKg, this.wPrimeMaxJoules);
    this.startWorkoutClock();
    this.restartSyntheticWireLoop();
    // Dispatch initial ERG command frame so the protocol inspector immediately shows outbound wire encoding
    this.dispatchSmartTrainerCommand();
    this.emitTelemetry();
  }

  stop(): void {
    if (this.tickTimer !== null) {
      globalThis.clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
    if (this.synthTimer !== null) {
      globalThis.clearInterval(this.synthTimer);
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

  /**
   * Subscribes to workout interval completion summaries containing target
   * power/cadence compliance percentages and average wattage.
   */
  subscribeIntervalCompletions(cb: IntervalCompletionListener): () => void {
    this.intervalCompletionListeners.add(cb);
    return () => this.intervalCompletionListeners.delete(cb);
  }

  /**
   * Registers a pluggable backend lifecycle hook (`onTick`, `onIntervalComplete`,
   * `onRideStateChange`, `onSessionReset`, `onControllerInput`). Returns an unregister function.
   */
  registerHook(hook: VeloCoreBackendHook): () => void {
    this.backendHooks.add(hook);
    return () => this.backendHooks.delete(hook);
  }

  /**
   * Subscribes to normalized OpenBikeControl / handlebar controller events.
   */
  subscribeControllerEvents(cb: ControllerEventListener): () => void {
    this.controllerListeners.add(cb);
    return () => this.controllerListeners.delete(cb);
  }

  /**
   * Sets the virtual drivetrain gear (`1..24`, default `12`) and dispatches
   * the gear-adjusted trainer command when in SLOPE or RESISTANCE mode.
   */
  setVirtualGear(gear: number): void {
    this.virtualGear = Math.max(1, Math.min(24, Math.round(gear)));
    if (this.trainerMode !== 'ERG') {
      this.dispatchSmartTrainerCommand();
    }
    this.emitTelemetry();
  }

  getVirtualGear(): number {
    return this.virtualGear;
  }

  /**
   * Ingests a normalized OpenBikeControl / handlebar controller event from the frontend.
   *
   * 1. Invokes `hook.onControllerInput(event, snapshot)` on all registered backend hooks.
   * 2. Notifies `subscribeControllerEvents` listeners.
   * 3. Unless a hook returned `{ preventDefault: true }`, applies default cycling hardware
   *    actions (virtual gear shifting in SLOPE/RESISTANCE mode, or ±1% intensity bias in ERG mode).
   */
  ingestControllerEvent(
    input: Omit<BikeControllerEvent, 'timestampMs'> & { timestampMs?: number }
  ): { handledByHook: boolean; snapshot: TelemetrySnapshot } {
    const event: BikeControllerEvent = {
      ...input,
      timestampMs: input.timestampMs ?? Date.now(),
    };

    const currentSnap = this.getSnapshot();
    let preventDefault = false;

    for (const hook of this.backendHooks) {
      const res = hook.onControllerInput?.(event, currentSnap);
      if (res && res.preventDefault) {
        preventDefault = true;
      }
    }

    for (const cb of this.controllerListeners) {
      cb(event);
    }

    if (!preventDefault) {
      if (event.control === 'STEER_AXIS' && event.state === 'AXIS_CHANGE') {
        this.steeringAngleNormalized = Number(Math.max(-1, Math.min(1, event.value)).toFixed(3));
        this.emitTelemetry();
      } else if (event.control === 'BRAKE_AXIS' && event.state === 'AXIS_CHANGE') {
        this.brakeNormalized = Number(Math.max(0, Math.min(1, event.value)).toFixed(3));
        this.emitTelemetry();
      } else if (
        (event.control === 'SHIFT_UP' || event.control === 'DPAD_UP') &&
        event.state === 'PRESSED'
      ) {
        if (this.trainerMode === 'ERG') {
          this.setIntensityBiasPct(this.intensityBiasPct + 1);
        } else {
          this.setVirtualGear(this.virtualGear + 1);
        }
      } else if (
        (event.control === 'SHIFT_DOWN' || event.control === 'DPAD_DOWN') &&
        event.state === 'PRESSED'
      ) {
        if (this.trainerMode === 'ERG') {
          this.setIntensityBiasPct(this.intensityBiasPct - 1);
        } else {
          this.setVirtualGear(this.virtualGear - 1);
        }
      }
    }

    return {
      handledByHook: preventDefault,
      snapshot: this.getSnapshot(),
    };
  }

  /**
   * Decodes a raw BLE controller notification packet (Zwift Click 0x37, Zwift Play 0x07,
   * or OpenBikeControl 0xBC frame) in Rust WASM and routes resulting button events
   * through `ingestControllerEvent()`.
   */
  ingestBleControllerNotification(
    deviceId: string,
    raw: Uint8Array,
    deviceModel: BikeControllerDeviceModel = 'GENERIC_OBC'
  ): BikeControllerEvent[] {
    const mask = this.wasm.decodeBleControllerMask(raw);
    if (mask === 0) return [];

    const bitTable: Array<[number, BikeControllerControlId]> = [
      [1 << 0, 'SHIFT_UP'],
      [1 << 1, 'SHIFT_DOWN'],
      [1 << 2, 'DPAD_UP'],
      [1 << 3, 'DPAD_DOWN'],
      [1 << 4, 'DPAD_LEFT'],
      [1 << 5, 'DPAD_RIGHT'],
      [1 << 6, 'BUTTON_A'],
      [1 << 7, 'BUTTON_B'],
      [1 << 8, 'BUTTON_Y'],
      [1 << 9, 'BUTTON_Z'],
      [1 << 10, 'ON_OFF_HOME'],
    ];

    const emitted: BikeControllerEvent[] = [];
    const now = Date.now();
    for (const [bit, control] of bitTable) {
      if ((mask & bit) !== 0) {
        const evt: BikeControllerEvent = {
          timestampMs: now,
          deviceId,
          deviceModel,
          control,
          state: 'PRESSED',
          value: 1,
        };
        this.ingestControllerEvent(evt);
        emitted.push(evt);
      }
    }
    return emitted;
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

      // Automatically pause the Synthetic Wire Generator so live ANT+ telemetry drives the gauges
      if (this.synthConfig.enabled) {
        this.updateSyntheticConfig({ enabled: false });
      }

      // Start background bulk IN read loop before sending initialization commands
      this.pollAntUsbLoop();

      // Send ANT+ ResetSystem (0x4A) and wait 550ms per Dynastream USB stick specification
      await this.sendAntUsbCommand(0x4a, [0x00]);
      await this.delayMs(550);

      // SetNetworkKey (0x46) on Network #0 with official ANT+ network key (B9 A5 21 FB BD 72 C3 45)
      await this.sendAntUsbCommand(0x46, [
        0x00, 0xb9, 0xa5, 0x21, 0xfb, 0xbd, 0x72, 0xc3, 0x45,
      ]);
      await this.delayMs(50);

      // Open Channel 0: ANT+ FE-C Smart Trainer (Device Type 17 = 0x11, Period 8192 = 4.00 Hz, 2457 MHz)
      await this.openAntSlaveChannel(0, 17, 8192);
      // Open Channel 1: ANT+ Cycling Power Meter (Device Type 11 = 0x0B, Period 8182 = 4.005 Hz, 2457 MHz)
      await this.openAntSlaveChannel(1, 11, 8182);
      // Open Channel 2: ANT+ Heart Rate Monitor (Device Type 120 = 0x78, Period 8070 = 4.06 Hz, 2457 MHz)
      await this.openAntSlaveChannel(2, 120, 8070);

      return {
        ok: true,
        message: `Connected to ${device.productName || 'ANT+ USB Dongle'} on Bulk EP #${this.usbInEndpoint}. Listening on 2457 MHz for FE-C Trainer (Ch 0), Power (Ch 1), and HRM (Ch 2).`,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        message: `WebUSB connection canceled or blocked: ${msg}`,
      };
    }
  }

  private delayMs(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Builds and sends a valid ANT+ serial message `[0xA4, len, msgId, ...payload, xorChecksum]`
   */
  private async sendAntUsbCommand(msgId: number, payload: number[]): Promise<void> {
    const frame = new Uint8Array(payload.length + 4);
    frame[0] = 0xa4;
    frame[1] = payload.length;
    frame[2] = msgId;
    for (let i = 0; i < payload.length; i++) {
      frame[3 + i] = payload[i] & 0xff;
    }
    let xor = 0;
    for (let i = 0; i < frame.length - 1; i++) {
      xor ^= frame[i];
    }
    frame[frame.length - 1] = xor;
    await this.sendAntUsbRaw(frame);
  }

  /**
   * Configures and opens an ANT+ wildcard slave channel on Network #0 (2457 MHz)
   */
  private async openAntSlaveChannel(
    channel: number,
    deviceType: number,
    channelPeriod: number
  ): Promise<void> {
    // 1. AssignChannel (0x42): [Channel, ChannelType=0x00 (Bidirectional Slave), NetworkNumber=0x00]
    await this.sendAntUsbCommand(0x42, [channel, 0x00, 0x00]);
    await this.delayMs(25);

    // 2. SetChannelId (0x51): [Channel, DevNumLSB=0, DevNumMSB=0 (Wildcard), DeviceType, TransType=0 (Wildcard)]
    await this.sendAntUsbCommand(0x51, [channel, 0x00, 0x00, deviceType & 0xff, 0x00]);
    await this.delayMs(25);

    // 3. SetChannelRfFreq (0x45): [Channel, RfFreq=57 (2457 MHz official ANT+ frequency)]
    await this.sendAntUsbCommand(0x45, [channel, 57]);
    await this.delayMs(25);

    // 4. SetChannelPeriod (0x43): [Channel, PeriodLSB, PeriodMSB]
    await this.sendAntUsbCommand(0x43, [
      channel,
      channelPeriod & 0xff,
      (channelPeriod >> 8) & 0xff,
    ]);
    await this.delayMs(25);

    // 5. SetChannelSearchTimeout (0x44): [Channel, Timeout=255 (Infinite / continuous search)]
    await this.sendAntUsbCommand(0x44, [channel, 0xff]);
    await this.delayMs(25);

    // 6. OpenChannel (0x4B): [Channel]
    await this.sendAntUsbCommand(0x4b, [channel]);
    await this.delayMs(25);
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
          const bytes = new Uint8Array(
            result.data.buffer,
            result.data.byteOffset,
            result.data.byteLength
          );
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
      const host = window.location.hostname;
      const isLinux = /Linux/i.test(navigator.userAgent || '');
      let reason = 'WebBluetooth is not enabled in this browser.';
      if (!isSecure || (host !== 'localhost' && host !== '127.0.0.1' && window.location.protocol !== 'https:')) {
        reason = `WebBluetooth requires a secure origin. Please open http://localhost:${window.location.port || '3000'} (instead of ${host}) or use HTTPS.`;
      } else if (isIframe) {
        reason =
          'WebBluetooth is blocked inside an embedded iframe. Open the app directly in a top-level browser tab.';
      } else if (isLinux) {
        reason =
          'On Linux Chrome/Chromium, WebBluetooth is disabled by default. Enable chrome://flags/#enable-experimental-web-platform-features and chrome://flags/#enable-web-bluetooth-new-permissions-backend (or brave://flags/#enable-web-bluetooth in Brave) and relaunch your browser.';
      } else {
        reason =
          'WebBluetooth is not available. Please use Chrome, Edge, or Chromium with Bluetooth turned on in your OS.';
      }
      return {
        ok: false,
        message: reason,
      };
    }

    const serviceMap = {
      FTMS: {
        filters: [{ services: [0x1826] }, { services: [0x1818] }],
        serviceUuid: 0x1826,
        charUuid: 0x2ad2,
        label: 'FTMS Smart Trainer',
      },
      CPS: {
        filters: [{ services: [0x1818] }],
        serviceUuid: 0x1818,
        charUuid: 0x2a63,
        label: 'BLE Cycling Power Meter',
      },
      HRM: {
        filters: [{ services: [0x180d] }],
        serviceUuid: 0x180d,
        charUuid: 0x2a37,
        label: 'BLE Heart Rate Monitor',
      },
      CSCS: {
        filters: [{ services: [0x1816] }],
        serviceUuid: 0x1816,
        charUuid: 0x2a5b,
        label: 'BLE Speed & Cadence Sensor',
      },
    }[targetRole];

    let stage = 'Stage 1/5: Browser Device Chooser (navigator.bluetooth.requestDevice)';
    let selectedDeviceName = 'Unknown Device';
    let selectedDeviceId = 'N/A';
    const attemptLogs: string[] = [];

    try {
      const device = await nav.bluetooth.requestDevice({
        filters: serviceMap.filters,
        optionalServices: [0x1826, 0x1818, 0x180d, 0x1816, 0x180f, 0x180a],
      });

      selectedDeviceName = device.name || '(Unnamed BLE Device)';
      selectedDeviceId = device.id || 'N/A';

      if (!device.gatt) {
        throw new Error(`Device "${selectedDeviceName}" does not expose a GATT server (device.gatt is null).`);
      }

      // Stage 2: Connect to GATT server with settling delay & multi-attempt backoff.
      // On Linux BlueZ, calling gatt.connect() immediately after requestDevice() often fails
      // with "Connection Error: Connection attempt failed" while BlueZ stops LE discovery.
      stage = 'Stage 2/5: GATT Server Connect (device.gatt.connect)';
      await this.delayMs(350);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let server: any = null;
      const maxAttempts = 4;
      const backoffMs = [450, 900, 1500, 0];

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
          if (device.gatt.connected) {
            try {
              device.gatt.disconnect();
              await this.delayMs(200);
            } catch {
              // Ignore disconnect cleanup error
            }
          }
          server = await device.gatt.connect();
          if (server && device.gatt.connected) {
            attemptLogs.push(`Attempt ${attempt}/${maxAttempts}: Connected`);
            break;
          }
        } catch (connErr) {
          const errName = connErr instanceof Error ? connErr.name : 'Error';
          const errMsg = connErr instanceof Error ? connErr.message : String(connErr);
          attemptLogs.push(`Attempt ${attempt}/${maxAttempts} failed [${errName}: ${errMsg}]`);
          if (attempt === maxAttempts) {
            throw connErr;
          }
          await this.delayMs(backoffMs[attempt - 1]);
        }
      }

      // Stage 3: Discover Primary GATT Service
      stage = `Stage 3/5: Discover Primary Service (0x${serviceMap.serviceUuid.toString(16).toUpperCase()})`;
      await this.delayMs(200);
      let service;
      let activeCharUuid = serviceMap.charUuid;
      try {
        service = await server.getPrimaryService(serviceMap.serviceUuid);
      } catch (svcErr) {
        // Fallback if an FTMS trainer only advertised/exposed 0x1818 Cycling Power
        if (targetRole === 'FTMS') {
          try {
            service = await server.getPrimaryService(0x1818);
            activeCharUuid = 0x2a63;
            attemptLogs.push('Fallback: Using 0x1818 Cycling Power service instead of 0x1826 FTMS');
          } catch {
            throw svcErr;
          }
        } else {
          throw svcErr;
        }
      }

      // Stage 4: Discover Measurement Characteristic
      stage = `Stage 4/5: Get Characteristic (0x${activeCharUuid.toString(16).toUpperCase()})`;
      const characteristic = await service.getCharacteristic(activeCharUuid);

      const devId = `ble-${targetRole.toLowerCase()}-${device.id || Date.now()}`;
      this.devices.set(devId, {
        id: devId,
        name: device.name || serviceMap.label,
        protocol: 'BLE_GATT',
        channelOrUuid: `GATT 0x${activeCharUuid.toString(16).toUpperCase()}`,
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

      device.addEventListener('gattserverdisconnected', () => {
        const d = this.devices.get(devId);
        if (d) {
          d.status = 'STALE';
          this.emitDevices();
        }
        if (targetRole === 'FTMS') {
          this.bleFtmsControlChar = null;
        }
      });

      // Stage 5: Subscribe to GATT Notifications
      stage = `Stage 5/5: Start Notifications (0x${activeCharUuid.toString(16).toUpperCase()})`;
      await characteristic.startNotifications();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      characteristic.addEventListener('characteristicvaluechanged', (event: any) => {
        const dv: DataView = event.target.value;
        const raw = new Uint8Array(dv.buffer, dv.byteOffset, dv.byteLength);
        this.ingestBleGattNotification(activeCharUuid, raw, 'BLE_GATT', devId);
      });

      // If FTMS trainer, grab Fitness Machine Control Point (0x2AD9), enable indications,
      // send Request Control (0x00) and Start/Resume (0x07), then dispatch initial target.
      if (targetRole === 'FTMS' && activeCharUuid === 0x2ad2) {
        try {
          this.bleFtmsControlChar = await service.getCharacteristic(0x2ad9);
          await this.bleFtmsControlChar.startNotifications().catch(() => {});
          this.sendBleFtmsControlRaw(new Uint8Array([0x00])); // Request Control
          this.sendBleFtmsControlRaw(new Uint8Array([0x07])); // Start / Resume
          this.dispatchSmartTrainerCommand();
        } catch {
          // Optional control point
        }
      }

      // Automatically pause the Synthetic Wire Generator so live BLE telemetry drives the gauges
      if (this.synthConfig.enabled) {
        this.updateSyntheticConfig({ enabled: false });
      }

      return {
        ok: true,
        message: `Connected to "${selectedDeviceName}" (ID: ${selectedDeviceId}) over BLE GATT 0x${activeCharUuid.toString(16).toUpperCase()}. [${attemptLogs.join(' · ')}]`,
      };
    } catch (err) {
      const errName = err instanceof Error ? err.name : 'UnknownError';
      const msg = err instanceof Error ? err.message : String(err);
      const attemptSummary =
        attemptLogs.length > 0 ? ` | Attempts: ${attemptLogs.join('; ')}` : '';
      const deviceContext = `[Role: ${targetRole} · Device: "${selectedDeviceName}" (ID: ${selectedDeviceId}) · Failed at ${stage}]`;

      console.error('[OpenVeloCore WebBluetooth Error]', {
        role: targetRole,
        deviceName: selectedDeviceName,
        deviceId: selectedDeviceId,
        failedStage: stage,
        errorName: errName,
        errorMessage: msg,
        attempts: attemptLogs,
        rawError: err,
      });

      if (msg.includes('Permissions-Policy') || msg.includes('SecurityError') || msg.includes('disallowed')) {
        return {
          ok: false,
          message: `WebBluetooth blocked by Permissions Policy ${deviceContext}: ${errName}: ${msg}. Open the app directly in a top-level browser tab on http://localhost:3000.`,
        };
      }

      if (msg.includes('Connection attempt failed') || msg.includes('Connection Error') || msg.includes('GATT Server is disconnected')) {
        return {
          ok: false,
          message:
            `WebBluetooth GATT Connection Failed ${deviceContext} — ${errName}: ${msg}${attemptSummary}. ` +
            `Troubleshooting (Linux / BlueZ): ` +
            `(1) Do NOT pair the trainer in Linux OS Bluetooth Settings—if it appears in 'bluetoothctl devices', run 'bluetoothctl remove <MAC>' so Chrome can open a clean LE GATT link without OS BR/EDR bond conflicts. ` +
            `(2) Ensure the trainer is disconnected from phones, bike computers, or other apps (BLE trainers only allow 1 central connection). ` +
            `(3) Run 'sudo btmgmt le on' or set 'ControllerMode = le' in /etc/bluetooth/main.conf and restart bluetooth.`,
        };
      }

      if (msg.includes('User cancelled') || msg.includes('chooser')) {
        return {
          ok: false,
          message: `WebBluetooth pairing canceled at ${stage} (${errName}: ${msg}).`,
        };
      }

      return {
        ok: false,
        message: `WebBluetooth pairing failed ${deviceContext} — ${errName}: ${msg}${attemptSummary}`,
      };
    }
  }

  private sendBleFtmsControlRaw(frame: Uint8Array): void {
    if (!this.bleFtmsControlChar) return;
    const char = this.bleFtmsControlChar;
    const copy = new Uint8Array(frame);
    this.bleWriteQueue = this.bleWriteQueue
      .then(async () => {
        if (typeof char.writeValueWithResponse === 'function') {
          await char.writeValueWithResponse(copy);
        } else {
          await char.writeValue(copy);
        }
      })
      .catch(() => {
        // Ignore transient GATT write contention
      });
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

        // 0xFFF (4095) means invalid/computed power unavailable per ANT+ FE-C spec
        let nextPower = this.currentPowerWatts;
        if (instPower !== 0xfff) {
          if (this.prevAntPowerEventCount >= 0) {
            const evtDelta = this.wasm.u8Delta(eventCount, this.prevAntPowerEventCount);
            const pwrDelta = this.wasm.u16Delta(accumPower, this.prevAntAccumulatedPower);
            if (evtDelta > 0 && evtDelta < 32) {
              nextPower = Math.max(0, Math.min(2500, instPower));
            } else if (pwrDelta >= 0) {
              nextPower = Math.max(0, Math.min(2500, instPower));
            }
          } else {
            nextPower = Math.max(0, Math.min(2500, instPower));
          }
        }
        this.prevAntPowerEventCount = eventCount;
        this.prevAntAccumulatedPower = accumPower;

        if (instCadence !== 0xff && instCadence >= 0) {
          this.currentCadenceRpm = instCadence;
        }
        this.recordPowerMeasurement(nextPower);

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
        // Byte 4 = 0x10, Byte 5 = Equipment Type, Byte 6 = Elapsed Time (0.25s), Byte 7 = Distance (m), Bytes 8..9 = Speed LSB/MSB (mm/s), Byte 10 = HR
        messageName = 'ANT+ FE-C Page 16 (General FE Kinematics)';
        const elapsedQuarterSec = frame[6];
        const distMeters = frame[7];
        const rawSpeedMmS = frame[8] | (frame[9] << 8);
        if (rawSpeedMmS !== 0xffff) {
          const speedKph = Number(((rawSpeedMmS / 1000) * 3.6).toFixed(1));
          if (speedKph >= 0 && speedKph < 110) {
            this.currentSpeedKph = speedKph;
            this.lastSpeedPacketMs = Date.now();
          }
        }
        this.emitTelemetry();
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
            offset: 6,
            length: 4,
            label: 'Elapsed / Dist / Speed',
            rawHex: `${toHex(elapsedQuarterSec)} ${toHex(distMeters)} ${toHex(frame[8])} ${toHex(frame[9])}`,
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
          this.lastHrPacketMs = Date.now();
          if (computedBpm > this.maxHrBpm) this.maxHrBpm = computedBpm;
          this.emitTelemetry();
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
      } else if (channel === 1 && dataPage === 0x10) {
        // ANT+ Cycling Power Standard Power-Only Page 16 (0x10) on Channel 1
        messageName = 'ANT+ Power Page 16 (Standard Power-Only)';
        const instCadence = frame[7];
        const instPower = frame[10] | (frame[11] << 8);
        if (instCadence !== 0xff && instCadence >= 0) {
          this.currentCadenceRpm = instCadence;
        }
        if (instPower >= 0 && instPower < 2500) {
          this.recordPowerMeasurement(instPower);
        }
        summary = `ANT+ Power Ch #1 · ${this.currentPowerWatts} W · ${this.currentCadenceRpm} RPM`;
      } else {
        // Other ANT+ FE-C / Sensor status pages (e.g. Page 80/81 Manufacturer/Product Info)
        summary = `ANT+ Ch #${channel} Page 0x${toHex(dataPage)}`;
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

    // Decode in Rust WASM first (supports bitmask-driven 0x2AD2 FTMS, 0x2A63 CPS, 0x2A5B CSCS, 0x2A37 HRM)
    const wasmDecoded = this.wasm.decodeBleFrame(charUuid, raw);
    if (wasmDecoded && wasmDecoded.valid) {
      if (wasmDecoded.balanceUpdated) {
        this.currentLRBalance = wasmDecoded.lrBalancePct;
      }
      if (wasmDecoded.cadenceUpdated) {
        this.currentCadenceRpm = wasmDecoded.cadenceRpm;
      }
      if (wasmDecoded.speedUpdated) {
        this.currentSpeedKph = wasmDecoded.speedKph;
        this.lastSpeedPacketMs = Date.now();
      }
      if (wasmDecoded.hrUpdated && wasmDecoded.heartRateBpm > 30) {
        this.currentHrBpm = wasmDecoded.heartRateBpm;
        this.lastHrPacketMs = Date.now();
        if (wasmDecoded.heartRateBpm > this.maxHrBpm) {
          this.maxHrBpm = wasmDecoded.heartRateBpm;
        }
      }
      if (wasmDecoded.powerUpdated) {
        this.recordPowerMeasurement(wasmDecoded.powerWatts);
      } else {
        this.emitTelemetry();
      }

      if (charUuid === 0x2a63) {
        messageName = 'BLE CPS 0x2A63 (Cycling Power)';
        summary = `BLE Power · ${this.currentPowerWatts} W · ${this.currentCadenceRpm} RPM · Balance ${this.currentLRBalance}/${100 - this.currentLRBalance}%`;
      } else if (charUuid === 0x2ad2) {
        messageName = 'BLE FTMS 0x2AD2 (Indoor Bike Data)';
        summary = `BLE FTMS · ${this.currentPowerWatts} W · ${this.currentCadenceRpm} RPM · ${this.currentSpeedKph} km/h`;
      } else if (charUuid === 0x2a5b) {
        messageName = 'BLE CSCS 0x2A5B (Speed & Cadence)';
        summary = `BLE CSCS · ${this.currentCadenceRpm} RPM`;
      } else if (charUuid === 0x2a37) {
        messageName = 'BLE HRM 0x2A37 (Heart Rate)';
        summary = `BLE HRM · ${this.currentHrBpm} BPM`;
      }
    } else if (charUuid === 0x2a63 && raw.length >= 4) {
      // BLE Cycling Power Measurement (0x2A63)
      // Bytes 0..1: Flags, Bytes 2..3: Instantaneous Power (sint16), Byte 4: Pedal Balance,
      // Bytes 5..6: Cumulative Crank Revolutions (uint16), Bytes 7..8: Last Crank Event Time (1/1024s uint16)
      messageName = 'BLE CPS 0x2A63 (Cycling Power + Crank Revs)';
      const flags = raw[0] | (raw[1] << 8);
      const instWatts = raw[2] | (raw[3] << 8);
      const pedalBalanceHalfPct = raw[4];
      const crankRevs = raw[5] | (raw[6] << 8);
      const crankTime1024 = raw.length >= 9 ? raw[7] | (raw[8] << 8) : 0;

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
      this.recordPowerMeasurement(Math.max(0, Math.min(2500, instWatts)));

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
        this.lastHrPacketMs = Date.now();
        if (bpm > this.maxHrBpm) this.maxHrBpm = bpm;
        this.emitTelemetry();
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
      this.lastSpeedPacketMs = Date.now();
      this.currentCadenceRpm = Math.round(rawCadence / 2);
      this.recordPowerMeasurement(Math.max(0, Math.min(2500, rawPower)));
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

  setRiderProfile(ftpWatts: number, weightKg: number, persist = true): void {
    const safeFtp = Number.isFinite(ftpWatts) ? ftpWatts : 0;
    const safeWeight = Number.isFinite(weightKg) ? weightKg : 0;
    this.ftpWatts = Math.max(0, Math.min(1000, Math.round(safeFtp)));
    this.riderWeightKg = Math.max(0, Math.min(300, Number(safeWeight.toFixed(1))));
    this.wasm.sessionSetRiderProfile(this.ftpWatts, this.riderWeightKg, this.wPrimeMaxJoules);
    if (persist) {
      void saveRiderProfileToTxtFile({
        ftpWatts: this.ftpWatts,
        weightKg: this.riderWeightKg,
      });
    }
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
      const gearRatio = this.wasm.computeVirtualGearRatio(this.virtualGear);
      const effectiveRes = Math.max(0, Math.min(100, Math.round(this.targetResistancePct * gearRatio)));
      antFrame = this.wasm.encodeAntFecResistance(0, effectiveRes);
      bleFrame = this.wasm.encodeBleFtmsResistance(effectiveRes);
      antMsgName = 'ANT+ FE-C Page 48 (0x30 Basic Resistance)';
      bleMsgName = 'BLE FTMS 0x2AD9 (Op 0x04 Set Resistance)';
      cmdSummary = `Set Brake Resistance → ${effectiveRes}% (Gear ${this.virtualGear} · ${gearRatio.toFixed(2)}x)`;
    } else {
      const gearRatio = this.wasm.computeVirtualGearRatio(this.virtualGear);
      const effectiveSlope = Number(
        Math.max(-20, Math.min(20, this.targetSlopePct + (gearRatio - 1) * 8)).toFixed(2)
      );
      antFrame = this.wasm.encodeAntFecSlope(0, effectiveSlope);
      bleFrame = this.wasm.encodeBleFtmsSimulation(effectiveSlope);
      antMsgName = 'ANT+ FE-C Page 51 (0x33 Track Slope)';
      bleMsgName = 'BLE FTMS 0x2AD9 (Op 0x11 Bike Simulation)';
      const sign = effectiveSlope >= 0 ? '+' : '';
      cmdSummary = `Set Simulated Grade → ${sign}${effectiveSlope.toFixed(1)}% (Gear ${this.virtualGear})`;
    }

    const elapsedUs = Math.max(1, Math.round((performance.now() - t0) * 1000));

    // Send over physical WebUSB / WebBluetooth if connected
    this.sendAntUsbRaw(antFrame);
    this.sendBleFtmsControlRaw(bleFrame);

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
    // Clear synthetic values and any metric that has not received a live packet recently
    const now = Date.now();
    this.synthPhysiologicalPower = 0;
    this.synthPhysiologicalHr = 60;

    if (now - this.lastPowerPacketMs > 2500) {
      this.currentPowerWatts = 0;
      this.currentCadenceRpm = 0;
      this.powerRing3s = [];
      this.powerRing10s = [];
      this.powerSampleWindow = [];
    }
    if (now - this.lastSpeedPacketMs > 2500) {
      this.currentSpeedKph = 0;
    }
    if (now - this.lastHrPacketMs > 3000) {
      this.currentHrBpm = 0;
    }
  }

  /**
   * Records a fresh power sample from ANT+ / BLE / Synthetic wire, updating the
   * time-based 3000ms rolling window, max power, and emitting live telemetry immediately.
   */
  private recordPowerMeasurement(watts: number): void {
    const now = Date.now();
    const clamped = Math.max(0, Math.min(2500, Math.round(watts)));
    this.currentPowerWatts = clamped;
    this.lastPowerPacketMs = now;
    if (clamped > this.maxPowerWatts) {
      this.maxPowerWatts = clamped;
    }
    if (!this.isRiding && !this.userPausedManually && clamped > 5) {
      this.isRiding = true;
    }
    this.wasm.sessionRecordPowerSample(clamped, now);
    this.powerSampleWindow.push({ ts: now, watts: clamped });
    const cutoff30s = now - 30000;
    while (this.powerSampleWindow.length > 0 && this.powerSampleWindow[0].ts < cutoff30s) {
      this.powerSampleWindow.shift();
    }
    this.emitTelemetry();
  }

  private computeTimeWindowPowerAvg(windowMs: number): number {
    const now = Date.now();
    const cutoff = now - windowMs;
    let sum = 0;
    let count = 0;
    for (let i = this.powerSampleWindow.length - 1; i >= 0; i--) {
      const sample = this.powerSampleWindow[i];
      if (sample.ts >= cutoff) {
        sum += sample.watts;
        count++;
      } else {
        break;
      }
    }
    const tsFallback = count > 0 ? Math.round(sum / count) : this.currentPowerWatts;
    return this.wasm.sessionGetWindowPowerAvg(windowMs, now, tsFallback);
  }

  private restartSyntheticWireLoop(): void {
    if (this.synthTimer !== null) {
      globalThis.clearInterval(this.synthTimer);
      this.synthTimer = null;
    }
    if (!this.synthConfig.enabled) return;

    const intervalMs = Math.round(1000 / this.synthConfig.frequencyHz);
    this.synthTimer = globalThis.setInterval(() => {
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
    this.tickTimer = globalThis.setInterval(() => {
      // Expire stale individual sensor metrics if synthetic generator is off
      if (!this.synthConfig.enabled) {
        const now = Date.now();
        if (this.lastPowerPacketMs === 0 || now - this.lastPowerPacketMs > 2500) {
          this.currentPowerWatts = 0;
          this.currentCadenceRpm = 0;
          this.powerRing3s = [];
          this.powerSampleWindow = [];
        }
        if (this.lastSpeedPacketMs === 0 || now - this.lastSpeedPacketMs > 2500) {
          this.currentSpeedKph = 0;
        }
        if (this.lastHrPacketMs === 0 || now - this.lastHrPacketMs > 4000) {
          this.currentHrBpm = 0;
        }
      }

      if (!this.isRiding) {
        this.emitTelemetry();
        return;
      }

      const prevPos = this.getActiveSegmentPosition();
      const prevSegIdx = prevPos.index;
      const prevTargetW = this.getCurrentTargetPowerWatts();
      this.elapsedSec++;
      const nextPos = this.getActiveSegmentPosition();
      const nextSegIdx = nextPos.index;

      // If we crossed into a new workout interval, score the completed interval in Rust WASM, emit completion report, and transmit new FE-C / FTMS command!
      if (nextSegIdx !== prevSegIdx) {
        const prevAvgPower =
          this.intervalPowerSamples > 0
            ? Math.round(this.intervalPowerSum / this.intervalPowerSamples)
            : this.currentPowerWatts;
        const rustSummary = this.wasm.sessionCompleteInterval();
        if (prevPos.segment) {
          const summary: IntervalCompletionSummary = {
            intervalIndex: prevSegIdx,
            segmentId: prevPos.segment.id,
            segmentName: prevPos.segment.name,
            durationSec: rustSummary.durationSec || prevPos.segment.durationSec,
            powerCompliancePct: rustSummary.powerCompliancePct,
            cadenceCompliancePct: rustSummary.cadenceCompliancePct,
            overallCompliancePct: rustSummary.overallCompliancePct,
            averagePowerWatts: prevAvgPower,
            targetPowerWatts: prevTargetW,
          };
          for (const cb of this.intervalCompletionListeners) cb(summary);
          for (const hook of this.backendHooks) hook.onIntervalComplete?.(summary);
        }
        this.intervalPowerSum = 0;
        this.intervalPowerSamples = 0;
        if (this.trainerMode === 'ERG') {
          this.dispatchSmartTrainerCommand();
        }
      }

      // Update rolling power windows (3s, 10s, 30s) & step Rust 1Hz session engine
      const pwr = this.currentPowerWatts;
      this.wasm.sessionTick1Hz(
        pwr,
        this.currentHrBpm,
        this.currentCadenceRpm,
        this.currentSpeedKph,
        this.getCurrentTargetPowerWatts(),
        nextPos.segment?.targetCadenceRpm ?? 0
      );
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
      this.intervalPowerSum += pwr;
      this.intervalPowerSamples++;
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
        timestampMs: Date.now(),
        elapsedSec: this.elapsedSec,
        powerWatts: snap.instantPowerWatts,
        power3sWatts: snap.power3sWatts,
        targetWatts: snap.targetPowerWatts,
        heartRateBpm: snap.heartRateBpm,
        cadenceRpm: snap.cadenceRpm,
        speedKph: snap.speedKph,
        wPrimeBalancePct: snap.wPrimeBalancePct,
      });
      if (this.telemetryHistory.length > 36000) {
        this.telemetryHistory.shift();
      }

      this.emitTelemetry();
      this.emitDevices();
      for (const hook of this.backendHooks) hook.onTick?.(snap);
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
    this.userPausedManually = !this.isRiding;
    const snap = this.getSnapshot();
    for (const hook of this.backendHooks) hook.onRideStateChange?.(this.isRiding, snap);
    this.emitTelemetry();
  }

  getIsRiding(): boolean {
    return this.isRiding;
  }

  selectWorkout(workout: StructuredWorkout): void {
    this.activeWorkout = workout;
    this.elapsedSec = 0;
    this.userPausedManually = false;
    this.telemetryHistory = [];
    this.intervalPowerSum = 0;
    this.intervalPowerSamples = 0;
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
    this.intervalPowerSum = 0;
    this.intervalPowerSamples = 0;
    this.dispatchSmartTrainerCommand();
    this.emitTelemetry();
  }

  resetSession(): void {
    this.isRiding = false;
    this.userPausedManually = false;
    this.elapsedSec = 0;
    this.telemetryHistory = [];
    this.wPrimeBalanceJoules = this.wPrimeMaxJoules;
    this.powerRing3s = [];
    this.powerRing10s = [];
    this.powerRing30s = [];
    this.powerSampleWindow = [];
    this.intervalPowerSum = 0;
    this.intervalPowerSamples = 0;
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
    this.wasm.sessionReset();
    this.wasm.sessionSetRiderProfile(this.ftpWatts, this.riderWeightKg, this.wPrimeMaxJoules);
    this.zeroOutSyntheticValues();
    this.dispatchSmartTrainerCommand();
    for (const hook of this.backendHooks) hook.onSessionReset?.();
    this.emitTelemetry();
  }

  getTelemetryHistory(): TelemetryHistoryPoint[] {
    return this.telemetryHistory;
  }

  /**
   * Encodes the current session history into a binary Garmin `.FIT` activity file
   * using the Rust WASM `.FIT` encoder (with automatic TypeScript fallback).
   */
  encodeFitActivityBinary(): Uint8Array {
    return (
      this.wasm.encodeFitActivity(this.telemetryHistory) ??
      encodeTelemetryToFitBinary(this.telemetryHistory)
    );
  }

  getSnapshot(): TelemetrySnapshot {
    const pos = this.getActiveSegmentPosition();
    const avg = (arr: number[], fallback: number) =>
      arr.length > 0 ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : fallback;

    const pwr3s =
      this.powerSampleWindow.length > 0
        ? this.computeTimeWindowPowerAvg(3000)
        : avg(this.powerRing3s, this.currentPowerWatts);
    const pwr10s =
      this.powerSampleWindow.length > 0
        ? this.computeTimeWindowPowerAvg(10000)
        : avg(this.powerRing10s, this.currentPowerWatts);
    const pwr30s =
      this.powerSampleWindow.length > 0
        ? this.computeTimeWindowPowerAvg(30000)
        : avg(this.powerRing30s, this.currentPowerWatts);
    const intervalPower =
      this.intervalPowerSamples > 0
        ? Math.round(this.intervalPowerSum / this.intervalPowerSamples)
        : pwr3s;
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

    const ifVal =
      this.ftpWatts > 0 ? Number((np / this.ftpWatts).toFixed(2)) : 0;
    const tssVal =
      this.ftpWatts > 0
        ? Number((((this.elapsedSec * np * ifVal) / (this.ftpWatts * 3600)) * 100).toFixed(1))
        : 0;
    const frameRateHz = Number((this.recentFrameTimestamps.length / 3).toFixed(1));
    const segDur = Math.max(1, pos.segment?.durationSec ?? 1);
    const intervalProgress01 = Number(Math.min(1, Math.max(0, pos.segmentElapsed / segDur)).toFixed(4));

    return {
      timestampMs: Date.now(),
      elapsedSec: this.elapsedSec,
      intervalElapsedSec: pos.segmentElapsed,
      intervalRemainingSec: pos.segmentRemaining,
      intervalProgress01,
      activeIntervalIndex: pos.index,

      instantPowerWatts: this.currentPowerWatts,
      power3sWatts: pwr3s,
      power10sWatts: pwr10s,
      power30sWatts: pwr30s,
      intervalPowerWatts: intervalPower,
      normalizedPowerWatts: np,
      averagePowerWatts: avgPower,
      maxPowerWatts: Math.max(this.maxPowerWatts, this.currentPowerWatts),
      wattsPerKg:
        this.riderWeightKg > 0 ? Number((pwr3s / this.riderWeightKg).toFixed(2)) : 0,

      targetPowerWatts: this.getCurrentTargetPowerWatts(),
      trainerMode: this.trainerMode,
      targetSlopePct: this.targetSlopePct,
      targetResistancePct: this.targetResistancePct,
      intensityBiasPct: this.intensityBiasPct,
      virtualGear: this.virtualGear,
      virtualGearRatio: this.wasm.computeVirtualGearRatio(this.virtualGear),
      steeringAngleNormalized: this.steeringAngleNormalized,
      brakeNormalized: this.brakeNormalized,
      intervalCompliancePct: this.wasm.sessionGetIntervalCompliancePct(),
      intervalCadenceCompliancePct: this.wasm.sessionGetIntervalCadenceCompliancePct(),

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
