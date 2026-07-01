# WeChat Draft Box Publisher MCP Server 部署与配置说明

本项目提供了一个基于 Model Context Protocol (MCP) 的微信公众号草稿箱发布服务。由于微信公众平台对 API 调用有严格的 **IP 白名单限制**，通常建议将其部署在具有固定公网 IP 的云服务器（如阿里云 ECS）上。

通过 **SSH 桥接（隧道）** AI 工具（如 Cursor、Claude Desktop、Antigravity、Codex 等）中直接调用部署在云端的 MCP 服务。

---

## 步骤一：云服务器环境准备 (阿里云)

1. **安装 Node.js**
   推荐安装 Node.js 18 或更高版本。建议使用 `nvm` 进行管理：
   ```bash
   # 安装 nvm (Node Version Manager)
   curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
   source ~/.bashrc

   # 安装并使用 Node.js 18
   nvm install 18
   nvm use 18
   ```

2. **开放 SSH 连接**
   确保你的本地机器可以通过 SSH 免密登录云服务器。推荐配置 SSH 密钥对，避免在配置文件中写入密码。

---

## 步骤二：上传代码并安装依赖

1. **上传目录**
   将 `wechat-mcp` 目录上传到云服务器的指定目录（例如 `/home/admin/wechat-mcp`）。
   > **注意**：上传时请排除 `node_modules` 目录。
   ```bash
   # 在本地执行 (替换为你的服务器 IP 和路径)
   scp -r ./wechat-mcp username@your_aliyun_ip:/home/admin/
   ```

2. **在服务器上安装依赖**
   SSH 登录云服务器，进入目录并安装依赖：
   ```bash
   cd /home/admin/wechat-mcp
   npm install --legacy-peer-deps
   ```

3. **测试启动**
   运行以下命令确保没有错误：
   ```bash
   node src/index.js
   ```
   **预期输出**：
   ```
   WeChat Publish MCP Server running on Stdio transport.
   ```
   *看到输出后，按 `Ctrl+C` 退出即可。*

---

## 步骤三：微信公众号后台配置 (IP 白名单)

1. 登录 [微信公众平台](https://mp.weixin.qq.com/)。
2. 进入 **设置与开发 -> 基本配置**。
3. 复制你的 **AppID** 和 **AppSecret** (后文配置需要)。
4. 找到 **IP白名单** 配置项，点击修改，将你的 **阿里云服务器的公网 IP** 添加到白名单中。
   > **提示**：只有白名单中的 IP 才能成功调用微信接口获取 `access_token`。

---

## 步骤四：配置本地 AI 客户端 (SSH 桥接)

MCP 基于标准输入输出（Stdio）进行通信。我们可以利用 `ssh` 命令将本地的输入输出直接管道到云服务器运行的 Node.js 进程上。这样，本地 AI 客户端调用 Tool 时，请求会穿透到云服务器发出，从而使用云服务器的固定 IP 绕过微信限制。

根据你使用的客户端，修改对应的配置文件。

### 1. Claude Desktop 配置
修改本地配置文件（Mac 路径为 `~/Library/Application Support/Claude/claude_desktop_config.json`）：

```json
{
  "mcpServers": {
    "wechat-publish-remote": {
      "command": "ssh",
      "args": [
        "-o", "StrictHostKeyChecking=no",
        "username@your_aliyun_ip",
        "WECHAT_APP_ID=你的_AppID WECHAT_APP_SECRET=你的_AppSecret node /home/admin/wechat-mcp/src/index.js"
      ]
    }
  }
}
```

### 2. Cursor 配置
1. 打开 Cursor 设置 (`Settings -> Features -> MCP`)。
2. 点击 **+ Add New MCP Server**。
3. 填入以下配置：
   - **Name**: `wechat-publish-remote`
   - **Type**: `command`
   - **Command**:
     ```bash
     ssh -o StrictHostKeyChecking=no username@your_aliyun_ip "WECHAT_APP_ID=你的_AppID WECHAT_APP_SECRET=你的_AppSecret node /home/admin/wechat-mcp/src/index.js"
     ```

### 3. Cline / Roo Code / Antigravity 配置
修改相应的配置文件，加入以下 Server：
```json
"wechat-publish-remote": {
  "command": "ssh",
  "args": [
    "-o", "StrictHostKeyChecking=no",
    "username@your_aliyun_ip",
    "WECHAT_APP_ID=你的_AppID WECHAT_APP_SECRET=你的_AppSecret node /home/admin/wechat-mcp/src/index.js"
  ]
}
```

---

## 常见问题与排查

1. **SSH 免密登录**
   如果配置文件中不能交互输入密码，必须配置本地到阿里云的 SSH 免密登录。
   ```bash
   # 在本地生成密钥（如有则跳过）
   ssh-keygen -t rsa
   # 复制公钥到阿里云服务器
   ssh-copy-id username@your_aliyun_ip
   ```

2. **微信 API 报错：`ip invalid`**
   - 报错信息类似：`{"errcode":40164,"errmsg":"invalid ip ... secret ... not in whitelist"}`。
   - 这是因为微信未同步或白名单中配错了解析出的 IP。请双击报错信息中的 IP，再次确认已将其加进微信后台白名单。

3. **Node.js 路径问题**
   如果 SSH 连接后提示 `node: command not found`，说明远程服务器的 node 路径不在默认非交互式 shell 的 PATH 中。
   请在云服务器上通过 `which node` 获取完整路径，并在配置中使用绝对路径替换 `node`（如 `/usr/local/bin/node` 或 `/home/admin/.nvm/versions/node/v18.x.x/bin/node`）。
