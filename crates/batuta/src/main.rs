//! Batuta's dependency-free offline CLI and routing hot path.

use batuta::json::{self, number, object, text as json_text, Value};
use batuta::{conflicts, data, find, home, index, lifecycle, record, route, text, VERSION};
use std::io::{Read, Write};
use std::time::Duration;

const MAX_STDIN_BYTES: u64 = 256 * 1024;
// Leave 50 ms for stdout flush and process teardown beneath the public 300 ms
// hook ceiling. Work that cannot finish in 250 ms is discarded.
const ROUTE_TIMEOUT: Duration = Duration::from_millis(250);

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let command = args.first().map(String::as_str).unwrap_or("help");
    let rest = &args[1.min(args.len())..];
    warn_legacy_flags(rest);
    let exit_code = match command {
        "index" => cmd_index(rest),
        "indexar" => legacy("indexar", "index", || cmd_index(rest)),
        "route" => cmd_route(rest),
        "rota" => legacy("rota", "route", || cmd_route(rest)),
        "log" => cmd_log(rest),
        "registrar" => legacy("registrar", "log", || cmd_log(rest)),
        "report" => cmd_report(rest),
        "relatorio" | "relatório" => legacy(command, "report", || cmd_report(rest)),
        "summary" => cmd_summary(rest),
        "resumo" => legacy("resumo", "summary", || cmd_summary(rest)),
        "find" => cmd_find(rest),
        "achar" => legacy("achar", "find", || cmd_find(rest)),
        "conflicts" => cmd_conflicts(),
        "conflitos" => legacy("conflitos", "conflicts", cmd_conflicts),
        "config" => cmd_config(rest),
        "privacy" => cmd_privacy(),
        "privacidade" => legacy("privacidade", "privacy", cmd_privacy),
        "install-hooks" | "hooks" => cmd_hooks(rest),
        "hook" => cmd_hook(rest),
        "version" | "--version" | "-V" => {
            println!("batuta {VERSION}");
            0
        }
        "help" | "--help" | "-h" | "" => {
            print!("{}", help());
            0
        }
        other => {
            eprintln!("batuta: unknown command '{other}'\n");
            print!("{}", help());
            2
        }
    };
    std::process::exit(exit_code);
}

fn help() -> String {
    format!(
        "batuta {VERSION} — measure whether Agent Skills work, at what cost, and on which model.
https://batuta.space · zero profit · prompts never leave your machine

  batuta index [--dir PATH]...        scan skills and build the local index
  batuta route \"<request>\"           route locally without network access
       --stdin | --stdin-json         read the request from standard input
       --mode hook|mcp|skill|lab      observation source (default: hook)
       --turn-id ID                   correlate route, activation, and outcome
       --json                         return the route event as JSON
  batuta log --event activation --skill NAME [--actor model|user] [--turn-id ID]
  batuta log --event outcome          record an untrusted manual observation
  batuta report [--date YYYY-MM-DD]   show local observational metrics
  batuta summary [--date YYYY-MM-DD]  preview the private aggregate locally
  batuta find \"<what you need>\"      installed -> available -> gap
  batuta conflicts                    find competing skills
  batuta config [key value]           holdout_pct, portal (upload is unavailable)
  batuta privacy                      explain local and controlled-import data
  batuta install-hooks                write route/activation/outcome hooks

`batuta summary` is a local preview; this release has no public uploader or key
enrollment. Batuta is an observability layer, never sole proof of delivery. Portuguese aliases remain
available with deprecation warnings during the v0.x compatibility window.
"
    )
}

fn legacy<F: FnOnce() -> i32>(old: &str, new: &str, action: F) -> i32 {
    eprintln!("batuta: warning: '{old}' is deprecated; use '{new}'");
    action()
}

