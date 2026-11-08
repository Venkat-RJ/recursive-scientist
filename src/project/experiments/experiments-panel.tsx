import { useEffect, useReducer } from "react";
import { useLingui } from "@lingui/react/macro";
import { ArrowUpRight, BookOpenCheck, FlaskConical, Plus } from "lucide-react";
import { Button } from "../../components/ui/button";
import { EmptyIllustration } from "../../components/ui/empty-illustration";
import { EmptyState } from "../../components/ui/empty-state";
import { IconButton } from "../../components/ui/icon-button";
import { Input } from "../../components/ui/input";
import { PanelHeader } from "../../components/ui/panel-header";
import { ResizableDrawer } from "../../components/ui/resizable-drawer";
import { Textarea } from "../../components/ui/textarea";
import { toMessage } from "../../app-utils";
import { comparable, EXPERIMENT_STATUSES, type Experiment } from "./experiment-model";
import { loadExperiments, subscribeExperiments, verifyExperiment, writeExperiment } from "./experiment-store";
import { ResearchDisclosure, ResearchPanelBody } from "../research-panel";
import "./experiments-panel.css";

type State = { experiments: Experiment[]; selected: string | null; busy: boolean; error: string; proposing: boolean; loaded: boolean };
const initial: State = { experiments: [], selected: null, busy: false, error: "", proposing: false, loaded: false };

