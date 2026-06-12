/* Mock of the Rust engine's param protocol for browser/node tests. Installs
 * host_module_set_param / host_module_get_param on globalThis and implements
 * the same cmd/status contract as movy-dsp, so src/seq/engine.ts is tested
 * against the real wire format. */

export function installMockEngine() {
    const engine = {
        /* every batched cmd flush, in arrival order */
        cmdBatches: [],
        /* parsed individual ops across all batches */
        ops: [],
        /* status the engine reports; tests mutate freely */
        status: { play: 0, tick: 0, bpm: 12000 },
        /* set true to simulate an engine that lacks the protocol */
        statusUnavailable: false,
        setParamCalls: 0,
        getParamCalls: 0,

        reset() {
            this.cmdBatches = [];
            this.ops = [];
            this.status = { play: 0, tick: 0, bpm: 12000 };
            this.statusUnavailable = false;
            this.setParamCalls = 0;
            this.getParamCalls = 0;
        },
    };

    globalThis.host_module_set_param = (key, value) => {
        engine.setParamCalls++;
        if (key === 'cmd') {
            engine.cmdBatches.push(value);
            for (const op of value.split(';')) {
                if (op.length > 0) engine.ops.push(op);
            }
        }
        return true;
    };

    globalThis.host_module_get_param = (key) => {
        engine.getParamCalls++;
        if (key === 'status') {
            if (engine.statusUnavailable) return null;
            const s = engine.status;
            return `play=${s.play} tick=${s.tick} bpm=${s.bpm}`;
        }
        if (key === 'ping') return 'pong mock';
        return null;
    };

    return engine;
}

export function uninstallMockEngine() {
    delete globalThis.host_module_set_param;
    delete globalThis.host_module_get_param;
}
