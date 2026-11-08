/* eslint-disable lingui/no-unlocalized-strings -- Agent tool protocol and diagnostics. */
import { isRecord } from "../app-utils";
import { hasOnlyKeys, isNonBlankString, parseToolEnvelope, runAgentTool, toolError } from "./agent-protocol";

const PANELS = ["formulation", "prior-knowledge", "mind-map", "experiments", "research-progress", "web-knowledge"] as const;
type ResearchPanel = typeof PANELS[number];
type PanelAction = "show" | "close";
type PanelRequest = {
  id: string;
  expiresAt: number;
  workspaceRoot: string;
  args: { operation: "panel"; panel: ResearchPanel; action: PanelAction };
};

export type SetResearchPanel = (panel: ResearchPanel, action: PanelAction) => void;

export function parseAgentPanelRequest(value: unknown): PanelRequest | null {
  const request = parseToolEnvelope(value, "synara:mind-map-tool-request", ["args", "workspaceRoot"]);
  if (!request || !isNonBlankString(request.workspaceRoot, 4096) || !isRecord(request.args)) return null;
  const { operation, panel, action } = request.args;
  if (operation !== "panel" || (action !== "show" && action !== "close")
      || !PANELS.some((candidate) => candidate === panel)
      || !hasOnlyKeys(request.args, ["operation", "panel", "action"])) return null;
  return request as unknown as PanelRequest;
}

export function executeAgentPanelRequest(
  request: PanelRequest, currentProjectRoot: () => string | null, setPanel: SetResearchPanel,
) {
  return runAgentTool("lattice:mind-map-tool-result", request.id, "research_panel_failed", () => {
    if (request.expiresAt <= Date.now()) throw toolError("The panel request expired.", "research_panel_expired");
    if (currentProjectRoot() !== request.workspaceRoot) {
      throw toolError("The requested project is no longer open.", "research_panel_project_changed");
    }
    const { panel, action } = request.args;
    setPanel(panel, action);
    return { kind: "research_panel", panel, action };
  });
}
