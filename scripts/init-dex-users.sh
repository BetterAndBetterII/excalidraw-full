#!/bin/bash

set -e

# 检查环境变量
if [ -z "$ADMIN_PASSWORD" ]; then
    echo "错误: 请设置 ADMIN_PASSWORD 环境变量"
    exit 1
fi

# 生成密码哈希
echo "正在生成密码哈希..."
PASSWORD_HASH=$(docker run --rm dexidp/dex:v2.38.0 hash --password="$ADMIN_PASSWORD")

# 创建临时配置文件
cat > /tmp/dex-init-config.yml << EOF
issuer: http://localhost:5556

storage:
  type: sqlite3
  config:
    file: /var/lib/dex/dex.db

web:
  http: 0.0.0.0:5556

logger:
  level: info

enablePasswordDB: true

staticPasswords:
- email: ${ADMIN_EMAIL:-admin@example.com}
  hash: $PASSWORD_HASH
  username: ${ADMIN_USERNAME:-admin}
  userID: "admin-001"
EOF

# 初始化 Dex 数据库
echo "正在初始化 Dex 数据库..."
docker run --rm \
  -v $(pwd)/config/dex.config.yml:/etc/dex/config.yml \
  -v dex-data:/var/lib/dex \
  dexidp/dex:v2.38.0 \
  serve /etc/dex/config.yml &
DEX_PID=$!

# 等待 Dex 启动
echo "等待 Dex 启动..."
sleep 10

# 停止临时 Dex 进程
kill $DEX_PID 2>/dev/null || true

echo "Dex 用户初始化完成！"
echo "管理员账户:"
echo "  用户名: ${ADMIN_USERNAME:-admin}"
echo "  邮箱: ${ADMIN_EMAIL:-admin@example.com}"
echo "  密码: $ADMIN_PASSWORD"
echo ""
echo "请使用以下凭据登录:"
echo "  Dex UI: http://localhost:5556"
echo "  用户名: ${ADMIN_USERNAME:-admin}"
echo "  密码: $ADMIN_PASSWORD"