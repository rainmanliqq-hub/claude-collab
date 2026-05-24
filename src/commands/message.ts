import { getRedis } from "../redis-client";
import { Message, CommandResult } from "../types";

export async function send(from: string, to: string, msg: string): Promise<CommandResult> {
  const redis = getRedis();
  const message: Message = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    from,
    to,
    msg,
    timestamp: new Date().toISOString(),
  };
  await redis.lpush(`inbox:${to}`, JSON.stringify(message));
  return { ok: true, data: message };
}

export async function inbox(name: string): Promise<CommandResult> {
  const redis = getRedis();
  const raw = await redis.lrange(`inbox:${name}`, 0, -1);
  const messages: Message[] = raw.map((r) => JSON.parse(r));
  await redis.del(`inbox:${name}`);
  return { ok: true, data: messages };
}

export async function broadcast(from: string, msg: string): Promise<CommandResult> {
  const redis = getRedis();
  const agents = await redis.smembers("agents:all");
  const message: Message = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    from,
    to: "*",
    msg,
    timestamp: new Date().toISOString(),
  };
  const payload = JSON.stringify(message);
  for (const agent of agents) {
    if (agent !== from) {
      await redis.lpush(`inbox:${agent}`, payload);
    }
  }
  return { ok: true, data: { sent_to: agents.filter((a) => a !== from) } };
}
