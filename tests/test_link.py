"""Site resolution in the linker and the extractor prompt rules, offline."""

import pytest

from context_layer.models import Site
from context_layer.understand import LLMExtractor
from context_layer.link import Inventory
from context_layer.workbench.seed import load_seed

SITES = Inventory([], load_seed().sites)


@pytest.mark.parametrize(
    "raw, expected",
    [
        ("SITE-NF-017", "SITE-NF-017"),  # exact id
        ("NF-017", "SITE-NF-017"),  # id without the prefix
        ("nf 017", "SITE-NF-017"),
        ("Kemijärvi hill mast", "SITE-NF-017"),  # exact name
        ("Kemijärvi hill", "SITE-NF-017"),  # unique name fragment
        ("Sodankylä", "SITE-NF-021"),
        ("Turku harbour hut", "SITE-TKU-009"),
        ("Turku", None),  # fits two sites: not bound
        ("hill", None),  # too short
        ("017", None),  # too short
        ("", None),
        ("Atlantis", None),
    ],
)
def test_resolve_site(raw, expected):
    site = SITES.resolve_site(raw)
    assert (site.id if site else None) == expected


def test_a_name_fragment_must_fit_exactly_one_site():
    inv = Inventory([], [Site(id="SITE-A-001", name="Oulu north exchange"), Site(id="SITE-A-002", name="Oulu south exchange")])
    assert inv.resolve_site("Oulu north") is not None
    assert inv.resolve_site("Oulu exchange") is None


def test_extractor_prompt_has_the_topic_and_disagreement_rules():
    system = LLMExtractor(cache_path=None).system
    assert "different advice for the same problem" in system
    assert "each person's position as its own item" in system
    assert "do not shorten an ID" in system
