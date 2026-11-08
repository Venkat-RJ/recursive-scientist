import type { AgentTerminalUpdate } from "./agent-terminal-update";

/**
 * The window's terminals: one shell per tab, in the project folder, kept
 * apart from the panel that shows them.
 *
 * The panel can unmount while its shells run (a named workspace without a
 * Terminal panel, a layout reset), and mounting again shows the same
 * terminals with their scrollback, so the sessions live here, one store per
 * window, rather than in React state. A shell ends only when its tab is
 * closed, the Terminal panel is closed, or the window's project changes; the
 * host ends the rest (a reload, the window closing, quitting; see
 * src-tauri/src/terminal.rs).
 *
 * The store knows nothing of xterm.js or of Tauri: it is handed a backend and
 * a way to make a terminal's screen, so its rules are tested with fakes.
 */

/** The host side of one window's terminals (terminal-backend.ts). */
export type TerminalBackend = {
  open: (request: {
    projectRoot: string;
    cols: number;
    rows: number;
    onOutput: (data: Uint8Array) => void;
    /** The shell ended by itself: its exit code, or null when a signal ended it. */
    onExit: (code: number | null) => void;
  }) => Promise<{ id: number; shell: string }>;
  write: (id: number, data: string) => Promise<void>;
  resize: (id: number, cols: number, rows: number) => Promise<void>;
  /** The window has drawn `bytes` more output (flow control). */
  ack: (id: number, bytes: number) => Promise<void>;
  /** What closing the terminal would stop ("latexmk", "" when unnamed), or null at the prompt. */
  runningCommand: (id: number) => Promise<string | null>;
  close: (id: number) => Promise<void>;
};

/** A terminal's screen (terminal-screen.ts): xterm.js in an element of its own. */
export type TerminalScreen = {
  /** The element the screen draws in; the panel moves it into place. */
  element: HTMLElement;
  cols: () => number;
  rows: () => number;
  /** Draw shell output; `done` once it is on screen. */
  write: (data: Uint8Array, done: () => void) => void;
  /** A line from Lattice itself, not the shell (dimmed). */
  note: (text: string) => void;
  reset?: () => void;
  follow?: () => void;
  onInput: (listener: (data: string) => void) => void;
  onResize: (listener: (cols: number, rows: number) => void) => void;
  dispose: () => void;
};

export type TerminalSession<S extends TerminalScreen = TerminalScreen> = {
  /** The tab's own id; the host's id arrives once the shell has started. */
  key: number;
  /** Shown as "Terminal {number}" until renamed. */
  number: number;
  agent?: true;
  name: string | null;
  /** The shell's program ("zsh"), once started. */
  shell: string;
  screen: S;
  /** "running", or how it stopped: the shell exited (code), or never started (message). */
  state: { kind: "starting" | "running" } | { kind: "exited"; code: number | null } | { kind: "failed"; message: string };
};

type Snapshot<S extends TerminalScreen> = {
  sessions: readonly TerminalSession<S>[];
  active: number | null;
  executions: readonly AgentTerminalUpdate[];
  executionId: string | null;
};

/** Output the window draws before it tells the host (see `ack`). */
const ACK_EVERY = 64 * 1024;

type Internal<S extends TerminalScreen> = { session: TerminalSession<S>; id: number | null; queued: string[]; drawn: number; closed: boolean };

export class TerminalSessions<S extends TerminalScreen = TerminalScreen> {
  private items: Internal<S>[] = [];
  private snapshot: Snapshot<S> = { sessions: [], active: null, executions: [], executionId: null };
  private listeners = new Set<() => void>();
  private nextKey = 1;
  private root = "";
  private agentCommands = new Map<string, AgentTerminalUpdate>();
  private executionId: string | null = null;

  constructor(
    private readonly backend: TerminalBackend,
    private readonly createScreen: (readOnly?: boolean) => S,
  ) {}

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  get = () => this.snapshot;

  /** The project the terminals run in. Another project ends every terminal of the last one. */
  get projectRoot() {
    return this.root;
  }

  setProject(root: string) {
    if (root === this.root) return;
    this.agentCommands.clear();
    this.executionId = null;
    this.root = root;
    if (this.items.length) this.endAll();
    else this.publish(null);
  }

