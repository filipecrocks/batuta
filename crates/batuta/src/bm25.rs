//! BM25. Parametros congelados no SPEC — mexer neles sem mexer na bateria de
//! conformidade e mudar a regua no meio da serie historica.

use crate::indice::Indice;

pub const K1: f64 = 1.5;
pub const B: f64 = 0.75;

/// Abaixo disto o roteador se cala. Falso positivo custa mais que falso negativo:
/// skill sugerida a toa entra no contexto, gasta token e ensina o modelo a ignorar
/// a sugestao. O valor 2.0 vem do v0.1 — com 3.2 o roteador ficava mudo em 3 de 7
/// casos legitimos.
pub const CORTE_RUIDO: f64 = 2.0;

/// Quantas skills no maximo saem numa rota.
pub const MAX_SUGESTOES: usize = 3;

/// Quem nao chega a esta fracao da primeira colocada nao acompanha.
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

/// Pontua todas as skills contra os termos da consulta e devolve a lista ja podada
/// pelo corte de ruido, pelo teto de sugestoes e pela fracao do topo.
pub fn pontuar(idx: &Indice, termos: &[String]) -> Vec<Acerto> {
    let n = idx.skills.len();
    if n == 0 || termos.is_empty() {
        return Vec::new();
    }

    let mut notas = vec![0.0f64; n];
    let mut vistos: Vec<&str> = Vec::with_capacity(termos.len());

    for t in termos {
        // termo repetido na consulta conta uma vez so
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

    // ordem estavel e deterministica: nota desc, depois indice asc
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
