"""Shared fixtures. Nothing here reads a .env file or reaches the network."""

import pytest

from context_layer.dataset.build import generate


@pytest.fixture(scope="session")
def tiny_dataset(tmp_path_factory):
    """A real `tiny` dataset (60 sites, 2,000 threads, about 2 s) generated once for the whole session."""
    root = tmp_path_factory.mktemp("company") / "tiny"
    generate(root, "tiny", seed=7, workers=2, log=lambda *_: None)
    return root
