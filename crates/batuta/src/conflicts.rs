//! `batuta conflicts` — skills that compete for the same turn.
//!
//! The idea of grouping similar skills and suggesting disambiguation comes from
//! SkillPilot (RealTapeL/SkillPilot, MIT license). The implementation here is our
//! own — cosine similarity over tf-idf from the index that already exists — but
//! credit for the idea goes to them.
//!
//! Why it matters: two skills that say almost the same thing make the router
//! oscillate between them for no reason, and each one's trigger data gets dirty.
//! This is a cold path: it can take a while.

use crate::bm25::idf;
use crate::index::Index;
use std::collections::BTreeMap;

/// Above this, the pair enters the report. Calibrated to catch real overlap
/// without flooding the screen: skills in the same domain sit at 0.3-0.5;
/// near-duplicates go above 0.6.
pub const THRESHOLD: f64 = 0.55;

pub fn report(idx: &Index) -> String {
    let n = idx.skills.len();
    if n < 2 {
        return "batuta conflicts: fewer than two skills indexed, nothing to compare.\n"
            .to_string();
    }

    // sparse tf-idf vector per skill
    let mut vectors: Vec<BTreeMap<&str, f64>> = vec![BTreeMap::new(); n];
    for (term, list) in &idx.postings {
        let weight = idf(n, list.len());
        if weight <= 0.0 {
            continue;
        }
        for (i, tf) in list {
            let i = *i as usize;
            if i < n {
                vectors[i].insert(term.as_str(), (*tf as f64).sqrt() * weight);
            }
        }
    }
    let norms: Vec<f64> = vectors
        .iter()
        .map(|v| v.values().map(|x| x * x).sum::<f64>().sqrt().max(1e-9))
        .collect();

    let mut pairs: Vec<(f64, usize, usize)> = Vec::new();
    for a in 0..n {
        for b in (a + 1)..n {
            let (smaller, larger) = if vectors[a].len() < vectors[b].len() {
                (&vectors[a], &vectors[b])
            } else {
                (&vectors[b], &vectors[a])
            };
            let mut dot = 0.0;
            for (t, x) in smaller {
                if let Some(y) = larger.get(t) {
                    dot += x * y;
                }
            }
            let cos = dot / (norms[a] * norms[b]);
            if cos >= THRESHOLD {
                pairs.push((cos, a, b));
            }
        }
    }

    if pairs.is_empty() {
        return format!(
            "batuta conflicts: {} skills compared, no pair above {:.2}.\n\
             No obvious overlap — each one's trigger data is clean.\n",
            n, THRESHOLD
        );
    }

    pairs.sort_by(|x, y| y.0.partial_cmp(&x.0).unwrap_or(std::cmp::Ordering::Equal));
    let mut s = format!(
        "batuta conflicts — {} pair(s) above {:.2} among {} skills\n\
         (idea borrowed from SkillPilot, MIT — implementation our own)\n\n",
        pairs.len(),
        THRESHOLD,
        n
    );
    for (cos, a, b) in pairs.iter().take(40) {
        s.push_str(&format!(
            "  {:.2}  {}  <->  {}\n        {}\n        {}\n",
            cos, idx.skills[*a].name, idx.skills[*b].name, idx.skills[*a].path, idx.skills[*b].path
        ));
        s.push_str(
            "        suggestion: make explicit in EACH ONE's description what it does NOT do.\n\n",
        );
    }
    if pairs.len() > 40 {
        s.push_str(&format!("  ... and {} more pairs.\n", pairs.len() - 40));
    }
    s
}
