import { useMemo, useReducer } from "react";
import { useLingui } from "@lingui/react/macro";
import { Activity, ArrowUpRight, BookOpen, FlaskConical } from "lucide-react";
import { Button } from "../../components/ui/button";
import { EmptyIllustration } from "../../components/ui/empty-illustration";
import { EmptyState } from "../../components/ui/empty-state";
import { PanelHeader } from "../../components/ui/panel-header";
import { ResizableDrawer } from "../../components/ui/resizable-drawer";
import type { Experiment } from "../experiments/experiment-model";
import { ProgressChart, type ChartWindow } from "./progress-chart";
import { improvement, metricSeries, NOTEBOOK_PATH, objectiveContext, progressActivity, seriesSummary, type Point } from "./research-progress-model";
import { useResearchProgress } from "./use-research-progress";
import { ResearchDisclosure, ResearchPanelBody } from "../research-panel";
import "./research-progress.css";

type Props = {
  root: string;
  onClose: () => void;
  openExperiment: (id: string) => void;
  openTool: (tool: "formulation" | "mind-map") => void;
  openFile: (path: string, line?: number) => void;
};
type Selection = { series?: string; point?: string; reference?: string; range?: ChartWindow };
type Action =
  | { type: "series" | "point" | "reference"; key: string }
  | { type: "range"; range?: ChartWindow };
function select(current: Selection, action: Action): Selection {
  switch (action.type) {
    case "series": return { series: action.key };
    case "point": return { ...current, point: action.key };
    case "reference": return { ...current, reference: action.key };
    case "range": return { ...current, range: action.range };
  }
}

function Delta({ point, reference }: { point: Point; reference: Point }) {
  const { t, i18n } = useLingui();
  const change = improvement(point, reference);
  const base = Math.abs(reference.metric.value);
  const percent = base ? change / base : NaN;
  const amount = base && Number.isFinite(percent)
    ? new Intl.NumberFormat(i18n.locale, { style: "percent", maximumSignificantDigits: 4 }).format(Math.abs(percent))
    : new Intl.NumberFormat(i18n.locale, { maximumSignificantDigits: 12 }).format(Math.abs(change));
  const id = reference.experiment.id;
  if (change === 0) return <span>{t`Tied with ${id}`}</span>;
  return change > 0
    ? <span className="progress-improvement">{t`${amount} better than ${id}`}</span>
    : <span className="progress-regression">{t`${amount} worse than ${id}`}</span>;
}

function ResultCell({ label, point, format }: { label: string; point?: Point; format: (value: number) => string }) {
  return <div><dt>{label}</dt><dd>{point ? format(point.metric.value) : "·"}</dd>{point && <small title={point.experiment.title}>{point.experiment.id}</small>}</div>;
}

