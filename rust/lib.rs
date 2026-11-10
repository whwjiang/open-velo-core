//! Open VeloCore Engine (`open-velo-core`)
//!
//! Modular Rust/WASM library organized by domain:
//! - [`protocol`]: ANT+ USB (`0xA4`) & Bluetooth Low Energy GATT (`0x2A63`, `0x2AD2`, `0x2A37`, `0x2AD9`) codecs
//! - [`physiology`]: Skiba differential `W'bal` model & time-windowed power averaging (3s, 10s, 30s)
//! - [`compliance`]: Structured workout power & cadence target compliance evaluation
//! - [`session`]: Stateful 1Hz & sub-second ride session state machine
//! - [`fit`]: Standards-compliant Garmin `.FIT` binary activity file encoder & CRC-16

pub mod compliance;
pub mod controller;
pub mod fit;
pub mod physiology;
pub mod protocol;
pub mod session;

use std::cell::RefCell;

use crate::fit::{compute_fit_crc16_slice, FitActivityBuilder};
use crate::protocol::{
    ant_verify_checksum_slice, ant_xor_checksum_slice, decode_ant_frame, decode_ble_frame,
    encode_ant_fec_erg_frame, encode_ant_fec_resistance_frame, encode_ant_fec_slope_frame,
    encode_ble_ftms_erg_frame, encode_ble_ftms_resistance_frame, encode_ble_ftms_slope_frame,
    DecodedSensorMetrics,
};
use crate::session::RideSessionState;

const INBOUND_BUF_LEN: usize = 128;
const OUTBOUND_BUF_LEN: usize = 32;

thread_local! {
    static INBOUND_FRAME_BUF: RefCell<[u8; INBOUND_BUF_LEN]> = const { RefCell::new([0u8; INBOUND_BUF_LEN]) };
    static OUTBOUND_FRAME_BUF: RefCell<[u8; OUTBOUND_BUF_LEN]> = const { RefCell::new([0u8; OUTBOUND_BUF_LEN]) };
    static SESSION: RefCell<RideSessionState> = RefCell::new(RideSessionState::new());
    static FIT_BUILDER: RefCell<FitActivityBuilder> = RefCell::new(FitActivityBuilder::new());
    static LAST_DECODED: RefCell<DecodedSensorMetrics> = const {
        RefCell::new(DecodedSensorMetrics::empty())
    };
}

// ============================================================================
// 1. Shared Linear Memory Buffers & Protocol FFI Exports
// ============================================================================

#[no_mangle]
pub extern "C" fn get_inbound_buffer_ptr() -> *mut u8 {
    INBOUND_FRAME_BUF.with(|buf| buf.borrow_mut().as_mut_ptr())
}

#[no_mangle]
pub extern "C" fn get_outbound_buffer_ptr() -> *mut u8 {
    OUTBOUND_FRAME_BUF.with(|buf| buf.borrow_mut().as_mut_ptr())
}

#[no_mangle]
pub extern "C" fn ant_xor_checksum(ptr: *const u8, len: usize) -> u32 {
    if ptr.is_null() || len == 0 {
        return 0;
    }
    let slice = unsafe { core::slice::from_raw_parts(ptr, len) };
    ant_xor_checksum_slice(slice) as u32
}

#[no_mangle]
pub extern "C" fn ant_verify_checksum(ptr: *const u8, len: usize) -> u32 {
    if ptr.is_null() || len < 4 {
        return 0;
    }
    let slice = unsafe { core::slice::from_raw_parts(ptr, len) };
    if ant_verify_checksum_slice(slice) {
        1
    } else {
        0
    }
}

#[no_mangle]
pub extern "C" fn u16_rollover_delta(current: u32, previous: u32) -> u32 {
    protocol::u16_rollover_delta(current, previous)
}

#[no_mangle]
pub extern "C" fn u8_rollover_delta(current: u32, previous: u32) -> u32 {
    protocol::u8_rollover_delta(current, previous)
}

#[no_mangle]
pub extern "C" fn decode_ant_frame_in_buf(len: usize) -> u32 {
    if len < 12 || len > INBOUND_BUF_LEN {
        return 0;
    }
    let frame: [u8; INBOUND_BUF_LEN] = INBOUND_FRAME_BUF.with(|b| *b.borrow());
    let decoded = SESSION.with(|s| {
        let mut st = s.borrow_mut();
        let RideSessionState {
            prev_ant_event_count,
            prev_ant_accum_power,
            ..
        } = &mut *st;
        decode_ant_frame(&frame[0..len], prev_ant_event_count, prev_ant_accum_power)
    });
    if let Some(metrics) = decoded {
        LAST_DECODED.with(|d| *d.borrow_mut() = metrics);
        1
    } else {
        0
    }
}

