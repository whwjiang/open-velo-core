# Open VeloCore (`open-velo-core`)

**Open VeloCore** is a standalone, self-contained **Rust / WebAssembly + TypeScript SDK** for indoor cycling telemetry, smart trainer control, physiological modeling, workout target compliance evaluation, and standards-compliant Garmin `.FIT` / `.TCX` activity encoding.

It is built to run **100% self-contained in the browser** with zero UI framework dependencies and zero external server requirements. The compiled Rust WebAssembly binary (`open_velo_core.wasm`) is automatically embedded directly into the SDK package so any frontend or application layer can install `open-velo-core` and attach to real-time telemetry and lifecycle hooks.

---

## Key Capabilities

1. **Wire Protocol Codecs & Rollover Math (`rust/protocol.rs`)**
   - **ANT+ USB (`0xA4`)**: XOR frame checksum verification, 8-bit/16-bit rollover-safe counter deltas, inbound decoding for FE-C (`0x19` Stationary Bike, `0x10` General FE), Cycling Power (`0x10`), and Heart Rate (`0x04`).
   - **Smart Trainer Control**: Outbound frame encoding for ANT+ FE-C Page 48 (Basic Resistance), Page 49 (ERG Target Power), and Page 51 (Track Grade / Slope), plus BLE FTMS (`0x2AD9`) control opcodes.
2. **Physiological Modeling & Rolling Power Windows (`rust/physiology.rs` & `rust/session.rs`)**
   - Time-windowed sub-second rolling power averages (`3s`, `10s`, `30s`) resilient to variable sensor packet rates.
   - Skiba differential $W'\text{bal}$ anaerobic work capacity depletion and exponential recovery integration.
   - Normalized Power (`NP`), Intensity Factor (`IF`), Training Stress Score (`TSS`), Watts/kg, and Work (`kJ`).
3. **Workout Target Compliance (`rust/compliance.rs`)**
   - Real-time interval power (`±5%` target window) and cadence (`±5 RPM` target window) compliance scoring (`0..100%`).
   - Interval completion summaries (`IntervalCompletionSummary`) reporting power compliance, cadence compliance, weighted overall compliance, average power, target power, and segment duration.
4. **Pluggable Backend Lifecycle Hooks (`VeloCoreBackendHook`)**
   - Register custom hooks via `veloCoreEngine.registerHook(hook)` to run external application logic on `onTick`, `onIntervalComplete`, `onRideStateChange`, and `onSessionReset` without coupling application state into the core telemetry engine.
5. **Strava & Garmin Connect `.FIT` / `.TCX` Activity Export (`rust/fit.rs`)**
   - Binary Garmin `.FIT` encoder writing `file_id`, `device_info`, `event` (Timer Start/Stop), `record`, `lap`, `session`, and `activity` messages with verified 14-byte header and 2-byte trailing CRC-16 checksums.
   - Universal workout parser/serializer supporting `.txt` libraries, Zwift `.zwo`, `.erg`, `.mrc`, and Garmin `.tcx`.

---

## Repository Structure