function ActivityCard({ activity, showNotebook, openExperiment, resources }: {
  activity: ReturnType<typeof progressActivity>;
  showNotebook?: () => void;
  resources?: string;
  openExperiment: Props["openExperiment"];
}) {
  const { t, i18n } = useLingui();
  const { focus, at, running, waiting, finished, completed, timings } = activity;
  const status = focus?.status;
  const stamp = at && new Intl.DateTimeFormat(i18n.locale, { dateStyle: "short", timeStyle: "medium" }).format(Date.parse(at));
  const statuses = { running: t`Recorded running`, planned: t`Waiting · planned`, completed: t`Last run completed`, failed: t`Last run failed` };
  const otherPending = [...running, ...waiting].filter(({ id }) => id !== focus?.id);
  const number = new Intl.NumberFormat(i18n.locale, { maximumFractionDigits: 3 });
  return (
    <section className="progress-card progress-activity">
      <h3>{t`Research activity`}</h3>
      <div className="progress-status" role="status">
        <span className="progress-status-dot" data-status={status} />
        <strong>{status ? statuses[status] : t`No recorded execution`}</strong>
        {stamp && <time dateTime={at}>{stamp}</time>}
      </div>
      {focus && <>
        <Button className="progress-activity-link" size="compact" variant="ghost" title={focus.title} onClick={() => openExperiment(focus.id)}>
          <FlaskConical size={13} /> {focus.id}<ArrowUpRight size={12} />
        </Button>
        <p className="progress-activity-title" title={focus.title}>{focus.title}</p>
        {(status === "running" || status === "planned") && <>
          <p className="progress-text">{focus.hypothesis}</p>
          <p className="progress-muted">{focus.progress || (status === "running" ? t`Waiting for a recorded execution update.` : t`Execution has yet to be recorded.`)}</p>
        </>}
      </>}
      {showNotebook && <Button size="compact" variant="ghost" onClick={showNotebook}>{t`Research plan`}<ArrowUpRight size={12} /></Button>}
      {otherPending.length > 0 && <ResearchDisclosure title={t`Other running or planned experiments`}>
        {otherPending.map((entry) => <Button key={entry.id} size="compact" variant="ghost" onClick={() => openExperiment(entry.id)}>
          {entry.id} · {statuses[entry.status]}<ArrowUpRight size={12} />
        </Button>)}
      </ResearchDisclosure>}
      <ResearchDisclosure title={t`Budget & usage`}>
        <p>{t`${completed} completed · ${running.length} running · ${waiting.length} planned`}</p>
        {finished.length > completed && <p>{t`${finished.length - completed} failed`}</p>}
        {[...timings].map(([scope, { seconds, count }]) => {
          const duration = number.format(seconds);
          return <p key={scope} className="progress-muted">{scope === "candidate batch wall time"
            ? t`${duration} s candidate wall time · ${count} of ${finished.length} finished records`
            : t`${duration} s recorded wall time · ${count} of ${finished.length} finished records`}</p>;
        })}
        {timings.size === 0 && <p className="progress-muted">{t`Aggregate compute time unavailable`}</p>}
        {focus?.budget && <p className="progress-muted">{t`Recorded for ${focus.id}`} · {focus.budget}</p>}
        {resources && <ResearchDisclosure title={t`Resources in Problem Formulation`}><p>{resources}</p></ResearchDisclosure>}
        <p className="progress-muted">{t`Project-wide remaining budget unavailable.`}</p>
      </ResearchDisclosure>
    </section>
  );
}

function LearningCard({ latest, findings, failed, next, interpretation, openExperiment, openNotebook }: {
  latest?: Experiment;
  findings: Experiment[];
  failed: Experiment[];
  interpretation?: string;
  next?: string;
  openExperiment: Props["openExperiment"];
  openNotebook?: () => void;
}) {
  const { t } = useLingui();
  const history = findings.filter((entry) => entry !== latest);
  return (
    <section className="progress-card progress-learning">
      <h3>{t`Scientific learning`}</h3>
      {interpretation && <p className="progress-text">{interpretation}</p>}
      {latest?.findings ? <>
        <p className="progress-text">{latest.findings}</p>
        <Button size="compact" variant="ghost" onClick={() => openExperiment(latest.id)}>{latest.id}<ArrowUpRight size={12} /></Button>
      </> : !interpretation && <p className="progress-muted">{t`No experiment findings recorded.`}</p>}
      {next && <div className="progress-next">
        <h4>{t`What remains`}</h4>
        <p className="progress-text">{next}</p>
      </div>}
      {failed.length > 0 && <ResearchDisclosure title={t`Failed or rejected attempts (${failed.length})`}>
        {failed.map((entry) => <div key={entry.id}>
          <Button size="compact" variant="ghost" onClick={() => openExperiment(entry.id)}>{entry.id}<ArrowUpRight size={12} /></Button>
          <p className="progress-text">{entry.findings || entry.progress || entry.title}</p>
        </div>)}
      </ResearchDisclosure>}
      {history.length > 0 && <ResearchDisclosure title={t`Earlier findings (${history.length})`}>
        {history.map((entry) => <div key={entry.id} className="progress-finding">
          <Button size="compact" variant="ghost" onClick={() => openExperiment(entry.id)}>{entry.id}<ArrowUpRight size={12} /></Button>
          <p>{entry.findings}</p>
          {entry.next && <p className="progress-muted"><strong>{t`Next`}</strong> · {entry.next}</p>}
        </div>)}
      </ResearchDisclosure>}
      {openNotebook && <Button size="compact" variant="ghost" onClick={openNotebook}><BookOpen size={13} />{t`Read notebook`}</Button>}
    </section>
  );
}

