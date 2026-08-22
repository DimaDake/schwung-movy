/* join-cost.c — what does it cost to fan work out to other cores and join,
 * 344 times a second, on this device?
 *
 * This is the throwaway prototype called for by
 * plans/2026-08-21-frame-phase-measurement.md. That measurement proved the
 * *capacity* is there (~2.2 of 3 non-SPI cores idle for the whole of movy's
 * render window). Capacity is not throughput: splitting a 363 us render across
 * N threads only pays if waking those threads and joining them costs much less
 * than the 363 - 363/N it saves. Nothing in the frame-phase trace prices that.
 *
 * So this program measures the mechanism and NOTHING else. It touches no chain
 * state, links nothing from movy, and runs as a standalone binary. The work
 * each thread does is a synthetic float kernel calibrated to a wall-clock
 * target — a stand-in for a chain render, not a model of one.
 *
 * It runs its threads BELOW Move's audio threads (default main prio 69,
 * workers 68, against Move's 70) so it can never preempt the audio callback
 * and can never cause a dropout. The cost of that choice is that Move can
 * preempt *us*; every iteration is therefore tagged clean/preempted from the
 * thread's own involuntary-context-switch counter, and the two populations are
 * reported separately. The clean population is the mechanism's real cost; the
 * preempted one is an artifact of being a bystander rather than the audio
 * callback itself.
 *
 * Build (from movy root):
 *   aarch64-unknown-linux-gnu-gcc -O2 -std=gnu11 -pthread \
 *       -o dist/join-cost scripts/bench/join-cost.c
 */
#define _GNU_SOURCE
#include <errno.h>
#include <linux/futex.h>
#include <pthread.h>
#include <sched.h>
#include <stdatomic.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/mman.h>
#include <sys/resource.h>
#include <sys/syscall.h>
#include <time.h>
#include <unistd.h>

#define MAX_THREADS 8
#define WORK_FLOATS 256 /* 1 KB per thread: L1-resident, like a chain's block */
#define CACHELINE 64

/* ── config ─────────────────────────────────────────────────────────────── */
static struct {
    int nthreads;      /* total, including the main thread */
    int work_us;       /* total synthetic work per frame, split nthreads ways */
    int frames;        /* iterations to measure */
    int period_us;     /* frame cadence */
    int main_prio;     /* SCHED_FIFO priority of the main thread, 0 = none */
    int worker_prio;   /* SCHED_FIFO priority of the workers */
    int spin_us;       /* worker spins this long before sleeping; 0 = sleep now */
    int pure_spin;     /* workers never sleep (upper bound; burns cores) */
    int affinity;      /* pin thread i to core i */
} cfg = { .nthreads = 4, .work_us = 363, .frames = 3000, .period_us = 2901,
          .main_prio = 69, .worker_prio = 68, .spin_us = 0, .pure_spin = 0,
          .affinity = 0 };

/* Pinning is not a tuning knob here, it is a hypothesis under test: if the
 * scheduler parks a worker on the core the main thread already holds, that
 * worker cannot start until main finishes its own share, because main sits one
 * priority level above it. Pinning each thread to its own core removes that
 * possibility and the difference is the cost of leaving placement to chance. */
static int pin_to(int cpu) {
    cpu_set_t set;
    CPU_ZERO(&set);
    CPU_SET(cpu, &set);
    return pthread_setaffinity_np(pthread_self(), sizeof(set), &set);
}

/* ── primitives ─────────────────────────────────────────────────────────── */
static inline uint64_t now_ns(void) {
    struct timespec ts;
    clock_gettime(CLOCK_MONOTONIC, &ts);
    return (uint64_t)ts.tv_sec * 1000000000ull + (uint64_t)ts.tv_nsec;
}
static inline void cpu_relax(void) { __asm__ __volatile__("yield" ::: "memory"); }

static int futex_op(_Atomic uint32_t *addr, int op, uint32_t val) {
    return (int)syscall(SYS_futex, (uint32_t *)addr, op | FUTEX_PRIVATE_FLAG,
                        val, NULL, NULL, 0);
}

