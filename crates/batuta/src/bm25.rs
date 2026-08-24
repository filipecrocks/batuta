//! BM25. Parameters frozen in the SPEC — changing them without changing the
//! conformance suite means moving the ruler mid-way through the historical series.

use crate::index::Index;

pub const K1: f64 = 1.5;
pub const B: f64 = 0.75;

/// Below this the router stays silent. A false positive costs more than a false
/// negative: a skill suggested for no reason enters the context, spends tokens and
/// teaches the model to ignore the suggestion. The value 2.0 comes from v0.1 — at
/// 3.2 the router went mute in 3 of 7 legitimate cases.
pub const NOISE_CUTOFF: f64 = 2.0;

/// Maximum number of skills that come out of a route.
pub const MAX_SUGGESTIONS: usize = 3;

/// Whoever doesn't reach this fraction of the top scorer doesn't make the cut.
pub const TOP_FRACTION: f64 = 0.55;

#[derive(Debug, Clone)]
pub struct Match {
    pub skill: u32,
    pub score: f64,
}

pub fn idf(n: usize, df: usize) -> f64 {
    let n = n as f64;
    let df = df as f64;
    (1.0 + (n - df + 0.5) / (df + 0.5)).ln()
}

/// Scores all skills against the query terms and returns the list already pruned
/// by the noise cutoff, the suggestion cap, and the top-score fraction.
pub fn score(idx: &Index, terms: &[String]) -> Vec<Match> {
    let n = idx.skills.len();
    if n == 0 || terms.is_empty() {
        return Vec::new();
    }

    let mut scores = vec![0.0f64; n];
    let mut seen: Vec<&str> = Vec::with_capacity(terms.len());

    for t in terms {
        // repeated term in the query counts only once
        if seen.contains(&t.as_str()) {
            continue;
        }
        seen.push(t.as_str());

        let Some(list) = idx.postings.get(t) else {
            continue;
        };
        if list.is_empty() {
            continue;
        }
        let weight = idf(n, list.len());
        for (i, tf) in list {
            let i = *i as usize;
            if i >= n {
                continue;
            }
            let size = idx.skills[i].size as f64;
            let tf = *tf as f64;
            let denom = tf + K1 * (1.0 - B + B * size / idx.avg_size);
            scores[i] += weight * (tf * (K1 + 1.0)) / denom;
        }
    }

    let mut matches: Vec<Match> = scores
        .iter()
        .enumerate()
        .filter(|(_, v)| **v >= NOISE_CUTOFF)
        .map(|(i, v)| Match {
            skill: i as u32,
            score: *v,
        })
        .collect();

    // stable and deterministic order: score desc, then index asc
    matches.sort_by(|a, b| {
        b.score
            .partial_cmp(&a.score)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then(a.skill.cmp(&b.skill))
    });

    if let Some(top) = matches.first().map(|a| a.score) {
        let floor = top * TOP_FRACTION;
        matches.retain(|a| a.score >= floor);
    }
    matches.truncate(MAX_SUGGESTIONS);
    matches
}
