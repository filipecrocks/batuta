//! BATUTA — camada aberta de medicao de Agent Skills.
//! Este binario e o CAMINHO QUENTE: roteia e registra, local, em milissegundos.
//! Ele nao acessa a rede. Nunca. Se um comando precisar de rede, ele nao mora aqui.

use batuta::json::{self, num, obj, txt, Valor};
use batuta::{achar, casa, conflitos, data, indice, registro, rota, VERSAO};
use std::io::Read;

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let cmd = args.first().map(|s| s.as_str()).unwrap_or("help");
    let resto = &args[1.min(args.len())..];

    let codigo = match cmd {
        "index" | "indexar" => cmd_index(resto),
        "route" | "rota" => cmd_route(resto),
        "log" | "registrar" => cmd_log(resto),
        "report" | "relatorio" => cmd_report(resto),
        "resumo" => cmd_resumo(resto),
        "find" | "achar" => cmd_find(resto),
        "conflicts" | "conflitos" => cmd_conflicts(resto),
        "config" => cmd_config(resto),
        "privacidade" => cmd_privacidade(),
        "install-hooks" | "hooks" => cmd_hooks(resto),
        "version" | "--version" | "-V" => {
            println!("batuta {}", VERSAO);
            0
        }
        "help" | "--help" | "-h" | "" => {
            print!("{}", ajuda());
            0
        }
        outro => {
            eprintln!("batuta: comando desconhecido '{}'\n", outro);
            print!("{}", ajuda());
            2
        }
    };
    std::process::exit(codigo);
}

fn ajuda() -> String {
    format!(
        "batuta {v} — mede se Agent Skill funciona, a que custo, em qual modelo.
https://batuta.space · zero lucro · o prompt nunca sai da sua maquina

  batuta index [--dir CAMINHO]...     varre as skills e monta o indice local
  batuta route \"<pedido>\"             roteia (caminho quente, sem rede)
       --stdin | --stdin-json         le o pedido da entrada padrao
       --modo hook|mcp|skill          de onde veio (default: hook)
       --turno ID                     amarra rota, ativacao e desfecho
       --json                         devolve a rota como JSON
  batuta log --evento ativacao --skill NOME [--por modelo|usuario] [--turno ID]
  batuta log --evento desfecho [--ok|--falhou] [--reprompt N] [--erros N]
             [--retries N] [--turnos N] [--tokens-in N] [--tokens-out N]
             [--custo N] [--turno ID]
  batuta report [--dia AAAA-MM-DD]    funil, skill fantasma, custo por tarefa, lift
  batuta resumo [--dia AAAA-MM-DD]    mostra EXATAMENTE o que subiria (agregado)
  batuta find \"<o que voce quer fazer>\"   instalada -> disponivel -> lacuna
  batuta conflicts                    skills que competem entre si
  batuta config [chave valor]         envio, holdout_pct, portal
  batuta privacidade                  o que fica gravado, em portugues claro
  batuta install-hooks [--aplicar]    instala o hook UserPromptSubmit

O relatorio funciona 100%% offline. Enviar dado e opt-in, e o que sobe e resumo
diario agregado por skill — nunca evento cru, nunca o texto do seu prompt.
",
        v = VERSAO
    )
}

// ------------------------------------------------------------------ utilitario

fn opt(args: &[String], nome: &str) -> Option<String> {
    let mut i = 0;
    while i < args.len() {
        if args[i] == nome {
            return args.get(i + 1).cloned();
        }
        if let Some(r) = args[i].strip_prefix(&format!("{}=", nome)) {
            return Some(r.to_string());
        }
        i += 1;
    }
    None
}
fn tem(args: &[String], nome: &str) -> bool {
    args.iter().any(|a| a == nome)
}
fn optn(args: &[String], nome: &str) -> f64 {
    opt(args, nome)
        .and_then(|s| s.parse::<f64>().ok())
        .unwrap_or(0.0)
}
fn posicional(args: &[String]) -> Option<String> {
    let mut i = 0;
    while i < args.len() {
        let a = &args[i];
        if a.starts_with("--") {
            // flags com valor consomem o proximo
            if !a.contains('=')
                && matches!(
                    a.as_str(),
                    "--modo"
                        | "--turno"
                        | "--dir"
                        | "--evento"
                        | "--skill"
                        | "--por"
                        | "--dia"
                        | "--reprompt"
                        | "--erros"
                        | "--retries"
                        | "--turnos"
                        | "--tokens-in"
                        | "--tokens-out"
                        | "--custo"
                )
            {
                i += 2;
                continue;
            }
            i += 1;
            continue;
        }
        return Some(a.clone());
    }
    None
}

fn ler_stdin() -> String {
    let mut s = String::new();
    let _ = std::io::stdin().read_to_string(&mut s);
    s
}

// -------------------------------------------------------------------- comandos