  /** Start a terminal in the project folder and make it the active tab. */
  open(): TerminalSession<S> | null {
    if (!this.root) return null;
    const used = new Set(this.items.filter(({ session }) => !session.agent).map(({ session }) => session.number));
    let number = 1;
    while (used.has(number)) number += 1;
    const screen = this.createScreen();
    const session: TerminalSession<S> = { key: this.nextKey++, number, name: null, shell: "", screen, state: { kind: "starting" } };
    const item: Internal<S> = { session, id: null, queued: [], drawn: 0, closed: false };
    this.items.push(item);
    this.publish(session.key);
    const root = this.root;
    screen.onInput((data) => {
      if (item.id === null) item.queued.push(data);
      else void this.backend.write(item.id, data).catch(() => {});
    });
    screen.onResize((cols, rows) => {
      if (item.id !== null) void this.backend.resize(item.id, cols, rows).catch(() => {});
    });
    void this.backend.open({
      projectRoot: root,
      cols: screen.cols(),
      rows: screen.rows(),
      onOutput: (data) => {
        if (item.closed) return;
        screen.write(data, () => {
          item.drawn += data.byteLength;
          if (item.drawn < ACK_EVERY || item.id === null) return;
          void this.backend.ack(item.id, item.drawn).catch(() => {});
          item.drawn = 0;
        });
      },
      onExit: (code) => this.exited(item, code),
    }).then(({ id, shell }) => {
      if (item.closed || root !== this.root) {
        void this.backend.close(id).catch(() => {});
        return;
      }
      item.id = id;
      // Output drawn before the id arrived could not be acknowledged. Say so
      // now: past 2 MB unacknowledged the host stops reading the shell, so no
      // further packet would come along to carry this ack.
      if (item.drawn > 0) {
        void this.backend.ack(id, item.drawn).catch(() => {});
        item.drawn = 0;
      }
      if (item.session.state.kind !== "starting") {
        this.update(item, { shell });
        item.queued.length = 0;
        return;
      }
      this.update(item, { shell, state: { kind: "running" } });
      // The size may have changed while the shell started (the panel laid out).
      void this.backend.resize(id, screen.cols(), screen.rows()).catch(() => {});
      for (const data of item.queued.splice(0)) void this.backend.write(id, data).catch(() => {});
    }, (reason: unknown) => {
      if (item.closed) return;
      this.update(item, { state: { kind: "failed", message: reason instanceof Error ? reason.message : String(reason) } });
    });
    return session;
  }

  /** Keep a bounded view of Synara's execution records, even with the pane closed. */
  reportAgentCommand(update: AgentTerminalUpdate): boolean {
    if (!this.root || update.workspaceRoot !== this.root) return false;
    const { reveal, ...record } = update;
    const previous = this.agentCommands.get(record.id);
    if (reveal && previous) return this.revealAgentExecution(record.id);
    const isFinal = previous && previous.status !== "running" && previous.status !== "unknown";
    // A delayed live snapshot cannot undo a confirmed terminal outcome.
    const next = isFinal && (record.status === "running" || record.status === "unknown") ? previous : record;
    const changed = JSON.stringify(previous) !== JSON.stringify(next);
    if (changed) {
      this.agentCommands.set(record.id, next);
      if (this.agentCommands.size > 100) {
        const oldest = [...this.agentCommands.values()].filter((entry) => entry.id !== this.executionId && entry.id !== record.id)
          .sort((a, b) => (a.startedAt ?? "").localeCompare(b.startedAt ?? ""))[0];
        if (oldest) this.agentCommands.delete(oldest.id);
      }
    }
    if (changed) {
      const item = this.items.find(({ session }) => session.agent);
      if (item && this.executionId === record.id) this.drawAgentExecution(item.session.screen, next, previous);
    }
    if (reveal) return this.revealAgentExecution(record.id);
    if (changed) this.publish(this.snapshot.active);
    return false;
  }

  revealAgentExecution(id?: string): boolean {
    const record = id ? this.agentCommands.get(id) : this.snapshot.executions[0];
    if (!record) return false;
    let item = this.items.find(({ session }) => session.agent);
    if (!item) {
      const session: TerminalSession<S> = {
        key: this.nextKey++, number: 0, name: null, agent: true, shell: "",
        screen: this.createScreen(true), state: { kind: "running" },
      };
      item = { session, id: null, queued: [], drawn: 0, closed: false };
      this.items.push(item);
      this.executionId = null;
    }
    if (this.executionId !== record.id) {
      this.executionId = record.id;
      item.session.screen.reset?.();
      this.drawAgentExecution(item.session.screen, record);
    }
    this.publish(item.session.key);
    return true;
  }

