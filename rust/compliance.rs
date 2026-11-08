//! Workout Target Compliance Evaluation (`rust/compliance.rs`)
//!
//! Pure training compliance math evaluating how closely a rider tracks structured
//! workout power and cadence targets over each 1Hz sample and interval segment.

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct IntervalComplianceSummary {
    pub power_compliance_pct: u32,
    pub cadence_compliance_pct: u32,
    pub overall_compliance_pct: u32,
    pub duration_sec: u32,
}

/// Computes a `0..100` compliance score for instantaneous/3s power vs target power.
/// Within ±5% of target = 100%. Graded linear falloff down to 0% at ±35% deviation.
#[inline]
pub fn compute_power_compliance_score(actual_watts: u32, target_watts: u32) -> u32 {
    if target_watts == 0 {
        return 100;
    }
    let diff = (actual_watts as i32 - target_watts as i32).unsigned_abs();
    let ratio_pct = (diff * 100) / target_watts.max(1);
    if ratio_pct <= 5 {
        100
    } else if ratio_pct >= 35 {
        0
    } else {
        100 - (((ratio_pct - 5) * 100) / 30)
    }
}

/// Computes a `0..100` compliance score for cadence vs target cadence RPM.
/// Within ±5 RPM = 100%. Graded falloff down to 0% at ±25 RPM deviation.
#[inline]
pub fn compute_cadence_compliance_score(actual_rpm: u32, target_rpm: u32) -> u32 {
    if target_rpm == 0 {
        return 100;
    }
    let diff = (actual_rpm as i32 - target_rpm as i32).unsigned_abs();
    if diff <= 5 {
        100
    } else if diff >= 25 {
        0
    } else {
        100 - (((diff - 5) * 100) / 20)
    }
}

/// Evaluates the completed interval's power, cadence, and weighted overall compliance (`80%` power, `20%` cadence).
pub fn summarize_interval_compliance(
    power_compliance_pct: u32,
    cadence_compliance_pct: u32,
    interval_duration_sec: u32,
) -> IntervalComplianceSummary {
    let overall = ((power_compliance_pct * 80) + (cadence_compliance_pct * 20)) / 100;
    IntervalComplianceSummary {
        power_compliance_pct,
        cadence_compliance_pct,
        overall_compliance_pct: overall,
        duration_sec: interval_duration_sec,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_power_and_cadence_compliance_curves() {
        assert_eq!(compute_power_compliance_score(255, 250), 100);
        assert_eq!(compute_power_compliance_score(200, 250), 50);
        assert_eq!(compute_power_compliance_score(140, 250), 0);

        assert_eq!(compute_cadence_compliance_score(92, 90), 100);
        assert_eq!(compute_cadence_compliance_score(75, 90), 50);
        assert_eq!(compute_cadence_compliance_score(60, 90), 0);
    }

    #[test]
    fn test_interval_compliance_summary() {
        let summary = summarize_interval_compliance(90, 80, 60);
        assert_eq!(summary.power_compliance_pct, 90);
        assert_eq!(summary.cadence_compliance_pct, 80);
        assert_eq!(summary.overall_compliance_pct, 88);
        assert_eq!(summary.duration_sec, 60);
    }
}
