import { useReducer, type FormEvent } from "react";
import { useLingui } from "@lingui/react/macro";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Textarea } from "../../components/ui/textarea";
import {
  COMPARABILITY, FINDING_KINDS, METHOD_FIELDS, RELATIONS, SOURCE_KINDS, STATUSES, type Finding, type FindingVersion, type Knowledge,
} from "./knowledge-model";

import { ResearchDisclosure } from "../research-panel";
import { useKnowledgeLabels } from "./knowledge-labels";

type FormActions = {
  save: (changes: unknown[]) => void;
  cancel: () => void;
  busy: boolean;
};
export type Draft = { kind: "source" } | { kind: "finding"; revise?: FindingVersion; question?: FindingVersion };

const getText = (form: FormData, name: string) => String(form.get(name) ?? "").trim();
const generatedId = (prefix: "src" | "pk") => prefix + "-" + crypto.randomUUID().slice(0, 12);

export function SourceForm({ save, cancel, busy }: FormActions) {
  const { t } = useLingui();
  const labels = useKnowledgeLabels();
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    save([{ source: {
      id: generatedId("src"), title: getText(form, "title"), location: getText(form, "location"), kind: getText(form, "kind"),
    } }]);
  };
  return <form className="knowledge-form" onSubmit={submit}>
    <h3 className="research-title">{t`Add a source`}</h3>
    <label>{t`Title`}<Input name="title" autoFocus required maxLength={240} /></label>
    <label>{t`Source type`}<select name="kind">{SOURCE_KINDS.map((kind) => <option key={kind} value={kind}>{labels[kind]}</option>)}</select></label>
    <label>{t`Original URL or project-relative path`}<Input name="location" required maxLength={1024} /></label>
    <FormButtons busy={busy} cancel={cancel} />
  </form>;
}

function FormButtons({ busy, cancel }: Pick<FormActions, "busy" | "cancel">) {
  const { t } = useLingui();
  return <div className="research-actions">
    <Button type="submit" variant="tinted" size="compact" disabled={busy}>{t`Save`}</Button>
    <Button type="button" size="compact" variant="ghost" disabled={busy} onClick={cancel}>{t`Cancel`}</Button>
  </div>;
}

type FormState = { kind: Finding["kind"]; status: Finding["status"]; citations: number; links: number };
type FormAction = { kind: Finding["kind"] } | { status: Finding["status"] } | "cite" | "link";

function reduceForm(state: FormState, action: FormAction): FormState {
  if (action === "cite") return { ...state, citations: state.citations + 1 };
  if (action === "link") return { ...state, links: state.links + 1 };
  return { ...state, ...action };
}

const findingRef = ({ id, revision }: Pick<FindingVersion, "id" | "revision">) => id + "@" + revision;

