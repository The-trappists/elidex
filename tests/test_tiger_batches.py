"""The Tiger Data loader reads in batches and never commits inside a COPY (offline, no database)."""

from context_layer.dataset import tiger


def test_chunks_are_lazy_and_complete():
    assert list(tiger.chunks(iter(range(7)), 3)) == [[0, 1, 2], [3, 4, 5], [6]]
    assert list(tiger.chunks([], 3)) == []


class FakeCopy:
    def __init__(self, log):
        self.log = log

    def __enter__(self):
        self.log.append("copy-start")
        return self

    def __exit__(self, *exc):
        self.log.append("copy-end")

    def write_row(self, row):
        self.log.append("row")


class FakeCursor:
    def __init__(self, log):
        self.log = log

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        pass

    def copy(self, sql):
        return FakeCopy(self.log)


class FakeConn:
    def __init__(self):
        self.log = []

    def cursor(self):
        return FakeCursor(self.log)

    def commit(self):
        self.log.append("commit")


def test_load_commits_only_between_copies(tmp_path):
    from context_layer.dataset.build import generate

    root = tmp_path / "ds"
    generate(root, "tiny", seed=5, workers=1, log=lambda *_: None)
    conn = FakeConn()
    tiger.load(root, conn, log=lambda *_: None, batch_threads=300)
    open_copy = False
    for event in conn.log:
        if event == "copy-start":
            open_copy = True
        elif event == "copy-end":
            open_copy = False
        elif event == "commit":
            assert not open_copy, "commit inside a COPY would hang the connection"
    assert conn.log.count("commit") >= 2 and conn.log.count("row") > 0
