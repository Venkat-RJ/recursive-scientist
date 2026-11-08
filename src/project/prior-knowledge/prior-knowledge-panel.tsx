import { useEffect, useReducer } from "react";
import { useLingui } from "@lingui/react/macro";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ArrowUpRight, BookOpenCheck, FilePlus, Plus, Search } from "lucide-react";
import { toMessage } from "../../app-utils";
import { Button } from "../../components/ui/button";
import { EmptyIllustration } from "../../components/ui/empty-illustration";
import { EmptyState } from "../../components/ui/empty-state";
import { IconButton } from "../../components/ui/icon-button";
import { SearchField } from "../../components/ui/search-field";
import { PanelHeader } from "../../components/ui/panel-header";
import { ResizableDrawer } from "../../components/ui/resizable-drawer";
import { FINDING_KINDS, isKnowledgeUrl, knowledgeMatches, METHOD_FIELDS, type FindingVersion, type Knowledge } from "./knowledge-model";
import { FindingForm, SourceForm, type Draft } from "./knowledge-forms";
import { useKnowledgeLabels } from "./knowledge-labels";
import { knowledgeReferencePath, type KnowledgeReference } from "./knowledge-reference";
import { loadKnowledge, subscribeKnowledge, writeKnowledge } from "./knowledge-store";
import { ResearchDisclosure, ResearchPanelBody } from "../research-panel";
import "./prior-knowledge-panel.css";

type State = {
  knowledge?: Knowledge;
  selected?: { id: string; revision?: number };
  draft?: Draft & { base: number };
  filter: string;
  query: string;
  busy: boolean;
  copied: boolean;
  error?: string;
};
type Action = Partial<State>;
const initial: State = { query: "", filter: "", busy: false, copied: false };
const reduce = (state: State, action: Action): State => ({ ...state, ...action });

type Tool = "literature" | "papers" | "formulation" | "mind-map" | "experiments";

