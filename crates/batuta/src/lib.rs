//! BATUTA — open measurement layer for Agent Skills.
//!
//! This library is the CONTRACT. The binary is a thin shell on top of it, and
//! the test suite in `tests/conformance.rs` tests from here. Any port to another
//! language is conformant when it passes the same test suite with the same numbers.
//!
//! Laws of the hot path, all verifiable in the test suite:
//!   - zero network, zero LLM, zero waiting
//!   - the prompt text is never recorded nor transmitted
//!   - a false positive costs more than a false negative: when in doubt, stay silent

pub mod bm25;
pub mod conflicts;
pub mod data;
pub mod find;
pub mod home;
pub mod index;
pub mod json;
pub mod record;
pub mod route;
pub mod sha256;
pub mod text;

pub const VERSION: &str = env!("CARGO_PKG_VERSION");
