"""`ctx demo` runs the deterministic walkthrough offline (no key, no network)."""

from context_layer import cli


def test_demo_shows_captured_context_and_guard(capsys):
    cli.main(["demo"])
    out = capsys.readouterr().out
    assert "ctx_0002" in out  # the TRN-042 workaround, confirmed by the email
    assert "via TRN-042" in out
    assert "via class:transmission_node:installed-upto-2019" in out  # the same rule reaches TRN-117
    assert "ctx_0003" in out  # firmware 4.2 closes it later
    assert "Guard: ADAPT" in out
    assert "Only if that fails: Reboot TRN-117" in out
