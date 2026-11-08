import { describe, expect, it } from "vitest";
import { appendExperiment, comparable, jsonPointer, replayExperiments } from "./experiment-model";

const proposal = { operation: "create", fields: {
  title: "Bounded search", hypothesis: "One move lowers cost", prediction: "Cost below 10",
  motivation: "Investigate remaining gains", learningGoal: "Check whether the search is saturated",
} };
const metric = { name: "Cost", value: 9, unit: "points", evaluation: "training v1", direction: "lower" };

describe("experiment journal", () => {
  it("keeps decisions, progress, failures and learning after reopening", () => {
    const { raw, experiment } = appendExperiment("{}\n", proposal, "agent");
    const id = experiment.id;
    const approved = appendExperiment(raw, { operation: "decide", id, decision: "approved", text: "One attempt" }, "human");
    const running = appendExperiment(approved.raw, { operation: "update", id, fields: { status: "running", progress: "Started", budget: "One run" } }, "agent");
    const failed = appendExperiment(running.raw, { operation: "update", id, fields: { status: "failed", findings: "Timed out", next: "Try a cheaper move" } }, "agent");
    expect(replayExperiments(failed.raw).get(id)).toMatchObject({ decision: "approved", status: "failed", findings: "Timed out" });
    expect(replayExperiments(failed.raw).get(id)?.history).toHaveLength(4);
    expect(() => appendExperiment(failed.raw, { operation: "update", id, fields: { status: "running" } }, "agent")).toThrow("status transition");
  });

  it("requires human verification and clears verification when the metric changes", () => {
    const { raw, experiment } = appendExperiment("", proposal, "agent");
    const id = experiment.id;
    const running = appendExperiment(raw, { operation: "update", id, fields: { status: "running" } }, "agent");
    const finished = appendExperiment(running.raw, { operation: "update", id, fields: {
      status: "completed", metric, evidence: [{ kind: "result", path: "results/run.json" }],
    } }, "agent");
    expect(finished.experiment.verified).toBeUndefined();
    const verify = { operation: "verify", id, verification: {
      path: "results/run.json", pointer: "/cost", correctnessPointer: "/valid", expected: true, sha256: "a".repeat(64), metric,
    } };
    expect(() => appendExperiment(finished.raw, verify, "agent")).toThrow("Only a human");
    const verified = appendExperiment(finished.raw, verify, "human");
    expect(verified.experiment.verified?.metric.value).toBe(9);
    const changed = appendExperiment(verified.raw, { operation: "update", id, fields: { metric: { ...metric, value: 8 } } }, "agent");
    expect(changed.experiment.verified).toBeUndefined();
    expect(changed.experiment.history).toHaveLength(5);
    expect(comparable(verified.experiment.metric!, { ...verified.experiment.metric!, evaluation: "test" })).toBe(false);
  });

  it("rejects traversal and resolves only exact JSON pointer values", () => {
    const { raw, experiment: { id } } = appendExperiment("", proposal, "human");
    expect(() => appendExperiment(raw, { operation: "update", id, fields: { evidence: [{ kind: "source", path: "../outside" }] } }, "agent")).toThrow("project-relative");
    expect(jsonPointer({ "a/b": [5] }, "/a~1b/0")).toBe(5);
    expect(() => jsonPointer({}, "/constructor")).toThrow("no value");
  });
});
