/*
 * chain-table.c — the chain host's param table for one module, built by the
 * chain host's OWN parser (browser-test/drum-automation-matrix.mjs).
 *
 * An automation lane played back as CC 102+lane reaches the module only if its
 * key is in this table: `knob_find_param` is an exact `find_param_info` scan,
 * with no child-template alias, no suffix match and no runtime refresh
 * (chain_params.c). The table has two lives, so both are printed:
 *
 *   static   parse_chain_params(module.json) — what a load leaves behind:
 *            ui_hierarchy params, then chain_params merged, capped at
 *            MAX_CHAIN_PARAMS.
 *   dynamic  parse_chain_params_array_json(plugin chain_params) — what the
 *            first find_param_by_key miss swaps in (a knob_N_value warm, an
 *            LFO), capped the same way.
 *
 * Linked against SCHWUNG's chain_params.c + chain_json.c, exactly as schwung's
 * tests/host/test_chain_params_max_param.sh does, so the cap, the merge order
 * and the dedupe are the device's and not a re-spelling of them.
 *
 * Usage: chain-table <module_dir> [<plugin_chain_params.json>]
 * Prints one JSON object: {"max":N,"static":[keys],"dynamic":[keys]}.
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "chain_internal.h"

void chain_log(const char *msg) { (void)msg; }
int chain_mod_refresh_target_param_cache(chain_instance_t *inst, const char *target) {
    (void)inst; (void)target; return 0;
}

static chain_param_info_t table[MAX_CHAIN_PARAMS];

static void print_keys(const char *name, int n) {
    printf("\"%s\":[", name);
    for (int i = 0; i < n; i++) printf("%s\"%s\"", i ? "," : "", table[i].key);
    printf("]");
}

int main(int argc, char **argv) {
    if (argc < 2) { fprintf(stderr, "usage: chain-table <module_dir> [cp.json]\n"); return 2; }

    int n = 0;
    if (parse_chain_params(argv[1], table, &n) < 0) n = -1;
    printf("{\"max\":%d,", MAX_CHAIN_PARAMS);
    if (n < 0) printf("\"static\":null"); else print_keys("static", n);

    int d = -1;
    if (argc > 2) {
        FILE *f = fopen(argv[2], "rb");
        if (f) {
            fseek(f, 0, SEEK_END);
            long sz = ftell(f);
            fseek(f, 0, SEEK_SET);
            char *buf = malloc((size_t)sz + 1);
            size_t got = fread(buf, 1, (size_t)sz, f);
            buf[got] = '\0';
            fclose(f);
            memset(table, 0, sizeof table);
            d = parse_chain_params_array_json(buf, table, MAX_CHAIN_PARAMS);
            free(buf);
        }
    }
    printf(",");
    if (d < 0) printf("\"dynamic\":null"); else print_keys("dynamic", d);
    printf("}\n");
    return 0;
}
