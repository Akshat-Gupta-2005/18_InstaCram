"""Prometheus counters for the pipeline (task 4c.8).

These duplicate `topic_generation_stats` on purpose, and the duplication is the
point: the Postgres counters are the durable per-topic record used to answer "is
this specific topic failing?", while these are the time-series used to answer "is
the rejection rate drifting?" - which the per-topic rows cannot show, because
they carry a single `run_at` rather than a history.

WHY THE REJECTION RATE MATTERS ENOUGH TO MEASURE TWICE: an over-strict
fact-checker and a weak card generator produce the IDENTICAL number. The counter
says how often; only the quarantined text says which (P10). A rate that climbs
over months is the signal that the checker has drifted, and it is invisible
without a series.

THE OUTCOME LABEL IS THE OTHER HALF. "No cards" has three causes that need
opposite responses - no source, everything rejected, or a broken checker - so
they are separate label values rather than one failure count. Collapsing them is
exactly how a broken gate gets read as a bad generator.
"""

from __future__ import annotations

from prometheus_client import CollectorRegistry, Counter, Histogram, generate_latest

# A dedicated registry rather than the global default, so importing this module
# never has side effects on someone else's collectors and tests can assert on a
# clean instance.
REGISTRY = CollectorRegistry()

drafts_generated = Counter(
    "instacram_drafts_generated_total",
    "Card drafts produced by the card generator",
    registry=REGISTRY,
)
drafts_passed = Counter(
    "instacram_drafts_passed_total",
    "Drafts that cleared the fact-check gate and were persisted",
    registry=REGISTRY,
)
drafts_failed = Counter(
    "instacram_drafts_failed_total",
    "Drafts the fact-checker rejected. NOT incremented when the checker itself "
    "errored - that is checker_errors, and conflating them blames the generator",
    registry=REGISTRY,
)
checker_errors = Counter(
    "instacram_checker_errors_total",
    "Times the fact-checker returned something unusable. A broken gate, not a bad card",
    registry=REGISTRY,
)
topics_completed = Counter(
    "instacram_topics_completed_total",
    "Pipeline runs by outcome",
    labelnames=("outcome",),
    registry=REGISTRY,
)
topic_duration = Histogram(
    "instacram_topic_duration_seconds",
    "Wall-clock for one topic, end to end",
    # Bucketed for a LOCAL model: a warm run is ~120s and a cold model load adds
    # ~160s, so the default buckets (which top out at 10s) would put every single
    # run in +Inf and measure nothing.
    buckets=(30, 60, 90, 120, 180, 240, 360, 600),
    registry=REGISTRY,
)
outbox_written = Counter(
    "instacram_outbox_written_total",
    "Vectors successfully drained from the outbox",
    registry=REGISTRY,
)
outbox_retried = Counter(
    "instacram_outbox_retried_total",
    "Outbox rows that failed and were rescheduled",
    registry=REGISTRY,
)
outbox_dead_lettered = Counter(
    "instacram_outbox_dead_lettered_total",
    "Outbox rows that exhausted their retries. Non-zero means reconciliation is "
    "now carrying work the fast path gave up on - worth an alert, not a panic",
    registry=REGISTRY,
)
outbox_reaped = Counter(
    "instacram_outbox_reaped_total",
    "Rows returned to the queue after a worker died mid-row",
    registry=REGISTRY,
)


def render() -> tuple[bytes, str]:
    """The metrics payload and its content type, for the /metrics endpoint."""
    from prometheus_client import CONTENT_TYPE_LATEST

    return generate_latest(REGISTRY), CONTENT_TYPE_LATEST
