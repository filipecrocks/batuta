//! BM25. Parameters frozen in the SPEC — changing them without changing the
//! conformance suite means moving the ruler mid-way through the historical series.

use crate::indice::Indice;

pub const K1: f64 = 1.5;
pub const B: f64 = 0.75;

/// Below this the router stays silent. A false positive costs more than a false
/// negative: a skill suggested for no reason enters the context, spends tokens and
/// teaches the model to ignore the suggestion. The value 2.0 comes from v0.1 — at
/// 3.2 the router went mute in 3 of 7 legitimate cases.
pub const CORTE_RUIDO: f64 = 2.0;

/// Maximum number of skills that come out of a route.
pub const MAX_SUGESTOES: usize = 3;

/// Whoever doesn't reach this fraction of the top scorer doesn't make the cut.
pub const FRACAO_DO_TOPO: f64 = 0.55;

#[derive(Debug, Clone)]
pub struct Acerto {
    pub skill: u32,
    pub nota: f64,
}

pub fn idf(n: usize, df: usize) -> f64 {
    let n = n as f64;
    let df = df as f64;
    (1.0 + (n - df + 0.5) / (df + 0.5)).ln()
}

/// Scores all skills against the query terms and returns the list already pruned
/// by the noise cutoff, the suggestion cap, and the top-score fraction.
pub fn pontuar(idx: &Indice, termos: &[String]) -> Vec<Acerto> {
    let n = idx.skills.len();
    if n == 0 || termos.is_empty() {
        return Vec::new();
    }

    let mut notas = vec![0.0f64; n];
    let mut vistos: Vec<&str> = Vec::with_capacity(termos.len());

    for t in termos {
        // repeated term in the query counts only once
        if vistos.contains(&t.as_str()) {
            continue;
        }
        vistos.push(t.as_str());

        let Some(lista) = idx.postings.get(t) else {
            continue;
        };
        if lista.is_empty() {
            continue;
        }
        let peso = idf(n, lista.len());
        for (i, tf) in lista {
            let i = *i as usize;
            if i >= n {
                continue;
            }
            let tam = idx.skills[i].tam as f64;
            let tf = *tf as f64;
            let denom = tf + K1 * (1.0 - B + B * tam / idx.media_tam);
            notas[i] += peso * (tf * (K1 + 1.0)) / denom;
        }
    }

    let mut acertos: Vec<Acerto> = notas
        .iter()
        .enumerate()
        .filter(|(_, v)| **v >= CORTE_RUIDO)
        .map(|(i, v)| Acerto {
            skill: i as u32,
            nota: *v,
        })
        .collect();

    // stable and deterministic order: score desc, then index asc
    acertos.sort_by(|a, b| {
        b.nota
            .partial_cmp(&a.nota)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then(a.skill.cmp(&b.skill))
    });

    if let Some(topo) = acertos.first().map(|a| a.nota) {
        let piso = topo * FRACAO_DO_TOPO;
        acertos.retain(|a| a.nota >= piso);
    }
    acertos.truncate(MAX_SUGESTOES);
    acertos
}
