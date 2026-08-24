//! Minimal JSON — reader and writer. No dependencies, per project law.
//! Covers enough: object, list, string, number, bool, null, \uXXXX escapes.

use std::collections::BTreeMap;
use std::fmt::Write as _;

const MAX_JSON_DEPTH: usize = 64;

#[derive(Debug, Clone, PartialEq)]
pub enum Value {
    Null,
    Bool(bool),
    Num(f64),
    Text(String),
    List(Vec<Value>),
    Object(BTreeMap<String, Value>),
}

impl Value {
    pub fn text(&self) -> &str {
        match self {
            Value::Text(s) => s,
            _ => "",
        }
    }
    pub fn number(&self) -> f64 {
        match self {
            Value::Num(n) => *n,
            _ => 0.0,
        }
    }
    pub fn field(&self, k: &str) -> &Value {
        match self {
            Value::Object(m) => m.get(k).unwrap_or(&Value::Null),
            _ => &Value::Null,
        }
    }
    pub fn items(&self) -> &[Value] {
        match self {
            Value::List(v) => v,
            _ => &[],
        }
    }
    pub fn is_null(&self) -> bool {
        matches!(self, Value::Null)
    }
}

pub fn escape(s: &str) -> String {
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
pub fn write(v: &Value) -> String {
    let mut s = String::new();
    write_into(v, &mut s);
    s
}

fn write_into(v: &Value, s: &mut String) {
    match v {
        Value::Null => s.push_str("null"),
        Value::Bool(b) => s.push_str(if *b { "true" } else { "false" }),
        Value::Num(n) => {
            if n.fract() == 0.0 && n.abs() < 1e15 {
                let _ = write!(s, "{}", *n as i64);
            } else {
                let _ = write!(s, "{}", (n * 1e6).round() / 1e6);
            }
        }
        Value::Text(t) => s.push_str(&escape(t)),
        Value::List(l) => {
            s.push('[');
            for (i, x) in l.iter().enumerate() {
                if i > 0 {
                    s.push(',');
                }
                write_into(x, s);
            }
            s.push(']');
        }
        Value::Object(m) => {
            s.push('{');
            for (i, (k, x)) in m.iter().enumerate() {
                if i > 0 {
                    s.push(',');
                }
                s.push_str(&escape(k));
                s.push(':');
                write_into(x, s);
            }
            s.push('}');
        }
    }
}

pub fn read(input: &str) -> Result<Value, String> {
    let b: Vec<char> = input.chars().collect();
    let mut i = 0usize;
    let v = parse_value(&b, &mut i, 0)?;
    skip_ws(&b, &mut i);
    if i < b.len() {
        return Err(format!(
            "trailing content after end of JSON at position {}",
            i
        ));
    }
    Ok(v)
}

fn skip_ws(b: &[char], i: &mut usize) {
    while *i < b.len() && (b[*i] == ' ' || b[*i] == '\n' || b[*i] == '\r' || b[*i] == '\t') {
        *i += 1;
    }
}

fn parse_value(b: &[char], i: &mut usize, depth: usize) -> Result<Value, String> {
    if depth > MAX_JSON_DEPTH {
        return Err(format!("JSON exceeds maximum depth of {MAX_JSON_DEPTH}"));
    }
    skip_ws(b, i);
    if *i >= b.len() {
        return Err("empty JSON".into());
    }
    match b[*i] {
        '{' => {
            *i += 1;
            let mut m = BTreeMap::new();
            skip_ws(b, i);
            if *i < b.len() && b[*i] == '}' {
                *i += 1;
                return Ok(Value::Object(m));
            }
            loop {
                skip_ws(b, i);
                let k = match parse_value(b, i, depth + 1)? {
                    Value::Text(s) => s,
                    _ => return Err("object key must be a string".into()),
                };
                skip_ws(b, i);
                if *i >= b.len() || b[*i] != ':' {
                    return Err("missing ':' in object".into());
                }
                *i += 1;
                let v = parse_value(b, i, depth + 1)?;
                m.insert(k, v);
                skip_ws(b, i);
                if *i >= b.len() {
                    return Err("unterminated object".into());
                }
                if b[*i] == ',' {
                    *i += 1;
                    continue;
                }
                if b[*i] == '}' {
                    *i += 1;
                    return Ok(Value::Object(m));
                }
                return Err("expected ',' or '}'".into());
            }
        }
        '[' => {
            *i += 1;
            let mut l = Vec::new();
            skip_ws(b, i);
            if *i < b.len() && b[*i] == ']' {
                *i += 1;
                return Ok(Value::List(l));
            }
            loop {
                l.push(parse_value(b, i, depth + 1)?);
                skip_ws(b, i);
                if *i >= b.len() {
                    return Err("unterminated list".into());
                }
                if b[*i] == ',' {
                    *i += 1;
                    continue;
                }
                if b[*i] == ']' {
                    *i += 1;
                    return Ok(Value::List(l));
                }
                return Err("expected ',' or ']'".into());
            }
        }
        '"' => {
            *i += 1;
            let mut s = String::new();
            while *i < b.len() {
                let c = b[*i];
                *i += 1;
                match c {
                    '"' => return Ok(Value::Text(s)),
                    '\\' => {
                        if *i >= b.len() {
                            return Err("truncated escape".into());
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
                                    return Err("truncated \\u escape".into());
                                }
                                let hex: String = b[*i..*i + 4].iter().collect();
                                *i += 4;
                                let cp = u32::from_str_radix(&hex, 16)
                                    .map_err(|_| "invalid \\u escape".to_string())?;
                                if (0xD800..0xDC00).contains(&cp)
                                    && *i + 6 <= b.len()
                                    && b[*i] == '\\'
                                    && b[*i + 1] == 'u'
                                {
                                    let hex2: String = b[*i + 2..*i + 6].iter().collect();
                                    if let Ok(lo) = u32::from_str_radix(&hex2, 16) {
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
                            other => s.push(other),
                        }
                    }
                    c if (c as u32) < 0x20 => {
                        return Err("unescaped control character in string".into())
                    }
                    c => s.push(c),
                }
            }
            Err("unterminated string".into())
        }
        't' | 'f' | 'n' => {
            let rest: String = b[*i..b.len().min(*i + 5)].iter().collect();
            if rest.starts_with("true") {
                *i += 4;
                Ok(Value::Bool(true))
            } else if rest.starts_with("false") {
                *i += 5;
                Ok(Value::Bool(false))
            } else if rest.starts_with("null") {
                *i += 4;
                Ok(Value::Null)
            } else {
                Err(format!("unknown literal at position {}", i))
            }
        }
        _ => {
            let start = *i;
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
            let s: String = b[start..*i].iter().collect();
            let number = s
                .parse::<f64>()
                .map_err(|_| format!("invalid number: {s}"))?;
            if number.is_finite() {
                Ok(Value::Num(number))
            } else {
                Err(format!("non-finite number: {s}"))
            }
        }
    }
}

pub fn object(pairs: Vec<(&str, Value)>) -> Value {
    let mut m = BTreeMap::new();
    for (k, v) in pairs {
        m.insert(k.to_string(), v);
    }
    Value::Object(m)
}
pub fn text(s: impl Into<String>) -> Value {
    Value::Text(s.into())
}
pub fn number(n: impl Into<f64>) -> Value {
    Value::Num(n.into())
}
