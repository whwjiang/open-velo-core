//! Wire Protocol Layer: ANT+ USB (`0xA4`) & Bluetooth Low Energy GATT
//!
//! Handles:
//! - Unsigned 16-bit & 8-bit rollover counter arithmetic
//! - ANT+ XOR checksum computation & frame verification
//! - Inbound ANT+ FE-C (`0x19` / `0x10`), Power (`0x10`), and HRM (`0x04`) decoding
//! - Inbound BLE GATT CPS (`0x2A63`), FTMS (`0x2AD2`), and HRM (`0x2A37`) decoding
//! - Outbound ANT+ FE-C (Pages 48/49/51) and BLE FTMS (`0x2AD9`) smart trainer commands

pub const MASK_POWER: u8 = 1 << 0;
pub const MASK_SPEED: u8 = 1 << 1;
pub const MASK_CADENCE: u8 = 1 << 2;
pub const MASK_HR: u8 = 1 << 3;
pub const MASK_BALANCE: u8 = 1 << 4;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct DecodedSensorMetrics {
    pub valid: u8,
    pub update_mask: u8,
    pub power_watts: u16,
    pub cadence_rpm: u8,
    pub heart_rate_bpm: u8,
    /// Speed in 0.1 km/h units (e.g., 325 = 32.5 km/h)
    pub speed_tenths_kph: u16,
    pub lr_balance_pct: u8,
}

impl Default for DecodedSensorMetrics {
    fn default() -> Self {
        Self::empty()
    }
}

impl DecodedSensorMetrics {
    pub const fn empty() -> Self {
        Self {
            valid: 0,
            update_mask: 0,
            power_watts: 0,
            cadence_rpm: 0,
            heart_rate_bpm: 0,
            speed_tenths_kph: 0,
            lr_balance_pct: 50,
        }
    }
}

/// Rollover-safe 16-bit unsigned counter delta: `(current - previous) & 0xFFFF`
#[inline]
pub fn u16_rollover_delta(current: u32, previous: u32) -> u32 {
    (current.wrapping_sub(previous)) & 0xFFFF
}

/// Rollover-safe 8-bit unsigned counter delta: `(current - previous) & 0xFF`
#[inline]
pub fn u8_rollover_delta(current: u32, previous: u32) -> u32 {
    (current.wrapping_sub(previous)) & 0xFF
}

/// Computes the XOR checksum across a byte slice.
#[inline]
pub fn ant_xor_checksum_slice(slice: &[u8]) -> u8 {
    let mut xor_acc: u8 = 0;
    for &b in slice {
        xor_acc ^= b;
    }
    xor_acc
}

/// Verifies a complete ANT+ serial message (`[0xA4, Length, MsgID, ...Payload, Checksum]`).
#[inline]
pub fn ant_verify_checksum_slice(slice: &[u8]) -> bool {
    if slice.len() < 4 || slice[0] != 0xA4 {
        return false;
    }
    let computed = ant_xor_checksum_slice(&slice[..slice.len() - 1]);
    computed == slice[slice.len() - 1]
}

