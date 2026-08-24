//! BATUTA CONFORMANCE TEST SUITE
//!
//! This file, together with SPEC.md, IS THE CONTRACT. A port to another language
//! is conformant when it passes this suite with the same numbers — not with
//! similar numbers.
//!
//! Run with a single thread: several tests share the same temporary home directory.
//!   cargo test -- --test-threads=1

use batuta::json::Value;
use batuta::{bm25, home, index, json, lifecycle, record, route, sha256, storage, text};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Once;

static SETUP: Once = Once::new();
static CORPUS: Once = Once::new();

fn test_home() -> PathBuf {
    let base = std::env::temp_dir().join("batuta-conformance");
    SETUP.call_once(|| {
        let _ = fs::remove_dir_all(&base);
        let _ = fs::create_dir_all(&base);
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&base, fs::Permissions::from_mode(0o700)).unwrap();
        }
        std::env::set_var("BATUTA_HOME", &base);
    });
    base
}

fn skill(root: &Path, name: &str, description: &str, body: &str) {
    let d = root.join(name);
    fs::create_dir_all(&d).unwrap();
    fs::write(
        d.join("SKILL.md"),
        format!("---\nname: {name}\ndescription: {description}\n---\n\n{body}\n"),
    )
    .unwrap();
}

/// Reference corpus for the test suite. Deliberately small: 10 to 100 skills is the
/// real size of a working machine. The skill text below stays in Portuguese on
/// purpose: it exercises the tokenizer's accent-folding and glue-word removal on
/// real pt-BR input, which is exactly what the bilingual GLUE_WORDS list exists for.
fn corpus() -> PathBuf {
    let base = test_home();
    let root = base.join("skills");
    CORPUS.call_once(|| {
      fs::create_dir_all(&root).unwrap();
      skill(&root, "systematic-debugging",
        "Depuracao sistematica de bug dificil: reproduzir, isolar, diagnosticar e corrigir quando algo quebrou.",
        "Reproduza o defeito. Isole por bisseccao. Escreva o teste que falha. Corrija. Stack trace, excecao, crash, regressao, comportamento inesperado.");
    skill(
        &root,
        "test-driven-development",
        "Escrever o teste antes do codigo: ciclo vermelho, verde, refatorar.",
        "Teste primeiro. Codigo minimo. Refatoracao. Cobertura, assercao, mock, fixture.",
    );
    skill(&root, "xlsx",
        "Criar, ler e editar planilha Excel xlsx, csv e tsv: formula, formatacao, grafico e limpeza de dado tabular bagunçado.",
        "Coluna, linha, celula, formula, grafico, tabela dinamica, planilha suja, cabecalho fora do lugar.");
    skill(&root, "docx",
        "Criar e editar documento Word docx: sumario, cabecalho, numeracao de pagina, papel timbrado.",
        "Relatorio, memorando, carta, modelo, estilo de paragrafo.");
    skill(&root, "traducao-tecnica",
        "Traduzir documentacao tecnica entre portugues, ingles e espanhol mantendo termo consagrado.",
        "Glossario, termo tecnico, consistencia terminologica, revisao bilingue.");
      skill(&root, "stop-slop",
        "Cortar enchimento de texto gerado por IA: adverbio inutil, frase de efeito, conclusao que nao conclui.",
        "Texto inchado, chavao, redundancia, revisao de estilo, corte seco.");
    });
    root
}

fn build_index() -> index::Index {
    let root = corpus();
    let idx = index::build(&[root]);
    storage::atomic_write(
        &home::ensure_dir().join("index.txt"),
        index::write(&idx).as_bytes(),
        0o600,
    )
    .unwrap();
    idx
}

// ------------------------------------------------------------------ 1. sha256

