# Problem Formulation

Open **Panels → Tools → Problem Formulation** before starting a scientific
investigation. The panel and both native agents use the project file
`problem-formulation.json`. The panel links to the existing notebook, Mind Map,
and Experiments. List source files or literature links in the draft and cite
them alongside individual facts. Keep results in Experiments and the evolving
scientific narrative in `main.md`.

A draft separates facts, assumptions, hypotheses, and open questions. Record
unresolved contradictions that prevent review under **Blocking contradictions
or gaps**. Review checks detect missing sections, invalid source links, and
recorded blockers or challenges. Check the actual sources and scientific
consistency before approval.

Request review to send a complete revision to the researcher. A challenge
stays with the revision that prompted it. To address it, save a new revision
with a reason. **Approve and freeze** records approval of that exact snapshot.
A later change creates a new draft and requires its own approval. The previous
protocol remains readable in Revision history.

## Native agent tools

- `formulation_read` reads the latest revision and approval history. Pass a
  revision number to inspect an earlier snapshot.
- `formulation_validate` returns the latest completeness and review checks.
- `formulation_write` creates a revision, records a challenge, or requests
  review. For a first draft, pass revision 0. Later writes require the latest
  revision number so stale edits are rejected. Approval is a panel action.

For local builds, apply `scripts/synara-formulation-tools.patch` in the pinned
Synara checkout after the existing Mind Map and Experiments patches. Prepare the
runtime as described in [Synara runtime](synara-runtime.md#build-and-release).
