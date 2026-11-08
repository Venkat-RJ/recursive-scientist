# Experiments

Open **Panels → Tools → Experiments** in a Lattice project. The panel and the native
agent tools share a project file named `experiments.json`. It stores the sequence
of proposals, updates, comments, decisions, and verification records. The panel
updates when an agent tool writes to the journal. Reopen the project to continue
from those records in a new conversation.

Start with a hypothesis, prediction, motivation, and what you expect to learn.
Record each attempt separately. Add progress and remaining budget while it runs,
then save the outcome, exact source, logs, result files, findings, and next
investigation. Paths are relative to the project. Human rejection is a recorded
decision and does not send a cancellation signal to the running process.

## Evidence and comparisons

Set a metric name, unit, direction, and evaluation identity. The evaluation
identity should identify the dataset and protocol. For a completed attempt, choose
a linked JSON result and enter pointers to its metric and correctness fields, for
example `/metrics/cost` and `/valid`. Enter the expected correctness value as
JSON, such as `true`. Verification checks both values and hashes the saved report.
If the report changes or disappears, the panel excludes that result from verified
rankings. This check establishes what the saved report says. Independent
reproduction remains a separate research step.

Comparisons use the recorded baseline and only rank verified, unrejected results
with the same metric, unit, direction, and evaluation identity. Reported runtime
and correctness appear alongside the primary measurement.

## Native agent tools

- `experiments_read` lists up to 80 recent records or opens one record by ID.
- `experiments_write` creates a proposal, updates an attempt, or adds a comment.
- Human approval, rejection, and verification are available in the panel.
- Progress and budget are recorded by the agent or researcher. The panel does not
  estimate them from terminal output or launch runs.

Local development builds use the [Synara runtime preparation steps](synara-runtime.md#build-and-release).
