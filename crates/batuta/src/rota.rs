//! Hot path. Budget: 100ms, hard ceiling of 300ms. Zero network, zero LLM,
//! zero waiting. If something here can fail, it fails silently and returns 0 — a hook
//! that blows the time budget has its whole output discarded, and a router that stalls
//! the user's turn is worse than a router that doesn't exist.

use crate::bm25;
use crate::casa;
use crate::indice;
use crate::json::{num, obj, txt, Valor};
use crate::registro;
use crate::sha256;
use crate::texto;
use std::time::Instant;

pub struct Saida {
    pub texto: Option<String>,
    pub evento: Valor,
}

/// Holdout draw: deterministic from the local salt and the prompt itself.
/// Deliberately deterministic — the same question always lands in the same arm, so
/// there's no way to "try again until the router speaks".
fn e_holdout(sal: &str, prompt: &str, pct: u32) -> bool {
    if pct == 0 {
        return false;
    }
    let h = sha256::hash_com_sal(sal, &format!("holdout|{}", prompt));
    let n = u32::from_str_radix(&h[..4], 16).unwrap_or(0);
    n % 100 < pct
}

pub fn rotear(prompt: &str, modo: &str, turno_dado: Option<String>, versao: &str) -> Saida {
    let t0 = Instant::now();
    let cfg = casa::ler_config();
    let sal = casa::sal();
    let termos = texto::termos(prompt);

    let hash = sha256::hash_com_sal(&sal, prompt);
    let turno = turno_dado.unwrap_or_else(|| hash[..12].to_string());
    let holdout = e_holdout(&sal, prompt, cfg.holdout_pct);

    let mut sugestoes: Vec<Valor> = Vec::new();
    let mut linhas: Vec<String> = Vec::new();

    if !holdout && !termos.is_empty() {
        let arq = casa::casa().join("indice.txt");
        if let Ok(bruto) = std::fs::read_to_string(&arq) {
            let idx = indice::ler_parcial(&bruto, &termos);
            for a in bm25::pontuar(&idx, &termos) {
                let Some(sk) = idx.skills.get(a.skill as usize) else {
                    continue;
                };
                sugestoes.push(obj(vec![
                    ("skill", txt(sk.nome.clone())),
                    ("versao", txt(sk.versao.clone())),
                    ("nota", num((a.nota * 100.0).round() / 100.0)),
                ]));
                linhas.push(format!(
                    "· {} — {}\n  {}",
                    sk.nome,
                    corta(&sk.descricao, 160),
                    sk.caminho
                ));
            }
        }
    }

    let ms = t0.elapsed().as_micros() as f64 / 1000.0;

    let evento = obj(vec![
        ("v", num(1)),
        ("t", num(indice::agora() as f64)),
        ("tipo", txt("rota")),
        ("turno", txt(turno)),
        ("prompt_hash", txt(&hash[..32])),
        ("prompt_len", num(prompt.chars().count() as f64)),
        ("termos", num(termos.len() as f64)),
        ("holdout", Valor::Bool(holdout)),
        ("modo", txt(modo)),
        ("batuta_versao", txt(versao)),
        ("ms", num((ms * 100.0).round() / 100.0)),
        ("sugestoes", Valor::Lista(sugestoes.clone())),
    ]);

    // The injected block costs tokens on EVERY turn. So it's deliberately short, and
    // the full statement (privacy, opt-in, holdout) appears ONCE, on the first
    // run, inside the context — where the user sees it — and afterward lives in
    // `batuta privacidade` and `batuta report`.
    let texto_saida = if linhas.is_empty() {
        None
    } else {
        let primeira = if !cfg.avisado {
            let mut c2 = cfg.clone();
            c2.avisado = true;
            casa::gravar_config(&c2);
            format!(
                "\n\n— Batuta, primeira vez aqui: eu roteio 100% local, sem rede e sem LLM. \
                 O texto do seu prompt nunca sai desta maquina (guardo hash com sal local, \
                 nao o texto). Enviar dado agregado para o portal e opt-in: esta DESLIGADO \
                 ate voce rodar `batuta config envio sim`. Em {}% dos turnos eu me calo de \
                 proposito, para existir grupo de controle e o numero medir causa, nao \
                 correlacao — `batuta config holdout 0` desliga. Detalhes: `batuta privacidade`.",
                cfg.holdout_pct
            )
        } else {
            String::new()
        };
        Some(format!(
            "<batuta>\nSkills instaladas que casam com este turno:\n{}\n\nUse se couber. Ignore se nao couber — quem sugeriu foi o roteador, nao o usuario.{}\n</batuta>",
            linhas.join("\n"),
            primeira
        ))
    };

    Saida {
        texto: texto_saida,
        evento,
    }
}

pub fn registrar(s: &Saida) {
    registro::anexar(&s.evento);
}

fn corta(s: &str, n: usize) -> String {
    let c: Vec<char> = s.chars().collect();
    if c.len() <= n {
        return s.to_string();
    }
    let mut fim = n;
    while fim > 0 && c[fim] != ' ' {
        fim -= 1;
    }
    if fim == 0 {
        fim = n;
    }
    c[..fim].iter().collect::<String>() + "…"
}
