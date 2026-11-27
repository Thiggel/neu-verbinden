//! German number formatting for the texts the engine writes.
//!
//! The explanations, notes and bases are shown verbatim in a German interface,
//! so decimals take a comma and thousands a point, as `toLocaleString('de-DE')`
//! does on the web side.

/// Formats `x` with `prec` decimals, a decimal comma and a thousands point.
pub fn de(x: f64, prec: usize) -> String {
    let s = format!("{:.*}", prec, x);
    let (sign, s) = match s.strip_prefix('-') {
        Some(rest) => ("-", rest),
        None => ("", s.as_str()),
    };
    let (int, frac) = match s.split_once('.') {
        Some((i, f)) => (i, Some(f)),
        None => (s, None),
    };
    let mut grouped = String::with_capacity(int.len() + int.len() / 3);
    for (i, ch) in int.chars().enumerate() {
        if i > 0 && (int.len() - i) % 3 == 0 {
            grouped.push('.');
        }
        grouped.push(ch);
    }
    // "-0" and "-0,0" read as noise once rounded.
    let sign = if int.chars().all(|c| c == '0') && frac.map_or(true, |f| f.chars().all(|c| c == '0')) {
        ""
    } else {
        sign
    };
    match frac {
        Some(f) => format!("{sign}{grouped},{f}"),
        None => format!("{sign}{grouped}"),
    }
}

#[cfg(test)]
mod tests {
    use super::de;

    #[test]
    fn german_separators() {
        assert_eq!(de(2.31, 2), "2,31");
        assert_eq!(de(96.9, 1), "96,9");
        assert_eq!(de(0.0, 0), "0");
        assert_eq!(de(999.0, 0), "999");
        assert_eq!(de(1500.0, 0), "1.500");
        assert_eq!(de(1234567.891, 2), "1.234.567,89");
        assert_eq!(de(-12345.6, 1), "-12.345,6");
        assert_eq!(de(-0.04, 1), "0,0");
    }
}
