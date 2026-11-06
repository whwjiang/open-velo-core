# VeloCore WASM — Low-Latency ANT+ & BLE Cycling Training Engine

A browser-native structured cycling training platform and hardware protocol workbench powered by a Rust-to-WebAssembly telemetry engine. It decodes real-time ANT+ (via WebUSB dongles) and Bluetooth Low Energy (via WebBluetooth) packets with sub-millisecond latency while providing full bidirectional smart trainer control (ERG, Slope, and Resistance modes) and a framework-agnostic telemetry bridge.

---

## User Review & Critical Decisions

> [!IMPORTANT]
> The following architectural and product choices have been locked in based on your feedback:

- **Primary Interface Experience**: **Structured Workout Dashboard + Protocol Inspector** — A TrainerRoad-caliber interval training cockpit paired with a real-time binary packet hex analyzer and WASM latency profiler.
- **Bidirectional Trainer Control**: **Full Smart Trainer Control (ERG, Resistance, and Slope/Grade Modes)** — The WASM engine both parses incoming sensor frames and encodes outbound ANT+ FE-C (Page 48, 49, 51) and BLE FTMS (`0x2AD9` Fitness Machine Control Point) command frames.
- **Developer & Verification Suite**: **Synthetic ANT+/BLE Packet Generator, Live Hex & Latency Inspector, and ZWO/FIT Workout Import & Export** — Enables deterministic testing of packet loss, sensor dropouts, and ERG step transitions even when physical dongles or trainers are disconnected.
- **Rust-to-WASM Compilation Pipeline**: We will build a native Rust crate compiled to WebAssembly (`wasm32-unknown-unknown`) directly in the workspace, exposing a zero-copy typed-array boundary that any frontend framework can subscribe to via a clean TypeScript SDK.

---

## 1. Overview & Core Concept

- **What It Does**: VeloCore WASM turns any modern Chromium browser into a high-precision indoor cycling studio and telemetry analyzer. It connects directly to USB ANT+ sticks (Garmin, Suunto, CYCPLUS, Wahoo) via WebUSB and Bluetooth sensors/trainers via WebBluetooth, passing raw byte frames into a compiled Rust WebAssembly core for checksum verification, rollover-safe cumulative counter math, 3s/10s/30s power smoothing, W'bal anaerobic depletion modeling, and closed-loop smart trainer target control.
- **Target Audience / Persona**: Performance-focused cyclists wanting a lightweight, ultra-responsive browser training cockpit, and sports-tech engineers who want a decoupled Rust WASM sensor engine with deep visibility into raw ANT+ and BLE wire frames.
- **Key Value**: Eliminates JavaScript garbage-collection jitter and counter-rollover bugs during high-frequency (4Hz–8Hz) multi-sensor ingestion while keeping the core protocol engine portable across any UI layer.

---

## 2. User Experience & Visual Design

### Key User Flows

1. **Hardware Pairing & Synthetic Stream Setup**:
   - The athlete or engineer opens the **Hardware & Transports Drawer** to pair a physical **WebUSB ANT+ Dongle** (Vendor IDs `0x0FCF` Dynastream/Garmin) or individual **WebBluetooth Sensors** (Heart Rate `0x180D`, Cycling Power `0x1818`, Speed & Cadence `0x1816`, and Fitness Machine FTMS `0x1826`).
   - For hardware-free benchmarking or interval testing, the user can toggle the **Synthetic Hardware Generator**, configuring simulated rider FTP, cadence noise, heart rate physiological lag, and packet drop rate (`4Hz` to `16Hz`).
2. **Workout Selection or Custom `.ZWO` / `.FIT` Import**:
   - Users select from curated structured workouts (e.g., *Over-Under Threshold 4x8*, *VO2max Microbursts 30/15*, *Sweet Spot Progression*) or drop a `.zwo` / `.fit` workout file directly into the parser.
   - Workout intervals automatically scale to the user's configured Functional Threshold Power (FTP) and display time-in-zone distribution, Intensity Factor (IF), and Training Stress Score (TSS).
