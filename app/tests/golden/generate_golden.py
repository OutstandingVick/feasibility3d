"""Generate golden fixtures for the TypeScript engine parity tests.

Run from the repo root with the project venv:

    .venv/bin/python app/tests/golden/generate_golden.py

For each scenario (01, 02) it generates the sensor feed, runs the full chain
(detect -> locate -> quantify -> impact -> analyze) and writes every output to
``app/tests/golden/<scenario>/``. The TypeScript port must reproduce these
exactly: numbers within 1e-9 relative, and ``report_hash`` / ``input_hash``
byte-identical.
"""
import json
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent.parent
sys.path.insert(0, str(ROOT))

from engine import detect, generate, impact, locate, quantify, report  # noqa: E402

GOLDEN_DIR = Path(__file__).resolve().parent
SCENARIOS_DIR = ROOT / "scenarios"


def dump(obj, path: Path) -> None:
    path.write_text(json.dumps(obj, indent=2, sort_keys=True) + "\n")


def run(name: str) -> None:
    scenario_path = SCENARIOS_DIR / (name + ".json")
    scenario = json.loads(scenario_path.read_text())

    out_dir = GOLDEN_DIR / name
    out_dir.mkdir(parents=True, exist_ok=True)
    shutil.copy(scenario_path, out_dir / "scenario.json")

    rows = generate.generate(scenario)
    readings_path = out_dir / "readings.csv"
    generate.write_csv(rows, readings_path)
    rows = detect.load_readings(readings_path)

    detection = detect.detect(rows)
    location = locate.locate_leak(rows, detection, scenario)
    quant = quantify.quantify(rows, detection, location, scenario)
    impact_result = impact.estimate_impact(detection, location, quant, scenario)
    response = report.analyze(readings_path, scenario_path)

    dump(detection, out_dir / "detect.json")
    dump(location, out_dir / "locate.json")
    dump(quant, out_dir / "quantify.json")
    dump(impact_result, out_dir / "impact.json")
    dump(response, out_dir / "analyze.json")

    # The exact object that gets canonical-hashed into report_hash.
    hash_input = report._hash_input(response)
    dump(hash_input, out_dir / "hash_input.json")

    print(f"{name}: report_hash={response['report']['report_hash']} "
          f"input_hash={response['report']['input_hash']}")


def main() -> None:
    for name in ("scenario_01", "scenario_02"):
        run(name)
    print("wrote golden fixtures to", GOLDEN_DIR)


if __name__ == "__main__":
    main()
