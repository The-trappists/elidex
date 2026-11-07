"""Assertions in Atlas, embeddings and the new API endpoints, offline (fake database, no credentials used)."""

import copy

import pytest
from fastapi.testclient import TestClient

from context_layer import api, config, embed, mongo_store
from context_layer.link import Inventory
from context_layer.pipeline import build_store


class FakeCol:
    def __init__(self):
        self.docs: list[dict] = []
        self.search_indexes: list[dict] = []

    def list_search_indexes(self):
        return list(self.search_indexes)

    def delete_many(self, _filter):
        self.docs = []

    def insert_many(self, docs):
        self.docs += copy.deepcopy(docs)

    def find(self, _filter=None):
        return [copy.deepcopy(d) for d in self.docs]

    def find_one(self, flt):
        return next((copy.deepcopy(d) for d in self.docs if all(d.get(k) == v for k, v in flt.items())), None)


class FakeDb(dict):
    def __missing__(self, name):
        self[name] = FakeCol()
        return self[name]


@pytest.fixture(scope="module")
def core():
    return build_store(lifecycle=True)[0]


def test_hash_embedding_is_deterministic_normalised_and_wording_sensitive():
    a = embed.hash_embed("port stays down after the optical module swap")
    assert a == embed.hash_embed("port stays down after the optical module swap")
    assert len(a) == embed.HASH_DIM and abs(sum(x * x for x in a) - 1) < 1e-9
    close = embed.hash_embed("the port is down after swapping the optical module")
    far = embed.hash_embed("close the reindeer gate behind you")
    dot = lambda u, v: sum(x * y for x, y in zip(u, v))  # noqa: E731
    assert dot(a, close) > dot(a, far)


def test_store_roundtrip_through_the_database_keeps_assertions_and_classes(core):
    db = FakeDb()
    saved = mongo_store.save_store(core, db)
    assert saved == {"classes": len(core.classes), "assertions": len(core.assertions)}
    back = mongo_store.load_store(Inventory.load(), db)
    assert set(back.assertions) == set(core.assertions) and set(back.classes) == set(core.classes)
    a = next(iter(core.assertions.values()))
    b = back.assertions[a.id]
    assert (b.topic, b.summary, b.valid_from, b.valid_to, b.trust.level) == (a.topic, a.summary, a.valid_from, a.valid_to, a.trust.level)
    assert [h.assertion.id for h in back.get_context("TRN-117", at=a.valid_from)] == [h.assertion.id for h in core.get_context("TRN-117", at=a.valid_from)]


def test_saving_twice_replaces_instead_of_duplicating(core):
    db = FakeDb()
    mongo_store.save_store(core, db)
    mongo_store.save_store(core, db)
    assert len(db["assertions"].docs) == len(core.assertions)


def test_vector_pipeline_asks_atlas_for_the_nearest_without_the_vectors():
    stages = mongo_store.vector_pipeline("facts", [0.1, 0.2], k=3)
    vs = stages[0]["$vectorSearch"]
    assert vs["index"] == "facts_vector" and vs["path"] == "embedding" and vs["limit"] == 3 and vs["numCandidates"] >= 30
    assert stages[-1] == {"$project": {"embedding": 0}}
    assert mongo_store.vector_index_definition(768)["fields"][0] == {"type": "vector", "path": "embedding", "numDimensions": 768, "similarity": "cosine"}


def test_similar_refuses_when_nothing_is_embedded_or_the_mode_changed():
    db = FakeDb()
    with pytest.raises(SystemExit, match="embed"):
        mongo_store.similar(db, "facts", "anything")
    db["meta"].insert_many([{"_id": "embedding:facts", "mode": "model:other", "dim": 3}])
    with pytest.raises(SystemExit, match="current mode"):
        mongo_store.similar(db, "facts", "anything")


def test_similar_explains_when_the_vector_index_is_missing_or_still_building():
    db = FakeDb()
    db["meta"].insert_many([{"_id": "embedding:facts", "mode": embed.mode(), "dim": embed.HASH_DIM}])
    with pytest.raises(SystemExit, match="No vector index"):
        mongo_store.similar(db, "facts", "anything")
    db["facts"].search_indexes = [{"name": "facts_vector", "status": "BUILDING", "queryable": False}]
    with pytest.raises(SystemExit, match="not ready yet.*BUILDING"):
        mongo_store.similar(db, "facts", "anything")
    assert mongo_store.index_status(db, "facts")["status"] == "BUILDING"


def test_text_of_reads_assertions_and_ground_truth_facts():
    assert mongo_store.TEXT_OF["assertions"]({"summary": "S", "action": "A", "diagnosis": None}) == "S A"
    assert mongo_store.TEXT_OF["facts"]({"item": {"summary": "S", "action": "A"}}) == "S A"


def test_endpoints_answer_503_when_the_databases_are_not_configured(monkeypatch):
    monkeypatch.setattr(config, "tiger_configured", lambda: False)
    monkeypatch.setattr(config, "mongo_configured", lambda: False)
    client = TestClient(api.app)
    assert client.get("/freshness/TRN-042").status_code == 503
    assert client.get("/similar", params={"q": "port down"}).status_code == 503
    monkeypatch.setattr(config, "mongo_configured", lambda: True)
    assert client.get("/similar", params={"q": "x", "collection": "users"}).status_code == 422
