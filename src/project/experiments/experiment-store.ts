/* eslint-disable lingui/no-unlocalized-strings -- Protocol and journal errors. */
import { invoke } from "@tauri-apps/api/core";
import { appendExperiment, jsonPointer, replayExperiments, type Experiment, type ExperimentEvent } from "./experiment-model";

export const EXPERIMENT_JOURNAL = "experiments.json";
const listeners = new Map<string, Set<() => void>>();
const queues = new Map<string, Promise<unknown>>();

export function subscribeExperiments(root: string, listener: () => void) {
  const group = listeners.get(root) ?? new Set();
  listeners.set(root, group);
  group.add(listener);
  return () => {
    group.delete(listener);
    if (!group.size) listeners.delete(root);
  };
}

async function readJournal(root: string): Promise<string | null> {
  try {
    return await invoke<string>("read_project_file", { projectRoot: root, path: EXPERIMENT_JOURNAL });
  } catch (error) {
    const stat = await invoke<{ exists: boolean }>("stat_project_file", { path: EXPERIMENT_JOURNAL });
    if (stat.exists) throw error;
    return null;
  }
}

async function sha256(text: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function loadExperiments(root: string): Promise<Experiment[]> {
  const result = [...replayExperiments(await readJournal(root) ?? "").values()].reverse();
  const hashes = new Map<string, Promise<string | null>>();
  for (const experiment of result) {
    const verified = experiment.verified;
    if (!verified) continue;
    let hash = hashes.get(verified.path);
    if (!hash) {
      hash = invoke<string>("read_project_file", { projectRoot: root, path: verified.path }).then(sha256).catch(() => null);
      hashes.set(verified.path, hash);
    }
    if (await hash !== verified.sha256) delete experiment.verified;
  }
  return result;
}

export function writeExperiment(root: string, input: unknown, actor: ExperimentEvent["actor"], stillCurrent: () => boolean) {
  const prior = queues.get(root) ?? Promise.resolve();
  const task = prior.catch(() => undefined).then(async () => {
    if (!stillCurrent()) throw new Error("The project is no longer open.");
    let raw = await readJournal(root);
    if (!stillCurrent()) throw new Error("The project is no longer open.");
    // Validate before creating the journal. Compare-and-swap prevents overwriting external edits.
    const next = appendExperiment(raw ?? "", input, actor);
    if (raw === null) {
      await invoke("create_project_entry", { projectRoot: root, path: EXPERIMENT_JOURNAL, kind: "file" });
      raw = await readJournal(root);
      if (raw?.trim() !== "{}") throw new Error("Experiment journal changed. Reload before retrying.");
    }
    if (!stillCurrent()) throw new Error("The project is no longer open.");
    const result = await invoke<{ content: string; hadConflicts: boolean }>("write_project_file", {
      projectRoot: root, path: EXPERIMENT_JOURNAL, content: next.raw, expectedContent: raw,
    });
    if (result.hadConflicts || result.content !== next.raw) throw new Error("Experiment journal changed. Reload before retrying.");
    for (const listener of listeners.get(root) ?? []) listener();
    return next.experiment;
  });
  queues.set(root, task);
  void task.finally(() => { if (queues.get(root) === task) queues.delete(root); }).catch(() => undefined);
  return task;
}

export async function verifyExperiment(
  root: string, experiment: Experiment,
  input: { path: string; pointer: string; correctnessPointer: string; expected: string | number | boolean },
  stillCurrent: () => boolean,
) {
  if (!experiment.metric || !experiment.evidence.some((e) => e.kind === "result" && e.path === input.path)) {
    throw new Error("Select a linked JSON result and record its reported metric first.");
  }
  if (input.pointer === input.correctnessPointer) throw new Error("Choose a separate field for the correctness check.");
  const raw = await invoke<string>("read_project_file", { projectRoot: root, path: input.path });
  const document: unknown = JSON.parse(raw);
  if (jsonPointer(document, input.pointer) !== experiment.metric.value) throw new Error("The saved result does not match the reported metric.");
  if (jsonPointer(document, input.correctnessPointer) !== input.expected) throw new Error("The saved result does not pass the selected correctness check.");
  return writeExperiment(root, {
    operation: "verify", id: experiment.id,
    verification: { ...input, sha256: await sha256(raw), metric: experiment.metric },
  }, "human", stillCurrent);
}
