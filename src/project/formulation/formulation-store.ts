/* eslint-disable lingui/no-unlocalized-strings -- Journal errors also go to agent callers. */
import { invoke } from "@tauri-apps/api/core";
import { appendFormulation, replayFormulation, type FormulationActor } from "./formulation-model";

export const FORMULATION_JOURNAL = "problem-formulation.json";
const changed = "lattice:formulation-changed";
const queues = new Map<string, Promise<unknown>>();

export function subscribeFormulation(root: string, refresh: () => void) {
  const listener = (event: Event) => {
    if ((event as CustomEvent<string>).detail === root) refresh();
  };
  window.addEventListener(changed, listener);
  return () => window.removeEventListener(changed, listener);
}

async function readJournal(root: string) {
  try {
    return await invoke<string>("read_project_file", { projectRoot: root, path: FORMULATION_JOURNAL });
  } catch (error) {
    const stat = await invoke<{ exists: boolean }>("stat_project_file", { path: FORMULATION_JOURNAL });
    if (stat.exists) throw error;
    return null;
  }
}

export async function loadFormulation(root: string) {
  return replayFormulation(await readJournal(root) ?? "");
}

export function writeFormulation(root: string, input: unknown, actor: FormulationActor, current: () => boolean) {
  const previous = queues.get(root) ?? Promise.resolve();
  const task = previous.catch(() => undefined).then(async () => {
    if (!current()) throw new Error("The project is no longer open.");
    let raw = await readJournal(root);
    if (!current()) throw new Error("The project is no longer open.");
    const next = appendFormulation(raw ?? "", input, actor);
    if (raw === null) {
      await invoke("create_project_entry", { projectRoot: root, path: FORMULATION_JOURNAL, kind: "file" });
      raw = await readJournal(root);
      if (raw?.trim() !== "{}") throw new Error("The formulation changed. Read the latest revision before retrying.");
    }
    if (!current()) throw new Error("The project is no longer open.");
    const result = await invoke<{ content: string; hadConflicts: boolean }>("write_project_file", {
      projectRoot: root, path: FORMULATION_JOURNAL, content: next.raw, expectedContent: raw,
    });
    if (result.hadConflicts || result.content !== next.raw) throw new Error("The formulation changed. Read the latest revision before retrying.");
    window.dispatchEvent(new CustomEvent(changed, { detail: root }));
    return next.state;
  });
  queues.set(root, task);
  void task.finally(() => { if (queues.get(root) === task) queues.delete(root); }).catch(() => undefined);
  return task;
}