/* Involuntary switches only: a futex sleep is voluntary and does not count, so
 * a non-zero delta across a frame means something actually took the CPU away. */
static inline uint64_t nivcsw(void) {
    struct rusage ru;
    getrusage(RUSAGE_THREAD, &ru);
    return (uint64_t)ru.ru_nivcsw;
}

static int set_rt(int prio) {
    if (prio <= 0) return 0;
    struct sched_param sp = { .sched_priority = prio };
    return pthread_setschedparam(pthread_self(), SCHED_FIFO, &sp);
}

/* ── synthetic workload ─────────────────────────────────────────────────── */
/* Contracts toward 50, so it never reaches a denormal or an inf — either would
 * change the instruction timing and quietly invalidate the calibration. */
static float work_buf[MAX_THREADS][WORK_FLOATS] __attribute__((aligned(CACHELINE)));
static volatile float sink;

static void do_work(int id, long iters) {
    float *b = work_buf[id];
    for (long i = 0; i < iters; i++)
        for (int j = 0; j < WORK_FLOATS; j++) b[j] = b[j] * 0.99f + 0.5f;
    sink = b[0];
}

static long iters_for_us(int us) {
    if (us <= 0) return 0;
    for (int i = 0; i < WORK_FLOATS; i++) work_buf[0][i] = 1.0f;
    /* Take the MINIMUM of several timed passes, never a single sample. A lone
     * sample that happens to catch a preemption reads as "the machine is slow",
     * the batch is scaled down to compensate, and every later figure is quietly
     * measured against the wrong workload — which is exactly what happened
     * before this loop counted more than once. The floor is the honest number:
     * interference can only ever add time. */
    long probe = 200;
    long iters = 0;
    for (int pass = 0; pass < 2; pass++) {
        uint64_t best = UINT64_MAX;
        for (int trial = 0; trial < 5; trial++) {
            do_work(0, probe);
            uint64_t t0 = now_ns();
            do_work(0, probe);
            uint64_t dt = now_ns() - t0;
            if (dt > 0 && dt < best) best = dt;
        }
        if (best == UINT64_MAX) best = 1;
        iters = (long)((double)probe * (double)us * 1000.0 / (double)best);
        if (iters < 1) iters = 1;
        probe = iters;
    }
    return iters;
}

/* ── the pool ───────────────────────────────────────────────────────────── */
struct pool {
    _Atomic uint32_t gen;  /* bumped to release the workers */
    char _p0[CACHELINE - sizeof(_Atomic uint32_t)];
    _Atomic uint32_t done; /* workers count themselves out */
    char _p1[CACHELINE - sizeof(_Atomic uint32_t)];
    _Atomic uint64_t release_ns;      /* when main let them go */
    _Atomic uint64_t wstart[MAX_THREADS]; /* when each worker got the CPU */
    _Atomic uint64_t wend[MAX_THREADS];   /* when each finished its share */
    _Atomic int wcpu[MAX_THREADS];        /* which core it woke up on */
    _Atomic uint64_t wpreempt;            /* summed worker nivcsw over the frame */
    _Atomic int stop;
    long iters;
    int helpers;
};
static struct pool pool __attribute__((aligned(CACHELINE)));

