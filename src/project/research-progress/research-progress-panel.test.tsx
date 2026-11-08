import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { afterEach, expect, it, vi } from "vitest";
import type { ExperimentEvent, Metric } from "../experiments/experiment-model";
import { ResearchProgressPanel } from "./research-progress-panel";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });

const root = "/research";
const at = "2026-11-07T12:00:00.000Z";
const report = '{"value":20,"valid":true}';
const sha256 = "f505bcef6186fe93723bbc5063a31f0b7590567e4f63b63bbc1d674c3568c516";
const metric = (value: number, evaluation = "Training v1"): Metric => ({ name: "Cost", unit: "points", direction: "lower", evaluation, value });

function events(id: string, extra: ExperimentEvent[] = []): ExperimentEvent[] {
  return [{
    operation: "create", id, actor: "agent", at,
    fields: { title: id, hypothesis: "Bounded search improves cost.", prediction: "Lower cost.", motivation: "Test the change.", learningGoal: "Check the neighborhood." },
  }, ...extra];
}

function setup(events: ExperimentEvent[]) {
  const files = new Map([
    ["main.md", "## Research objective\n\nLower benchmark cost.\n\n## Research plan\n\nTest the candidate.\n"],
    ["results/candidate.json", report],
  ]);
  const write = (journal: ExperimentEvent[]) => files.set("experiments.json", JSON.stringify({ version: 1, events: journal }));
  write(events);
  let notify = (_paths: string[], _root = root) => {};
  vi.mocked(listen).mockImplementation(async (_event, handler) => {
    notify = (paths, projectRoot = root) => handler({ event: "project-fs-changed", id: 1, payload: { paths, root: projectRoot } });
    return () => undefined;
  });
  vi.mocked(invoke).mockImplementation(async (command, args) => {
    const path = (args as { path: string }).path;
    if (command === "stat_project_file") return { exists: files.has(path) };
    if (command !== "read_project_file" || !files.has(path)) throw new Error("Missing project file.");
    return files.get(path);
  });
  const openExperiment = vi.fn();
  const openFile = vi.fn();
  render(<ResearchProgressPanel root={root} onClose={vi.fn()} openExperiment={openExperiment} openTool={vi.fn()} openFile={openFile} />);
  return { write, notify, files, openExperiment, openFile };
}

it("tracks journal transitions and rechecks verification when its evidence changes", async () => {
  const id = "E-001";
  const planned = events(id);
  const running: ExperimentEvent[] = [...planned, {
    operation: "update", actor: "agent", id, at, fields: { status: "running", progress: "Evaluator started.", budget: "One local run." },
  }];
  const completed: ExperimentEvent[] = [...running, {
    operation: "update", actor: "agent", id, at,
    fields: { status: "completed", metric: metric(20), evidence: [{ kind: "result", path: "results/candidate.json" }] },
  }];
  const verified: ExperimentEvent[] = [...completed, {
    operation: "verify", actor: "human", id, at,
    verification: { path: "results/candidate.json", pointer: "/value", correctnessPointer: "/valid", expected: true, sha256, metric: metric(20) },
  }];
  const { write, files, notify, openExperiment, openFile } = setup(planned);
  await screen.findByText("Waiting · planned", { exact: true });
  fireEvent.click(await screen.findByRole("button", { name: "Research plan" }));
  expect(openFile).toHaveBeenCalledWith("main.md", 5);

  write(running);
  await act(async () => notify(["experiments.json"], "/different-project"));
  expect(screen.queryByText("Recorded running", { exact: true })).not.toBeInTheDocument();
  await act(async () => notify(["experiments.json"]));
  await screen.findByText("Evaluator started.");
  expect(screen.queryByRole("figure", { name: "Experiment progression" })).not.toBeInTheDocument();

  write(completed);
  await act(async () => notify(["experiments.json"]));
  fireEvent.click(await screen.findByRole("button", { name: "E-001, 20, Reported" }));
  expect(openExperiment).toHaveBeenCalledWith(id);
  expect(screen.getByText(/Last saved result/)).toHaveTextContent("unverified");

  write(verified);
  await act(async () => notify(["experiments.json"]));
  await screen.findByRole("button", { name: "E-001, 20, Verified" });
  expect(screen.queryByText(/Last saved result/)).not.toBeInTheDocument();

  files.set("results/candidate.json", report + "\n");
  await act(async () => notify(["results/candidate.json"]));
  await screen.findByRole("button", { name: "E-001, 20, Reported" });
  expect(screen.getByText(/Last saved result/)).toHaveTextContent("unverified");
});

it("switches evaluation cohorts without carrying a point or comparator across them", async () => {
  const completed = (id: string, measurement: Metric): ExperimentEvent[] => events(id, [
    { operation: "update", actor: "agent", id, at, fields: { status: "running" } },
    { operation: "update", actor: "agent", id, at, fields: { status: "completed", metric: measurement } },
  ]);
  setup([...completed("E-TRAIN", metric(1)), ...completed("E-TEST", metric(40, "Held-out v1"))]);
  const picker = await screen.findByLabelText("Metric & evaluation");
  const heldOut = within(picker).getByRole<HTMLOptionElement>("option", { name: /Held-out v1/ });
  fireEvent.change(picker, { target: { value: heldOut.value } });
  expect(screen.getByRole("button", { name: "E-TEST, 40, Reported" })).toBeVisible();
  expect(screen.queryByRole("button", { name: /E-TRAIN, 1/ })).not.toBeInTheDocument();
  const compare = screen.getByLabelText("Compare with");
  expect(compare).not.toBeVisible();
  fireEvent.click(screen.getByText("Inspect & compare results"));
  expect(compare).toBeVisible();
  expect(within(compare).getAllByRole("option")).toHaveLength(1);
});
