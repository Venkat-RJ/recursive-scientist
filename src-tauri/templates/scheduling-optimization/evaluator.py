"""Evaluate one candidate on a fixed scheduling split and save a JSON report."""
import argparse
import base64
import csv
from datetime import datetime, timezone
import hashlib
import io
import json
import math
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import time
from uuid import uuid4
import zipfile

from baseline import Job, RULES
from scripts.fetch_benchmark import ARCHIVES, archive_identity, verify_archive
from scripts.generate_demo import DEMO_FILES, HEADER

ROOT = Path(__file__).resolve().parent
VERSION = "weighted-tardiness-v1"
WORKER = "scripts/candidate_worker.py"
EVALUATOR_FILES = ("evaluator.py", "baseline.py", WORKER,
                   "scripts/fetch_benchmark.py", "scripts/generate_demo.py")


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def parse_jobs(raw):
    reader = csv.reader(io.StringIO(raw.decode("utf-8-sig"), newline=""), strict=True)
    if tuple(next(reader, ())) != HEADER:
        raise ValueError("Unexpected scheduling CSV header")
    jobs = []
    ids = set()
    for row in reader:
        try:
            job = Job(*map(int, row))
        except (TypeError, ValueError) as error:
            raise ValueError(f"Invalid job at CSV line {reader.line_num}") from error
        if (job.job_index in ids or job.processing_time <= 0
                or job.tardiness_unit_time_cost <= 0):
            raise ValueError(f"Invalid or duplicate job at CSV line {reader.line_num}")
        ids.add(job.job_index)
        jobs.append(job)
    if not jobs:
        raise ValueError("Scheduling CSV contains no jobs")
    return tuple(jobs)


def weighted_tardiness(jobs, order):
    by_id = {job.job_index: job for job in jobs}
    if (type(order) is not list or len(order) != len(jobs)
            or any(type(job_id) is not int for job_id in order) or set(order) != by_id.keys()):
        raise ValueError("A schedule must contain every original job ID exactly once")
    elapsed = cost = 0
    for job_id in order:
        job = by_id[job_id]
        elapsed += job.processing_time
        cost += job.tardiness_unit_time_cost * max(0, elapsed - job.due_date)
    return cost


def dataset_identity(split):
    if split == "demo":
        return {"kind": "synthetic", "name": "Lattice offline demo", "split": split}
    return archive_identity(split)


def load_instances(split, data_dir):
    if split == "demo":
        sources = [(name, (data_dir / name).read_bytes()) for name in DEMO_FILES]
    else:
        name, size, _ = ARCHIVES[split]
        path = data_dir / name
        if not path.is_file():
            raise ValueError(f"Missing {name}. Run python3 scripts/fetch_benchmark.py --split {split}")
        with path.open("rb") as archive:
            data = archive.read(size + 1)
        verify_archive(data, split)
        prefix = re.escape(path.stem)
        factor = r"(?:0\.[2468]|1\.0)"
        count = 10 if split == "train" else 100
        expected = {
            f"{path.stem}/50-{t}-{r}-{index}.csv"
            for t in ("0.2", "0.4", "0.6", "0.8", "1.0")
            for r in ("0.2", "0.4", "0.6", "0.8", "1.0")
            for index in range(1, count + 1)
        }
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            members = [name for name in archive.namelist()
                       if re.fullmatch(rf"{prefix}/50-{factor}-{factor}-[0-9]+\.csv", name)]
            if set(members) != expected or len(members) != len(expected):
                raise ValueError(f"Unexpected 50-job members in {path.name}")
            sources = [(member, archive.read(member)) for member in sorted(members)]
    instances = []
    for name, raw in sources:
        jobs = parse_jobs(raw)
        if split != "demo" and len(jobs) != 50:
            raise ValueError(f"{name} does not have 50 jobs")
        instances.append((name, jobs, sha256(raw)))
    return instances


def baseline_costs(instances):
    return [{rule: weighted_tardiness(jobs, solve(jobs)) for rule, solve in RULES.items()}
            for _, jobs, _ in instances]


def baseline_totals(costs):
    return {rule: sum(row[rule] for row in costs) for rule in RULES}


def run_candidate(instances, source, timeout):
    payload = {
        "source": base64.b64encode(source).decode("ascii"),
        "path": str(ROOT / "candidate.py"),
        "instances": [jobs for _, jobs, _ in instances],
    }
    # A timeout covers module import and the whole batch. The parent retains
    # the original inputs and never accepts candidate-supplied scores.
    completed = subprocess.run(
        [sys.executable, "-B", str(ROOT / WORKER)], cwd=ROOT,
        input=json.dumps(payload), text=True, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
        timeout=timeout, check=True,
    )
    response = json.loads(completed.stdout)
    if response.get("error"):
        raise ValueError(response["error"])
    rows = response["instances"]
    if len(rows) != len(instances):
        raise ValueError("Candidate worker did not return one result per instance")
    return rows


