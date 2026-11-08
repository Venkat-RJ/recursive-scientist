/* eslint-disable lingui/no-unlocalized-strings -- Store errors are reported to the agent. The panel shows its localized save error. */

export type MindMapTopic = { id: string; label: string; depth: number };
export type MindMapEdit =
  | { operation: "add"; nodeId: string; label: string }
  | { operation: "rename"; nodeId: string; label: string }
  | { operation: "delete"; nodeId: string };

export const MIND_MAP_LABEL_LIMIT = 160;
const NODE_LIMIT = 256;
const DEPTH_LIMIT = 32;
const CHANGED = "lattice:mind-map-changed";
const keyFor = (root: string) => `lattice:mind-map:${root}`;
const defaultTopics = (labels: readonly string[]): MindMapTopic[] =>
  labels.map((label, index) => ({ id: `topic-${index}`, label, depth: index === 0 ? 0 : 1 }));

function readStored(root: string): string | null {
  return localStorage.getItem(keyFor(root));
}

export function mindMapSnapshot(root: string): string | null {
  try { return readStored(root); }
  catch { return null; }
}

export function subscribeMindMap(root: string, listener: () => void): () => void {
  const changed = (event: Event) => {
    if ((event as CustomEvent<string>).detail === root) listener();
  };
  const storage = (event: StorageEvent) => {
    if (event.key === null || event.key === keyFor(root)) listener();
  };
  window.addEventListener(CHANGED, changed);
  window.addEventListener("storage", storage);
  return () => {
    window.removeEventListener(CHANGED, changed);
    window.removeEventListener("storage", storage);
  };
}

export function decodeMindMap(raw: string | null, labels: readonly string[]): MindMapTopic[] {
  const starter = defaultTopics(labels);
  if (raw === null) return starter;
  if (raw.startsWith('{"version":')) {
    const value = JSON.parse(raw) as { version?: unknown; topics?: unknown };
    const topics = value.topics as MindMapTopic[];
    const ids = new Set<string>();
    if (value.version !== 1 || !Array.isArray(topics) || !topics.length || !topics.every((topic, index) => {
      if (!topic || typeof topic.id !== "string" || !topic.id || ids.has(topic.id) || typeof topic.label !== "string" ||
          !Number.isSafeInteger(topic.depth) || (index === 0 ? topic.depth !== 0 : topic.depth < 1 || topic.depth > topics[index - 1].depth + 1)) return false;
      ids.add(topic.id);
      return true;
    })) throw new Error("The saved mind map is invalid.");
    return topics;
  }

  // Migrate the original outline format without changing its labels or order.
  const levels: number[] = [];
  const topics: MindMapTopic[] = [];
  for (const line of raw.split("\n")) {
    const label = line.trim();
    if (!label) continue;
    const indent = line.length - line.trimStart().length;
    while (levels.length && indent <= levels[levels.length - 1]) levels.pop();
    topics.push({ id: `topic-${topics.length}`, label, depth: topics.length ? Math.max(1, levels.length) : 0 });
    levels.push(indent);
  }
  return topics.length ? topics : starter.slice(0, 1);
}

export function readMindMap(root: string, labels: readonly string[]) {
  return decodeMindMap(readStored(root), labels);
}

export function editMindMap(root: string, labels: readonly string[], edit: MindMapEdit) {
  const topics = readMindMap(root, labels);
  const index = topics.findIndex(({ id }) => id === edit.nodeId);
  if (index === -1) throw new Error("The mind map node no longer exists. Read the map again.");
  const topic = topics[index];
  let end = index + 1;
  while (end < topics.length && topics[end].depth > topic.depth) end++;
  if (edit.operation === "delete" && index === 0) throw new Error("The main topic cannot be deleted.");
  if (edit.operation !== "delete" &&
      (!edit.label.trim() || edit.label.length > MIND_MAP_LABEL_LIMIT || /[\r\n]/.test(edit.label))) {
    throw new Error("Use a nonempty, single-line topic name of at most 160 characters.");
  }
  if (edit.operation === "add" && (topics.length >= NODE_LIMIT || topic.depth >= DEPTH_LIMIT)) {
    throw new Error("The mind map has reached its node or nesting limit.");
  }

  let node = topic;
  if (edit.operation === "add") {
    node = { id: crypto.randomUUID(), label: edit.label.trim(), depth: topic.depth + 1 };
    topics.splice(end, 0, node);
  } else if (edit.operation === "rename") {
    node = { ...topic, label: edit.label.trim() };
    topics[index] = node;
  } else {
    topics.splice(index, end - index);
  }
  localStorage.setItem(keyFor(root), JSON.stringify({ version: 1, topics }));
  window.dispatchEvent(new CustomEvent(CHANGED, { detail: root }));
  return { node, ...(edit.operation === "delete" ? { deletedCount: end - index } : {}) };
}
