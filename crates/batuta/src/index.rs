//! Indexer: walks skill folders, reads the frontmatter and body of SKILL.md and
//! writes an inverted index to ~/.batuta/index.txt.
//!
//! Custom format, one line per record, instead of JSON. Reason is measured, not
//! taste: the hot path has a 100ms budget in total, and only the `P` lines for the
//! query terms need to be opened. JSON would force parsing the whole file.
//!
//! The body of SKILL.md goes into the index, not just name and description. This
//! comes from the SkillRouter paper (arXiv 2603.22455): ranking by name+description
//! alone drops accuracy by 31 to 44 points. It costs nothing here and avoids the
//! hole down the road.

use crate::text;
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

/// How many terms from the BODY get in. BM25's B=0.75 already penalizes long
/// documents; this cutoff is the second belt, so a giant SKILL.md doesn't flood
/// the index.
pub const BODY_TERMS: usize = 400;

const NAME_WEIGHT: usize = 3;
const DESC_WEIGHT: usize = 2;

#[derive(Debug, Clone)]
pub struct Skill {
    pub name: String,
    pub version: String,
    pub description: String,
    pub path: String,
    pub source: String,
    pub size: usize,
}

#[derive(Debug, Default)]
pub struct Index {
    pub generated_at: u64,
    pub skills: Vec<Skill>,
    pub postings: BTreeMap<String, Vec<(u32, u32)>>,
    pub avg_size: f64,
}

// ---------------------------------------------------------------- frontmatter

/// Reads the YAML frontmatter at the top of the file. It isn't a YAML parser and
/// doesn't want to be: it accepts `key: value`, quoted values, and an indented
/// continuation on the next line.
pub fn frontmatter(raw: &str) -> (BTreeMap<String, String>, usize) {
    let mut m = BTreeMap::new();
    let lines: Vec<&str> = raw.lines().collect();
    if lines.is_empty() || lines[0].trim() != "---" {
        return (m, 0);
    }
    let mut end = 0usize;
    let mut current_key = String::new();
    let mut bytes_read = lines[0].len() + 1;

    for (i, line) in lines.iter().enumerate().skip(1) {
        bytes_read += line.len() + 1;
        if line.trim() == "---" {
            end = bytes_read;
            break;
        }
        let starts_with_space = line.starts_with(' ') || line.starts_with('\t');
        if starts_with_space && !current_key.is_empty() {
            let ext = line.trim();
            if !ext.is_empty() && !ext.starts_with('-') {
                let e = m.entry(current_key.clone()).or_default();
                e.push(' ');
                e.push_str(ext);
            }
            continue;
        }
        if let Some(p) = line.find(':') {
            let k = line[..p].trim().to_ascii_lowercase();
            let v = line[p + 1..].trim();
            let v = v.trim_matches(|c| c == '"' || c == '\'');
            if !k.is_empty() {
                current_key = k.clone();
                m.insert(k, v.to_string());
            }
        }
        let _ = i;
    }
    (m, end)
}

// ------------------------------------------------------------------- traversal

fn find_skill_md(root: &Path, depth: usize, out: &mut Vec<PathBuf>) {
    if depth > 4 {
        return;
    }
    let Ok(it) = fs::read_dir(root) else { return };
    let mut dirs = Vec::new();
    for e in it.flatten() {
        let p = e.path();
        let name = e.file_name().to_string_lossy().to_string();
        if name.starts_with('.') && name != ".claude" {
            continue;
        }
        if name == "node_modules" || name == "target" {
            continue;
        }
        if p.is_file() && name.eq_ignore_ascii_case("SKILL.md") {
            out.push(p);
        } else if p.is_dir() {
            dirs.push(p);
        }
    }
    dirs.sort();
    for d in dirs {
        find_skill_md(&d, depth + 1, out);
    }
}

/// Folders where skills usually live. Doesn't invent anything: only what exists
/// on disk gets in.
pub fn default_folders(home: &Path, cwd: &Path) -> Vec<PathBuf> {
    let mut v = vec![
        home.join(".claude").join("skills"),
        home.join(".config").join("claude").join("skills"),
        home.join(".codex").join("skills"),
        cwd.join(".claude").join("skills"),
        cwd.join("skills"),
    ];
    v.retain(|p| p.is_dir());
    v.dedup();
    v
}