fn cmd_index(args: &[String]) -> i32 {
    let mut pastas: Vec<std::path::PathBuf> = Vec::new();
    let mut i = 0;
    while i < args.len() {
        if args[i] == "--dir" {
            if let Some(v) = args.get(i + 1) {
                pastas.push(std::path::PathBuf::from(v));
            }
            i += 2;
            continue;
        }
        i += 1;
    }
    if pastas.is_empty() {
        let cwd = std::env::current_dir().unwrap_or_else(|_| ".".into());
        pastas = indice::pastas_padrao(&casa::lar(), &cwd);
    }
    if pastas.is_empty() {
        eprintln!(
            "batuta: nao achei pasta de skills.\n  \
             procurei em ~/.claude/skills, ~/.config/claude/skills, ~/.codex/skills, ./.claude/skills, ./skills\n  \
             use --dir CAMINHO para apontar."
        );
        return 1;
    }

    let t0 = std::time::Instant::now();
    let idx = indice::construir(&pastas);
    let corpo = indice::gravar(&idx);
    let destino = casa::garantir().join("indice.txt");
    if let Err(e) = std::fs::write(&destino, corpo) {
        eprintln!("batuta: nao consegui gravar {}: {}", destino.display(), e);
        return 1;
    }
    println!(
        "batuta: {} skills indexadas em {:.0}ms, {} termos distintos",
        idx.skills.len(),
        t0.elapsed().as_micros() as f64 / 1000.0,
        idx.postings.len()
    );
    for p in &pastas {
        println!("  fonte: {}", p.display());
    }
    println!("  indice: {}", destino.display());
    if idx.skills.is_empty() {
        println!("  (nenhum SKILL.md encontrado — o roteador vai ficar calado, e certo)");
    }
    0
}

fn cmd_route(args: &[String]) -> i32 {
    let prompt = if tem(args, "--stdin-json") {
        let bruto = ler_stdin();
        match json::ler(&bruto) {
            Ok(v) => {
                let p = v.campo("prompt").txt().to_string();
                if p.is_empty() {
                    v.campo("user_prompt").txt().to_string()
                } else {
                    p
                }
            }
            // entrada quebrada nao pode derrubar o turno do usuario
            Err(_) => String::new(),
        }
    } else if tem(args, "--stdin") {
        ler_stdin()
    } else {
        posicional(args).unwrap_or_default()
    };

    if prompt.trim().is_empty() {
        return 0;
    }

    let modo = opt(args, "--modo").unwrap_or_else(|| "hook".to_string());
    let turno = opt(args, "--turno");
    let s = rota::rotear(&prompt, &modo, turno, VERSAO);
    rota::registrar(&s);

    if tem(args, "--json") {
        println!("{}", json::escrever(&s.evento));
    } else if let Some(t) = &s.texto {
        println!("{}", t);
    }
    0
}

fn cmd_log(args: &[String]) -> i32 {
    let evento = opt(args, "--evento").unwrap_or_default();
    let turno = opt(args, "--turno").unwrap_or_else(|| "sem-turno".to_string());
    let agora = indice::agora() as f64;

    let v = match evento.as_str() {
        "ativacao" | "activate" => {
            let skill = opt(args, "--skill").unwrap_or_default();
            if skill.is_empty() {
                eprintln!("batuta log: --evento ativacao exige --skill NOME");
                return 2;
            }
            obj(vec![
                ("v", num(1)),
                ("t", num(agora)),
                ("tipo", txt("ativacao")),
                ("turno", txt(turno)),
                ("skill", txt(skill)),
                ("versao", txt(opt(args, "--versao").unwrap_or_default())),
                (
                    "por",
                    txt(opt(args, "--por").unwrap_or_else(|| "modelo".into())),
                ),
            ])
        }
        "desfecho" | "outcome" => {
            let ok = if tem(args, "--falhou") {
                false
            } else {
                tem(args, "--ok")
            };
            obj(vec![
                ("v", num(1)),
                ("t", num(agora)),
                ("tipo", txt("desfecho")),
                ("turno", txt(turno)),
                ("ok", Valor::Bool(ok)),
                ("reprompt", num(optn(args, "--reprompt"))),
                ("erros", num(optn(args, "--erros"))),
                ("retries", num(optn(args, "--retries"))),
                ("turnos", num(optn(args, "--turnos"))),
                ("tokens_in", num(optn(args, "--tokens-in"))),
                ("tokens_out", num(optn(args, "--tokens-out"))),
                ("custo_usd", num(optn(args, "--custo"))),
                (
                    "fonte",
                    txt(opt(args, "--fonte").unwrap_or_else(|| "proxy".into())),
                ),
            ])
        }
        _ => {
            eprintln!("batuta log: --evento tem que ser 'ativacao' ou 'desfecho'");
            return 2;
        }
    };
    registro::anexar(&v);
    0
}

fn cmd_report(args: &[String]) -> i32 {
    let eventos = registro::carregar();
    let dia = opt(args, "--dia");
    let ag = registro::agregar(&eventos, dia.as_deref());
    if tem(args, "--json") {
        let d = dia.unwrap_or_else(|| data::dia_utc(indice::agora()));
        println!(
            "{}",
            json::escrever(&registro::resumo_diario(&ag, &d, VERSAO, "local"))
        );
    } else {
        print!("{}", registro::relatorio_texto(&ag));
    }
    0
}

