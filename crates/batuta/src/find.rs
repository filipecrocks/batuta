//! `batuta find` — COLD path. Three layers, in this order:
//!   1. INSTALLED   — already on the machine, just use it
//!   2. AVAILABLE   — exists in the public registry, with the number Batuta measured
//!   3. GAP         — nobody has it; becomes a task suggestion for the arena
//!
//! Here ranking is by FULL TEXT, never by name+description. This isn't a
//! preference: the SkillRouter paper (arXiv 2603.22455) measured a drop of 31 to 44
//! accuracy points when the skill body is hidden and ranking relies only on
//! metadata, on a benchmark of ~80 thousand overlapping skills. On the hot path,
//! with 10 to 100 local skills, the difference probably disappears. Here, it doesn't.
//!
//! The binary still has no network access. Whoever downloads the registry is the
//! wrapper (`batuta registry update`); this command only reads the cached file.

use crate::bm25;
use crate::home;
use crate::index::{self, Index, Skill};
use crate::json;
use crate::text;
use std::collections::BTreeMap;

pub fn registry_path() -> std::path::PathBuf {
    home::app_dir().join("registry.json")
}

fn index_from_registry(v: &json::Value) -> (Index, Vec<json::Value>) {
    let mut idx = Index::default();
    let mut originals = Vec::new();
    for (i, s) in v.field("skills").items().iter().enumerate() {
        let name = s.field("name").text().to_string();
        let description = s.field("description").text().to_string();
        let body = s.field("body").text().to_string();
        let mut bag = Vec::new();
        for _ in 0..3 {
            bag.extend(text::terms(&name));
        }
        for _ in 0..2 {
            bag.extend(text::terms(&description));
        }
        bag.extend(text::take_first(text::terms(&body), index::BODY_TERMS));
        let mut tf: BTreeMap<String, u32> = BTreeMap::new();
        let size = bag.len();
        for t in bag {
            *tf.entry(t).or_insert(0) += 1;
        }
        for (t, c) in tf {
            idx.postings.entry(t).or_default().push((i as u32, c));
        }
        idx.skills.push(Skill {
            name,
            version: s.field("version").text().to_string(),
            description,
            path: s.field("source").text().to_string(),
            source: "registry".to_string(),
            size,
        });
        originals.push(s.clone());
    }
    let total: usize = idx.skills.iter().map(|s| s.size).sum();
    idx.avg_size = if idx.skills.is_empty() {
        1.0
    } else {
        (total as f64 / idx.skills.len() as f64).max(1.0)
    };
    (idx, originals)
}

pub fn find(query: &str) -> String {
    let terms = text::terms(query);
    let mut s = String::new();

    if terms.is_empty() {
        return "Batuta: write what you want to do, not the keyword.\n  \
                example: batuta find \"turn a messy spreadsheet into a report\"\n"
            .to_string();
    }

    // ---- 1. installed
    s.push_str("INSTALLED — already on your machine\n");
    let mut found_local = false;
    if let Ok(raw) = std::fs::read_to_string(home::app_dir().join("index.txt")) {
        let idx = index::read_partial(&raw, &terms);
        let matches = bm25::score(&idx, &terms);
        for a in &matches {
            if let Some(sk) = idx.skills.get(a.skill as usize) {
                found_local = true;
                s.push_str(&format!(
                    "  {}  (score {:.1})\n    {}\n    {}\n",
                    sk.name,
                    a.score,
                    shorten(&sk.description, 120),
                    sk.path
                ));
            }
        }
    }
    if !found_local {
        s.push_str(
            "  nothing matched. (`batuta index` rebuilds the index if you just installed a skill)\n",
        );
    }

    // ---- 2. available
    s.push_str("\nAVAILABLE — exists in the public registry\n");
    let mut found_registry = false;
    match std::fs::read_to_string(registry_path()) {
        Ok(raw) => match json::read(&raw) {
            Ok(v) => {
                let (idx, originals) = index_from_registry(&v);
                for a in bm25::score(&idx, &terms) {
                    let Some(sk) = idx.skills.get(a.skill as usize) else {
                        continue;
                    };
                    found_registry = true;
                    let original = &originals[a.skill as usize];
                    let measured = original.field("measured");
                    let summary = if measured.is_null() {
                        "not yet measured by Batuta".to_string()
                    } else {
                        format!(
                            "trigger {:.0}% · lift {:+.1}pp · n={}",
                            measured.field("trigger_rate").number() * 100.0,
                            measured.field("lift_pp").number(),
                            measured.field("n").number() as u64
                        )
                    };
                    s.push_str(&format!(
                        "  {}  (score {:.1})\n    {}\n    {}\n    {}\n",
                        sk.name,
                        a.score,
                        shorten(&sk.description, 120),
                        summary,
                        sk.path
                    ));
                }
                if !found_registry {
                    s.push_str("  nothing in the registry matched that.\n");
                }
            }
            Err(e) => s.push_str(&format!(
                "  local registry unreadable ({e}). Run `batuta registry update`.\n"
            )),
        },
        Err(_) => {
            s.push_str(
                "  no local copy of the registry. Run `batuta registry update`\n  \
                 (the binary doesn't access the network — the wrapper downloads it).\n",
            );
        }
    }

    // ---- 3. gap
    if !found_local && !found_registry {
        s.push_str("\nGAP — nobody has this yet\n");
        s.push_str(
            "  This is the interesting part. Send the task to the arena and it enters the\n  \
             test queue: https://batuta.space/arena\n",
        );
    }
    s
}

fn shorten(s: &str, n: usize) -> String {
    let c: Vec<char> = s.chars().collect();
    if c.len() <= n {
        s.to_string()
    } else {
        c[..n].iter().collect::<String>() + "…"
    }
}
