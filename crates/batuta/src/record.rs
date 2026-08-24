//! Events and report.
//!
//! GOLDEN RULE, and it matters more than any feature: the prompt text never
//! enters this file. What enters is the hash with a local salt, the length, and
//! the term count. Whoever steals events.jsonl reads nothing about anyone.
//!
//! What goes up to the portal, and only with opt-in, is the DAILY SUMMARY AGGREGATED
//! BY SKILL — never the raw event. 200 turns a day become ~20 lines.

use crate::data;
use crate::home;
use crate::json::{self, number, object, text, Value};
use std::collections::BTreeMap;
use std::fs::OpenOptions;
use std::io::Write;

pub fn events_file() -> std::path::PathBuf {
    home::ensure_dir().join("events.jsonl")
}

pub fn append(v: &Value) {
    let line = json::write(v);
    if let Ok(mut f) = OpenOptions::new()
        .create(true)
        .append(true)
        .open(events_file())
    {
        let _ = writeln!(f, "{}", line);
    }
}

pub fn load() -> Vec<Value> {
    let Ok(s) = std::fs::read_to_string(events_file()) else {
        return Vec::new();
    };
    s.lines()
        .filter(|l| !l.trim().is_empty())
        .filter_map(|l| json::read(l).ok())
        .collect()
}

// ------------------------------------------------------------------- aggregation

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
    /// outcome of the turns in which the router SPOKE
    pub suggested_arm: (u64, u64),
    /// outcome of the holdout turns — the router deliberately stayed silent
    pub holdout_arm: (u64, u64),
    pub ms_total: f64,
    pub ms_samples: u64,
    pub first: u64,
    pub last: u64,
}

pub fn aggregate(events: &[Value], day: Option<&str>) -> Aggregate {
    let mut ag = Aggregate::default();
    // turn -> (holdout, spoke, suggested skills)
    let mut turns: BTreeMap<String, (bool, bool, Vec<String>)> = BTreeMap::new();

    for e in events {
        let t = e.field("t").number() as u64;
        if let Some(d) = day {
            if data::day_utc(t) != d {
                continue;
            }
        }
        if ag.first == 0 || t < ag.first {
            ag.first = t;
        }
        if t > ag.last {
            ag.last = t;
        }
        let turn = e.field("turn").text().to_string();

        match e.field("type").text() {
            "route" => {
                ag.routes += 1;
                let holdout = matches!(e.field("holdout"), Value::Bool(true));
                if holdout {
                    ag.routes_holdout += 1;
                }
                let suggested: Vec<String> = e
                    .field("suggestions")
                    .items()
                    .iter()
                    .map(|s| s.field("skill").text().to_string())
                    .collect();
                let spoke = !suggested.is_empty();
                if spoke {
                    ag.routes_suggested += 1;
                }
                for s in &suggested {
                    let target = ag.skills.entry(s.clone()).or_default();
                    target.routes += 1;
                }
                for s in e.field("suggestions").items() {
                    let name = s.field("skill").text().to_string();
                    let v = s.field("version").text().to_string();
                    if !v.is_empty() {
                        ag.skills.entry(name).or_default().version = v;
                    }
                }
                let ms = e.field("ms").number();
                if ms > 0.0 {
                    ag.ms_total += ms;
                    ag.ms_samples += 1;
                }
                turns.insert(turn, (holdout, spoke, suggested));
            }
            "activation" => {
                let name = e.field("skill").text().to_string();
                if name.is_empty() {
                    continue;
                }
                let target = ag.skills.entry(name).or_default();
                target.activations += 1;
                if e.field("by").text() == "user" {
                    target.user_activations += 1;
                }
            }
            "outcome" => {
                let ok = matches!(e.field("ok"), Value::Bool(true));
                let (holdout, spoke, suggested) =
                    turns
                        .get(&turn)
                        .cloned()
                        .unwrap_or((false, false, Vec::new()));
                if holdout {
                    ag.holdout_arm.1 += 1;
                    if ok {
                        ag.holdout_arm.0 += 1;
                    }
                } else if spoke {
                    ag.suggested_arm.1 += 1;
                    if ok {
                        ag.suggested_arm.0 += 1;
                    }
                }
                for s in suggested {
                    let target = ag.skills.entry(s).or_default();
                    target.turns_judged += 1;
                    if ok {
                        target.turns_ok += 1;
                    }
                    target.reprompts += e.field("reprompt").number() as u64;
                    target.errors += e.field("errors").number() as u64;
                    target.retries += e.field("retries").number() as u64;
                    target.tokens_in += e.field("tokens_in").number();
                    target.tokens_out += e.field("tokens_out").number();
                    target.cost_usd += e.field("cost_usd").number();
                    let turns_to = e.field("turns").number();
                    if turns_to > 0.0 {
                        target.turns_to_completion.push(turns_to);
                    }
                }
            }
            _ => {}
        }
    }
    ag
}

