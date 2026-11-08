/* eslint-disable lingui/no-unlocalized-strings -- Shared journal and agent protocol. */
import { isRecord } from "../../app-utils";
import { hasOnlyKeys, isNonBlankString, isWorkspaceRelativePath } from "../../agent/agent-protocol";

export const FORMULATION_FIELDS = [
  "objective", "scope", "constraints", "resources", "currentSystem", "priorWork",
  "facts", "assumptions", "hypotheses", "unknowns", "blockers", "sources",
  "benchmark", "baseline", "metrics", "correctness", "successCriteria",
] as const;

const REQUIRED_FIELDS = [
  "objective", "scope", "constraints", "resources", "currentSystem", "priorWork",
  "facts", "assumptions", "hypotheses", "unknowns", "sources",
  "benchmark", "baseline", "metrics", "correctness", "successCriteria",
] as const satisfies ReadonlyArray<(typeof FORMULATION_FIELDS)[number]>;

export type FormulationFields = Record<(typeof FORMULATION_FIELDS)[number], string>;
export const EMPTY_FORMULATION = Object.fromEntries(FORMULATION_FIELDS.map((key) => [key, ""])) as FormulationFields;
export type FormulationActor = "human" | "agent";
type FormulationAction =
  | { operation: "revise"; revision: number; fields: Partial<FormulationFields>; reason: string }
  | { operation: "challenge"; revision: number; text: string }
  | { operation: "request_review" | "approve"; revision: number };
type Event = FormulationAction & { actor: FormulationActor; at: string };
export type FormulationRevision = {
  version: number;
  fields: FormulationFields;
  reason: string;
  author: FormulationActor;
  at: string;
  reviewRequested: boolean;
  approvedAt?: string;
  challenges: Array<{ text: string; actor: FormulationActor; at: string }>;
};
export type Formulation = { revisions: FormulationRevision[]; current?: FormulationRevision };

export function formulationSource(value: string) {
  if (value.startsWith("https://")) {
    try {
      const url = new URL(value);
      if (url.hostname && !url.username && !url.password) return "url";
    } catch { /* An invalid URL is reported in the review checks. */ }
  } else if (isWorkspaceRelativePath(value) && !value.includes(":") && Array.from(value).every((character) => character.charCodeAt(0) >= 32)) {
    return "file";
  }
  return null;
}

export function validateFormulation(current?: FormulationRevision) {
  const fields = current?.fields ?? EMPTY_FORMULATION;
  const sources = fields.sources.split("\n").map((line) => line.trim()).filter(Boolean);
  return {
    missing: REQUIRED_FIELDS.filter((key) => !fields[key]),
    invalidSources: sources.filter((source) => !formulationSource(source)),
    blockers: fields.blockers,
    challenges: current?.challenges ?? [],
  };
}

function parseAction(input: unknown, actor: FormulationActor): FormulationAction {
  if (!isRecord(input) || typeof input.revision !== "number" || !Number.isSafeInteger(input.revision) || input.revision < 0) {
    throw new Error("Supply the current revision number, or 0 for the first draft.");
  }
  const { operation, revision } = input;
  if (operation === "revise" && hasOnlyKeys(input, ["operation", "revision", "fields", "reason"]) &&
      isRecord(input.fields) && hasOnlyKeys(input.fields, FORMULATION_FIELDS) && isNonBlankString(input.reason, 2000)) {
    const fields: Partial<FormulationFields> = {};
    for (const key of FORMULATION_FIELDS) {
      const value = input.fields[key];
      if (value === undefined) continue;
      if (typeof value !== "string" || value.length > 2000) throw new Error(`Use up to 2000 characters for ${key}.`);
      fields[key] = value.trim();
    }
    if (!Object.keys(fields).length) throw new Error("Supply at least one formulation field.");
    return { operation, revision, fields, reason: input.reason.trim() };
  }
  if (operation === "challenge" && hasOnlyKeys(input, ["operation", "revision", "text"]) && isNonBlankString(input.text, 2000)) {
    return { operation, revision, text: input.text.trim() };
  }
  if ((operation === "request_review" || operation === "approve") && hasOnlyKeys(input, ["operation", "revision"])) {
    if (operation === "approve" && actor !== "human") throw new Error("Only the researcher can approve a formulation in the panel.");
    return { operation, revision };
  }
  throw new Error("Supply a revision, challenge, review request, or human approval.");
}

function apply(state: Formulation, event: Event) {
  const current = state.current;
  if ((current?.version ?? 0) !== event.revision) throw new Error("The formulation changed. Read the latest revision before retrying.");
  if (event.operation === "revise") {
    const prior = current?.fields ?? EMPTY_FORMULATION;
    if (!FORMULATION_FIELDS.some((key) => event.fields[key] !== undefined && event.fields[key] !== prior[key])) {
      throw new Error("Change at least one field to create a new revision.");
    }
    const revision: FormulationRevision = {
      version: event.revision + 1, fields: { ...prior, ...event.fields },
      reason: event.reason, author: event.actor, at: event.at, reviewRequested: false, challenges: [],
    };
    state.revisions.push(revision);
    state.current = revision;
    return;
  }
  if (!current) throw new Error("Create a draft first.");
  if (event.operation === "challenge") {
    if (current.challenges.length >= 12) throw new Error("This revision has 12 challenges. Address them in a new revision.");
    current.challenges.push({ actor: event.actor, text: event.text, at: event.at });
    return;
  }
  if (current.approvedAt) throw new Error("This revision is already frozen.");
  const { missing, invalidSources, blockers, challenges } = validateFormulation(current);
  if (missing.length || invalidSources.length || blockers || challenges.length) {
    throw new Error("Complete required fields, fix source links, and address blockers and challenges in a new revision before review.");
  }
  if (event.operation === "request_review") {
    if (current.reviewRequested) throw new Error("This revision is already awaiting review.");
    current.reviewRequested = true;
  } else {
    if (!current.reviewRequested) throw new Error("Request review before approval.");
    current.approvedAt = event.at;
  }
}

function read(raw: string) {
  if (!raw.trim() || raw.trim() === "{}") return { events: [] as Event[], state: { revisions: [] } as Formulation };
  const document: unknown = JSON.parse(raw);
  if (!isRecord(document) || document.version !== 1 || !Array.isArray(document.events)) throw new Error("Invalid formulation journal.");
  const events: Event[] = [];
  const state: Formulation = { revisions: [] };
  for (const entry of document.events) {
    if (!isRecord(entry)) throw new Error("Invalid formulation history.");
    const { actor, at, ...input } = entry;
    if ((actor !== "human" && actor !== "agent") || typeof at !== "string" || !Number.isFinite(Date.parse(at))) throw new Error("Invalid formulation history.");
    const event: Event = { ...parseAction(input, actor), actor, at };
    apply(state, event);
    events.push(event);
  }
  return { events, state };
}

export function replayFormulation(raw: string) {
  return read(raw).state;
}

export function appendFormulation(raw: string, input: unknown, actor: FormulationActor, now = new Date()) {
  const { events, state } = read(raw);
  const event = { ...parseAction(input, actor), actor, at: now.toISOString() };
  apply(state, event);
  return { raw: JSON.stringify({ version: 1, events: [...events, event] }, null, 2) + "\n", state };
}
