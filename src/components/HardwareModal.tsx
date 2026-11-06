import React, { useState } from 'react';
import {
  ConnectedSensorDevice,
  SyntheticGeneratorConfig,
} from '../sdk/types';

interface HardwareModalProps {
  isOpen: boolean;
  onClose: () => void;
  devices: ConnectedSensorDevice[];
  synthConfig: SyntheticGeneratorConfig;
  onUpdateSynth: (patch: Partial<SyntheticGeneratorConfig>) => void;
  onConnectAntUsb: () => Promise<{ ok: boolean; message: string }>;
  onConnectBle: (
    role: 'FTMS' | 'CPS' | 'HRM' | 'CSCS'
  ) => Promise<{ ok: boolean; message: string }>;
}

export const HardwareModal: React.FC<HardwareModalProps> = ({
  isOpen,
  onClose,
  devices,
  synthConfig,
  onUpdateSynth,
  onConnectAntUsb,
  onConnectBle,
}) => {
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [isPairing, setIsPairing] = useState(false);

  if (!isOpen) return null;

  const handleUsbPair = async () => {
    setIsPairing(true);
    setStatusMessage('Requesting WebUSB ANT+ Stick (Vendor ID 0x0FCF)...');
    const res = await onConnectAntUsb();
    setStatusMessage(res.message);
    setIsPairing(false);
  };

  const handleBlePair = async (role: 'FTMS' | 'CPS' | 'HRM' | 'CSCS') => {
    setIsPairing(true);
    setStatusMessage(`Requesting WebBluetooth ${role} GATT service...`);
    const res = await onConnectBle(role);
    setStatusMessage(res.message);
    setIsPairing(false);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="hw-modal-title"
    >
      <div className="w-full max-w-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 rounded-lg p-6 space-y-5 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between gap-4 pb-3 border-b border-slate-200 dark:border-slate-800">
          <div>
            <h2
              id="hw-modal-title"
              className="text-base font-semibold text-slate-900 dark:text-slate-100"
            >
              Hardware Transports &amp; Synthetic Wire Generator
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Pair a physical USB ANT+ dongle (Garmin/Dynastream 0x0FCF) or Bluetooth Low Energy GATT sensors, or calibrate the byte-accurate synthetic wire generator.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 text-xs font-medium rounded-md border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0"
          >
            Close
          </button>
        </div>

        {/* Physical WebUSB & WebBluetooth Pairing Actions */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="border border-slate-200 dark:border-slate-800 rounded-md p-4 space-y-3">
            <div>
              <h3 className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                WebUSB ANT+ Stick Driver (Bulk EP 0x81 / 0x01)
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                Initializes ANT+ Network Key (0x46) on 2457 MHz and opens channels for FE-C (17), Power (11), HRM (120), and Speed/Cadence (121).
              </p>
            </div>
            <button
              type="button"
              disabled={isPairing}
              onClick={handleUsbPair}
              className="w-full px-4 py-2 text-xs font-medium text-white bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 rounded-md transition-colors whitespace-nowrap"
            >
              Pair USB ANT+ Dongle (WebUSB)
            </button>
            <div className="text-[11px] text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-950/70 p-2.5 rounded border border-slate-200 dark:border-slate-800 space-y-1">
              <span className="font-semibold text-slate-700 dark:text-slate-300 block">
                Seeing &quot;Access Denied&quot; when opening the USB stick?
              </span>
              <p>
                <strong>Windows:</strong> Download <a href="https://zadig.akeo.ie/" target="_blank" rel="noreferrer" className="text-cyan-600 dark:text-cyan-400 underline">Zadig</a>, select your ANT+ USB Stick, and change driver to <strong>WinUSB</strong>.
              </p>
              <p>
                <strong>macOS:</strong> Quit Garmin Express or Zwift if open so they release exclusive hardware lock.
              </p>
              <p>
                <strong>Linux:</strong> Grant permissions via udev (<code className="font-mono">SUBSYSTEM==&quot;usb&quot;, ATTR&#123;idVendor&#125;==&quot;0fcf&quot;, MODE=&quot;0666&quot;</code>).
              </p>
            </div>
          </div>

          <div className="border border-slate-200 dark:border-slate-800 rounded-md p-4 space-y-3">
            <div>
              <h3 className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                WebBluetooth Low Energy GATT Sensors
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                Subscribes to GATT characteristic notifications and binds FTMS Control Point (0x2AD9) for low-latency ERG/Slope commands.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                disabled={isPairing}
                onClick={() => handleBlePair('FTMS')}
                className="px-3 py-1.5 text-xs font-medium border border-slate-300 dark:border-slate-700 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-200 transition-colors whitespace-nowrap truncate"
              >
                Pair FTMS Trainer
              </button>
              <button
                type="button"
                disabled={isPairing}
                onClick={() => handleBlePair('CPS')}
                className="px-3 py-1.5 text-xs font-medium border border-slate-300 dark:border-slate-700 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-200 transition-colors whitespace-nowrap truncate"
              >
                Pair BLE Power
              </button>
              <button
                type="button"
                disabled={isPairing}
                onClick={() => handleBlePair('HRM')}
                className="px-3 py-1.5 text-xs font-medium border border-slate-300 dark:border-slate-700 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-200 transition-colors whitespace-nowrap truncate"
              >
                Pair BLE Heart Rate
              </button>
              <button
                type="button"
                disabled={isPairing}
                onClick={() => handleBlePair('CSCS')}
                className="px-3 py-1.5 text-xs font-medium border border-slate-300 dark:border-slate-700 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-200 transition-colors whitespace-nowrap truncate"
              >
                Pair Speed/Cadence
              </button>
            </div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-950/70 p-2.5 rounded border border-slate-200 dark:border-slate-800 space-y-1">
              <span className="font-semibold text-slate-700 dark:text-slate-300 block">
                WebBluetooth blocked by iframe Permissions Policy?
              </span>
              <p>
                Browsers restrict <code className="font-mono">navigator.bluetooth</code> inside embedded iframes. Open the app directly in its own top-level browser tab using the standalone app URL to allow Chrome to prompt for Bluetooth devices.
              </p>
            </div>
          </div>
        </div>

        {statusMessage && (
          <div className="px-3 py-2 text-xs font-mono border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 rounded text-slate-700 dark:text-slate-300">
            {statusMessage}
          </div>
        )}

        {/* Active Sensor Channel Roster */}
        <div className="space-y-2">
          <h3 className="text-xs font-semibold text-slate-900 dark:text-slate-100">
            Active Sensor &amp; Channel Roster
          </h3>
          <div className="border border-slate-200 dark:border-slate-800 rounded-md divide-y divide-slate-200 dark:divide-slate-800 text-xs">
            {devices.map((dev) => (
              <div
                key={dev.id}
                className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5"
              >
                <div className="min-w-0">
                  <div className="font-medium text-slate-900 dark:text-slate-100 truncate">
                    {dev.name}
                  </div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                    {dev.channelOrUuid} · {dev.rssiOrEndpoint}
                  </div>
                </div>
                <div className="flex items-center gap-3 font-mono tabular-nums text-xs shrink-0">
                  <span className="text-slate-600 dark:text-slate-400">
                    {dev.packetCount} pkts
                  </span>
                  <span aria-hidden="true">·</span>
                  <span
                    className={
                      dev.status === 'CONNECTED'
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : 'text-cyan-600 dark:text-cyan-400'
                    }
                  >
                    {dev.status === 'CONNECTED' ? '● Live Hardware' : '● Synthetic Wire'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Synthetic ANT+ & BLE Wire Packet Generator Controls */}
        <div className="border border-slate-200 dark:border-slate-800 rounded-md p-4 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                Synthetic ANT+ &amp; BLE Wire Packet Generator
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Emits genuine binary ANT+ (0xA4 broadcast) and BLE GATT frames directly into the Rust WASM linear memory buffer.
              </p>
            </div>
            <button
              type="button"
              onClick={() => onUpdateSynth({ enabled: !synthConfig.enabled })}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                synthConfig.enabled
                  ? 'bg-emerald-600 text-white hover:bg-emerald-500'
                  : 'bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300'
              }`}
            >
              {synthConfig.enabled ? 'Generator Active' : 'Generator Paused'}
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-1">
            <div>
              <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1.5">
                Packet Broadcast Rate
              </label>
              <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 p-1 rounded">
                {([4, 8, 16] as const).map((hz) => (
                  <button
                    key={hz}
                    type="button"
                    onClick={() => onUpdateSynth({ frequencyHz: hz })}
                    className={`flex-1 py-1 text-xs font-mono font-medium rounded transition-colors ${
                      synthConfig.frequencyHz === hz
                        ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                        : 'text-slate-600 dark:text-slate-400'
                    }`}
                  >
                    {hz} Hz
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1.5">
                Wire Protocol Mix
              </label>
              <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 p-1 rounded">
                {(
                  [
                    ['BOTH', 'ANT+ & BLE'],
                    ['ANT_ONLY', 'ANT+ Only'],
                    ['BLE_ONLY', 'BLE Only'],
                  ] as const
                ).map(([val, label]) => (
                  <button
                    key={val}
                    type="button"
                    onClick={() => onUpdateSynth({ protocolMix: val })}
                    className={`flex-1 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap ${
                      synthConfig.protocolMix === val
                        ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                        : 'text-slate-600 dark:text-slate-400'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1.5">
                RF CRC Corruption Stress ({synthConfig.injectPacketCorruptionPct}%)
              </label>
              <input
                type="range"
                min={0}
                max={15}
                step={1}
                value={synthConfig.injectPacketCorruptionPct}
                onChange={(e) =>
                  onUpdateSynth({
                    injectPacketCorruptionPct: Number(e.target.value),
                  })
                }
                className="w-full accent-cyan-500"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
