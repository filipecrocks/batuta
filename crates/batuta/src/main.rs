//! BATUTA — open measurement layer for Agent Skills.
//! This binary is the HOT PATH: it routes and logs, locally, in milliseconds.
//! It does not access the network. Ever. If a command needs the network, it doesn't live here.

use batuta::json::{self, number, object, text, Value};
use batuta::{conflicts, data, find, home, index, record, route, VERSION};
use std::io::Read;

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let cmd = args.first().map(|s| s.as_str()).unwrap_or("help");
    let rest = &args[1.min(args.len())..];

    let code = match cmd {
        "index" => cmd_index(rest),
        "route" => cmd_route(rest),
        "log" => cmd_log(rest),
        "report" => cmd_report(rest),
        "summary" => cmd_summary(rest),
        "find" => cmd_find(rest),
        "conflicts" => cmd_conflicts(rest),
        "config" => cmd_config(rest),
        "privacy" => cmd_privacy(),
        "install-hooks" | "hooks" => cmd_hooks(rest),
        "version" | "--version" | "-V" => {
            println!("batuta {}", VERSION);
            0
        }
        "help" | "--help" | "-h" | "" => {
            print!("{}", help());
            0
        }
        other => {
            eprintln!("batuta: unknown command '{}'\n", other);
            print!("{}", help());
            2
        }
    };
    std::process::exit(code);
}

fn help() -> String {
    format!(
        "batuta {v} — measures whether an Agent Skill works, at what cost, on which model.
https://batuta.space · zero profit · the prompt never leaves your machine

  batuta index [--dir PATH]...        scans skills and builds the local index
  batuta route \"<request>\"            routes (hot path, no network)
       --stdin | --stdin-json         reads the request from stdin
       --mode hook|mcp|skill          where it came from (default: hook)
       --turn ID                      ties together route, activation and outcome
       --json                         returns the route as JSON
  batuta log --event activation --skill NAME [--by model|user] [--turn ID]
  batuta log --event outcome [--ok|--failed] [--reprompt N] [--errors N]
             [--retries N] [--turns N] [--tokens-in N] [--tokens-out N]
             [--cost N] [--turn ID]
  batuta report [--day YYYY-MM-DD]    funnel, ghost skill, cost per task, lift
  batuta summary [--day YYYY-MM-DD]   shows EXACTLY what would upload (aggregate)
  batuta find \"<what you want to do>\"   installed -> available -> gap
  batuta conflicts                    skills that compete with each other
  batuta config [key value]           upload, holdout_pct, portal
  batuta privacy                      what gets recorded, in plain language
  batuta install-hooks [--apply]      installs the UserPromptSubmit hook

The report works 100%% offline. Sending data is opt-in, and what uploads is the
aggregated daily summary by skill — never a raw event, never your prompt text.
",
        v = VERSION
    )
}

// ------------------------------------------------------------------ utility