pub fn median(v: &mut [f64]) -> f64 {
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

// ------------------------------------------------------------------- report

pub fn text_report(ag: &Aggregate) -> String {
    let mut s = String::new();
    if ag.routes == 0 {
        return "Batuta: no turn recorded yet.\n\
                Install the hook with `batuta install-hooks` and come back after a few turns.\n"
            .to_string();
    }

    s.push_str("BATUTA — local report\n");
    s.push_str(&format!(
        "period: {} to {}\n",
        data::instant_utc(ag.first),
        data::instant_utc(ag.last)
    ));
    s.push('\n');

    let silence = ag.routes - ag.routes_suggested;
    s.push_str("FUNNEL\n");
    s.push_str(&format!("  turns seen ................ {}\n", ag.routes));
    s.push_str(&format!(
        "  router spoke ............... {} ({:.1}%)\n",
        ag.routes_suggested,
        pct(ag.routes_suggested, ag.routes)
    ));
    s.push_str(&format!(
        "  router silent ............... {} ({:.1}%)\n",
        silence,
        pct(silence, ag.routes)
    ));
    s.push_str(&format!(
        "  holdout (silent on purpose) {}\n",
        ag.routes_holdout
    ));
    if ag.ms_samples > 0 {
        s.push_str(&format!(
            "  average route time ....... {:.1}ms\n",
            ag.ms_total / ag.ms_samples as f64
        ));
    }
    s.push('\n');

    s.push_str("BY SKILL\n");
    s.push_str("  skill                          routes  fired   trigger   cost/task\n");
    let mut rows: Vec<(&String, &BySkill)> = ag.skills.iter().collect();
    rows.sort_by_key(|l| std::cmp::Reverse(l.1.routes));
    for (name, p) in &rows {
        let trigger = pct(p.activations, p.routes);
        let cost = if p.turns_ok > 0 {
            format!("US$ {:.4}", p.cost_usd / p.turns_ok as f64)
        } else {
            "—".to_string()
        };
        s.push_str(&format!(
            "  {:<28} {:>6} {:>7} {:>7.1}%   {}\n",
            truncate_str(name, 28),
            p.routes,
            p.activations,
            trigger,
            cost
        ));
    }
    s.push('\n');

    let ghosts: Vec<&String> = rows
        .iter()
        .filter(|(_, p)| p.routes >= 5 && p.activations == 0)
        .map(|(n, _)| *n)
        .collect();
    if ghosts.is_empty() {
        s.push_str("GHOST SKILLS\n  none (skill suggested 5+ times and never used)\n\n");
    } else {
        s.push_str("GHOST SKILLS — suggested 5+ times, never used\n");
        for f in ghosts {
            s.push_str(&format!("  {}\n", f));
        }
        s.push('\n');
    }

    s.push_str("LIFT (causal holdout)\n");
    if ag.holdout_arm.1 == 0 {
        s.push_str(
            "  no control sample yet. Holdout silences the router in 5% of turns\n\
             \x20 on purpose; without it the number measures correlation, not cause.\n",
        );
    } else {
        let with = pct(ag.suggested_arm.0, ag.suggested_arm.1);
        let without = pct(ag.holdout_arm.0, ag.holdout_arm.1);
        s.push_str(&format!(
            "  with router ..... {:.1}% of {} turns\n  without router .. {:.1}% of {} turns\n  lift ............ {:+.1} points\n",
            with, ag.suggested_arm.1, without, ag.holdout_arm.1, with - without
        ));
        if ag.holdout_arm.1 < 30 {
            s.push_str(&format!(
                "  WARNING: n={} in the control group. Weak number. Don't publish as a conclusion.\n",
                ag.holdout_arm.1
            ));
        }
    }
    s.push('\n');
    s.push_str("All of this is local. Nothing left this machine.\n");
    s
}

fn truncate_str(s: &str, n: usize) -> String {
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

// --------------------------------------------------------------- daily summary

/// The only format that gets uploaded. No prompt, no prompt hash, no file path,
/// no username. One line per skill per day.
pub fn daily_summary(ag: &Aggregate, day: &str, batuta_version: &str, mode: &str) -> Value {
    let mut skills = Vec::new();
    for (name, p) in &ag.skills {
        let mut tc = p.turns_to_completion.clone();
        skills.push(object(vec![
            ("skill", text(name.clone())),
            ("version", text(p.version.clone())),
            ("routes", number(p.routes as f64)),
            ("activations", number(p.activations as f64)),
            ("user_activations", number(p.user_activations as f64)),
            ("turns_judged", number(p.turns_judged as f64)),
            ("turns_ok", number(p.turns_ok as f64)),
            ("reprompts", number(p.reprompts as f64)),
            ("errors", number(p.errors as f64)),
            ("retries", number(p.retries as f64)),
            ("tokens_in", number(p.tokens_in)),
            ("tokens_out", number(p.tokens_out)),
            ("cost_usd", number(p.cost_usd)),
            ("median_turns_to_completion", number(median(&mut tc))),
            ("ghost", Value::Bool(p.routes >= 5 && p.activations == 0)),
        ]));
    }

    object(vec![
        ("schema", text("batuta.daily_summary.v1")),
        ("day", text(day)),
        ("installation", text(home::installation_id())),
        ("batuta_version", text(batuta_version)),
        ("mode", text(mode)),
        ("routes", number(ag.routes as f64)),
        ("routes_suggested", number(ag.routes_suggested as f64)),
        ("routes_holdout", number(ag.routes_holdout as f64)),
        (
            "suggested_arm",
            object(vec![
                ("ok", number(ag.suggested_arm.0 as f64)),
                ("n", number(ag.suggested_arm.1 as f64)),
            ]),
        ),
        (
            "holdout_arm",
            object(vec![
                ("ok", number(ag.holdout_arm.0 as f64)),
                ("n", number(ag.holdout_arm.1 as f64)),
            ]),
        ),
        (
            "declared_bias",
            text("whoever installs Batuta already cares about skills; the sample is voluntary and not representative"),
        ),
        ("skills", Value::List(skills)),
    ])
}
