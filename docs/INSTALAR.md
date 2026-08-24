# Install Batuta

## Checksum-verified release (Linux and macOS)

```sh
curl -fsSL https://batuta.space/install.sh | sh
```

Pin a version with `BATUTA_VERSION=v0.1.0`; choose a destination with
`BATUTA_DEST=/opt/bin`. The installer downloads the matching GitHub release,
verifies it against that release's `SHA256SUMS`, and only then performs the final
write. The release workflow builds static musl binaries for Linux and publishes
checksums and GitHub build-provenance attestations for every archive.

On Windows, download the matching `.zip` and `SHA256SUMS` from the GitHub release,
verify it with `Get-FileHash -Algorithm SHA256`, then place `batuta.exe` on `PATH`.

## npm status — do not use the unscoped package

The npm package named `batuta` is unrelated to this project. Do **not** run
`npm install -g batuta`. The wrapper in `npm/` is named
`@filipecrocks/batuta` and is deliberately marked private until that scope has a
verified, provenance-bearing release. This document will only advertise npm
after the exact package is published and its ownership is verified.

## Build from source

```sh
git clone https://github.com/filipecrocks/batuta
cargo install --locked --path batuta/crates/batuta
```

This installs `$HOME/.cargo/bin/batuta`. The repository pins Rust in
`rust-toolchain.toml` and the crate has no third-party Rust dependencies.

## Verify and configure

```sh
batuta version
batuta index
batuta install-hooks
batuta report
batuta privacy
```

The installer does not enable upload. Local state is stored in `BATUTA_HOME` or
`$HOME/.batuta`; the legacy `BATUTA_CASA` variable remains supported during the
v0.x compatibility window. Directories are owner-only and state files are
written atomically with owner-only permissions.

The network-capable registry wrapper remains separate from the Rust binary:
`batuta registry update` downloads only the public skill registry. The legacy
`batuta registro atualizar` spelling remains an alias and emits a deprecation
warning.

To uninstall a Cargo build, run `cargo uninstall batuta`. Remove local data only
after inspecting it with `batuta privacy`; deleting `$HOME/.batuta` also removes
the local salt and cannot be undone.