/// Decodes a raw ANT+ broadcast/acknowledged frame (`0x4E` / `0x4F`).
pub fn decode_ant_frame(
    frame: &[u8],
    prev_ant_event_count: &mut i32,
    prev_ant_accum_power: &mut u32,
) -> Option<DecodedSensorMetrics> {
    if frame.len() < 12 || frame[0] != 0xA4 {
        return None;
    }
    let msg_id = frame[2];
    if msg_id != 0x4E && msg_id != 0x4F {
        return None;
    }

    let channel = frame[3];
    let data_page = frame[4] & 0x7F;
    let mut metrics = DecodedSensorMetrics {
        valid: 1,
        ..DecodedSensorMetrics::empty()
    };

    if channel == 0 && data_page == 0x19 {
        // ANT+ FE-C Data Page 25 (0x19): Specific Trainer / Stationary Bike Data
        let event_count = frame[5] as u32;
        let inst_cadence = frame[6];
        let accum_power = u16::from_le_bytes([frame[7], frame[8]]) as u32;
        let inst_power_12bit =
            ((frame[9] as u16) | (((frame[10] & 0x0F) as u16) << 8)).min(2500);

        let mut w = inst_power_12bit;
        if *prev_ant_event_count >= 0 {
            let evt_delta = u8_rollover_delta(event_count, *prev_ant_event_count as u32);
            let pwr_delta = u16_rollover_delta(accum_power, *prev_ant_accum_power);
            if evt_delta > 0 && inst_power_12bit == 0x0FFF {
                w = ((pwr_delta as f64 / evt_delta as f64).round() as u16).min(2500);
            }
        }
        *prev_ant_event_count = event_count as i32;
        *prev_ant_accum_power = accum_power;

        metrics.power_watts = w;
        metrics.update_mask |= MASK_POWER;
        if inst_cadence < 0xFF {
            metrics.cadence_rpm = inst_cadence;
            metrics.update_mask |= MASK_CADENCE;
        }
        Some(metrics)
    } else if channel == 0 && data_page == 0x10 {
        // ANT+ FE-C Data Page 16 (0x10): General FE Data (Speed, Distance, Heart Rate)
        let speed_mms = u16::from_le_bytes([frame[8], frame[9]]);
        let hr_byte = frame[10];
        if speed_mms != 0xFFFF {
            let tenths_kph = (((speed_mms as f64) / 1000.0) * 36.0).round() as u16;
            metrics.speed_tenths_kph = tenths_kph.min(1200);
            metrics.update_mask |= MASK_SPEED;
        }
        if hr_byte > 30 && hr_byte < 245 {
            metrics.heart_rate_bpm = hr_byte;
            metrics.update_mask |= MASK_HR;
        }
        Some(metrics)
    } else if channel == 1 && data_page == 0x10 {
        // ANT+ Cycling Power Standard Power-Only Page 16 (0x10)
        let pedal_byte = frame[6];
        let cadence = frame[7];
        let inst_watts = u16::from_le_bytes([frame[10], frame[11]]).min(2500);
        metrics.power_watts = inst_watts;
        metrics.update_mask |= MASK_POWER;
        if cadence < 0xFF {
            metrics.cadence_rpm = cadence;
            metrics.update_mask |= MASK_CADENCE;
        }
        if pedal_byte != 0xFF && (pedal_byte & 0x80) != 0 {
            let right_pct = (pedal_byte & 0x7F).clamp(1, 99);
            metrics.lr_balance_pct = 100 - right_pct;
            metrics.update_mask |= MASK_BALANCE;
        }
        Some(metrics)
    } else if channel == 2 {
        // ANT+ Heart Rate Monitor (DevType 120)
        let bpm = frame[11];
        if bpm > 30 && bpm < 245 {
            metrics.heart_rate_bpm = bpm;
            metrics.update_mask |= MASK_HR;
        }
        Some(metrics)
    } else {
        None
    }
}