fn cmd_resumo(args: &[String]) -> i32 {
    let dia = opt(args, "--dia").unwrap_or_else(|| data::dia_utc(indice::agora()));
    let eventos = registro::carregar();
    let ag = registro::agregar(&eventos, Some(&dia));
    let cfg = casa::ler_config();
    let v = registro::resumo_diario(&ag, &dia, VERSAO, "local");
    println!("{}", json::escrever(&v));
    if !cfg.envio {
        eprintln!(
            "\n(envio esta DESLIGADO. Isto acima e so o que subiria se voce ligasse:\n \
             `batuta config envio sim`. Note que nao tem prompt, nem hash de prompt,\n \
             nem caminho de arquivo — so contagem por skill.)"
        );
    }
    0
}

fn cmd_find(args: &[String]) -> i32 {
    let consulta = posicional(args).unwrap_or_default();
    print!("{}", achar::achar(&consulta));
    0
}

fn cmd_conflicts(_args: &[String]) -> i32 {
    let cwd = std::env::current_dir().unwrap_or_else(|_| ".".into());
    let pastas = indice::pastas_padrao(&casa::lar(), &cwd);
    let idx = indice::construir(&pastas);
    print!("{}", conflitos::relatorio(&idx));
    0
}

fn cmd_config(args: &[String]) -> i32 {
    let mut cfg = casa::ler_config();
    let chave = args.first().cloned();
    let valor = args.get(1).cloned();
    match (chave.as_deref(), valor.as_deref()) {
        (Some("envio"), Some(v)) => {
            cfg.envio = v == "sim" || v == "true" || v == "1";
            cfg.avisado = true;
            casa::gravar_config(&cfg);
            println!(
                "envio = {}",
                if cfg.envio {
                    "sim (sobe resumo diario agregado; nunca o prompt)"
                } else {
                    "nao (nada sai desta maquina)"
                }
            );
        }
        (Some("holdout"), Some(v)) | (Some("holdout_pct"), Some(v)) => {
            cfg.holdout_pct = v.parse().unwrap_or(5).min(50);
            casa::gravar_config(&cfg);
            println!("holdout_pct = {}%", cfg.holdout_pct);
        }
        (Some("portal"), Some(v)) => {
            cfg.portal = v.to_string();
            casa::gravar_config(&cfg);
            println!("portal = {}", cfg.portal);
        }
        _ => {
            println!("envio       = {}", if cfg.envio { "sim" } else { "nao" });
            println!("holdout_pct = {}", cfg.holdout_pct);
            println!("portal      = {}", cfg.portal);
            println!("instalacao  = {}", casa::id_instalacao());
            println!("\narquivo: {}", casa::casa().join("config.txt").display());
        }
    }
    0
}

fn cmd_privacidade() -> i32 {
    let c = casa::casa();
    println!(
        "O que o Batuta guarda, na sua maquina, em {}:

  sal            um numero aleatorio criado uma vez, que nunca sai daqui
  indice.txt     nome, descricao e palavras das skills que voce ja tem
  eventos.jsonl  uma linha por turno: HASH do prompt (com o sal), quantos
                 caracteres tinha, quantas palavras sobraram, quais skills
                 foram sugeridas e se voce usou alguma
  config.txt     suas preferencias

O que NAO fica gravado em lugar nenhum: o texto do seu prompt, a resposta do
modelo, nome de arquivo do seu projeto, seu usuario, sua maquina.

O hash do prompt e feito COM o sal. Sem o sal — que so existe aqui — ninguem
consegue testar um palpite contra o hash. E o sal nunca e enviado.

Enviar dado e opt-in explicito (`batuta config envio sim`). Mesmo ligado, o que
sobe e o resumo diario agregado por skill: contagem, nada de texto. Veja com os
proprios olhos antes de decidir: `batuta resumo`.

Apagar tudo: rm -rf {}
",
        c.display(),
        c.display()
    );
    0
}

fn cmd_hooks(args: &[String]) -> i32 {
    let script = casa::garantir().join("user-prompt-submit.sh");
    let corpo = include_str!("../../../hooks/user-prompt-submit.sh");
    if let Err(e) = std::fs::write(&script, corpo) {
        eprintln!("batuta: nao consegui gravar {}: {}", script.display(), e);
        return 1;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755));
    }

    let trecho = format!(
        r#"{{
  "hooks": {{
    "UserPromptSubmit": [
      {{ "hooks": [ {{ "type": "command", "command": "{}", "timeout": 5 }} ] }}
    ]
  }}
}}"#,
        script.display()
    );

    println!("Hook gravado em {}\n", script.display());
    if tem(args, "--aplicar") {
        println!(
            "Ainda nao aplico sozinho no seu settings.json — mexer no arquivo de\n\
             configuracao do seu agente sem voce ver e exatamente o tipo de coisa\n\
             que o Batuta nao faz. Cole o trecho abaixo voce mesmo:\n"
        );
    } else {
        println!("Cole isto no seu ~/.claude/settings.json (juntando com o que ja existir):\n");
    }
    println!("{}\n", trecho);
    println!("Depois: `batuta index` uma vez, e `batuta report` quando quiser ver o numero.");
    0
}
