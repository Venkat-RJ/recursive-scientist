/* eslint-disable lingui/no-unlocalized-strings -- Native agent protocol. */
import { isRecord } from "../app-utils";
import { validateFormulation } from "../project/formulation/formulation-model";
import { loadFormulation, writeFormulation } from "../project/formulation/formulation-store";
import { hasOnlyKeys, isNonBlankString, jsonBytes, parseToolEnvelope, runAgentTool, toolError } from "./agent-protocol";

export function parseAgentFormulationRequest(value: unknown) {
  const envelope = parseToolEnvelope(value, "synara:formulation-tool-request", ["args", "workspaceRoot"]);
  if (!envelope || !isNonBlankString(envelope.workspaceRoot, 4096) || !isRecord(envelope.args)) return null;
  const { args, workspaceRoot, id, expiresAt } = envelope;
  const operation = args.operation;
  const request = { workspaceRoot, id: id as string, expiresAt: expiresAt as number };
  if (operation === "formulation_read" && hasOnlyKeys(args, ["operation", "revision"]) &&
      (args.revision === undefined || (typeof args.revision === "number" && Number.isSafeInteger(args.revision) && args.revision > 0))) {
    return { ...request, operation: operation as "formulation_read", revision: args.revision };
  }
  if (operation === "formulation_validate" && hasOnlyKeys(args, ["operation"])) return { ...request, operation: operation as "formulation_validate" };
  if (operation === "formulation_write" && hasOnlyKeys(args, ["operation", "input"]) && isRecord(args.input) &&
      (jsonBytes(args.input) ?? Infinity) <= 80_000) {
    return { ...request, operation: operation as "formulation_write", input: args.input };
  }
  return null;
}

export function executeAgentFormulationRequest(
  request: NonNullable<ReturnType<typeof parseAgentFormulationRequest>>, currentRoot: () => string | null,
) {
  const current = () => currentRoot() === request.workspaceRoot && request.expiresAt > Date.now();
  const assertCurrent = () => {
    if (!current()) throw toolError("The request expired or its project is no longer open.", "formulation_scope_changed");
  };
  return runAgentTool("lattice:formulation-tool-result", request.id, "formulation_tool_failed", async () => {
    assertCurrent();
    const state = request.operation === "formulation_write"
      ? await writeFormulation(request.workspaceRoot, request.input, "agent", current)
      : await loadFormulation(request.workspaceRoot);
    assertCurrent();
    const version = request.operation === "formulation_read" ? request.revision : undefined;
    const revision = version === undefined ? state.current : state.revisions.find((entry) => entry.version === version);
    if (version !== undefined && !revision) throw toolError("Formulation revision not found.", "formulation_revision_missing");
    const latestApproved = [...state.revisions].reverse().find((entry) => entry.approvedAt)?.version ?? null;
    const { challenges, ...validation } = validateFormulation(revision);
    return {
      kind: "formulation",
      latestRevision: state.current?.version ?? 0,
      latestApproved,
      validation: { ...validation, challengeCount: challenges.length },
      ...(request.operation === "formulation_read" ? {
        revision: revision ?? null,
        history: state.revisions.slice(-20).map(({ version, reason, approvedAt }) => ({ version, reason: reason.slice(0, 300), approvedAt })),
        projectContext: { notebook: "main.md", priorKnowledge: "prior_knowledge_read", experiments: "experiments_read", mindMap: "mind_map_read" },
      } : {}),
    };
  });
}