3. **Live Ride & Bidirectional Smart Trainer Control**:
   - During an active session, the central **Structured Interval Canvas** renders the stepped target power profile overlaid with live smoothed power (`1s`, `3s`, `30s`), heart rate, cadence, speed, and anaerobic `W'bal` reserve.
   - When an interval step changes in **ERG Mode**, the Rust WASM engine automatically encodes the new target wattage into an ANT+ FE-C Data Page 49 (`0x31`) and BLE FTMS Set Target Power (`0x05`) payload and dispatches it to the trainer.
   - Users can switch on the fly between **ERG Mode** (wattage lock + intensity bias `±1%` to `±10%`), **Resistance Mode** (`0%–100%` brake load), and **Slope / Simulation Mode** (`-10%` to `+20%` grade with customizable rider weight and Crr/CdA).
4. **Protocol Hex Inspector & Session Export**:
   - The dockable **WASM Protocol Workbench** displays a live scrolling ring-buffer of raw incoming and outgoing ANT+ and BLE frames in hexadecimal, complete with decoded fields (Sync byte, Message ID, Channel, Data Page, CRC/Checksum status, and WASM decode time in microseconds).
   - Upon finishing or pausing a ride, the user can export the complete telemetry session as a standard `.FIT`-compatible binary/JSON archive or `.TCX` activity log.

### Visual Identity & Theme

- **Aesthetic Direction**: **Precision Telemetry Instrument** — Inspired by TrainerRoad's dark-room legibility and aerospace telemetry consoles. Designed for zero eye strain at 180+ BPM while maintaining razor-sharp engineering clarity.
- **Color Palette & Mood (60-30-10 Discipline)**:
  - **60% Dominant Primary Canvas**: Deep obsidian slate (`#07090E`) in dark mode and clinical lab slate (`#F8FAFC`) in light mode.
  - **30% Structural Surfaces & Hairlines**: Flat instrument panels (`#0F172A` / `#111827`) bounded by crisp 1px borders (`#1E293B`), zero nested card shadows.
  - **10% Calibrated Telemetry Accents**:
    - Primary Power / ERG Target: Telemetry Cyan (`#06B6D4`)
    - Threshold / Over-Target Alert: High-Visibility Amber (`#F59E0B`)
    - Heart Rate / Anaerobic Strain: Crimson Pulse (`#F43F5E`)
    - Cadence / Nominal Link State: Emerald (`#10B981`)
- **Typography & Hierarchy (2+1 Font Rule)**:
  - *Display & Navigation*: `Plus Jakarta Sans` (SemiBold/Bold) for crisp geometric headers and workout titles.
  - *Interface & Labels*: `Plus Jakarta Sans` (Regular/Medium) with clean unboxed metadata separated by middle dots (`·`).
  - *Live Telemetry, Hex Frames & Timestamps*: `JetBrains Mono` with mandatory `font-variant-numeric: tabular-nums` so fluctuating watts, RPM, BPM, and microsecond latency figures never jitter horizontally.
- **Layout Architecture**:
  - **Top Bar Contract (3 Zones)**:
    1. *Brand Zone*: Single-line `VeloCore WASM` wordmark.
    2. *Navigation Zone*: 4 single-line links (`Cockpit`, `Workouts`, `Protocol Lab`, `Session Log`).
    3. *Primary Action Zone*: `Connect Hardware` modal trigger.
  - **Asymmetric Split Console**:
    - *Top Telemetry Ribbon*: High-impact numeric readouts for Instant/3s Power (W & W/kg), Target ERG Power, Heart Rate (BPM), Cadence (RPM), Virtual Speed (km/h), and Workout Elapsed/Interval Remaining timers.
    - *Left Control & Trainer Column (340px)*: Active sensor channel roster, Smart Trainer mode controller (`ERG` / `Slope` / `Resistance`), intensity bias steppers, and Synthetic Generator controls.
    - *Main Viewport Stage (Flex-1)*: Interactive high-DPI workout interval chart + synchronized real-time multi-channel telemetry trace.
    - *Bottom / Dockable Protocol Tray*: Live ANT+ / BLE binary packet table with channel filtering, pause-on-frame inspection, and WASM ring-buffer latency stats.

---

## 3. Key Product Decisions & Trade-Offs

