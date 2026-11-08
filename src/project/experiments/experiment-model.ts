/* eslint-disable lingui/no-unlocalized-strings -- Validation messages are shared with native agent tools. */
import { isWorkspaceRelativePath } from "../../agent/agent-protocol";

export const EXPERIMENT_STATUSES = ["planned", "running", "completed", "failed"] as const;
export type ExperimentStatus = typeof EXPERIMENT_STATUSES[number];
export type Metric = { name: string; unit: string; direction: "lower" | "higher"; evaluation: string; value: number };
export type Evidence = { kind: "source" | "log" | "result" | "other"; path: string };
export type Experiment = {
  id: string;
  title: string;
  hypothesis: string;
  prediction: string;
  motivation: string;
  learningGoal: string;
  status: ExperimentStatus;
  baselineId?: string;
  candidate?: string;
  progress?: string;
  budget?: string;
  runtime?: string;
  correctness?: string;
  findings?: string;
  next?: string;
  metric?: Metric;
  evidence: Evidence[];
  createdAt: string;
  updatedAt: string;
  decision?: "approved" | "rejected";
  verified?: Verification;
  history: ExperimentEvent[];
};
export type Verification = {
  path: string;
  pointer: string;
  correctnessPointer: string;
  expected: string | number | boolean;
  sha256: string;
  metric: Metric;
};
type Create = Pick<Experiment, "title" | "hypothesis" | "prediction" | "motivation" | "learningGoal">;
type Update = Partial<Pick<Experiment, "status" | "baselineId" | "candidate" | "progress" | "budget" | "runtime" | "correctness" | "findings" | "next" | "metric">> & { evidence?: Evidence[] };
export type ExperimentAction =
  | { operation: "create"; fields: Create }
  | { operation: "update"; id: string; fields: Update }
  | { operation: "comment"; id: string; text: string }
  | { operation: "decide"; id: string; decision: "approved" | "rejected"; text: string }
  | { operation: "verify"; id: string; verification: Verification };

export type ExperimentEvent = ExperimentAction & { id: string; at: string; actor: "human" | "agent" };
const createFields = ["title", "hypothesis", "prediction", "motivation", "learningGoal"] as const;
const updateTextFields = ["baselineId", "candidate", "progress", "budget", "runtime", "correctness", "findings", "next"] as const;
const evidenceKinds = ["source", "log", "result", "other"] as const;

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected an object.");
  return value as Record<string, unknown>;
}
function keys(value: Record<string, unknown>, allowed: readonly string[]) {
  if (Object.keys(value).some((key) => !allowed.includes(key))) throw new Error("Unexpected experiment field.");
}
function text(value: unknown, label: string, limit = 4000): string {
  if (typeof value !== "string" || !value.trim() || value.length > limit) throw new Error(`Supply ${label} (1 to ${limit} characters).`);
  return value.trim();
}
function experimentId(value: unknown) {
  const id = text(value, "an experiment ID", 80);
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error("Invalid experiment ID.");
  return id;
}
function evidencePath(value: unknown) {
  if (!isWorkspaceRelativePath(value) || Array.from(value).some((character) => character.charCodeAt(0) < 32)) throw new Error("Use a project-relative evidence path.");
  return value;
}
function metric(value: unknown): Metric {
  const m = record(value);
  keys(m, ["name", "unit", "direction", "evaluation", "value"]);
  if ((m.direction !== "lower" && m.direction !== "higher") || typeof m.value !== "number" || !Number.isFinite(m.value)) {
    throw new Error("A metric needs a finite value and a lower or higher direction.");
  }
  return { name: text(m.name, "metric name", 120), unit: text(m.unit, "unit", 40), evaluation: text(m.evaluation, "evaluation identity", 240), direction: m.direction, value: m.value };
}

export function parseExperimentAction(input: unknown, actor: ExperimentEvent["actor"]): ExperimentAction {
  const args = record(input);
  if (args.operation === "create") {
    keys(args, ["operation", "fields"]);
    const f = record(args.fields);
    keys(f, createFields);
    return { operation: "create", fields: {
      title: text(f.title, "title", 160), hypothesis: text(f.hypothesis, "hypothesis"),
      prediction: text(f.prediction, "prediction"), motivation: text(f.motivation, "motivation"),
      learningGoal: text(f.learningGoal, "learning goal"),
    } };
  }
  const id = experimentId(args.id);
  if (args.operation === "update") {
    keys(args, ["operation", "id", "fields"]);
    const inputFields = record(args.fields);
    keys(inputFields, [...updateTextFields, "status", "metric", "evidence"]);
    const fields: Update = {};
    for (const name of updateTextFields) if (inputFields[name] !== undefined) fields[name] = name === "baselineId" ? experimentId(inputFields[name]) : text(inputFields[name], name);
    if (inputFields.status !== undefined) {
      const status = inputFields.status as ExperimentStatus;
      if (!EXPERIMENT_STATUSES.includes(status)) throw new Error("Invalid experiment status.");
      fields.status = status;
    }
    if (inputFields.metric !== undefined) fields.metric = metric(inputFields.metric);
    if (inputFields.evidence !== undefined) {
      if (!Array.isArray(inputFields.evidence) || inputFields.evidence.length > 24) throw new Error("Supply at most 24 evidence links per update.");
      fields.evidence = inputFields.evidence.map((item) => {
        const e = record(item);
        keys(e, ["kind", "path"]);
        const kind = e.kind as Evidence["kind"];
        if (!evidenceKinds.includes(kind)) throw new Error("Invalid evidence kind.");
        return { kind, path: evidencePath(e.path) };
      });
    }
    if (!Object.keys(fields).length) throw new Error("Supply an update.");
    return { operation: "update", id, fields };
  }
  if (args.operation === "comment") {
    keys(args, ["operation", "id", "text"]);
    return { operation: "comment", id, text: text(args.text, "comment") };
  }
  if (actor !== "human") throw new Error("Only a human can approve, reject, or verify an experiment.");
  if (args.operation === "decide" && (args.decision === "approved" || args.decision === "rejected")) {
    keys(args, ["operation", "id", "decision", "text"]);
    return { operation: "decide", id, decision: args.decision, text: text(args.text, "decision rationale") };
  }
  if (args.operation === "verify") {
    keys(args, ["operation", "id", "verification"]);
    const v = record(args.verification);
    keys(v, ["path", "pointer", "correctnessPointer", "expected", "sha256", "metric"]);
    if (typeof v.expected !== "boolean" && typeof v.expected !== "string" && (typeof v.expected !== "number" || !Number.isFinite(v.expected))) throw new Error("Invalid correctness check.");
    const sha256 = text(v.sha256, "report hash", 64);
    if (!/^[a-f0-9]{64}$/.test(sha256)) throw new Error("Invalid report hash.");
    return { operation: "verify", id, verification: { path: evidencePath(v.path), pointer: text(v.pointer, "metric JSON pointer", 1024), correctnessPointer: text(v.correctnessPointer, "correctness JSON pointer", 1024), expected: v.expected, sha256, metric: metric(v.metric) } };
  }
  throw new Error("Unknown experiment operation.");
}

