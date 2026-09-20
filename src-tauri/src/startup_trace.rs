//! Opt-in startup timings for reproducible QA measurements.
//!
//! The trace is disabled unless MARKNOTE_STARTUP_TRACE=1 is inherited by the
//! process. Keeping the clock and gate here avoids adding logging or a timer
//! allocation to normal application launches.

use std::{env, sync::OnceLock, time::Instant};

static START: OnceLock<Instant> = OnceLock::new();
static ENABLED: OnceLock<bool> = OnceLock::new();

pub(crate) fn begin() {
    let _ = ENABLED.set(matches!(
        env::var("MARKNOTE_STARTUP_TRACE").as_deref(),
        Ok("1") | Ok("true") | Ok("TRUE")
    ));
    let _ = START.set(Instant::now());
}

pub(crate) fn mark(stage: &str) {
    if !ENABLED.get().copied().unwrap_or(false) {
        return;
    }
    let Some(start) = START.get() else {
        return;
    };
    eprintln!(
        "[marknote-startup] stage={stage} elapsed_ms={:.3}",
        start.elapsed().as_secs_f64() * 1_000.0
    );
}
