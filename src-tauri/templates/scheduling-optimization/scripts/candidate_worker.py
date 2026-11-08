"""Execute candidate code outside the scoring process and return only schedules."""
import base64
import json
import os
from pathlib import Path
import sys
import time
import traceback

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from baseline import Job


def run(payload):
    namespace = {"__name__": "candidate", "__file__": payload["path"]}
    exec(compile(base64.b64decode(payload["source"]), payload["path"], "exec"), namespace)
    solve = namespace.get("solve")
    if not callable(solve):
        raise ValueError("candidate.py must define solve(jobs)")
    results = []
    for rows in payload["instances"]:
        jobs = tuple(Job(*row) for row in rows)
        started = time.perf_counter()
        try:
            order = solve(jobs)
            if (type(order) is not list or len(order) != len(jobs)
                    or any(type(job_id) is not int or job_id.bit_length() > 64 for job_id in order)):
                raise ValueError("solve() must return a list of integer job IDs, one per input job")
            result = {"order": order}
        except Exception as error:
            result = {"error": f"{type(error).__name__}: {error}"[:500]}
        result["elapsed_seconds"] = time.perf_counter() - started
        results.append(result)
    return {"instances": results}


if __name__ == "__main__":
    # Keep Python and native stdout/stderr from candidate code off the result pipe.
    with os.fdopen(os.dup(sys.stdout.fileno()), "w") as response, open(os.devnull, "w") as sink:
        os.dup2(sink.fileno(), sys.stdout.fileno())
        os.dup2(sink.fileno(), sys.stderr.fileno())
        try:
            result = run(json.load(sys.stdin))
        except Exception:
            result = {"error": traceback.format_exc(limit=4)[-1500:]}
        json.dump(result, response, allow_nan=False)
