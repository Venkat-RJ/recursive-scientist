import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { executeAgentMindMapRequest, parseAgentMindMapRequest } from "../agent/agent-mind-map-tools";
import { MindMapPanel } from "./mind-map-panel";

afterEach(() => {
  cleanup();
  localStorage.clear();
});

it("opens saved maps without an outline and edits a branch directly", () => {
  localStorage.setItem("lattice:mind-map:/project-a", "Research\n  Evidence\n    Sources\n  Questions");
  const close = vi.fn();
  const panel = render(<MindMapPanel projectRoot="/project-a" onClose={close} />);
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "Evidence" }));
  const input = screen.getByRole("textbox", { name: "Topic name" });
  fireEvent.change(input, { target: { value: "Findings" } });
  fireEvent.blur(input);

  fireEvent.click(screen.getByRole("button", { name: "Add branch" }));
  const branch = screen.getByRole("textbox", { name: "Topic name" });
  fireEvent.change(branch, { target: { value: "Reports" } });
  fireEvent.blur(branch);
  const findings = screen.getByRole("button", { name: "Findings" }).closest("li")!;
  expect(within(findings).getByRole("button", { name: "Reports" })).toBeInTheDocument();
  expect(within(findings).getByRole("button", { name: "Sources" })).toBeInTheDocument();

  panel.unmount();
  render(<MindMapPanel projectRoot="/project-a" onClose={close} />);
  expect(screen.getByRole("button", { name: "Reports" })).toBeInTheDocument();
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
});

it("applies scoped agent operations to the open panel and persists their node IDs", async () => {
  const root = "/project-a";
  const close = vi.fn();
  const panel = render(<MindMapPanel projectRoot={root} onClose={close} />);
  const run = async (args: object, workspaceRoot = root) => {
    const request = parseAgentMindMapRequest({
      type: "synara:mind-map-tool-request", version: 1, id: "test",
      expiresAt: Date.now() + 30_000, workspaceRoot, args,
    });
    expect(request).not.toBeNull();
    return executeAgentMindMapRequest(request!, root);
  };
  expect(await run({ operation: "read" })).toMatchObject({
    ok: true, result: { nodes: [{ id: "topic-0", parentId: null }, { parentId: "topic-0" }, { parentId: "topic-0" }] },
  });
  expect(await run({ operation: "add", nodeId: "topic-0", label: "Wrong project" }, "/project-b")).toMatchObject({ ok: false });
  await act(async () => {
    expect(await run({ operation: "add", nodeId: "topic-0", label: "Agent branch" })).toMatchObject({ ok: true });
  });
  expect(screen.getByRole("button", { name: "Agent branch" })).toBeInTheDocument();
  const snapshot = JSON.parse(localStorage.getItem(`lattice:mind-map:${root}`)!);
  const { id } = snapshot.topics.at(-1);
  await act(async () => {
    expect(await run({ operation: "rename", nodeId: id, label: "Renamed branch" })).toMatchObject({ ok: true });
  });
  panel.unmount();
  render(<MindMapPanel projectRoot={root} onClose={close} />);
  expect(screen.getByRole("button", { name: "Renamed branch" })).toBeInTheDocument();
  await act(async () => {
    expect(await run({ operation: "delete", nodeId: id })).toMatchObject({ ok: true, result: { deletedCount: 1 } });
  });
  expect(screen.queryByRole("button", { name: "Renamed branch" })).not.toBeInTheDocument();
  expect(await run({ operation: "delete", nodeId: "topic-0" })).toMatchObject({ ok: false });
});