```text
open-velo-core/
├── Cargo.toml                 # Top-level Rust crate (name = "open-velo-core")
├── rust/                      # Modular Rust source code compiled to WebAssembly
│   ├── lib.rs                 # WASM FFI exports & shared linear memory buffers
│   ├── protocol.rs            # ANT+ & BLE frame codecs, checksums & rollover math
│   ├── controller.rs          # OpenBikeControl / Zwift Click decoder & virtual gear math
│   ├── physiology.rs          # Skiba W'bal & time-windowed 3s/10s/30s power smoothing
│   ├── compliance.rs          # Structured workout power & cadence compliance evaluation
│   ├── session.rs             # Stateful 1Hz & sub-second ride session state machine
│   └── fit.rs                 # Binary Garmin .FIT activity encoder & CRC-16
├── src/                       # Headless TypeScript SDK (framework-agnostic)
│   ├── index.ts               # Public package entrypoint & barrel exports
│   ├── VeloCoreEngine.ts      # Stateful pub/sub engine, lifecycle hooks & WebUSB driver
│   ├── types.ts               # Telemetry, workout, and backend hook TypeScript interfaces
│   ├── workouts.ts            # .txt workout/profile persistence & .ZWO/.ERG/.MRC/.TCX codecs
│   └── wasm/
│       ├── wasmBinary.ts      # Zero-copy WebAssembly runtime wrapper
│       └── embeddedWasm.ts    # Auto-generated Base64-embedded open_velo_core.wasm binary
├── scripts/
│   └── embed-wasm.mjs         # Embeds compiled WASM into src/wasm/embeddedWasm.ts
├── public/
│   ├── workouts.txt           # Default human-editable workout library fixture
│   └── rider-profile.txt      # Default rider FTP & mass (kg) fixture
└── tests/
    └── wasm-engine.test.ts    # End-to-end Node + WASM integration test suite
```

---

## Installing & Using `open-velo-core`

### 1. Link the Package

In your frontend repository's `package.json`:

```json
{
  "dependencies": {
    "open-velo-core": "file:../open-velo-core"
  }
}
```

### 2. Subscribe to Telemetry & Register Backend Hooks

```ts
import {
  veloCoreEngine,
  BUILTIN_WORKOUTS,
  type TelemetrySnapshot,
  type IntervalCompletionSummary,
} from 'open-velo-core';

// 1. Initialize the embedded Rust/WASM runtime and 1Hz session clock
await veloCoreEngine.start();

// 2. Load a workout and configure rider profile
veloCoreEngine.selectWorkout(BUILTIN_WORKOUTS[0]);
veloCoreEngine.setFtpWatts(280);
veloCoreEngine.setRiderWeightKg(72);

// 3. Subscribe to real-time telemetry snapshots
const unsubscribeTelemetry = veloCoreEngine.subscribeTelemetry((snap: TelemetrySnapshot) => {
  console.log({
    instantWatts: snap.instantPowerWatts,
    power3sWatts: snap.power3sWatts,
    targetWatts: snap.targetPowerWatts,
    intervalProgress01: snap.intervalProgress01,
    compliancePct: snap.intervalCompliancePct,
    wBalPct: snap.wPrimeBalancePct,
  });
});

// 4. Attach custom application logic via pluggable Backend Hooks
const unregisterHook = veloCoreEngine.registerHook({
  id: 'custom-analytics-hook',
  onTick: (snap: TelemetrySnapshot) => {
    // Invoked every 1Hz tick while the ride clock is active
  },
  onIntervalComplete: (summary: IntervalCompletionSummary) => {
    console.log(
      `Interval #${summary.intervalIndex + 1} (${summary.segmentName}) | ` +
        `Compliance: ${summary.overallCompliancePct}% | ` +
        `Avg Power: ${summary.averagePowerWatts}W / ${summary.targetPowerWatts}W`
    );
  },
  onRideStateChange: (isRiding: boolean) => {
    console.log(`Ride active: ${isRiding}`);
  },
  onControllerInput: (event) => {
    // Intercept handlebar controller buttons (e.g. OpenBikeControl / Zwift Play)
    if (event.control === 'BUTTON_A' && event.state === 'PRESSED') {
      return { preventDefault: true };
    }
  },
  onSessionReset: () => {
    console.log('Session reset');
  },
});

