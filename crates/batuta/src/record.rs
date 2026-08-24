//! Private local events and privacy-preserving aggregate reports.
//!
//! Raw prompts, responses, paths, credentials, and session identifiers never enter
//! this module. Local events are observations on a user-controlled filesystem; they
//! are not trusted delivery receipts and therefore cannot attest successful outcomes.

use crate::data;
use crate::home;
use crate::json::{self, number, object, text, Value};
use crate::storage;
use std::collections::BTreeMap;
use std::collections::BTreeSet;
use std::io;
use std::path::PathBuf;

pub fn events_file() -> PathBuf {
    home::app_dir().join("events.jsonl")
}

pub fn append(value: &Value) -> io::Result<()> {
    let path = home::ensure()?.join("events.jsonl");
    storage::append_line(&path, json::write(value).as_bytes())
}

pub fn load() -> Vec<Value> {
    let mut events = Vec::new();
    // Preserve data written by v0 Portuguese builds during an in-place upgrade.
    for path in ["eventos.jsonl", "events.jsonl"] {
        let Ok(contents) = home::read_state_file(path) else {
            continue;
        };
        events.extend(
            contents
                .lines()
                .filter(|line| !line.trim().is_empty())
                .filter_map(|line| json::read(line).ok()),
        );
    }
    events
}

#[derive(Default, Debug, Clone)]
pub struct BySkill {
    pub version: String,
    pub routes: u64,
    pub activations: u64,
    pub user_activations: u64,
    pub turns_ok: u64,
    pub turns_judged: u64,
    pub reprompts: u64,
    pub errors: u64,
    pub retries: u64,
    pub tokens_in: f64,
    pub tokens_out: f64,
    pub cost_usd: f64,
    pub turns_to_completion: Vec<f64>,
}

#[derive(Default, Debug)]
pub struct Aggregate {
    pub routes: u64,
    pub routes_suggested: u64,
    pub routes_holdout: u64,
    pub skills: BTreeMap<String, BySkill>,
    pub suggested_arm: (u64, u64),
    pub holdout_arm: (u64, u64),
    pub ms_total: f64,
    pub ms_samples: u64,
    pub first: u64,
    pub last: u64,
}

fn field_text<'a>(event: &'a Value, canonical: &str, legacy: &str) -> &'a str {
    let value = event.field(canonical).text();
    if value.is_empty() {
        event.field(legacy).text()
    } else {
        value
    }
}

fn event_type(event: &Value) -> &str {
    field_text(event, "type", "tipo")
}

fn turn_id(event: &Value) -> &str {
    let canonical = event.field("turn_id").text();
    if !canonical.is_empty() {
        canonical
    } else {
        field_text(event, "turn", "turno")
    }
}

fn suggestions(event: &Value) -> &[Value] {
    let canonical = event.field("suggestions").items();
    if canonical.is_empty() {
        event.field("sugestoes").items()
    } else {
        canonical
    }
}

/// Local JSONL is editable by its owner and cannot independently establish a
/// successful outcome. Only the authenticated LAB ingest path verifies signed
/// receipts from a trusted runner and may include results in success metrics.
fn authoritative_outcome(_event: &Value) -> bool {
    false
}

pub fn aggregate(events: &[Value], day: Option<&str>) -> Aggregate {
    let mut aggregate = Aggregate::default();
    let mut turns: BTreeMap<String, (bool, bool, Vec<String>)> = BTreeMap::new();
    let mut seen_transitions: BTreeSet<(String, String, String)> = BTreeSet::new();
    for event in events {
        let timestamp = event.field("t").number() as u64;
        if day.is_some_and(|expected| data::day_utc(timestamp) != expected) {
            continue;
        }
        if aggregate.first == 0 || timestamp < aggregate.first {
            aggregate.first = timestamp;
        }
        aggregate.last = aggregate.last.max(timestamp);
        let kind = event_type(event);
        let correlation = turn_id(event);
        let transition_skill = field_text(event, "skill", "habilidade");
        if !correlation.is_empty()
            && matches!(
                kind,
                "route" | "rota" | "activation" | "ativacao" | "outcome" | "resultado"
            )
            && !seen_transitions.insert((
                kind.to_string(),
                correlation.to_string(),
                transition_skill.to_string(),
            ))
        {
            continue;
        }
        match kind {
            "route" | "rota" => {
                aggregate.routes += 1;
                let holdout = matches!(event.field("holdout"), Value::Bool(true));
                if holdout {
                    aggregate.routes_holdout += 1;
                }
                let suggested: Vec<String> = suggestions(event)
                    .iter()
                    .filter_map(|entry| {
                        let skill = field_text(entry, "skill", "habilidade");
                        (!skill.is_empty()).then(|| skill.to_string())
                    })
                    .collect();
                let spoke = !suggested.is_empty();
                if spoke {
                    aggregate.routes_suggested += 1;
                }
                for suggestion in suggestions(event) {
                    let skill = field_text(suggestion, "skill", "habilidade");
                    if skill.is_empty() {
                        continue;
                    }
                    let target = aggregate.skills.entry(skill.to_string()).or_default();
                    target.routes += 1;
                    let version = field_text(suggestion, "version", "versao");
                    if !version.is_empty() {
                        target.version = version.to_string();
                    }
                }
                let milliseconds = event.field("ms").number();
                if milliseconds > 0.0 {
                    aggregate.ms_total += milliseconds;
                    aggregate.ms_samples += 1;
                }
                let correlation = turn_id(event);
                if !correlation.is_empty() {
                    turns.insert(correlation.to_string(), (holdout, spoke, suggested));
                }
            }
            "activation" | "ativacao" => {
                let skill = field_text(event, "skill", "habilidade");
                let Some((_, _, suggested)) = turns.get(correlation) else {
                    continue;
                };
                if skill.is_empty() || !suggested.iter().any(|candidate| candidate == skill) {
                    continue;
                }
                let target = aggregate.skills.entry(skill.to_string()).or_default();
                target.activations += 1;
                if matches!(field_text(event, "actor", "por"), "user" | "usuario")
                    || event.field("by").text() == "user"
                {
                    target.user_activations += 1;
                }
            }
            "outcome" | "resultado" if authoritative_outcome(event) => {
                // Deliberately unreachable locally. The server aggregates verified receipts.
                let _ = turns.get(turn_id(event));
            }
            _ => {}
        }
    }
    aggregate
}

