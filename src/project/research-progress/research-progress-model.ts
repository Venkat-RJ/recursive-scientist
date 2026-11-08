import { fromMarkdown } from "mdast-util-from-markdown";
import type { PhrasingContent } from "mdast";
import { comparable, type Experiment, type Metric } from "../experiments/experiment-model";
import type { Formulation } from "../formulation/formulation-model";

export const NOTEBOOK_PATH = "main.md";

export type NotebookSection = { line: number; text: string };
type Notebook = {
  objective?: NotebookSection;
  constraints?: NotebookSection;
  plan?: NotebookSection;
  learning?: NotebookSection;
  interpretation?: NotebookSection;
  next?: NotebookSection;
  target?: NotebookSection;
};

/* eslint-disable lingui/no-unlocalized-strings -- Headings are keys in existing project notebooks. */
const notebookHeadings: Record<Exclude<keyof Notebook, "interpretation">, readonly string[]> = {
  objective: ["research question and objective", "research objective", "objective"],
  constraints: ["evaluation and constraints", "constraints"],
  plan: ["investigation plan", "research plan", "experimental method"],
  learning: ["current understanding", "results and learning"],
  next: ["next investigation", "open questions"],
  target: ["success criteria", "target"],
};
/* eslint-enable lingui/no-unlocalized-strings */

function inlineText(nodes: readonly PhrasingContent[]): string {
  return nodes.map((node) => {
    if ("value" in node) return node.type === "html" ? "" : node.value;
    if ("children" in node) return inlineText(node.children);
    return "alt" in node ? node.alt ?? "" : "";
  }).join("");
}

export function readNotebook(markdown: string): Notebook {
  const result: Notebook = {};
  const nodes = fromMarkdown(markdown).children;
  for (const [index, node] of nodes.entries()) {
    if (node.type !== "heading" || !node.position) continue;
    const heading = inlineText(node.children).toLowerCase().trim();
    const key = (Object.keys(notebookHeadings) as Array<keyof typeof notebookHeadings>).find((field) => notebookHeadings[field].includes(heading));
    if (!key || result[key]) continue;
    const body: string[] = [];
    for (const child of nodes.slice(index + 1)) {
      if (child.type === "heading" && child.depth <= node.depth) break;
      if (child.type !== "paragraph") continue;
      const text = inlineText(child.children).trim();
      body.push(text);
      if (key === "learning" && /^interpretation:\s*/i.test(text) && !result.interpretation && child.position) {
        result.interpretation = { line: child.position.start.line, text: text.replace(/^interpretation:\s*/i, "") };
      }
    }
    result[key] = { line: node.position.start.line, text: body.filter(Boolean).join("\n\n") };
  }
  return result;
}

export function objectiveContext(formulation: Formulation, notebook: Notebook) {
  const current = formulation.current;
  const protocol = [...formulation.revisions].reverse().find((revision) => revision.approvedAt) ?? current;
  return {
    protocol,
    draftPending: protocol !== current,
    objective: protocol?.fields.objective || notebook.objective?.text,
    target: protocol?.fields.successCriteria || notebook.target?.text,
    constraints: protocol?.fields.constraints || notebook.constraints?.text,
    resources: protocol?.fields.resources,
  };
}

export type Point = { experiment: Experiment; metric: Metric; valid: boolean; at: string };
export type Series = { key: string; metric: Metric; points: Point[] };

function recordedAt(experiment: Experiment, statusOnly = false) {
  const event = [...experiment.history].reverse().find((entry) => entry.operation === "update" && (!statusOnly || entry.fields.status === experiment.status));
  return event?.at ?? experiment.createdAt;
}

export function metricSeries(experiments: readonly Experiment[]): Series[] {
  const groups = new Map<string, Series>();
  // The store returns newest created first. Preserve journal order for tied timestamps.
  for (const experiment of [...experiments].reverse()) {
    const { metric } = experiment;
    if (experiment.status !== "completed" || !metric) continue;
    const key = JSON.stringify([metric.name, metric.unit, metric.direction, metric.evaluation]);
    const group = groups.get(key) ?? { key, metric, points: [] };
    group.points.push({
      experiment, metric, valid: Boolean(experiment.verified && experiment.decision !== "rejected"),
      at: recordedAt(experiment, true),
    });
    groups.set(key, group);
  }
  for (const group of groups.values()) group.points.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  return [...groups.values()];
}

export function seriesSummary(series: Series) {
  const byId = new Map(series.points.map((point) => [point.experiment.id, point]));
  const linked = new Set(series.points.map(({ experiment }) => experiment.baselineId));
  // Standalone records are still candidates unless another record names them as a reference.
  const candidates = series.points.filter(({ experiment }) => experiment.baselineId || !linked.has(experiment.id));
  const latest = candidates.at(-1);
  const current = [...candidates].reverse().find((point) => point.valid);
  let declaredBaseline: Point | undefined;
  const visited = new Set<string>();
  let id = (current ?? latest)?.experiment.baselineId;
  while (id && !visited.has(id)) {
    visited.add(id);
    const point = byId.get(id);
    if (!point || !comparable(point.metric, series.metric)) {
      declaredBaseline = undefined;
      break;
    }
    declaredBaseline = point;
    id = point.experiment.baselineId;
  }
  const baseline = !id && declaredBaseline?.valid ? declaredBaseline : undefined;
  const points = series.points.filter((point) => point !== baseline);
  const best = points.reduce<Point | undefined>((winner, point) =>
    point.valid && (!winner || improvement(point, winner) > 0) ? point : winner, baseline);
  return { points, latest, current, baseline, best };
}

export function improvement(point: Point, reference: Point) {
  return point.metric.direction === "lower" ? reference.metric.value - point.metric.value : point.metric.value - reference.metric.value;
}

export function progressActivity(experiments: readonly Experiment[]) {
  const newest = [...experiments].sort((a, b) => Date.parse(recordedAt(b)) - Date.parse(recordedAt(a)));
  const running = newest.filter((entry) => entry.status === "running");
  const waiting = newest.filter((entry) => entry.status === "planned" && entry.decision !== "rejected");
  const finished = newest.filter((entry) => entry.status === "completed" || entry.status === "failed");
  const focus = running[0] ?? waiting[0] ?? finished[0];
  const completed = finished.filter((entry) => entry.status === "completed").length;
  const findings = finished.filter((entry) => entry.findings);
  const failed = finished.filter((entry) => entry.status === "failed" || entry.decision === "rejected");
  const timings = new Map<string, { seconds: number; count: number }>();
  for (const entry of finished) {
    // Only add durations explicitly labeled as the same kind of wall time.
    const match = entry.runtime?.match(/^(\d+(?:\.\d+)?)\s*(ms|s|min|h)\s+(candidate batch wall time|wall time)\b/i);
    if (!match) continue;
    const scope = match[3].toLowerCase();
    const timing = timings.get(scope) ?? { seconds: 0, count: 0 };
    const factor = { ms: 0.001, s: 1, min: 60, h: 3600 }[match[2].toLowerCase()];
    if (factor === undefined) continue;
    const seconds = Number(match[1]) * factor;
    if (!Number.isFinite(timing.seconds + seconds)) continue;
    timing.seconds += seconds;
    timing.count += 1;
    timings.set(scope, timing);
  }
  return { focus, at: focus && recordedAt(focus), running, waiting, finished, completed, findings, failed, timings };
}