export function FindingForm({ knowledge, draft, save, cancel, busy }: FormActions & {
  knowledge: Knowledge; draft: Extract<Draft, { kind: "finding" }>;
}) {
  const { t } = useLingui();
  const labels = useKnowledgeLabels();
  const { revise, question } = draft;
  const initialLinks: Finding["links"] = revise?.links ?? (question ? [{ id: question.id, revision: question.revision, relation: "questions" }] : []);
  const [state, dispatch] = useReducer(reduceForm, {
    kind: revise?.kind ?? (question ? "question" : "result"), status: revise?.status ?? "interpretation",
    citations: Math.max(1, revise?.evidence.length ?? 0), links: Math.max(2, initialLinks.length),
  });
  const sources = [...knowledge.sources.values()];
  const otherFindings = [...knowledge.findings.values()].filter(([first]) => first.id !== revise?.id).flatMap((history) => [...history].reverse());
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const evidence = Array.from({ length: state.citations }, (_, i) => ({
      sourceId: getText(form, "source-" + i), locator: getText(form, "locator-" + i), note: getText(form, "note-" + i),
    })).filter((entry) => entry.sourceId || entry.locator || entry.note);
    const links = Array.from({ length: state.links }, (_, i) => {
      const [id, revision] = getText(form, "target-" + i).split("@");
      return { id, revision: Number(revision), relation: getText(form, "relation-" + i) };
    }).filter((entry) => entry.id);
    save([{ finding: {
      id: revise?.id ?? generatedId("pk"), kind: state.kind, status: state.status,
      title: getText(form, "title"), statement: getText(form, "statement"), evidence, links,
      ...(state.kind === "method" ? { method: Object.fromEntries(METHOD_FIELDS.map((field) => [field, getText(form, field)])) } : {}),
      ...(state.kind === "comparison" ? { comparability: getText(form, "comparability") } : {}),
      ...(state.status === "verified" ? { verification: getText(form, "verification") } : {}),
    }, ...(revise ? { reason: getText(form, "reason") } : {}) }]);
  };
  return <form className="knowledge-form" onSubmit={submit}>
    <h3 className="research-title">{revise ? t`Revise finding` : question ? t`Question this finding` : t`Add a finding`}</h3>
    <label>{t`Title`}<Input name="title" autoFocus required maxLength={240} defaultValue={revise?.title} /></label>
    <div className="knowledge-form-pair">
      <label>{t`Finding type`}<select value={state.kind} disabled={Boolean(revise)} onChange={(event) => dispatch({ kind: event.target.value as Finding["kind"] })}>
        {FINDING_KINDS.map((kind) => <option key={kind} value={kind}>{labels[kind]}</option>)}
      </select></label>
      <label>{t`Evidence status`}<select value={state.status} onChange={(event) => dispatch({ status: event.target.value as Finding["status"] })}>
        {STATUSES.map((status) => <option key={status} value={status}>{labels[status]}</option>)}
      </select></label>
    </div>
    <label>{t`Statement`}<Textarea name="statement" required maxLength={3000} defaultValue={revise?.statement} /></label>
    {state.kind === "method" && <ResearchDisclosure title={t`Method details`} open>
      {METHOD_FIELDS.map((field) =>
        <label key={field}>{labels[field]}<Textarea name={field} required rows={2} maxLength={1200} defaultValue={revise?.method?.[field]} /></label>)}
    </ResearchDisclosure>}
    {state.kind === "comparison" && <label>{t`Are the protocols comparable?`}
      <select name="comparability" defaultValue={revise?.comparability ?? "unknown"}>
        {COMPARABILITY.map((entry) => <option key={entry} value={entry}>{labels[entry]}</option>)}
      </select>
    </label>}
    <ResearchDisclosure title={t`Source evidence`} open={state.status === "reported" || state.status === "verified" || Boolean(revise?.evidence.length) || undefined}>
      {!sources.length && <p>{t`Add a source before citing evidence.`}</p>}
      {sources.length > 0 && Array.from({ length: state.citations }, (_, i) => {
        const entry = revise?.evidence[i];
        return <div className="knowledge-form" key={i}>
          <label>{t`Source`}<select name={"source-" + i} defaultValue={entry?.sourceId ?? ""}>
            <option value="">{t`Choose source`}</option>
            {sources.map((source) => <option key={source.id} value={source.id}>{source.title}</option>)}
          </select></label>
          <label>{t`Page, section, or artifact field`}<Input name={"locator-" + i} maxLength={400} defaultValue={entry?.locator} /></label>
          <label>{t`What this evidence supports`}<Textarea name={"note-" + i} maxLength={1200} defaultValue={entry?.note} /></label>
        </div>;
      })}
      {sources.length > 0 && state.citations < 12 && <Button type="button" variant="ghost" size="compact" onClick={() => dispatch("cite")}>{t`Add citation`}</Button>}
    </ResearchDisclosure>
    {otherFindings.length > 0 && <ResearchDisclosure title={t`Related findings`} open={initialLinks.length > 0 || undefined}>
      {Array.from({ length: state.links }, (_, i) => {
        const link = initialLinks[i];
        return <div className="knowledge-form-pair" key={i}>
          <label>{t`Relationship`}<select name={"relation-" + i} defaultValue={link?.relation ?? "builds_on"}>
            {RELATIONS.map((relation) => <option key={relation} value={relation}>{labels[relation]}</option>)}
          </select></label>
          <label>{t`Finding version`}<select name={"target-" + i} defaultValue={link ? findingRef(link) : ""}>
            <option value="">{t`Choose finding`}</option>
            {otherFindings.map((target) => <option key={findingRef(target)} value={findingRef(target)}>{target.title} ({findingRef(target)})</option>)}
          </select></label>
        </div>;
      })}
      {state.links < 16 && <Button type="button" variant="ghost" size="compact" onClick={() => dispatch("link")}>{t`Add relationship`}</Button>}
    </ResearchDisclosure>}
    {state.status === "verified" && <label>{t`What did you independently check?`}<Textarea name="verification" required maxLength={1200} /></label>}
    {revise && <label>{t`Why did the conclusion change?`}<Textarea name="reason" required maxLength={1200} /></label>}
    <FormButtons busy={busy} cancel={cancel} />
  </form>;
}
