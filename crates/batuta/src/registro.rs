//! Eventos e relatorio.
//!
//! REGRA DE OURO, e ela vale mais que qualquer feature: o texto do prompt nunca
//! entra neste arquivo. Entra o hash com sal local, o comprimento e a contagem de
//! termos. Quem roubar o eventos.jsonl nao le nada de ninguem.
//!
//! Sobe para o portal, e so com opt-in, o RESUMO DIARIO AGREGADO POR SKILL —
//! nunca o evento cru. 200 turnos por dia viram ~20 linhas.

use crate::casa;
use crate::data;
use crate::json::{self, num, obj, txt, Valor};
use std::collections::BTreeMap;
use std::fs::OpenOptions;
use std::io::Write;

pub fn arquivo_eventos() -> std::path::PathBuf {
    casa::garantir().join("eventos.jsonl")
}

pub fn anexar(v: &Valor) {
    let linha = json::escrever(v);
    if let Ok(mut f) = OpenOptions::new()
        .create(true)
        .append(true)
        .open(arquivo_eventos())
    {
        let _ = writeln!(f, "{}", linha);
    }
}

pub fn carregar() -> Vec<Valor> {
    let Ok(s) = std::fs::read_to_string(arquivo_eventos()) else {
        return Vec::new();
    };
    s.lines()
        .filter(|l| !l.trim().is_empty())
        .filter_map(|l| json::ler(l).ok())
        .collect()
}

// ------------------------------------------------------------------- agregacao

#[derive(Default, Debug, Clone)]
pub struct PorSkill {
    pub versao: String,
    pub rotas: u64,
    pub ativacoes: u64,
    pub ativacoes_usuario: u64,
    pub turnos_ok: u64,
    pub turnos_julgados: u64,
    pub reprompts: u64,
    pub erros: u64,
    pub retries: u64,
    pub tokens_in: f64,
    pub tokens_out: f64,
    pub custo_usd: f64,
    pub turnos_ate_fim: Vec<f64>,
}

#[derive(Default, Debug)]
pub struct Agregado {
    pub rotas: u64,
    pub rotas_com_sugestao: u64,
    pub rotas_holdout: u64,
    pub skills: BTreeMap<String, PorSkill>,
    /// desfecho dos turnos em que o roteador FALOU
    pub braco_com: (u64, u64),
    /// desfecho dos turnos de holdout — o roteador se calou de proposito
    pub braco_holdout: (u64, u64),
    pub ms_total: f64,
    pub ms_amostras: u64,
    pub primeiro: u64,
    pub ultimo: u64,
}

pub fn agregar(eventos: &[Valor], dia: Option<&str>) -> Agregado {
    let mut ag = Agregado::default();
    // turno -> (holdout, falou, skills sugeridas)
    let mut turnos: BTreeMap<String, (bool, bool, Vec<String>)> = BTreeMap::new();

    for e in eventos {
        let t = e.campo("t").num() as u64;
        if let Some(d) = dia {
            if data::dia_utc(t) != d {
                continue;
            }
        }
        if ag.primeiro == 0 || t < ag.primeiro {
            ag.primeiro = t;
        }
        if t > ag.ultimo {
            ag.ultimo = t;
        }
        let turno = e.campo("turno").txt().to_string();

        match e.campo("tipo").txt() {
            "rota" => {
                ag.rotas += 1;
                let holdout = matches!(e.campo("holdout"), Valor::Bool(true));
                if holdout {
                    ag.rotas_holdout += 1;
                }
                let sugeridas: Vec<String> = e
                    .campo("sugestoes")
                    .itens()
                    .iter()
                    .map(|s| s.campo("skill").txt().to_string())
                    .collect();
                let falou = !sugeridas.is_empty();
                if falou {
                    ag.rotas_com_sugestao += 1;
                }
                for s in &sugeridas {
                    let alvo = ag.skills.entry(s.clone()).or_default();
                    alvo.rotas += 1;
                }
                for s in e.campo("sugestoes").itens() {
                    let nome = s.campo("skill").txt().to_string();
                    let v = s.campo("versao").txt().to_string();
                    if !v.is_empty() {
                        ag.skills.entry(nome).or_default().versao = v;
                    }
                }
                let ms = e.campo("ms").num();
                if ms > 0.0 {
                    ag.ms_total += ms;
                    ag.ms_amostras += 1;
                }
                turnos.insert(turno, (holdout, falou, sugeridas));
            }
            "ativacao" => {
                let nome = e.campo("skill").txt().to_string();
                if nome.is_empty() {
                    continue;
                }
                let alvo = ag.skills.entry(nome).or_default();
                alvo.ativacoes += 1;
                if e.campo("por").txt() == "usuario" {
                    alvo.ativacoes_usuario += 1;
                }
            }
            "desfecho" => {
                let ok = matches!(e.campo("ok"), Valor::Bool(true));
                let (holdout, falou, sugeridas) =
                    turnos
                        .get(&turno)
                        .cloned()
                        .unwrap_or((false, false, Vec::new()));
                if holdout {
                    ag.braco_holdout.1 += 1;
                    if ok {
                        ag.braco_holdout.0 += 1;
                    }
                } else if falou {
                    ag.braco_com.1 += 1;
                    if ok {
                        ag.braco_com.0 += 1;
                    }
                }
                for s in sugeridas {
                    let alvo = ag.skills.entry(s).or_default();
                    alvo.turnos_julgados += 1;
                    if ok {
                        alvo.turnos_ok += 1;
                    }
                    alvo.reprompts += e.campo("reprompt").num() as u64;
                    alvo.erros += e.campo("erros").num() as u64;
                    alvo.retries += e.campo("retries").num() as u64;
                    alvo.tokens_in += e.campo("tokens_in").num();
                    alvo.tokens_out += e.campo("tokens_out").num();
                    alvo.custo_usd += e.campo("custo_usd").num();
                    let turnos_ate = e.campo("turnos").num();
                    if turnos_ate > 0.0 {
                        alvo.turnos_ate_fim.push(turnos_ate);
                    }
                }
            }
            _ => {}
        }
    }
    ag
}

