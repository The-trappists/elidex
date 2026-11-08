"""Build a preprocessed public-demo snapshot without credentials or network calls."""

from __future__ import annotations

import argparse
import asyncio
import json
import os
from pathlib import Path
import tempfile

# This must precede importing context_layer.config.
os.environ["PYTHON_DOTENV_DISABLED"] = "1"

from context_layer import config  # noqa: E402
from context_layer.dashboard.persistence import state_to_dict  # noqa: E402
from context_layer.dashboard.state import Dashboard  # noqa: E402
from context_layer.dataset.build import generate  # noqa: E402
from context_layer.dataset.dashboard_export import export_dashboard  # noqa: E402
from context_layer.demo_policy import DemoPolicy, bind_policy  # noqa: E402


async def build(dataset: Path, output: Path) -> None:
    # No configured provider is required to generate or process scripted data.
    for name in vars(config):
        if name.startswith(("LLM_", "SLACK_")) and isinstance(getattr(config, name), str):
            setattr(config, name, "")
    for name in ("GOOGLE_APPLICATION_CREDENTIALS", "EMBEDDING_MODEL", "MONGODB_URI", "TIGER_DATABASE_URL"):
        setattr(config, name, "")
    data = export_dashboard(dataset, n_sites=40, n_threads=300, seed=42)
    data.setdefault("settings", {}).update(extractor_mode="scripted", use_critic=False, use_judge=False)
    with tempfile.TemporaryDirectory(prefix="demo-snapshot-") as temp:
        with bind_policy(DemoPolicy()):
            wb = Dashboard(state_file=Path(temp) / "state.json", seed=False)
            wb.bus.loop = asyncio.get_running_loop()
            wb.replace_state(data)
            wb.processor.start()
            try:
                async with asyncio.timeout(60):
                    while wb.processor._tasks:
                        await asyncio.sleep(.05)
                snapshot = state_to_dict(wb)
                snapshot["clock"]["running"] = False
                output.parent.mkdir(parents=True, exist_ok=True)
                output.write_text(json.dumps(snapshot, ensure_ascii=False), encoding="utf-8")
                print(json.dumps({"output": str(output), "sites": len(snapshot["sites"]),
                                  "threads": len(snapshot["threads"]), "assertions": len(snapshot["assertions"])}))
            finally:
                wb.processor.stop()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dataset", type=Path, help="Existing generated dataset root (tiny/demo/large)")
    parser.add_argument("--output", type=Path, default=Path("out/public-demo-snapshot.json"))
    args = parser.parse_args()
    if args.dataset:
        asyncio.run(build(args.dataset, args.output))
    else:
        with tempfile.TemporaryDirectory(prefix="demo-dataset-") as temp:
            dataset = Path(temp) / "tiny"
            generate(dataset, "tiny", seed=42, workers=2, log=lambda *_: None)
            asyncio.run(build(dataset, args.output))


if __name__ == "__main__":
    main()
