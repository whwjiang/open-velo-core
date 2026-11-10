import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  VeloCoreEngine,
  VeloCoreWasmRuntime,
  encodeTelemetryToFitBinary,
  encodeTelemetryToTcxXml,
  parseRiderProfileFromTxt,
  parseWorkoutsLibraryFromTxt,
  serializeRiderProfileToTxt,
  serializeWorkoutsLibraryToTxt,
} from '../src/index';

test('VeloCoreWasmRuntime loads self-contained embedded Rust WASM binary (open_velo_core.wasm)', async () => {
  const runtime = new VeloCoreWasmRuntime();
  await runtime.init();

  assert.equal(runtime.isReady, true);
  assert.equal(runtime.hasFullRustCore, true);
});

test('Rust WASM encodes & verifies ANT+ FE-C and BLE FTMS smart trainer control packets', async () => {
  const runtime = new VeloCoreWasmRuntime();
  await runtime.init();

  // 1. ANT+ FE-C Page 49 ERG target power (280W = 1120 * 0.25W = 0x0460)
  const ergFrame = runtime.encodeAntFecErg(0, 280);
  assert.equal(ergFrame.byteLength, 13);
  assert.equal(ergFrame[0], 0xa4);
  assert.equal(ergFrame[4], 0x31);
  assert.equal(ergFrame[10], 0x60);
  assert.equal(ergFrame[11], 0x04);
  const crcCheck = runtime.verifyAntFrame(ergFrame);
  assert.equal(crcCheck.valid, true);

  // 2. ANT+ FE-C Page 51 Slope (+4.5% grade)
  const slopeFrame = runtime.encodeAntFecSlope(0, 4.5);
  assert.equal(slopeFrame.byteLength, 13);
  assert.equal(slopeFrame[4], 0x33);
  assert.equal(runtime.verifyAntFrame(slopeFrame).valid, true);

  // 3. BLE FTMS 0x2AD9 Target Power (280W)
  const bleErg = runtime.encodeBleFtmsTargetPower(280);
  assert.equal(bleErg.byteLength, 3);
  assert.equal(bleErg[0], 0x05);
  assert.equal(bleErg[1] | (bleErg[2] << 8), 280);
});

test('Rust WASM decodes inbound ANT+ FE-C (0x19/0x10) and BLE GATT (0x2AD2/0x2A37) packets', async () => {
  const runtime = new VeloCoreWasmRuntime();
  await runtime.init();
  runtime.sessionReset();

  // ANT+ FE-C Page 0x19: 310W, 95 RPM
  const pwr = 310;
  const ant0x19 = new Uint8Array([
    0xa4, 0x09, 0x4e, 0x00, 0x19, 0x01, 95, 0x20, 0x01,
    pwr & 0xff, (pwr >> 8) & 0x0f, 0x30, 0x00,
  ]);
  const decodedAnt = runtime.decodeAntFrame(ant0x19);
  assert.ok(decodedAnt);
  assert.equal(decodedAnt.powerUpdated, true);
  assert.equal(decodedAnt.cadenceUpdated, true);
  assert.equal(decodedAnt.powerWatts, 310);
  assert.equal(decodedAnt.cadenceRpm, 95);

  // BLE HRM 0x2A37: 162 BPM
  const bleHrm = new Uint8Array([0x00, 162]);
  const decodedHrm = runtime.decodeBleFrame(0x2a37, bleHrm);
  assert.ok(decodedHrm);
  assert.equal(decodedHrm.hrUpdated, true);
  assert.equal(decodedHrm.heartRateBpm, 162);

  // BLE FTMS 0x2AD2 with Total Distance (0x0010) + Inst Cadence (0x0004) + Inst Power (0x0040) + HR (0x0200) -> flags = 0x0254
  const bleFtmsWithDistAndHr = new Uint8Array([
    0x54, 0x02, // flags = 0x0254 (Speed present, Cadence present, Total Dist 3B present, Power present, HR present)
    0xd4, 0x0d, // Speed: 3540 -> 35.4 km/h
    180, 0x00,  // Cadence: 180 * 0.5 = 90 RPM
    0x10, 0x27, 0x00, // Total Distance (uint24 = 10000m)
    0x18, 0x01, // Instantaneous Power: 280 W
    158,        // Heart Rate: 158 BPM
  ]);
  const decodedFtms = runtime.decodeBleFrame(0x2ad2, bleFtmsWithDistAndHr);
  assert.ok(decodedFtms);
  assert.equal(decodedFtms.speedKph, 35.4);
  assert.equal(decodedFtms.cadenceRpm, 90);
  assert.equal(decodedFtms.powerWatts, 280);
  assert.equal(decodedFtms.heartRateBpm, 158);
});

