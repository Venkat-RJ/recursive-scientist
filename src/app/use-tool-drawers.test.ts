import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { TrellisController } from "../trellis/trellis-controller";
import type { AgentTurnReview } from "./app-synara-embed";
import { useToolDrawers } from "./use-tool-drawers";

afterEach(cleanup);

function renderTools(commentsKind: "comments" | "overleaf" = "comments") {
  const deps = {
    trellis: { revealOpenTool: vi.fn() },
    synara: { requestRuntime: vi.fn(), origin: "http://synara.test", sourceControlFrameRef: { current: null } },
    comments: { openPanel: vi.fn(), openReply: vi.fn(), closePanel: vi.fn() },
    references: { setLiteratureOpen: vi.fn() },
    refreshTodos: vi.fn(async () => undefined),
    refreshWordCount: vi.fn(async () => undefined),
  };
  const view = renderHook(() => useToolDrawers({
    ...deps, commentsKind, commentsOpen: false, trellis: deps.trellis as unknown as TrellisController,
  }));
  return { view, ...deps };
}

it("opens a drawer it owns after bringing its content up to date, then reveals its panel", () => {
  const { view, trellis, refreshTodos, refreshWordCount } = renderTools();
  act(() => view.result.current.open("checklist"));
  expect(refreshTodos).toHaveBeenCalledTimes(1);
  expect(refreshWordCount).toHaveBeenCalledTimes(1);
  expect(view.result.current.isOpen).toEqual({ "web-knowledge": false, "github-knowledge": false, history: false, git: false, todos: false, checklist: true, "mind-map": false, formulation: false, "prior-knowledge": false, experiments: false, "research-progress": false, start: false });
  expect(trellis.revealOpenTool).toHaveBeenCalledWith("checklist");

  act(() => view.result.current.open("todos"));
  expect(refreshTodos).toHaveBeenCalledTimes(2);
  expect(view.result.current.isOpen.todos).toBe(true);

  act(() => view.result.current.close("checklist"));
  expect(view.result.current.isOpen.checklist).toBe(false);
});

it("starts the agent runtime for Git and pins or unpins a turn review", () => {
  const { view, synara } = renderTools();
  const review = { threadId: "t", turnCount: 2, filePath: null } as unknown as AgentTurnReview;
  act(() => view.result.current.open("git", { turnReview: review }));
  expect(synara.requestRuntime).toHaveBeenCalled();
  expect(view.result.current.isOpen.git).toBe(true);
  expect(view.result.current.turnReview).toBe(review);

  act(() => view.result.current.showGitView("pull-requests"));
  expect(view.result.current.turnReview).toBeNull();
  expect(view.result.current.gitView).toBe("pull-requests");

  act(() => view.result.current.open("git", { gitView: "changes" }));
  expect(view.result.current.gitView).toBe("changes");
});

it("routes comments to the surface the project uses and literature to its own drawer", () => {
  const { view, trellis, comments, references } = renderTools("overleaf");
  act(() => view.result.current.open("comments"));
  expect(comments.openPanel).toHaveBeenCalledTimes(1);
  expect(trellis.revealOpenTool).toHaveBeenLastCalledWith("overleaf");

  act(() => view.result.current.open("comments", { replyTo: "c1" }));
  expect(comments.openReply).toHaveBeenCalledWith("c1");
  expect(comments.openPanel).toHaveBeenCalledTimes(1);

  act(() => view.result.current.open("literature"));
  expect(references.setLiteratureOpen).toHaveBeenCalledWith(true);
  expect(trellis.revealOpenTool).toHaveBeenLastCalledWith("literature");
  expect(view.result.current.isOpen).toEqual({ "web-knowledge": false, "github-knowledge": false, history: false, git: false, todos: false, checklist: false, "mind-map": false, formulation: false, "prior-knowledge": false, experiments: false, "research-progress": false, start: false });
});

it("forgets the outgoing project's TODO list and turn review", () => {
  const { view } = renderTools();
  const review = { threadId: "t", turnCount: 1, filePath: null } as unknown as AgentTurnReview;
  act(() => {
    view.result.current.open("todos");
    view.result.current.open("history");
    view.result.current.open("git", { turnReview: review });
  });
  act(() => view.result.current.resetForProject());
  expect(view.result.current.isOpen).toEqual({ "web-knowledge": false, "github-knowledge": false, history: true, git: true, todos: false, checklist: false, "mind-map": false, formulation: false, "prior-knowledge": false, experiments: false, "research-progress": false, start: false });
  expect(view.result.current.turnReview).toBeNull();
});

it("closes Git when the source control embed asks to", () => {
  const frame = { contentWindow: {} as Window };
  const { view, synara } = renderTools();
  (synara.sourceControlFrameRef as { current: unknown }).current = frame;
  act(() => view.result.current.open("git"));
  act(() => {
    window.dispatchEvent(new MessageEvent("message", {
      data: { type: "lattice:close-source-control" }, origin: "http://elsewhere.test", source: frame.contentWindow,
    }));
  });
  expect(view.result.current.isOpen.git).toBe(true);
  act(() => {
    window.dispatchEvent(new MessageEvent("message", {
      data: { type: "lattice:close-source-control" }, origin: synara.origin, source: frame.contentWindow,
    }));
  });
  expect(view.result.current.isOpen.git).toBe(false);
});

it("reveals Mind Map as a project tool and closes it when the project changes", () => {
  const { view, trellis } = renderTools();
  act(() => view.result.current.open("mind-map"));
  expect(view.result.current.isOpen["mind-map"]).toBe(true);
  expect(trellis.revealOpenTool).toHaveBeenCalledWith("mind-map");
  act(() => view.result.current.resetForProject());
  expect(view.result.current.isOpen["mind-map"]).toBe(false);
});

it("opens Research Progress and forwards experiment drill-through within the current project", () => {
  const { view, trellis } = renderTools();
  act(() => view.result.current.open("research-progress"));
  expect(view.result.current.isOpen["research-progress"]).toBe(true);
  expect(trellis.revealOpenTool).toHaveBeenCalledWith("research-progress");

  act(() => view.result.current.open("experiments", { experimentId: "E-004" }));
  expect(view.result.current.experimentSelection?.id).toBe("E-004");
  act(() => view.result.current.open("experiments", { experimentId: "E-011" }));
  expect(view.result.current.experimentSelection?.id).toBe("E-011");
  act(() => view.result.current.resetForProject());
  expect(view.result.current.experimentSelection).toBeUndefined();
  expect(view.result.current.isOpen["research-progress"]).toBe(false);
});