pub fn build(folders: &[PathBuf]) -> Index {
    let mut idx = Index {
        generated_at: now(),
        ..Default::default()
    };
    let mut seen: BTreeMap<String, ()> = BTreeMap::new();

    for (folder_index, folder) in folders.iter().enumerate() {
        let mut files = Vec::new();
        find_skill_md(folder, 0, &mut files);
        for file in files {
            let Ok(raw) = fs::read_to_string(&file) else {
                continue;
            };
            let (fm, end) = frontmatter(&raw);
            let dir_name = file
                .parent()
                .and_then(|p| p.file_name())
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or_default();
            let name = fm
                .get("name")
                .cloned()
                .filter(|s| !s.is_empty())
                .unwrap_or(dir_name.clone());
            let key = format!("{}|{}", name, file.display());
            if seen.contains_key(&key) {
                continue;
            }
            seen.insert(key, ());

            let description = fm.get("description").cloned().unwrap_or_default();
            let version = fm
                .get("version")
                .cloned()
                .unwrap_or_else(|| "unversioned".to_string());
            let body = if end < raw.len() { &raw[end..] } else { "" };

            let mut bag: Vec<String> = Vec::new();
            for _ in 0..NAME_WEIGHT {
                bag.extend(text::terms(&format!("{} {}", name, dir_name)));
            }
            for _ in 0..DESC_WEIGHT {
                bag.extend(text::terms(&description));
            }
            bag.extend(text::take_first(text::terms(body), BODY_TERMS));

            let i = idx.skills.len() as u32;
            let size = bag.len();
            let mut tf: BTreeMap<String, u32> = BTreeMap::new();
            for t in bag {
                *tf.entry(t).or_insert(0) += 1;
            }
            for (t, c) in tf {
                idx.postings.entry(t).or_default().push((i, c));
            }
            idx.skills.push(Skill {
                name,
                version,
                description: clean(&description),
                // The persisted index must not disclose a user/home/project prefix.
                // Routing only needs a human-readable locator, not an absolute path.
                path: file
                    .strip_prefix(folder)
                    .unwrap_or(&file)
                    .to_string_lossy()
                    .replace('\\', "/"),
                source: format!("local-{}", folder_index + 1),
                size,
            });
        }
    }

    let total: usize = idx.skills.iter().map(|s| s.size).sum();
    idx.avg_size = if idx.skills.is_empty() {
        1.0
    } else {
        (total as f64 / idx.skills.len() as f64).max(1.0)
    };
    idx
}

fn clean(s: &str) -> String {
    s.replace(['\t', '\n', '\r'], " ").trim().to_string()
}

// --------------------------------------------------------------- write / read

pub fn write(idx: &Index) -> String {
    let mut s = String::with_capacity(64 * 1024);
    s.push_str("BATUTA-INDEX 1\n");
    s.push_str(&format!("G {}\n", idx.generated_at));
    s.push_str(&format!("N {}\n", idx.skills.len()));
    s.push_str(&format!("A {:.4}\n", idx.avg_size));
    for (i, sk) in idx.skills.iter().enumerate() {
        s.push_str(&format!(
            "S {}\t{}\t{}\t{}\t{}\t{}\t{}\n",
            i,
            clean(&sk.name),
            clean(&sk.version),
            sk.description,
            clean(&sk.path),
            clean(&sk.source),
            sk.size
        ));
    }
    for (term, list) in &idx.postings {
        s.push_str("P ");
        s.push_str(term);
        s.push('\t');
        for (j, (i, c)) in list.iter().enumerate() {
            if j > 0 {
                s.push(',');
            }
            s.push_str(&format!("{}:{}", i, c));
        }
        s.push('\n');
    }
    s
}

/// Reads the index bringing back ONLY the postings for the requested terms. This is
/// the hot-path trick: the file is walked once, line by line, without building a
/// structure for the 60 thousand terms the query doesn't use.
pub fn read_partial(raw: &str, query_terms: &[String]) -> Index {
    let mut idx = Index::default();
    let wanted: std::collections::HashSet<&str> = query_terms.iter().map(|s| s.as_str()).collect();

    for line in raw.lines() {
        if line.len() < 2 {
            continue;
        }
        let (tag, rest) = line.split_at(2);
        match tag {
            "G " => idx.generated_at = rest.trim().parse().unwrap_or(0),
            "A " => idx.avg_size = rest.trim().parse().unwrap_or(1.0),
            "S " => {
                let c: Vec<&str> = rest.split('\t').collect();
                if c.len() >= 7 {
                    idx.skills.push(Skill {
                        name: c[1].to_string(),
                        version: c[2].to_string(),
                        description: c[3].to_string(),
                        path: c[4].to_string(),
                        source: c[5].to_string(),
                        size: c[6].trim().parse().unwrap_or(1),
                    });
                }
            }
            "P " => {
                let Some(tab) = rest.find('\t') else {
                    continue;
                };
                let term = &rest[..tab];
                if !wanted.contains(term) {
                    continue;
                }
                let mut list = Vec::new();
                for pair in rest[tab + 1..].trim().split(',') {
                    if let Some((a, b)) = pair.split_once(':') {
                        if let (Ok(i), Ok(c)) = (a.parse::<u32>(), b.parse::<u32>()) {
                            list.push((i, c));
                        }
                    }
                }
                idx.postings.insert(term.to_string(), list);
            }
            _ => {}
        }
    }
    if idx.avg_size <= 0.0 {
        idx.avg_size = 1.0;
    }
    idx
}

pub fn now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}
