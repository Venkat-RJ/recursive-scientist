import { expect, it, vi } from "vitest";
import { executeAgentPanelRequest, parseAgentPanelRequest } from "./agent-panel-tools";

const workspaceRoot = "/research";
const envelope = {
  type: "synara:mind-map-tool-request",
  version: 1,
  id: "panel-request",
  workspaceRoot,
  expiresAt: Number.MAX_SAFE_INTEGER,
};

it("dispatches show and close for supported research panels", async () => {
  const setPanel = vi.fn();
  for (const action of ["show", "close"]) {
    const request = parseAgentPanelRequest({
      ...envelope, args: { operation: "panel", panel: "research-progress", action },
    });
    expect(request).not.toBeNull();
    expect(await executeAgentPanelRequest(request!, () => workspaceRoot, setPanel)).toMatchObject({
      ok: true, result: { kind: "research_panel", panel: "research-progress", action },
    });
    expect(setPanel).toHaveBeenLastCalledWith("research-progress", action);
  }
});

it("rejects unknown panels and never changes a different project or accepts an expired request", async () => {
  const setPanel = vi.fn();
  const args = { operation: "panel", panel: "mind-map", action: "show" };
  expect(parseAgentPanelRequest({ ...envelope, args: { ...args, panel: "agent" } })).toBeNull();
  expect(parseAgentPanelRequest({ ...envelope, args: { ...args, action: "toggle" } })).toBeNull();
  const request = parseAgentPanelRequest({ ...envelope, args })!;
  expect(await executeAgentPanelRequest(request, () => "/other", setPanel)).toMatchObject({
    ok: false, error: { code: "research_panel_project_changed" },
  });
  expect(await executeAgentPanelRequest({ ...request, expiresAt: 0 }, () => workspaceRoot, setPanel)).toMatchObject({
    ok: false, error: { code: "research_panel_expired" },
  });
  expect(setPanel).not.toHaveBeenCalled();
});
