"""`tiger.verify` reports every failed check instead of stopping at the first one (offline, broken connection)."""

from context_layer.dataset import tiger
from context_layer.dataset.build import SCALES


class BrokenCursor:
    def __enter__(self):
        return self

    def __exit__(self, *exc):
        pass

    def execute(self, *args):
        raise RuntimeError("relation does not exist")


class BrokenConn:
    def __init__(self):
        self.rollbacks = 0

    def cursor(self):
        return BrokenCursor()

    def rollback(self):
        self.rollbacks += 1


def test_every_check_reports_a_failure_without_raising():
    conn = BrokenConn()
    checks = tiger.verify(conn, expected_messages=10)
    assert len(checks) >= 10
    assert all(status == "FAIL" for status, _, _ in checks)
    assert all("RuntimeError" in detail for _, _, detail in checks)
    assert conn.rollbacks == len(checks)


def test_xl_scale_is_gone():
    assert set(SCALES) == {"tiny", "demo", "large"}
