"""Loading a second dataset into a database that holds another one must be refused unless --drop (offline)."""

import pytest

from context_layer.dataset.mongo import check_same_dataset, dataset_id


def test_dataset_id_tells_scales_apart():
    a = dataset_id({"scale": "demo", "seed": 42, "spec": {"threads": 150000}})
    b = dataset_id({"scale": "large", "seed": 42, "spec": {"threads": 3000000}})
    assert a != b


def test_same_dataset_or_empty_database_is_fine():
    check_same_dataset(None, "large-seed42-3000000t", drop=False)
    check_same_dataset({"id": "large-seed42-3000000t"}, "large-seed42-3000000t", drop=False)


def test_another_dataset_is_refused_unless_drop():
    with pytest.raises(SystemExit, match="--drop"):
        check_same_dataset({"id": "demo-seed42-150000t"}, "large-seed42-3000000t", drop=False)
    check_same_dataset({"id": "demo-seed42-150000t"}, "large-seed42-3000000t", drop=True)
