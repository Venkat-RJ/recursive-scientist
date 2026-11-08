import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import evaluator
from baseline import Job
from scripts import fetch_benchmark, generate_demo


class ScoringTests(unittest.TestCase):
    def test_csv_preserves_ids_and_negative_due_dates(self):
        raw = b"job_index,processing_time,tardiness_unit_time_cost,due_date\r\n42,3,4,-2\r\n8,2,7,4\r\n"
        self.assertEqual(evaluator.parse_jobs(raw), (Job(42, 3, 4, -2), Job(8, 2, 7, 4)))
        for bad in (raw + b"42,2,7,4\n", raw + b"12,0,7,4\n", raw + b"12,4,7\n", b"wrong,header\n"):
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                evaluator.parse_jobs(bad)

    def test_weighted_tardiness_and_invalid_permutations(self):
        jobs = (Job(42, 3, 4, 2), Job(8, 2, 7, 4))
        self.assertEqual(evaluator.weighted_tardiness(jobs, [42, 8]), 11)
        self.assertEqual(evaluator.weighted_tardiness(jobs, [8, 42]), 12)
        for order in ([42], [42, 42], [42, 99], [42, 8.0], (42, 8)):
            with self.subTest(order=order), self.assertRaises(ValueError):
                evaluator.weighted_tardiness(jobs, order)

    def test_generator_matches_fixed_demo_inputs(self):
        data = evaluator.load_instances("demo", evaluator.ROOT / "data")
        for (_, jobs, _), seed in zip(data, (42, 73)):
            self.assertEqual(jobs, tuple(generate_demo.rows(seed)))


class ProjectTests(unittest.TestCase):
    def setUp(self):
        scratch = tempfile.TemporaryDirectory()
        self.addCleanup(scratch.cleanup)
        self.root = Path(scratch.name) / "project"
        shutil.copytree(evaluator.ROOT, self.root, ignore=shutil.ignore_patterns(
            "__pycache__", "*_set.zip", "results",
        ))

    def run_split(self, split="demo", *args):
        results = self.root / "results"
        before = set(results.glob("*.json"))
        finished = subprocess.run(
            [sys.executable, "-B", "evaluator.py", "--split", split, *args],
            cwd=self.root, capture_output=True, text=True, check=False,
        )
        new = set(results.glob("*.json")) - before
        self.assertEqual(len(new), 1, finished.stdout + finished.stderr)
        return finished, json.loads(new.pop().read_text())

    def test_offline_demo_scores_and_compares_identical_inputs(self):
        completed, report = self.run_split()
        self.assertEqual(completed.returncode, 0)
        self.assertIn("Synthetic demo: valid", completed.stdout)
        self.assertNotIn("Published benchmark", completed.stdout)
        self.assertEqual(report["dataset"]["kind"], "synthetic")
        self.assertEqual(report["baseline"]["rule_totals"], {"EDD": 288, "WSPT": 217})
        self.assertEqual(report["baseline"]["rule"], "WSPT")
        self.assertEqual([row["candidate_cost"] for row in report["instances"]], [161, 127])
        self.assertEqual([row["baseline_cost"] for row in report["instances"]], [84, 133])
        self.assertEqual(report["outcomes"], dict(improved=1, tied=0, worsened=1, invalid=0))
        self.assertEqual(report["validity_percent"], 100)

    def test_invalid_candidates_have_no_aggregate_and_prior_reports_survive(self):
        candidate = self.root / "candidate.py"
        for implementation in (
            "return [jobs[0].job_index] * len(jobs)",
            "jobs[0].processing_time = 1",
        ):
            candidate.write_text(f"def solve(jobs):\n    {implementation}\n")
            completed, report = self.run_split()
            self.assertEqual(completed.returncode, 1)
            self.assertEqual(report["status"], "invalid")
            self.assertEqual(report["validity_percent"], 0)
            self.assertIsNone(report["candidate_total_weighted_tardiness"])
            self.assertIsNone(report["improvement_percent"])
        self.assertEqual(len(list((self.root / "results").glob("*.json"))), 2)

    def test_timeout_and_missing_archive_leave_demo_available(self):
        completed, missing = self.run_split("train")
        self.assertEqual(completed.returncode, 1)
        self.assertIn("Missing training_set.zip", missing["error"])
        data_dir = self.root / "data"
        with patch.object(fetch_benchmark, "urlopen", side_effect=OSError("offline")):
            with self.assertRaisesRegex(OSError, "offline"):
                fetch_benchmark.import_archive("train", data_dir=data_dir)
        self.assertFalse((data_dir / "training_set.zip").exists())
        self.assertEqual(self.run_split()[0].returncode, 0)
        (self.root / "candidate.py").write_text("import time\ntime.sleep(30)\n")
        completed, report = self.run_split("demo", "--timeout", "0.5")
        self.assertEqual(completed.returncode, 1)
        self.assertEqual(report["status"], "timeout")
        self.assertIsNone(report["candidate_total_weighted_tardiness"])

    def test_zero_baseline_has_undefined_percentage(self):
        for filename in generate_demo.DEMO_FILES:
            (self.root / "data" / filename).write_text(",".join(generate_demo.HEADER) + "\n42,1,3,10\n")
        completed, report = self.run_split()
        self.assertEqual(completed.returncode, 0)
        self.assertEqual(report["candidate_total_weighted_tardiness"], 0)
        self.assertIsNone(report["improvement_percent"])


if __name__ == "__main__":
    unittest.main()
