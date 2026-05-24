import { exec, spawn } from "child_process";
import { promisify } from "util";
import { getRedis } from "./redis-client";
import * as taskCmd from "./commands/task";
import * as agentCmd from "./commands/agent";

const execAsync = promisify(exec);
const POLL_INTERVAL = parseInt(process.env.POLL_INTERVAL_MS || "10000", 10);
const SHELL_TIMEOUT = parseInt(process.env.SHELL_TIMEOUT_MS || "60000", 10);
const AI_TIMEOUT = parseInt(process.env.AI_TIMEOUT_MS || "300000", 10);
const AGENT_NAME = process.env.AGENT_NAME || "claude-mini";
const AI_ENGINE = process.env.AI_ENGINE || "claude";
const AI_MODEL = process.env.AI_MODEL || "";
const COLLAB_CLI = "/Users/rainman/Developer/claude-collab/dist/cli.js";
const ENV_PATH = "/opt/homebrew/bin:/usr/local/bin:" + (process.env.PATH || "");

const CLAUDE_DEV_PROMPT = `你是 Mac Mini 上的开发者 agent。你的 orchestrator 是 macbook 上的 Claude Opus（项目经理兼架构师）。

## 工作原则
1. orchestrator 给你的任务通常已经拆解得很细，按指令执行即可
2. 如果指令清晰，直接执行，不要过度思考
3. 执行完后把结果（代码、输出、文件路径）完整返回

## 遇到困难时求助
如果你不确定该怎么做、指令有歧义、或尝试失败，立刻求助：
REDIS_URL=redis://127.0.0.1:6379 /opt/homebrew/bin/node ${COLLAB_CLI} send --from ${AGENT_NAME} --to macbook --msg "[求助] 任务: <简述>。问题: <具体卡点>。已尝试: <做了什么>"

## 汇报发现
执行中发现预期外的问题（比如依赖缺失、文件不存在），主动通知：
REDIS_URL=redis://127.0.0.1:6379 /opt/homebrew/bin/node ${COLLAB_CLI} send --from ${AGENT_NAME} --to macbook --msg "[发现] 内容"
`;

const CLAUDE_TEST_PROMPT = `你是 Mac Mini 上的测试 agent。你的 orchestrator 是 macbook 上的 Claude Opus。

## 工作原则
1. 按 orchestrator 的指令编写测试用例并执行
2. 测试结果要清晰：通过几个、失败几个、失败原因
3. 发现 bug 时详细描述复现步骤

## 遇到困难时求助
REDIS_URL=redis://127.0.0.1:6379 /opt/homebrew/bin/node ${COLLAB_CLI} send --from ${AGENT_NAME} --to macbook --msg "[求助] 任务: <简述>。问题: <具体卡点>"

## 发现缺陷时汇报
REDIS_URL=redis://127.0.0.1:6379 /opt/homebrew/bin/node ${COLLAB_CLI} send --from ${AGENT_NAME} --to macbook --msg "[缺陷] 内容"
`;

const CODEX_EXPERT_PROMPT = `你是团队的高级技术顾问（GPT-5.5）。你只在其他 agent 搞不定时才被召唤。

## 你被召唤的场景
- 疑难 bug 排查
- 关键代码审查
- 复杂架构问题
- 其他 agent 失败后的兜底

## 工作原则
1. 高质量输出，一次搞定
2. 给出完整解决方案，不要留半成品
3. 如果需要更多上下文，求助 orchestrator：
REDIS_URL=redis://127.0.0.1:6379 /opt/homebrew/bin/node ${COLLAB_CLI} send --from ${AGENT_NAME} --to macbook --msg "[求助] 需要更多上下文: <具体需要什么>"
`;

function getTaskMode(title: string): "shell" | "claude" | "codex" {
  if (/^\[shell\]/i.test(title.trim())) return "shell";
  if (/^\[codex\]/i.test(title.trim())) return "codex";
  if (/^\[claude\]/i.test(title.trim())) return "claude";
  if (/^\[dev\]/i.test(title.trim())) return "claude";
  if (/^\[test\]/i.test(title.trim())) return "claude";
  if (/^\[expert\]/i.test(title.trim())) return "codex";
  return AI_ENGINE as "claude" | "codex";
}

function getSystemPrompt(title: string): string {
  const t = title.trim().toLowerCase();
  if (/^\[test\]/.test(t)) return CLAUDE_TEST_PROMPT;
  if (/^\[expert\]/.test(t) || /^\[codex\]/.test(t)) return CODEX_EXPERT_PROMPT;
  return CLAUDE_DEV_PROMPT;
}