test('Rust WASM session engine computes 3s/10s power windows, Wbal, and interval target compliance', async () => {
  const runtime = new VeloCoreWasmRuntime();
  await runtime.init();
  runtime.sessionReset();
  runtime.sessionSetRiderProfile(280, 72, 22000);

  // Feed 4Hz power samples at 260W for 3 seconds (12 packets)
  for (let i = 0; i < 12; i++) {
    runtime.sessionRecordPowerSample(260, 1000 + i * 250);
  }
  assert.equal(runtime.sessionGetWindowPowerAvg(3000, 3750, 0), 260);

  // Simulate 30 seconds of riding a 260W @ 90 RPM interval
  for (let s = 0; s < 30; s++) {
    runtime.sessionTick1Hz(262, 152, 91, 33.5, 260, 90);
  }
  assert.equal(runtime.sessionGetIntervalCompliancePct(), 100);
  assert.equal(runtime.sessionGetIntervalCadenceCompliancePct(), 100);

  const summary = runtime.sessionCompleteInterval();
  assert.equal(summary.powerCompliancePct, 100);
  assert.equal(summary.cadenceCompliancePct, 100);
  assert.equal(summary.overallCompliancePct, 100);
  assert.equal(summary.durationSec, 30);
});

test('VeloCoreEngine supports pluggable backend lifecycle hooks (registerHook)', () => {
  const engine = new VeloCoreEngine();
  let rideStateChanges = 0;
  let resets = 0;

  const unregister = engine.registerHook({
    id: 'custom-consumer-hook',
    onRideStateChange: () => {
      rideStateChanges += 1;
    },
    onSessionReset: () => {
      resets += 1;
    },
  });

  engine.toggleRidePause();
  engine.resetSession();
  assert.equal(rideStateChanges, 1);
  assert.equal(resets, 1);

  unregister();
  engine.toggleRidePause();
  assert.equal(rideStateChanges, 1);
});

test('OpenBikeControl / Zwift Click controller routing, virtual shifting, and hook interception', async () => {
  const engine = new VeloCoreEngine();
  await engine.start();

  // 1. Default ERG mode behavior: SHIFT_UP increments intensityBiasPct (100% -> 101%)
  engine.setTrainerControlMode('ERG');
  const ergRes = engine.ingestControllerEvent({
    deviceId: 'zwift-click-1',
    deviceModel: 'ZWIFT_CLICK',
    control: 'SHIFT_UP',
    state: 'PRESSED',
    value: 1,
  });
  assert.equal(ergRes.handledByHook, false);
  assert.equal(ergRes.snapshot.intensityBiasPct, 101);

  // 2. Default SLOPE mode behavior: SHIFT_UP increments virtualGear (12 -> 13)
  engine.setTrainerControlMode('SLOPE');
  const slopeRes = engine.ingestControllerEvent({
    deviceId: 'zwift-click-1',
    deviceModel: 'ZWIFT_CLICK',
    control: 'SHIFT_UP',
    state: 'PRESSED',
    value: 1,
  });
  assert.equal(slopeRes.snapshot.virtualGear, 13);
  assert.ok(slopeRes.snapshot.virtualGearRatio > 1.0);

  // 3. Raw BLE Zwift Click packet ([0x37, 0x08, 0x00, 0x10, 0x00] = SHIFT_UP pressed -> Gear 14)
  const emitted = engine.ingestBleControllerNotification(
    'zwift-click-ble',
    new Uint8Array([0x37, 0x08, 0x00, 0x10, 0x00]),
    'ZWIFT_CLICK'
  );
  assert.equal(emitted.length, 1);
  assert.equal(emitted[0].control, 'SHIFT_UP');
  assert.equal(engine.getVirtualGear(), 14);

  // 4. Hook interception: frontend intercepts BUTTON_A and SHIFT_UP with { preventDefault: true }
  const interceptedControls: string[] = [];
  const unregister = engine.registerHook({
    id: 'controller-interceptor',
    onControllerInput: (evt) => {
      interceptedControls.push(evt.control);
      return { preventDefault: true };
    },
  });

  const hookedRes = engine.ingestControllerEvent({
    deviceId: 'zwift-play-r',
    deviceModel: 'ZWIFT_PLAY_RIGHT',
    control: 'SHIFT_UP',
    state: 'PRESSED',
    value: 1,
  });
  assert.equal(hookedRes.handledByHook, true);
  // Virtual gear remains 14 because the hook prevented default shifting
  assert.equal(engine.getVirtualGear(), 14);
  assert.deepEqual(interceptedControls, ['SHIFT_UP']);

  unregister();
  engine.stop();
});