export function ExperimentsPanel({ root, onClose, openEvidence, openPriorKnowledge, captureProjectScope, selection }: {
  root: string;
  onClose: () => void;
  openEvidence: (path: string) => void;
  openPriorKnowledge?: () => void;
  selection?: { id: string };
  captureProjectScope: () => () => boolean;
}) {
  const { t, i18n } = useLingui();
  const format = new Intl.NumberFormat(i18n.locale, { maximumSignificantDigits: 15 }).format;
  const [state, change] = useReducer((current: State, patch: Partial<State>) => ({ ...current, ...patch }), { ...initial, selected: selection?.id ?? null });
  useEffect(() => {
    if (selection) change({ selected: selection.id, proposing: false });
  }, [selection]);
  useEffect(() => {
    let closed = false;
    let version = 0;
    const refresh = () => {
      const generation = ++version;
      void loadExperiments(root).then((experiments) => {
        if (!closed && generation === version) change({ experiments, loaded: true });
      }, (error: unknown) => {
        if (!closed && generation === version) change({ error: toMessage(error) });
      });
    };
    const unsubscribe = subscribeExperiments(root, refresh);
    refresh();
    const timer = window.setInterval(refresh, 5000);
    return () => { closed = true; unsubscribe(); window.clearInterval(timer); };
  }, [root, selection]);

  const run = async (operation: () => Promise<Experiment>, select = false) => {
    change({ busy: true, error: "" });
    try {
      const experiment = await operation();
      if (select) change({ selected: experiment.id, proposing: false });
    } catch (error) {
      change({ error: toMessage(error) });
    } finally {
      change({ busy: false });
    }
  };
  const write = (input: unknown, select = false) => {
    const current = captureProjectScope();
    return run(() => writeExperiment(root, input, "human", current), select);
  };

  const statuses = { planned: t`Planned`, running: t`Running`, completed: t`Completed`, failed: t`Failed` };
  const status = (e: Experiment) => e.decision === "rejected" && e.status === "planned" ? t`Rejected` : statuses[e.status];
  const current = state.selected ? state.experiments.find((entry) => entry.id === state.selected) : state.experiments[0];
  const verified = current?.verified?.metric;
  const baseline = state.experiments.find((entry) => entry.id === current?.baselineId);
  const comparableBaseline = baseline?.decision !== "rejected" && baseline?.verified && verified && comparable(verified, baseline.verified.metric)
    ? baseline.verified.metric : null;
  const peers = verified && current ? state.experiments.filter((entry) => entry.decision !== "rejected" && entry.verified && comparable(verified, entry.verified.metric)) : [];
  const isBest = verified && current?.decision !== "rejected" && peers.every((entry) => {
    const value = entry.verified!.metric.value;
    return verified.direction === "lower" ? verified.value <= value : verified.value >= value;
  });
  return (
    <ResizableDrawer className="experiments-drawer research-panel" ariaLabel={t`Experiments`} onClose={onClose}>
      <PanelHeader className="drawer-header" icon={<FlaskConical size={16} />} title={t`Experiments`} onClose={onClose} />
      <ResearchPanelBody className="research-record-panel experiments-content">
        {!state.proposing && <div className="research-actions research-toolbar">
          <Button size="compact" variant="tinted" onClick={() => change({ proposing: true })}>
            <Plus size={14} /> {t`Propose experiment`}
          </Button>
          {openPriorKnowledge && <IconButton size="compact" label={t`Prior Knowledge`} onClick={openPriorKnowledge}><BookOpenCheck aria-hidden="true" /></IconButton>}
        </div>}
        {state.error && <p role="alert">{state.error}</p>}
        {state.selected && !current && !state.error && <p role="status">{t`Waiting for the selected experiment…`}</p>}
        {state.proposing && (
          <form className="experiment-form" onSubmit={(event) => {
            event.preventDefault();
            void write({ operation: "create", fields: Object.fromEntries(new FormData(event.currentTarget)) }, true);
          }}>
            <h3 className="research-title">{t`Propose experiment`}</h3>
            <label>{t`Title`}<Input name="title" autoFocus required maxLength={160} /></label>
            <label>{t`Hypothesis`}<Textarea name="hypothesis" required rows={2} /></label>
            <label>{t`Prediction`}<Textarea name="prediction" required rows={2} /></label>
            <label>{t`Motivation`}<Textarea name="motivation" required rows={2} /></label>
            <label>{t`What we expect to learn`}<Textarea name="learningGoal" required rows={2} /></label>
            <div className="research-actions">
              <Button type="submit" size="compact" variant="tinted" disabled={state.busy}>{t`Save proposal`}</Button>
              <Button size="compact" variant="ghost" disabled={state.busy} onClick={() => change({ proposing: false })}>{t`Cancel`}</Button>
            </div>
          </form>
        )}
        {!state.loaded && !state.error && !state.selected && <p className="research-meta" role="status">{t`Loading experiments…`}</p>}
        {state.loaded && !state.proposing && (state.experiments.length === 0 ? (
          <EmptyState icon={<EmptyIllustration kind="history" />} title={t`No experiments yet`} />
        ) : (
          <div className="research-record-layout">
            <aside className="experiment-index">
              <h4>{t`Experiments (${state.experiments.length})`}</h4>
              <ul className="research-records experiment-list" aria-label={t`Experiments`}>
                {state.experiments.map((entry) => (
                  <li key={entry.id}>
                    <button type="button" aria-pressed={current?.id === entry.id} onClick={() => change({ selected: entry.id })}>
                      <span>{entry.title}</span>
                      <small><span className="experiment-status-dot" data-status={entry.decision === "rejected" ? "failed" : entry.status} />{status(entry)}{entry.verified ? ` · ${format(entry.verified.metric.value)} ${entry.verified.metric.unit}` : ""}</small>
                    </button>
                  </li>
                ))}
              </ul>
            </aside>
            {current && (
              <section key={current.id} className="experiment-detail">
                <header>
                  <h3 className="research-title">{current.title}</h3>
                  <p className="research-meta"><span className="experiment-status-dot" data-status={current.decision === "rejected" ? "failed" : current.status} />{status(current)} · {current.id}
                    {current.decision && (current.decision === "approved" ? <> · {t`Approved`}</> : current.status !== "planned" && <> · {t`Rejected`}</>)}
                  </p>
                </header>
                <p className="experiment-hypothesis">{current.hypothesis}</p>
                {current.metric && (
                  <div className="experiment-measurement">
                    <p className="research-meta">{verified ? t`Verified measurement` : t`Reported measurement, unverified`}</p>
                    <p className="experiment-score"><strong>{format(current.metric.value)}</strong> {current.metric.unit}</p>
                    <p>{current.metric.name} · {current.metric.evaluation}</p>
                    {isBest && <p>{t`Best verified result for this evaluation`}</p>}
                    {comparableBaseline && verified && <p>{t`Verified baseline`} · {format(comparableBaseline.value)} {verified.unit} · {t`Difference`} {format(verified.value - comparableBaseline.value)}</p>}
                    {current.verified && <p title={current.verified.sha256}>{t`Evidence SHA-256`} · {current.verified.sha256.slice(0, 12)}</p>}
                  </div>
                )}
                <ResearchDisclosure title={t`Plan & execution`}><dl>
                  {[
                    [t`Prediction`, current.prediction],
                    [t`Motivation`, current.motivation], [t`What we expect to learn`, current.learningGoal],
                    [t`Candidate`, current.candidate], [t`Baseline`, baseline?.title],
                    [t`Progress`, current.progress], [t`Remaining budget`, current.budget],
                    [t`Runtime`, current.runtime], [t`Reported correctness`, current.correctness],
                    [t`Findings`, current.findings], [t`Next investigation`, current.next],
                  ].filter(([, value]) => value).map(([label, value]) => (
                    <div key={label}><dt>{label}</dt><dd>{value}</dd></div>
                  ))}
                </dl></ResearchDisclosure>
                {baseline && (
                  <ResearchDisclosure title={t`Baseline comparison`}>
                    <table className="experiment-comparison" aria-label={t`Baseline comparison`}>
                      <thead><tr><th scope="col">{t`Measurement`}</th><th scope="col">{baseline.title}</th><th scope="col">{current.title}</th></tr></thead>
                      <tbody>
                        <tr><th scope="row">{t`Verified measurement`}</th><td>{comparableBaseline ? `${format(comparableBaseline.value)} ${comparableBaseline.unit}` : "·"}</td><td>{verified ? `${format(verified.value)} ${verified.unit}` : "·"}</td></tr>
                        <tr><th scope="row">{t`Runtime`}</th><td>{baseline.runtime ?? "·"}</td><td>{current.runtime ?? "·"}</td></tr>
                        <tr><th scope="row">{t`Reported correctness`}</th><td>{baseline.correctness ?? "·"}</td><td>{current.correctness ?? "·"}</td></tr>
                      </tbody>
                    </table>
                  </ResearchDisclosure>
                )}
                {current.evidence.length > 0 && <ResearchDisclosure title={t`Evidence (${current.evidence.length})`}>
                  {current.evidence.map((item) => (
                    <Button size="compact" variant="ghost" className="experiment-evidence" key={`${item.kind}:${item.path}`} onClick={() => openEvidence(item.path)}>
                      {item.path}<ArrowUpRight size={12} />
                    </Button>
                  ))}
                </ResearchDisclosure>}
                <ResearchDisclosure title={t`Record metric or evidence`}>
                  <form className="experiment-form" onSubmit={(event) => {
                    event.preventDefault();
                    const data = new FormData(event.currentTarget);
                    const get = (name: string) => String(data.get(name) ?? "").trim();
                    const value = get("value");
                    const fields = {
                      ...(value ? { metric: { name: get("name"), unit: get("unit"), direction: get("direction"), evaluation: get("evaluation"), value: Number(value) } } : {}),
                      ...(get("path") ? { evidence: [{ kind: get("kind"), path: get("path") }] } : {}),
                    };
                    void write({ operation: "update", id: current.id, fields });
                  }}>
                    <label>{t`Metric name`}<Input name="name" /></label>
                    <label>{t`Metric value`}<Input name="value" type="number" step="any" /></label>
                    <label>{t`Unit`}<Input name="unit" /></label>
                    <label>{t`Evaluation identity`}<Input name="evaluation" /></label>
                    <label>{t`Preferred direction`}<select name="direction"><option value="lower">{t`Lower is better`}</option><option value="higher">{t`Higher is better`}</option></select></label>
                    <label>{t`Evidence path`}<Input name="path" /></label>
                    <label>{t`Evidence type`}<select name="kind"><option value="result">{t`Result`}</option><option value="source">{t`Source`}</option><option value="log">{t`Log`}</option><option value="other">{t`Other`}</option></select></label>
                    <Button type="submit" disabled={state.busy}>{t`Save update`}</Button>
                  </form>
                </ResearchDisclosure>
                {current.status === "completed" && current.metric && current.evidence.some(({ kind }) => kind === "result") && !verified && (
                  <ResearchDisclosure title={t`Verify a saved result`}>
                    <form className="experiment-form" onSubmit={(event) => {
                      event.preventDefault();
                      const fields = new FormData(event.currentTarget);
                      const owns = captureProjectScope();
                      void run(async () => {
                        const expected: unknown = JSON.parse(String(fields.get("expected")));
                        if (typeof expected !== "boolean" && typeof expected !== "string" && typeof expected !== "number") throw new Error(t`Use a JSON string, number, or boolean.`);
                        return verifyExperiment(root, current, {
                          path: String(fields.get("path")), pointer: String(fields.get("pointer")).trim(),
                          correctnessPointer: String(fields.get("correctnessPointer")).trim(), expected,
                        }, owns);
                      });
                    }}>
                      <label>{t`Saved JSON result`}<select name="path">{current.evidence.filter(({ kind }) => kind === "result").map(({ path }) => <option key={path}>{path}</option>)}</select></label>
                      <label>{t`Metric JSON pointer`}<Input name="pointer" required /></label>
                      <label>{t`Correctness JSON pointer`}<Input name="correctnessPointer" required /></label>
                      <label>{t`Expected correctness value (JSON)`}<Input name="expected" required /></label>
                      <Button type="submit" disabled={state.busy}>{t`Verify result`}</Button>
                    </form>
                  </ResearchDisclosure>
                )}
                <ResearchDisclosure title={t`Update status`}>
                  <form className="experiment-form" onSubmit={(event) => {
                    event.preventDefault();
                    const data = new FormData(event.currentTarget);
                    const fields = Object.fromEntries([...data].filter(([, value]) => String(value).trim()));
                    void write({ operation: "update", id: current.id, fields });
                  }}>
                    <label>{t`Status`}<select name="status" defaultValue={current.status}>{EXPERIMENT_STATUSES.map((value) => <option key={value} value={value}>{statuses[value]}</option>)}</select></label>
                    <label>{t`Baseline`}<select name="baselineId" defaultValue={current.baselineId ?? ""}>
                      <option value="">{t`Choose a baseline`}</option>
                      {state.experiments.filter((entry) => entry.id !== current.id).map((entry) => <option key={entry.id} value={entry.id}>{entry.title}</option>)}
                    </select></label>
                    <label>{t`Candidate`}<Input name="candidate" /></label>
                    <label>{t`Runtime`}<Input name="runtime" /></label>
                    <label>{t`Reported correctness`}<Input name="correctness" /></label>
                    <label>{t`Progress`}<Input name="progress" /></label>
                    <label>{t`Remaining budget`}<Input name="budget" /></label>
                    <label>{t`Findings`}<Textarea name="findings" rows={2} /></label>
                    <label>{t`Next investigation`}<Textarea name="next" rows={2} /></label>
                    <Button type="submit" disabled={state.busy}>{t`Save update`}</Button>
                  </form>
                </ResearchDisclosure>
                <ResearchDisclosure title={t`Comment or decide`}><form className="experiment-form" onSubmit={(event) => {
                  event.preventDefault();
                  const data = new FormData(event.currentTarget);
                  const text = String(data.get("text"));
                  const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
                  const decision = submitter?.value;
                  void write(decision === "approved" || decision === "rejected"
                    ? { operation: "decide", id: current.id, decision, text }
                    : { operation: "comment", id: current.id, text });
                  event.currentTarget.reset();
                }}>
                  <label>{t`Comment or decision rationale`}<Textarea name="text" required rows={2} /></label>
                  <div className="research-actions">
                    <Button type="submit" size="compact" variant="secondary" disabled={state.busy}>{t`Comment`}</Button>
                    <Button type="submit" size="compact" variant="secondary" value="approved" disabled={state.busy}>{t`Approve`}</Button>
                    <Button type="submit" size="compact" variant="secondary" value="rejected" disabled={state.busy}>{t`Reject`}</Button>
                  </div>
                </form></ResearchDisclosure>
                <ResearchDisclosure title={t`Experiment history (${current.history.length})`}>
                  <ol>
                    {[...current.history].reverse().map((event, index) => (
                      <li key={index}>
                        <strong>{event.actor === "human" ? t`Human` : t`Agent`}</strong> · {new Date(event.at).toLocaleString()}
                        <p>{event.operation === "decide" ? `${event.decision === "approved" ? t`Approved` : t`Rejected`} · ${event.text}` :
                          event.operation === "comment" ? event.text :
                          event.operation === "create" ? t`Proposal recorded` :
                          event.operation === "verify" ? t`Saved result verified` :
                          Object.entries(event.fields).map(([key, value]) => `${key} · ${typeof value === "object" ? JSON.stringify(value) : value}`).join("\n")}</p>
                      </li>
                    ))}
                  </ol>
                </ResearchDisclosure>
              </section>
            )}
          </div>
        ))}
      </ResearchPanelBody>
    </ResizableDrawer>
  );
}
