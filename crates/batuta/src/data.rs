//! Data sem dependencia: epoch -> YYYY-MM-DD em UTC.
//! Algoritmo civil_from_days de Howard Hinnant, dominio publico.

pub fn dia_utc(epoch: u64) -> String {
    let (a, m, d) = civil(epoch as i64 / 86_400);
    format!("{:04}-{:02}-{:02}", a, m, d)
}

pub fn instante_utc(epoch: u64) -> String {
    let dia = dia_utc(epoch);
    let s = epoch % 86_400;
    format!(
        "{}T{:02}:{:02}:{:02}Z",
        dia,
        s / 3600,
        (s % 3600) / 60,
        s % 60
    )
}

fn civil(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (if m <= 2 { y + 1 } else { y }, m, d)
}

#[cfg(test)]
mod t {
    use super::*;
    #[test]
    fn marcos() {
        assert_eq!(dia_utc(0), "1970-01-01");
        assert_eq!(dia_utc(1_000_000_000), "2001-09-09");
        assert_eq!(dia_utc(1_756_000_000), "2025-08-24");
        assert_eq!(instante_utc(0), "1970-01-01T00:00:00Z");
    }
}