async function executeShell(desc: string): Promise<string> {
  const { stdout, stderr } = await execAsync(desc, {
    timeout: SHELL_TIMEOUT,
    maxBuffer: 1024 * 1024,
    env: { ...process.env, PATH: ENV_PATH },
  });
  return stderr ? `${stdout}\n[stderr] ${stderr}`.trim() : stdout.trim();
}

async function executeClaude(desc: string, systemPrompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error(`Claude timed out after ${AI_TIMEOUT}ms`));
    }, AI_TIMEOUT);

    let stdout = "";
    let stderr = "";
    const model = AI_MODEL || "qwen3.6-plus";

    const child = spawn("claude", [
      "-p", desc,
      "--model", model,
      "--dangerously-skip-permissions",
      "--append-system-prompt", systemPrompt,
    ], {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, PATH: ENV_PATH },
    });

    child.stdout.on("data", (d: Buffer) => { stdout += d.toString(); });
    child.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });
    child.on("close", (code: number) => {
      clearTimeout(timeout);
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(`claude exited ${code}\n${stderr.trim()}`));
    });
    child.on("error", (err: Error) => { clearTimeout(timeout); reject(err); });
  });
}

async function executeCodex(desc: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error(`Codex timed out after ${AI_TIMEOUT}ms`));
    }, AI_TIMEOUT);

    let stdout = "";
    let stderr = "";

    const args = [
      "exec",
      "-s", "danger-full-access",
      "--skip-git-repo-check",
      "--ephemeral",
      "-o", "/tmp/codex-task-output.txt",
      desc,
    ];
    if (AI_MODEL) {
      args.splice(1, 0, "-m", AI_MODEL);
    }

    const child = spawn("codex", args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, PATH: ENV_PATH },
    });

    child.stdin.end();
    child.stdout.on("data", (d: Buffer) => { stdout += d.toString(); });
    child.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });
    child.on("close", async (code: number) => {
      clearTimeout(timeout);
      try {
        const { stdout: fileContent } = await execAsync("cat /tmp/codex-task-output.txt 2>/dev/null || true");
        const result = fileContent.trim() || stdout.trim();
        if (code === 0) resolve(result);
        else reject(new Error(`codex exited ${code}\n${stderr.trim()}\n${result}`));
      } catch { resolve(stdout.trim()); }
    });
    child.on("error", (err: Error) => { clearTimeout(timeout); reject(err); });
  });
}

async function pollAndProcess(name: string): Promise<void> {
  const redis = getRedis();

  const directIds = await redis.smembers(`tasks:agent:${name}`);
  let task: { id: string; title: string; desc: string } | null = null;

  for (const id of directIds) {
    const data = await redis.hgetall(`task:${id}`);
    if (data.status === "claimed" && data.assignee === name && !data.result) {
      task = { id: data.id, title: data.title, desc: data.desc };
      break;
    }
  }

  if (!task) {
    const result = await taskCmd.claim(name, AI_ENGINE);
    if (!result.ok || !result.data) return;
    task = result.data as { id: string; title: string; desc: string };
  }

  console.log(`[${new Date().toISOString()}] Processing task ${task.id}: ${task.title} (mode: ${getTaskMode(task.title)})`);

  try {
    const mode = getTaskMode(task.title);
    const systemPrompt = getSystemPrompt(task.title);
    let output: string;

    switch (mode) {
      case "shell": output = await executeShell(task.desc); break;
      case "codex": output = await executeCodex(task.desc); break;
      default: output = await executeClaude(task.desc, systemPrompt); break;
    }

    await taskCmd.complete(task.id, output);
    console.log(`[${new Date().toISOString()}] Task ${task.id} completed (${mode})`);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    await taskCmd.complete(task.id, `[error] ${msg}`);
    console.error(`Task ${task.id} failed:`, msg);
  }
}

export async function startWorker(name: string): Promise<void> {
  await agentCmd.register(name, "worker");
  console.log(`[${new Date().toISOString()}] Worker "${name}" (engine: ${AI_ENGINE}) started, polling every ${POLL_INTERVAL}ms`);

  setInterval(async () => {
    try {
      await pollAndProcess(name);
    } catch (err: unknown) {
      console.error("Poll error:", err instanceof Error ? err.message : String(err));
    }
  }, POLL_INTERVAL);
}

startWorker(AGENT_NAME);
