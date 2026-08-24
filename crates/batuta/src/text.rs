//! Hot-path tokenizer.
//!
//! Three decisions that carry the weight of rules, not taste:
//!  1. No stemmer. A stemmer on the hot path costs a table and costs time. Instead,
//!     alongside the exact term we index the 5-LETTER PREFIX of every word longer
//!     than 5 letters. "quebrou" and "quebrado" meet at "quebr", and the cost is a
//!     string slice.
//!  2. Accents don't exist. "codigo" and "código" are the same word — voice-to-text and
//!     phone keyboards don't agree on this, and the router can't afford to care.
//!  3. Glue words are stripped out. Without this, the 2.0 noise cutoff becomes decoration:
//!     "o que que e isso" would match half the library.

/// Prefix indexed alongside the exact term for words above this length.
pub const PREFIX_LEN: usize = 5;

const GLUE_WORDS: &[&str] = &[
    // portuguese
    "a", "ao", "aos", "as", "ate", "com", "como", "da", "das", "de", "dele", "dela", "deles", "do",
    "dos", "e", "ela", "ele", "eles", "em", "essa", "esse", "esta", "este", "eu", "faz", "fazer",
    "foi", "isso", "isto", "ja", "la", "lhe", "mais", "mas", "me", "mesmo", "meu", "minha",
    "muito", "na", "nao", "nas", "no", "nos", "num", "numa", "o", "os", "ou", "para", "pela",
    "pelo", "por", "pra", "pro", "qual", "quando", "que", "se", "sem", "ser", "seu", "sua", "so",
    "tem", "ter", "teu", "um", "uma", "voce", "vc", "ai", "aqui", "agora", "entao", "tudo", "todo",
    "toda", "coisa", "coisas", "quero", "queria", "preciso", "poderia", "pode", "favor",
    "obrigado", // english
    "a", "about", "an", "and", "are", "as", "at", "be", "but", "by", "can", "do", "does", "for",
    "from", "has", "have", "how", "i", "if", "in", "is", "it", "its", "me", "my", "not", "of",
    "on", "or", "please", "so", "that", "the", "their", "them", "then", "there", "these", "they",
    "this", "to", "use", "using", "want", "was", "we", "were", "what", "when", "which", "will",
    "with", "would", "you", "your",
];

fn is_glue(t: &str) -> bool {
    GLUE_WORDS.contains(&t)
}

/// Lowercase + accent removed, one character at a time. Covers the extended Latin-1
/// range that shows up in pt/es/fr; everything else passes through as-is.
fn fold_char(c: char) -> char {
    let c = c.to_ascii_lowercase();
    match c {
        'á' | 'à' | 'â' | 'ã' | 'ä' | 'å' | 'Á' | 'À' | 'Â' | 'Ã' | 'Ä' | 'Å' => 'a',
        'é' | 'è' | 'ê' | 'ë' | 'É' | 'È' | 'Ê' | 'Ë' => 'e',
        'í' | 'ì' | 'î' | 'ï' | 'Í' | 'Ì' | 'Î' | 'Ï' => 'i',
        'ó' | 'ò' | 'ô' | 'õ' | 'ö' | 'Ó' | 'Ò' | 'Ô' | 'Õ' | 'Ö' => 'o',
        'ú' | 'ù' | 'û' | 'ü' | 'Ú' | 'Ù' | 'Û' | 'Ü' => 'u',
        'ç' | 'Ç' => 'c',
        'ñ' | 'Ñ' => 'n',
        'ý' | 'ÿ' | 'Ý' => 'y',
        other => {
            if other.is_uppercase() {
                other.to_lowercase().next().unwrap_or(other)
            } else {
                other
            }
        }
    }
}

/// Splits the text into terms that are already normalized, already free of glue words,
/// already with the 5-letter prefix added to the exact term. It's the same path for
/// indexing and for querying — if the two ends diverge, the router lies.
pub fn terms(text: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut current = String::new();

    for ch in text.chars() {
        let c = fold_char(ch);
        if c.is_ascii_alphanumeric() {
            current.push(c);
        } else {
            push_term(&mut out, &mut current);
        }
    }
    push_term(&mut out, &mut current);
    out
}

fn push_term(out: &mut Vec<String>, current: &mut String) {
    if current.is_empty() {
        return;
    }
    let t = std::mem::take(current);
    if t.len() < 2 || is_glue(&t) {
        return;
    }
    // a standalone number routes nothing — 2024, 300, v1 are left out
    if t.chars().all(|c| c.is_ascii_digit()) {
        return;
    }
    if t.len() > PREFIX_LEN {
        out.push(t[..PREFIX_LEN].to_string());
    }
    out.push(t);
}

/// Cuts the text down to at most `n` terms. A long SKILL.md body can't dominate the
/// index just by being long — the BM25 B=0.75 already penalizes long documents, this
/// here is the second belt.
pub fn take_first(mut v: Vec<String>, n: usize) -> Vec<String> {
    if v.len() > n {
        v.truncate(n);
    }
    v
}