pub fn mediana(v: &mut [f64]) -> f64 {
    if v.is_empty() {
        return 0.0;
    }
    v.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let n = v.len();
    if n % 2 == 1 {
        v[n / 2]
    } else {
        (v[n / 2 - 1] + v[n / 2]) / 2.0
    }
}

// ------------------------------------------------------------------- relatorio

pub fn relatorio_texto(ag: &Agregado) -> String {
    let mut s = String::new();
    if ag.rotas == 0 {
        return "Batuta: nenhum turno registrado ainda.\n\
                Instale o hook com `batuta install-hooks` e volte depois de alguns turnos.\n"
            .to_string();
    }

    s.push_str("BATUTA — relatorio local\n");
    s.push_str(&format!(
        "periodo: {} ate {}\n",
        data::instante_utc(ag.primeiro),
        data::instante_utc(ag.ultimo)
    ));
    s.push('\n');

    let silencio = ag.rotas - ag.rotas_com_sugestao;
    s.push_str("FUNIL\n");
    s.push_str(&format!("  turnos vistos ............ {}\n", ag.rotas));
    s.push_str(&format!(
        "  roteador falou ........... {} ({:.1}%)\n",
        ag.rotas_com_sugestao,
        pct(ag.rotas_com_sugestao, ag.rotas)
    ));
    s.push_str(&format!(
        "  roteador calado .......... {} ({:.1}%)\n",
        silencio,
        pct(silencio, ag.rotas)
    ));
    s.push_str(&format!(
        "  holdout (calado de proposito) {}\n",
        ag.rotas_holdout
    ));
    if ag.ms_amostras > 0 {
        s.push_str(&format!(
            "  tempo medio da rota ...... {:.1}ms\n",
            ag.ms_total / ag.ms_amostras as f64
        ));
    }
    s.push('\n');

    s.push_str("POR SKILL\n");
    s.push_str("  skill                          rotas  ativou  disparo   custo/tarefa\n");
    let mut linhas: Vec<(&String, &PorSkill)> = ag.skills.iter().collect();
    linhas.sort_by_key(|l| std::cmp::Reverse(l.1.rotas));
    for (nome, p) in &linhas {
        let disparo = pct(p.ativacoes, p.rotas);
        let custo = if p.turnos_ok > 0 {
            format!("US$ {:.4}", p.custo_usd / p.turnos_ok as f64)
        } else {
            "—".to_string()
        };
        s.push_str(&format!(
            "  {:<28} {:>6} {:>7} {:>7.1}%   {}\n",
            corta(nome, 28),
            p.rotas,
            p.ativacoes,
            disparo,
            custo
        ));
    }
    s.push('\n');

    let fantasmas: Vec<&String> = linhas
        .iter()
        .filter(|(_, p)| p.rotas >= 5 && p.ativacoes == 0)
        .map(|(n, _)| *n)
        .collect();
    if fantasmas.is_empty() {
        s.push_str("SKILLS FANTASMA\n  nenhuma (skill sugerida 5+ vezes e nunca usada)\n\n");
    } else {
        s.push_str("SKILLS FANTASMA — sugeridas 5+ vezes, nunca usadas\n");
        for f in fantasmas {
            s.push_str(&format!("  {}\n", f));
        }
        s.push('\n');
    }

    s.push_str("LIFT (holdout causal)\n");
    if ag.braco_holdout.1 == 0 {
        s.push_str(
            "  ainda sem amostra de controle. O holdout cala o roteador em 5% dos turnos\n\
             \x20 de proposito; sem isso o numero mede correlacao, nao causa.\n",
        );
    } else {
        let com = pct(ag.braco_com.0, ag.braco_com.1);
        let sem = pct(ag.braco_holdout.0, ag.braco_holdout.1);
        s.push_str(&format!(
            "  com roteador .... {:.1}% de {} turnos\n  sem roteador .... {:.1}% de {} turnos\n  lift ............ {:+.1} pontos\n",
            com, ag.braco_com.1, sem, ag.braco_holdout.1, com - sem
        ));
        if ag.braco_holdout.1 < 30 {
            s.push_str(&format!(
                "  ATENCAO: n={} no controle. Numero fraco. Nao publique como conclusao.\n",
                ag.braco_holdout.1
            ));
        }
    }
    s.push('\n');
    s.push_str("Tudo isto e local. Nada saiu desta maquina.\n");
    s
}

