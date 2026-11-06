# Open VeloCore (`open-velo-core`)

**Open VeloCore** is an open-source, local-first indoor cycling telemetry, smart trainer control, and game-ready workout engine built on a modular **Rust / WebAssembly (`velocore-core`)** core and a headless TypeScript SDK.

It is designed both as a standalone indoor training cockpit and as a **plug-and-play backend** for interactive 2D/3D cycling games—specifically targeting an **EarthBound / Stardew Valley–inspired Newspaper Delivery RPG**, where workout intervals map to neighborhood houses and power/cadence compliance determines throw accuracy, delivery tiers, and coin rewards.

---

## Features

- **Rust/WASM Telemetry & Session Core (`velocore-core`)**
  - **Protocol Layer (`protocol.rs`)**: ANT+ USB (`0xA4`) XOR checksum verification, 8-bit/16-bit rollover-safe counter arithmetic, inbound ANT+ FE-C (`0x19` / `0x10`), Cycling Power (`0x10`), and Heart Rate (`0x04`) packet decoding, and outbound ANT+ FE-C control frame encoding (Page 48 Basic Resistance, Page 49 ERG Target Power, Page 51 Track Slope/Grade).
  - **Physiology Layer (`physiology.rs`)**: Sub-second time-windowed rolling power averages (`3s`, `10s`, `30s`), Normalized Power (`NP`), Intensity Factor (`IF`), Training Stress Score (`TSS`), and Skiba differential $W'\text{bal}$ anaerobic reserve modeling.
  - **Game Compliance & Scoring Layer (`game.rs`)**: Real-time interval power (`±5%` bullseye) and cadence (`±5 RPM` bullseye) compliance scoring, delivery tier classification (`Gold / Mailbox`, `Silver / Porch`, `Bronze / Lawn`, `Missed`), and coin/tip payouts.
  - **Activity File Export (`fit.rs`)**: Standards-compliant binary Garmin `.FIT` encoder (including `file_id`, `device_info`, `event`, `record`, `lap`, `session`, `activity`, and header/file CRC-16) and `.TCX` XML export verified for **Strava** and **Garmin Connect**.
- **Headless TypeScript Bridge (`VeloCoreEngine`)**
  - Pub/sub state snapshots (`subscribeTelemetry`) decoupled from the rendering layer so React, Phaser, PixiJS, Three.js, or custom Canvas game loops can subscribe without touching protocol or physiological math.
- **Plain-Text Persistence (`public/*.txt`)**
  - Workouts are loaded from and persisted to `public/workouts.txt` (with `.zwo` / `.erg` / `.mrc` import support).
  - Rider profile metrics (`FTP` and `Weight kg`) are persisted to `public/rider-profile.txt`.
- **Optional Hardware Debug & Synthetic Wire Mode**
  - Clean user-facing experience by default; enable **Debug Mode** in the Hardware modal to inspect raw hex frames in the Packet Sniffer or drive the engine with synthetic 4Hz ANT+ / BLE wire packets.

---

## Repository Structure

```text
open-velo-core/
├── velocore-core/             # Modular Rust crate compiled to WebAssembly
│   ├── Cargo.toml
│   └── src/
│       ├── lib.rs             # WASM FFI exports & shared linear memory buffers
│       ├── protocol.rs        # ANT+ & BLE frame codecs, checksums & rollover math
│       ├── physiology.rs      # Skiba W'bal & time-windowed 3s/10s/30s power smoothing
│       ├── game.rs            # Newspaper Delivery compliance curves, tiers & coin scoring
│       ├── session.rs         # Stateful 1Hz & sub-second ride session state machine
│       └── fit.rs             # Binary Garmin .FIT activity encoder & CRC-16
├── src/
│   ├── wasm/
│   │   └── wasmBinary.ts      # Zero-copy WebAssembly loader & typed runtime wrapper
│   ├── sdk/
│   │   ├── VeloCoreEngine.ts  # Headless pub/sub engine & WebUSB hardware driver
│   │   ├── workouts.ts        # .txt workout/profile parser & .ZWO/.ERG/.MRC/.TCX codecs
│   │   └── types.ts           # Telemetry, workout, and game compliance TypeScript types
│   ├── components/            # React Cockpit, Workout Library, and Hardware modal
│   └── App.tsx
├── public/
│   ├── velocore_core.wasm     # Compiled Rust WebAssembly binary
│   ├── workouts.txt           # Human-editable workout library
│   └── rider-profile.txt      # Persistent rider FTP & mass (kg)
└── tests/
    └── wasm-engine.test.ts    # End-to-end Node + WASM integration test suite
```

