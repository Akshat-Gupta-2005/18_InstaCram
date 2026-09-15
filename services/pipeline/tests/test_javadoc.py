"""Javadoc URL construction, with the indexes injected so no network is needed.

The bug these guard against was a SOFT 404: the module-less URL
/java/util/HashMap.html returns HTTP 200 and serves the JDK documentation home
page. It was accepted as working because only the status code was checked. See
Docs/DECISIONS.md P26.
"""

from __future__ import annotations

import pytest

from app.sources.javadoc import BASE, JavadocSource

CLASSES = {
    "hashmap": ["java.util"],
    "concurrentskiplistmap": ["java.util.concurrent"],
    "list": ["java.util", "java.awt"],
    "orphan": ["com.example.nomodule"],
}
MODULES = {
    "java.util": "java.base",
    "java.util.concurrent": "java.base",
    "java.awt": "java.desktop",
}


def make() -> JavadocSource:
    return JavadocSource(client=None, classes=CLASSES, modules=MODULES)  # type: ignore[arg-type]


def test_url_includes_the_module_segment() -> None:
    assert (
        make().url_for("java.util.HashMap")
        == f"{BASE}/java.base/java/util/HashMap.html"
    )


def test_url_never_omits_the_module() -> None:
    """The soft-404 regression. A module-less URL answers 200 with the JDK home
    page, so building one is worse than building none."""
    url = make().url_for("java.util.HashMap")
    assert url is not None
    assert f"{BASE}/java/util/" not in url
    assert "/java.base/" in url


def test_nested_package_maps_to_a_path() -> None:
    assert (
        make().url_for("java.util.concurrent.ConcurrentSkipListMap")
        == f"{BASE}/java.base/java/util/concurrent/ConcurrentSkipListMap.html"
    )


def test_unknown_module_yields_no_url_rather_than_a_guess() -> None:
    assert make().url_for("com.example.nomodule.Orphan") is None


@pytest.mark.asyncio
async def test_candidates_are_exact_so_siblings_cannot_appear() -> None:
    """P27's trap cannot arise here: lookup is by exact class name, so asking for
    HashMap never surfaces LinkedHashMap."""
    found = await make().candidates("HashMap", "Java Collections")
    assert found == ["java.util.HashMap"]


@pytest.mark.asyncio
async def test_ambiguous_class_prefers_the_package_matching_the_field() -> None:
    """'List' exists in java.util and java.awt. Under a Java Collections field the
    collections one must come first."""
    found = await make().candidates("List", "Java Collections")
    assert found[0] == "java.util.List"
    assert "java.awt.List" in found


@pytest.mark.asyncio
async def test_packages_without_a_known_module_are_dropped() -> None:
    assert await make().candidates("Orphan", "Anything") == []


@pytest.mark.asyncio
async def test_unknown_class_returns_nothing() -> None:
    assert await make().candidates("NotAJavaClass", "Java Collections") == []