- **Decision 1: Native Rust compiled to WebAssembly (`wasm32-unknown-unknown`) with Zero-Copy Frame Ingestion**
  - *Chosen Approach*: Compile a self-contained Rust telemetry core to `.wasm` and communicate with the browser transport layer via shared linear memory / typed `Uint8Array` views and a compact C-ABI / JS-bridge interface.
  - *Why*: Guarantees deterministic sub-microsecond packet parsing, exact 16-bit/32-bit unsigned integer wrap-around arithmetic (critical for BLE Cycling Power `cumulative_crank_revolutions` and ANT+ event counters), and zero garbage-collection pauses during multi-sensor 4Hz–8Hz bursts.
  - *Alternatives Considered*: Pure TypeScript parsing was rejected because JS number coercion and GC pauses introduce jitter in cumulative wheel/crank delta calculations; heavy third-party bundler plugins were passed over in favor of a clean, reproducible Rust-to-WASM build script and portable ES module loader.

- **Decision 2: Headless Event-Target SDK Decoupled from React UI**
  - *Chosen Approach*: Wrap the WASM core and WebUSB/WebBluetooth hardware transports inside a standalone `VeloCoreEngine` TypeScript class that emits typed telemetry snapshots and accepts trainer control commands independently of React.
  - *Why*: Directly fulfills your requirement that the Rust/WASM backend can hook into *any* frontend (React, Svelte, Vue, Canvas, or Three.js) without rewriting a single line of sensor or workout logic.

- **Decision 3: Dual-Mode Hardware Layer (Real WebUSB/WebBluetooth + Deterministic Synthetic Wire Generator)**
  - *Chosen Approach*: Implement real WebUSB bulk-transfer loops for ANT+ USB sticks and WebBluetooth GATT characteristic notifications for BLE sensors, alongside a byte-accurate synthetic packet generator that feeds the exact same raw ANT+ and BLE byte arrays into the Rust WASM decoder.
  - *Why*: Allows you to test real physical trainers and straps immediately while also stress-testing the Rust WASM parser, checksum validator, and ERG workout state machine when away from your bike.

---

## 4. Technical Architecture & Data Strategy

### Architecture & Component Diagram

```
┌───────────────────────────────────────────────────────────────────────────────────┐
│                           BROWSER HARDWARE TRANSPORTS                             │
│  ┌─────────────────────────┐  ┌─────────────────────────┐  ┌───────────────────┐  │
│  │   WebUSB ANT+ Driver    │  │   WebBluetooth GATT     │  │ Synthetic Wire    │  │
│  │  (Bulk In/Out 0x81/0x01)│  │ (HRM / CPS / CSCS /FTMS)│  │ Packet Generator  │  │
│  └────────────┬────────────┘  └────────────┬────────────┘  └─────────┬─────────┘  │
└───────────────┼────────────────────────────┼─────────────────────────┼────────────┘
                │ Raw ANT+ Frames (Uint8)    │ Raw BLE GATT Payloads   │
                └────────────────────────────┼─────────────────────────┘
                                             ▼
┌───────────────────────────────────────────────────────────────────────────────────┐
│                     RUST -> WEBASSEMBLY TELEMETRY CORE (.wasm)                    │
│  ┌─────────────────────────┐  ┌─────────────────────────┐  ┌───────────────────┐  │
│  │ Binary Frame Decoder    │  │ Stateful Sensor Math    │  │ Outbound Command  │  │
│  │ • ANT+ Sync/XOR Check   │  │ • 16-bit Rollover Delta │  │ Encoder           │  │
│  │ • Page 0x10/0x19/0x31   │  │ • 1s/3s/10s/30s RingBuf │  │ • ANT+ FE-C Pg48/ │  │
│  │ • BLE CPS 0x2A63 / FTMS │  │ • NP, IF, TSS & W'bal   │  │   Pg49/Pg51       │  │
│  │ • BLE HRM 0x2A37 / CSCS │  │ • Virtual Speed Physics │  │ • BLE FTMS 0x2AD9 │  │
│  └────────────┬────────────┘  └────────────┬────────────┘  └─────────┬─────────┘  │
└───────────────┼────────────────────────────┼─────────────────────────┼────────────┘
                │ 60Hz Telemetry Snapshot    │ Decoded Frame Audit     │ Outbound
                ▼                            ▼                         ▼ Bytes
┌───────────────────────────────────────────────────────────────────────────────────┐
│                FRAMEWORK-AGNOSTIC SDK BRIDGE (VeloCoreEngine TS)                  │
│   • Pub/Sub Telemetry Stream   • Workout Clock & ERG Loop   • ZWO/FIT Serializer  │
└───────────────┬────────────────────────────┬─────────────────────────┬────────────┘
                │                            │                         │
                ▼                            ▼                         ▼
┌───────────────────────────┐  ┌──────────────────────────┐  ┌──────────────────────┐
│    TRAINING COCKPIT UI    │  │   WORKOUT STUDIO VIEW    │  │   PROTOCOL LAB UI    │
│ • Live Metric Ribbon      │  │ • Curated Interval Lib   │  │ • Live Hex RingBuffer│
│ • Interval Target Canvas  │  │ • .ZWO & .FIT Importer   │  │ • CRC & Drop Counter │
│ • ERG / Slope / Res Deck  │  │ • FTP & Zone Calibrator  │  │ • WASM µs Profiler   │
└───────────────────────────┘  └──────────────────────────┘  └──────────────────────┘
```

