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
use crate::indice::Indice;
use std::collections::BTreeMap;

/// Above this, the pair enters the report. Calibrated to catch real overlap
/// without flooding the screen: skills in the same domain sit at 0.3-0.5;
/// near-duplicates go above 0.6.
pub const LIMIAR: f64 = 0.55;

pub fn relatorio(idx: &Indice) -> String {
    let n = idx.skills.len();
    if n < 2 {
        return "batuta conflicts: menos de duas skills indexadas, nada a comparar.\n".to_string();
    }

    // sparse tf-idf vector per skill
    let mut vetores: Vec<BTreeMap<&str, f64>> = vec![BTreeMap::new(); n];
    for (termo, lista) in &idx.postings {
        let peso = idf(n, lista.len());
        if peso <= 0.0 {
            continue;
        }
        for (i, tf) in lista {
            let i = *i as usize;
            if i < n {
                vetores[i].insert(termo.as_str(), (*tf as f64).sqrt() * peso);
            }
        }
    }
    let normas: Vec<f64> = vetores
        .iter()
        .map(|v| v.values().map(|x| x * x).sum::<f64>().sqrt().max(1e-9))
        .collect();

    let mut pares: Vec<(f64, usize, usize)> = Vec::new();
    for a in 0..n {
        for b in (a + 1)..n {
            let (menor, maior) = if vetores[a].len() < vetores[b].len() {
                (&vetores[a], &vetores[b])
            } else {
                (&vetores[b], &vetores[a])
            };
            let mut prod = 0.0;
            for (t, x) in menor {
                if let Some(y) = maior.get(t) {
                    prod += x * y;
                }
            }
            let cos = prod / (normas[a] * normas[b]);
            if cos >= LIMIAR {
                pares.push((cos, a, b));
            }
        }
    }

    if pares.is_empty() {
        return format!(
            "batuta conflicts: {} skills comparadas, nenhum par acima de {:.2}.\n\
             Nenhuma disputa obvia — o dado de disparo de cada uma esta limpo.\n",
            n, LIMIAR
        );
    }

    pares.sort_by(|x, y| y.0.partial_cmp(&x.0).unwrap_or(std::cmp::Ordering::Equal));
    let mut s = format!(
        "batuta conflicts — {} par(es) acima de {:.2} entre {} skills\n\
         (ideia emprestada do SkillPilot, MIT — implementacao propria)\n\n",
        pares.len(),
        LIMIAR,
        n
    );
    for (cos, a, b) in pares.iter().take(40) {
        s.push_str(&format!(
            "  {:.2}  {}  <->  {}\n        {}\n        {}\n",
            cos,
            idx.skills[*a].nome,
            idx.skills[*b].nome,
            idx.skills[*a].caminho,
            idx.skills[*b].caminho
        ));
        s.push_str(
            "        sugestao: deixe explicito na descricao de CADA uma o que ela NAO faz.\n\n",
        );
    }
    if pares.len() > 40 {
        s.push_str(&format!("  ... e mais {} pares.\n", pares.len() - 40));
    }
    s
}