export function ResearchProgressPanel({ root, onClose, openExperiment, openTool, openFile }: Props) {
  const { t, i18n } = useLingui();
  const sources = useResearchProgress(root);
  const [selection, dispatch] = useReducer(select, {});
  const records = sources.experiments.value;
  const series = useMemo(() => metricSeries(records ?? []), [records]);
  const activity = useMemo(() => progressActivity(records ?? []), [records]);
  const active = series.find(({ key }) => key === selection.series)
    ?? [...series].sort((a, b) => Date.parse(b.points.at(-1)!.at) - Date.parse(a.points.at(-1)!.at))[0];
  const summary = active && seriesSummary(active);
  const points = summary?.points ?? [];
  const point = active?.points.find(({ experiment }) => experiment.id === selection.point) ?? summary?.latest;
  const comparisons = active?.points.filter((peer) => peer.valid && peer !== point) ?? [];
  const reference = comparisons.find(({ experiment }) => experiment.id === selection.reference)
    ?? comparisons.find(({ experiment }) => experiment.id === point?.experiment.baselineId)
    ?? comparisons.find((peer) => peer === summary?.baseline);
  const notebook = sources.notebook.value ?? {};
  const context = objectiveContext(sources.formulation.value ?? { revisions: [] }, notebook);
  const objective = context.objective;
  const revision = context.protocol?.version;
  const latestLearning = activity.findings.find((entry) => entry.id === summary?.current?.experiment.id)
    ?? activity.findings[0];
  const next = notebook.next?.text || context.protocol?.fields.unknowns || latestLearning?.next;
  const interpretation = notebook.interpretation?.text;
  const focusId = activity.focus?.id;
  const focusStatus = activity.focus?.status;
  const glanceActivity = {
    running: t`Running · ${focusId}`, planned: t`Waiting · ${focusId}`,
    completed: t`Completed · ${focusId}`, failed: t`Failed · ${focusId}`,
  };
  const format = new Intl.NumberFormat(i18n.locale, { maximumSignificantDigits: 15 }).format;
  const scoreStatus = (entry: Point) => entry.experiment.decision === "rejected" ? t`Rejected` : entry.valid ? t`Verified` : t`Reported · unverified`;
  const openPoint = (entry: Point) => {
    dispatch({ type: "point", key: entry.experiment.id });
    openExperiment(entry.experiment.id);
  };
  const errors = [
    [t`Experiments`, sources.experiments.error],
    [t`Problem Formulation`, sources.formulation.error],
    [t`Research notebook`, sources.notebook.error],
  ].filter(([, error]) => error);

  return (
    <ResizableDrawer className="research-progress-drawer research-panel" ariaLabel={t`Research Progress`} onClose={onClose}>
      <PanelHeader className="drawer-header" icon={<Activity size={16} />} title={t`Research Progress`} onClose={onClose} />
      <ResearchPanelBody className="research-progress-content">
        <header className="progress-objective">
          <h2 className="research-title">{objective || active?.metric.name || t`Define a research objective`}</h2>
          <span className="progress-feed research-meta" data-stale={Boolean(errors.length) || undefined}><Activity size={12} />
            {errors.length ? t`Updates incomplete` : records ? t`Watching project records` : t`Loading project records`}
          </span>
          {revision !== undefined && <small className="progress-muted">{context.protocol?.approvedAt
            ? context.draftPending ? t`Approved revision ${revision} · newer draft pending` : t`Approved revision ${revision}`
            : t`Draft revision ${revision}`}</small>}
          {records && <p className="progress-glance">
            <strong>{focusStatus ? glanceActivity[focusStatus] : t`No recorded execution`}</strong>
            {summary?.current && summary.baseline && <> · <Delta point={summary.current} reference={summary.baseline} /></>}
          </p>}
          <ResearchDisclosure className="progress-target" title={t`Target`}>
            <p className="progress-text">{context.target || t`No explicit target recorded`}</p>
          </ResearchDisclosure>
        </header>
        {errors.map(([label, error]) => <p key={label} className="progress-error" role="status">
          {t`${label} could not be refreshed. Showing any last saved view.`} {error}
        </p>)}

        <div className="progress-grid">
          <section className="progress-card progress-measurements">
            <h3>{t`Objective trajectory`}</h3>
            {active && summary ? <>
              <label className="progress-control">
                <span>{t`Metric & evaluation`}</span>
                <select title={active.metric.evaluation} value={active.key} onChange={(event) => dispatch({ type: "series", key: event.currentTarget.value })}>
                  {series.map(({ key, metric }) => <option key={key} value={key}>{metric.name} · {metric.evaluation} · {metric.unit} · {metric.direction === "lower" ? "↓" : "↑"}</option>)}
                </select>
              </label>
              <p className="research-meta">{active.metric.unit} · {active.metric.direction === "lower" ? t`Lower is better` : t`Higher is better`}</p>
              <dl className="progress-scores">
                <ResultCell label={t`Baseline`} point={summary.baseline} format={format} />
                <ResultCell label={t`Last verified`} point={summary.current} format={format} />
                <ResultCell label={t`Best valid`} point={summary.best} format={format} />
              </dl>
              {summary.latest && !summary.latest.valid && <p className="progress-muted">
                {t`Last saved result`} · {summary.latest.experiment.id} · {format(summary.latest.metric.value)} · {scoreStatus(summary.latest)}
              </p>}
              {points.length > 0 ? <ProgressChart points={points} baseline={summary.baseline} selected={point?.experiment.id} range={selection.range}
                changeRange={(range) => dispatch({ type: "range", range })} openPoint={openPoint} format={format} />
                : <p className="progress-muted">{t`The comparison starts with the next completed measurement.`}</p>}
              {active.points.some((entry) => !entry.valid) && <p className="progress-muted">{t`Hollow points are excluded from verified comparisons.`}</p>}
              {point && <ResearchDisclosure title={t`Inspect & compare results`}>
              <div className="progress-compare">
                <label className="progress-control">
                  <span>{t`Inspect result`}</span>
                  <select value={point.experiment.id} onChange={(event) => dispatch({ type: "point", key: event.currentTarget.value })}>
                    {[...active.points].reverse().map((entry) => <option key={entry.experiment.id} value={entry.experiment.id}>
                      {entry.experiment.id} · {entry.experiment.title}
                    </option>)}
                  </select>
                </label>
                <label className="progress-control">
                  <span>{t`Compare with`}</span>
                  <select value={reference?.experiment.id ?? ""} onChange={(event) => dispatch({ type: "reference", key: event.currentTarget.value })}>
                    <option value="" disabled>{t`Select a verified reference`}</option>
                    {[...comparisons].reverse().map((entry) => <option key={entry.experiment.id} value={entry.experiment.id}>{entry.experiment.id} · {format(entry.metric.value)}</option>)}
                  </select>
                </label>
                <p className="progress-selection">
                  <strong>{format(point.metric.value)}</strong> · {scoreStatus(point)}
                  {reference && point.valid && <> · <Delta point={point} reference={reference} /></>}
                </p>
                {point.experiment.correctness && <p className="progress-muted progress-text">{point.experiment.correctness}</p>}
                <div className="progress-links">
                  <Button size="compact" variant="ghost" onClick={() => openExperiment(point.experiment.id)}>{t`Open experiment`}<ArrowUpRight size={12} /></Button>
                  {reference && <Button size="compact" variant="ghost" onClick={() => openExperiment(reference.experiment.id)}>{t`Open reference`}<ArrowUpRight size={12} /></Button>}
                </div>
              </div></ResearchDisclosure>}
            </> : records ? <EmptyState density="compact" icon={<EmptyIllustration kind="history" />} title={t`No measurements yet`} />
              : <p className="progress-muted" role="status">{t`Waiting for experiment records…`}</p>}
          </section>

          <div className="progress-context">
            <ActivityCard activity={activity} resources={context.resources} showNotebook={notebook.plan && (() => openFile(NOTEBOOK_PATH, notebook.plan?.line))} openExperiment={openExperiment} />
            <LearningCard latest={latestLearning} findings={activity.findings} failed={activity.failed} next={next} interpretation={interpretation} openExperiment={openExperiment}
              openNotebook={notebook.learning && (() => openFile(NOTEBOOK_PATH, notebook.learning?.line))} />
          </div>
        </div>
        <footer className="progress-footer">
          {context.constraints && <ResearchDisclosure title={t`Evaluation constraints`}><p>{context.constraints}</p></ResearchDisclosure>}
          <ResearchDisclosure title={t`Related tools`}><div className="progress-links">
            <Button size="compact" variant="ghost" onClick={() => openTool("formulation")}>{t`Problem Formulation`}<ArrowUpRight size={12} /></Button>
            <Button size="compact" variant="ghost" onClick={() => openTool("mind-map")}>{t`Mind Map`}<ArrowUpRight size={12} /></Button>
          </div></ResearchDisclosure>
        </footer>
      </ResearchPanelBody>
    </ResizableDrawer>
  );
}
