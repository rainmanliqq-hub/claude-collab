import { getRedis } from "../redis-client";
import { Task, CommandResult } from "../types";

export async function create(
  title: string,
  desc: string,
  creator: string,
  assignee?: string
): Promise<CommandResult> {
  const redis = getRedis();
  const id = await redis.incr("tasks:counter");
  const now = new Date().toISOString();
  const task: Task = {
    id: String(id),
    title,
    desc,
    status: assignee ? "claimed" : "pending",
    creator,
    assignee: assignee || "",
    result: "",
    created_at: now,
    updated_at: now,
  };
  await redis.hset(`task:${id}`, task as unknown as Record<string, string>);
  if (assignee) {
    await redis.sadd(`tasks:agent:${assignee}`, String(id));
  } else {
    await redis.rpush("tasks:queue", String(id));
  }
  await redis.sadd(`tasks:agent:${creator}`, String(id));
  return { ok: true, data: task };
}

export async function claim(name: string, engine?: string): Promise<CommandResult> {
  const redis = getRedis();
  const queueLen = await redis.llen("tasks:queue");

  for (let i = 0; i < queueLen; i++) {
    const taskId = await redis.lindex("tasks:queue", i);
    if (!taskId) continue;

    const data = await redis.hgetall(`task:${taskId}`);
    if (!data.id || data.status !== "pending") continue;

    const titleLower = (data.title || "").trim().toLowerCase();
    const prefixMatch = titleLower.match(/^\[(shell|claude|codex|dev|test|expert)\]/);

    if (prefixMatch) {
      const prefix = prefixMatch[1];
      const engineMap: Record<string, string> = { shell: "shell", claude: "claude", codex: "codex", dev: "claude", test: "claude", expert: "codex" };
      const requiredEngine = engineMap[prefix] || prefix;
      if (engine && requiredEngine !== engine && requiredEngine !== "shell") {
        continue;
      }
    }

    const removed = await redis.lrem("tasks:queue", 1, taskId);
    if (removed === 0) continue;

    const now = new Date().toISOString();
    await redis.hset(`task:${taskId}`, {
      status: "claimed",
      assignee: name,
      updated_at: now,
    });
    await redis.sadd(`tasks:agent:${name}`, taskId);
    const task = await redis.hgetall(`task:${taskId}`);
    return { ok: true, data: task };
  }

  return { ok: true, data: null };
}

export async function listTasks(
  filter: string,
  name?: string
): Promise<CommandResult> {
  const redis = getRedis();
  let taskIds: string[] = [];

  if (filter === "available") {
    taskIds = await redis.lrange("tasks:queue", 0, -1);
  } else if (filter === "mine" && name) {
    taskIds = await redis.smembers(`tasks:agent:${name}`);
  } else {
    const counter = await redis.get("tasks:counter");
    const max = parseInt(counter || "0", 10);
    for (let i = 1; i <= max; i++) {
      taskIds.push(String(i));
    }
  }

  const tasks: Task[] = [];
  for (const id of taskIds) {
    const data = await redis.hgetall(`task:${id}`);
    if (data.id) {
      tasks.push(data as unknown as Task);
    }
  }
  return { ok: true, data: tasks };
}

export async function complete(id: string, result: string): Promise<CommandResult> {
  const redis = getRedis();
  const exists = await redis.exists(`task:${id}`);
  if (!exists) {
    return { ok: false, error: `Task ${id} not found` };
  }
  const now = new Date().toISOString();
  await redis.hset(`task:${id}`, {
    status: "done",
    result,
    updated_at: now,
  });
  const task = await redis.hgetall(`task:${id}`);
  return { ok: true, data: task };
}

export async function get(id: string): Promise<CommandResult> {
  const redis = getRedis();
  const task = await redis.hgetall(`task:${id}`);
  if (!task.id) {
    return { ok: false, error: `Task ${id} not found` };
  }
  return { ok: true, data: task };
}