/// Decodes a raw BLE GATT characteristic notification (`0x2A63`, `0x2AD2`, `0x2A5B`, `0x2A37`).
pub fn decode_ble_frame(
    char_uuid: u32,
    raw: &[u8],
    prev_ble_crank_revs: &mut i32,
    prev_ble_crank_time_1024: &mut u32,
) -> Option<DecodedSensorMetrics> {
    if raw.len() < 2 {
        return None;
    }
    let mut metrics = DecodedSensorMetrics {
        valid: 1,
        ..DecodedSensorMetrics::empty()
    };

    if char_uuid == 0x2A63 && raw.len() >= 4 {
        // BLE Cycling Power Measurement (0x2A63)
        // Bit 0 (0x0001): Pedal Power Balance Present (1 byte)
        // Bit 2 (0x0004): Accumulated Torque Present (2 bytes)
        // Bit 4 (0x0010): Wheel Revolution Data Present (6 bytes)
        // Bit 5 (0x0020): Crank Revolution Data Present (4 bytes)
        let flags = u16::from_le_bytes([raw[0], raw[1]]);
        let inst_watts = i16::from_le_bytes([raw[2], raw[3]]).max(0) as u16;
        metrics.power_watts = inst_watts.min(2500);
        metrics.update_mask |= MASK_POWER;

        let mut offset = 4usize;
        if (flags & 0x0001) != 0 && raw.len() >= offset + 1 {
            let bal_half_pct = raw[offset];
            if bal_half_pct > 0 && bal_half_pct <= 200 {
                metrics.lr_balance_pct = bal_half_pct / 2;
                metrics.update_mask |= MASK_BALANCE;
            }
            offset += 1;
        }
        if (flags & 0x0004) != 0 {
            offset += 2; // Skip Accumulated Torque (uint16)
        }
        if (flags & 0x0010) != 0 {
            offset += 6; // Skip Wheel Revolution Data (uint32 + uint16)
        }
        if (flags & 0x0020) != 0 && raw.len() >= offset + 4 {
            let crank_revs = u16::from_le_bytes([raw[offset], raw[offset + 1]]) as u32;
            let crank_time_1024 = u16::from_le_bytes([raw[offset + 2], raw[offset + 3]]) as u32;
            if *prev_ble_crank_revs >= 0 {
                let rev_delta = u16_rollover_delta(crank_revs, *prev_ble_crank_revs as u32);
                let time_delta = u16_rollover_delta(crank_time_1024, *prev_ble_crank_time_1024);
                if rev_delta > 0 && time_delta > 0 {
                    let rpm =
                        ((rev_delta as f64 * 1024.0 * 60.0) / (time_delta as f64)).round() as u32;
                    if (30..=195).contains(&rpm) {
                        metrics.cadence_rpm = rpm as u8;
                        metrics.update_mask |= MASK_CADENCE;
                    }
                }
            }
            *prev_ble_crank_revs = crank_revs as i32;
            *prev_ble_crank_time_1024 = crank_time_1024;
        }
        Some(metrics)
    } else if char_uuid == 0x2AD2 && raw.len() >= 4 {
        // BLE FTMS Indoor Bike Data (0x2AD2) — Bitmask-driven field layout per Bluetooth SIG spec
        // Bit 0 (0x0001): More Data (0 = Instantaneous Speed present, 1 = Not present)
        // Bit 1 (0x0002): Average Speed present (2 bytes)
        // Bit 2 (0x0004): Instantaneous Cadence present (2 bytes, 0.5 rpm)
        // Bit 3 (0x0008): Average Cadence present (2 bytes)
        // Bit 4 (0x0010): Total Distance present (3 bytes, uint24)
        // Bit 5 (0x0020): Resistance Level present (2 bytes, sint16)
        // Bit 6 (0x0040): Instantaneous Power present (2 bytes, sint16)
        // Bit 7 (0x0080): Average Power present (2 bytes, sint16)
        // Bit 8 (0x0100): Expended Energy present (5 bytes: uint16 + uint16 + uint8)
        // Bit 9 (0x0200): Heart Rate present (1 byte, uint8)
        let flags = u16::from_le_bytes([raw[0], raw[1]]);
        let mut offset = 2usize;

        // Bit 0 == 0 means Instantaneous Speed is present!
        if (flags & 0x0001) == 0 && raw.len() >= offset + 2 {
            let raw_speed = u16::from_le_bytes([raw[offset], raw[offset + 1]]); // 0.01 km/h
            metrics.speed_tenths_kph = (raw_speed / 10).min(1200);
            metrics.update_mask |= MASK_SPEED;
            offset += 2;
        }
        if (flags & 0x0002) != 0 {
            offset += 2; // Average Speed
        }
        if (flags & 0x0004) != 0 && raw.len() >= offset + 2 {
            let raw_cadence = u16::from_le_bytes([raw[offset], raw[offset + 1]]); // 0.5 rpm
            metrics.cadence_rpm = (raw_cadence / 2).min(240) as u8;
            metrics.update_mask |= MASK_CADENCE;
            offset += 2;
        }
        if (flags & 0x0008) != 0 {
            offset += 2; // Average Cadence
        }
        if (flags & 0x0010) != 0 {
            offset += 3; // Total Distance (uint24)
        }
        if (flags & 0x0020) != 0 {
            offset += 2; // Resistance Level (sint16)
        }
        if (flags & 0x0040) != 0 && raw.len() >= offset + 2 {
            let raw_power = i16::from_le_bytes([raw[offset], raw[offset + 1]]).max(0) as u16;
            metrics.power_watts = raw_power.min(2500);
            metrics.update_mask |= MASK_POWER;
            offset += 2;
        }
        if (flags & 0x0080) != 0 {
            offset += 2; // Average Power
        }
        if (flags & 0x0100) != 0 {
            offset += 5; // Expended Energy
        }
        if (flags & 0x0200) != 0 && raw.len() >= offset + 1 {
            let bpm = raw[offset];
            if bpm > 30 && bpm < 245 {
                metrics.heart_rate_bpm = bpm;
                metrics.update_mask |= MASK_HR;
            }
        }
        Some(metrics)
    } else if char_uuid == 0x2A5B && raw.len() >= 5 {
        // BLE Cycling Speed and Cadence Measurement (0x2A5B)
        // Bit 0 (0x01): Wheel Revolution Data Present (uint32 wheel revs + uint16 wheel time 1/1024s = 6 bytes)
        // Bit 1 (0x02): Crank Revolution Data Present (uint16 crank revs + uint16 crank time 1/1024s = 4 bytes)
        let flags = raw[0];
        let mut offset = 1usize;
        if (flags & 0x01) != 0 {
            offset += 6;
        }
        if (flags & 0x02) != 0 && raw.len() >= offset + 4 {
            let crank_revs = u16::from_le_bytes([raw[offset], raw[offset + 1]]) as u32;
            let crank_time_1024 = u16::from_le_bytes([raw[offset + 2], raw[offset + 3]]) as u32;
            if *prev_ble_crank_revs >= 0 {
                let rev_delta = u16_rollover_delta(crank_revs, *prev_ble_crank_revs as u32);
                let time_delta = u16_rollover_delta(crank_time_1024, *prev_ble_crank_time_1024);
                if rev_delta > 0 && time_delta > 0 {
                    let rpm =
                        ((rev_delta as f64 * 1024.0 * 60.0) / (time_delta as f64)).round() as u32;
                    if (30..=195).contains(&rpm) {
                        metrics.cadence_rpm = rpm as u8;
                        metrics.update_mask |= MASK_CADENCE;
                    }
                }
            }
            *prev_ble_crank_revs = crank_revs as i32;
            *prev_ble_crank_time_1024 = crank_time_1024;
        }
        Some(metrics)
    } else if char_uuid == 0x2A37 && raw.len() >= 2 {
        let flags = raw[0];
        let is_16bit = (flags & 0x01) != 0;
        let bpm = if is_16bit && raw.len() >= 3 {
            u16::from_le_bytes([raw[1], raw[2]]).min(250) as u8
        } else {
            raw[1]
        };
        if bpm > 30 && bpm < 245 {
            metrics.heart_rate_bpm = bpm;
            metrics.update_mask |= MASK_HR;
        }
        Some(metrics)
    } else {
        None
    }
}

