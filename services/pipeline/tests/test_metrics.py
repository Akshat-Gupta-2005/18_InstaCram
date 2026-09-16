"""Metrics, and the one distinction they exist to preserve.

The counters duplicate `topic_generation_stats` deliberately: Postgres answers
"is this topic failing?", Prometheus answers "is the rejection rate drifting?" -
which per-topic rows cannot show, because they carry one `run_at` rather than a
history.
"""

from __future__ import annotations

from app import metrics


def value(counter, **labels) -> float:
    # Reaching into _name because prometheus_client exposes no per-sample getter
    # on the counter itself; the registry lookup below needs the metric's name.
    name = counter._name
    return metrics.REGISTRY.get_sample_value(f"{name}_total", labels or None) or 0.0


def test_the_endpoint_renders_prometheus_text() -> None:
    payload, content_type = metrics.render()
    assert b"instacram_drafts_generated_total" in payload
    assert "text/plain" in content_type


def test_every_counter_is_registered() -> None:
    payload, _ = metrics.render()
    for name in (
        "instacram_drafts_generated",
        "instacram_drafts_passed",
        "instacram_drafts_failed",
        "instacram_checker_errors",
        "instacram_topics_completed",
        "instacram_outbox_written",
        "instacram_outbox_retried",
        "instacram_outbox_dead_lettered",
        "instacram_outbox_reaped",
    ):
        assert name.encode() in payload, f"{name} is not exposed"


def test_rejections_and_checker_errors_are_separate_counters() -> None:
    """The distinction that decides who gets blamed.

    A rejected draft means the generator produced something wrong. A checker
    error means the GATE is broken. Summed into one number they are
    indistinguishable, and they need opposite responses (P10, P29).
    """
    before_failed = value(metrics.drafts_failed)
    before_errors = value(metrics.checker_errors)

    metrics.drafts_failed.inc(3)
    metrics.checker_errors.inc(2)

    assert value(metrics.drafts_failed) == before_failed + 3
    assert value(metrics.checker_errors) == before_errors + 2


def test_outcomes_are_labelled_not_collapsed() -> None:
    """'No cards' has three causes needing different responses, so each is its
    own label value rather than one failure count."""
    for outcome in ("ready", "unsourced", "empty", "degraded"):
        metrics.topics_completed.labels(outcome=outcome).inc()

    payload, _ = metrics.render()
    for outcome in ("ready", "unsourced", "empty", "degraded"):
        assert f'outcome="{outcome}"'.encode() in payload


def test_duration_buckets_suit_a_local_model() -> None:
    """A warm run is ~120s. Prometheus' default buckets top out at 10s, which
    would file every single run in +Inf and measure nothing at all."""
    payload, _ = metrics.render()
    assert b'le="120.0"' in payload
    assert b'le="600.0"' in payload
