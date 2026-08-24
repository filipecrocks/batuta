//! Indexador: varre pastas de skills, le o frontmatter e o corpo do SKILL.md e
//! grava um indice invertido em ~/.batuta/indice.txt.
//!
//! Formato proprio, de uma linha por registro, em vez de JSON. Motivo medido, nao
//! gosto: o caminho quente tem 100ms de orcamento inteiro, e so as linhas `P` dos
//! termos da consulta precisam ser abertas. JSON obrigaria a parsear o arquivo todo.
//!
//! O corpo do SKILL.md entra no indice, nao so nome e descricao. Isso vem do paper
//! SkillRouter (arXiv 2603.22455): rankear so por nome+descricao derruba a acuracia
//! em 31 a 44 pontos. Custa nada aqui e evita o furo la na frente.

use crate::texto;
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

/// Quantos termos do CORPO entram. O B=0.75 do BM25 ja penaliza documento comprido;
/// este corte e o segundo cinto, para SKILL.md gigante nao afogar o indice.
pub const TERMOS_DO_CORPO: usize = 400;

const PESO_NOME: usize = 3;
const PESO_DESCRICAO: usize = 2;

#[derive(Debug, Clone)]
pub struct Skill {
    pub nome: String,
    pub versao: String,
    pub descricao: String,
    pub caminho: String,
    pub origem: String,
    pub tam: usize,
}

#[derive(Debug, Default)]
pub struct Indice {
    pub gerado_em: u64,
    pub skills: Vec<Skill>,
    pub postings: BTreeMap<String, Vec<(u32, u32)>>,
    pub media_tam: f64,
}

// ---------------------------------------------------------------- frontmatter

/// Le o frontmatter YAML do topo do arquivo. Nao e um parser de YAML e nao quer ser:
/// aceita `chave: valor`, valor entre aspas, e continuacao indentada na linha seguinte.
pub fn frontmatter(bruto: &str) -> (BTreeMap<String, String>, usize) {
    let mut m = BTreeMap::new();
    let linhas: Vec<&str> = bruto.lines().collect();
    if linhas.is_empty() || linhas[0].trim() != "---" {
        return (m, 0);
    }
    let mut fim = 0usize;
    let mut chave_atual = String::new();
    let mut bytes_lidos = linhas[0].len() + 1;

    for (i, linha) in linhas.iter().enumerate().skip(1) {
        bytes_lidos += linha.len() + 1;
        if linha.trim() == "---" {
            fim = bytes_lidos;
            break;
        }
        let comeca_com_espaco = linha.starts_with(' ') || linha.starts_with('\t');
        if comeca_com_espaco && !chave_atual.is_empty() {
            let ext = linha.trim();
            if !ext.is_empty() && !ext.starts_with('-') {
                let e = m.entry(chave_atual.clone()).or_default();
                e.push(' ');
                e.push_str(ext);
            }
            continue;
        }
        if let Some(p) = linha.find(':') {
            let k = linha[..p].trim().to_ascii_lowercase();
            let v = linha[p + 1..].trim();
            let v = v.trim_matches(|c| c == '"' || c == '\'');
            if !k.is_empty() {
                chave_atual = k.clone();
                m.insert(k, v.to_string());
            }
        }
        let _ = i;
    }
    (m, fim)
}

// ------------------------------------------------------------------- varredura

fn achar_skill_md(raiz: &Path, prof: usize, saida: &mut Vec<PathBuf>) {
    if prof > 4 {
        return;
    }
    let Ok(it) = fs::read_dir(raiz) else { return };
    let mut dirs = Vec::new();
    for e in it.flatten() {
        let p = e.path();
        let nome = e.file_name().to_string_lossy().to_string();
        if nome.starts_with('.') && nome != ".claude" {
            continue;
        }
        if nome == "node_modules" || nome == "target" {
            continue;
        }
        if p.is_file() && nome.eq_ignore_ascii_case("SKILL.md") {
            saida.push(p);
        } else if p.is_dir() {
            dirs.push(p);
        }
    }
    dirs.sort();
    for d in dirs {
        achar_skill_md(&d, prof + 1, saida);
    }
}

/// Pastas onde skill costuma morar. Nao inventa nada: so entra o que existe no disco.
pub fn pastas_padrao(casa: &Path, cwd: &Path) -> Vec<PathBuf> {
    let mut v = vec![
        casa.join(".claude").join("skills"),
        casa.join(".config").join("claude").join("skills"),
        casa.join(".codex").join("skills"),
        cwd.join(".claude").join("skills"),
        cwd.join("skills"),
    ];
    v.retain(|p| p.is_dir());
    v.dedup();
    v
}

