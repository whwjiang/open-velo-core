//! Stateful 1Hz & Sub-Second Ride Session Engine
//!
//! Coordinates:
//! - Time-windowed 3s, 10s, and 30s rolling power averages
//! - Skiba differential `W'bal` anaerobic reserve integration
//! - Normalized Power (`NP`) fourth-power accumulator
//! - Active workout interval power & cadence target compliance

use crate::compliance::{
    compute_cadence_compliance_score, compute_power_compliance_score,
    summarize_interval_compliance, IntervalComplianceSummary,
};
use crate::physiology::{compute_wbal_step, compute_window_power_avg, PowerSample};

#[derive(Clone, Debug)]
pub struct RideSessionState {
    pub ftp_watts: u32,
    pub weight_tenths_kg: u32,
    pub w_prime_max_j: i32,
    pub w_prime_bal_j: i32,

    // Time-windowed power samples (last 30,000 ms)
    pub power_window: Vec<PowerSample>,
    pub ring_30s: Vec<u32>,

    // Session accumulators
    pub elapsed_sec: u32,
    pub current_power_watts: u32,
    pub max_power_watts: u32,
    pub power_sum: u64,
    pub power_samples: u32,
    pub fourth_power_sum: f64,
    pub fourth_power_count: u32,

    pub current_hr_bpm: u32,
    pub max_hr_bpm: u32,
    pub hr_sum: u64,
    pub hr_samples: u32,

    pub current_cadence_rpm: u32,
    pub max_cadence_rpm: u32,
    pub cadence_sum: u64,
    pub cadence_samples: u32,

    pub current_speed_tenths_kph: u32,
    pub distance_cm: u64,
    pub work_joules: u64,

    // Active workout interval accumulators
    pub interval_power_sum: u64,
    pub interval_power_samples: u32,
    pub interval_compliance_sum: u64,
    pub interval_cadence_compliance_sum: u64,
    pub interval_compliance_samples: u32,
    pub last_completed_interval_compliance_pct: u32,
    pub last_completed_interval_duration_sec: u32,

    // Sensor rollover state
    pub prev_ant_event_count: i32,
    pub prev_ant_accum_power: u32,
    pub prev_ble_crank_revs: i32,
    pub prev_ble_crank_time_1024: u32,
}

impl Default for RideSessionState {
    fn default() -> Self {
        Self::new()
    }
}

impl RideSessionState {
    pub fn new() -> Self {
        Self {
            ftp_watts: 280,
            weight_tenths_kg: 720,
            w_prime_max_j: 22_000,
            w_prime_bal_j: 22_000,
            power_window: Vec::with_capacity(256),
            ring_30s: Vec::with_capacity(32),
            elapsed_sec: 0,
            current_power_watts: 0,
            max_power_watts: 0,
            power_sum: 0,
            power_samples: 0,
            fourth_power_sum: 0.0,
            fourth_power_count: 0,
            current_hr_bpm: 0,
            max_hr_bpm: 0,
            hr_sum: 0,
            hr_samples: 0,
            current_cadence_rpm: 0,
            max_cadence_rpm: 0,
            cadence_sum: 0,
            cadence_samples: 0,
            current_speed_tenths_kph: 0,
            distance_cm: 0,
            work_joules: 0,
            interval_power_sum: 0,
            interval_power_samples: 0,
            interval_compliance_sum: 0,
            interval_cadence_compliance_sum: 0,
            interval_compliance_samples: 0,
            last_completed_interval_compliance_pct: 100,
            last_completed_interval_duration_sec: 0,
            prev_ant_event_count: -1,
            prev_ant_accum_power: 0,
            prev_ble_crank_revs: -1,
            prev_ble_crank_time_1024: 0,
        }
    }

    pub fn reset(&mut self) {
        let ftp = self.ftp_watts;
        let weight = self.weight_tenths_kg;
        let wmax = self.w_prime_max_j;
        *self = Self::new();
        self.ftp_watts = ftp;
        self.weight_tenths_kg = weight;
        self.w_prime_max_j = wmax;
        self.w_prime_bal_j = wmax;
    }

    pub fn record_power(&mut self, watts: u32, timestamp_ms: f64) {
        let clamped = watts.min(2500) as u16;
        self.current_power_watts = clamped as u32;
        if (clamped as u32) > self.max_power_watts {
            self.max_power_watts = clamped as u32;
        }
        self.power_window.push(PowerSample {
            timestamp_ms,
            watts: clamped,
        });
        let cutoff = timestamp_ms - 30_000.0;
        while let Some(first) = self.power_window.first() {
            if first.timestamp_ms < cutoff {
                self.power_window.remove(0);
            } else {
                break;
            }
        }
    }

    pub fn window_power_avg(&self, window_ms: f64, now_ms: f64) -> u32 {
        compute_window_power_avg(
            &self.power_window,
            window_ms,
            now_ms,
            self.current_power_watts,
        )
    }

