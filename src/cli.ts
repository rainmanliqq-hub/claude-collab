#!/usr/bin/env node

import { disconnect } from "./redis-client";
import * as agentCmd from "./commands/agent";
import * as taskCmd from "./commands/task";
import * as messageCmd from "./commands/message";
import { CommandResult } from "./types";

function parseArgs(args: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("--")) {
      const key = args[i].slice(2);
      const val = args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : "true";
      result[key] = val;
      if (val !== "true") i++;
    }
  }
  return result;
}

function output(result: CommandResult): void {
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
}

function showHelp(cmd?: string): void {
  const commands: Record<string, string> = {
    register: "collab register --name <name> --role <orchestrator|worker>",
    agents: "collab agents",
    heartbeat: "collab heartbeat --name <name>",
    status: "collab status --name <name>  (one-shot: inbox + my tasks + queue + agents)",
    "create-task": 'collab create-task --title <title> --desc <desc> --creator <name> [--assignee <name>]',
    "claim-task": "collab claim-task --name <name>",
    "list-tasks": "collab list-tasks [--filter available|mine|all] [--name <name>]",
    "complete-task": 'collab complete-task --id <id> --result <result>',
    "get-task": "collab get-task --id <id>",
    send: 'collab send --from <name> --to <name> --msg <message>',
    inbox: "collab inbox --name <name>",
    broadcast: 'collab broadcast --from <name> --msg <message>',
  };

  if (cmd && commands[cmd]) {
    output({ ok: true, data: { command: cmd, usage: commands[cmd] } });
  } else {
    output({ ok: true, data: commands });
  }
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  const opts = parseArgs(rest);

  let result: CommandResult;

  try {
    switch (command) {
      case "register":
        if (!opts.name || !opts.role) {
          result = { ok: false, error: "Missing --name or --role" };
          break;
        }
        result = await agentCmd.register(opts.name, opts.role);
        break;

      case "agents":
        result = await agentCmd.list();
        break;

      case "heartbeat":
        if (!opts.name) {
          result = { ok: false, error: "Missing --name" };
          break;
        }
        result = await agentCmd.heartbeat(opts.name);
        break;

      case "status":
        if (!opts.name) {
          result = { ok: false, error: "Missing --name" };
          break;
        }
        result = await agentCmd.status(opts.name);
        break;

      case "create-task":
        if (!opts.title || !opts.desc || !opts.creator) {
          result = { ok: false, error: "Missing --title, --desc, or --creator" };
          break;
        }
        result = await taskCmd.create(opts.title, opts.desc, opts.creator, opts.assignee);
        break;

      case "claim-task":
        if (!opts.name) {
          result = { ok: false, error: "Missing --name" };
          break;
        }
        result = await taskCmd.claim(opts.name);
        break;

      case "list-tasks":
        result = await taskCmd.listTasks(opts.filter || "all", opts.name);
        break;

      case "complete-task":
        if (!opts.id || !opts.result) {
          result = { ok: false, error: "Missing --id or --result" };
          break;
        }
        result = await taskCmd.complete(opts.id, opts.result);
        break;

      case "get-task":
        if (!opts.id) {
          result = { ok: false, error: "Missing --id" };
          break;
        }
        result = await taskCmd.get(opts.id);
        break;

      case "send":
        if (!opts.from || !opts.to || !opts.msg) {
          result = { ok: false, error: "Missing --from, --to, or --msg" };
          break;
        }
        result = await messageCmd.send(opts.from, opts.to, opts.msg);
        break;

      case "inbox":
        if (!opts.name) {
          result = { ok: false, error: "Missing --name" };
          break;
        }
        result = await messageCmd.inbox(opts.name);
        break;

      case "broadcast":
        if (!opts.from || !opts.msg) {
          result = { ok: false, error: "Missing --from or --msg" };
          break;
        }
        result = await messageCmd.broadcast(opts.from, opts.msg);
        break;

      case "help":
        showHelp(rest[0]);
        await disconnect();
        return;

      default:
        result = { ok: false, error: `Unknown command: ${command}. Run "collab help" for usage.` };
    }

    output(result);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    output({ ok: false, error: msg });
  } finally {
    await disconnect();
  }
}

main();