fn warn_legacy_flags(args: &[String]) {
    const LEGACY_FLAGS: &[(&str, &str)] = &[
        ("--modo", "--mode"),
        ("--turn", "--turn-id"),
        ("--turno", "--turn-id"),
        ("--evento", "--event"),
        ("--by", "--actor"),
        ("--por", "--actor"),
        ("--day", "--date"),
        ("--dia", "--date"),
        ("--erros", "--errors"),
        ("--turnos", "--turns"),
        ("--custo", "--cost"),
        ("--versao", "--version"),
        ("--fonte", "--source"),
        ("--aplicar", "--apply"),
    ];
    for argument in args {
        for (legacy, canonical) in LEGACY_FLAGS {
            if argument == legacy || argument.starts_with(&format!("{legacy}=")) {
                eprintln!("batuta: warning: '{legacy}' is deprecated; use '{canonical}'");
            }
        }
    }
}

fn option(args: &[String], name: &str) -> Option<String> {
    let mut index = 0;
    while index < args.len() {
        if args[index] == name {
            return args.get(index + 1).cloned();
        }
        if let Some(value) = args[index].strip_prefix(&format!("{name}=")) {
            return Some(value.to_string());
        }
        index += 1;
    }
    None
}

fn has(args: &[String], name: &str) -> bool {
    args.iter().any(|argument| argument == name)
}

fn numeric_option(
    args: &[String],
    names: &[&str],
    maximum: f64,
    integer: bool,
) -> Result<f64, String> {
    let Some(raw) = names.iter().find_map(|name| option(args, name)) else {
        return Ok(0.0);
    };
    let value: f64 = raw
        .parse()
        .map_err(|_| format!("{} must be a number", names[0]))?;
    if !value.is_finite() || value < 0.0 || value > maximum || (integer && value.fract() != 0.0) {
        return Err(format!(
            "{} must be {} between 0 and {maximum}",
            names[0],
            if integer {
                "an integer"
            } else {
                "a finite number"
            }
        ));
    }
    Ok(value)
}

fn positional(args: &[String]) -> Option<String> {
    const VALUE_OPTIONS: &[&str] = &[
        "--mode",
        "--modo",
        "--turn-id",
        "--turn",
        "--turno",
        "--dir",
        "--event",
        "--evento",
        "--skill",
        "--actor",
        "--by",
        "--por",
        "--date",
        "--day",
        "--dia",
        "--reprompt",
        "--errors",
        "--erros",
        "--retries",
        "--turns",
        "--turnos",
        "--tokens-in",
        "--tokens-out",
        "--cost",
        "--custo",
        "--version",
        "--versao",
        "--source",
        "--fonte",
    ];
    let mut index = 0;
    while index < args.len() {
        let argument = &args[index];
        if argument.starts_with("--") {
            index += if !argument.contains('=') && VALUE_OPTIONS.contains(&argument.as_str()) {
                2
            } else {
                1
            };
        } else {
            return Some(argument.clone());
        }
    }
    None
}

fn read_stdin() -> String {
    let mut input = String::new();
    let _ = std::io::stdin()
        .take(MAX_STDIN_BYTES + 1)
        .read_to_string(&mut input);
    if input.len() as u64 > MAX_STDIN_BYTES {
        String::new()
    } else {
        input
    }
}

fn remaining(deadline: std::time::Instant) -> Option<Duration> {
    deadline.checked_duration_since(std::time::Instant::now())
}

fn read_stdin_before(deadline: std::time::Instant) -> Result<String, route::Timeout> {
    let timeout = remaining(deadline).ok_or(route::Timeout)?;
    route::run_with_timeout(timeout, read_stdin)
}

