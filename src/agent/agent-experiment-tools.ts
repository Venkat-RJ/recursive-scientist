/* eslint-disable lingui/no-unlocalized-strings -- Native agent protocol. */
import { isRecord } from "../app-utils";
import { loadExperiments, writeExperiment } from "../project/experiments/experiment-store";
import { hasOnlyKeys, isNonBlankString, jsonBytes, parseToolEnvelope, runAgentTool, toolError } from "./agent-protocol";

export function parseAgentExperimentRequest(value: unknown) {
  const request = parseToolEnvelope(value, "synara:experiment-tool-request", ["args", "workspaceRoot"]);
  if (!request || !isNonBlankString(request.workspaceRoot, 4096) || !isRecord(request.args)) return null;
  const { args, workspaceRoot } = request;
  if (args.operation === "experiment_read" && hasOnlyKeys(args, ["operation", "id"]) &&
      (args.id === undefined || isNonBlankString(args.id, 80))) {
    return { id: request.id as string, expiresAt: request.expiresAt as number, workspaceRoot, read: true, args };
  }
  if (args.operation === "experiment_write" && hasOnlyKeys(args, ["operation", "input"]) && isRecord(args.input) &&
      (jsonBytes(args.input) ?? Infinity) <= 32_768) {
    return { id: request.id as string, expiresAt: request.expiresAt as number, workspaceRoot, read: false, args };
  }
  return null;
}

export function executeAgentExperimentRequest(
  request: NonNullable<ReturnType<typeof parseAgentExperimentRequest>>,
  currentRoot: () => string | null,
) {
  const current = () => currentRoot() === request.workspaceRoot && request.expiresAt > Date.now();
  return runAgentTool("lattice:experiment-tool-result", request.id, "experiment_tool_failed", async () => {
    if (!current()) throw toolError("The request expired or its project is no longer open.", "experiment_scope_changed");
    if (!request.read) {
      const { id, status, updatedAt } = await writeExperiment(request.workspaceRoot, request.args.input, "agent", current);
      return { kind: "experiments", experiment: { id, status, updatedAt } };
    }
    const experiments = await loadExperiments(request.workspaceRoot);
    if (!current()) throw toolError("The request expired or its project is no longer open.", "experiment_scope_changed");
    if (request.args.id !== undefined) {
      const experiment = experiments.find((entry) => entry.id === request.args.id);
      if (!experiment) throw toolError("Experiment not found.", "experiment_missing");
      const { history, ...fields } = experiment;
      return { kind: "experiments", experiment: { ...fields, history: history.slice(-12).map(({ at, actor, operation, ...event }) => ({ at, actor, operation, ...( "text" in event ? { text: event.text.slice(0, 1000) } : {}) })), historyCount: history.length } };
    }
    return { kind: "experiments", total: experiments.length, experiments: experiments.slice(0, 80).map(({ id, title, status, decision, updatedAt, verified }) => ({
      id, title, status, decision, updatedAt, verifiedMetric: verified?.metric,
    })) };
  });
}
