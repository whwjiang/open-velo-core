import React, { useState } from 'react';

const RUST_SOURCE_SNIPPET = `//! VeloCore Core Engine (velocore-core/src/lib.rs)
//! Compiles via: cargo build --manifest-path velocore-core/Cargo.toml --target wasm32-unknown-unknown --release

pub mod fit;
pub mod game;
pub mod physiology;
pub mod protocol;
pub mod session;

static mut INBOUND_FRAME_BUF: [u8; 64] = [0u8; 64];
static mut OUTBOUND_FRAME_BUF: [u8; 16] = [0u8; 16];

#[no_mangle]
pub extern "C" fn ant_verify_checksum(ptr: *const u8, len: usize) -> u32 {
    if len < 4 { return 0; }
    let slice = unsafe { core::slice::from_raw_parts(ptr, len) };
    if slice[0] != 0xA4 { return 0; }
    let mut xor_acc: u8 = 0;
    let mut i = 0;
    while i < len - 1 {
        xor_acc ^= slice[i];
        i += 1;
    }
    if xor_acc == slice[len - 1] { 1 } else { 0 }
}

/// Rollover-safe 16-bit unsigned counter delta: (current - previous) & 0xFFFF
#[no_mangle]
pub extern "C" fn u16_rollover_delta(current: u32, previous: u32) -> u32 {
    (current.wrapping_sub(previous)) & 0xFFFF
}

/// Encodes an ANT+ FE-C Data Page 49 (0x31) Target Power (ERG Mode) 13-byte USB frame
#[no_mangle]
pub extern "C" fn encode_ant_fec_erg(channel: u8, target_watts: u32) -> usize {
    let raw_units = (target_watts.saturating_mul(4)).min(16000) as u16;
    let frame: [u8; 12] = [
        0xA4, 0x09, 0x4F, channel,
        0x31, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF,
        (raw_units & 0xFF) as u8,
        ((raw_units >> 8) & 0xFF) as u8,
    ];
    let mut crc: u8 = 0;
    for i in 0..12 {
        crc ^= frame[i];
        unsafe { OUTBOUND_FRAME_BUF[i] = frame[i]; }
    }
    unsafe { OUTBOUND_FRAME_BUF[12] = crc; }
    13
}`;

const HEADLESS_HOOK_SNIPPET = `import { veloCoreEngine } from './sdk/VeloCoreEngine';

// 1. Initialize the compiled WebAssembly telemetry core
await veloCoreEngine.start();

// 2. Pair a physical USB ANT+ stick (Garmin/Dynastream 0x0FCF) or BLE FTMS trainer
await veloCoreEngine.connectWebUsbAntDongle();
await veloCoreEngine.connectWebBluetoothSensor('FTMS');

// 3. Subscribe from ANY frontend (React, Svelte, Vue, Three.js WebGL loop)
const unsubscribe = veloCoreEngine.subscribeTelemetry((snap) => {
  console.log(\`Power (3s): \${snap.power3sWatts}W | Cadence: \${snap.cadenceRpm} RPM | HR: \${snap.heartRateBpm} BPM\`);
});

// 4. Command bidirectional Smart Trainer targets (encodes ANT+ FE-C Page 48/49/51 & BLE 0x2AD9)
veloCoreEngine.setTrainerControlMode('ERG');
veloCoreEngine.setManualErgWatts(285);`;