function apply(map: Map<string, Experiment>, event: ExperimentEvent) {
  const existing = map.get(event.id);
  if (event.operation === "create") {
    if (existing) throw new Error("Duplicate experiment ID.");
    map.set(event.id, { id: event.id, ...event.fields, status: "planned", evidence: [], createdAt: event.at, updatedAt: event.at, history: [event] });
    return;
  }
  if (!existing) throw new Error("Experiment does not exist.");
  if (event.operation === "update") {
    const { status, evidence, baselineId, metric: nextMetric, ...fields } = event.fields;
    if (baselineId && (baselineId === existing.id || !map.has(baselineId))) throw new Error("Choose a different, existing baseline experiment.");
    if (status && status !== existing.status) {
      const valid = existing.status === "planned" ? status === "running" : existing.status === "running" && (status === "completed" || status === "failed");
      if (!valid || (status === "running" && existing.decision === "rejected")) throw new Error("Invalid status transition. Record a new experiment for another attempt.");
      existing.status = status;
    }
    if (nextMetric) existing.metric = nextMetric;
    if (nextMetric || (fields.candidate !== undefined && fields.candidate !== existing.candidate) ||
        (fields.correctness !== undefined && fields.correctness !== existing.correctness)) delete existing.verified;
    if (baselineId) existing.baselineId = baselineId;
    for (const link of evidence ?? []) {
      if (!existing.evidence.some((old) => old.path === link.path && old.kind === link.kind)) existing.evidence.push(link);
    }
    Object.assign(existing, fields);
  } else if (event.operation === "decide") {
    existing.decision = event.decision;
  } else if (event.operation === "verify") {
    if (existing.status !== "completed" || !existing.metric ||
        !comparable(existing.metric, event.verification.metric) || existing.metric.value !== event.verification.metric.value ||
        !existing.evidence.some((e) => e.kind === "result" && e.path === event.verification.path)) {
      throw new Error("Verification requires a completed experiment, a matching metric, and linked result evidence.");
    }
    existing.verified = event.verification;
  }
  existing.updatedAt = event.at;
  existing.history.push(event);
}

function readEvents(raw: string): unknown[] {
  if (!raw.trim() || raw.trim() === "{}") return [];
  const document = record(JSON.parse(raw));
  if (document.version !== 1 || !Array.isArray(document.events)) throw new Error("Invalid experiment journal.");
  return document.events;
}

export function replayExperiments(raw: string): Map<string, Experiment> {
  const map = new Map<string, Experiment>();
  for (const item of readEvents(raw)) {
    const { at, actor, ...input } = record(item);
    if ((actor !== "human" && actor !== "agent") || typeof at !== "string" || !Number.isFinite(Date.parse(at))) throw new Error("Invalid experiment history entry.");
    const id = experimentId(input.id);
    if (input.operation === "create") delete input.id;
    apply(map, { ...parseExperimentAction(input, actor), id, at, actor });
  }
  return map;
}

export function appendExperiment(raw: string, input: unknown, actor: ExperimentEvent["actor"], now = new Date()): { raw: string; experiment: Experiment } {
  const action = parseExperimentAction(input, actor);
  const map = replayExperiments(raw);
  const id = action.operation === "create" ? `EXP-${crypto.randomUUID()}` : action.id;
  const event = { ...action, id, actor, at: now.toISOString() };
  apply(map, event);
  const events = [...readEvents(raw), event];
  return { raw: `{"version":1,"events":[\n${events.map((entry) => JSON.stringify(entry)).join(",\n")}\n]}\n`, experiment: map.get(id)! };
}

export function comparable(a: Metric, b: Metric): boolean {
  return a.name === b.name && a.unit === b.unit && a.evaluation === b.evaluation && a.direction === b.direction;
}

export function jsonPointer(value: unknown, pointer: string): unknown {
  if (!pointer.startsWith("/") || /~(?![01])/.test(pointer)) throw new Error("Use a JSON pointer such as /metrics/loss.");
  for (const segment of pointer.slice(1).split("/")) {
    const name = segment.replace(/~1/g, "/").replace(/~0/g, "~");
    if (!value || typeof value !== "object" || !Object.hasOwn(value, name)) throw new Error(`JSON evidence has no value at ${pointer}.`);
    value = (value as Record<string, unknown>)[name];
  }
  return value;
}
