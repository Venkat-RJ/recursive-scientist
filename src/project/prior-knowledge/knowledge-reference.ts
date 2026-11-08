import { isKnowledgeId, KNOWLEDGE_FILE } from "./knowledge-model";

export type KnowledgeReference = { id: string; revision: number };

export function knowledgeReferencePath({ id, revision }: KnowledgeReference) {
  return KNOWLEDGE_FILE + "#" + id + "@" + revision;
}

export function parseKnowledgeReference(path: string): KnowledgeReference | null {
  const [file, fragment, extra] = path.split("#");
  if (file !== KNOWLEDGE_FILE || !fragment || extra !== undefined) return null;
  const [id, version, remainder] = fragment.split("@");
  if (!isKnowledgeId(id) || !/^\d+$/.test(version ?? "") || remainder !== undefined) return null;
  const revision = Number(version);
  return Number.isSafeInteger(revision) && revision > 0 ? { id, revision } : null;
}