    pub fn tick_1hz(
        &mut self,
        power_watts: u32,
        hr_bpm: u32,
        cadence_rpm: u32,
        speed_tenths_kph: u32,
        target_watts: u32,
        target_cadence_rpm: u32,
    ) {
        self.elapsed_sec += 1;
        let pwr = power_watts.min(2500);
        self.current_power_watts = pwr;
        self.current_hr_bpm = hr_bpm.min(250);
        self.current_cadence_rpm = cadence_rpm.min(250);
        self.current_speed_tenths_kph = speed_tenths_kph.min(1200);

        if pwr > self.max_power_watts {
            self.max_power_watts = pwr;
        }
        if self.current_hr_bpm > self.max_hr_bpm {
            self.max_hr_bpm = self.current_hr_bpm;
        }
        if self.current_cadence_rpm > self.max_cadence_rpm {
            self.max_cadence_rpm = self.current_cadence_rpm;
        }

        self.ring_30s.push(pwr);
        if self.ring_30s.len() > 30 {
            self.ring_30s.remove(0);
        }
        let avg_30s = if self.ring_30s.is_empty() {
            pwr as f64
        } else {
            (self.ring_30s.iter().copied().sum::<u32>() as f64) / (self.ring_30s.len() as f64)
        };
        self.fourth_power_sum += avg_30s.powi(4);
        self.fourth_power_count += 1;

        self.power_sum += pwr as u64;
        self.power_samples += 1;
        self.interval_power_sum += pwr as u64;
        self.interval_power_samples += 1;

        if self.current_hr_bpm > 0 {
            self.hr_sum += self.current_hr_bpm as u64;
            self.hr_samples += 1;
        }
        self.cadence_sum += self.current_cadence_rpm as u64;
        self.cadence_samples += 1;

        // Speed in tenths km/h -> cm per second: (kph / 3.6) * 100 = tenths_kph * 10 / 3.6
        let cm_inc = ((self.current_speed_tenths_kph as f64) * 10.0 / 3.6).round() as u64;
        self.distance_cm += cm_inc;
        self.work_joules += pwr as u64;

        self.w_prime_bal_j = compute_wbal_step(
            self.w_prime_bal_j,
            self.w_prime_max_j,
            pwr as i32,
            self.ftp_watts as i32,
        );

        let pwr_score = compute_power_compliance_score(pwr, target_watts);
        let cad_score =
            compute_cadence_compliance_score(self.current_cadence_rpm, target_cadence_rpm);
        self.interval_compliance_sum += pwr_score as u64;
        self.interval_cadence_compliance_sum += cad_score as u64;
        self.interval_compliance_samples += 1;
    }

    /// Completes the current workout interval, summarizes target compliance, and resets interval accumulators.
    pub fn complete_interval_and_reset(&mut self) -> IntervalComplianceSummary {
        let pwr_comp = self.interval_power_compliance_pct();
        let cad_comp = self.interval_cadence_compliance_pct();
        let summary =
            summarize_interval_compliance(pwr_comp, cad_comp, self.interval_power_samples);

        self.last_completed_interval_compliance_pct = summary.overall_compliance_pct;
        self.last_completed_interval_duration_sec = summary.duration_sec;

        self.interval_power_sum = 0;
        self.interval_power_samples = 0;
        self.interval_compliance_sum = 0;
        self.interval_cadence_compliance_sum = 0;
        self.interval_compliance_samples = 0;

        summary
    }

    pub fn interval_power_avg(&self, fallback: u32) -> u32 {
        if self.interval_power_samples > 0 {
            ((self.interval_power_sum as f64) / (self.interval_power_samples as f64)).round() as u32
        } else {
            fallback
        }
    }

    pub fn interval_power_compliance_pct(&self) -> u32 {
        if self.interval_compliance_samples > 0 {
            ((self.interval_compliance_sum as f64) / (self.interval_compliance_samples as f64))
                .round() as u32
        } else {
            100
        }
    }

    pub fn interval_cadence_compliance_pct(&self) -> u32 {
        if self.interval_compliance_samples > 0 {
            ((self.interval_cadence_compliance_sum as f64)
                / (self.interval_compliance_samples as f64))
            .round() as u32
        } else {
            100
        }
    }

    pub fn normalized_power(&self, fallback_30s: u32) -> u32 {
        if self.fourth_power_count > 0 {
            (self.fourth_power_sum / (self.fourth_power_count as f64))
                .powf(0.25)
                .round() as u32
        } else {
            fallback_30s
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_session_1hz_and_interval_completion() {
        let mut session = RideSessionState::new();
        for _ in 0..30 {
            session.tick_1hz(282, 155, 91, 340, 280, 90);
        }
        assert_eq!(session.interval_power_compliance_pct(), 100);
        assert_eq!(session.interval_cadence_compliance_pct(), 100);

        let summary = session.complete_interval_and_reset();
        assert_eq!(summary.overall_compliance_pct, 100);
        assert_eq!(summary.duration_sec, 30);
    }
}
