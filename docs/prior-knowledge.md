# Prior Knowledge

Open **Panels → Prior Knowledge** in a local project. The panel and the Codex and Claude tools use the same `prior-knowledge.json` journal in the project directory. Start with the current findings. Open Literature or Papers to investigate a gap, or Experiments to check local evidence. Register the original URL or project artifact and cite the page, section, line, or result field that supports each finding.

Use a **method** to record mechanism, assumptions, protocol, outcome and limitations. Use a **comparison** to link exact versions of the methods and say which protocols match. Use an **opportunity** for a supported but untested direction. A reported claim needs at least one citation. A human may mark a finding independently checked after describing what they checked. Source links are inspectable evidence and the journal does not certify the truth of a claim. Use a new finding with a **Contradicts** or **Questions** link to record disagreement. Use **Revise finding** when your own conclusion changes. Earlier versions remain available.

**Copy reference** produces a Markdown link to an exact version, such as `[pk-unmatched@1](prior-knowledge.json#pk-unmatched@1)`. Paste it in `main.md`. Use the link target in Problem Formulation sources or as an Experiments source evidence path. A Mind Map node can use the link or its target as the label, then **Open linked finding** opens that version. These links share the original record.

## Agent workflow

1. Call `prior_knowledge_read` before generating hypotheses or running experiments. It lists current findings and sources. Use `query` and `offset` to search, `findingId` and optionally `revision` to inspect evidence, or `sourceId` to inspect a source.
2. Use the existing `search_library`, `search_literature`, `fetch_paper`, `fetch_web_reference` and `experiments_read` tools when evidence is missing. Search results are leads. Open the original source and record what you could actually check.
3. Call `prior_knowledge_write` with `input.expectedRevision` from the read and up to 30 `input.changes` in source-first order. Add sources with `{source:{id,title,kind,location}}` and findings with `{finding:{id,title,kind,status,statement,evidence,links}}`. Use `{sourceId,locator,note}` for citations and `{id,revision,relation}` for finding links. See the tool schema for comparison and method fields. Reuse source IDs. Revising an existing finding ID requires a reason. If a write races another edit, read the latest journal before trying again.
4. Keep source-grounded claims and conclusions in Prior Knowledge. Link their exact versions from the notebook and research tools. The Synara research instructions establish the order for scientific turns. The existing experiment commands remain available for resuming or maintaining existing work.

## Scheduling Optimization

New projects made from this template include a seeded research record. Existing projects retain their own records. The seeded comparison links the template EDD and WSPT rules, the reported backward dispatch rule, workload-aware ATC, iterated dynasearch and the source-available SiPS exact solver. It distinguishes the pinned Martins dataset from historical generated instances, OR-Library and sequence-dependent setups. The backward rule details await full-text confirmation, and all relative performance on the pinned inputs awaits matched runs.

The recorded opportunity tests workload-based dispatch selection under a fixed dynasearch budget. It cites the papers that motivate the selector and search, links each comparator, and states a falsification criterion. The held-out split is reserved for a separately authorized evaluation.
