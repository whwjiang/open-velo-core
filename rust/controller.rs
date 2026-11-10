//! Handlebar Controller & Virtual Shifting Layer (`rust/controller.rs`)
//!
//! Provides domain-neutral support for OpenBikeControl / Zwift Click / Zwift Play
//! handlebar controllers:
//! - Virtual drivetrain gear ratio calculation (Gears `1..=24`, default `12`)
//! - Raw BLE controller frame decoding into canonical control bitmasks

/// Control bitmask constants returned by `decode_ble_controller_frame`
pub const CTRL_MASK_SHIFT_UP: u16 = 1 << 0;
pub const CTRL_MASK_SHIFT_DOWN: u16 = 1 << 1;
pub const CTRL_MASK_DPAD_UP: u16 = 1 << 2;
pub const CTRL_MASK_DPAD_DOWN: u16 = 1 << 3;
pub const CTRL_MASK_DPAD_LEFT: u16 = 1 << 4;
pub const CTRL_MASK_DPAD_RIGHT: u16 = 1 << 5;
pub const CTRL_MASK_BUTTON_A: u16 = 1 << 6;
pub const CTRL_MASK_BUTTON_B: u16 = 1 << 7;
pub const CTRL_MASK_BUTTON_Y: u16 = 1 << 8;
pub const CTRL_MASK_BUTTON_Z: u16 = 1 << 9;
pub const CTRL_MASK_ON_OFF_HOME: u16 = 1 << 10;

pub const MIN_VIRTUAL_GEAR: u8 = 1;
pub const MAX_VIRTUAL_GEAR: u8 = 24;
pub const DEFAULT_VIRTUAL_GEAR: u8 = 12;

/// Computes a virtual drivetrain gear ratio multiplier (in thousandths, where `1000` = `1.000x`)
/// for a given virtual gear `1..=24` (Gear 12 is neutral `1000`).
/// Each gear step scales effective trainer load by ~5.5%.
#[inline]
pub fn compute_virtual_gear_ratio_thousandths(gear: u8) -> u32 {
    let clamped = gear.clamp(MIN_VIRTUAL_GEAR, MAX_VIRTUAL_GEAR) as i32;
    let delta = clamped - (DEFAULT_VIRTUAL_GEAR as i32);
    // Base 1000 + 55 per gear step, clamped to [350..2000]
    (1000 + delta * 55).clamp(350, 2000) as u32
}

/// Decodes a raw BLE controller notification payload (Zwift Click `0x37` / Play `0x07` or
/// OpenBikeControl compact frame) into a pressed-button bitmask (`CTRL_MASK_*`).
///
/// Supported binary wire formats:
/// 1. OpenBikeControl / Compact 3-byte frame `[0xBC, lo_mask, hi_mask]`
/// 2. Zwift Click `0x37` protobuf button status `[0x37, 0x08, state_byte, ...]`
///    where `0x00` = Plus/Shift Up pressed, `0x01` = Minus/Shift Down pressed
/// 3. Zwift Play `0x07` button report `[0x07, 0x08, bitfield, ...]`
pub fn decode_ble_controller_button_mask(raw: &[u8]) -> u16 {
    if raw.is_empty() {
        return 0;
    }

    // 1. OpenBikeControl canonical frame: [0xBC, mask_lo, mask_hi]
    if raw[0] == 0xBC && raw.len() >= 3 {
        return u16::from_le_bytes([raw[1], raw[2]]);
    }

    // 2. Zwift Click message ID 0x37 (55):
    // Typical payload: [0x37, 0x08, button_id, 0x10, pressed_inv]
    // In Zwift Click protocol, 0x10 0x00 indicates pressed (0 = active low), 0x10 0x01 released.
    if raw[0] == 0x37 && raw.len() >= 5 && raw[1] == 0x08 && raw[3] == 0x10 {
        let btn_id = raw[2];
        let is_pressed = raw[4] == 0x00;
        if !is_pressed {
            return 0;
        }
        return match btn_id {
            0x00 => CTRL_MASK_SHIFT_UP,
            0x01 => CTRL_MASK_SHIFT_DOWN,
            _ => 0,
        };
    }

    // 3. Zwift Play message ID 0x07 button bitmask notification
    if raw[0] == 0x07 && raw.len() >= 3 && raw[1] == 0x08 {
        let b = raw[2];
        let mut mask = 0u16;
        if (b & 0x01) != 0 {
            mask |= CTRL_MASK_BUTTON_Y;
        }
        if (b & 0x02) != 0 {
            mask |= CTRL_MASK_BUTTON_Z;
        }
        if (b & 0x04) != 0 {
            mask |= CTRL_MASK_BUTTON_A;
        }
        if (b & 0x08) != 0 {
            mask |= CTRL_MASK_BUTTON_B;
        }
        if (b & 0x10) != 0 {
            mask |= CTRL_MASK_SHIFT_UP;
        }
        if (b & 0x20) != 0 {
            mask |= CTRL_MASK_SHIFT_DOWN;
        }
        return mask;
    }

    0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_virtual_gear_ratio_scaling() {
        assert_eq!(compute_virtual_gear_ratio_thousandths(12), 1000);
        assert!(compute_virtual_gear_ratio_thousandths(15) > 1000);
        assert!(compute_virtual_gear_ratio_thousandths(8) < 1000);
        assert_eq!(compute_virtual_gear_ratio_thousandths(1), 395);
        assert_eq!(compute_virtual_gear_ratio_thousandths(24), 1660);
    }

    #[test]
    fn test_decode_zwift_click_and_obc_frames() {
        // Zwift Click Shift Up pressed ([0x37, 0x08, 0x00, 0x10, 0x00])
        let click_up = [0x37, 0x08, 0x00, 0x10, 0x00];
        assert_eq!(
            decode_ble_controller_button_mask(&click_up),
            CTRL_MASK_SHIFT_UP
        );

        // Zwift Click Shift Down pressed ([0x37, 0x08, 0x01, 0x10, 0x00])
        let click_down = [0x37, 0x08, 0x01, 0x10, 0x00];
        assert_eq!(
            decode_ble_controller_button_mask(&click_down),
            CTRL_MASK_SHIFT_DOWN
        );

        // OpenBikeControl compact frame: SHIFT_UP | BUTTON_A
        let obc = [
            0xBC,
            (CTRL_MASK_SHIFT_UP | CTRL_MASK_BUTTON_A) as u8,
            0x00,
        ];
        assert_eq!(
            decode_ble_controller_button_mask(&obc),
            CTRL_MASK_SHIFT_UP | CTRL_MASK_BUTTON_A
        );
    }
}
