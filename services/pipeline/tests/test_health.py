"""Placeholder so CI has something real to run at W1 (task 1.6).

The tests that matter start at W4 - 4c.3 (all-fail produces status='empty'),
4c.5 (kill Qdrant mid-run, no topic ends without a vector) and 4c.7 (reindex).
"""

from app.main import VERSION


def test_version_is_semver():
    parts = VERSION.split(".")
    assert len(parts) == 3
    assert all(p.isdigit() for p in parts)
