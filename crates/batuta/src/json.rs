//! Minimal JSON — reader and writer. No dependencies, per project law.
//! Covers enough: object, list, string, number, bool, null, \uXXXX escapes.

use std::collections::BTreeMap;
use std::fmt::Write as _;

#[derive(Debug, Clone, PartialEq)]
pub enum Valor {
    Nulo,
    Bool(bool),
    Num(f64),
    Txt(String),
    Lista(Vec<Valor>),
    Obj(BTreeMap<String, Valor>),
}

impl Valor {
    pub fn txt(&self) -> &str {
        match self {
            Valor::Txt(s) => s,
            _ => "",
        }
    }
    pub fn num(&self) -> f64 {
        match self {
            Valor::Num(n) => *n,
            _ => 0.0,
        }
    }
    pub fn campo(&self, k: &str) -> &Valor {
        match self {
            Valor::Obj(m) => m.get(k).unwrap_or(&Valor::Nulo),
            _ => &Valor::Nulo,
        }
    }
    pub fn itens(&self) -> &[Valor] {
        match self {
            Valor::Lista(v) => v,
            _ => &[],
        }
    }
    pub fn e_nulo(&self) -> bool {
        matches!(self, Valor::Nulo)
    }
}

pub fn escapar(s: &str) -> String {
    let mut o = String::with_capacity(s.len() + 2);
    o.push('"');
    for c in s.chars() {
        match c {
            '"' => o.push_str("\\\""),
            '\\' => o.push_str("\\\\"),
            '\n' => o.push_str("\\n"),
            '\r' => o.push_str("\\r"),
            '\t' => o.push_str("\\t"),
            c if (c as u32) < 0x20 => {
                let _ = write!(o, "\\u{:04x}", c as u32);
            }
            c => o.push(c),
        }
    }
    o.push('"');
    o
}

/// Serializes with keys in alphabetical order — canonical, so the hash always matches.
pub fn escrever(v: &Valor) -> String {
    let mut s = String::new();
    escrever_em(v, &mut s);
    s
}

fn escrever_em(v: &Valor, s: &mut String) {
    match v {
        Valor::Nulo => s.push_str("null"),
        Valor::Bool(b) => s.push_str(if *b { "true" } else { "false" }),
        Valor::Num(n) => {
            if n.fract() == 0.0 && n.abs() < 1e15 {
                let _ = write!(s, "{}", *n as i64);
            } else {
                let _ = write!(s, "{}", (n * 1e6).round() / 1e6);
            }
        }
        Valor::Txt(t) => s.push_str(&escapar(t)),
        Valor::Lista(l) => {
            s.push('[');
            for (i, x) in l.iter().enumerate() {
                if i > 0 {
                    s.push(',');
                }
                escrever_em(x, s);
            }
            s.push(']');
        }
        Valor::Obj(m) => {
            s.push('{');
            for (i, (k, x)) in m.iter().enumerate() {
                if i > 0 {
                    s.push(',');
                }
                s.push_str(&escapar(k));
                s.push(':');
                escrever_em(x, s);
            }
            s.push('}');
        }
    }
}

pub fn ler(entrada: &str) -> Result<Valor, String> {
    let b: Vec<char> = entrada.chars().collect();
    let mut i = 0usize;
    let v = valor(&b, &mut i)?;
    pular(&b, &mut i);
    if i < b.len() {
        return Err(format!("lixo depois do fim do JSON na posicao {}", i));
    }
    Ok(v)
}

fn pular(b: &[char], i: &mut usize) {
    while *i < b.len() && (b[*i] == ' ' || b[*i] == '\n' || b[*i] == '\r' || b[*i] == '\t') {
        *i += 1;
    }
}