fn cmd_index(args: &[String]) -> i32 {
    let mut folders = Vec::new();
    let mut position = 0;
    while position < args.len() {
        if args[position] == "--dir" {
            if let Some(value) = args.get(position + 1) {
                folders.push(std::path::PathBuf::from(value));
            }
            position += 2;
        } else {
            position += 1;
        }
    }
    if folders.is_empty() {
        let current = std::env::current_dir().unwrap_or_else(|_| ".".into());
        folders = index::default_folders(&home::user_home(), &current);
    }
    if folders.is_empty() {
        eprintln!("batuta: no skill directory found; use --dir PATH");
        return 1;
    }
    let started = std::time::Instant::now();
    let built = index::build(&folders);
    let destination = home::app_dir().join("index.txt");
    if let Err(error) = home::atomic_write(&destination, index::write(&built).as_bytes(), 0o600) {
        eprintln!("batuta: could not write {}: {error}", destination.display());
        return 1;
    }
    println!(
        "batuta: indexed {} skills in {:.0}ms ({} distinct terms)",
        built.skills.len(),
        started.elapsed().as_secs_f64() * 1000.0,
        built.postings.len()
    );
    for folder in folders {
        println!("  source: {}", folder.display());
    }
    println!("  index: {}", destination.display());
    0
}

fn cmd_route(args: &[String]) -> i32 {
    // The 300 ms budget begins before stdin and JSON parsing. This makes the
    // binary itself enforce the deadline even on hosts without GNU `timeout`.
    let deadline = std::time::Instant::now() + ROUTE_TIMEOUT;
    let (prompt, hook_payload) = if has(args, "--stdin-json") {
        let Ok(input) = read_stdin_before(deadline) else {
            return 124;
        };
        match json::read(&input) {
            Ok(payload) => {
                let canonical = payload.field("prompt").text();
                let prompt = if canonical.is_empty() {
                    payload.field("user_prompt").text().to_string()
                } else {
                    canonical.to_string()
                };
                (prompt, Some(payload))
            }
            Err(_) => (String::new(), None),
        }
    } else if has(args, "--stdin") {
        let Ok(input) = read_stdin_before(deadline) else {
            return 124;
        };
        (input, None)
    } else {
        (positional(args).unwrap_or_default(), None)
    };
    if prompt.trim().is_empty() {
        return 0;
    }
    let mode = option(args, "--mode")
        .or_else(|| option(args, "--modo"))
        .filter(|value| matches!(value.as_str(), "hook" | "mcp" | "skill" | "lab"))
        .unwrap_or_else(|| "hook".to_string());
    let turn_id = option(args, "--turn-id")
        .or_else(|| option(args, "--turn"))
        .or_else(|| option(args, "--turno"))
        .filter(|value| text::is_safe_correlation_id(value));
    let version = VERSION.to_string();
    let Some(timeout) = remaining(deadline) else {
        return 124;
    };
    let result = route::run_with_timeout(timeout, move || {
        let output = route::route(&prompt, &mode, turn_id, &version);
        if let Some(payload) = hook_payload {
            if lifecycle::begin_turn(&payload, &output).is_err() {
                return None;
            }
        }
        if route::log_event(&output).is_err() {
            return None;
        }
        Some(output)
    });
    let Ok(Some(output)) = result else {
        return 124;
    };
    let disclosure_pending = output.disclosure_pending;
    let mut stdout = std::io::stdout().lock();
    let delivered = if has(args, "--json") {
        writeln!(stdout, "{}", json::write(&output.event))
    } else if let Some(message) = output.text {
        writeln!(stdout, "{message}")
    } else {
        Ok(())
    };
    if delivered.and_then(|()| stdout.flush()).is_err() {
        return 1;
    }
    drop(stdout);
    if disclosure_pending {
        // A failed or timed-out route must never suppress the only disclosure.
        // If this bounded acknowledgement fails, the next route repeats it.
        if let Some(timeout) = remaining(deadline) {
            let _ = home::update_config_with_timeout(timeout, |config| config.informed = true);
        }
    }
    0
}