### Data Model & State

1. **Rust WASM Linear Memory State (`EngineState`)**:
   - **Sensor State Accumulators**: Tracks previous `event_count`, `cumulative_crank_revs`, `last_crank_event_time` (in `1/1024s` or `1/2048s` ticks), `cumulative_wheel_revs`, and `last_wheel_event_time` to compute instantaneous cadence and speed without floating-point drift or 16-bit rollover spikes.
   - **Rolling Window Buffers**: Fixed-size circular buffers in Rust memory for `3s`, `10s`, and `30s` rolling power (supporting Coggan Normalized Power® calculation), plus real-time Skiba `W'bal` integral depletion tracking.
   - **Protocol Audit Ring Buffer**: Stores the last 256 raw frames with microsecond decode latency, protocol type (`ANT+` or `BLE`), channel/UUID, message page ID, checksum validity, and human-readable summary.
2. **Workout & Trainer Control State**:
   - **Workout Definition**: Structured array of intervals (`SteadyState`, `Ramp`, `IntervalsT`, `FreeRide`) with duration in seconds, target FTP percentage, and optional cadence targets.
   - **Trainer Control Target**: Active mode (`ERG`, `Resistance`, `Slope`), target wattage (`0W–2000W`), slope grade (`-10.0%` to `+20.0%`), brake percentage (`0%–100%`), and workout intensity bias (`80%–120%`).

### Interactive Component & State Mapping

- **Hardware Pairing Modal (`Connect Hardware`)**:
  - Invokes `navigator.usb.requestDevice` (filtered for ANT+ USB2/USB-m sticks) or `navigator.bluetooth.requestDevice` (filtered for FTMS, Cycling Power, Heart Rate, and CSC services).
  - Handles USB interface claiming, ANT+ network key assignment (`0x46`), channel configuration, and live connection state badges (`Connected`, `Reconnecting`, `Simulated`).
- **Trainer Mode & Bias Controller**:
  - Switching between `ERG`, `Slope`, and `Resistance` immediately invokes the Rust WASM encoder to build the corresponding 8-byte ANT+ FE-C command or BLE FTMS control point packet, pushes it to the active transport, and logs the outbound frame in the Protocol Lab.
- **Workout Player & Interval Scrubber**:
  - Supports `Start`, `Pause`, `Skip Interval`, `Rewind Interval`, and `+5W / -5W` keyboard and click shortcuts.
  - Dynamically recalculates interval targets when the user adjusts their FTP or intensity percentage.
- **Protocol Lab & Hex Inspector**:
  - Live filter by protocol (`All`, `ANT+ USB`, `BLE GATT`, `Outbound FE-C/FTMS`), pause/resume stream inspection, click-to-inspect byte breakdown (highlighting Sync byte, Length, Message ID, Channel, Payload bytes `0..7`, and XOR Checksum), and manual raw hex injection for testing custom packets against the Rust decoder.