export const RustSdkView: React.FC = () => {
  const [copiedTab, setCopiedTab] = useState<'RUST' | 'TS' | null>(null);

  const handleCopy = (code: string, tab: 'RUST' | 'TS') => {
    navigator.clipboard?.writeText(code);
    setCopiedTab(tab);
    window.setTimeout(() => setCopiedTab(null), 1800);
  };

  const handleDownloadRust = () => {
    const blob = new Blob([RUST_SOURCE_SNIPPET], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'lib.rs';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <div className="border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 rounded-lg p-5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              Decoupled Rust-to-WASM Architecture &amp; Headless Frontend Bridge
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Zero-copy linear memory architecture located in <code className="font-mono">velocore-core/src/</code>. Designed to hook into any UI or 3D engine without modifying sensor or trainer protocol logic.
            </p>
          </div>
          <button
            type="button"
            onClick={handleDownloadRust}
            className="px-3.5 py-2 text-xs font-medium bg-cyan-600 hover:bg-cyan-500 text-white rounded-md transition-colors whitespace-nowrap shrink-0"
          >
            Download Rust Crate (lib.rs)
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2 text-xs">
          <div className="border border-slate-200 dark:border-slate-800 rounded-md p-3.5 space-y-1">
            <div className="font-semibold text-slate-900 dark:text-slate-100">
              1. Zero-Copy Linear Memory
            </div>
            <p className="text-slate-600 dark:text-slate-400 leading-relaxed">
              Raw USB bulk packets and BLE GATT DataViews are written directly into exported WebAssembly linear memory offsets (<code className="font-mono">0x0040</code> inbound, <code className="font-mono">0x0100</code> outbound) to eliminate GC pauses.
            </p>
          </div>
          <div className="border border-slate-200 dark:border-slate-800 rounded-md p-3.5 space-y-1">
            <div className="font-semibold text-slate-900 dark:text-slate-100">
              2. Rollover-Safe Counter Math
            </div>
            <p className="text-slate-600 dark:text-slate-400 leading-relaxed">
              ANT+ Page 25 accumulated power and BLE Cycling Power <code className="font-mono">0x2A63</code> 16-bit crank revolution counters wrap around at <code className="font-mono">65535</code>. WASM <code className="font-mono">i32.sub + i32.and</code> prevents cadence/wattage spikes.
            </p>
          </div>
          <div className="border border-slate-200 dark:border-slate-800 rounded-md p-3.5 space-y-1">
            <div className="font-semibold text-slate-900 dark:text-slate-100">
              3. Bidirectional Trainer Control
            </div>
            <p className="text-slate-600 dark:text-slate-400 leading-relaxed">
              Encodes both ANT+ FE-C Data Pages 48 (Resistance), 49 (ERG Target Power), and 51 (Track Grade) with valid XOR CRC bytes and BLE FTMS <code className="font-mono">0x2AD9</code> control point opcodes.
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-stretch">
        {/* Rust Source Code Panel */}
        <div className="border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 rounded-lg p-4 flex flex-col justify-between space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h3 className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                Rust WebAssembly Core (velocore-core/src/)
              </h3>
            </div>
            <button
              type="button"
              onClick={() => handleCopy(RUST_SOURCE_SNIPPET, 'RUST')}
              className="px-2.5 py-1 text-xs font-medium border border-slate-300 dark:border-slate-700 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 transition-colors whitespace-nowrap shrink-0"
            >
              {copiedTab === 'RUST' ? 'Copied' : 'Copy Rust Source'}
            </button>
          </div>
          <pre className="p-3 bg-slate-950 text-slate-200 rounded-md text-[11px] font-mono overflow-x-auto leading-relaxed flex-1">
            {RUST_SOURCE_SNIPPET}
          </pre>
        </div>

        {/* Framework-Agnostic Frontend Hook Panel */}
        <div className="border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 rounded-lg p-4 flex flex-col justify-between space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h3 className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                Headless SDK Integration (Hook into Any Frontend)
              </h3>
            </div>
            <button
              type="button"
              onClick={() => handleCopy(HEADLESS_HOOK_SNIPPET, 'TS')}
              className="px-2.5 py-1 text-xs font-medium border border-slate-300 dark:border-slate-700 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 transition-colors whitespace-nowrap shrink-0"
            >
              {copiedTab === 'TS' ? 'Copied' : 'Copy SDK Example'}
            </button>
          </div>
          <pre className="p-3 bg-slate-950 text-slate-200 rounded-md text-[11px] font-mono overflow-x-auto leading-relaxed flex-1">
            {HEADLESS_HOOK_SNIPPET}
          </pre>
        </div>
      </div>
    </div>
  );
};