fn cmd_hook(args: &[String]) -> i32 {
    if !has(args, "--stdin-json") {
        return 2;
    }
    let deadline = std::time::Instant::now() + ROUTE_TIMEOUT;
    let Ok(input) = read_stdin_before(deadline) else {
        return 124;
    };
    let payload = match json::read(&input) {
        Ok(value) => value,
        Err(_) => return 0,
    };
    let action = args.first().cloned();
    let Some(timeout) = remaining(deadline) else {
        return 124;
    };
    match route::run_with_timeout(timeout, move || match action.as_deref() {
        Some("activation" | "activate" | "ativacao") => lifecycle::record_activation(&payload),
        Some("outcome" | "desfecho") => lifecycle::record_outcome(&payload),
        _ => Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "unknown hook action",
        )),
    }) {
        Ok(Ok(_)) => 0,
        Ok(Err(error)) if error.kind() == std::io::ErrorKind::InvalidInput => 2,
        Ok(Err(_)) => 1,
        Err(_) => 124,
    }
}

fn cmd_log(args: &[String]) -> i32 {
    let event_type = option(args, "--event")
        .or_else(|| option(args, "--evento"))
        .unwrap_or_default();
    let turn_id = option(args, "--turn-id")
        .or_else(|| option(args, "--turn"))
        .or_else(|| option(args, "--turno"))
        .filter(|value| text::is_safe_correlation_id(value))
        .or_else(route::fresh_turn_id);
    let Some(turn_id) = turn_id else {
        eprintln!("batuta log: could not create a collision-safe turn ID");
        return 1;
    };
    let timestamp = index::now() as f64;
    let event = match event_type.as_str() {
        "activation" | "activate" | "ativacao" => {
            let skill = option(args, "--skill").unwrap_or_default();
            if !text::is_safe_skill_id(&skill) {
                eprintln!("batuta log: activation requires a safe --skill NAME");
                return 2;
            }
            let version = option(args, "--version")
                .or_else(|| option(args, "--versao"))
                .unwrap_or_default();
            let actor = option(args, "--actor")
                .or_else(|| option(args, "--by"))
                .or_else(|| option(args, "--por"))
                .unwrap_or_else(|| "model".to_string());
            let actor = match actor.as_str() {
                "model" | "modelo" => "model",
                "user" | "usuario" => "user",
                _ => {
                    eprintln!("batuta log: --actor must be 'model' or 'user'");
                    return 2;
                }
            };
            object(vec![
                ("schema", json_text("batuta.event.v2")),
                ("v", number(2)),
                ("t", number(timestamp)),
                ("type", json_text("activation")),
                ("turn_id", json_text(turn_id)),
                ("skill", json_text(skill)),
                ("version", json_text(version)),
                ("actor", json_text(actor)),
                ("authority", json_text("manual_observation")),
                ("trusted", Value::Bool(false)),
                ("receipt_verified", Value::Bool(false)),
            ])
        }
        "outcome" | "desfecho" => {
            let reported = if has(args, "--failed") || has(args, "--falhou") {
                "failed"
            } else if has(args, "--passed") || has(args, "--ok") {
                "passed"
            } else {
                "unknown"
            };
            let parsed = (
                numeric_option(args, &["--reprompt"], 1_000_000_000.0, true),
                numeric_option(args, &["--errors", "--erros"], 1_000_000_000.0, true),
                numeric_option(args, &["--retries"], 1_000_000_000.0, true),
                numeric_option(args, &["--turns", "--turnos"], 1_000_000.0, true),
                numeric_option(args, &["--tokens-in"], 1_000_000_000_000.0, false),
                numeric_option(args, &["--tokens-out"], 1_000_000_000_000.0, false),
                numeric_option(args, &["--cost", "--custo"], 1_000_000.0, false),
            );
            let (reprompt, errors, retries, turns, tokens_in, tokens_out, cost_usd) = match parsed {
                (Ok(a), Ok(b), Ok(c), Ok(d), Ok(e), Ok(f), Ok(g)) => (a, b, c, d, e, f, g),
                values => {
                    let message = [
                        values.0, values.1, values.2, values.3, values.4, values.5, values.6,
                    ]
                    .into_iter()
                    .find_map(Result::err)
                    .unwrap_or_else(|| "invalid numeric observation".to_string());
                    eprintln!("batuta log: {message}");
                    return 2;
                }
            };
            object(vec![
                ("schema", json_text("batuta.event.v2")),
                ("v", number(2)),
                ("t", number(timestamp)),
                ("type", json_text("outcome")),
                ("turn_id", json_text(turn_id)),
                ("status", json_text("unknown")),
                ("reported_status", json_text(reported)),
                ("ok", Value::Bool(false)),
                ("reprompt", number(reprompt)),
                ("errors", number(errors)),
                ("retries", number(retries)),
                ("turns", number(turns)),
                ("tokens_in", number(tokens_in)),
                ("tokens_out", number(tokens_out)),
                ("cost_usd", number(cost_usd)),
                ("authority", json_text("manual_observation")),
                ("trusted", Value::Bool(false)),
                ("receipt_verified", Value::Bool(false)),
            ])
        }
        _ => {
            eprintln!("batuta log: --event must be 'activation' or 'outcome'");
            return 2;
        }
    };
    match record::append(&event) {
        Ok(()) => 0,
        Err(error) => {
            eprintln!("batuta log: could not append event: {error}");
            1
        }
    }
}

