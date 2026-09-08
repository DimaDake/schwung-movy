# old-sets — real per-set state written by earlier movy builds

These are verbatim copies of `sets/<uuid>/{seq-state,ui-state}.json` taken off a
device, not files this repo generated. That is the whole point: a fixture the
current build writes can only ever prove the current build round-trips itself,
which is exactly the check that stays green while an old set stops opening.

Two arms, because a set records WHO HOSTS TRACKS 1-4 and the two answers restore
through different code:

- `movy-chains/`     `flags.chtrackset: 1` — movy hosts them. Three chains
                     (8w8 / obxd+cloudseed / nusaw), each with its preset blob,
                     and notes on tracks 0-2.
- `schwung-tracks/`  `flags.chtrackset: 0` — schwung's four shadow slots host
                     them, so movy must claim NO chain on 0-3 and leave the
                     slots to Move's own set file. Notes on tracks 0-3 and 9.

Neither has a `sends` key: they predate send buses, which is the backward
compatibility the newest release has to keep.

Replace them only by copying newer captures ALONGSIDE these; deleting an arm
deletes the evidence that that vintage still loads.
