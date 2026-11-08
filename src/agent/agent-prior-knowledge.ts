/* eslint-disable lingui/no-unlocalized-strings -- Native agent protocol. */
import { isRecord } from "../app-utils";
import { isKnowledgeId, knowledgeMatches, KNOWLEDGE_FILE, MAX_BATCH_BYTES } from "../project/prior-knowledge/knowledge-model";
import { loadKnowledge, writeKnowledge } from "../project/prior-knowledge/knowledge-store";
import { hasOnlyKeys, isNonBlankString, jsonBytes, parseToolEnvelope, runAgentTool, toolError } from "./agent-protocol";

const isOffset = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

export function parseAgentKnowledgeRequest(value: unknown) {
  const envelope = parseToolEnvelope(value, "synara:prior-knowledge-tool-request", ["args", "workspaceRoot"]);
  if (!envelope || !isNonBlankString(envelope.workspaceRoot, 4096) || !isRecord(envelope.args)) return null;
  const { args, workspaceRoot, id, expiresAt } = envelope;
  const scope = { workspaceRoot, id: id as string, expiresAt: expiresAt as number };
  const { operation, input, findingId, sourceId, revision, offset, query } = args;
  if (operation === "prior_knowledge_read" && hasOnlyKeys(args, ["operation", "findingId", "sourceId", "revision", "offset", "query"]) &&
    (findingId === undefined || isKnowledgeId(findingId)) && (sourceId === undefined || isKnowledgeId(sourceId)) &&
    !(findingId && sourceId) && (!(findingId || sourceId) || (offset === undefined && query === undefined)) &&
    (revision === undefined || (findingId && isOffset(revision) && revision > 0)) &&
    (offset === undefined || isOffset(offset)) && (query === undefined || isNonBlankString(query, 512))) {
    return { ...scope, operation: "prior_knowledge_read" as const, findingId, sourceId, revision, offset, query };
  }
  if (operation === "prior_knowledge_write" && hasOnlyKeys(args, ["operation", "input"]) && isRecord(input) &&
    hasOnlyKeys(input, ["expectedRevision", "changes"]) && isOffset(input.expectedRevision) &&
    Array.isArray(input.changes) && (jsonBytes(input.changes) ?? Infinity) <= MAX_BATCH_BYTES) {
    return { ...scope, operation: "prior_knowledge_write" as const, input };
  }
  return null;
}

export function executeAgentKnowledgeRequest(
  request: NonNullable<ReturnType<typeof parseAgentKnowledgeRequest>>, currentRoot: () => string | null,
) {
  const current = () => currentRoot() === request.workspaceRoot && request.expiresAt > Date.now();
  const assertCurrent = () => {
    if (!current()) throw toolError("The request expired or its project is no longer open.", "prior_knowledge_scope_changed");
  };
  return runAgentTool("lattice:prior-knowledge-tool-result", request.id, "prior_knowledge_failed", async () => {
    assertCurrent();
    const kind = "prior_knowledge";
    if (request.operation === "prior_knowledge_write") {
      return { kind, ...await writeKnowledge(request.workspaceRoot, request.input, "agent", current) };
    }
    const state = await loadKnowledge(request.workspaceRoot);
    assertCurrent();
    const common = { kind, revision: state.revision, journal: KNOWLEDGE_FILE };
    if (request.findingId) {
      const history = state.findings.get(request.findingId) ?? [];
      const finding = request.revision === undefined ? history.at(-1) : history[request.revision - 1];
      if (!finding) throw toolError("Finding or revision not found.", "prior_knowledge_finding_missing");
      const sources = [...new Set(finding.evidence.map(({ sourceId }) => sourceId))].map((sourceId) => state.sources.get(sourceId));
      return { ...common, finding, sources, revisionCount: history.length };
    }
    if (request.sourceId) {
      const source = state.sources.get(request.sourceId);
      if (!source) throw toolError("Source not found.", "prior_knowledge_source_missing");
      return { ...common, source };
    }
    const query = request.query ?? "";
    const offset = request.offset ?? 0;
    const sources = [...state.sources.values()].filter((source) => knowledgeMatches(Object.values(source).join(" "), query));
    const findings = [...state.findings.values()].flatMap((history) => history.slice(-1)).reverse()
      .filter((finding) => knowledgeMatches(JSON.stringify(finding), query));
    return {
      ...common,
      sources: sources.slice(offset, offset + 20).map(({ id, title, kind: sourceKind }) => ({ id, title, kind: sourceKind })),
      findings: findings.slice(offset, offset + 20).map(({ id, title, kind: findingKind, status, revision: version, statement }) =>
        ({ id, title, kind: findingKind, status, revision: version, summary: statement.slice(0, 320) })),
      nextOffset: offset + 20 < Math.max(findings.length, sources.length) ? offset + 20 : null,
      totalFindings: findings.length,
      totalSources: sources.length,
      discovery: ["search_library", "search_literature", "search_web", "fetch_paper", "fetch_web_reference", "experiments_read"],
      notebook: "main.md",
    };
  });
}
