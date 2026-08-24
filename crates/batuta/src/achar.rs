//! `batuta find` — caminho FRIO. Tres camadas, nesta ordem:
//!   1. INSTALADA   — ja esta na maquina, e so usar
//!   2. DISPONIVEL  — existe no registro publico, com o numero que o Batuta mediu
//!   3. LACUNA      — ninguem tem; vira sugestao de tarefa para a arena
//!
//! Aqui o ranqueamento e por TEXTO COMPLETO, nunca por nome+descricao. Isso nao e
//! preferencia: o paper SkillRouter (arXiv 2603.22455) mediu queda de 31 a 44 pontos
//! de acuracia quando se esconde o corpo da skill e se rankeia so pelo metadado, em
//! benchmark de ~80 mil skills sobrepostas. No caminho quente, com 10 a 100 skills
//! locais, a diferenca provavelmente some. Aqui, nao.
//!
//! O binario continua sem rede. Quem baixa o registro e o wrapper (`batuta registro
//! atualizar`); este comando so le o arquivo em cache.

use crate::bm25;
use crate::casa;
use crate::indice::{self, Indice, Skill};
use crate::json;
use crate::texto;
use std::collections::BTreeMap;

pub fn caminho_registro() -> std::path::PathBuf {
    casa::casa().join("registro.json")
}

fn indice_do_registro(v: &json::Valor) -> (Indice, Vec<json::Valor>) {
    let mut idx = Indice::default();
    let mut originais = Vec::new();
    for (i, s) in v.campo("skills").itens().iter().enumerate() {
        let nome = s.campo("nome").txt().to_string();
        let descricao = s.campo("descricao").txt().to_string();
        let corpo = s.campo("corpo").txt().to_string();
        let mut bag = Vec::new();
        for _ in 0..3 {
            bag.extend(texto::termos(&nome));
        }
        for _ in 0..2 {
            bag.extend(texto::termos(&descricao));
        }
        bag.extend(texto::primeiros(
            texto::termos(&corpo),
            indice::TERMOS_DO_CORPO,
        ));
        let mut tf: BTreeMap<String, u32> = BTreeMap::new();
        let tam = bag.len();
        for t in bag {
            *tf.entry(t).or_insert(0) += 1;
        }
        for (t, c) in tf {
            idx.postings.entry(t).or_default().push((i as u32, c));
        }
        idx.skills.push(Skill {
            nome,
            versao: s.campo("versao").txt().to_string(),
            descricao,
            caminho: s.campo("fonte").txt().to_string(),
            origem: "registro".to_string(),
            tam,
        });
        originais.push(s.clone());
    }
    let soma: usize = idx.skills.iter().map(|s| s.tam).sum();
    idx.media_tam = if idx.skills.is_empty() {
        1.0
    } else {
        (soma as f64 / idx.skills.len() as f64).max(1.0)
    };
    (idx, originais)
}

pub fn achar(consulta: &str) -> String {
    let termos = texto::termos(consulta);
    let mut s = String::new();

    if termos.is_empty() {
        return "Batuta: escreva o que voce quer fazer, nao a palavra-chave.\n  \
                exemplo: batuta find \"transformar planilha bagunçada em relatorio\"\n"
            .to_string();
    }

    // ---- 1. instalada
    s.push_str("INSTALADA — ja esta na sua maquina\n");
    let mut achou_local = false;
    if let Ok(bruto) = std::fs::read_to_string(casa::casa().join("indice.txt")) {
        let idx = indice::ler_parcial(&bruto, &termos);
        let acertos = bm25::pontuar(&idx, &termos);
        for a in &acertos {
            if let Some(sk) = idx.skills.get(a.skill as usize) {
                achou_local = true;
                s.push_str(&format!(
                    "  {}  (nota {:.1})\n    {}\n    {}\n",
                    sk.nome,
                    a.nota,
                    encurtar(&sk.descricao, 120),
                    sk.caminho
                ));
            }
        }
    }
    if !achou_local {
        s.push_str(
            "  nada casou. (`batuta index` reconstroi o indice se voce instalou skill agora)\n",
        );
    }

    // ---- 2. disponivel
    s.push_str("\nDISPONIVEL — existe no registro publico\n");
    let mut achou_registro = false;
    match std::fs::read_to_string(caminho_registro()) {
        Ok(bruto) => match json::ler(&bruto) {
            Ok(v) => {
                let (idx, originais) = indice_do_registro(&v);
                for a in bm25::pontuar(&idx, &termos) {
                    let Some(sk) = idx.skills.get(a.skill as usize) else {
                        continue;
                    };
                    achou_registro = true;
                    let orig = &originais[a.skill as usize];
                    let medido = orig.campo("medido");
                    let numero = if medido.e_nulo() {
                        "ainda nao medida pelo Batuta".to_string()
                    } else {
                        format!(
                            "disparo {:.0}% · lift {:+.1}pp · n={}",
                            medido.campo("taxa_disparo").num() * 100.0,
                            medido.campo("lift_pp").num(),
                            medido.campo("n").num() as u64
                        )
                    };
                    s.push_str(&format!(
                        "  {}  (nota {:.1})\n    {}\n    {}\n    {}\n",
                        sk.nome,
                        a.nota,
                        encurtar(&sk.descricao, 120),
                        numero,
                        sk.caminho
                    ));
                }
                if !achou_registro {
                    s.push_str("  nada no registro casou com isso.\n");
                }
            }
            Err(e) => s.push_str(&format!(
                "  registro local ilegivel ({e}). Rode `batuta registro atualizar`.\n"
            )),
        },
        Err(_) => {
            s.push_str(
                "  sem copia local do registro. Rode `batuta registro atualizar`\n  \
                 (o binario nao acessa a rede — quem baixa e o wrapper).\n",
            );
        }
    }

    // ---- 3. lacuna
    if !achou_local && !achou_registro {
        s.push_str("\nLACUNA — ninguem tem isso ainda\n");
        s.push_str(
            "  Esta e a parte interessante. Manda a tarefa pra arena e ela entra na fila\n  \
             de teste: https://batuta.space/arena\n",
        );
    }
    s
}

fn encurtar(s: &str, n: usize) -> String {
    let c: Vec<char> = s.chars().collect();
    if c.len() <= n {
        s.to_string()
    } else {
        c[..n].iter().collect::<String>() + "…"
    }
}
