//! Garmin `.FIT` Binary Activity File Encoder & CRC-16
//!
//! Produces a standards-compliant `.FIT` Activity binary accepted by Strava and Garmin Connect:
//! 1. `file_id` (Global MesgNum 0)
//! 2. `device_info` (Global MesgNum 23)
//! 3. `event` Timer Start (Global MesgNum 21)
//! 4. `record` trackpoints (Global MesgNum 20)
//! 5. `event` Timer Stop All (Global MesgNum 21)
//! 6. `lap` summary (Global MesgNum 19)
//! 7. `session` summary (Global MesgNum 18)
//! 8. `activity` summary (Global MesgNum 34)
//! Plus 14-byte header CRC-16 and trailing 2-byte file CRC-16.

const CRC_TABLE: [u16; 16] = [
    0x0000, 0xCC01, 0xD801, 0x1400, 0xF001, 0x3C00, 0x2800, 0xE401,
    0xA001, 0x6C00, 0x7800, 0xB401, 0x5000, 0x9C01, 0x8801, 0x4400,
];

/// Computes the official Garmin FIT 16-bit CRC over a byte slice.
pub fn compute_fit_crc16_slice(bytes: &[u8]) -> u16 {
    let mut crc: u16 = 0;
    for &byte in bytes {
        let mut tmp = CRC_TABLE[(crc & 0x0F) as usize];
        crc = (crc >> 4) & 0x0FFF;
        crc = crc ^ tmp ^ CRC_TABLE[(byte & 0x0F) as usize];
        tmp = CRC_TABLE[(crc & 0x0F) as usize];
        crc = (crc >> 4) & 0x0FFF;
        crc = crc ^ tmp ^ CRC_TABLE[((byte >> 4) & 0x0F) as usize];
    }
    crc
}

#[derive(Clone, Copy, Debug)]
pub struct FitTrackpoint {
    pub fit_timestamp_sec: u32,
    pub power_watts: u16,
    pub speed_mms: u16,
    pub heart_rate_bpm: u8,
    pub cadence_rpm: u8,
}

pub struct FitActivityBuilder {
    pub points: Vec<FitTrackpoint>,
    pub encoded_file: Vec<u8>,
}

impl Default for FitActivityBuilder {
    fn default() -> Self {
        Self::new()
    }
}

impl FitActivityBuilder {
    pub fn new() -> Self {
        Self {
            points: Vec::with_capacity(3600),
            encoded_file: Vec::with_capacity(65536),
        }
    }

    pub fn clear(&mut self) {
        self.points.clear();
        self.encoded_file.clear();
    }

    pub fn push_point(
        &mut self,
        fit_timestamp_sec: u32,
        power_watts: u16,
        speed_mms: u16,
        heart_rate_bpm: u8,
        cadence_rpm: u8,
    ) {
        let monotonic_ts = if let Some(last) = self.points.last() {
            fit_timestamp_sec.max(last.fit_timestamp_sec + 1)
        } else {
            fit_timestamp_sec
        };
        self.points.push(FitTrackpoint {
            fit_timestamp_sec: monotonic_ts,
            power_watts: power_watts.min(4000),
            speed_mms: speed_mms.min(65_000),
            heart_rate_bpm,
            cadence_rpm: cadence_rpm.min(250),
        });
    }

