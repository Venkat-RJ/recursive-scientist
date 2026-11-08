import { useEffect, useReducer, type FormEvent } from "react";
import { useLingui } from "@lingui/react/macro";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ArrowUpRight, Crosshair, Plus } from "lucide-react";
import { Button } from "../../components/ui/button";
import { EmptyIllustration } from "../../components/ui/empty-illustration";
import { EmptyState } from "../../components/ui/empty-state";
import { PanelHeader } from "../../components/ui/panel-header";
import { ResizableDrawer } from "../../components/ui/resizable-drawer";
import { Textarea } from "../../components/ui/textarea";
import { toMessage } from "../../app-utils";
import { EMPTY_FORMULATION, formulationSource, validateFormulation, type Formulation, type FormulationFields } from "./formulation-model";
import { loadFormulation, subscribeFormulation, writeFormulation } from "./formulation-store";
import { ResearchDisclosure, ResearchPanelBody } from "../research-panel";
import "./formulation-panel.css";

type Draft = { revision: number; fields: FormulationFields; reason: string };
type PanelState = {
  state: Formulation; loaded: boolean; selected: number | null; draft: Draft | null;
  challenge: string; busy: boolean; error: string;
};
const initial: PanelState = {
  state: { revisions: [] }, loaded: false, selected: null, draft: null, challenge: "", busy: false, error: "",
};

