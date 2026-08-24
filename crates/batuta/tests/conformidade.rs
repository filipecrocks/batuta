//! BATUTA CONFORMANCE TEST SUITE
//!
//! This file, together with SPEC.md, IS THE CONTRACT. A port to another language
//! is conformant when it passes this suite with the same numbers — not with
//! similar numbers.
//!
//! Run with a single thread: several tests share the same temporary home directory.
//!   cargo test -- --test-threads=1

use batuta::json::Valor;
use batuta::{bm25, casa, indice, json, registro, rota, sha256, texto};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Once;

static PREPARO: Once = Once::new();

fn casa_de_teste() -> PathBuf {
    let base = std::env::temp_dir().join("batuta-conformidade");
    PREPARO.call_once(|| {
        let _ = fs::remove_dir_all(&base);
        let _ = fs::create_dir_all(&base);
        std::env::set_var("BATUTA_CASA", &base);
    });
    base
}

fn skill(raiz: &Path, nome: &str, descricao: &str, corpo: &str) {
    let d = raiz.join(nome);
    fs::create_dir_all(&d).unwrap();
    fs::write(
        d.join("SKILL.md"),
        format!("---\nname: {nome}\ndescription: {descricao}\n---\n\n{corpo}\n"),
    )
    .unwrap();
}

/// Reference corpus for the test suite. Deliberately small: 10 to 100 skills is the
/// real size of a working machine.
fn corpus() -> PathBuf {
    let base = casa_de_teste();
    let raiz = base.join("skills");
    if raiz.exists() {
        return raiz;
    }
    fs::create_dir_all(&raiz).unwrap();
    skill(&raiz, "systematic-debugging",
        "Depuracao sistematica de bug dificil: reproduzir, isolar, diagnosticar e corrigir quando algo quebrou.",
        "Reproduza o defeito. Isole por bisseccao. Escreva o teste que falha. Corrija. Stack trace, excecao, crash, regressao, comportamento inesperado.");
    skill(
        &raiz,
        "test-driven-development",
        "Escrever o teste antes do codigo: ciclo vermelho, verde, refatorar.",
        "Teste primeiro. Codigo minimo. Refatoracao. Cobertura, assercao, mock, fixture.",
    );
    skill(&raiz, "xlsx",
        "Criar, ler e editar planilha Excel xlsx, csv e tsv: formula, formatacao, grafico e limpeza de dado tabular bagunçado.",
        "Coluna, linha, celula, formula, grafico, tabela dinamica, planilha suja, cabecalho fora do lugar.");
    skill(&raiz, "docx",
        "Criar e editar documento Word docx: sumario, cabecalho, numeracao de pagina, papel timbrado.",
        "Relatorio, memorando, carta, modelo, estilo de paragrafo.");
    skill(&raiz, "traducao-tecnica",
        "Traduzir documentacao tecnica entre portugues, ingles e espanhol mantendo termo consagrado.",
        "Glossario, termo tecnico, consistencia terminologica, revisao bilingue.");
    skill(&raiz, "stop-slop",
        "Cortar enchimento de texto gerado por IA: adverbio inutil, frase de efeito, conclusao que nao conclui.",
        "Texto inchado, chavao, redundancia, revisao de estilo, corte seco.");
    raiz
}

fn indexar() -> indice::Indice {
    let raiz = corpus();
    let idx = indice::construir(&[raiz]);
    fs::write(casa::garantir().join("indice.txt"), indice::gravar(&idx)).unwrap();
    idx
}

// ------------------------------------------------------------------ 1. sha256

