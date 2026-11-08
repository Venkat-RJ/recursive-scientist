/* eslint-disable lingui/no-unlocalized-strings -- Journal errors are shared with agent callers. */
import { invoke } from "@tauri-apps/api/core";
import { changesReach, onProjectFilesChanged } from "../project-files-changed";
import { appendKnowledge, KNOWLEDGE_FILE, readKnowledge } from "./knowledge-model";

const writes = new EventTarget();
const read = (projectRoot: string) => invoke<string | null>("read_prior_knowledge", { projectRoot });

export function subscribeKnowledge(root: string, refresh: () => void) {
  const listen = (event: Event) => {
    if ((event as CustomEvent<string>).detail === root) refresh();
  };
  writes.addEventListener("write", listen);
  const stop = onProjectFilesChanged(root, (paths) => {
    if (changesReach(paths, KNOWLEDGE_FILE)) refresh();
  });
  return () => {
    writes.removeEventListener("write", listen);
    stop();
  };
}

export async function loadKnowledge(root: string) {
  return readKnowledge(await read(root));
}

export async function writeKnowledge(root: string, input: unknown, actor: "human" | "agent", current: () => boolean) {
  if (!current()) throw new Error("The project is no longer open or the request expired.");
  const expected = await read(root);
  const next = appendKnowledge(expected, input, actor);
  if (!current()) throw new Error("The project is no longer open or the request expired.");
  await invoke("write_prior_knowledge", { projectRoot: root, expected, content: next.raw });
  writes.dispatchEvent(new CustomEvent("write", { detail: root }));
  return { revision: next.state.revision, written: next.written };
}
