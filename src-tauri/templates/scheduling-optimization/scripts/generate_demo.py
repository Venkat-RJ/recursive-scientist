"""Regenerate the two synthetic CSV fixtures without network access."""
import csv
from pathlib import Path
import random

ROOT = Path(__file__).resolve().parents[1]
HEADER = ("job_index", "processing_time", "tardiness_unit_time_cost", "due_date")
DEMO_FILES = ("demo.csv", "demo-2.csv")


def rows(seed):
    rng = random.Random(seed)
    for index in range(8):
        yield 11 + index * 7, 1 + int(rng.random() * 12), 1 + int(rng.random() * 9), int(rng.random() * 45)


if __name__ == "__main__":
    for name, seed in zip(DEMO_FILES, (42, 73)):
        with (ROOT / "data" / name).open("w", newline="", encoding="utf-8") as handle:
            writer = csv.writer(handle, lineterminator="\n")
            writer.writerow(HEADER)
            writer.writerows(rows(seed))