fn requested_date(args: &[String]) -> Option<String> {
    option(args, "--date")
        .or_else(|| option(args, "--day"))
        .or_else(|| option(args, "--dia"))
}

fn cmd_report(args: &[String]) -> i32 {
    let date = requested_date(args);
    let aggregate = record::aggregate(&record::load(), date.as_deref());
    if has(args, "--json") {
        let date = date.unwrap_or_else(|| data::day_utc(index::now()));
        println!(
            "{}",
            json::write(&record::daily_summary(&aggregate, &date, VERSION, "local"))
        );
    } else {
        print!("{}", record::text_report(&aggregate));
    }
    0
}

fn cmd_summary(args: &[String]) -> i32 {
    let date = requested_date(args).unwrap_or_else(|| data::day_utc(index::now()));
    let aggregate = record::aggregate(&record::load(), Some(&date));
    println!(
        "{}",
        json::write(&record::daily_summary(&aggregate, &date, VERSION, "local"))
    );
    eprintln!("\n(local preview only: this release has no public uploader or signer enrollment. The summary contains no prompt, prompt hash, path, session ID, or turn ID.)");
    0
}

fn cmd_find(args: &[String]) -> i32 {
    print!("{}", find::find(&positional(args).unwrap_or_default()));
    0
}

fn cmd_conflicts() -> i32 {
    let current = std::env::current_dir().unwrap_or_else(|_| ".".into());
    let folders = index::default_folders(&home::user_home(), &current);
    print!("{}", conflicts::report(&index::build(&folders)));
    0
}

fn cmd_config(args: &[String]) -> i32 {
    enum Update {
        DisableUpload,
        Holdout(u32),
        Portal(String),
    }

    if args.first().is_some_and(|key| key == "envio") {
        eprintln!("batuta: warning: config key 'envio' is deprecated; use 'upload'");
    }
    let update = match (
        args.first().map(String::as_str),
        args.get(1).map(String::as_str),
    ) {
        (Some("upload" | "envio"), Some(value)) => {
            let enabled = matches!(value, "yes" | "sim" | "true" | "1");
            if enabled {
                eprintln!("batuta config: public daily upload is unavailable; `batuta summary` remains a local preview");
                return 2;
            }
            Update::DisableUpload
        }
        (Some("holdout" | "holdout_pct"), Some(value)) => {
            let Ok(holdout) = value.parse::<u32>() else {
                eprintln!("batuta config: holdout_pct must be an integer from 0 to 50");
                return 2;
            };
            Update::Holdout(holdout.min(50))
        }
        (Some("portal"), Some(value)) => Update::Portal(value.to_string()),
        _ => {
            let config = home::read_config();
            println!("upload       = unavailable (local preview only)");
            println!("holdout_pct  = {}%", config.holdout_pct);
            println!("portal       = {}", config.portal);
            println!("installation = {}", home::installation_id());
            return 0;
        }
    };
    if let Err(error) = home::update_config(|config| match update {
        Update::DisableUpload => config.upload = false,
        Update::Holdout(holdout) => config.holdout_pct = holdout,
        Update::Portal(portal) => config.portal = portal,
    }) {
        eprintln!("batuta config: {error}");
        return 1;
    }
    println!("configuration updated");
    0
}

