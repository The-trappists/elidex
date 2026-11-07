"""MongoDB Atlas as a store of the context layer: assertions and classes, plus vector search over their text.

`ContextStore` stays the in-memory graph the pipeline works on; this module saves it to Atlas (collections
`assertions` and `classes`) and loads it back, so the knowledge outlives the process and can be searched by meaning.
The vector index is an Atlas Search index of type `vectorSearch` on the field `embedding`.
"""

from __future__ import annotations

from collections.abc import Callable

from . import embed
from .link import Inventory
from .models import ContextAssertion, ElementClass
from .store import ContextStore

# How to read the text of a document of each collection that can be embedded.
TEXT_OF: dict[str, Callable[[dict], str]] = {
    "assertions": lambda d: " ".join(filter(None, [d.get("summary"), d.get("diagnosis"), d.get("action"), d.get("fact")])),
    "facts": lambda d: " ".join(filter(None, [d["item"].get("summary"), d["item"].get("diagnosis"), d["item"].get("action"), d["item"].get("fact")])),
}


# ---------------------------------------------------------------- assertions and classes


def save_store(store: ContextStore, db) -> dict[str, int]:
    """Replace `assertions` and `classes` with the content of the store (embeddings are dropped: re-run `embed`)."""
    db["classes"].delete_many({})
    db["assertions"].delete_many({})
    classes = [{"_id": c.id, **c.model_dump(mode="json")} for c in store.classes.values()]
    assertions = [{"_id": a.id, **a.model_dump(mode="json")} for a in store.assertions.values()]
    for name, docs in (("classes", classes), ("assertions", assertions)):
        for i in range(0, len(docs), 1000):
            db[name].insert_many(docs[i : i + 1000])
    return {"classes": len(classes), "assertions": len(assertions)}


def load_store(inventory: Inventory, db) -> ContextStore:
    """Rebuild the in-memory store from Atlas."""
    store = ContextStore(inventory)
    for d in db["classes"].find({}):
        d.pop("_id", None)
        store.add_class(ElementClass.model_validate(d))
    for d in db["assertions"].find({}):
        d.pop("_id", None)
        d.pop("embedding", None)
        store._index(ContextAssertion.model_validate(d))
    return store


# ---------------------------------------------------------------- vector search


def vector_index_name(collection: str) -> str:
    return f"{collection}_vector"


def vector_index_definition(dim: int) -> dict:
    return {"fields": [{"type": "vector", "path": "embedding", "numDimensions": dim, "similarity": "cosine"}]}


def vector_pipeline(collection: str, query_vector: list[float], k: int, num_candidates: int | None = None) -> list[dict]:
    """The aggregation that returns the k nearest documents, with their score and without the vectors."""
    return [
        {"$vectorSearch": {"index": vector_index_name(collection), "path": "embedding", "queryVector": query_vector,
                           "numCandidates": num_candidates or max(10 * k, 100), "limit": k}},
        {"$addFields": {"score": {"$meta": "vectorSearchScore"}}},
        {"$project": {"embedding": 0}},
    ]


def embed_collection(db, collection: str, batch: int = 64, log=print) -> dict:
    """Embed every document of `collection` that has no vector yet, then make sure the vector index exists."""
    from pymongo import UpdateOne
    from pymongo.operations import SearchIndexModel

    text_of = TEXT_OF[collection]
    meta = db["meta"].find_one({"_id": f"embedding:{collection}"})
    if meta and meta["mode"] != embed.mode():
        raise SystemExit(f"'{collection}' was embedded with {meta['mode']}, the current mode is {embed.mode()}. Drop the field first or set EMBEDDING_MODEL back.")
    todo = db[collection].find({"embedding": {"$exists": False}}, projection=None)
    n, dim, pending = 0, None, []

    def flush() -> None:
        nonlocal n, dim, pending
        if not pending:
            return
        vectors = embed.embed([text_of(d) for d in pending])
        dim = len(vectors[0])
        db[collection].bulk_write([UpdateOne({"_id": d["_id"]}, {"$set": {"embedding": v}}) for d, v in zip(pending, vectors)])
        n += len(pending)
        log(f"  {collection}: {n:,} embedded")
        pending = []

    for d in todo:
        pending.append(d)
        if len(pending) >= batch:
            flush()
    flush()
    dim = dim or (meta or {}).get("dim")
    if dim is None:
        return {"embedded": 0, "mode": embed.mode(), "dim": None, "index": "nothing to embed"}
    db["meta"].replace_one({"_id": f"embedding:{collection}"}, {"_id": f"embedding:{collection}", "mode": embed.mode(), "dim": dim}, upsert=True)
    name = vector_index_name(collection)
    if not any(i["name"] == name for i in db[collection].list_search_indexes()):
        db[collection].create_search_index(SearchIndexModel(definition=vector_index_definition(dim), name=name, type="vectorSearch"))
        index = "created (Atlas builds it in the background, a few minutes)"
    else:
        index = "already exists"
    return {"embedded": n, "mode": embed.mode(), "dim": dim, "index": index}


def similar(db, collection: str, query: str, k: int = 5) -> list[dict]:
    """The k documents whose text is nearest to `query`, best first, with a `score` between 0 and 1."""
    meta = db["meta"].find_one({"_id": f"embedding:{collection}"})
    if not meta:
        raise SystemExit(f"Nothing embedded in '{collection}' yet: run `ctx dataset embed --collection {collection}`.")
    if meta["mode"] != embed.mode():
        raise SystemExit(f"'{collection}' uses {meta['mode']} but the current mode is {embed.mode()}: use the same EMBEDDING_MODEL as when embedding.")
    vector = embed.embed([query])[0]
    return list(db[collection].aggregate(vector_pipeline(collection, vector, k)))