/// Encodes an ANT+ FE-C Data Page 49 (0x31) Target Power (ERG Mode) 13-byte USB frame.
pub fn encode_ant_fec_erg_frame(channel: u8, target_watts: u32) -> [u8; 13] {
    let raw_units = (target_watts.saturating_mul(4)).min(16_000) as u16;
    let lo = (raw_units & 0xFF) as u8;
    let hi = ((raw_units >> 8) & 0xFF) as u8;
    let mut frame: [u8; 13] = [
        0xA4, 0x09, 0x4F, channel, 0x31, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, lo, hi, 0x00,
    ];
    frame[12] = ant_xor_checksum_slice(&frame[0..12]);
    frame
}

/// Encodes an ANT+ FE-C Data Page 48 (0x30) Basic Resistance 13-byte USB frame.
pub fn encode_ant_fec_resistance_frame(channel: u8, resistance_pct: u32) -> [u8; 13] {
    let raw_res = (resistance_pct.saturating_mul(2)).min(200) as u8;
    let mut frame: [u8; 13] = [
        0xA4, 0x09, 0x4F, channel, 0x30, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, raw_res, 0x00,
    ];
    frame[12] = ant_xor_checksum_slice(&frame[0..12]);
    frame
}

/// Encodes an ANT+ FE-C Data Page 51 (0x33) Track Resistance (Slope Mode) 13-byte USB frame.
pub fn encode_ant_fec_slope_frame(channel: u8, slope_hundredths: i32, crr_raw: u8) -> [u8; 13] {
    let raw_grade = (20_000 + slope_hundredths).clamp(0, 40_000) as u16;
    let lo = (raw_grade & 0xFF) as u8;
    let hi = ((raw_grade >> 8) & 0xFF) as u8;
    let mut frame: [u8; 13] = [
        0xA4, 0x09, 0x4F, channel, 0x33, 0xFF, 0xFF, 0xFF, 0xFF, lo, hi, crr_raw, 0x00,
    ];
    frame[12] = ant_xor_checksum_slice(&frame[0..12]);
    frame
}