static void *worker_main(void *arg) {
    const int id = (int)(intptr_t)arg;
    if (set_rt(cfg.worker_prio) != 0)
        fprintf(stderr, "warn: worker %d could not take FIFO %d\n", id, cfg.worker_prio);
    if (cfg.affinity && pin_to(id) != 0)
        fprintf(stderr, "warn: worker %d could not pin to core %d\n", id, id);

    uint32_t seen = 0;
    uint64_t nv_before = nivcsw();

    for (;;) {
        /* Optional bounded spin: cheap when the next frame is imminent, wasted
         * otherwise. At 344 Hz the gap between frames is ~2.5 ms, so any spin
         * budget short enough to be shippable expires long before the wake —
         * this exists to show that, not because it is expected to help. */
        if (cfg.spin_us > 0) {
            uint64_t t0 = now_ns();
            while (atomic_load_explicit(&pool.gen, memory_order_acquire) == seen &&
                   now_ns() - t0 < (uint64_t)cfg.spin_us * 1000ull)
                cpu_relax();
        }
        while (atomic_load_explicit(&pool.gen, memory_order_acquire) == seen) {
            if (cfg.pure_spin) cpu_relax();
            else futex_op(&pool.gen, FUTEX_WAIT, seen);
        }
        uint64_t t_start = now_ns();
        seen = atomic_load_explicit(&pool.gen, memory_order_acquire);
        if (atomic_load_explicit(&pool.stop, memory_order_acquire)) break;

        atomic_store_explicit(&pool.wstart[id], t_start, memory_order_relaxed);
        atomic_store_explicit(&pool.wcpu[id], sched_getcpu(), memory_order_relaxed);
        do_work(id, pool.iters);
        atomic_store_explicit(&pool.wend[id], now_ns(), memory_order_relaxed);
        atomic_fetch_add_explicit(&pool.done, 1, memory_order_acq_rel);

        /* After counting out, so this never lands inside main's join wait. */
        uint64_t nv = nivcsw();
        atomic_fetch_add_explicit(&pool.wpreempt, nv - nv_before, memory_order_relaxed);
        nv_before = nv;
    }
    return NULL;
}

/* ── stats ──────────────────────────────────────────────────────────────── */
static int cmp_u32(const void *a, const void *b) {
    uint32_t x = *(const uint32_t *)a, y = *(const uint32_t *)b;
    return (x > y) - (x < y);
}
static uint32_t pct(uint32_t *v, int n, double p) {
    if (n <= 0) return 0;
    long i = (long)(p * (n - 1) + 0.5);
    return v[i];
}
static void report(const char *label, uint32_t *v, int n, const char *note) {
    if (n <= 0) { printf("  %-22s        (no samples)\n", label); return; }
    qsort(v, n, sizeof(*v), cmp_u32);
    printf("  %-22s p50 %7.1f  p90 %7.1f  p99 %7.1f  max %7.1f   %s\n", label,
           pct(v, n, 0.50) / 1000.0, pct(v, n, 0.90) / 1000.0,
           pct(v, n, 0.99) / 1000.0, pct(v, n, 1.0) / 1000.0, note ? note : "");
}

/* ── main ───────────────────────────────────────────────────────────────── */
static void usage(void) {
    printf("usage: join-cost [--threads N] [--work-us U] [--frames F]\n"
           "                 [--period-us P] [--prio MAIN:WORKER] [--spin-us S]\n"
           "                 [--pure-spin]\n"
           "  --work-us 0   prices the bare mechanism with no workload at all\n");
}

