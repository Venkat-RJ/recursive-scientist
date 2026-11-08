/* eslint-disable lingui/no-unlocalized-strings -- Agent tool protocol and diagnostics. */
import { msg } from "@lingui/core/macro";
import { isRecord } from "../app-utils";
import { i18n } from "../i18n";
import { editMindMap, MIND_MAP_LABEL_LIMIT, readMindMap, type MindMapEdit } from "../project/mind-map-store";
import { hasOnlyKeys, isNonBlankString, parseToolEnvelope, runAgentTool, toolError } from "./agent-protocol";

export const MIND_MAP_STARTER_LABELS = [msg`Main topic`, msg`First idea`, msg`Second idea`];
const REQUEST = "synara:mind-map-tool-request";
const RESULT = "lattice:mind-map-tool-result";

type Request = { id: string; expiresAt: number; workspaceRoot: string; args: MindMapEdit | { operation: "read" } };

export function parseAgentMindMapRequest(value: unknown): Request | null {
  const request = parseToolEnvelope(value, REQUEST, ["args", "workspaceRoot"]);
  if (!request || !isNonBlankString(request.workspaceRoot, 4096) || !isRecord(request.args)) return null;
  const { args } = request;
  if (args.operation === "read" && hasOnlyKeys(args, ["operation"])) return request as unknown as Request;
  if (!isNonBlankString(args.nodeId, 128)) return null;
  if (args.operation === "delete" && hasOnlyKeys(args, ["operation", "nodeId"])) return request as unknown as Request;
  if ((args.operation === "add" || args.operation === "rename") && hasOnlyKeys(args, ["operation", "nodeId", "label"]) &&
      isNonBlankString(args.label, MIND_MAP_LABEL_LIMIT) && !/[\r\n]/.test(args.label)) return request as unknown as Request;
  return null;
}

export function executeAgentMindMapRequest(request: Request, currentProjectRoot: string | null) {
  return runAgentTool(RESULT, request.id, "mind_map_failed", () => {
    if (request.expiresAt <= Date.now()) throw toolError("The Mind Map request expired.", "mind_map_expired");
    if (currentProjectRoot !== request.workspaceRoot) throw toolError("The requested project is no longer open.", "mind_map_project_changed");
    const labels = MIND_MAP_STARTER_LABELS.map((label) => i18n._(label));
    if (request.args.operation === "read") {
      const parents: string[] = [];
      const nodes = readMindMap(request.workspaceRoot, labels).map(({ id, label, depth }) => {
        const parentId = depth > 0 ? parents[depth - 1] : null;
        parents[depth] = id;
        return { id, label, parentId };
      });
      return { kind: "mind_map", nodes };
    }
    const { node, deletedCount } = editMindMap(request.workspaceRoot, labels, request.args);
    return { kind: "mind_map", operation: request.args.operation, nodeId: node.id, ...(deletedCount === undefined ? { label: node.label } : { deletedCount }) };
  });
}