/// Encodes BLE FTMS 0x2AD9 Opcode 0x05 (Set Target Power, sint16 LE).
pub fn encode_ble_ftms_erg_frame(target_watts: u32) -> [u8; 3] {
    let w = target_watts.min(4000) as u16;
    [0x05, (w & 0xFF) as u8, ((w >> 8) & 0xFF) as u8]
}

/// Encodes BLE FTMS 0x2AD9 Opcode 0x04 (Set Target Resistance Level).
pub fn encode_ble_ftms_resistance_frame(resistance_pct: u32) -> [u8; 2] {
    let level = (resistance_pct.saturating_mul(2)).min(200) as u8;
    [0x04, level]
}

/// Encodes BLE FTMS 0x2AD9 Opcode 0x11 (Set Indoor Bike Simulation Parameters).
pub fn encode_ble_ftms_slope_frame(slope_hundredths: i32, crr_byte: u8, cw_byte: u8) -> [u8; 7] {
    let clamped = slope_hundredths.clamp(-2000, 2000) as i16;
    let grade_u16 = clamped as u16;
    [
        0x11,
        0x00,
        0x00,
        (grade_u16 & 0xFF) as u8,
        ((grade_u16 >> 8) & 0xFF) as u8,
        crr_byte,
        cw_byte,
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_rollover_arithmetic() {
        assert_eq!(u16_rollover_delta(500, 450), 50);
        assert_eq!(u16_rollover_delta(12, 65530), 18);
        assert_eq!(u8_rollover_delta(5, 250), 11);
    }

    #[test]
    fn test_ant_fec_erg_and_slope_encoding() {
        let erg = encode_ant_fec_erg_frame(0, 250);
        assert!(ant_verify_checksum_slice(&erg));
        assert_eq!(erg[4], 0x31);
        assert_eq!(u16::from_le_bytes([erg[10], erg[11]]), 1000);

        let mut corrupted = erg;
        corrupted[10] ^= 0xFF;
        assert!(!ant_verify_checksum_slice(&corrupted));

        let slope = encode_ant_fec_slope_frame(0, 550, 80);
        assert!(ant_verify_checksum_slice(&slope));
        assert_eq!(slope[4], 0x33);
        assert_eq!(u16::from_le_bytes([slope[9], slope[10]]), 20550);
    }

    #[test]
    fn test_ant_and_ble_decoding() {
        let mut prev_evt = -1;
        let mut prev_acc = 0;
        let pwr: u16 = 275;
        let frame_0x19: [u8; 13] = [
            0xA4, 0x09, 0x4E, 0x00, 0x19, 0x01, 92, 0x10, 0x01,
            (pwr & 0xFF) as u8, ((pwr >> 8) & 0x0F) as u8, 0x30, 0x00,
        ];
        let dec = decode_ant_frame(&frame_0x19, &mut prev_evt, &mut prev_acc).unwrap();
        assert_eq!(dec.power_watts, 275);
        assert_eq!(dec.cadence_rpm, 92);

        let mut prev_revs = -1;
        let mut prev_time = 0;
        let ble_ftms: [u8; 8] = [0x44, 0x00, 0xB2, 0x0C, 188, 0x00, 0x22, 0x01];
        let dec_ble = decode_ble_frame(0x2AD2, &ble_ftms, &mut prev_revs, &mut prev_time).unwrap();
        assert_eq!(dec_ble.power_watts, 290);
        assert_eq!(dec_ble.cadence_rpm, 94);
        assert_eq!(dec_ble.speed_tenths_kph, 325);
    }
}
