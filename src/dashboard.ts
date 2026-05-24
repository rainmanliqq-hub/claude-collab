import http from "http";
import fs from "fs";
import path from "path";
import { WebSocketServer, WebSocket } from "ws";
import { getRedis } from "./redis-client";
import { Task, Agent } from "./types";
import Redis from "ioredis";

const PORT = 7890;

async function getAllTasks(): Promise<Task[]> {
  const redis = getRedis();
  const counter = await redis.get("tasks:counter");
  const max = parseInt(counter || "0", 10);
  const tasks: Task[] = [];
  for (let i = 1; i <= max; i++) {
    const data = await redis.hgetall(`task:${i}`);
    if (data.id) tasks.push(data as unknown as Task);
  }
  return tasks;
}

async function getAllAgents(): Promise<Agent[]> {
  const redis = getRedis();
  const names = await redis.smembers("agents:all");
  const agents: Agent[] = [];
  for (const name of names) {
    const data = await redis.hgetall(`agent:${name}`);
    if (data.name) agents.push(data as unknown as Agent);
  }
  return agents;
}

async function getRecentEvents(): Promise<string[]> {
  return getRedis().lrange("collab:events:log", 0, 99);
}

function broadcast(wsClients: Set<WebSocket>, msg: object): void {
  const data = JSON.stringify(msg);
  for (const client of wsClients) {
    if (client.readyState === WebSocket.OPEN) client.send(data);
  }
}

export async function startDashboard(): Promise<void> {
  const server = http.createServer((req, res) => {
    if (req.url === "/" || req.url === "/index.html") {
      const filePath = path.join(__dirname, "../public/index.html");
      fs.readFile(filePath, (err, data) => {
        if (err) {
          res.writeHead(500, { "Content-Type": "text/plain" });
          res.end("Internal Server Error");
          return;
        }
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(data);
      });
    } else {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not Found");
    }
  });

  const wss = new WebSocketServer({ noServer: true });
  const clients = new Set<WebSocket>();

  server.on("upgrade", (req, socket, head) => {
    if (req.url === "/ws") {
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit("connection", ws, req);
      });
    } else {
      socket.destroy();
    }
  });

  wss.on("connection", async (ws) => {
    clients.add(ws);

    const [tasks, agents, eventsRaw] = await Promise.all([
      getAllTasks(),
      getAllAgents(),
      getRecentEvents(),
    ]);

    const events = eventsRaw.map((s) => {
      try { return JSON.parse(s); } catch { return null; }
    }).filter(Boolean);

    ws.send(JSON.stringify({ type: "init", tasks, agents, events }));

    ws.on("close", () => clients.delete(ws));
  });

  // Redis pub/sub subscriber (separate connection, can't share with commands)
  const sub = new Redis(process.env.REDIS_URL || "redis://127.0.0.1:6379", {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
  });
  await sub.connect();
  await sub.subscribe("collab:events");

  sub.on("message", (_channel, message) => {
    let parsed: unknown;
    try { parsed = JSON.parse(message); } catch { return; }

    if (parsed && typeof parsed === "object" && "type" in parsed) {
      const msg = parsed as { type: string };
      if (msg.type === "task_update" || msg.type === "agent_update" || msg.type === "event") {
        broadcast(clients, parsed);
      }
    }
  });

  server.listen(PORT, () => {
    console.log(`Dashboard running at http://127.0.0.1:${PORT}`);
  });
}

// Allow running directly: node dist/dashboard.js
if (require.main === module) {
  startDashboard().catch((err) => {
    console.error("Failed to start dashboard:", err);
    process.exit(1);
  });
}
