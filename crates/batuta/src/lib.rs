//! BATUTA — camada aberta de medicao de Agent Skills.
//!
//! Esta biblioteca e o CONTRATO. O binario e uma casca fina em cima dela, e a
//! bateria em `tests/conformidade.rs` testa daqui. Qualquer porte para outra
//! linguagem esta conforme quando passa a mesma bateria com os mesmos numeros.
//!
//! Leis do caminho quente, todas verificaveis na bateria:
//!   - zero rede, zero LLM, zero espera
//!   - o texto do prompt nunca e gravado nem transmitido
//!   - falso positivo custa mais que falso negativo: na duvida, silencio

pub mod achar;
pub mod bm25;
pub mod casa;
pub mod conflitos;
pub mod data;
pub mod indice;
pub mod json;
pub mod registro;
pub mod rota;
pub mod sha256;
pub mod texto;

pub const VERSAO: &str = env!("CARGO_PKG_VERSION");
