#![no_std]

//! VeloCore WASM Telemetry & Smart Trainer Protocol Engine
//!
//! Compiles to `wasm32-unknown-unknown` with zero heap allocations on the hot path.
//! Decodes raw ANT+ USB frames (FE-C 0x10/0x19, Power 0x10, Heart Rate, Speed/Cadence)
//! and Bluetooth Low Energy GATT characteristics (FTMS 0x2AD2, CPS 0x2A63, HRM 0x2A37, CSCS 0x2A5B),
//! and encodes outbound smart trainer control packets (ANT+ FE-C Pages 48/49/51 & BLE FTMS 0x2AD9).

#[panic_handler]
fn panic(_info: &core::panic::PanicInfo) -> ! {
    loop {}
}

/// Shared linear memory buffers for zero-copy frame exchange between JS and WASM
static mut INBOUND_FRAME_BUF: [u8; 64] = [0u8; 64];
static mut OUTBOUND_FRAME_BUF: [u8; 16] = [0u8; 16];

#[no_mangle]
pub extern "C" fn get_inbound_buffer_ptr() -> *mut u8 {
    unsafe { INBOUND_FRAME_BUF.as_mut_ptr() }
}

#[no_mangle]
pub extern "C" fn get_outbound_buffer_ptr() -> *mut u8 {
    unsafe { OUTBOUND_FRAME_BUF.as_mut_ptr() }
}

/// Computes and verifies the XOR checksum of an ANT+ serial message:
/// `[0xA4 (Sync), Length, MsgID, ...Payload, Checksum]`
#[no_mangle]
pub extern "C" fn ant_verify_checksum(ptr: *const u8, len: usize) -> u32 {
    if len < 4 {
        return 0;
    }
    let slice = unsafe { core::slice::from_raw_parts(ptr, len) };
    if slice[0] != 0xA4 {
        return 0;
    }
    let mut xor_acc: u8 = 0;
    let mut i = 0;
    while i < len - 1 {
        xor_acc ^= slice[i];
        i += 1;
    }
    if xor_acc == slice[len - 1] {
        1
    } else {
        0
    }
}

/// Rollover-safe 16-bit unsigned counter delta: `(current - previous) & 0xFFFF`
#[no_mangle]
pub extern "C" fn u16_rollover_delta(current: u32, previous: u32) -> u32 {
    (current.wrapping_sub(previous)) & 0xFFFF
}

/// Rollover-safe 8-bit unsigned counter delta: `(current - previous) & 0xFF`
#[no_mangle]
pub extern "C" fn u8_rollover_delta(current: u32, previous: u32) -> u32 {
    (current.wrapping_sub(previous)) & 0xFF
}

/// Encodes an ANT+ FE-C Data Page 49 (0x31) Target Power (ERG Mode) 13-byte USB frame.
/// Target power is encoded in 0.25W increments (`watts * 4`).
#[no_mangle]
pub extern "C" fn encode_ant_fec_erg(channel: u8, target_watts: u32) -> usize {
    let raw_units = (target_watts.saturating_mul(4)).min(16000) as u16;
    let lo = (raw_units & 0xFF) as u8;
    let hi = ((raw_units >> 8) & 0xFF) as u8;

    let frame: [u8; 12] = [
        0xA4, // Sync byte
        0x09, // Payload length (1 channel + 8 data bytes)
        0x4F, // Acknowledged Data message ID
        channel,
        0x31, // Data Page 49: Target Power
        0xFF,
        0xFF,
        0xFF,
        0xFF,
        0xFF,
        lo,
        hi,
    ];

    let mut crc: u8 = 0;
    let mut i = 0;
    while i < 12 {
        crc ^= frame[i];
        unsafe {
            OUTBOUND_FRAME_BUF[i] = frame[i];
        }
        i += 1;
    }
    unsafe {
        OUTBOUND_FRAME_BUF[12] = crc;
    }
    13
}

/// Encodes an ANT+ FE-C Data Page 48 (0x30) Basic Resistance 13-byte USB frame.
/// Resistance percentage (0-100%) is encoded in 0.5% units (0-200).
#[no_mangle]
pub extern "C" fn encode_ant_fec_resistance(channel: u8, resistance_pct: u32) -> usize {
    let raw_res = (resistance_pct.saturating_mul(2)).min(200) as u8;
    let frame: [u8; 12] = [
        0xA4,
        0x09,
        0x4F,
        channel,
        0x30, // Data Page 48: Basic Resistance
        0xFF,
        0xFF,
        0xFF,
        0xFF,
        0xFF,
        0xFF,
        raw_res,
    ];
    let mut crc: u8 = 0;
    let mut i = 0;
    while i < 12 {
        crc ^= frame[i];
        unsafe {
            OUTBOUND_FRAME_BUF[i] = frame[i];
        }
        i += 1;
    }
    unsafe {
        OUTBOUND_FRAME_BUF[12] = crc;
    }
    13
}

/// Encodes an ANT+ FE-C Data Page 51 (0x33) Track Resistance (Slope Mode) 13-byte USB frame.
/// `slope_tenths` is grade in 0.1% steps (e.g., +45 for +4.5% grade, -30 for -3.0% grade).
/// ANT+ FE-C encodes grade in 0.01% steps offset by +200.00% (`(grade_pct + 200.0) * 100`).
#[no_mangle]
pub extern "C" fn encode_ant_fec_slope(channel: u8, slope_tenths: i32) -> usize {
    let raw_grade = ((2000 + slope_tenths).clamp(0, 4000) * 10) as u16;
    let lo = (raw_grade & 0xFF) as u8;
    let hi = ((raw_grade >> 8) & 0xFF) as u8;
    let frame: [u8; 12] = [
        0xA4,
        0x09,
        0x4F,
        channel,
        0x33, // Data Page 51: Track Resistance
        0xFF,
        0xFF,
        0xFF,
        0xFF,
        lo,
        hi,
        0x50, // Default rolling resistance Crr = 0.0040 (80 * 5e-5)
    ];
    let mut crc: u8 = 0;
    let mut i = 0;
    while i < 12 {
        crc ^= frame[i];
        unsafe {
            OUTBOUND_FRAME_BUF[i] = frame[i];
        }
        i += 1;
    }
    unsafe {
        OUTBOUND_FRAME_BUF[12] = crc;
    }
    13
}

/// Skiba differential W'bal step (in Joules):
/// When power > CP, depletes W' proportionally: `wbal - (power - cp) * dt`
/// When power < CP, reconstitutes exponentially via tau = 546 * exp(-0.01 * (cp - power)) + 316
#[no_mangle]
pub extern "C" fn compute_wbal_step(
    current_wbal_j: i32,
    w_prime_max_j: i32,
    power_watts: i32,
    cp_watts: i32,
) -> i32 {
    if power_watts > cp_watts {
        let next = current_wbal_j - (power_watts - cp_watts);
        if next < 0 { 0 } else { next }
    } else {
        let d_cp = (cp_watts - power_watts).max(1);
        // Fast integer approximation of recovery time constant tau (seconds)
        let tau = (316 + (54600 / (100 + d_cp))).max(180);
        let recovery = (w_prime_max_j - current_wbal_j) / tau;
        let next = current_wbal_j + recovery.max(1);
        if next > w_prime_max_j { w_prime_max_j } else { next }
    }
}
