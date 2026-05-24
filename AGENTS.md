# Agent 协作系统使用说明

本系统通过 Redis 实现多 agent 间的任务分发和消息通讯。所有命令通过 CLI 调用，输出为 JSON。

## 环境准备

```bash
export REDIS_URL="redis://<mac-mini-ip>:6379"
alias collab="node /path/to/claude-collab/dist/cli.js"
```

## 命令参考

### 注册（首次使用必须执行）

```bash
collab register --name <your-name> --role <orchestrator|worker>
```

### 查看在线 agent

```bash
collab agents
```

### 心跳（worker 定期执行保持在线状态）

```bash
collab heartbeat --name <your-name>
```

### 创建任务

```bash
collab create-task --title "任务标题" --desc "详细描述" --creator <your-name> [--assignee <target-agent>]
```

- 不指定 `--assignee` 则任务进入公共队列等待认领
- 指定 `--assignee` 则直接分配给目标 agent

### 认领任务

```bash
collab claim-task --name <your-name>
```

从公共队列中取出一个待处理任务。

### 查看任务列表

```bash
collab list-tasks --filter <available|mine|all> [--name <your-name>]
```

- `available`: 公共队列中待认领的任务
- `mine`: 与我相关的任务（需要 --name）
- `all`: 所有任务

### 查看任务详情

```bash
collab get-task --id <task-id>
```

### 完成任务

```bash
collab complete-task --id <task-id> --result "执行结果描述"
```

### 发送消息

```bash
collab send --from <your-name> --to <target-agent> --msg "消息内容"
```

### 查看收件箱

```bash
collab inbox --name <your-name>
```

读取后消息会被清空。

### 广播消息

```bash
collab broadcast --from <your-name> --msg "广播内容"
```

发送给除自己外的所有已注册 agent。

## 典型工作流

### Worker 循环（Codex / hermes-agent）

```bash
# 1. 注册
collab register --name codex-mini --role worker

# 2. 循环：检查收件箱 → 认领任务 → 执行 → 提交结果
collab inbox --name codex-mini
collab claim-task --name codex-mini
# ... 执行任务 ...
collab complete-task --id <id> --result "完成描述"
```

### Orchestrator 流程（MacBook Claude Code）

```bash
# 1. 注册
collab register --name macbook --role orchestrator

# 2. 创建任务
collab create-task --title "跑单元测试" --desc "cd /project && npm test" --creator macbook

# 3. 一次性查看全部状态（推荐）
collab status --name macbook

# 4. 或分别查看
collab list-tasks --filter mine --name macbook
collab get-task --id 1
collab inbox --name macbook
```

### 自主 Orchestrator 模式（MacBook Claude Code + /loop）

MacBook 上的 Claude Code 可以作为自主决策者运行，不需要人守着。启动方式：

在 Claude Code 中执行 `/loop`，prompt 设为：

```
你是自主 orchestrator。每次唤醒时：
1. 运行 `collab status --name macbook` 获取当前状态
2. 根据状态做决策：
   - 如果有新消息：阅读并决定是否需要行动
   - 如果有已完成的任务（status=done）：检查 result，决定下一步
   - 如果队列为空且所有任务完成：汇报整体进展
   - 如果某个任务长时间未完成：发消息询问 worker 进度
3. 可以执行的动作：
   - 创建新任务分配给 worker
   - 发送消息给 worker（指导、追问、确认）
   - 广播状态更新
4. 如果没有需要处理的事项，安静等待下一次唤醒
```

这样 MacBook 就变成了你的代理人——它监控整体进度、做出决策、分派工作，你只在需要时才介入。