int main(int argc, char **argv) {
    for (int i = 1; i < argc; i++) {
        const char *a = argv[i];
        const char *v = (i + 1 < argc) ? argv[i + 1] : NULL;
        if (!strcmp(a, "--threads") && v) cfg.nthreads = atoi(argv[++i]);
        else if (!strcmp(a, "--work-us") && v) cfg.work_us = atoi(argv[++i]);
        else if (!strcmp(a, "--frames") && v) cfg.frames = atoi(argv[++i]);
        else if (!strcmp(a, "--period-us") && v) cfg.period_us = atoi(argv[++i]);
        else if (!strcmp(a, "--spin-us") && v) cfg.spin_us = atoi(argv[++i]);
        else if (!strcmp(a, "--pure-spin")) cfg.pure_spin = 1;
        else if (!strcmp(a, "--affinity")) cfg.affinity = 1;
        else if (!strcmp(a, "--prio") && v) {
            sscanf(argv[++i], "%d:%d", &cfg.main_prio, &cfg.worker_prio);
        } else { usage(); return a[0] == '-' ? 2 : 0; }
    }
    if (cfg.nthreads < 1 || cfg.nthreads > MAX_THREADS) { usage(); return 2; }
    pool.helpers = cfg.nthreads - 1;

    /* Page faults inside a timed section would dominate everything else. */
    if (mlockall(MCL_CURRENT | MCL_FUTURE) != 0)
        fprintf(stderr, "warn: mlockall failed (%s)\n", strerror(errno));
    if (set_rt(cfg.main_prio) != 0)
        fprintf(stderr, "warn: main could not take FIFO %d (need root?)\n", cfg.main_prio);
    if (cfg.affinity && pin_to(0) != 0)
        fprintf(stderr, "warn: main could not pin to core 0\n");

    const long iters_total = iters_for_us(cfg.work_us);
    pool.iters = cfg.nthreads > 0 ? iters_total / cfg.nthreads : 0;
    const long share_us = cfg.nthreads ? cfg.work_us / cfg.nthreads : 0;

    printf("join-cost: %d threads (%d helpers), %d us work split %d ways "
           "(~%ld us each), %d frames @ %d us\n",
           cfg.nthreads, pool.helpers, cfg.work_us, cfg.nthreads, share_us,
           cfg.frames, cfg.period_us);
    printf("           wake = %s, main FIFO %d / workers FIFO %d\n",
           cfg.pure_spin ? "pure spin" : (cfg.spin_us ? "spin-then-futex" : "futex"),
           cfg.main_prio, cfg.worker_prio);

    pthread_t th[MAX_THREADS];
    for (int i = 1; i <= pool.helpers; i++)
        pthread_create(&th[i], NULL, worker_main, (void *)(intptr_t)i);
    /* Let the pool reach its wait state before the first release, so frame 0
     * is not measuring thread creation. */
    struct timespec settle = { 0, 200 * 1000 * 1000 };
    nanosleep(&settle, NULL);

    const int N = cfg.frames;
    uint32_t *par = malloc(sizeof(uint32_t) * N);   /* parallel section wall */
    uint32_t *ser = malloc(sizeof(uint32_t) * N);   /* same work, main only */
    uint32_t *fan = malloc(sizeof(uint32_t) * N);   /* release -> last worker on cpu */
    uint32_t *fan1 = malloc(sizeof(uint32_t) * N);  /* release -> FIRST worker on cpu */
    uint32_t *joi = malloc(sizeof(uint32_t) * N);   /* last worker done -> main sees it */
    uint32_t *clean = malloc(sizeof(uint32_t) * N); /* parallel wall, unpreempted only */
    int nclean = 0, npre = 0, ncollide = 0;
    const int main_cpu = sched_getcpu();

    uint64_t next = now_ns();

    /* Phase 1 — serial baseline. Main alone does the whole work_us, on the same
     * cadence, so cache and clock state match the parallel phase. */
    for (int f = 0; f < N; f++) {
        next += (uint64_t)cfg.period_us * 1000ull;
        struct timespec ts = { next / 1000000000ull, next % 1000000000ull };
        clock_nanosleep(CLOCK_MONOTONIC, TIMER_ABSTIME, &ts, NULL);
        uint64_t t0 = now_ns();
        do_work(0, iters_total);
        ser[f] = (uint32_t)(now_ns() - t0);
    }

    /* Phase 2 — fan out, do our own share, join. */
    for (int f = 0; f < N; f++) {
        next += (uint64_t)cfg.period_us * 1000ull;
        struct timespec ts = { next / 1000000000ull, next % 1000000000ull };
        clock_nanosleep(CLOCK_MONOTONIC, TIMER_ABSTIME, &ts, NULL);

        uint64_t nv0 = nivcsw();
        uint64_t wp0 = atomic_load_explicit(&pool.wpreempt, memory_order_relaxed);
        atomic_store_explicit(&pool.done, 0, memory_order_relaxed);

        uint64_t t0 = now_ns();
        atomic_store_explicit(&pool.release_ns, t0, memory_order_relaxed);
        atomic_fetch_add_explicit(&pool.gen, 1, memory_order_release);
        if (!cfg.pure_spin) futex_op(&pool.gen, FUTEX_WAKE, (uint32_t)pool.helpers);

        do_work(0, pool.iters);

        /* Main always spins on the join: it is inside the audio callback with
         * nothing else to do, and sleeping here would add a second wake to the
         * critical path. */
        while (atomic_load_explicit(&pool.done, memory_order_acquire) < (uint32_t)pool.helpers)
            cpu_relax();
        uint64_t t1 = now_ns();

        par[f] = (uint32_t)(t1 - t0);

        uint64_t last_start = t0, last_end = t0, first_start = UINT64_MAX;
        int seen_cpu = 1 << main_cpu, collided = 0;
        for (int i = 1; i <= pool.helpers; i++) {
            uint64_t s = atomic_load_explicit(&pool.wstart[i], memory_order_relaxed);
            uint64_t e = atomic_load_explicit(&pool.wend[i], memory_order_relaxed);
            if (s > last_start) last_start = s;
            if (s < first_start) first_start = s;
            if (e > last_end) last_end = e;
            int c = atomic_load_explicit(&pool.wcpu[i], memory_order_relaxed);
            if (c >= 0 && c < 32) {
                if (seen_cpu & (1 << c)) collided = 1;
                seen_cpu |= 1 << c;
            }
        }
        if (first_start == UINT64_MAX) first_start = t0;
        fan[f] = (uint32_t)(last_start - t0);
        fan1[f] = (uint32_t)(first_start - t0);
        ncollide += collided;
        joi[f] = (uint32_t)(t1 > last_end ? t1 - last_end : 0);

        uint64_t nv1 = nivcsw();
        uint64_t wp1 = atomic_load_explicit(&pool.wpreempt, memory_order_relaxed);
        if (nv1 == nv0 && wp1 == wp0) clean[nclean++] = par[f];
        else npre++;
    }

    atomic_store_explicit(&pool.stop, 1, memory_order_release);
    atomic_fetch_add_explicit(&pool.gen, 1, memory_order_release);
    futex_op(&pool.gen, FUTEX_WAKE, (uint32_t)pool.helpers);
    for (int i = 1; i <= pool.helpers; i++) pthread_join(th[i], NULL);

    printf("\n  (all figures microseconds)\n");
    report("serial baseline", ser, N, "whole workload on one thread");
    report("parallel wall", par, N, "release -> join, all frames");
    report("parallel wall CLEAN", clean, nclean, "frames with zero preemption");
    report("fan-out FIRST worker", fan1, N, "release -> first worker on cpu");
    report("fan-out LAST worker", fan, N, "release -> LAST worker on cpu");
    report("join latency", joi, N, "last worker done -> main sees it");

    qsort(ser, N, sizeof(*ser), cmp_u32);
    qsort(clean, nclean, sizeof(*clean), cmp_u32);
    double s50 = pct(ser, N, 0.50) / 1000.0;
    double c50 = nclean ? pct(clean, nclean, 0.50) / 1000.0 : 0;
    double c99 = nclean ? pct(clean, nclean, 0.99) / 1000.0 : 0;
    /* Against the workload actually delivered, not the one requested: if
     * calibration lands off target the requested figure silently lies. */
    double ideal = s50 / cfg.nthreads;
    printf("\n  clean frames    %d / %d  (%d preempted by something above us)\n",
           nclean, N, npre);
    printf("  core collisions %d / %d  (two of our threads woke on the same core)\n",
           ncollide, N);
    printf("  workload        %.1f us measured serial (%d us requested)\n", s50, cfg.work_us);
    if (nclean && c50 > 0) {
        printf("  speedup         %.2fx at p50  (%.1f -> %.1f us)\n", s50 / c50, s50, c50);
        printf("  overhead        %.1f us at p50, %.1f us at p99  "
               "(wall minus the %.1f us ideal share)\n",
               c50 - ideal, c99 - ideal, ideal);
    }
    (void)share_us;
    free(par); free(ser); free(fan); free(joi); free(clean);
    return 0;
}
