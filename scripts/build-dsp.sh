#!/usr/bin/env bash
# build-dsp.sh — cross-compile the Rust sequencer engine to dist/dsp.so
#
# Requires: rustup stable + target aarch64-unknown-linux-gnu, and the
# messense aarch64-unknown-linux-gnu toolchain (linker) from Homebrew:
#   brew tap messense/macos-cross-toolchains && brew install aarch64-unknown-linux-gnu
set -euo pipefail
DIR="$(cd "$(dirname "$0")/.." && pwd)"
export PATH="/opt/homebrew/opt/rustup/bin:$HOME/.cargo/bin:/opt/homebrew/bin:$PATH"

# Fail with actionable install steps instead of a bare "command not found" —
# that error alone doesn't tell a first-time builder they need Rust at all.
if ! command -v cargo >/dev/null 2>&1; then
    cat >&2 <<'EOF'
ERROR: cargo not found (this builds the Rust sequencer engine, dsp.so).

Install Rust, then re-run this script:
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
  source "$HOME/.cargo/env"
  rustup target add aarch64-unknown-linux-gnu

macOS also needs the aarch64 cross-compiler (linker) via Homebrew:
  brew tap messense/macos-cross-toolchains
  brew install aarch64-unknown-linux-gnu
EOF
    exit 1
fi
INSTALLED_TARGETS="$(rustup target list --installed 2>/dev/null)"
if ! grep -q '^aarch64-unknown-linux-gnu$' <<<"$INSTALLED_TARGETS"; then
    echo "ERROR: missing rustup target. Run: rustup target add aarch64-unknown-linux-gnu" >&2
    exit 1
fi
if ! command -v aarch64-unknown-linux-gnu-gcc >/dev/null 2>&1; then
    cat >&2 <<'EOF'
ERROR: aarch64-unknown-linux-gnu-gcc not found (cross-linker for dsp.so).
On macOS, install it via Homebrew:
  brew tap messense/macos-cross-toolchains
  brew install aarch64-unknown-linux-gnu
EOF
    exit 1
fi

# UI and engine must agree on the protocol version (the UI re-loads the DSP
# until ping reports this exact version).
RUST_VER=$(grep -o 'ENGINE_VERSION: &str = "[^"]*"' "$DIR/engine/crates/movy-dsp/src/lib.rs" | cut -d'"' -f2)
TS_VER=$(grep -o "ENGINE_VERSION = '[^']*'" "$DIR/src/seq/constants.ts" | cut -d"'" -f2)
if [[ "$RUST_VER" != "$TS_VER" ]]; then
    echo "ERROR: ENGINE_VERSION mismatch: movy-dsp/lib.rs=$RUST_VER vs seq/constants.ts=$TS_VER"
    exit 1
fi

TARGET=aarch64-unknown-linux-gnu
cd "$DIR/engine"
cargo build --release --target "$TARGET"

SO="$DIR/engine/target/$TARGET/release/libmovy_dsp.so"
mkdir -p "$DIR/dist"
cp "$SO" "$DIR/dist/dsp.so"

# Device glibc ceiling (davebox rule): symbols must be <= GLIBC 2.35.
MAXGLIBC=$("$TARGET-nm" -D "$DIR/dist/dsp.so" | grep -o "GLIBC_[0-9.]*" | sort -uV | tail -1)
case "$MAXGLIBC" in
    GLIBC_2.3[6-9]*|GLIBC_2.[4-9]*|GLIBC_3*) echo "ERROR: $MAXGLIBC exceeds device glibc 2.35"; exit 1 ;;
esac
echo "dist/dsp.so built ($MAXGLIBC max)"