    pub fn build_fit_activity(&mut self, tz_offset_sec: i32) -> &[u8] {
        // Ensure at least 2 points so total_elapsed_time >= 1000 ms
        if self.points.is_empty() {
            let default_ts = 1_100_000_000u32;
            self.push_point(default_ts, 0, 0, 0, 0);
            self.push_point(default_ts + 1, 0, 0, 0, 0);
        } else if self.points.len() == 1 {
            let p0 = self.points[0];
            self.push_point(
                p0.fit_timestamp_sec + 1,
                p0.power_watts,
                p0.speed_mms,
                p0.heart_rate_bpm,
                p0.cadence_rpm,
            );
        }

        let start_fit_sec = self.points.first().unwrap().fit_timestamp_sec;
        let end_fit_sec = self.points.last().unwrap().fit_timestamp_sec;
        let total_elapsed_ms = ((end_fit_sec.saturating_sub(start_fit_sec)).max(1)) * 1000;
        let total_timer_ms = (self.points.len() as u32).max(1) * 1000;

        let mut data: Vec<u8> = Vec::with_capacity(256 + self.points.len() * 15);

        let push_u16 = |buf: &mut Vec<u8>, v: u16| {
            buf.extend_from_slice(&v.to_le_bytes());
        };
        let push_u32 = |buf: &mut Vec<u8>, v: u32| {
            buf.extend_from_slice(&v.to_le_bytes());
        };

        // 1. file_id (Global MesgNum 0, Local 0)
        data.extend_from_slice(&[
            0x40, 0x00, 0x00, 0x00, 0x00, 0x06,
            3, 4, 0x8C, // serial_number
            4, 4, 0x86, // time_created
            1, 2, 0x84, // manufacturer
            2, 2, 0x84, // product
            5, 2, 0x84, // number
            0, 1, 0x00, // type (4 = activity)
            0x00,
        ]);
        push_u32(&mut data, 391_827_461);
        push_u32(&mut data, start_fit_sec);
        push_u16(&mut data, 1);    // Garmin
        push_u16(&mut data, 2067); // Edge 520
        push_u16(&mut data, 1);
        data.push(4);

        // 2. device_info (Global MesgNum 23, Local 1)
        data.extend_from_slice(&[
            0x41, 0x00, 0x00, 23, 0x00, 0x06,
            253, 4, 0x86,
            3, 4, 0x8C,
            2, 2, 0x84,
            4, 2, 0x84,
            5, 2, 0x84,
            0, 1, 0x02,
            0x01,
        ]);
        push_u32(&mut data, start_fit_sec);
        push_u32(&mut data, 391_827_461);
        push_u16(&mut data, 1);
        push_u16(&mut data, 2067);
        push_u16(&mut data, 100);
        data.push(0);

        // 3. event - Timer Start (Global MesgNum 21, Local 2)
        data.extend_from_slice(&[
            0x42, 0x00, 0x00, 21, 0x00, 0x04,
            253, 4, 0x86,
            0, 1, 0x00,
            1, 1, 0x00,
            4, 1, 0x02,
            0x02,
        ]);
        push_u32(&mut data, start_fit_sec);
        data.extend_from_slice(&[0, 0, 0]);

        // 4. record definition (Global MesgNum 20, Local 3)
        data.extend_from_slice(&[
            0x43, 0x00, 0x00, 20, 0x00, 0x06,
            253, 4, 0x86, // timestamp
            5, 4, 0x86,   // distance (cm)
            6, 2, 0x84,   // speed (mm/s)
            7, 2, 0x84,   // power (W)
            3, 1, 0x02,   // heart_rate (bpm or 0xFF)
            4, 1, 0x02,   // cadence (rpm)
        ]);

        let mut cum_dist_mm: u64 = 0;
        let mut total_work_j: u64 = 0;
        let mut sum_power: u64 = 0;
        let mut max_power: u16 = 0;
        let mut sum_speed_mms: u64 = 0;
        let mut max_speed_mms: u16 = 0;
        let mut sum_hr: u64 = 0;
        let mut hr_count: u64 = 0;
        let mut max_hr: u8 = 0;
        let mut sum_cad: u64 = 0;
        let mut max_cad: u8 = 0;

        for pt in &self.points {
            cum_dist_mm += pt.speed_mms as u64;
            let dist_cm = (cum_dist_mm / 10) as u32;
            let hr_byte = if pt.heart_rate_bpm > 0 {
                pt.heart_rate_bpm.clamp(30, 250)
            } else {
                0xFF
            };

            total_work_j += pt.power_watts as u64;
            sum_power += pt.power_watts as u64;
            if pt.power_watts > max_power {
                max_power = pt.power_watts;
            }
            sum_speed_mms += pt.speed_mms as u64;
            if pt.speed_mms > max_speed_mms {
                max_speed_mms = pt.speed_mms;
            }
            if hr_byte != 0xFF {
                sum_hr += hr_byte as u64;
                hr_count += 1;
                if hr_byte > max_hr {
                    max_hr = hr_byte;
                }
            }
            sum_cad += pt.cadence_rpm as u64;
            if pt.cadence_rpm > max_cad {
                max_cad = pt.cadence_rpm;
            }

            data.push(0x03);
            push_u32(&mut data, pt.fit_timestamp_sec);
            push_u32(&mut data, dist_cm);
            push_u16(&mut data, pt.speed_mms);
            push_u16(&mut data, pt.power_watts);
            data.push(hr_byte);
            data.push(pt.cadence_rpm);
        }

        // 5. event - Timer Stop All (Global MesgNum 21, Local 2)
        data.push(0x02);
        push_u32(&mut data, end_fit_sec);
        data.extend_from_slice(&[0, 4, 0]);

        let n = self.points.len() as u64;
        let total_dist_cm = (cum_dist_mm / 10) as u32;
        let avg_power = (sum_power / n) as u16;
        let avg_speed_mms = (sum_speed_mms / n) as u16;
        let avg_hr_byte = if hr_count > 0 { (sum_hr / hr_count) as u8 } else { 0xFF };
        let max_hr_byte = if hr_count > 0 { max_hr } else { 0xFF };
        let avg_cad_byte = (sum_cad / n) as u8;

        // 6. lap (Global MesgNum 19, Local 4)
        data.extend_from_slice(&[
            0x44, 0x00, 0x00, 19, 0x00, 19,
            253, 4, 0x86,
            2, 4, 0x86,
            7, 4, 0x86,
            8, 4, 0x86,
            9, 4, 0x86,
            41, 4, 0x86,
            13, 2, 0x84,
            14, 2, 0x84,
            19, 2, 0x84,
            20, 2, 0x84,
            0, 1, 0x00,
            1, 1, 0x00,
            15, 1, 0x02,
            16, 1, 0x02,
            17, 1, 0x02,
            18, 1, 0x02,
            24, 1, 0x00,
            25, 1, 0x00,
            39, 1, 0x00,
            0x04,
        ]);
        push_u32(&mut data, end_fit_sec);
        push_u32(&mut data, start_fit_sec);
        push_u32(&mut data, total_elapsed_ms);
        push_u32(&mut data, total_timer_ms);
        push_u32(&mut data, total_dist_cm);
        push_u32(&mut data, total_work_j as u32);
        push_u16(&mut data, avg_speed_mms);
        push_u16(&mut data, max_speed_mms);
        push_u16(&mut data, avg_power);
        push_u16(&mut data, max_power);
        data.extend_from_slice(&[
            9,
            1,
            avg_hr_byte,
            max_hr_byte,
            avg_cad_byte,
            max_cad,
            7,
            2,
            6,
        ]);

        // 7. session (Global MesgNum 18, Local 5)
        data.extend_from_slice(&[
            0x45, 0x00, 0x00, 18, 0x00, 21,
            253, 4, 0x86,
            2, 4, 0x86,
            7, 4, 0x86,
            8, 4, 0x86,
            9, 4, 0x86,
            48, 4, 0x86,
            14, 2, 0x84,
            15, 2, 0x84,
            20, 2, 0x84,
            21, 2, 0x84,
            25, 2, 0x84,
            26, 2, 0x84,
            0, 1, 0x00,
            1, 1, 0x00,
            5, 1, 0x00,
            6, 1, 0x00,
            16, 1, 0x02,
            17, 1, 0x02,
            18, 1, 0x02,
            19, 1, 0x02,
            28, 1, 0x00,
            0x05,
        ]);
        push_u32(&mut data, end_fit_sec);
        push_u32(&mut data, start_fit_sec);
        push_u32(&mut data, total_elapsed_ms);
        push_u32(&mut data, total_timer_ms);
        push_u32(&mut data, total_dist_cm);
        push_u32(&mut data, total_work_j as u32);
        push_u16(&mut data, avg_speed_mms);
        push_u16(&mut data, max_speed_mms);
        push_u16(&mut data, avg_power);
        push_u16(&mut data, max_power);
        push_u16(&mut data, 0);
        push_u16(&mut data, 1);
        data.extend_from_slice(&[
            8,
            1,
            2,
            6,
            avg_hr_byte,
            max_hr_byte,
            avg_cad_byte,
            max_cad,
            0,
        ]);

        // 8. activity (Global MesgNum 34, Local 6)
        let local_end = (end_fit_sec as i64 + tz_offset_sec as i64).max(0) as u32;
        data.extend_from_slice(&[
            0x46, 0x00, 0x00, 34, 0x00, 0x07,
            253, 4, 0x86,
            0, 4, 0x86,
            5, 4, 0x86,
            1, 2, 0x84,
            2, 1, 0x00,
            3, 1, 0x00,
            4, 1, 0x00,
            0x06,
        ]);
        push_u32(&mut data, end_fit_sec);
        push_u32(&mut data, total_timer_ms);
        push_u32(&mut data, local_end);
        push_u16(&mut data, 1);
        data.extend_from_slice(&[0, 26, 1]);

        let data_size = data.len() as u32;
        self.encoded_file.clear();
        self.encoded_file.reserve(14 + data.len() + 2);

        // 14-byte FIT file header
        self.encoded_file.push(14);
        self.encoded_file.push(0x10);
        self.encoded_file.push(0x41);
        self.encoded_file.push(0x08);
        self.encoded_file.extend_from_slice(&data_size.to_le_bytes());
        self.encoded_file.extend_from_slice(b".FIT");
        let header_crc = compute_fit_crc16_slice(&self.encoded_file[0..12]);
        self.encoded_file.extend_from_slice(&header_crc.to_le_bytes());

        self.encoded_file.extend_from_slice(&data);
        let file_crc = compute_fit_crc16_slice(&self.encoded_file);
        self.encoded_file.extend_from_slice(&file_crc.to_le_bytes());

        &self.encoded_file
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_fit_activity_binary_encoding_and_crc_validation() {
        let mut builder = FitActivityBuilder::new();
        let base_ts = 1_140_000_000u32;
        for i in 0..10 {
            builder.push_point(base_ts + i, 240 + (i as u16) * 5, 9500, 148, 90);
        }

        let bytes = builder.build_fit_activity(-21600);
        assert!(bytes.len() > 150);
        assert_eq!(bytes[0], 14);
        assert_eq!(&bytes[8..12], b".FIT");

        // Verify 14-byte header CRC
        let expected_hdr_crc = compute_fit_crc16_slice(&bytes[0..12]);
        let actual_hdr_crc = u16::from_le_bytes([bytes[12], bytes[13]]);
        assert_eq!(expected_hdr_crc, actual_hdr_crc);

        // Verify full file CRC (evaluating CRC over entire file including trailer yields 0)
        let expected_file_crc = compute_fit_crc16_slice(&bytes[0..bytes.len() - 2]);
        let actual_file_crc =
            u16::from_le_bytes([bytes[bytes.len() - 2], bytes[bytes.len() - 1]]);
        assert_eq!(expected_file_crc, actual_file_crc);
        assert_eq!(compute_fit_crc16_slice(bytes), 0);
    }
}
