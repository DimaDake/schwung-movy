# Third-party licenses

movy itself is MIT (`LICENSE`). One program it ships is not.

## movy-link — GPL-2.0-or-later

`movy-link` (source: `link/`) is movy's Ableton Link peer. It links the
[Ableton Link SDK](https://github.com/Ableton/link) (GPL-2.0-or-later, Copyright
2016 Ableton AG), which schwung vendors at `libs/link`, so `movy-link` is
distributed under the GNU General Public License, version 2 or later. Its source
is `link/movy_link.cpp`, `link/link_rings.hpp` and `link/movy_link_shm.h`, built by
`scripts/build-link.sh`; the SDK's own source is the schwung submodule commit the
build names.

`movy-link` is a separate program. movy-host and the engine (`dsp.so`) never link
it or the SDK; they exchange data with it only through the shared-memory segment
`/dev/shm/movy-link` described by `link/movy_link_shm.h`.

The SDK bundles asio-standalone (Boost Software License 1.0).
