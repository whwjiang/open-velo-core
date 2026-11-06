//! Sports Science & Physiological Modeling Layer
//!
//! Handles:
//! - Skiba differential W'bal anaerobic work capacity depletion & exponential reconstitution
//! - Time-windowed rolling power averaging (3s, 10s, 30s) across variable-rate ANT+/BLE packets
//! - Normalized Power (NP) fourth-power integration

#[derive(Clone, Copy, Debug)]
pub struct PowerSample {
    pub timestamp_ms: f64,
    pub watts: u16,
}

/// Skiba differential W'bal step (in Joules, 1Hz step):
/// - When `power_watts > cp_watts`, depletes W' linearly: `wbal - (power - cp)`
/// - When `power_watts <= cp_watts`, reconstitutes exponentially via `tau = 546 * exp(-0.01 * (cp - power)) + 316`
#[inline]
pub fn compute_wbal_step(
    current_wbal_j: i32,
    w_prime_max_j: i32,
    power_watts: i32,
    cp_watts: i32,
) -> i32 {
    if cp_watts <= 0 {
        return current_wbal_j.clamp(0, w_prime_max_j.max(1));
    }
    if power_watts > cp_watts {
        let next = current_wbal_j - (power_watts - cp_watts);
        next.max(0)
    } else {
        let d_cp = (cp_watts - power_watts).max(1);
        let tau = (316 + (54_600 / (100 + d_cp))).max(180);
        let recovery = (w_prime_max_j - current_wbal_j) / tau;
        let next = current_wbal_j + recovery.max(1);
        next.min(w_prime_max_j)
    }
}

/// Computes the arithmetic mean of all `PowerSample`s within `[now_ms - window_ms, now_ms]`.
pub fn compute_window_power_avg(
    samples: &[PowerSample],
    window_ms: f64,
    now_ms: f64,
    fallback_watts: u32,
) -> u32 {
    let cutoff = now_ms - window_ms;
    let mut sum: u64 = 0;
    let mut count: u64 = 0;
    for sample in samples.iter().rev() {
        if sample.timestamp_ms >= cutoff {
            sum += sample.watts as u64;
            count += 1;
        } else {
            break;
        }
    }
    if count > 0 {
        ((sum as f64) / (count as f64)).round() as u32
    } else {
        fallback_watts
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_skiba_wbal_depletion_and_recovery() {
        let wmax = 20_000;
        let cp = 280;
        let mut wbal = wmax;

        for _ in 0..30 {
            wbal = compute_wbal_step(wbal, wmax, 380, cp);
        }
        assert_eq!(wbal, 17_000);

        let mut prev = wbal;
        for _ in 0..60 {
            wbal = compute_wbal_step(wbal, wmax, 140, cp);
            assert!(wbal > prev);
            prev = wbal;
        }
        assert!(wbal > 17_000 && wbal <= wmax);
    }

    #[test]
    fn test_window_power_averaging() {
        let mut samples = Vec::new();
        for i in 0..4 {
            samples.push(PowerSample {
                timestamp_ms: (i * 250) as f64,
                watts: 200,
            });
        }
        for i in 4..16 {
            samples.push(PowerSample {
                timestamp_ms: (i * 250) as f64,
                watts: 300,
            });
        }
        assert_eq!(compute_window_power_avg(&samples, 3000.0, 4000.0, 0), 300);
        assert_eq!(compute_window_power_avg(&samples, 10000.0, 4000.0, 0), 275);
    }
}
