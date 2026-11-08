/* eslint-disable lingui/no-unlocalized-strings -- Scientific record and agent protocol. */
import { isNonBlankString, isWorkspaceRelativePath, jsonBytes } from "../../agent/agent-protocol";
import { isRecord } from "../../app-utils";

export const KNOWLEDGE_FILE = "prior-knowledge.json";
export const SOURCE_KINDS = ["paper", "implementation", "benchmark", "dataset", "experiment", "project", "web"] as const;
export const FINDING_KINDS = ["method", "assumption", "result", "limitation", "comparison", "opportunity", "question"] as const;
export const STATUSES = ["reported", "verified", "interpretation", "speculation"] as const;
export const RELATIONS = ["builds_on", "contradicts", "questions", "compares"] as const;
export const COMPARABILITY = ["matched", "partially_matched", "different", "unknown"] as const;
export const METHOD_FIELDS = ["mechanism", "assumptions", "protocol", "outcome", "limitations"] as const;
export const MAX_BATCH_BYTES = 32_768;

type Actor = "human" | "agent";
type Source = {
  id: string; title: string; kind: typeof SOURCE_KINDS[number]; location: string;
};
type Evidence = { sourceId: string; locator: string; note: string };
type Relation = { id: string; revision: number; relation: typeof RELATIONS[number] };
export type Finding = {
  id: string; title: string; kind: typeof FINDING_KINDS[number]; status: typeof STATUSES[number];
  statement: string; evidence: Evidence[]; links: Relation[];
  method?: Record<typeof METHOD_FIELDS[number], string>;
  comparability?: typeof COMPARABILITY[number];
  verification?: string;
};
type Change = { source: Source } | { finding: Finding; reason?: string };
export type FindingVersion = Finding & { revision: number; actor: Actor; at: string; reason?: string };
type Event = { at: string; actor: Actor; changes: Change[] };
export type Knowledge = {
  revision: number; sources: Map<string, Source>; findings: Map<string, FindingVersion[]>;
};

type Replay = Knowledge & { locations: Set<string> };

export const isKnowledgeId = (value: unknown): value is string =>
  typeof value === "string" && /^[a-z0-9][a-z0-9-]{0,63}$/.test(value);