export function PriorKnowledgePanel({ root, hasNotebook, onClose, openFile, openTool, captureProjectScope, reference }: {
  root: string;
  hasNotebook: boolean;
  onClose: () => void;
  openFile: (path: string, line?: number) => void;
  openTool: (tool: Tool) => void;
  captureProjectScope: () => () => boolean;
  reference?: KnowledgeReference | null;
}) {
  const { t } = useLingui();
  const labels = useKnowledgeLabels();
  const [state, change] = useReducer(reduce, initial);
  useEffect(() => {
    let active = true;
    let generation = 0;
    const refresh = () => {
      const request = ++generation;
      void loadKnowledge(root).then((knowledge) => {
        if (active && request === generation) change({ knowledge });
      }, (reason: unknown) => {
        if (active && request === generation) change({ knowledge: undefined, error: toMessage(reason) });
      });
    };
    refresh();
    const unsubscribe = subscribeKnowledge(root, refresh);
    return () => { active = false; unsubscribe(); };
  }, [root]);

  useEffect(() => {
    if (reference) change({ selected: reference, filter: "", query: "", copied: false });
  }, [reference]);

  const { knowledge, query, draft } = state;
  const latest = knowledge ? [...knowledge.findings.values()].flatMap((history) => history.slice(-1)).reverse() : [];
  const visible = latest.filter((finding) => (!state.filter || finding.kind === state.filter) &&
    knowledgeMatches(JSON.stringify(finding), query));
  const history = state.selected ? knowledge?.findings.get(state.selected.id) : undefined;
  const shown = state.selected?.revision ? history?.[state.selected.revision - 1] : history?.at(-1) ?? visible[0];
  const shownHistory = shown ? knowledge?.findings.get(shown.id) : undefined;
  const related = shown ? latest.filter((finding) => finding.links.some((link) =>
    link.id === shown.id && link.revision === shown.revision)) : [];

  const start = (edit: Draft) => {
    if (knowledge) change({ draft: { ...edit, base: knowledge.revision }, copied: false, error: undefined });
  };
  const select = (id: string, revision?: number) => change({ selected: { id, revision }, copied: false });
  const save = (changes: unknown[]) => {
    if (!draft || state.busy) return;
    const current = captureProjectScope();
    change({ busy: true, error: undefined });
    void writeKnowledge(root, { expectedRevision: draft.base, changes }, "human", current).then(({ written }) => {
      if (!current()) return;
      const first = written[0];
      change({ busy: false, draft: undefined, ...(first && "id" in first && first.id ? {
        selected: { id: first.id }, filter: "", query: "",
      } : {}) });
    }, (reason: unknown) => {
      if (current()) change({ busy: false, error: toMessage(reason) });
    });
  };
  const openSource = (location: string, locator = "") => {
    if (isKnowledgeUrl(location)) {
      void openUrl(location).catch((reason: unknown) => change({ error: toMessage(reason) }));
      return;
    }
    const line = /^L(\d+)/.exec(locator);
    openFile(location, line ? Number(line[1]) : undefined);
  };
  const copyReference = (finding: FindingVersion) => {
    void writeText("[" + finding.id + "@" + finding.revision + "](" + knowledgeReferencePath(finding) + ")").then(
      () => change({ copied: true }),
      (reason: unknown) => change({ error: toMessage(reason) }),
    );
  };

  return <ResizableDrawer className="prior-knowledge-drawer research-panel" ariaLabel={t`Prior Knowledge`} onClose={onClose}>
    <PanelHeader className="drawer-header" title={t`Prior Knowledge`} icon={<BookOpenCheck size={16} />} onClose={onClose} />
    <ResearchPanelBody className="research-record-panel knowledge-content">
      {state.error && <p role="alert">{state.error}</p>}
      {knowledge && draft && <>
        {draft.base !== knowledge.revision && <p role="status">{t`The record changed while you were editing. Reopen the draft from the latest record before saving.`}</p>}
        {draft.kind === "source"
          ? <SourceForm save={save} busy={state.busy} cancel={() => change({ draft: undefined, error: undefined })} />
          : <FindingForm knowledge={knowledge} draft={draft} save={save} busy={state.busy} cancel={() => change({ draft: undefined, error: undefined })} />}
      </>}
      {knowledge && !draft && <>
        <div className="research-actions research-toolbar">
          <Button size="compact" variant="tinted" onClick={() => start({ kind: "finding" })}><Plus size={14} />{t`Add finding`}</Button>
          <IconButton size="compact" label={t`Add source`} onClick={() => start({ kind: "source" })}><FilePlus aria-hidden="true" /></IconButton>
          <IconButton size="compact" label={t`Search Literature`} onClick={() => openTool("literature")}><Search aria-hidden="true" /></IconButton>
        </div>
        <div className="research-record-layout">
          <aside className="knowledge-index">
            <div className="knowledge-form-pair">
              <SearchField controlSize="compact" aria-label={t`Search knowledge`} placeholder={t`Search findings or sources`} value={query}
                onClear={() => change({ query: "", selected: undefined, copied: false })}
                onChange={(event) => change({ query: event.target.value, selected: undefined, copied: false })} />
              <select aria-label={t`Filter by finding type`} value={state.filter} onChange={(event) =>
                change({ filter: event.target.value, selected: undefined, copied: false })}>
                <option value="">{t`All findings`}</option>
                {FINDING_KINDS.map((kind) => <option key={kind} value={kind}>{labels[kind]}</option>)}
              </select>
            </div>
            {latest.length === 0 && <EmptyState density="compact" icon={<EmptyIllustration kind="search" />} title={t`No findings yet`} />}
            {latest.length > 0 && visible.length === 0 && <EmptyState density="compact" icon={<EmptyIllustration kind="search" />} title={t`No matching findings`} />}
            {visible.length > 0 && <ul className="research-records knowledge-list" aria-label={t`Findings`}>
              {visible.map((finding) => <li key={finding.id}>
                <Button variant="ghost" size="compact" aria-pressed={shown?.id === finding.id} onClick={() => select(finding.id)}>
                  <span>{finding.title}</span><small>{labels[finding.kind]} · {labels[finding.status]}</small>
                </Button>
              </li>)}
            </ul>}
            {knowledge.sources.size > 0 && <ResearchDisclosure className="knowledge-sources" open={query ? true : undefined} title={t`Sources (${knowledge.sources.size})`}>
              <ul>{[...knowledge.sources.values()].filter((source) => knowledgeMatches(Object.values(source).join(" "), query)).map((source) => <li key={source.id}>
                <Button variant="ghost" className="knowledge-link" size="compact" onClick={() => openSource(source.location)}>{source.title}<ArrowUpRight size={12} /></Button>
                <small>{labels[source.kind]} · {source.id}</small>
              </li>)}</ul>
            </ResearchDisclosure>}
          </aside>
          {state.selected?.revision && !shown && <p role="status">{t`This finding version is missing from the project record.`}</p>}
          {shown && <section className="knowledge-detail" aria-label={t`Finding details`}>
            <h3 className="research-title">{shown.title}</h3>
            <p className="research-meta">{labels[shown.kind]} · {labels[shown.status]}</p>
            <p>{shown.statement}</p>
            {(shown.method || shown.comparability || shown.verification) && <ResearchDisclosure title={t`Method & verification`} open>
              {shown.method && <dl>{METHOD_FIELDS.map((field) =>
                <div key={field}><dt>{labels[field]}</dt><dd>{shown.method?.[field]}</dd></div>)}</dl>}
              {shown.comparability && <p><strong>{labels[shown.comparability]}</strong></p>}
              {shown.verification && <p><strong>{t`Verification note`}</strong> {shown.verification}</p>}
            </ResearchDisclosure>}
            {shown.evidence.length > 0 && <ResearchDisclosure title={t`Source evidence (${shown.evidence.length})`} open>
              <ol className="knowledge-evidence">{shown.evidence.map(({ sourceId, locator, note }, index) => {
                const source = knowledge.sources.get(sourceId);
                return source && <li key={index}>
                  <Button variant="ghost" className="knowledge-link" size="compact" onClick={() => openSource(source.location, locator)}>{source.title}<ArrowUpRight size={12} /></Button>
                  <div className="knowledge-muted">{locator}</div><p>{note}</p>
                </li>;
              })}</ol>
            </ResearchDisclosure>}
            {shown.links.length > 0 && <ResearchDisclosure title={t`Related findings (${shown.links.length})`}>
              {shown.links.map((link, index) => {
                const target = knowledge.findings.get(link.id)?.[link.revision - 1];
                return target && <div key={index} className="knowledge-related">
                  <Button variant="ghost" className="knowledge-link" size="compact" onClick={() => select(link.id, link.revision)}>{labels[link.relation]} · {target.title}</Button>
                  {link.relation === "compares" && target.method && <dl>
                    <div><dt>{labels.protocol}</dt><dd>{target.method.protocol}</dd></div>
                    <div><dt>{labels.outcome}</dt><dd>{target.method.outcome}</dd></div>
                  </dl>}
                </div>;
              })}
            </ResearchDisclosure>}
            {related.length > 0 && <ResearchDisclosure title={t`Cited by (${related.length})`}>
              {related.map((finding) => <div key={finding.id}>
                <Button variant="ghost" className="knowledge-link" size="compact" onClick={() => select(finding.id)}>{finding.title}</Button>
              </div>)}
            </ResearchDisclosure>}
            <ResearchDisclosure title={t`Finding history`}>
              <div className="research-actions">
                <code>{shown.id}@{shown.revision}</code>
                <label>{t`Version`} <select value={shown.revision} onChange={(event) => select(shown.id, Number(event.target.value))}>
                  {shownHistory?.map(({ revision }) => <option key={revision} value={revision}>{revision}</option>)}
                </select></label>
              </div>
              <p className="knowledge-muted">{shown.actor === "human" ? t`Human contribution` : t`Agent contribution`} · {new Date(shown.at).toLocaleString()}</p>
              {shown.reason && <p>{t`Revision reason`} <span>{shown.reason}</span></p>}
            </ResearchDisclosure>
            <div className="research-actions">
              {shownHistory?.at(-1) === shown &&
                <Button size="compact" variant="secondary" onClick={() => start({ kind: "finding", revise: shown })}>{t`Revise finding`}</Button>}
              <Button size="compact" variant="secondary" onClick={() => start({ kind: "finding", question: shown })}>{t`Question`}</Button>
              <Button size="compact" variant="ghost" onClick={() => copyReference(shown)}>{state.copied ? t`Reference copied` : t`Copy reference`}</Button>
            </div>
          </section>}
        </div>
      </>}
      {!knowledge && !state.error && <p role="status">{t`Loading Prior Knowledge…`}</p>}
      <ResearchDisclosure title={t`Related tools`}><div className="research-actions" role="group" aria-label={t`Research tools`}>
        <Button variant="ghost" size="compact" onClick={() => openTool("papers")}>{t`Papers`}</Button>
        <Button variant="ghost" size="compact" onClick={() => openTool("formulation")}>{t`Problem Formulation`}</Button>
        <Button variant="ghost" size="compact" onClick={() => openTool("mind-map")}>{t`Mind Map`}</Button>
        <Button variant="ghost" size="compact" onClick={() => openTool("experiments")}>{t`Experiments`}</Button>
        {hasNotebook && <Button variant="ghost" size="compact" onClick={() => openFile("main.md")}>{t`Notebook`}</Button>}
      </div></ResearchDisclosure>
    </ResearchPanelBody>
  </ResizableDrawer>;
}
