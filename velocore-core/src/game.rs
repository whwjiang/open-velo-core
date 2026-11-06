//! Newspaper Delivery Game Mechanics & Interval Compliance Scoring Layer
//!
//! Designed for plug-and-play RPG/Arcade frontends (EarthBound / Stardew Valley / Paperboy style),
//! where each structured workout interval corresponds to a house/route block and rider compliance
//! determines throw accuracy, delivery tier, and coin/tip rewards.

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct CompletedIntervalReward {
    pub blended_compliance_pct: u32,
    /// `3` = Gold (Mailbox Bullseye), `2` = Silver (Porch), `1` = Bronze (Lawn), `0` = Missed (Window)
    pub delivery_tier: u32,
    pub coins_earned: u32,
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

/// Maps a `0..100` compliance percentage to a Newspaper Delivery Tier:
/// - `3`: Gold (Mailbox Bullseye, >= 88%)
/// - `2`: Silver (Porch Hit, >= 70%)
/// - `1`: Bronze (Lawn Landing, >= 50%)
/// - `0`: Missed / Window Crash (< 50%)
#[inline]
pub fn classify_delivery_tier(compliance_pct: u32) -> u32 {
    if compliance_pct >= 88 {
        3
    } else if compliance_pct >= 70 {
        2
    } else if compliance_pct >= 50 {
        1
    } else {
        0
    }
}

/// Evaluates the completed interval's blended compliance, delivery tier, and coin payout.
pub fn score_completed_interval(
    power_compliance_pct: u32,
    cadence_compliance_pct: u32,
    interval_duration_sec: u32,
) -> CompletedIntervalReward {
    let blended = ((power_compliance_pct * 80) + (cadence_compliance_pct * 20)) / 100;
    let tier = classify_delivery_tier(blended);
    let duration_bonus = (interval_duration_sec / 15).max(1);
    let base_coins = match tier {
        3 => 50, // Gold / Mailbox Bullseye
        2 => 30, // Silver / Porch Landing
        1 => 15, // Bronze / Lawn Delivery
        _ => 5,  // Participation / Broken Window
    };
    CompletedIntervalReward {
        blended_compliance_pct: blended,
        delivery_tier: tier,
        coins_earned: base_coins * duration_bonus,
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
    fn test_house_delivery_tier_and_coin_rewards() {
        let gold = score_completed_interval(100, 100, 30);
        assert_eq!(gold.delivery_tier, 3);
        assert_eq!(gold.coins_earned, 100);

        let silver = score_completed_interval(75, 80, 30);
        assert_eq!(silver.delivery_tier, 2);
        assert_eq!(silver.coins_earned, 60);
    }
}