export function isKnowledgeUrl(value: string): boolean {
  if (!/^https?:\/\/[^\s\\]+$/i.test(value)) return false;
  try {
    const url = new URL(value);
    return !url.username && !url.password;
  } catch {
    return false;
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function field(value: unknown, name: string, limit: number): string {
  assert(isNonBlankString(value, limit), `${name} must contain 1 to ${limit} characters.`);
  return value.trim();
}

function choice<T extends string>(value: unknown, choices: readonly T[], name: string): T {
  assert(choices.some((item) => item === value), `Choose a valid ${name}.`);
  return value as T;
}

export function sourceKey(location: string) {
  if (!isKnowledgeUrl(location)) return location;
  const url = new URL(location);
  url.hash = "";
  if (url.hostname === "doi.org") return url.href.toLowerCase();
  return url.href.replace(/\/$/, "");
}

function addSource(value: unknown, state: Replay): Source {
  assert(isRecord(value) && isKnowledgeId(value.id), "Use a unique lowercase source ID (letters, digits and hyphens).");
  const id = value.id;
  assert(!state.sources.has(id), `Source ${id} already exists. Reuse its ID or add a distinct version of the source.`);
  const location = field(value.location, "Source location", 1024);
  assert(isKnowledgeUrl(location) || (isWorkspaceRelativePath(location) && !Array.from(location).some((character) => character.charCodeAt(0) < 32)),
    "Use an HTTP(S) URL or a project-relative source path.");
  const key = sourceKey(location);
  assert(!state.locations.has(key),
    "That source location is already recorded. Cite the existing source ID.");
  const source = { id, location, title: field(value.title, "Source title", 240), kind: choice(value.kind, SOURCE_KINDS, "source type") };
  state.sources.set(id, source);
  state.locations.add(key);
  return source;
}

function addFinding(value: unknown, reasonValue: unknown, event: Pick<Event, "actor" | "at">, state: Knowledge): Change {
  assert(isRecord(value) && isKnowledgeId(value.id), "Use a lowercase finding ID (letters, digits and hyphens).");
  const { id } = value;
  const kind = choice(value.kind, FINDING_KINDS, "finding type");
  const status = choice(value.status, STATUSES, "evidence status");
  assert(Array.isArray(value.evidence) && value.evidence.length <= 12, "Provide up to 12 citations.");
  const evidence = value.evidence.map((entry): Evidence => {
    assert(isRecord(entry) && isKnowledgeId(entry.sourceId) && state.sources.has(entry.sourceId), "Each citation must reference a recorded source ID.");
    return { sourceId: entry.sourceId, locator: field(entry.locator, "Evidence locator", 400), note: field(entry.note, "What the source supports", 1200) };
  });
  assert((status !== "reported" && status !== "verified") || evidence.length > 0, "Reported and verified findings require source evidence.");
  assert(Array.isArray(value.links) && value.links.length <= 16, "Provide up to 16 links to earlier findings.");
  const links = value.links.map((entry): Relation => {
    assert(isRecord(entry) && isKnowledgeId(entry.id) && entry.id !== id &&
      typeof entry.revision === "number" && Number.isSafeInteger(entry.revision) && entry.revision > 0 &&
      (state.findings.get(entry.id)?.length ?? 0) >= entry.revision, "Each link must name another finding and an existing revision.");
    return { id: entry.id, revision: entry.revision, relation: choice(entry.relation, RELATIONS, "relationship") };
  });
  assert(kind !== "opportunity" || evidence.length + links.length > 0, "Link a research opportunity to its supporting evidence or findings.");
  assert(kind !== "comparison" || new Set(links.filter((link) => link.relation === "compares").map((link) => link.id)).size >= 2,
    "A comparison needs links to at least two distinct findings using the compares relationship.");
  const finding: Finding = {
    id, kind, status, evidence, links, title: field(value.title, "Finding title", 240),
    statement: field(value.statement, "Finding statement", 3000),
  };
  if (kind === "method") {
    const details = value.method;
    assert(isRecord(details), "A method requires a mechanism, assumptions, protocol, outcome and limitations.");
    finding.method = {
      mechanism: field(details.mechanism, "Mechanism", 1200),
      assumptions: field(details.assumptions, "Assumptions", 1200),
      protocol: field(details.protocol, "Evaluation protocol", 1200),
      outcome: field(details.outcome, "Outcome", 1200),
      limitations: field(details.limitations, "Limitations", 1200),
    };
  }
  if (kind === "comparison") finding.comparability = choice(value.comparability, COMPARABILITY, "comparability");
  if (status === "verified") {
    assert(event.actor === "human", "Verification requires a human reviewer.");
    finding.verification = field(value.verification, "What you independently checked", 1200);
  }
  const history = state.findings.get(id) ?? [];
  assert(!history.length || history[0].kind === kind, "A revision must retain the finding type.");
  const reason = history.length ? field(reasonValue, "Revision reason", 1200) : undefined;
  history.push({ ...finding, revision: history.length + 1, ...event, reason });
  state.findings.set(id, history);
  return { finding, ...(reason ? { reason } : {}) };
}

function applyEvent(value: unknown, state: Replay): Event {
  assert(isRecord(value), "Invalid Prior Knowledge event.");
  const actor = choice(value.actor, ["human", "agent"], "actor");
  const at = field(value.at, "Recorded time", 32);
  assert(Number.isFinite(Date.parse(at)), "Invalid recorded time.");
  assert(Array.isArray(value.changes) && value.changes.length > 0 && value.changes.length <= 30 &&
    (jsonBytes(value.changes) ?? Infinity) <= MAX_BATCH_BYTES, "Provide 1 to 30 changes within 32 KiB.");
  const changed = new Set<string>();
  const changes = value.changes.map((change): Change => {
    assert(isRecord(change), "Invalid change.");
    if (Object.hasOwn(change, "source") && !Object.hasOwn(change, "finding")) return { source: addSource(change.source, state) };
    assert(Object.hasOwn(change, "finding") && !Object.hasOwn(change, "source"), "A change needs one source or one finding.");
    assert(isRecord(change.finding) && isKnowledgeId(change.finding.id) && !changed.has(change.finding.id),
      "A finding can change once per transaction.");
    changed.add(change.finding.id);
    return addFinding(change.finding, change.reason, { actor, at }, state);
  });
  state.revision++;
  return { at, actor, changes };
}

function decode(raw: string | null) {
  const state: Replay = { revision: 0, sources: new Map(), findings: new Map(), locations: new Set() };
  if (raw === null) return { state, events: [] as unknown[] };
  const record: unknown = JSON.parse(raw);
  assert(isRecord(record) && record.version === 1 && Array.isArray(record.events), "Invalid or unsupported Prior Knowledge journal.");
  for (const event of record.events) applyEvent(event, state);
  return { state, events: record.events };
}

export function readKnowledge(raw: string | null): Knowledge {
  return decode(raw).state;
}

export function appendKnowledge(raw: string | null, input: unknown, actor: Actor) {
  const { state, events } = decode(raw);
  assert(isRecord(input) && input.expectedRevision === state.revision, "Prior Knowledge changed. Read the latest revision before saving.");
  const event = applyEvent({ actor, at: new Date().toISOString(), changes: input.changes }, state);
  events.push(event);
  return {
    raw: JSON.stringify({ version: 1, events }, null, 2) + "\n",
    state,
    written: event.changes.map((change) => "source" in change ? { sourceId: change.source.id } :
      { id: change.finding.id, revision: state.findings.get(change.finding.id)?.length }),
  };
}

export function knowledgeMatches(text: string, query: string) {
  const haystack = text.toLowerCase();
  return query.toLowerCase().trim().split(/\s+/).every((word) => haystack.includes(word));
}
