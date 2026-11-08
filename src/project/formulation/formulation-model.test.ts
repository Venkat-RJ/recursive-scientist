import { describe, expect, it } from "vitest";
import { appendFormulation, replayFormulation, validateFormulation } from "./formulation-model";

const fields = {
  objective: "Improve scheduling cost", scope: "Training only", constraints: "No test access",
  resources: "Pinned training data", currentSystem: "Deterministic evaluator",
  priorWork: "WSPT and EDD dispatching rules", facts: "The saved report contains 250 valid schedules",
  assumptions: "Training is useful for screening", hypotheses: "Another insertion can reduce cost",
  unknowns: "The neighborhood may saturate", sources: "main.md\nbaseline.py",
  benchmark: "Published training split", baseline: "WSPT", metrics: "Minimize weighted tardiness",
  correctness: "All schedules valid", successCriteria: "Lower total cost without regressions",
};

const draft = { operation: "revise", revision: 0, fields, reason: "Initial investigation" };
const review = { operation: "request_review", revision: 1 };
const approve = { operation: "approve", revision: 1 };

describe("problem formulation journal", () => {
  it("requires completeness and separates agent review from human approval", () => {
    const partial = appendFormulation("", { ...draft, fields: { objective: fields.objective } }, "agent");
    expect(validateFormulation(partial.state.current).missing).toContain("benchmark");
    expect(() => appendFormulation(partial.raw, review, "agent")).toThrow(/required fields/);
    const initial = appendFormulation("", draft, "agent");
    expect(() => appendFormulation(initial.raw, approve, "human")).toThrow(/Request review/);
    const awaiting = appendFormulation(initial.raw, review, "agent");
    expect(() => appendFormulation(awaiting.raw, approve, "agent")).toThrow(/Only the researcher/);
    const frozen = appendFormulation(awaiting.raw, approve, "human");
    expect(replayFormulation(frozen.raw).current).toMatchObject({ approvedAt: expect.any(String), version: 1, fields });
  });

  it("preserves the frozen protocol and rejects stale changes and approvals", () => {
    const initial = appendFormulation("", draft, "agent");
    const awaiting = appendFormulation(initial.raw, review, "agent");
    const frozen = appendFormulation(awaiting.raw, approve, "human");
    const next = appendFormulation(frozen.raw, {
      operation: "revise", revision: 1, fields: { baseline: "Incumbent candidate" }, reason: "Compare incremental progress",
    }, "agent");
    expect(next.state.current).toMatchObject({ version: 2, fields: { baseline: "Incumbent candidate" }, reviewRequested: false });
    expect(next.state.current?.approvedAt).toBeUndefined();
    expect(next.state.revisions[0]).toMatchObject({ fields: { baseline: "WSPT" }, approvedAt: expect.any(String) });
    expect(() => appendFormulation(next.raw, approve, "human")).toThrow(/changed/);
  });

  it("blocks approval on challenges, and keeps the challenge and response in history", () => {
    const initial = appendFormulation("", draft, "agent");
    const awaiting = appendFormulation(initial.raw, review, "agent");
    const challenged = appendFormulation(awaiting.raw, { operation: "challenge", revision: 1, text: "State the run limit" }, "human");
    expect(() => appendFormulation(challenged.raw, approve, "human")).toThrow(/challenges/);
    const revised = appendFormulation(challenged.raw, {
      operation: "revise", revision: 1, fields: { constraints: "One training-only run" }, reason: "Recorded the run limit",
    }, "agent");
    expect(replayFormulation(revised.raw).revisions.map(({ challenges, reason }) => [challenges.length, reason]))
      .toEqual([[1, "Initial investigation"], [0, "Recorded the run limit"]]);
  });

  it("treats an explicitly recorded contradiction as a review blocker", () => {
    const initial = appendFormulation("", { ...draft, fields: { ...fields, blockers: "Two references disagree on the split" } }, "agent");
    expect(validateFormulation(initial.state.current).blockers).toContain("disagree");
    expect(() => appendFormulation(initial.raw, review, "human")).toThrow(/blockers/);
  });
});