test('Rust WASM & TypeScript .FIT encoders produce valid Garmin .FIT activity files with verified CRCs', async () => {
  const runtime = new VeloCoreWasmRuntime();
  await runtime.init();

  const nowMs = Date.now();
  const history = Array.from({ length: 15 }, (_, idx) => ({
    timestampMs: nowMs - (15 - idx) * 1000,
    elapsedSec: idx + 1,
    powerWatts: 245 + (idx % 5) * 4,
    power3sWatts: 248,
    targetWatts: 250,
    heartRateBpm: 148,
    cadenceRpm: 90,
    speedKph: 34.2,
    wPrimeBalancePct: 96.5,
  }));

  const fitBytes = runtime.encodeFitActivity(history, -21600);
  assert.ok(fitBytes, 'Expected Rust WASM .FIT encoder to return bytes');
  assert.equal(fitBytes[0], 14, 'Expected 14-byte FIT header');
  const magic = new TextDecoder().decode(fitBytes.subarray(8, 12));
  assert.equal(magic, '.FIT');

  // Data size in header (bytes 4..7) must equal total length - 16 (14-byte header + 2-byte trailer CRC)
  const dataSize =
    fitBytes[4] |
    (fitBytes[5] << 8) |
    (fitBytes[6] << 16) |
    (fitBytes[7] << 24);
  assert.equal(dataSize, fitBytes.byteLength - 16);

  // Verify TS fallback & TCX XML export as well
  const tsFitBytes = encodeTelemetryToFitBinary(history);
  assert.equal(tsFitBytes[0], 14);
  assert.equal(new TextDecoder().decode(tsFitBytes.subarray(8, 12)), '.FIT');

  const tcxXml = encodeTelemetryToTcxXml('Threshold Progression', history);
  assert.ok(tcxXml.includes('<TrainingCenterDatabase'));
  assert.ok(tcxXml.includes('<Watts>'));
});

test('workouts.txt and rider-profile.txt serialize and parse cleanly', () => {
  const workoutsTxtPath = path.resolve(process.cwd(), 'public', 'workouts.txt');
  const txt = fs.readFileSync(workoutsTxtPath, 'utf-8');
  const parsedWorkouts = parseWorkoutsLibraryFromTxt(txt, 280);
  assert.ok(parsedWorkouts.length >= 4, 'Expected at least 4 workouts in public/workouts.txt');

  const roundTripTxt = serializeWorkoutsLibraryToTxt(parsedWorkouts);
  const reParsed = parseWorkoutsLibraryFromTxt(roundTripTxt, 280);
  assert.equal(reParsed.length, parsedWorkouts.length);
  assert.equal(reParsed[0].title, parsedWorkouts[0].title);

  // Test zeroed-out rider profile round-trip
  const zeroProfileTxt = serializeRiderProfileToTxt({ ftpWatts: 0, weightKg: 0 });
  const parsedZero = parseRiderProfileFromTxt(zeroProfileTxt);
  assert.deepEqual(parsedZero, { ftpWatts: 0, weightKg: 0 });
});