fn valor(b: &[char], i: &mut usize) -> Result<Valor, String> {
    pular(b, i);
    if *i >= b.len() {
        return Err("JSON vazio".into());
    }
    match b[*i] {
        '{' => {
            *i += 1;
            let mut m = BTreeMap::new();
            pular(b, i);
            if *i < b.len() && b[*i] == '}' {
                *i += 1;
                return Ok(Valor::Obj(m));
            }
            loop {
                pular(b, i);
                let k = match valor(b, i)? {
                    Valor::Txt(s) => s,
                    _ => return Err("chave de objeto tem que ser string".into()),
                };
                pular(b, i);
                if *i >= b.len() || b[*i] != ':' {
                    return Err("faltou ':' no objeto".into());
                }
                *i += 1;
                let v = valor(b, i)?;
                m.insert(k, v);
                pular(b, i);
                if *i >= b.len() {
                    return Err("objeto sem fecho".into());
                }
                if b[*i] == ',' {
                    *i += 1;
                    continue;
                }
                if b[*i] == '}' {
                    *i += 1;
                    return Ok(Valor::Obj(m));
                }
                return Err("esperava ',' ou '}'".into());
            }
        }
        '[' => {
            *i += 1;
            let mut l = Vec::new();
            pular(b, i);
            if *i < b.len() && b[*i] == ']' {
                *i += 1;
                return Ok(Valor::Lista(l));
            }
            loop {
                l.push(valor(b, i)?);
                pular(b, i);
                if *i >= b.len() {
                    return Err("lista sem fecho".into());
                }
                if b[*i] == ',' {
                    *i += 1;
                    continue;
                }
                if b[*i] == ']' {
                    *i += 1;
                    return Ok(Valor::Lista(l));
                }
                return Err("esperava ',' ou ']'".into());
            }
        }
        '"' => {
            *i += 1;
            let mut s = String::new();
            while *i < b.len() {
                let c = b[*i];
                *i += 1;
                match c {
                    '"' => return Ok(Valor::Txt(s)),
                    '\\' => {
                        if *i >= b.len() {
                            return Err("escape cortado".into());
                        }
                        let e = b[*i];
                        *i += 1;
                        match e {
                            'n' => s.push('\n'),
                            't' => s.push('\t'),
                            'r' => s.push('\r'),
                            'b' => s.push('\u{8}'),
                            'f' => s.push('\u{c}'),
                            'u' => {
                                if *i + 4 > b.len() {
                                    return Err("\\u cortado".into());
                                }
                                let hexa: String = b[*i..*i + 4].iter().collect();
                                *i += 4;
                                let cp = u32::from_str_radix(&hexa, 16)
                                    .map_err(|_| "\\u invalido".to_string())?;
                                if (0xD800..0xDC00).contains(&cp)
                                    && *i + 6 <= b.len()
                                    && b[*i] == '\\'
                                    && b[*i + 1] == 'u'
                                {
                                    let hexa2: String = b[*i + 2..*i + 6].iter().collect();
                                    if let Ok(lo) = u32::from_str_radix(&hexa2, 16) {
                                        if (0xDC00..0xE000).contains(&lo) {
                                            *i += 6;
                                            let full =
                                                0x10000 + ((cp - 0xD800) << 10) + (lo - 0xDC00);
                                            s.push(char::from_u32(full).unwrap_or('\u{fffd}'));
                                            continue;
                                        }
                                    }
                                }
                                s.push(char::from_u32(cp).unwrap_or('\u{fffd}'));
                            }
                            outro => s.push(outro),
                        }
                    }
                    c => s.push(c),
                }
            }
            Err("string sem fecho".into())
        }
        't' | 'f' | 'n' => {
            let resto: String = b[*i..b.len().min(*i + 5)].iter().collect();
            if resto.starts_with("true") {
                *i += 4;
                Ok(Valor::Bool(true))
            } else if resto.starts_with("false") {
                *i += 5;
                Ok(Valor::Bool(false))
            } else if resto.starts_with("null") {
                *i += 4;
                Ok(Valor::Nulo)
            } else {
                Err(format!("literal desconhecido na posicao {}", i))
            }
        }
        _ => {
            let ini = *i;
            while *i < b.len()
                && (b[*i].is_ascii_digit()
                    || b[*i] == '-'
                    || b[*i] == '+'
                    || b[*i] == '.'
                    || b[*i] == 'e'
                    || b[*i] == 'E')
            {
                *i += 1;
            }
            let s: String = b[ini..*i].iter().collect();
            s.parse::<f64>()
                .map(Valor::Num)
                .map_err(|_| format!("numero invalido: {}", s))
        }
    }
}

pub fn obj(pares: Vec<(&str, Valor)>) -> Valor {
    let mut m = BTreeMap::new();
    for (k, v) in pares {
        m.insert(k.to_string(), v);
    }
    Valor::Obj(m)
}
pub fn txt(s: impl Into<String>) -> Valor {
    Valor::Txt(s.into())
}
pub fn num(n: impl Into<f64>) -> Valor {
    Valor::Num(n.into())
}