// 5. Pair a physical USB ANT+ dongle (WebUSB) and control the smart trainer
await veloCoreEngine.connectWebUsbAntDongle();
veloCoreEngine.setTrainerControlMode('ERG');
```

### 3. Public SDK API Summary (`src/index.ts`)

| Category | Methods / Exports |
| :--- | :--- |
| **Lifecycle & Hooks** | `veloCoreEngine.start()`, `stop()`, `registerHook(hook)`, `subscribeTelemetry(cb)`, `subscribeIntervalCompletions(cb)`, `subscribeDevices(cb)`, `subscribeFrames(cb)` |
| **Ride & Workout Controls** | `toggleRidePause()`, `resetSession()`, `skipToSegment(idx)`, `selectWorkout(workout)`, `getActiveWorkout()` |
| **Smart Trainer Control** | `setTrainerControlMode('ERG' \| 'SLOPE' \| 'RESISTANCE')`, `setManualErgWatts(w)`, `setSlopeGradePct(pct)`, `setTargetResistancePct(pct)`, `setIntensityBiasPct(pct)`, `setVirtualGear(1..24)` |
| **Handlebar Controllers (OpenBikeControl)** | `ingestControllerEvent(evt)`, `ingestBleControllerNotification(id, bytes, model)`, `subscribeControllerEvents(cb)` |
| **Rider Profile** | `setFtpWatts(w)`, `setRiderWeightKg(kg)`, `loadRiderProfileFromTxtFile()`, `saveRiderProfileToTxtFile(profile)` |
| **Workouts & Activity Export** | `BUILTIN_WORKOUTS`, `parseUniversalWorkout(text, ftp)`, `loadWorkoutsFromTxtFile(ftp)`, `saveWorkoutsToTxtFile(list)`, `encodeTelemetryToFitBinary(history)`, `encodeTelemetryToTcxXml(title, history)` |
| **Hardware & Debug** | `connectWebUsbAntDongle()`, `updateSyntheticConfig(patch)`, `injectCustomHexFrame(hex, protocol)` |

---

## Development, Building & Testing

### Prerequisites

- **Node.js** 20+ and **npm**
- **Rust Toolchain** (`rustup`, `cargo`) with the `wasm32-unknown-unknown` target installed:
  ```bash
  rustup target add wasm32-unknown-unknown
  ```

### Scripts

```bash
# Install dependencies
npm install

# Compile Rust to WebAssembly and embed into src/wasm/embeddedWasm.ts
npm run build:wasm

# Run all 9 Rust unit tests + WASM build + 7 TypeScript/WASM integration tests
npm test

# Type-check TypeScript sources
npm run lint

# Build WASM + verify TypeScript compilation
npm run build
```

---

## Current Limitations

- **Bluetooth Low Energy (BLE) Hardware Not Supported Yet**: While `rust/protocol.rs` includes packet decoders and encoders for BLE FTMS (`0x1826`), Cycling Power (`0x1818`), and Heart Rate (`0x180D`), end-to-end physical Bluetooth hardware pairing via Web Bluetooth is not yet supported. Physical sensor/trainer pairing currently targets **USB ANT+ sticks** (Garmin / Dynastream `0x0FCF:0x1008` / `0x1009`).
- **Browser WebUSB Requirements**: Direct USB ANT+ access requires a Chromium-based browser (Chrome, Edge, Brave) supporting the WebUSB API. On Linux, udev rules granting user read/write access to USB vendor `0x0fcf` are required.
- **Single-Lap `.FIT` Summaries**: Activity exports currently emit a single continuous session/lap summary per exported `.FIT` file rather than splitting each workout interval into separate `.FIT` lap messages.

---

## Roadmap

- [ ] **Bluetooth Low Energy (BLE) Hardware Support**: Complete end-to-end Web Bluetooth pairing, GATT notification subscriptions, and FTMS (`0x2AD9`) smart trainer control for BLE-only trainers, power meters, and heart rate monitors.
- [ ] **Multi-Lap `.FIT` Interval Markers**: Automatically emit `.FIT` `lap` messages on interval transitions so Strava and Garmin Connect display per-interval splits.
- [ ] **Heart Rate Zone & Cadence Target Compliance**: Expand interval definitions to support optional target cadence and heart rate caps in compliance evaluation.
- [ ] **Expanded Hook Middleware**: Add pre-command trainer hooks and custom sensor stream filters.
