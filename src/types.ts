export interface Agent {
  name: string;
  role: "orchestrator" | "worker";
  status: "online" | "offline";
  last_seen: string;
  registered_at: string;
}

export type TaskStatus = "pending" | "claimed" | "done";

export interface Task {
  id: string;
  title: string;
  desc: string;
  status: TaskStatus;
  creator: string;
  assignee: string;
  result: string;
  created_at: string;
  updated_at: string;
}

export interface Message {
  id: string;
  from: string;
  to: string;
  msg: string;
  timestamp: string;
}

export interface CommandResult {
  ok: boolean;
  data?: unknown;
  error?: string;
}