fn corta(s: &str, n: usize) -> String {
    if s.chars().count() <= n {
        s.to_string()
    } else {
        s.chars().take(n - 1).collect::<String>() + "…"
    }
}

pub fn pct(a: u64, b: u64) -> f64 {
    if b == 0 {
        0.0
    } else {
        100.0 * a as f64 / b as f64
    }
}

// --------------------------------------------------------------- resumo diario

/// O unico formato que sobe. Sem prompt, sem hash de prompt, sem caminho de arquivo,
/// sem nome de usuario. Uma linha por skill por dia.
pub fn resumo_diario(ag: &Agregado, dia: &str, versao_batuta: &str, modo: &str) -> Valor {
    let mut skills = Vec::new();
    for (nome, p) in &ag.skills {
        let mut tf = p.turnos_ate_fim.clone();
        skills.push(obj(vec![
            ("skill", txt(nome.clone())),
            ("versao", txt(p.versao.clone())),
            ("rotas", num(p.rotas as f64)),
            ("ativacoes", num(p.ativacoes as f64)),
            ("ativacoes_usuario", num(p.ativacoes_usuario as f64)),
            ("turnos_julgados", num(p.turnos_julgados as f64)),
            ("turnos_ok", num(p.turnos_ok as f64)),
            ("reprompts", num(p.reprompts as f64)),
            ("erros", num(p.erros as f64)),
            ("retries", num(p.retries as f64)),
            ("tokens_in", num(p.tokens_in)),
            ("tokens_out", num(p.tokens_out)),
            ("custo_usd", num(p.custo_usd)),
            ("turnos_ate_fim_mediana", num(mediana(&mut tf))),
            ("fantasma", Valor::Bool(p.rotas >= 5 && p.ativacoes == 0)),
        ]));
    }

    obj(vec![
        ("schema", txt("batuta.resumo_diario.v1")),
        ("dia", txt(dia)),
        ("instalacao", txt(casa::id_instalacao())),
        ("batuta_versao", txt(versao_batuta)),
        ("modo", txt(modo)),
        ("rotas", num(ag.rotas as f64)),
        ("rotas_com_sugestao", num(ag.rotas_com_sugestao as f64)),
        ("rotas_holdout", num(ag.rotas_holdout as f64)),
        (
            "braco_com",
            obj(vec![
                ("ok", num(ag.braco_com.0 as f64)),
                ("n", num(ag.braco_com.1 as f64)),
            ]),
        ),
        (
            "braco_holdout",
            obj(vec![
                ("ok", num(ag.braco_holdout.0 as f64)),
                ("n", num(ag.braco_holdout.1 as f64)),
            ]),
        ),
        (
            "vies_declarado",
            txt("quem instala o Batuta ja se importa com skills; a amostra e voluntaria e nao e representativa"),
        ),
        ("skills", Valor::Lista(skills)),
    ])
}
