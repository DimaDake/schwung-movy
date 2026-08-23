# Scores three digest arms into a per-chain verdict. Given -v a/-v b/-v a2 as
# `<hex>/<voiced>,...` lists (see chain_digest.rs), prints one line per chain
# plus a trailing `SUMMARY <pass> <fail> <silent> <unstable>`.
#
# Its own file because it is the one place in the equivalence run where being
# wrong is silent: every other step either produces a number or fails loudly,
# whereas a scoring bug here prints a confident green PASS. browser-test/
# device-scripts.mjs feeds it synthetic arms and checks it calls each case.
#
# A chain is EVIDENCE only if it sounded in every arm and the two serial arms
# agree with each other. Everything else is reported as the reason it is not
# evidence — never quietly folded into the pass count.
BEGIN {
    split(a, A, ","); split(b, B, ","); split(a2, C, ","); split(mods, M, " ")
    # `plan` is chrenderlog's `<lane0>|<lane1>|...` from the PARALLEL arm. Without
    # it a pass is not evidence of anything: the planner pins same-module chains
    # to one lane, so a chain can be "identical" simply because it never left the
    # audio thread. Only a chain that rendered on a HELPER was actually exposed
    # to the concurrency under test.
    np = split(plan, L, "|")
    for (l = 1; l <= np; l++) {
        m = split(L[l], CH, ",")
        for (j = 1; j <= m; j++) lane[CH[j] + 0] = l - 1
    }
    pass = 0; fail = 0; silent = 0; unstable = 0; exposed = 0
    for (i = 1; i <= n; i++) {
        split(A[i], pa, "/"); split(B[i], pb, "/"); split(C[i], pc, "/")
        ha = pa[1]; hb = pb[1]; hc = pc[1]
        va = pa[2] + 0; vb = pb[2] + 0; vc = pc[2] + 0
        if (va == 0 || vb == 0 || vc == 0) {
            # A silent chain hashes identically however it was rendered, so
            # counting it as a match would inflate coverage with nothing.
            v = Y "silent — no coverage" Z; silent++
        } else if (ha != hc) {
            # The chain does not repeat itself even serially, so comparing it
            # against the parallel arm proves nothing about threading.
            v = Y "not reproducible — excluded" Z; unstable++
        } else if (ha == hb) {
            v = G "identical" Z; pass++
            if (lane[i-1] > 0) exposed++
        } else {
            v = R "DIFFERS — parallel changed the audio" Z; fail++
        }
        printf "  %-5s %-9s %-6s %-18s %-18s %s\n", \
            "ch" (i-1), M[i], "L" lane[i-1], substr(ha,1,16), substr(hb,1,16), v
    }
    printf "SUMMARY %d %d %d %d %d\n", pass, fail, silent, unstable, exposed
}
