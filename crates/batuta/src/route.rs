//! Hot path. Budget: 100ms, hard ceiling of 300ms. Zero network, zero LLM,
//! zero waiting. If something here can fail, it fails silently and returns 0 — a hook
//! that blows the time budget has its whole output discarded, and a router that stalls
//! the user's turn is worse than a router that doesn't exist.

use crate::bm25;
use crate::home;
use crate::index;
use crate::json::{number, object, text, Value};
use crate::record;
use crate::sha256;
use crate::text;
use std::time::Instant;

pub struct Output {
    pub text: Option<String>,
    pub event: Value,
}

/// Holdout draw: deterministic from the local salt and the prompt itself.
/// Deliberately deterministic — the same question always lands in the same arm, so
/// there's no way to "try again until the router speaks".
fn is_holdout(salt: &str, prompt: &str, pct: u32) -> bool {
    if pct == 0 {
        return false;
    }
    let h = sha256::hash_with_salt(salt, &format!("holdout|{}", prompt));
    let n = u32::from_str_radix(&h[..4], 16).unwrap_or(0);
    n % 100 < pct
}

pub fn route(prompt: &str, mode: &str, turn_given: Option<String>, version: &str) -> Output {
    let t0 = Instant::now();
    let cfg = home::read_config();
    let salt = home::salt();
    let terms = text::terms(prompt);

    let hash = sha256::hash_with_salt(&salt, prompt);
    let turn = turn_given.unwrap_or_else(|| hash[..12].to_string());
    let holdout = is_holdout(&salt, prompt, cfg.holdout_pct);

    let mut suggestions: Vec<Value> = Vec::new();
    let mut lines: Vec<String> = Vec::new();

    if !holdout && !terms.is_empty() {
        let file = home::app_dir().join("index.txt");
        if let Ok(raw) = std::fs::read_to_string(&file) {
            let idx = index::read_partial(&raw, &terms);
            for a in bm25::score(&idx, &terms) {
                let Some(sk) = idx.skills.get(a.skill as usize) else {
                    continue;
                };
                suggestions.push(object(vec![
                    ("skill", text(sk.name.clone())),
                    ("version", text(sk.version.clone())),
                    ("score", number((a.score * 100.0).round() / 100.0)),
                ]));
                lines.push(format!(
                    "· {} — {}\n  {}",
                    sk.name,
                    truncate_str(&sk.description, 160),
                    sk.path
                ));
            }
        }
    }

    let ms = t0.elapsed().as_micros() as f64 / 1000.0;

    let event = object(vec![
        ("v", number(1)),
        ("t", number(index::now() as f64)),
        ("type", text("route")),
        ("turn", text(turn)),
        ("prompt_hash", text(&hash[..32])),
        ("prompt_len", number(prompt.chars().count() as f64)),
        ("terms", number(terms.len() as f64)),
        ("holdout", Value::Bool(holdout)),
        ("mode", text(mode)),
        ("batuta_version", text(version)),
        ("ms", number((ms * 100.0).round() / 100.0)),
        ("suggestions", Value::List(suggestions.clone())),
    ]);

    // The injected block costs tokens on EVERY turn. So it's deliberately short, and
    // the full statement (privacy, opt-in, holdout) appears ONCE, on the first
    // run, inside the context — where the user sees it — and afterward lives in
    // `batuta privacy` and `batuta report`.
    let output_text = if lines.is_empty() {
        None
    } else {
        let intro = if !cfg.informed {
            let mut c2 = cfg.clone();
            c2.informed = true;
            home::write_config(&c2);
            format!(
                "\n\n— Batuta, first time here: I route 100% locally, no network and no LLM. \
                 Your prompt text never leaves this machine (I keep a hash with a local salt, \
                 not the text). Sending aggregate data to the portal is opt-in: it's OFF \
                 until you run `batuta config upload yes`. On {}% of turns I stay silent on \
                 purpose, so there's a control group and the number measures cause, not \
                 correlation — `batuta config holdout 0` turns it off. Details: `batuta privacy`.",
                cfg.holdout_pct
            )
        } else {
            String::new()
        };
        Some(format!(
            "<batuta>\nInstalled skills that match this turn:\n{}\n\nUse if it fits. Ignore if it doesn't — the router suggested it, not the user.{}\n</batuta>",
            lines.join("\n"),
            intro
        ))
    };

    Output {
        text: output_text,
        event,
    }
}

pub fn log_event(s: &Output) {
    record::append(&s.event);
}

fn truncate_str(s: &str, n: usize) -> String {
    let c: Vec<char> = s.chars().collect();
    if c.len() <= n {
        return s.to_string();
    }
    let mut end = n;
    while end > 0 && c[end] != ' ' {
        end -= 1;
    }
    if end == 0 {
        end = n;
    }
    c[..end].iter().collect::<String>() + "…"
}