def evaluate(split, timeout, report):
    source = (ROOT / "candidate.py").read_bytes()
    report["candidate_sha256"] = sha256(source)
    instances = load_instances(split, ROOT / "data")
    report["dataset"]["instance_count"] = len(instances)
    report["dataset"]["instances_sha256"] = sha256(json.dumps(
        [(name, digest) for name, _, digest in instances], separators=(",", ":"),
    ).encode())
    costs = baseline_costs(instances)
    totals = baseline_totals(costs)
    # Freeze the comparator on training when evaluating held-out instances.
    selection_split = "train" if split == "test" else split
    selection_totals = (baseline_totals(baseline_costs(load_instances("train", ROOT / "data")))
                        if split == "test" else totals)
    comparator = min(RULES, key=selection_totals.__getitem__)
    report["baseline"] = {
        "rule": comparator,
        "selection_split": selection_split,
        "selection_totals": selection_totals,
        "rule_totals": totals,
        "total_weighted_tardiness": totals[comparator],
        "mean_weighted_tardiness": totals[comparator] / len(instances),
    }
    started = time.perf_counter()
    worker_error = None
    try:
        observations = run_candidate(instances, source, timeout)
    except subprocess.TimeoutExpired:
        report["status"] = "timeout"
        worker_error = f"Candidate exceeded the {timeout:g}s batch timeout"
    except (OSError, ValueError, subprocess.CalledProcessError) as error:
        report["status"] = "failed"
        worker_error = str(error)
    report["candidate_wall_seconds"] = time.perf_counter() - started
    if worker_error is not None:
        report["error"] = worker_error
        observations = [{"error": worker_error}] * len(instances)

    counts = dict(improved=0, tied=0, worsened=0, invalid=0)
    rows = []
    for (name, jobs, digest), reference, observation in zip(instances, costs, observations):
        candidate_cost = None
        error = observation.get("error")
        if error is None:
            try:
                candidate_cost = weighted_tardiness(jobs, observation.get("order"))
            except ValueError as invalid:
                error = str(invalid)
        baseline = reference[comparator]
        if candidate_cost is None:
            outcome = "invalid"
        elif candidate_cost == baseline:
            outcome = "tied"
        else:
            outcome = "improved" if candidate_cost < baseline else "worsened"
        counts[outcome] += 1
        rows.append({
            "instance": name, "sha256": digest, "reference_costs": reference,
            "baseline_cost": baseline, "candidate_cost": candidate_cost,
            "candidate_seconds": observation.get("elapsed_seconds"),
            "outcome": outcome, "error": error,
        })

    valid = len(rows) - counts["invalid"]
    report.update(instances=rows, outcomes=counts, validity_percent=100 * valid / len(rows))
    if valid == len(rows):
        baseline = totals[comparator]
        total = sum(row["candidate_cost"] for row in rows)
        report.update(status="valid", candidate_total_weighted_tardiness=total,
                      candidate_mean_weighted_tardiness=total / len(rows),
                      improvement_percent=100 * (baseline - total) / baseline if baseline else None)
    elif worker_error is None:
        report["status"] = "invalid"


def save_report(report):
    results = ROOT / "results"
    results.mkdir(exist_ok=True)
    path = results / f"{report['split']}-{uuid4().hex}.json"
    with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=results) as staging:
        json.dump(report, staging, indent=2, allow_nan=False)
        staging.write("\n")
        staging.flush()
        # Publish a complete report without replacing any previous attempt.
        import os
        os.link(staging.name, path)
    return path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--split", choices=("demo", "train", "test"), default="demo")
    parser.add_argument("--timeout", type=float, default=30, help="Candidate batch limit in seconds")
    args = parser.parse_args()
    if not math.isfinite(args.timeout) or args.timeout <= 0:
        parser.error("--timeout must be a positive finite number")
    report = {
        "created_at": datetime.now(timezone.utc).isoformat(),
        "split": args.split,
        "dataset": dataset_identity(args.split),
        "evaluator_version": VERSION,
        "evaluator_sha256": sha256(json.dumps({
            file: sha256((ROOT / file).read_bytes()) for file in EVALUATOR_FILES
        }, sort_keys=True).encode()),
        "python_version": sys.version.split()[0],
        "timeout_seconds": args.timeout,
        "status": "failed",
        "candidate_total_weighted_tardiness": None,
        "candidate_mean_weighted_tardiness": None,
        "improvement_percent": None,
    }
    try:
        evaluate(args.split, args.timeout, report)
    except (OSError, ValueError, csv.Error, zipfile.BadZipFile) as error:
        report["error"] = str(error)
    path = save_report(report)
    label = "Synthetic demo" if args.split == "demo" else f"Published benchmark ({args.split})"
    print(f"{label}: {report['status']}")
    if "baseline" in report:
        baseline = report["baseline"]
        print(f"Reference totals: {baseline['rule_totals']}; comparator: {baseline['rule']}")
        print(f"Candidate total: {report['candidate_total_weighted_tardiness']}; validity: {report['validity_percent']:g}%")
        print(f"Improvement (%): {report['improvement_percent']}; outcomes: {report['outcomes']}")
    if "error" in report:
        print(report["error"], file=sys.stderr)
    print(f"Report: {path.relative_to(ROOT)}")
    return 0 if report["status"] == "valid" else 1


if __name__ == "__main__":
    sys.exit(main())
