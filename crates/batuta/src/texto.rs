//! Tokenizador do caminho quente.
//!
//! Tres decisoes que valem regra, nao gosto:
//!  1. Sem stemmer. Stemmer no caminho quente custa tabela e custa tempo. No lugar,
//!     junto do termo exato indexamos o PREFIXO DE 5 LETRAS de toda palavra com mais
//!     de 5 letras. "quebrou" e "quebrado" se encontram em "quebr", e o custo e uma
//!     fatia de string.
//!  2. Acento nao existe. "codigo" e "código" sao a mesma palavra — voz-para-texto e
//!     teclado de celular nao concordam sobre isso e o roteador nao pode se importar.
//!  3. Palavra-cola sai fora. Sem isso o corte de ruido de 2.0 vira decoracao: "o que
//!     que e isso" casaria com meia biblioteca.

/// Prefixo indexado junto do termo exato para palavras acima deste tamanho.
pub const PREFIXO: usize = 5;

const COLA: &[&str] = &[
    // portugues
    "a", "ao", "aos", "as", "ate", "com", "como", "da", "das", "de", "dele", "dela", "deles", "do",
    "dos", "e", "ela", "ele", "eles", "em", "essa", "esse", "esta", "este", "eu", "faz", "fazer",
    "foi", "isso", "isto", "ja", "la", "lhe", "mais", "mas", "me", "mesmo", "meu", "minha",
    "muito", "na", "nao", "nas", "no", "nos", "num", "numa", "o", "os", "ou", "para", "pela",
    "pelo", "por", "pra", "pro", "qual", "quando", "que", "se", "sem", "ser", "seu", "sua", "so",
    "tem", "ter", "teu", "um", "uma", "voce", "vc", "ai", "aqui", "agora", "entao", "tudo", "todo",
    "toda", "coisa", "coisas", "quero", "queria", "preciso", "poderia", "pode", "favor",
    "obrigado", // ingles
    "a", "about", "an", "and", "are", "as", "at", "be", "but", "by", "can", "do", "does", "for",
    "from", "has", "have", "how", "i", "if", "in", "is", "it", "its", "me", "my", "not", "of",
    "on", "or", "please", "so", "that", "the", "their", "them", "then", "there", "these", "they",
    "this", "to", "use", "using", "want", "was", "we", "were", "what", "when", "which", "will",
    "with", "would", "you", "your",
];

fn e_cola(t: &str) -> bool {
    COLA.contains(&t)
}

/// Minuscula + acento removido, um caractere de cada vez. Cobre o latim-1 estendido
/// que aparece em pt/es/fr; o resto passa como esta.
fn dobrar(c: char) -> char {
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
        outro => {
            if outro.is_uppercase() {
                outro.to_lowercase().next().unwrap_or(outro)
            } else {
                outro
            }
        }
    }
}

/// Quebra o texto em termos ja normalizados, ja sem cola, ja com o prefixo de 5
/// letras somado ao termo exato. E o mesmo caminho para indexar e para consultar —
/// se as duas pontas divergirem, o roteador mente.
pub fn termos(texto: &str) -> Vec<String> {
    let mut saida = Vec::new();
    let mut atual = String::new();

    for ch in texto.chars() {
        let c = dobrar(ch);
        if c.is_ascii_alphanumeric() {
            atual.push(c);
        } else {
            empurrar(&mut saida, &mut atual);
        }
    }
    empurrar(&mut saida, &mut atual);
    saida
}

fn empurrar(saida: &mut Vec<String>, atual: &mut String) {
    if atual.is_empty() {
        return;
    }
    let t = std::mem::take(atual);
    if t.len() < 2 || e_cola(&t) {
        return;
    }
    // numero solto nao roteia nada — 2024, 300, v1 ficam de fora
    if t.chars().all(|c| c.is_ascii_digit()) {
        return;
    }
    if t.len() > PREFIXO {
        saida.push(t[..PREFIXO].to_string());
    }
    saida.push(t);
}

/// Corta o texto em no maximo `n` termos. Corpo de SKILL.md longo nao pode dominar o
/// indice so por ser longo — o B=0.75 do BM25 ja penaliza documento comprido, isto
/// aqui e o segundo cinto.
pub fn primeiros(mut v: Vec<String>, n: usize) -> Vec<String> {
    if v.len() > n {
        v.truncate(n);
    }
    v
}
