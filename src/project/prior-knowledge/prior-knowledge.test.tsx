import { readFileSync } from "node:fs";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { executeAgentKnowledgeRequest, parseAgentKnowledgeRequest } from "../../agent/agent-prior-knowledge";
import { openMarkdownLink } from "../../editor/markdown/markdown-link-routing";
import { appendKnowledge, readKnowledge } from "./knowledge-model";
import { PriorKnowledgePanel } from "./prior-knowledge-panel";

const native = vi.hoisted(() => ({ invoke: vi.fn(), openUrl: vi.fn(), writeText: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: native.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: async () => () => undefined }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: native.openUrl }));
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({ writeText: native.writeText }));

const root = "/tmp/scheduling-optimization";
const seed = readFileSync("src-tauri/templates/scheduling-optimization/prior-knowledge.json", "utf8");
const props = { root, hasNotebook: true, onClose: vi.fn(), openFile: vi.fn(), openTool: vi.fn(), captureProjectScope: () => () => true };
let journal: string | null;

beforeEach(() => {
  vi.clearAllMocks();
  journal = seed;
  native.openUrl.mockResolvedValue(undefined);
  native.writeText.mockResolvedValue(undefined);
  native.invoke.mockImplementation(async (name: string, args: { projectRoot: string; expected: string | null; content: string }) => {
    expect(args.projectRoot).toBe(root);
    if (name === "read_prior_knowledge") return journal;
    if (name === "write_prior_knowledge" && args.expected === journal) { journal = args.content; return; }
    throw new Error("Unexpected IPC or stale write");
  });
});
afterEach(cleanup);

function agent(args: object, workspaceRoot = root, expiresAt = Date.now() + 30_000) {
  const request = parseAgentKnowledgeRequest({
    type: "synara:prior-knowledge-tool-request", version: 1, id: "workflow",
    expiresAt, workspaceRoot, args,
  });
  expect(request).not.toBeNull();
  return executeAgentKnowledgeRequest(request!, () => root);
}

function read(findingId?: string, revision?: number) {
  return agent({ operation: "prior_knowledge_read", ...(findingId ? { findingId, revision } : {}) });
}

