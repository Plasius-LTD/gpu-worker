# ADR-0009: Drain-Until-Empty Worker Invocations

## Status

Accepted

## Context

`@plasius/gpu-worker` exists to keep discrete GPU jobs moving through shared
queue contracts without each package rebuilding its own scheduling layer.
The previous default worker WGSL shape dequeued at most one job per invocation.
That was simple, but it leaves throughput on the table for queues that already
contain more runnable work.

For workloads such as wavefront rendering, fluids, cloth, and lighting refresh,
the desired behavior is straightforward:

- launch enough invocations to occupy the GPU,
- let each invocation dequeue work immediately when it finishes,
- avoid host-side waits or per-job synchronisation while runnable work remains.

That behavior should be the default in the shared worker runtime, not a
package-local workaround.

## Decision

The published worker WGSL entry point will use drain-until-empty semantics by
default.

Each worker invocation now:

1. attempts to dequeue a job,
2. executes `process_job(...)`,
3. calls `complete_job(...)`,
4. immediately loops back to dequeue the next runnable job,
5. exits only when the queue reports no immediately runnable work.

The WGSL also exposes an override constant:

- `WORKER_MAX_JOBS_PER_INVOCATION: u32 = 0u`

The default `0u` means "no worker-local cap; drain until empty". Callers may
set a positive pipeline constant when they need to bound per-invocation work
for fairness, watchdog, or latency reasons.

## Consequences

- Positive: queue-backed workloads can keep workers busy without host-side
  fences between individual jobs.
- Positive: longer-running or dependency-heavy jobs naturally hold execution
  resources longer, while shorter jobs let the same invocation pick up more
  work immediately.
- Positive: DAG-ready queues benefit as newly unlocked dependents can be
  consumed by invocations that are already active.
- Neutral: packages that need stricter fairness can still opt into a bounded
  per-invocation job limit through the override constant.

## Rejected Alternatives

- Keep one-job-per-invocation semantics and let callers dispatch more often:
  rejected because it pushes unnecessary synchronisation and cadence policy
  back to the host.
- Add package-local drain loops in every consumer package:
  rejected because `@plasius/gpu-worker` is the shared execution plane and
  should own this behavior once.
