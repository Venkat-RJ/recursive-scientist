export type AgentTerminalUpdate = {
  workspaceRoot: string;
  id: string;
  command: string;
  output: string;
  stdout?: string;
  stderr?: string;
  cwd?: string;
  provider?: string;
  threadId?: string;
  turnId?: string;
  startedAt?: string;
  completedAt?: string;
  reveal?: boolean;
  status: "running" | "completed" | "failed" | "cancelled" | "unknown";
  exitCode: number | null;
  truncated: boolean;
};

export function parseAgentTerminalUpdate(data: Record<string, unknown>): AgentTerminalUpdate | null {
  const { workspaceRoot, id, command, output, status, exitCode, truncated } = data;
  if (
    typeof workspaceRoot !== "string" || !workspaceRoot ||
    typeof id !== "string" || !id || id.length > 1024 ||
    typeof command !== "string" || !command || command.length > 4096 ||
    typeof output !== "string" || output.length > 32768 ||
    (status !== "running" && status !== "completed" && status !== "failed" && status !== "cancelled" && status !== "unknown") ||
    (exitCode !== null && (typeof exitCode !== "number" || !Number.isSafeInteger(exitCode))) ||
    typeof truncated !== "boolean"
  ) return null;
  const metadata: Partial<AgentTerminalUpdate> = {};
  for (const field of ["stdout", "stderr", "cwd", "provider", "threadId", "turnId", "startedAt", "completedAt"] as const) {
    const value = data[field];
    if (typeof value === "string") metadata[field] = value.slice(0, field === "stdout" || field === "stderr" ? 32768 : 4096);
  }
  return { workspaceRoot, id, command, output, status, exitCode, truncated, ...metadata, reveal: data.reveal === true };
}