it("lets a human inspect the benchmark comparison and add a question an agent can read after reopening", async () => {
  const path = vi.fn();
  openMarkdownLink("main.md", "prior-knowledge.json#pk-unmatched@1", path);
  expect(path).toHaveBeenCalledWith("prior-knowledge.json#pk-unmatched@1");
  const panel = render(<PriorKnowledgePanel {...props} reference={{ id: "pk-unmatched", revision: 1 }} />);
  const detail = await screen.findByRole("region", { name: "Finding details" });
  expect(within(detail).getByText("Different protocols")).toBeInTheDocument();
  fireEvent.click(within(detail).getByText(/Related findings/));
  expect(within(detail).getAllByText("Evaluation protocol")).toHaveLength(5);

  fireEvent.click(within(detail).getByRole("button", { name: /Beasley OR-Library/ }));
  expect(native.openUrl).toHaveBeenCalledWith("https://people.brunel.ac.uk/~mastjjb/jeb/orlib/wtinfo.html");
  fireEvent.click(within(detail).getByRole("button", { name: "Copy reference" }));
  expect(native.writeText).toHaveBeenCalledWith("[pk-unmatched@1](prior-knowledge.json#pk-unmatched@1)");
  fireEvent.click(screen.getByRole("button", { name: "Search Literature" }));
  expect(props.openTool).toHaveBeenCalledWith("literature");

  fireEvent.click(within(detail).getByRole("button", { name: "Question" }));
  fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Can we reproduce the backward rule?" } });
  fireEvent.change(screen.getByLabelText("Statement"), { target: { value: "Which exact variant and runtime budget did the study use?" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await screen.findByRole("heading", { name: "Can we reproduce the backward rule?" });
  panel.unmount();

  const loaded = readKnowledge(journal);
  const question = [...loaded.findings.values()].flat().find((finding) => finding.kind === "question")!;
  expect(await read(question.id)).toMatchObject({
    ok: true, result: { revision: 2, finding: { actor: "human", status: "interpretation",
      links: [{ id: "pk-unmatched", revision: 1, relation: "questions" }] } },
  });
  render(<PriorKnowledgePanel {...props} reference={{ id: "pk-unmatched", revision: 1 }} />);
  expect(await screen.findByRole("button", { name: "Can we reproduce the backward rule?" })).toBeInTheDocument();
});

it("shares an agent revision with the panel and preserves the cited old revision and original sources", async () => {
  const original = readKnowledge(seed).findings.get("pk-budgeted-search")![0];
  const { actor: _actor, at: _at, revision: _revision, reason: _reason, ...finding } = original;
  render(<PriorKnowledgePanel {...props} />);
  const listed = await read();
  expect(listed).toMatchObject({ ok: true, result: { totalFindings: 9, totalSources: 11, revision: 1 } });
  const title = "Budgeted search with a frozen workload rule";
  await act(async () => {
    const result = await agent({ operation: "prior_knowledge_write", input: {
      expectedRevision: 1, changes: [{ finding: { ...finding, title }, reason: "Freeze the selector during evaluation." }],
    } });
    expect(result).toMatchObject({ ok: true, result: { revision: 2, written: [{ id: finding.id, revision: 2 }] } });
  });
  expect(await screen.findByRole("heading", { name: title })).toBeInTheDocument();
  fireEvent.click(screen.getByText("Finding history"));
  fireEvent.change(screen.getByLabelText("Version"), { target: { value: "1" } });
  expect(screen.getByRole("heading", { name: original.title })).toBeInTheDocument();
  expect(await read(finding.id, 1)).toMatchObject({ ok: true, result: { finding: { title: original.title },
    sources: expect.arrayContaining([expect.objectContaining({ id: "valente-atc" })]), revisionCount: 2 } });
});

it("rejects stale, expired, wrong-project and ungrounded writes without altering the journal", async () => {
  const changes = [{ finding: { id: "bad", title: "Claim", kind: "result", status: "reported", statement: "Claim", evidence: [], links: [] } }];
  const write = { operation: "prior_knowledge_write", input: { expectedRevision: 1, changes } };
  expect(await agent(write, "/other")).toMatchObject({ ok: false, error: { code: "prior_knowledge_scope_changed" } });
  expect(await agent(write, root, Date.now() - 1)).toMatchObject({ ok: false, error: { code: "prior_knowledge_scope_changed" } });
  expect(native.invoke).not.toHaveBeenCalled();
  expect(await agent({ ...write, input: { expectedRevision: 0, changes } })).toMatchObject({ ok: false, error: { message: expect.stringMatching(/changed/) } });
  expect(await agent(write)).toMatchObject({ ok: false, error: { message: expect.stringMatching(/require source/) } });
  expect(journal).toBe(seed);
  expect(() => appendKnowledge(seed, { expectedRevision: 1, changes: [
    { finding: { ...changes[0].finding, status: "verified", evidence: [
      { sourceId: "or-library", locator: "Problem definition", note: "An agent cannot attest to human verification." },
    ], verification: "Checked" } },
  ] }, "agent")).toThrow(/human reviewer/);
});

it("writes a human source then refuses to add the same URL again", async () => {
  journal = null;
  render(<PriorKnowledgePanel {...props} />);
  const add = async () => {
    fireEvent.click(await screen.findByRole("button", { name: "Add source" }));
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Benchmark records" } });
    fireEvent.change(screen.getByLabelText("Original URL or project-relative path"), { target: { value: "https://example.org/benchmark#results" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
  };
  await add();
  await waitFor(() => expect(readKnowledge(journal).sources.size).toBe(1));
  await add();
  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("already recorded"));
  expect(readKnowledge(journal).revision).toBe(1);
});

it("keeps a folded finding draft and reveals its required method fields for validation", async () => {
  render(<PriorKnowledgePanel {...props} />);
  fireEvent.click(await screen.findByRole("button", { name: "Add finding" }));
  fireEvent.change(screen.getByLabelText("Finding type"), { target: { value: "method" } });
  const summary = screen.getByText("Method details").closest("summary")!;
  const disclosure = summary.closest("details")!;
  const protocol = screen.getByLabelText("Evaluation protocol");
  fireEvent.change(protocol, { target: { value: "Use the frozen training split." } });

  fireEvent.click(summary);
  expect(disclosure.open).toBe(false);
  expect(protocol).not.toBeVisible();
  fireEvent.invalid(screen.getByLabelText("Assumptions"));
  expect(disclosure.open).toBe(true);
  expect(protocol).toBeVisible();
  expect(protocol).toHaveValue("Use the frozen training split.");
});