#[no_mangle]
pub extern "C" fn decode_ble_frame_in_buf(char_uuid: u32, len: usize) -> u32 {
    if len < 2 || len > INBOUND_BUF_LEN {
        return 0;
    }
    let frame: [u8; INBOUND_BUF_LEN] = INBOUND_FRAME_BUF.with(|b| *b.borrow());
    let decoded = SESSION.with(|s| {
        let mut st = s.borrow_mut();
        let RideSessionState {
            prev_ble_crank_revs,
            prev_ble_crank_time_1024,
            ..
        } = &mut *st;
        decode_ble_frame(
            char_uuid,
            &frame[0..len],
            prev_ble_crank_revs,
            prev_ble_crank_time_1024,
        )
    });
    if let Some(metrics) = decoded {
        LAST_DECODED.with(|d| *d.borrow_mut() = metrics);
        1
    } else {
        0
    }
}

#[no_mangle]
pub extern "C" fn decoded_get_update_mask() -> u32 {
    LAST_DECODED.with(|d| d.borrow().update_mask as u32)
}

#[no_mangle]
pub extern "C" fn decoded_get_power_watts() -> u32 {
    LAST_DECODED.with(|d| d.borrow().power_watts as u32)
}

#[no_mangle]
pub extern "C" fn decoded_get_cadence_rpm() -> u32 {
    LAST_DECODED.with(|d| d.borrow().cadence_rpm as u32)
}

#[no_mangle]
pub extern "C" fn decoded_get_hr_bpm() -> u32 {
    LAST_DECODED.with(|d| d.borrow().heart_rate_bpm as u32)
}

#[no_mangle]
pub extern "C" fn decoded_get_speed_tenths_kph() -> u32 {
    LAST_DECODED.with(|d| d.borrow().speed_tenths_kph as u32)
}

#[no_mangle]
pub extern "C" fn decoded_get_lr_balance_pct() -> u32 {
    LAST_DECODED.with(|d| d.borrow().lr_balance_pct as u32)
}

#[no_mangle]
pub extern "C" fn encode_ant_fec_erg(channel: u8, target_watts: u32) -> usize {
    let frame = encode_ant_fec_erg_frame(channel, target_watts);
    OUTBOUND_FRAME_BUF.with(|buf| {
        buf.borrow_mut()[0..13].copy_from_slice(&frame);
    });
    13
}

#[no_mangle]
pub extern "C" fn encode_ant_fec_resistance(channel: u8, resistance_pct: u32) -> usize {
    let frame = encode_ant_fec_resistance_frame(channel, resistance_pct);
    OUTBOUND_FRAME_BUF.with(|buf| {
        buf.borrow_mut()[0..13].copy_from_slice(&frame);
    });
    13
}

#[no_mangle]
pub extern "C" fn encode_ant_fec_slope(
    channel: u8,
    slope_hundredths: i32,
    crr_raw: u8,
) -> usize {
    let frame = encode_ant_fec_slope_frame(channel, slope_hundredths, crr_raw);
    OUTBOUND_FRAME_BUF.with(|buf| {
        buf.borrow_mut()[0..13].copy_from_slice(&frame);
    });
    13
}

#[no_mangle]
pub extern "C" fn encode_ble_ftms_erg(target_watts: u32) -> usize {
    let frame = encode_ble_ftms_erg_frame(target_watts);
    OUTBOUND_FRAME_BUF.with(|buf| {
        buf.borrow_mut()[0..3].copy_from_slice(&frame);
    });
    3
}

#[no_mangle]
pub extern "C" fn encode_ble_ftms_resistance(resistance_pct: u32) -> usize {
    let frame = encode_ble_ftms_resistance_frame(resistance_pct);
    OUTBOUND_FRAME_BUF.with(|buf| {
        buf.borrow_mut()[0..2].copy_from_slice(&frame);
    });
    2
}

#[no_mangle]
pub extern "C" fn encode_ble_ftms_slope(
    slope_hundredths: i32,
    crr_byte: u8,
    cw_byte: u8,
) -> usize {
    let frame = encode_ble_ftms_slope_frame(slope_hundredths, crr_byte, cw_byte);
    OUTBOUND_FRAME_BUF.with(|buf| {
        buf.borrow_mut()[0..7].copy_from_slice(&frame);
    });
    7
}

// ============================================================================
// 2. Physiology, Compliance & Session State FFI Exports
// ============================================================================

#[no_mangle]
pub extern "C" fn compute_wbal_step(
    current_wbal_j: i32,
    w_prime_max_j: i32,
    power_watts: i32,
    cp_watts: i32,
) -> i32 {
    physiology::compute_wbal_step(current_wbal_j, w_prime_max_j, power_watts, cp_watts)
}

#[no_mangle]
pub extern "C" fn compute_power_compliance_score(actual_watts: u32, target_watts: u32) -> u32 {
    compliance::compute_power_compliance_score(actual_watts, target_watts)
}

#[no_mangle]
pub extern "C" fn compute_cadence_compliance_score(actual_rpm: u32, target_rpm: u32) -> u32 {
    compliance::compute_cadence_compliance_score(actual_rpm, target_rpm)
}

#[no_mangle]
pub extern "C" fn session_reset() {
    SESSION.with(|s| s.borrow_mut().reset());
}

