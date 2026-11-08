import { useLingui } from "@lingui/react/macro";

export function useKnowledgeLabels() {
  const { t } = useLingui();
  return {
    paper: t`Paper`, web: t`Webpage`, implementation: t`Implementation`, benchmark: t`Benchmark`,
    dataset: t`Dataset`, experiment: t`Experiment evidence`, project: t`Project artifact`,
    method: t`Method`, assumption: t`Assumption`, result: t`Result`, limitation: t`Limitation`,
    comparison: t`Comparison`, opportunity: t`Research opportunity`, question: t`Question`,
    reported: t`Reported by source`, verified: t`Independently checked`, interpretation: t`Interpretation`, speculation: t`Speculation`,
    builds_on: t`Builds on`, contradicts: t`Contradicts`, questions: t`Questions`, compares: t`Compares`,
    matched: t`Matched protocols`, partially_matched: t`Partially matched`, different: t`Different protocols`, unknown: t`Comparability unknown`,
    mechanism: t`Mechanism`, assumptions: t`Assumptions`, protocol: t`Evaluation protocol`, outcome: t`Outcome`, limitations: t`Limitations`,
  };
}
