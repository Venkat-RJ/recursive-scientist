# Scheduling Optimization

## Research Objective

Find a schedule with lower total weighted tardiness while keeping every schedule valid. One machine processes one job at a time. Each job contributes its weight multiplied by the number of time units it finishes after its due date, or zero if it finishes on time.

## Evaluation

Open **Terminal** from Lattice’s **Panels** menu and run these commands from the project folder. Python 3.9 or later is enough.

```sh
python3 evaluator.py --split demo
python3 -m unittest discover -s tests -v
```

The two bundled CSVs are synthetic. For development on the published 50-job instances, explicitly import the training archive.

```sh
python3 scripts/fetch_benchmark.py --split train
python3 evaluator.py --split train
```

The evaluator measures earliest due date (EDD) and weighted shortest processing time (WSPT) on the same inputs. It compares the candidate with the rule that has the lower aggregate cost on that development split. EDD wins a tie. These are simple reference rules.

Each evaluation writes a separate JSON file under `results/`. The report records the exact inputs, scores by instance, the selected comparator, validity, timings, and hashes of the candidate and evaluator. A positive improvement percentage means the candidate cost less. When the baseline cost is zero, the percentage is undefined. An invalid run has no aggregate candidate score.

## Initial Hypotheses

- An insertion move on a late, high-weight job could reduce the total cost of an EDD schedule.
- Comparing a small set of neighboring schedules could help when several jobs have similar due dates.
- The job distribution may help predict which dispatching rule gives a better starting schedule.

## Constraints

Use the local CPU, fixed inputs and bounded experiments. Edit `candidate.py` and keep the evaluator, reference rules and input data fixed. Use no paid compute. The candidate runs as local Python code with your account’s permissions, so run code you trust.

## Experimental Method

1. Record the hypothesis, split and candidate change before running.
2. Evaluate the candidate and retain the report, including failed attempts.
3. Compare the aggregate and per-instance costs. Record where the candidate improved or regressed.
4. Decide whether the measurements support the hypothesis. Use only training results to tune algorithms for the published benchmark.
5. After choosing a candidate, follow [Data Sources](DATA_SOURCES.md) for a separate held-out evaluation.

## Results and Learning

No research results have been measured yet. Link to evaluator reports here as you run experiments.

## Next Investigation

Can a single insertion move improve the starting EDD schedule on either demo instance? Try moving one late job earlier, then check the costs of both instances and compare the aggregate with the selected baseline.
