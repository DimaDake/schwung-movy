# old-sets — real per-set state written by earlier movy builds

These are verbatim copies of `sets/<uuid>/{seq-state,ui-state}.json` taken off a
device, not files this repo generated. That is the whole point: a fixture the
current build writes can only ever prove the current build round-trips itself,
which is exactly the check that stays green while an old set stops opening.

- `movy-chains/`     `flags.chtrackset: 1` — movy hosts them. Three chains
                     (8w8 / obxd+cloudseed / nusaw), each with its preset blob,
                     and notes on tracks 0-2.
(A `schwung-tracks/` arm — a set whose first four tracks lived in schwung's
shadow slots — went with the slot migration in WP9.)

It has no `sends` key: they predate send buses, which is the backward
compatibility the newest release has to keep.

Replace them only by copying newer captures ALONGSIDE these; deleting an arm
deletes the evidence that that vintage still loads.
