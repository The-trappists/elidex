"""Site resolution in the linker and the extractor prompt rules, offline."""

import pytest

from context_layer.models import Site
from context_layer.understand import LLMExtractor
from context_layer.link import Inventory
from context_layer.dashboard.seed import load_seed

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


# ---------------------------------------------------------------- site role (over-linking found on the deployed ctx_0001)

from datetime import datetime  # noqa: E402

from context_layer.link import Linker  # noqa: E402
from context_layer.models import ClassCriteria, ExtractedItem, Message, Scope, Thread  # noqa: E402
from context_layer.store import ContextStore  # noqa: E402

SEED = load_seed()
INVENTORY = Inventory(SEED.elements, SEED.sites)
THREAD = Thread(
    id="live/test",
    source="teams",
    messages=[Message(thread_id="live/test", source="teams", seq=1, author="Erkki Expert", sent_at=datetime(2026, 10, 20, 7, 30),
                      text="TRN-088 at Kangas: bounce it, on the old TX-3000s that's step one.")],
)


def _item(scope: Scope, topic: str = "bounce-first") -> ExtractedItem:
    return ExtractedItem(type="workaround", topic=topic, summary="Bounce the interface first", scope=scope, action="bounce",
                         trust_level="stated", stated_by="Erkki Expert", cited_seq=[1], confidence=0.9)


def _roles(scope: Scope) -> dict[str, str]:
    a = Linker(INVENTORY).link(_item(scope), THREAD).assertion
    return {b.entity: b.role for b in a.bound_to}


def test_seed_has_the_case():
    # TRN-088 (TX-3000) and TRN-240 (TX-5000) share SITE-JKL-006 "Jyväskylä Kangas exchange".
    assert INVENTORY.elements["TRN-088"].site_id == INVENTORY.elements["TRN-240"].site_id == "SITE-JKL-006"


def test_site_is_where_it_was_seen_when_an_element_or_class_scopes_the_advice():
    roles = _roles(Scope(instance_ids=["TRN-088"], site_ids=["Kangas"]))
    assert roles == {"TRN-088": "applies_to", "SITE-JKL-006": "observed_on"}
    roles = _roles(Scope(instance_ids=["TRN-088"], site_ids=["Kangas"], element_class=ClassCriteria(model="TX-3000")))
    assert roles["SITE-JKL-006"] == "observed_on" and roles["TRN-088"] == "observed_on"


def test_site_alone_is_still_the_scope():
    # Site access knowledge (the barrier key) has nothing narrower: the site carries the scope.
    assert _roles(Scope(site_ids=["Kangas"])) == {"SITE-JKL-006": "applies_to"}


def test_neighbour_on_the_same_site_does_not_get_the_advice():
    store = ContextStore(INVENTORY)
    res = Linker(INVENTORY).link(_item(Scope(instance_ids=["TRN-088"], site_ids=["Kangas"])), THREAD)
    store.add_assertion(res.assertion)
    at = datetime(2026, 10, 21)
    assert [h.assertion.topic for h in store.get_context("TRN-088", at)] == ["bounce-first"]
    assert store.get_context("TRN-240", at) == []  # TX-5000 next door: not reached
    assert [h.assertion.topic for h in store.get_context("SITE-JKL-006", at)] == ["bounce-first"]  # seen there