export function FormulationPanel({ root, hasNotebook, openFile, openTool, onClose, captureProjectScope }: {
  root: string;
  hasNotebook: boolean;
  openFile: (path: string) => void;
  openTool: (tool: "prior-knowledge" | "mind-map" | "experiments") => void;
  onClose: () => void;
  captureProjectScope: () => () => boolean;
}) {
  const { t } = useLingui();
  const [view, change] = useReducer((current: PanelState, patch: Partial<PanelState>) => ({ ...current, ...patch }), initial);
  const { state, loaded, selected, draft, challenge, busy, error } = view;
  useEffect(() => {
    let active = true;
    let generation = 0;
    const refresh = () => {
      const ticket = ++generation;
      void loadFormulation(root).then((value) => {
        if (!active || ticket !== generation) return;
        change({ state: value, loaded: true });
      }, (reason: unknown) => {
        if (active && ticket === generation) change({ error: toMessage(reason) });
      });
    };
    const unsubscribe = subscribeFormulation(root, refresh);
    const timer = window.setInterval(refresh, 5000);
    refresh();
    return () => { active = false; unsubscribe(); window.clearInterval(timer); };
  }, [root]);

  const current = state.current;
  const shown = selected === null ? current : state.revisions.find((revision) => revision.version === selected);
  const frozen = [...state.revisions].reverse().find((revision) => revision.approvedAt);
  const previous = shown ? state.revisions[shown.version - 2] : undefined;
  const validation = validateFormulation(shown);
  const ready = validation.missing.length === 0 && validation.invalidSources.length === 0 && !validation.blockers && validation.challenges.length === 0;
  const stale = draft !== null && draft.revision !== (current?.version ?? 0);

  const groups = [
    { title: t`Problem definition`, labels: {
      objective: t`Objective`, scope: t`Scope`, constraints: t`Constraints`, resources: t`Available resources`,
    } },
    { title: t`What we know`, labels: {
      currentSystem: t`Current system and limitations`, priorWork: t`Existing solutions and literature`,
      facts: t`Facts and their evidence`, assumptions: t`Assumptions`, hypotheses: t`Hypotheses`,
      unknowns: t`Unknowns and open questions`, blockers: t`Blocking contradictions or gaps`, sources: t`Sources (one project path or HTTPS link per line)`,
    } },
    { title: t`Evaluation protocol`, labels: {
      benchmark: t`Benchmark, inputs and split`, baseline: t`Baselines`, metrics: t`Metrics and direction`,
      correctness: t`Correctness requirements`, successCriteria: t`Success criteria`,
    } },
  ];
  const labels: Partial<Record<keyof FormulationFields, string>> = Object.assign({}, ...groups.map((group) => group.labels));

  const write = async (action: unknown, done?: () => void) => {
    const stillCurrent = captureProjectScope();
    change({ busy: true, error: "" });
    try {
      const next = await writeFormulation(root, action, "human", stillCurrent);
      if (stillCurrent()) {
        change({ state: next });
        done?.();
      }
    } catch (reason) {
      if (stillCurrent()) change({ error: toMessage(reason) });
    } finally {
      change({ busy: false });
    }
  };
  const startDraft = () => {
    change({ selected: null, draft: { revision: current?.version ?? 0, fields: { ...(current?.fields ?? EMPTY_FORMULATION) }, reason: "" } });
  };
  const saveDraft = (event: FormEvent) => {
    event.preventDefault();
    if (!draft || stale) return;
    void write({ operation: "revise", ...draft }, () => change({ draft: null }));
  };

  return <ResizableDrawer className="formulation-drawer research-panel" ariaLabel={t`Problem Formulation`} onClose={onClose}>
    <PanelHeader className="drawer-header" icon={<Crosshair size={16} />} title={t`Problem Formulation`} onClose={onClose} />
    <ResearchPanelBody className="formulation-content">
      {error && <p role="alert">{error}</p>}
      {!loaded && !error && <p role="status">{t`Loading formulation…`}</p>}
      {loaded && !current && !draft && <EmptyState
        icon={<EmptyIllustration kind="done" />} title={t`No problem formulation yet`}
        actions={<Button size="compact" variant="tinted" onClick={startDraft}><Plus size={14} />{t`Start draft`}</Button>}
      />}
      {draft && <form className="formulation-form" onSubmit={saveDraft}>
        <h3 className="research-title">{draft.revision ? t`Draft the next revision` : t`Draft the problem formulation`}</h3>
        <p className="research-meta">{t`Separate documented facts from assumptions and testable hypotheses. Say explicitly when a required section has no known entries.`}</p>
        {stale && <p role="alert">{t`The saved revision changed. Copy any edits you need, then cancel and start from the latest revision.`}</p>}
        {groups.map(({ title, labels: group }, index) => <ResearchDisclosure key={title} title={title} open={index === 0 || undefined}>
          {Object.entries(group).map(([key, label]) => {
            const field = key as keyof FormulationFields;
            return <label key={key}>{label}
              <Textarea autoFocus={field === "objective"} rows={2} maxLength={2000} value={draft.fields[field]}
                onChange={(event) => change({ draft: { ...draft, fields: { ...draft.fields, [field]: event.target.value } } })} />
            </label>;
          })}
        </ResearchDisclosure>)}
        <label>{t`Reason for this revision`}
          <Textarea required rows={2} maxLength={2000} value={draft.reason} onChange={(event) => change({ draft: { ...draft, reason: event.target.value } })} />
        </label>
        <div className="research-actions">
          <Button type="submit" size="compact" variant="tinted" disabled={busy || stale || !draft.reason.trim()}>{t`Save revision`}</Button>
          <Button type="button" variant="ghost" size="compact" disabled={busy} onClick={() => change({ draft: null })}>{t`Cancel`}</Button>
        </div>
      </form>}
      {!draft && shown && <>
        <section className="formulation-summary">
          <h2 className="research-title">{shown.fields.objective || t`Revision ${shown.version}`}</h2>
          <p className="research-meta">{t`Revision ${shown.version}`} · {shown.approvedAt ? t`Approved and frozen` : shown.reviewRequested && ready ? t`Awaiting human review` : t`Draft`}</p>
          {frozen && current?.version !== frozen.version && <p>{t`Revision ${frozen.version} is the last frozen protocol. The latest draft requires its own approval.`}</p>}
        </section>
        {shown === current && <div className="research-actions">
          <Button variant="tinted" size="compact" onClick={startDraft}>{t`Draft revision`}</Button>
          {!shown.approvedAt && <Button size="compact" disabled={busy || !ready} onClick={() => void write({
            operation: shown.reviewRequested ? "approve" : "request_review", revision: shown.version,
          })}>{shown.reviewRequested ? t`Approve and freeze` : t`Request review`}</Button>}
        </div>}
        <ResearchDisclosure key={shown.version} title={t`Review checks`} open={!ready || undefined}>
          {ready && <p>{t`Required fields are present. Check the evidence and protocol before approving.`}</p>}
          {validation.missing.length > 0 && <p>{t`Missing: ${validation.missing.map((key) => labels[key]).join(", ")}`}</p>}
          {validation.invalidSources.length > 0 && <p>{t`Invalid source links: ${validation.invalidSources.join(", ")}`}</p>}
          {validation.blockers && <p>{t`Open blockers: ${validation.blockers}`}</p>}
          {shown.challenges.length > 0 && <ul>{shown.challenges.map(({ text, actor, at }, index) =>
            <li key={`${at}-${index}`}>{actor === "agent" ? t`Agent challenge` : t`Researcher challenge`} · {text}</li>
          )}</ul>}
          {shown.challenges.length > 0 && <p>{t`Address these challenges in a new revision and explain what changed.`}</p>}
        </ResearchDisclosure>
        {groups.map(({ title, labels: group }) => <ResearchDisclosure key={title} title={title} className="formulation-section">
          <dl>{Object.entries(group).map(([key, label]) => {
            const value = shown.fields[key as keyof FormulationFields];
            return value && key !== "objective" && <div key={key}><dt>{label}</dt>
              <dd>{key === "sources" ? value.split("\n").filter((line) => line.trim()).map((line, index) => {
                const path = line.trim();
                const kind = formulationSource(path);
                return <div key={index}>{kind ? <Button size="compact" variant="ghost" className="formulation-source" onClick={() => {
                  if (kind === "url") void openUrl(path).catch((reason: unknown) => change({ error: toMessage(reason) }));
                  else openFile(path);
                }}>{path}<ArrowUpRight size={12} /></Button> : path}</div>;
              }) : value}</dd>
            </div>;
          })}</dl>
        </ResearchDisclosure>)}
        <ResearchDisclosure title={t`Revision history`}>
          <label className="formulation-revision">{t`Select revision`}
            <select value={selected ?? ""} onChange={(event) => change({ selected: event.target.value ? Number(event.target.value) : null, challenge: "" })}>
              <option value="">{t`Latest revision`}</option>
              {[...state.revisions].reverse().map(({ version, approvedAt }) => <option key={version} value={version}>
                {approvedAt ? t`Revision ${version} · Frozen` : t`Revision ${version}`}
              </option>)}
            </select>
          </label>
          <p>{shown.author === "agent" ? t`Agent revision` : t`Researcher revision`} · {new Date(shown.at).toLocaleString()}</p>
          <p>{shown.reason}</p>
          {previous && <p>{t`Changed fields: ${Object.keys(labels).filter((key) => {
            const field = key as keyof FormulationFields;
            return shown.fields[field] !== previous.fields[field];
          }).map((key) => labels[key as keyof FormulationFields]).join(", ")}`}</p>}
        </ResearchDisclosure>
        {shown === current && <ResearchDisclosure title={t`Challenge this revision`}><form className="formulation-form" onSubmit={(event) => {
          event.preventDefault();
          void write({ operation: "challenge", revision: shown.version, text: challenge }, () => change({ challenge: "" }));
        }}>
          <label>{t`Challenge`}
            <Textarea required rows={2} maxLength={2000} value={challenge} onChange={(event) => change({ challenge: event.target.value })} />
          </label>
          <Button type="submit" size="compact" variant="secondary" disabled={busy || !challenge.trim()}>{t`Record challenge`}</Button>
        </form></ResearchDisclosure>}
      </>}
      <ResearchDisclosure title={t`Related tools`}><nav className="research-actions" aria-label={t`Research workspace`}>
        {hasNotebook && <Button variant="ghost" size="compact" onClick={() => openFile("main.md")}>{t`Open notebook`}</Button>}
        <Button variant="ghost" size="compact" onClick={() => openTool("prior-knowledge")}>{t`Prior Knowledge`}</Button>
        <Button variant="ghost" size="compact" onClick={() => openTool("mind-map")}>{t`Mind Map`}</Button>
        <Button variant="ghost" size="compact" onClick={() => openTool("experiments")}>{t`Experiments`}</Button>
      </nav></ResearchDisclosure>
    </ResearchPanelBody>
  </ResizableDrawer>;
}
