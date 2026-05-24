import { getRedis } from "../redis-client";
import { Agent, CommandResult } from "../types";

export async function register(name: string, role: string): Promise<CommandResult> {
  const redis = getRedis();
  const now = new Date().toISOString();
  await redis.hset(`agent:${name}`, {
    name,
    role,
    status: "online",
    last_seen: now,
    registered_at: now,
  });
  await redis.sadd("agents:all", name);
  return { ok: true, data: { name, role, registered_at: now } };
}

export async function list(): Promise<CommandResult> {
  const redis = getRedis();
  const names = await redis.smembers("agents:all");
  const agents: Agent[] = [];
  for (const name of names) {
    const data = await redis.hgetall(`agent:${name}`);
    if (data.name) {
      agents.push(data as unknown as Agent);
    }
  }
  return { ok: true, data: agents };
}

export async function heartbeat(name: string): Promise<CommandResult> {
  const redis = getRedis();
  const exists = await redis.exists(`agent:${name}`);
  if (!exists) {
    return { ok: false, error: `Agent "${name}" not registered` };
  }
  const now = new Date().toISOString();
  await redis.hset(`agent:${name}`, { status: "online", last_seen: now });
  return { ok: true, data: { name, last_seen: now } };
}

export async function status(name: string): Promise<CommandResult> {
  const redis = getRedis();

  const now = new Date().toISOString();
  await redis.hset(`agent:${name}`, { status: "online", last_seen: now });

  const inboxRaw = await redis.lrange(`inbox:${name}`, 0, -1);
  const messages = inboxRaw.map((r) => JSON.parse(r));
  if (inboxRaw.length > 0) {
    await redis.del(`inbox:${name}`);
  }

  const taskIds = await redis.smembers(`tasks:agent:${name}`);
  const tasks = [];
  for (const id of taskIds) {
    const t = await redis.hgetall(`task:${id}`);
    if (t.id) tasks.push(t);
  }

  const pendingInQueue = await redis.llen("tasks:queue");

  const agentNames = await redis.smembers("agents:all");
  const agents = [];
  for (const n of agentNames) {
    const a = await redis.hgetall(`agent:${n}`);
    if (a.name) agents.push({ name: a.name, role: a.role, status: a.status, last_seen: a.last_seen });
  }

  return {
    ok: true,
    data: {
      messages,
      my_tasks: tasks,
      pending_in_queue: pendingInQueue,
      agents,
    },
  };
}