#[test]
fn c01_sha256_matches_known_vectors() {
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
fn c02_tokenizer_folds_accents_strips_glue_and_ignores_bare_numbers() {
    let t = text::terms("O código não está em 2026, é só verificação");
    assert!(
        t.contains(&"codigo".to_string()),
        "accent has to disappear: {:?}",
        t
    );
    assert!(t.contains(&"verificacao".to_string()));
    assert!(!t.contains(&"o".to_string()));
    assert!(
        !t.contains(&"nao".to_string()),
        "glue word has to be gone: {:?}",
        t
    );
    assert!(
        !t.contains(&"2026".to_string()),
        "a bare number doesn't route: {:?}",
        t
    );
}

#[test]
fn c03_inflection_tolerance_via_five_letter_prefix() {
    let a = text::terms("quebrou");
    let b = text::terms("quebrado");
    assert!(a.contains(&"quebr".to_string()));
    assert!(b.contains(&"quebr".to_string()));
    assert!(a.contains(&"quebrou".to_string()));
    assert!(b.contains(&"quebrado".to_string()));

    // a short word does NOT get a prefix — otherwise "casa" and "caso" become the same thing
    let c = text::terms("casa caso");
    assert!(!c.iter().any(|x| x == "cas"), "{:?}", c);
    assert_eq!(text::PREFIX_LEN, 5);
}

// ---------------------------------------------------------- 4. frontmatter

#[test]
fn c04_frontmatter_reads_key_value_and_indented_continuation() {
    let (fm, end) = index::frontmatter(
        "---\nname: minha-skill\ndescription: primeira parte\n  segunda parte\nversion: 2.1.0\n---\ncorpo aqui\n",
    );
    assert_eq!(fm.get("name").unwrap(), "minha-skill");
    assert_eq!(
        fm.get("description").unwrap(),
        "primeira parte segunda parte"
    );
    assert_eq!(fm.get("version").unwrap(), "2.1.0");
    assert!(end > 0);

    let (empty, zero) = index::frontmatter("# so um titulo\n");
    assert!(empty.is_empty());
    assert_eq!(zero, 0);
}

// -------------------------------------------------------------- 5. index

#[test]
fn c05_index_survives_a_round_trip_through_disk() {
    let idx = build_index();
    assert_eq!(idx.skills.len(), 6);

    let raw = fs::read_to_string(home::app_dir().join("index.txt")).unwrap();
    let terms = text::terms("planilha bagunçada");
    let read = index::read_partial(&raw, &terms);

    assert_eq!(read.skills.len(), 6, "all skills come back");
    assert!(
        (read.avg_size - idx.avg_size).abs() < 0.01,
        "average size preserved"
    );
    assert!(
        read.postings.len() <= terms.len(),
        "partial read materialized {} postings for {} terms",
        read.postings.len(),
        terms.len()
    );
    for t in &terms {
        if let Some(a) = idx.postings.get(t) {
            assert_eq!(
                read.postings.get(t).unwrap(),
                a,
                "posting for '{}' diverged",
                t
            );
        }
    }
}

// ---------------------------------------------------------------- 6. route

fn scores(query: &str) -> Vec<(String, f64)> {
    build_index();
    let raw = fs::read_to_string(home::app_dir().join("index.txt")).unwrap();
    let terms = text::terms(query);
    let idx = index::read_partial(&raw, &terms);
    bm25::score(&idx, &terms)
        .into_iter()
        .map(|a| (idx.skills[a.skill as usize].name.clone(), a.score))
        .collect()
}

#[test]
fn c06_route_finds_the_obvious() {
    let cases: [(&str, &str); 5] = [
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
    for (query, expected) in cases {
        let r = scores(query);
        assert!(
            !r.is_empty(),
            "router went silent on a legitimate case: {query:?}"
        );
        assert_eq!(
            r[0].0, expected,
            "query {query:?} should rank {expected} first, got {r:?}"
        );
    }
}

#[test]
fn c07_silence_on_noise() {
    for query in [
        "oi tudo bem",
        "obrigado",
        "e isso ai entao",
        "voce pode me ajudar por favor",
        "ok",
    ] {
        let r = scores(query);
        assert!(r.is_empty(), "router spoke on noise {query:?}: {r:?}");
    }
}

#[test]
fn c08_bm25_parameters_are_frozen() {
    assert_eq!(bm25::K1, 1.5);
    assert_eq!(bm25::B, 0.75);
    assert_eq!(bm25::NOISE_CUTOFF, 2.0);
    assert_eq!(bm25::MAX_SUGGESTIONS, 3);
    assert_eq!(index::BODY_TERMS, 400);

    let r = scores("planilha codigo teste documento traducao texto relatorio");
    assert!(r.len() <= bm25::MAX_SUGGESTIONS, "{:?}", r);
    for (_, n) in &r {
        assert!(*n >= bm25::NOISE_CUTOFF, "score {n} below the cutoff");
    }
}

#[test]
fn c09_determinism() {
    let a = scores("o programa quebrou e eu preciso achar a causa");
    let b = scores("o programa quebrou e eu preciso achar a causa");
    assert_eq!(a, b, "same query has to produce exactly the same output");
}

// -------------------------------------------------------------- 10. holdout

#[test]
fn c10_holdout_is_deterministic_and_stays_in_range() {
    build_index();
    let p = "consulta de controle numero 42 sobre planilha";
    let one = route::route(p, "test", None, "0.0.0");
    let two = route::route(p, "test", None, "0.0.0");
    assert_eq!(
        one.event.field("holdout"),
        two.event.field("holdout"),
        "holdout has to be deterministic — otherwise you could just retry until the router speaks"
    );

    let mut fell = 0;
    for i in 0..2000 {
        let e = route::route(
            &format!("planilha bagunçada caso {i}"),
            "test",
            None,
            "0.0.0",
        );
        if matches!(e.event.field("holdout"), Value::Bool(true)) {
            fell += 1;
        }
    }
    let pct = 100.0 * fell as f64 / 2000.0;
    assert!(
        (2.5..=8.0).contains(&pct),
        "holdout came out at {pct:.1}% of turns, expected close to 5%"
    );
}

// ------------------------------------------------------------ 11. privacy

#[test]
fn c11_the_prompt_never_enters_the_event() {
    build_index();
    let secret = "minha chave secreta e bananadeprata e o cliente chama Fulano da Silva";
    let s = route::route(secret, "test", None, "0.0.0");
    let line = json::write(&s.event);

    assert!(
        !line.contains("bananadeprata"),
        "leaked a chunk of the prompt: {line}"
    );
    assert!(
        !line.contains("Fulano"),
        "leaked a chunk of the prompt: {line}"
    );
    assert!(!line.contains("secreta"));
    assert_eq!(s.event.field("prompt_hash").text().len(), 32);
    assert_eq!(
        s.event.field("prompt_len").number() as usize,
        secret.chars().count()
    );

    let a = sha256::hash_with_salt("salt-a", secret);
    let b = sha256::hash_with_salt("salt-b", secret);
    assert_ne!(a, b);
}

#[test]
fn c12_daily_summary_never_carries_a_raw_event() {
    let events = vec![
        json::read(r#"{"v":1,"t":1756000000,"type":"route","turn":"t1","prompt_hash":"abc","prompt_len":40,"holdout":false,"suggestions":[{"skill":"xlsx","version":"1.0","score":7.1}]}"#).unwrap(),
        json::read(r#"{"v":1,"t":1756000001,"type":"activation","turn":"t1","skill":"xlsx","by":"model"}"#).unwrap(),
        json::read(r#"{"v":1,"t":1756000050,"type":"outcome","turn":"t1","ok":true,"reprompt":0,"turns":2,"cost_usd":0.012}"#).unwrap(),
    ];
    let ag = record::aggregate(&events, Some("2025-08-24"));
    assert_eq!(ag.routes, 1);
    assert_eq!(ag.routes_suggested, 1);
    assert_eq!(ag.skills.get("xlsx").unwrap().activations, 1);
    assert_eq!(ag.suggested_arm, (0, 0));

    let v = record::daily_summary(&ag, "2025-08-24", "0.1.0", "hook");
    let s = json::write(&v);
    assert!(
        !s.contains("prompt_hash"),
        "the summary can't carry a prompt hash: {s}"
    );
    assert!(
        !s.contains("\"turn\""),
        "the summary can't carry a turn id: {s}"
    );
    assert!(s.contains("batuta.daily_summary.v2"));
    assert!(
        s.contains("declared_bias"),
        "the sample's bias always ships declared"
    );
}

// ------------------------------------------------------------------- 13. json

#[test]
fn c13_canonical_json_round_trips() {
    let raw = r#"{"b":2,"a":[1,2,{"z":null,"y":true}],"c":"com \"aspas\" e \n quebra e ç"}"#;
    let v = json::read(raw).unwrap();
    let out = json::write(&v);
    assert!(out.starts_with(r#"{"a":"#), "{out}");
    let back = json::read(&out).unwrap();
    assert_eq!(v, back, "round trip has to preserve the value");
    assert!(v.field("c").text().contains('ç'));
    assert!(json::read("{oi}").is_err());
}

#[test]
fn c14_utc_date() {
    assert_eq!(batuta::data::day_utc(1_756_000_000), "2025-08-24");
    assert_eq!(
        batuta::data::instant_utc(1_756_000_000),
        "2025-08-24T01:46:40Z"
    );
}

// ---------------------------------------------------- 15. turn budget

#[test]
fn c15_hot_path_fits_the_budget() {
    let base = test_home();
    let root = base.join("skills-large");
    if !root.exists() {
        fs::create_dir_all(&root).unwrap();
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
            skill(&root, &format!("skill-{i:03}"), &d, &c);
        }
        for n in fs::read_dir(corpus()).unwrap().flatten() {
            let dest = root.join(n.file_name());
            fs::create_dir_all(&dest).unwrap();
            fs::copy(n.path().join("SKILL.md"), dest.join("SKILL.md")).unwrap();
        }
    }
    let idx = index::build(&[root]);
    assert!(
        idx.skills.len() >= 500,
        "large corpus has {}",
        idx.skills.len()
    );
    let raw = index::write(&idx);
    storage::atomic_write(&home::ensure_dir().join("index.txt"), raw.as_bytes(), 0o600).unwrap();
    home::write_config(&home::Config {
        holdout_pct: 0,
        informed: true,
        ..home::Config::default()
    })
    .unwrap();

    let queries: Vec<String> = (0..50)
        .map(|i| format!("preciso limpar planilha bagunçada e gerar relatorio {i}"))
        .collect();

    let t0 = std::time::Instant::now();
    for c in &queries {
        let terms = text::terms(c);
        let idx = index::read_partial(&raw, &terms);
        let _ = bm25::score(&idx, &terms);
    }
    let algorithm_total = t0.elapsed().as_micros() as f64 / 1000.0;
    let algorithm_ms = algorithm_total / queries.len() as f64;

    let operational_started = std::time::Instant::now();
    for (sequence, query) in queries.iter().take(20).enumerate() {
        let output = route::route(query, "hook", None, "benchmark");
        lifecycle::begin_turn(
            &json::object(vec![(
                "session_id",
                json::text(format!("benchmark-session-{sequence}")),
            )]),
            &output,
        )
        .unwrap();
        route::log_event(&output).unwrap();
    }
    let operational_ms = operational_started.elapsed().as_secs_f64() * 1000.0 / 20.0;

    assert!(
        operational_ms < 50.0,
        "{operational_ms:.1}ms per operational route with {} skills — blew the budget's slack",
        idx.skills.len()
    );
    eprintln!(
        "  [measured] {} skills · {:.2}ms algorithm · {:.2}ms operational route · {} KB index",
        idx.skills.len(),
        algorithm_ms,
        operational_ms,
        raw.len() / 1024
    );
}