---

## Getting Started

### Prerequisites

- **Node.js** 20+ and **npm**
- **Rust Toolchain** (`rustup`, `cargo`) with the `wasm32-unknown-unknown` target installed:
  ```bash
  rustup target add wasm32-unknown-unknown
  ```

### Installation & Development Server

```bash
# Install dependencies
npm install

# Start the local development server on http://localhost:3000
npm run dev
```

### Building the Rust WebAssembly Core & Running Tests

```bash
# Compile velocore-core to public/velocore_core.wasm
npm run build:wasm

# Run Rust unit tests + WASM build + TypeScript/WASM integration tests
npm test

# Type-check TypeScript
npm run lint

# Build production bundle
npm run build
```

---

## Current Limitations

- **Bluetooth Low Energy (BLE) Hardware Not Supported Yet**: While the Rust core (`protocol.rs`) includes packet decoders/encoders for BLE FTMS (`0x1826`), Cycling Power (`0x1818`), and Heart Rate (`0x180D`), end-to-end physical Bluetooth connectivity via Web Bluetooth is not yet supported. Hardware pairing currently targets **USB ANT+ sticks** (Garmin / Dynastream `0x0FCF:0x1008` / `0x1009`).
- **Browser WebUSB Support**: Direct USB ANT+ dongle access requires a Chromium-based browser (Chrome, Edge, Brave) supporting the WebUSB API. On Linux, udev rules granting user read/write permissions to USB vendor `0x0fcf` are required.
- **Single-Lap `.FIT` Summaries**: Activity exports currently record a single continuous session/lap summary per exported `.FIT` file rather than splitting each workout interval into separate `.FIT` lap messages.
- **Local Dev Server Persistence**: Saving new workouts and rider metrics writes directly to `public/workouts.txt` and `public/rider-profile.txt` via the Vite dev server middleware (with `localStorage` fallback when hosted statically).

---

## Roadmap

- [ ] **Bluetooth Low Energy (BLE) Hardware Support**: Complete end-to-end Web Bluetooth pairing, GATT notification subscriptions, and FTMS (`0x2AD9`) smart trainer control for BLE-only trainers, power meters, and heart rate straps.
- [ ] **EarthBound / Stardew Valley Newspaper Delivery Game Frontend**:
  - 2D pixel-art neighborhood canvas subscribing to `veloCoreEngine.subscribeTelemetry()`.
  - Map each workout interval to a house/block along the paper route, using real-time speed (`speedKph`) to scroll the rider down the street.
  - Trigger newspaper throw animations at the end of each interval using `lastCompletedIntervalTier` (`Gold Mailbox`, `Silver Porch`, `Bronze Lawn`, `Broken Window`) and `totalCoinsEarned`.
  - Town hub, bike shop upgrades, and neighborhood route progression unlocked with delivery tips/coins.
- [ ] **Multi-Lap `.FIT` Interval Markers**: Emit a `.FIT` `lap` message automatically at each workout interval transition so Strava and Garmin Connect display per-interval splits alongside game delivery tiers.
- [ ] **Heart Rate Zone & Cadence Target Compliance**: Expand interval definitions in `public/workouts.txt` to include optional target cadence and heart rate caps that factor into game delivery bonuses.
- [ ] **Desktop Packaging (Tauri)**: Package `velocore-core` and the frontend as a native cross-platform desktop app with native USB/BLE permissions out of the box.
