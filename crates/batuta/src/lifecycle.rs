//! Automatic hook lifecycle: route → activation → observational outcome.

use crate::home;
use crate::index;
use crate::json::{self, Value};
use crate::record;
use crate::route::Output;
use crate::sha256;
use crate::storage;
use crate::text;
use std::fs;
use std::io;
use std::path::PathBuf;
use std::time::Duration;

const SESSION_LOCK_WAIT: Duration = Duration::from_millis(250);

fn session_id(payload: &Value) -> Option<&str> {
    let value = payload.field("session_id").text();
    if value.is_empty() || value.len() > 256 || value.chars().any(char::is_control) {
        None
    } else {
        Some(value)
    }
}

fn active_file(payload: &Value) -> io::Result<Option<PathBuf>> {
    let Some(session) = session_id(payload) else {
        return Ok(None);
    };
    let salt = home::try_salt()?;
    let digest = sha256::hash_with_salt(&salt, &format!("hook-session|{session}"));
    let directory = home::ensure()?.join("active");
    storage::ensure_private_dir(&directory)?;
    Ok(Some(directory.join(format!("{}.json", &digest[..32]))))
}

fn load_state(path: &PathBuf) -> io::Result<Option<Value>> {
    match fs::read_to_string(path) {
        Ok(contents) => json::read(&contents)
            .map(Some)
            .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error)),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error),
    }
}

fn unknown_outcome(turn_id: &str, reason: &str) -> Value {
    json::object(vec![
        ("schema", json::text("batuta.event.v2")),
        ("v", json::number(2)),
        ("t", json::number(index::now() as f64)),
        ("type", json::text("outcome")),
        ("turn_id", json::text(turn_id)),
        ("status", json::text("unknown")),
        ("authority", json::text("runtime_observation")),
        ("trusted", Value::Bool(false)),
        ("receipt_verified", Value::Bool(false)),
        ("reason", json::text(reason)),
        ("reprompt", json::number(0)),
        ("errors", json::number(0)),
        ("retries", json::number(0)),
        ("turns", json::number(0)),
        ("tokens_in", json::number(0)),
        ("tokens_out", json::number(0)),
        ("cost_usd", json::number(0)),
    ])
}

pub fn begin_turn(payload: &Value, route: &Output) -> io::Result<bool> {
    let Some(path) = active_file(payload)? else {
        return Ok(false);
    };
    let lock = path.with_extension("session.lock");
    storage::with_exclusive_lock(lock, SESSION_LOCK_WAIT, || {
        if let Some(previous) = load_state(&path)? {
            let previous_turn = previous.field("turn_id").text();
            if !previous_turn.is_empty() {
                record::append(&unknown_outcome(previous_turn, "superseded_by_next_route"))?;
            }
        }

        let turn_id = route.event.field("turn_id").text();
        if !text::is_safe_correlation_id(turn_id) {
            return Ok(false);
        }
        let suggestions = route
            .event
            .field("suggestions")
            .items()
            .iter()
            .filter_map(|suggestion| {
                let skill = suggestion.field("skill").text();
                text::is_safe_skill_id(skill).then(|| json::text(skill))
            })
            .collect();
        let state = json::object(vec![
            ("turn_id", json::text(turn_id)),
            ("suggestions", Value::List(suggestions)),
            ("started_at", json::number(index::now() as f64)),
        ]);
        home::atomic_write(&path, json::write(&state).as_bytes(), 0o600)?;
        Ok(true)
    })
}

fn requested_skill(payload: &Value) -> &str {
    let nested = payload.field("tool_input").field("skill").text();
    if !nested.is_empty() {
        return nested;
    }
    let nested_name = payload.field("tool_input").field("name").text();
    if !nested_name.is_empty() {
        return nested_name;
    }
    payload.field("skill").text()
}

pub fn record_activation(payload: &Value) -> io::Result<bool> {
    if !matches!(payload.field("tool_name").text(), "Skill" | "skill") {
        return Ok(false);
    }
    let skill = requested_skill(payload);
    if !text::is_safe_skill_id(skill) {
        return Ok(false);
    }
    let Some(path) = active_file(payload)? else {
        return Ok(false);
    };
    let lock = path.with_extension("session.lock");
    storage::with_exclusive_lock(lock, SESSION_LOCK_WAIT, || {
        let Some(state) = load_state(&path)? else {
            return Ok(false);
        };
        let allowed = state
            .field("suggestions")
            .items()
            .iter()
            .any(|candidate| candidate.text() == skill);
        let already_activated = state
            .field("activations")
            .items()
            .iter()
            .any(|candidate| candidate.text() == skill);
        if !allowed || already_activated {
            return Ok(false);
        }
        let turn_id = state.field("turn_id").text().to_string();
        let mut activations = state.field("activations").items().to_vec();
        activations.push(json::text(skill));
        let updated = json::object(vec![
            ("turn_id", json::text(&turn_id)),
            (
                "suggestions",
                Value::List(state.field("suggestions").items().to_vec()),
            ),
            ("activations", Value::List(activations)),
            (
                "started_at",
                json::number(state.field("started_at").number()),
            ),
        ]);
        let event = json::object(vec![
            ("schema", json::text("batuta.event.v2")),
            ("v", json::number(2)),
            ("t", json::number(index::now() as f64)),
            ("type", json::text("activation")),
            ("turn_id", json::text(turn_id)),
            ("skill", json::text(skill)),
            ("version", json::text("")),
            ("actor", json::text("model")),
            ("authority", json::text("runtime_observation")),
            ("trusted", Value::Bool(false)),
        ]);
        record::append(&event)?;
        // Append first. If the state replacement then fails, a retry may append
        // the same logical activation, but aggregate() deduplicates by
        // (type, turn_id, skill). Updating state first could lose the only event.
        home::atomic_write(&path, json::write(&updated).as_bytes(), 0o600)?;
        Ok(true)
    })
}

pub fn record_outcome(payload: &Value) -> io::Result<bool> {
    let Some(path) = active_file(payload)? else {
        return Ok(false);
    };
    let lock = path.with_extension("session.lock");
    storage::with_exclusive_lock(lock, SESSION_LOCK_WAIT, || {
        let Some(state) = load_state(&path)? else {
            return Ok(false);
        };
        let turn_id = state.field("turn_id").text();
        if turn_id.is_empty() {
            return Ok(false);
        }
        record::append(&unknown_outcome(turn_id, "stop_hook"))?;
        match fs::remove_file(&path) {
            Ok(()) => Ok(true),
            Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(true),
            Err(error) => Err(error),
        }
    })
}