#[test]
fn c01_sha256_bate_com_os_vetores_conhecidos() {
    assert_eq!(
        sha256::hex(&sha256::sha256(b"")),
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    );
    assert_eq!(
        sha256::hex(&sha256::sha256(b"abc")),
        "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    );
    assert_eq!(
        sha256::hex(&sha256::sha256(
            b"abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq"
        )),
        "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1"
    );
}

// ------------------------------------------------------------ 2. tokenizer

#[test]
fn c02_tokenizador_dobra_acento_corta_cola_e_ignora_numero_solto() {
    let t = texto::termos("O código não está em 2026, é só verificação");
    assert!(
        t.contains(&"codigo".to_string()),
        "acento tem que sumir: {:?}",
        t
    );
    assert!(t.contains(&"verificacao".to_string()));
    assert!(!t.contains(&"o".to_string()));
    assert!(
        !t.contains(&"nao".to_string()),
        "palavra-cola tem que sair: {:?}",
        t
    );
    assert!(
        !t.contains(&"2026".to_string()),
        "numero solto nao roteia: {:?}",
        t
    );
}

#[test]
fn c03_tolerancia_a_flexao_pelo_prefixo_de_cinco() {
    let a = texto::termos("quebrou");
    let b = texto::termos("quebrado");
    assert!(a.contains(&"quebr".to_string()));
    assert!(b.contains(&"quebr".to_string()));
    assert!(a.contains(&"quebrou".to_string()));
    assert!(b.contains(&"quebrado".to_string()));

    // a short word does NOT get a prefix — otherwise "casa" and "caso" become the same thing
    let c = texto::termos("casa caso");
    assert!(!c.iter().any(|x| x == "cas"), "{:?}", c);
    assert_eq!(texto::PREFIXO, 5);
}

// ---------------------------------------------------------- 4. frontmatter

#[test]
fn c04_frontmatter_le_chave_valor_e_continuacao_indentada() {
    let (fm, fim) = indice::frontmatter(
        "---\nname: minha-skill\ndescription: primeira parte\n  segunda parte\nversion: 2.1.0\n---\ncorpo aqui\n",
    );
    assert_eq!(fm.get("name").unwrap(), "minha-skill");
    assert_eq!(
        fm.get("description").unwrap(),
        "primeira parte segunda parte"
    );
    assert_eq!(fm.get("version").unwrap(), "2.1.0");
    assert!(fim > 0);

    let (vazio, zero) = indice::frontmatter("# so um titulo\n");
    assert!(vazio.is_empty());
    assert_eq!(zero, 0);
}

// -------------------------------------------------------------- 5. index

#[test]
fn c05_indice_sobrevive_a_ida_e_volta_do_disco() {
    let idx = indexar();
    assert_eq!(idx.skills.len(), 6);

    let bruto = fs::read_to_string(casa::casa().join("indice.txt")).unwrap();
    let termos = texto::termos("planilha bagunçada");
    let lido = indice::ler_parcial(&bruto, &termos);

    assert_eq!(lido.skills.len(), 6, "todas as skills voltam");
    assert!(
        (lido.media_tam - idx.media_tam).abs() < 0.01,
        "media de tamanho preservada"
    );
    assert!(
        lido.postings.len() <= termos.len(),
        "leitura parcial materializou {} postings para {} termos",
        lido.postings.len(),
        termos.len()
    );
    for t in &termos {
        if let Some(a) = idx.postings.get(t) {
            assert_eq!(
                lido.postings.get(t).unwrap(),
                a,
                "posting de '{}' divergiu",
                t
            );
        }
    }
}

// ---------------------------------------------------------------- 6. route

fn notas(consulta: &str) -> Vec<(String, f64)> {
    indexar();
    let bruto = fs::read_to_string(casa::casa().join("indice.txt")).unwrap();
    let termos = texto::termos(consulta);
    let idx = indice::ler_parcial(&bruto, &termos);
    bm25::pontuar(&idx, &termos)
        .into_iter()
        .map(|a| (idx.skills[a.skill as usize].nome.clone(), a.nota))
        .collect()
}

#[test]
fn c06_rota_acha_o_obvio() {
    let casos: [(&str, &str); 5] = [
        (
            "minha planilha veio bagunçada, preciso limpar as colunas",
            "xlsx",
        ),
        (
            "o programa quebrou e eu preciso achar a causa",
            "systematic-debugging",
        ),
        (
            "quero escrever o teste antes do codigo",
            "test-driven-development",
        ),
        (
            "gerar um relatorio em word com sumario e numeracao de pagina",
            "docx",
        ),
        (
            "traduzir a documentacao tecnica para espanhol",
            "traducao-tecnica",
        ),
    ];
    for (consulta, esperado) in casos {
        let r = notas(consulta);
        assert!(
            !r.is_empty(),
            "roteador ficou mudo em caso legitimo: {consulta:?}"
        );
        assert_eq!(
            r[0].0, esperado,
            "consulta {consulta:?} deveria ranquear {esperado} em primeiro, veio {r:?}"
        );
    }
}

#[test]
fn c07_silencio_no_ruido() {
    for consulta in [
        "oi tudo bem",
        "obrigado",
        "e isso ai entao",
        "voce pode me ajudar por favor",
        "ok",
    ] {
        let r = notas(consulta);
        assert!(r.is_empty(), "roteador falou no ruido {consulta:?}: {r:?}");
    }
}

#[test]
fn c08_parametros_do_bm25_estao_congelados() {
    assert_eq!(bm25::K1, 1.5);
    assert_eq!(bm25::B, 0.75);
    assert_eq!(bm25::CORTE_RUIDO, 2.0);
    assert_eq!(bm25::MAX_SUGESTOES, 3);
    assert_eq!(indice::TERMOS_DO_CORPO, 400);

    let r = notas("planilha codigo teste documento traducao texto relatorio");
    assert!(r.len() <= bm25::MAX_SUGESTOES, "{:?}", r);
    for (_, n) in &r {
        assert!(*n >= bm25::CORTE_RUIDO, "nota {n} abaixo do corte");
    }
}

#[test]
fn c09_determinismo() {
    let a = notas("o programa quebrou e eu preciso achar a causa");
    let b = notas("o programa quebrou e eu preciso achar a causa");
    assert_eq!(a, b, "mesma consulta tem que dar exatamente a mesma saida");
}

// -------------------------------------------------------------- 10. holdout

#[test]
fn c10_holdout_e_deterministico_e_fica_na_faixa() {
    indexar();
    let p = "consulta de controle numero 42 sobre planilha";
    let um = rota::rotear(p, "teste", None, "0.0.0");
    let dois = rota::rotear(p, "teste", None, "0.0.0");
    assert_eq!(
        um.evento.campo("holdout"),
        dois.evento.campo("holdout"),
        "holdout tem que ser deterministico — senao da para tentar de novo ate o roteador falar"
    );

    let mut caiu = 0;
    for i in 0..2000 {
        let e = rota::rotear(
            &format!("planilha bagunçada caso {i}"),
            "teste",
            None,
            "0.0.0",
        );
        if matches!(e.evento.campo("holdout"), Valor::Bool(true)) {
            caiu += 1;
        }
    }
    let pct = 100.0 * caiu as f64 / 2000.0;
    assert!(
        (2.5..=8.0).contains(&pct),
        "holdout saiu em {pct:.1}% dos turnos, esperado perto de 5%"
    );
}

// ------------------------------------------------------------ 11. privacy

#[test]
fn c11_o_prompt_nunca_entra_no_evento() {
    indexar();
    let segredo = "minha chave secreta e bananadeprata e o cliente chama Fulano da Silva";
    let s = rota::rotear(segredo, "teste", None, "0.0.0");
    let linha = json::escrever(&s.evento);

    assert!(
        !linha.contains("bananadeprata"),
        "vazou trecho do prompt: {linha}"
    );
    assert!(!linha.contains("Fulano"), "vazou trecho do prompt: {linha}");
    assert!(!linha.contains("secreta"));
    assert_eq!(s.evento.campo("prompt_hash").txt().len(), 32);
    assert_eq!(
        s.evento.campo("prompt_len").num() as usize,
        segredo.chars().count()
    );

    let a = sha256::hash_com_sal("sal-a", segredo);
    let b = sha256::hash_com_sal("sal-b", segredo);
    assert_ne!(a, b);
}

#[test]
fn c12_resumo_diario_nao_carrega_evento_cru() {
    let eventos = vec![
        json::ler(r#"{"v":1,"t":1756000000,"tipo":"rota","turno":"t1","prompt_hash":"abc","prompt_len":40,"holdout":false,"sugestoes":[{"skill":"xlsx","versao":"1.0","nota":7.1}]}"#).unwrap(),
        json::ler(r#"{"v":1,"t":1756000001,"tipo":"ativacao","turno":"t1","skill":"xlsx","por":"modelo"}"#).unwrap(),
        json::ler(r#"{"v":1,"t":1756000050,"tipo":"desfecho","turno":"t1","ok":true,"reprompt":0,"turnos":2,"custo_usd":0.012}"#).unwrap(),
    ];
    let ag = registro::agregar(&eventos, Some("2025-08-24"));
    assert_eq!(ag.rotas, 1);
    assert_eq!(ag.rotas_com_sugestao, 1);
    assert_eq!(ag.skills.get("xlsx").unwrap().ativacoes, 1);
    assert_eq!(ag.braco_com, (1, 1));

    let v = registro::resumo_diario(&ag, "2025-08-24", "0.1.0", "hook");
    let s = json::escrever(&v);
    assert!(
        !s.contains("prompt_hash"),
        "resumo nao pode carregar hash de prompt: {s}"
    );
    assert!(
        !s.contains("\"turno\""),
        "resumo nao pode carregar id de turno: {s}"
    );
    assert!(s.contains("batuta.resumo_diario.v1"));
    assert!(
        s.contains("vies_declarado"),
        "o vies da amostra vai declarado, sempre"
    );
}

// ------------------------------------------------------------------- 13. json

#[test]
fn c13_json_canonico_e_ida_e_volta() {
    let bruto = r#"{"b":2,"a":[1,2,{"z":null,"y":true}],"c":"com \"aspas\" e \n quebra e ç"}"#;
    let v = json::ler(bruto).unwrap();
    let saida = json::escrever(&v);
    assert!(saida.starts_with(r#"{"a":"#), "{saida}");
    let volta = json::ler(&saida).unwrap();
    assert_eq!(v, volta, "ida e volta tem que preservar o valor");
    assert!(v.campo("c").txt().contains('ç'));
    assert!(json::ler("{oi}").is_err());
}

#[test]
fn c14_data_utc() {
    assert_eq!(batuta::data::dia_utc(1_756_000_000), "2025-08-24");
    assert_eq!(
        batuta::data::instante_utc(1_756_000_000),
        "2025-08-24T01:46:40Z"
    );
}

// ---------------------------------------------------- 15. turn budget

#[test]
fn c15_caminho_quente_cabe_no_orcamento() {
    let base = casa_de_teste();
    let raiz = base.join("skills-grande");
    if !raiz.exists() {
        fs::create_dir_all(&raiz).unwrap();
        let vocab = [
            "dados",
            "planilha",
            "relatorio",
            "codigo",
            "teste",
            "erro",
            "deploy",
            "build",
            "documento",
            "grafico",
            "api",
            "banco",
            "python",
            "rust",
            "modelo",
            "prompt",
            "skill",
            "indice",
            "texto",
            "revisao",
        ];
        for i in 0..500usize {
            let d: String = (0..8usize)
                .map(|k| vocab[(i * 7 + k * 3) % vocab.len()])
                .collect::<Vec<_>>()
                .join(" ");
            let c: String = (0..300usize)
                .map(|k| vocab[(i * 13 + k * 5) % vocab.len()])
                .collect::<Vec<_>>()
                .join(" ");
            skill(&raiz, &format!("skill-{i:03}"), &d, &c);
        }
        for n in fs::read_dir(corpus()).unwrap().flatten() {
            let destino = raiz.join(n.file_name());
            fs::create_dir_all(&destino).unwrap();
            fs::copy(n.path().join("SKILL.md"), destino.join("SKILL.md")).unwrap();
        }
    }
    let idx = indice::construir(&[raiz]);
    assert!(
        idx.skills.len() >= 500,
        "corpus grande tem {}",
        idx.skills.len()
    );
    let bruto = indice::gravar(&idx);

    let consultas: Vec<String> = (0..50)
        .map(|i| format!("preciso limpar planilha bagunçada e gerar relatorio {i}"))
        .collect();

    let t0 = std::time::Instant::now();
    for c in &consultas {
        let termos = texto::termos(c);
        let idx = indice::ler_parcial(&bruto, &termos);
        let _ = bm25::pontuar(&idx, &termos);
    }
    let total = t0.elapsed().as_micros() as f64 / 1000.0;
    let por_rota = total / 50.0;

    assert!(
        por_rota < 50.0,
        "{por_rota:.1}ms por rota com {} skills — estourou a folga do orcamento",
        idx.skills.len()
    );
    eprintln!(
        "  [medido] {} skills · {:.2}ms por rota · indice de {} KB",
        idx.skills.len(),
        por_rota,
        bruto.len() / 1024
    );
}
