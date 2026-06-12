#!/usr/bin/env bash
# build-dsp.sh — cross-compile the Rust sequencer engine to dist/dsp.so
#
# Requires: rustup stable + target aarch64-unknown-linux-gnu, and the
# messense aarch64-unknown-linux-gnu toolchain (linker) from Homebrew:
#   brew tap messense/macos-cross-toolchains && brew install aarch64-unknown-linux-gnu
set -euo pipefail
DIR="$(cd "$(dirname "$0")/.." && pwd)"
export PATH="/opt/homebrew/opt/rustup/bin:$HOME/.cargo/bin:/opt/homebrew/bin:$PATH"

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