#[no_mangle]
pub extern "C" fn session_set_rider_profile(
    ftp_watts: u32,
    weight_tenths_kg: u32,
    w_prime_max_j: i32,
) {
    SESSION.with(|s| {
        let mut st = s.borrow_mut();
        st.ftp_watts = ftp_watts.min(1000);
        st.weight_tenths_kg = weight_tenths_kg.min(3000);
        if w_prime_max_j > 0 {
            st.w_prime_max_j = w_prime_max_j;
            st.w_prime_bal_j = st.w_prime_bal_j.min(w_prime_max_j);
        }
    });
}

#[no_mangle]
pub extern "C" fn session_record_power_sample(watts: u32, timestamp_ms: f64) {
    SESSION.with(|s| s.borrow_mut().record_power(watts, timestamp_ms));
}

#[no_mangle]
pub extern "C" fn session_get_window_power_avg(window_ms: f64, now_ms: f64) -> u32 {
    SESSION.with(|s| s.borrow().window_power_avg(window_ms, now_ms))
}

#[no_mangle]
pub extern "C" fn session_tick_1hz(
    power_watts: u32,
    hr_bpm: u32,
    cadence_rpm: u32,
    speed_tenths_kph: u32,
    target_watts: u32,
    target_cadence_rpm: u32,
) {
    SESSION.with(|s| {
        s.borrow_mut().tick_1hz(
            power_watts,
            hr_bpm,
            cadence_rpm,
            speed_tenths_kph,
            target_watts,
            target_cadence_rpm,
        );
    });
}

#[no_mangle]
pub extern "C" fn session_complete_interval() -> u32 {
    SESSION.with(|s| {
        let summary = s.borrow_mut().complete_interval_and_reset();
        summary.overall_compliance_pct
    })
}

#[no_mangle]
pub extern "C" fn session_get_wbal_joules() -> i32 {
    SESSION.with(|s| s.borrow().w_prime_bal_j)
}

#[no_mangle]
pub extern "C" fn session_get_normalized_power(fallback_30s: u32) -> u32 {
    SESSION.with(|s| s.borrow().normalized_power(fallback_30s))
}

#[no_mangle]
pub extern "C" fn session_get_interval_power(fallback: u32) -> u32 {
    SESSION.with(|s| s.borrow().interval_power_avg(fallback))
}

#[no_mangle]
pub extern "C" fn session_get_interval_compliance_pct() -> u32 {
    SESSION.with(|s| s.borrow().interval_power_compliance_pct())
}

#[no_mangle]
pub extern "C" fn session_get_interval_cadence_compliance_pct() -> u32 {
    SESSION.with(|s| s.borrow().interval_cadence_compliance_pct())
}

#[no_mangle]
pub extern "C" fn session_get_last_interval_duration_sec() -> u32 {
    SESSION.with(|s| s.borrow().last_completed_interval_duration_sec)
}

#[no_mangle]
pub extern "C" fn compute_virtual_gear_ratio_thousandths(gear: u8) -> u32 {
    controller::compute_virtual_gear_ratio_thousandths(gear)
}

#[no_mangle]
pub extern "C" fn decode_ble_controller_in_buf(len: usize) -> u32 {
    if len == 0 || len > INBOUND_BUF_LEN {
        return 0;
    }
    let frame: [u8; INBOUND_BUF_LEN] = INBOUND_FRAME_BUF.with(|b| *b.borrow());
    controller::decode_ble_controller_button_mask(&frame[0..len]) as u32
}

// ============================================================================
// 3. Garmin .FIT Binary Activity Encoder FFI Exports
// ============================================================================

#[no_mangle]
pub extern "C" fn fit_crc16(ptr: *const u8, len: usize) -> u32 {
    if ptr.is_null() || len == 0 {
        return 0;
    }
    let slice = unsafe { core::slice::from_raw_parts(ptr, len) };
    compute_fit_crc16_slice(slice) as u32
}

#[no_mangle]
pub extern "C" fn fit_reset_records() {
    FIT_BUILDER.with(|b| b.borrow_mut().clear());
}

#[no_mangle]
pub extern "C" fn fit_push_record(
    fit_timestamp_sec: u32,
    power_watts: u16,
    speed_mms: u16,
    heart_rate_bpm: u8,
    cadence_rpm: u8,
) {
    FIT_BUILDER.with(|b| {
        b.borrow_mut().push_point(
            fit_timestamp_sec,
            power_watts,
            speed_mms,
            heart_rate_bpm,
            cadence_rpm,
        );
    });
}

#[no_mangle]
pub extern "C" fn fit_encode_activity(tz_offset_sec: i32) -> usize {
    FIT_BUILDER.with(|b| b.borrow_mut().build_fit_activity(tz_offset_sec).len())
}

#[no_mangle]
pub extern "C" fn get_fit_buffer_ptr() -> *const u8 {
    FIT_BUILDER.with(|b| b.borrow().encoded_file.as_ptr())
}