pub fn median(values: &mut [f64]) -> f64 {
    if values.is_empty() {
        return 0.0;
    }
    values.sort_by(|left, right| left.total_cmp(right));
    let length = values.len();
    if length % 2 == 1 {
        values[length / 2]
    } else {
        (values[length / 2 - 1] + values[length / 2]) / 2.0
    }
}

pub fn text_report(aggregate: &Aggregate) -> String {
    if aggregate.routes == 0 {
        return "Batuta: no turn recorded yet.\nInstall the hook with `batuta install-hooks` and return after a few turns.\n".to_string();
    }
    let mut report = format!(
        "BATUTA — local observational report\nperiod: {} to {}\n\nFUNNEL\n  turns seen ................. {}\n  router spoke ............... {} ({:.1}%)\n  router silent .............. {} ({:.1}%)\n  declared holdout ........... {}\n",
        data::instant_utc(aggregate.first), data::instant_utc(aggregate.last),
        aggregate.routes, aggregate.routes_suggested,
        pct(aggregate.routes_suggested, aggregate.routes),
        aggregate.routes - aggregate.routes_suggested,
        pct(aggregate.routes - aggregate.routes_suggested, aggregate.routes),
        aggregate.routes_holdout,
    );
    if aggregate.ms_samples > 0 {
        report.push_str(&format!(
            "  average route time ......... {:.1}ms\n",
            aggregate.ms_total / aggregate.ms_samples as f64
        ));
    }
    report.push_str("\nBY SKILL\n  skill                         routes  fired  trigger\n");
    let mut rows: Vec<_> = aggregate.skills.iter().collect();
    rows.sort_by_key(|(_, metrics)| std::cmp::Reverse(metrics.routes));
    for (skill, metrics) in rows {
        report.push_str(&format!(
            "  {:<28} {:>6} {:>6} {:>7.1}%\n",
            truncate(skill, 28),
            metrics.routes,
            metrics.activations,
            pct(metrics.activations, metrics.routes)
        ));
    }
    report.push_str(
        "\nOUTCOMES\n  Local events are observations, not proof of delivery. Success and causal lift\n  require an independently judged, signed receipt from a trusted runner.\n\nAll of this is local. Nothing left this machine.\n",
    );
    report
}

fn truncate(value: &str, length: usize) -> String {
    if value.chars().count() <= length {
        value.to_string()
    } else {
        value.chars().take(length - 1).collect::<String>() + "…"
    }
}

pub fn pct(numerator: u64, denominator: u64) -> f64 {
    if denominator == 0 {
        0.0
    } else {
        100.0 * numerator as f64 / denominator as f64
    }
}

/// Privacy-minimized local preview. This release has no public uploader.
pub fn daily_summary(aggregate: &Aggregate, date: &str, batuta_version: &str, mode: &str) -> Value {
    let skills = aggregate
        .skills
        .iter()
        .map(|(skill, metrics)| {
            let mut turns = metrics.turns_to_completion.clone();
            object(vec![
                ("skill", text(skill)),
                ("version", text(&metrics.version)),
                ("routes", number(metrics.routes as f64)),
                ("activations", number(metrics.activations as f64)),
                ("user_activations", number(metrics.user_activations as f64)),
                ("judged_turns", number(metrics.turns_judged as f64)),
                ("successful_turns", number(metrics.turns_ok as f64)),
                ("reprompts", number(metrics.reprompts as f64)),
                ("errors", number(metrics.errors as f64)),
                ("retries", number(metrics.retries as f64)),
                ("tokens_in", number(metrics.tokens_in)),
                ("tokens_out", number(metrics.tokens_out)),
                ("cost_usd", number(metrics.cost_usd)),
                ("median_turns_to_finish", number(median(&mut turns))),
                (
                    "ghost",
                    Value::Bool(metrics.routes >= 5 && metrics.activations == 0),
                ),
            ])
        })
        .collect();
    object(vec![
        ("schema", text("batuta.daily_summary.v2")), ("date", text(date)),
        ("installation_id", text(home::installation_id())),
        ("batuta_version", text(batuta_version)), ("mode", text(mode)),
        ("routes", number(aggregate.routes as f64)),
        ("routes_with_suggestions", number(aggregate.routes_suggested as f64)),
        ("holdout_routes", number(aggregate.routes_holdout as f64)),
        ("treatment_arm", object(vec![("passed", number(aggregate.suggested_arm.0 as f64)), ("total", number(aggregate.suggested_arm.1 as f64))])),
        ("holdout_arm", object(vec![("passed", number(aggregate.holdout_arm.0 as f64)), ("total", number(aggregate.holdout_arm.1 as f64))])),
        ("declared_bias", text("Batuta installations are a voluntary sample of users already interested in Agent Skills; results are not population-representative.")),
        ("measurement_disclaimer", text("Batuta is an observability and measurement layer, never sole proof of delivery. Successful outcomes require independently judged, signed receipts from a trusted runner.")),
        ("skills", Value::List(skills)),
    ])
}
