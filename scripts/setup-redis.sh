#!/bin/bash
# Mac Mini Redis 安装和配置脚本
# 用法: bash scripts/setup-redis.sh

set -e

echo "=== Installing Redis via Homebrew ==="
if ! command -v redis-server &> /dev/null; then
  brew install redis
else
  echo "Redis already installed."
fi

echo ""
echo "=== Configuring Redis for LAN access ==="

REDIS_CONF="$(brew --prefix)/etc/redis.conf"

# 备份原始配置
cp "$REDIS_CONF" "$REDIS_CONF.bak"

# 绑定所有网卡（局域网可访问）
sed -i '' 's/^bind 127.0.0.1.*/bind 0.0.0.0/' "$REDIS_CONF"

# 关闭 protected mode（局域网内信任环境）
sed -i '' 's/^protected-mode yes/protected-mode no/' "$REDIS_CONF"

echo "Config updated: bind 0.0.0.0, protected-mode no"

echo ""
echo "=== Starting Redis ==="
brew services start redis

echo ""
echo "=== Verifying ==="
sleep 1
redis-cli ping

echo ""
LOCAL_IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo "unknown")
echo "=== Done ==="
echo "Redis is running on: ${LOCAL_IP}:6379"
echo "Other machines can connect with: REDIS_URL=redis://${LOCAL_IP}:6379"