fn cmd_privacy() -> i32 {
    let directory = home::app_dir();
    println!(
        "Batuta stores owner-only local state under {}:\n\n  salt          secure local salt, never uploaded\n  index.txt     skill names, descriptions, terms, and relative local locators\n  events.jsonl  route/activation/unknown-outcome transitions\n  config.txt    preferences\n\nBatuta never persists prompt text, responses, absolute project paths, session IDs,\ncredentials, or secrets. Local index and event records are never uploaded. This release\nonly previews daily summaries locally; the remote endpoint is pre-provisioned and has\nno public uploader. LAB uses a separate signed, allowlisted event contract. Batuta\nmeasures behavior; it never proves delivery alone.\n\nDelete local state (irreversible): rm -rf {}",
        directory.display(), shell_quote(&directory.to_string_lossy())
    );
    0
}

fn cmd_hooks(args: &[String]) -> i32 {
    let executable = match std::env::current_exe().and_then(|path| path.canonicalize()) {
        Ok(path) => path,
        Err(error) => {
            eprintln!("batuta: cannot resolve the audited executable path: {error}");
            return 1;
        }
    };
    let shell_executable = shell_quote(&executable.to_string_lossy());
    let hooks = [
        (
            "user-prompt-submit.sh",
            include_str!("../../../hooks/user-prompt-submit.sh"),
        ),
        (
            "post-tool-use.sh",
            include_str!("../../../hooks/post-tool-use.sh"),
        ),
        ("stop.sh", include_str!("../../../hooks/stop.sh")),
    ];
    for (name, contents) in hooks {
        let path = home::app_dir().join(name);
        let pinned = contents.replace("__BATUTA_EXECUTABLE__", &shell_executable);
        if let Err(error) = home::atomic_write(&path, pinned.as_bytes(), 0o700) {
            eprintln!("batuta: could not write {}: {error}", path.display());
            return 1;
        }
    }
    let directory = home::app_dir();
    let hook_command = |name: &str| {
        let path = directory.join(name);
        json::write(&json_text(shell_quote(&path.to_string_lossy())))
    };
    let snippet = format!(
        r#"{{
  "hooks": {{
    "UserPromptSubmit": [{{ "hooks": [{{ "type": "command", "command": {}, "timeout": 1 }}] }}],
    "PostToolUse": [{{ "matcher": "Skill", "hooks": [{{ "type": "command", "command": {}, "timeout": 1 }}] }}],
    "Stop": [{{ "hooks": [{{ "type": "command", "command": {}, "timeout": 1 }}] }}]
  }}
}}"#,
        hook_command("user-prompt-submit.sh"),
        hook_command("post-tool-use.sh"),
        hook_command("stop.sh"),
    );
    println!("Hooks written under {}\n", directory.display());
    if has(args, "--apply") || has(args, "--aplicar") {
        println!(
            "Batuta does not modify settings.json without review. Merge this block yourself:\n"
        );
    } else {
        println!("Merge this into ~/.claude/settings.json:\n");
    }
    println!("{snippet}\n");
    0
}

fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\"'\"'"))
}
