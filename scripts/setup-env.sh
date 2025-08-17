#!/bin/bash

# 生成随机密码
generate_password() {
    openssl rand -base64 16 | tr -d "=+/" | cut -c1-16
}

# 生成 JWT 密钥
generate_jwt_secret() {
    openssl rand -base64 32 | tr -d "=+/" | cut -c1-32
}

echo "正在生成环境变量配置..."

# 生成随机密码和密钥
ADMIN_PASSWORD=$(generate_password)
JWT_SECRET=$(generate_jwt_secret)
OIDC_CLIENT_SECRET=$(generate_password)

# 创建 .env 文件
cat > .env << EOF
# === 认证配置 ===
AUTH_TYPE=oidc

# GitHub OAuth 配置 (可选)
# GITHUB_CLIENT_ID=your_github_client_id
# GITHUB_CLIENT_SECRET=your_github_client_secret
# GITHUB_REDIRECT_URL=http://localhost:3002/auth/github/callback

# OIDC 配置
OIDC_ISSUER_URL=http://localhost:5556/.well-known/openid-configuration
OIDC_CLIENT_ID=excalidraw
OIDC_CLIENT_SECRET=$OIDC_CLIENT_SECRET
OIDC_REDIRECT_URL=http://localhost:3002/auth/oidc/callback

# Dex 配置
OIDC_CLIENT_SECRET=$OIDC_CLIENT_SECRET
ADMIN_USERNAME=admin
ADMIN_PASSWORD=$ADMIN_PASSWORD
ADMIN_EMAIL=admin@example.com

# === JWT 配置 ===
JWT_SECRET=$JWT_SECRET

# === 存储配置 ===
STORAGE_TYPE=sqlite
DATA_SOURCE_NAME=excalidraw.db
LOCAL_STORAGE_PATH=./data

# === 应用配置 ===
LISTEN=:3002
LOG_LEVEL=info

# === OpenAI 配置 (可选) ===
# OPENAI_API_KEY=sk-your_openai_api_key
# OPENAI_BASE_URL=https://api.openai.com
EOF

echo "环境变量配置已生成到 .env 文件"
echo ""
echo "重要信息请保存："
echo "  管理员密码: $ADMIN_PASSWORD"
echo "  JWT 密钥: $JWT_SECRET"
echo "  Dex 客户端密钥: $OIDC_CLIENT_SECRET"
echo ""
echo "请运行以下命令启动服务："
echo "  1. docker-compose -f docker-compose.dex.yml up -d"
echo "  2. ./scripts/init-dex-users.sh"
echo "  3. docker-compose up -d"