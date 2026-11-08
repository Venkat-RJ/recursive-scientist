# Scheduling Optimization

## Research Question and Objective

Which bounded local scheduling heuristic lowers single-machine total weighted tardiness while returning a valid permutation on every instance?

## Evaluation and Constraints

Compare aggregate and per-instance weighted tardiness with the stronger of EDD and WSPT on the development split. Lower is better. Use fixed inputs, local CPU, and the existing evaluator. Keep candidate changes separate from the evaluator and reference rules. Use training for development and reserve the test split for a separately authorized evaluation. See [setup](SETUP.md) and [data provenance](DATA_SOURCES.md).

## Prior Knowledge and Assumptions

Open **Prior Knowledge** from **Panels** or follow the [project knowledge record](prior-knowledge.json). Open the [baseline comparison](prior-knowledge.json#pk-unmatched@1) and the [literature-backed search opportunity](prior-knowledge.json#pk-budgeted-search@1). These records carry the methods, citations and evaluation boundaries. Read them before proposing or running a new experiment.

## Hypotheses

- **H-001, proposed.** One improving insertion into an EDD schedule may lower cost. Predict a lower aggregate than plain EDD on fixed inputs. A tie, increase, or invalid schedule fails the prediction.
- **H-002, proposed.** Comparing neighborhoods may help when due dates cluster. Define the clustering rule, comparator, and falsification criterion before running.
- **H-003, proposed.** Instance features may predict which dispatch rule makes a better starting schedule. Freeze the features and validation procedure before running.

## Investigation Plan

1. Run the synthetic smoke check to verify the evaluator.
2. Establish the reference scores on the pinned training split.
3. Consult the [baseline comparison](prior-knowledge.json#pk-unmatched@1) and reproduce a stronger comparator before evaluating a candidate hypothesis. Record the matched protocol and prediction before running.

## Experiments and Evidence

No experiments recorded yet. Use stable experiment IDs and link each attempt's code, report, and observations.

## Current Understanding

No research findings have been measured in this project.

## Next Investigation

Reproduce workload-aware ATC from [the method record](prior-knowledge.json#pk-atc@1) on the training split. Keep the evaluator fixed and use the comparison record to choose a matched control for the search opportunity.