  private drawAgentExecution(screen: S, record: AgentTerminalUpdate, previous?: AgentTerminalUpdate) {
    const before = previous?.output ?? "";
    if (!previous || !record.output.startsWith(before)) {
      if (previous) screen.reset?.();
      screen.note(terminalText(`$ ${record.command}`, false));
    }
    const output = record.output.startsWith(before) ? record.output.slice(before.length) : record.output;
    if (output) screen.write(new TextEncoder().encode(terminalText(output, true)), () => {});
    if (record.status !== "running" && (!previous || previous.status !== record.status || previous.exitCode !== record.exitCode || previous.output !== record.output)) {
      if (record.truncated) screen.note("[Output truncated]");
      screen.note(record.exitCode === null ? `[${record.status}]` : `[${record.status}, exit code ${record.exitCode}]`);
    }
  }

  select(key: number) {
    if (this.items.some(({ session }) => session.key === key)) this.publish(key);
  }

  rename(key: number, name: string) {
    const item = this.items.find(({ session }) => session.key === key);
    const trimmed = name.trim();
    if (item && !item.session.agent) this.update(item, { name: trimmed || null });
  }

  /** What closing these terminals would stop, by command name ("" when unnamed). */
  async running(keys: readonly number[] = this.items.map(({ session }) => session.key)): Promise<string[]> {
    const ids = this.items.filter(({ session, id }) => keys.includes(session.key) && id !== null).map(({ id }) => id!);
    const answers = await Promise.all(ids.map((id) => this.backend.runningCommand(id).catch(() => null)));
    return answers.filter((answer): answer is string => answer !== null);
  }

  /** Close one tab, ending its shell. */
  close(key: number) {
    const index = this.items.findIndex(({ session }) => session.key === key);
    if (index < 0) return;
    const [item] = this.items.splice(index, 1);
    this.end(item);
    if (item.session.agent) this.executionId = null;
    const active = this.snapshot.active === key
      ? (this.items[index] ?? this.items[index - 1])?.session.key ?? null
      : this.snapshot.active;
    this.publish(active);
  }

  /** Close every tab, ending every shell. */
  endAll() {
    if (!this.items.length) return;
    this.executionId = null;
    for (const item of this.items.splice(0)) this.end(item);
    this.publish(null);
  }

  private end(item: Internal<S>) {
    item.closed = true;
    if (item.id !== null) void this.backend.close(item.id).catch(() => {});
    item.session.screen.dispose();
  }

  /**
   * The shell exited by itself (`exit`, ⌃D): a clean exit closes its tab, as
   * closing it would; any other keeps the tab and says how it ended, so a
   * profile that fails at once does not just vanish.
   */
  private exited(item: Internal<S>, code: number | null) {
    if (item.closed) return;
    if (code === 0) {
      this.close(item.session.key);
      return;
    }
    this.update(item, { state: { kind: "exited", code } });
  }

  private update(item: Internal<S>, patch: Partial<TerminalSession<S>>) {
    item.session = { ...item.session, ...patch };
    this.publish(this.snapshot.active);
  }

  private publish(active: number | null) {
    const sessions = this.items.map(({ session }) => session);
    this.snapshot = {
      sessions, active: sessions.some((session) => session.key === active) ? active : sessions.at(-1)?.key ?? null,
      executions: [...this.agentCommands.values()].reverse().sort((a, b) => (b.startedAt ?? "").localeCompare(a.startedAt ?? "")),
      executionId: this.executionId,
    };
    for (const listener of [...this.listeners]) listener();
  }
}

/** Allow styling and carriage returns, but discard terminal control requests. */
function terminalText(value: string, output: boolean): string {
  // eslint-disable-next-line no-control-regex
  const style = /^\x1b\[[\d;:]*m$/;
  return value
    // eslint-disable-next-line no-control-regex
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\|$)|\x1b\[[0-?]*[ -/]*[@-~]|[\x00-\x08\x0b-\x0c\x0e-\x1f\x7f-\x9f]/g, (sequence) =>
      output && style.test(sequence) ? sequence : "")
    .replace(/\r?\n/g, "\r\n");
}