fn opt(args: &[String], name: &str) -> Option<String> {
    let mut i = 0;
    while i < args.len() {
        if args[i] == name {
            return args.get(i + 1).cloned();
        }
        if let Some(r) = args[i].strip_prefix(&format!("{}=", name)) {
            return Some(r.to_string());
        }
        i += 1;
    }
    None
}
fn has(args: &[String], name: &str) -> bool {
    args.iter().any(|a| a == name)
}
fn optn(args: &[String], name: &str) -> f64 {
    opt(args, name)
        .and_then(|s| s.parse::<f64>().ok())
        .unwrap_or(0.0)
}
fn positional(args: &[String]) -> Option<String> {
    let mut i = 0;
    while i < args.len() {
        let a = &args[i];
        if a.starts_with("--") {
            // flags with a value consume the next one
            if !a.contains('=')
                && matches!(
                    a.as_str(),
                    "--mode"
                        | "--turn"
                        | "--dir"
                        | "--event"
                        | "--skill"
                        | "--by"
                        | "--day"
                        | "--reprompt"
                        | "--errors"
                        | "--retries"
                        | "--turns"
                        | "--tokens-in"
                        | "--tokens-out"
                        | "--cost"
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

fn read_stdin() -> String {
    let mut s = String::new();
    let _ = std::io::stdin().read_to_string(&mut s);
    s
}

// -------------------------------------------------------------------- commands

fn cmd_index(args: &[String]) -> i32 {
    let mut folders: Vec<std::path::PathBuf> = Vec::new();
    let mut i = 0;
    while i < args.len() {
        if args[i] == "--dir" {
            if let Some(v) = args.get(i + 1) {
                folders.push(std::path::PathBuf::from(v));
            }
            i += 2;
            continue;
        }
        i += 1;
    }
    if folders.is_empty() {
        let cwd = std::env::current_dir().unwrap_or_else(|_| ".".into());
        folders = index::default_folders(&home::user_home(), &cwd);
    }
    if folders.is_empty() {
        eprintln!(
            "batuta: couldn't find a skills folder.\n  \
             looked in ~/.claude/skills, ~/.config/claude/skills, ~/.codex/skills, ./.claude/skills, ./skills\n  \
             use --dir PATH to point at one."
        );
        return 1;
    }

    let t0 = std::time::Instant::now();
    let idx = index::build(&folders);
    let body = index::write(&idx);
    let dest = home::ensure_dir().join("index.txt");
    if let Err(e) = std::fs::write(&dest, body) {
        eprintln!("batuta: couldn't write {}: {}", dest.display(), e);
        return 1;
    }
    println!(
        "batuta: {} skills indexed in {:.0}ms, {} distinct terms",
        idx.skills.len(),
        t0.elapsed().as_micros() as f64 / 1000.0,
        idx.postings.len()
    );
    for p in &folders {
        println!("  source: {}", p.display());
    }
    println!("  index: {}", dest.display());
    if idx.skills.is_empty() {
        println!("  (no SKILL.md found — the router will stay silent, and that's correct)");
    }
    0
}

fn cmd_route(args: &[String]) -> i32 {
    let prompt = if has(args, "--stdin-json") {
        let raw = read_stdin();
        match json::read(&raw) {
            Ok(v) => {
                let p = v.field("prompt").text().to_string();
                if p.is_empty() {
                    v.field("user_prompt").text().to_string()
                } else {
                    p
                }
            }
            // broken input must not bring down the user's turn
            Err(_) => String::new(),
        }
    } else if has(args, "--stdin") {
        read_stdin()
    } else {
        positional(args).unwrap_or_default()
    };

    if prompt.trim().is_empty() {
        return 0;
    }

    let mode = opt(args, "--mode").unwrap_or_else(|| "hook".to_string());
    let turn = opt(args, "--turn");
    let s = route::route(&prompt, &mode, turn, VERSION);
    route::log_event(&s);

    if has(args, "--json") {
        println!("{}", json::write(&s.event));
    } else if let Some(t) = &s.text {
        println!("{}", t);
    }
    0
}

fn cmd_log(args: &[String]) -> i32 {
    let event = opt(args, "--event").unwrap_or_default();
    let turn = opt(args, "--turn").unwrap_or_else(|| "no-turn".to_string());
    let now = index::now() as f64;

    let v = match event.as_str() {
        "activation" => {
            let skill = opt(args, "--skill").unwrap_or_default();
            if skill.is_empty() {
                eprintln!("batuta log: --event activation requires --skill NAME");
                return 2;
            }
            object(vec![
                ("v", number(1)),
                ("t", number(now)),
                ("type", text("activation")),
                ("turn", text(turn)),
                ("skill", text(skill)),
                ("version", text(opt(args, "--version").unwrap_or_default())),
                (
                    "by",
                    text(opt(args, "--by").unwrap_or_else(|| "model".into())),
                ),
            ])
        }
        "outcome" => {
            let ok = if has(args, "--failed") {
                false
            } else {
                has(args, "--ok")
            };
            object(vec![
                ("v", number(1)),
                ("t", number(now)),
                ("type", text("outcome")),
                ("turn", text(turn)),
                ("ok", Value::Bool(ok)),
                ("reprompt", number(optn(args, "--reprompt"))),
                ("errors", number(optn(args, "--errors"))),
                ("retries", number(optn(args, "--retries"))),
                ("turns", number(optn(args, "--turns"))),
                ("tokens_in", number(optn(args, "--tokens-in"))),
                ("tokens_out", number(optn(args, "--tokens-out"))),
                ("cost_usd", number(optn(args, "--cost"))),
                (
                    "source",
                    text(opt(args, "--source").unwrap_or_else(|| "proxy".into())),
                ),
            ])
        }
        _ => {
            eprintln!("batuta log: --event has to be 'activation' or 'outcome'");
            return 2;
        }
    };
    record::append(&v);
    0
}

fn cmd_report(args: &[String]) -> i32 {
    let events = record::load();
    let day = opt(args, "--day");
    let ag = record::aggregate(&events, day.as_deref());
    if has(args, "--json") {
        let d = day.unwrap_or_else(|| data::day_utc(index::now()));
        println!(
            "{}",
            json::write(&record::daily_summary(&ag, &d, VERSION, "local"))
        );
    } else {
        print!("{}", record::text_report(&ag));
    }
    0
}

fn cmd_summary(args: &[String]) -> i32 {
    let day = opt(args, "--day").unwrap_or_else(|| data::day_utc(index::now()));
    let events = record::load();
    let ag = record::aggregate(&events, Some(&day));
    let cfg = home::read_config();
    let v = record::daily_summary(&ag, &day, VERSION, "local");
    println!("{}", json::write(&v));
    if !cfg.upload {
        eprintln!(
            "\n(upload is OFF. What's above is only what would upload if you turned it on:\n \
             `batuta config upload yes`. Note there's no prompt, no prompt hash,\n \
             no file path — just per-skill counts.)"
        );
    }
    0
}

fn cmd_find(args: &[String]) -> i32 {
    let query = positional(args).unwrap_or_default();
    print!("{}", find::find(&query));
    0
}

fn cmd_conflicts(_args: &[String]) -> i32 {
    let cwd = std::env::current_dir().unwrap_or_else(|_| ".".into());
    let folders = index::default_folders(&home::user_home(), &cwd);
    let idx = index::build(&folders);
    print!("{}", conflicts::report(&idx));
    0
}

fn cmd_config(args: &[String]) -> i32 {
    let mut cfg = home::read_config();
    let key = args.first().cloned();
    let value = args.get(1).cloned();
    match (key.as_deref(), value.as_deref()) {
        (Some("upload"), Some(v)) => {
            cfg.upload = v == "yes" || v == "true" || v == "1";
            cfg.informed = true;
            home::write_config(&cfg);
            println!(
                "upload = {}",
                if cfg.upload {
                    "yes (uploads the aggregated daily summary; never the prompt)"
                } else {
                    "no (nothing leaves this machine)"
                }
            );
        }
        (Some("holdout"), Some(v)) | (Some("holdout_pct"), Some(v)) => {
            cfg.holdout_pct = v.parse().unwrap_or(5).min(50);
            home::write_config(&cfg);
            println!("holdout_pct = {}%", cfg.holdout_pct);
        }
        (Some("portal"), Some(v)) => {
            cfg.portal = v.to_string();
            home::write_config(&cfg);
            println!("portal = {}", cfg.portal);
        }
        _ => {
            println!("upload      = {}", if cfg.upload { "yes" } else { "no" });
            println!("holdout_pct = {}", cfg.holdout_pct);
            println!("portal      = {}", cfg.portal);
            println!("installation = {}", home::installation_id());
            println!("\nfile: {}", home::app_dir().join("config.txt").display());
        }
    }
    0
}

fn cmd_privacy() -> i32 {
    let c = home::app_dir();
    println!(
        "What Batuta keeps, on your machine, at {}:

  salt           a random number created once, that never leaves here
  index.txt      name, description and words of the skills you already have
  events.jsonl   one line per turn: HASH of the prompt (with the salt), how many
                 characters it had, how many terms were left, which skills
                 were suggested, and whether you used one
  config.txt     your preferences

What does NOT get recorded anywhere: your prompt text, the model's response,
your project's file name, your username, your machine.

The prompt hash is made WITH the salt. Without the salt — which only exists
here — nobody can test a guess against the hash. And the salt is never sent.

Sending data is explicit opt-in (`batuta config upload yes`). Even when on, what
uploads is the daily summary aggregated by skill: counts, no text. See it with
your own eyes before deciding: `batuta summary`.

Delete everything: rm -rf {}
",
        c.display(),
        c.display()
    );
    0
}

fn cmd_hooks(args: &[String]) -> i32 {
    let script = home::ensure_dir().join("user-prompt-submit.sh");
    let body = include_str!("../../../hooks/user-prompt-submit.sh");
    if let Err(e) = std::fs::write(&script, body) {
        eprintln!("batuta: couldn't write {}: {}", script.display(), e);
        return 1;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755));
    }

    let snippet = format!(
        r#"{{
  "hooks": {{
    "UserPromptSubmit": [
      {{ "hooks": [ {{ "type": "command", "command": "{}", "timeout": 5 }} ] }}
    ]
  }}
}}"#,
        script.display()
    );

    println!("Hook written to {}\n", script.display());
    if has(args, "--apply") {
        println!(
            "I still don't apply it to your settings.json by myself — touching your\n\
             agent's configuration file without you seeing it is exactly the kind of\n\
             thing Batuta doesn't do. Paste the snippet below yourself:\n"
        );
    } else {
        println!(
            "Paste this into your ~/.claude/settings.json (merging with what's already there):\n"
        );
    }
    println!("{}\n", snippet);
    println!("Then: `batuta index` once, and `batuta report` whenever you want to see the number.");
    0
}