pub fn construir(pastas: &[PathBuf]) -> Indice {
    let mut idx = Indice {
        gerado_em: agora(),
        ..Default::default()
    };
    let mut vistos: BTreeMap<String, ()> = BTreeMap::new();

    for pasta in pastas {
        let mut arquivos = Vec::new();
        achar_skill_md(pasta, 0, &mut arquivos);
        for arq in arquivos {
            let Ok(bruto) = fs::read_to_string(&arq) else {
                continue;
            };
            let (fm, fim) = frontmatter(&bruto);
            let dir_nome = arq
                .parent()
                .and_then(|p| p.file_name())
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or_default();
            let nome = fm
                .get("name")
                .cloned()
                .filter(|s| !s.is_empty())
                .unwrap_or(dir_nome.clone());
            let chave = format!("{}|{}", nome, arq.display());
            if vistos.contains_key(&chave) {
                continue;
            }
            vistos.insert(chave, ());

            let descricao = fm.get("description").cloned().unwrap_or_default();
            let versao = fm
                .get("version")
                .cloned()
                .unwrap_or_else(|| "sem-versao".to_string());
            let corpo = if fim < bruto.len() { &bruto[fim..] } else { "" };

            let mut bag: Vec<String> = Vec::new();
            for _ in 0..PESO_NOME {
                bag.extend(texto::termos(&format!("{} {}", nome, dir_nome)));
            }
            for _ in 0..PESO_DESCRICAO {
                bag.extend(texto::termos(&descricao));
            }
            bag.extend(texto::primeiros(texto::termos(corpo), TERMOS_DO_CORPO));

            let i = idx.skills.len() as u32;
            let tam = bag.len();
            let mut tf: BTreeMap<String, u32> = BTreeMap::new();
            for t in bag {
                *tf.entry(t).or_insert(0) += 1;
            }
            for (t, c) in tf {
                idx.postings.entry(t).or_default().push((i, c));
            }
            idx.skills.push(Skill {
                nome,
                versao,
                descricao: limpar(&descricao),
                caminho: arq.display().to_string(),
                origem: pasta.display().to_string(),
                tam,
            });
        }
    }

    let soma: usize = idx.skills.iter().map(|s| s.tam).sum();
    idx.media_tam = if idx.skills.is_empty() {
        1.0
    } else {
        (soma as f64 / idx.skills.len() as f64).max(1.0)
    };
    idx
}

fn limpar(s: &str) -> String {
    s.replace(['\t', '\n', '\r'], " ").trim().to_string()
}

// --------------------------------------------------------------- gravar / ler

pub fn gravar(idx: &Indice) -> String {
    let mut s = String::with_capacity(64 * 1024);
    s.push_str("BATUTA-INDICE 1\n");
    s.push_str(&format!("G {}\n", idx.gerado_em));
    s.push_str(&format!("N {}\n", idx.skills.len()));
    s.push_str(&format!("A {:.4}\n", idx.media_tam));
    for (i, sk) in idx.skills.iter().enumerate() {
        s.push_str(&format!(
            "S {}\t{}\t{}\t{}\t{}\t{}\t{}\n",
            i,
            limpar(&sk.nome),
            limpar(&sk.versao),
            sk.descricao,
            limpar(&sk.caminho),
            limpar(&sk.origem),
            sk.tam
        ));
    }
    for (termo, lista) in &idx.postings {
        s.push_str("P ");
        s.push_str(termo);
        s.push('\t');
        for (j, (i, c)) in lista.iter().enumerate() {
            if j > 0 {
                s.push(',');
            }
            s.push_str(&format!("{}:{}", i, c));
        }
        s.push('\n');
    }
    s
}

/// Le o indice trazendo SO as postings dos termos pedidos. E o truque do caminho
/// quente: o arquivo e percorrido uma vez, linha a linha, sem montar estrutura para
/// os 60 mil termos que a consulta nao usa.
pub fn ler_parcial(bruto: &str, termos_query: &[String]) -> Indice {
    let mut idx = Indice::default();
    let quer: std::collections::HashSet<&str> = termos_query.iter().map(|s| s.as_str()).collect();

    for linha in bruto.lines() {
        if linha.len() < 2 {
            continue;
        }
        let (marca, resto) = linha.split_at(2);
        match marca {
            "G " => idx.gerado_em = resto.trim().parse().unwrap_or(0),
            "A " => idx.media_tam = resto.trim().parse().unwrap_or(1.0),
            "S " => {
                let c: Vec<&str> = resto.split('\t').collect();
                if c.len() >= 7 {
                    idx.skills.push(Skill {
                        nome: c[1].to_string(),
                        versao: c[2].to_string(),
                        descricao: c[3].to_string(),
                        caminho: c[4].to_string(),
                        origem: c[5].to_string(),
                        tam: c[6].trim().parse().unwrap_or(1),
                    });
                }
            }
            "P " => {
                let Some(tab) = resto.find('\t') else {
                    continue;
                };
                let termo = &resto[..tab];
                if !quer.contains(termo) {
                    continue;
                }
                let mut lista = Vec::new();
                for par in resto[tab + 1..].trim().split(',') {
                    if let Some((a, b)) = par.split_once(':') {
                        if let (Ok(i), Ok(c)) = (a.parse::<u32>(), b.parse::<u32>()) {
                            lista.push((i, c));
                        }
                    }
                }
                idx.postings.insert(termo.to_string(), lista);
            }
            _ => {}
        }
    }
    if idx.media_tam <= 0.0 {
        idx.media_tam = 1.0;
    }
    idx
}

pub fn agora() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}
