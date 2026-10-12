# Site Info Worker

一个基于 Cloudflare Worker 的站点元数据提取服务。通过传入目标 URL，自动抓取页面 HTML 并解析出标题、描述和站点图标，以 JSON 格式返回。

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/jhlzlove/site-info-worker)

## 功能特性

- 解析网页 `<title>`、`og:description`、`description` 元数据
- 提取站点图标（`apple-touch-icon` -> `icon` -> `og:image` -> `twitter:image`）
- 支持 HTTP 重定向追踪（最多 5 次）
- SSRF 防护：阻止访问私有/本地 IP 地址
- 响应大小限制：HTML 不超过 1MB
- Content-Type 校验：仅处理 HTML 响应
- Referer 白名单访问控制
- CORS 跨域支持

## 部署

### 方式 A：一键部署（推荐，无需 Fork）

点击上面的 `Deploy to Cloudflare` 按钮，或访问：

```
https://deploy.workers.cloudflare.com/?url=https://github.com/jhlzlove/site-info-worker
```

Cloudflare 会自动 Clone 本仓库到你的 GitHub/GitLab 账号、创建 Worker 并完成首次部署。

> 注意：Deploy 确认页只能修改仓库名、Worker 名等基础信息，**不能直接填写 `HOSTS` 等业务变量**，
> 首次部署完成后，按下面的「配置变量（覆盖默认值）」步骤在 Dashboard 中补填即可。

### 方式 B：Fork 仓库后连接 Git 部署（推荐，可持续同步上游）

1. 点击本仓库右上角 `Fork`，将仓库 Fork 到你自己的 GitHub 账号。
2. 打开 [Cloudflare Dashboard](https://dash.cloudflare.com/)，进入 `Workers & Pages` > `Create` > `Connect Git`。
3. 选择你刚 Fork 的仓库（如 `your-name/site-info-worker`），分支选 `main`。
4. 构建配置保持默认即可（构建命令为空，部署命令为 `npx wrangler deploy`），点击 `Save and deploy` 完成首次部署。
5. 之后你每次 `git push` 到 `main` 分支，Cloudflare Workers Builds 都会自动重新部署；
   直接在 GitHub 网页上改文件并 Commit 也会触发部署，无需本地环境。

### 配置变量（覆盖默认值，A / B 通用）

本项目已在 `wrangler.jsonc` 中开启 `keep_vars: true`，
你在 Dashboard 填写的变量**不会**被下次 Git 推送部署覆盖，可以放心在页面上修改：

1. 在 Dashboard 进入 `Workers & Pages`，点击你的 Worker（如 `site-info-worker`）。
2. 进入 `Settings` > `Variables and Secrets`，点击 `Add`（或 `Edit variables`）。
3. 添加以下两个纯文本（Plaintext）变量：

| 变量 | 说明 | 示例 |
|------|------|------|
| `HOSTS` | 允许调用本服务的 Referer 域名列表（逗号分隔） | `example.com,blog.example.com` |
| `ALLOW_EMPTY_REFERER` | 是否允许无 Referer 的请求 | `false` |

4. 点击 `Deploy`（或 `Save and deploy`）使变量生效。
5. 后续如需修改，重复上述步骤即可，无需改代码、无需重新连接仓库。

> 也可直接改 Fork 仓库中的 `wrangler.jsonc` 的 `vars` 字段后 `git push`，
> 但更推荐用 Dashboard 变量覆盖，避免把自己的域名提交进 Git 历史。

### 方式 C：本地 Wrangler 命令行部署

1. 修改 `wrangler.jsonc` 中的 `vars`（`HOSTS` / `ALLOW_EMPTY_REFERER`），或部署后在 Dashboard 按上面的「配置变量」步骤覆盖。
2. 执行部署：

```bash
npx wrangler deploy
```

## API 使用说明

### 请求

```
GET /?url=<目标URL>
```

**请求头：**

| Header | 必填 | 说明 |
|--------|------|------|
| `Referer` | 是* | 发起请求的页面地址，域名必须在 `HOSTS` 白名单中 |

> \* 当 `ALLOW_EMPTY_REFERER` 设为 `"true"` 时可不传。

**查询参数：**

| 参数 | 必填 | 说明 |
|------|------|------|
| `url` | 是 | 目标网站的完整 URL（仅支持 `http:` 和 `https:`） |

### 响应

**成功响应（200）：**

```json
{
  "url": "https://example.com/article",
  "title": "页面标题",
  "desc": "页面描述",
  "icon": "https://example.com/favicon.ico"
}
```

| 字段 | 说明 |
|------|------|
| `url` | 最终页面 URL（经过重定向后的地址） |
| `title` | 页面 `<title>` 内容 |
| `desc` | 页面描述（优先取 `og:description`，回退到 `<meta name="description">`） |
| `icon` | 站点图标的绝对 URL（可能不存在） |

**错误响应：**

| 状态码 | 场景 |
|--------|------|
| `400` | 缺少 `url` 参数 |
| `403` | Referer 缺失、无效或不在白名单中 |
| `405` | 请求方法不是 GET |
| `502` | 目标 URL 无效、请求失败、返回非 HTML 或超过大小限制 |

## 使用示例

### 前端调用

```javascript
const res = await fetch(
  'https://your-worker.example.com/?url=https://target-site.com'
);
const data = await res.json();
console.log(data.title, data.desc, data.icon);
```

### curl 测试

```bash
curl -H "Referer: https://your-allowed-domain.com" \
  "https://your-worker.example.com/?url=https://target-site.com"
```

## 安全说明

- 服务通过 `HOSTS` 环境变量控制 Referer 白名单，防止被任意第三方调用
- 内置 SSRF 防护，禁止访问 `localhost`、`127.0.0.1`、`192.168.*`、`10.*`、`172.16-31.*` 等内网地址
- 目标 URL 不允许携带用户名/密码（`user:pass@host` 格式会被拒绝）
- 限制单次 HTML 响应最大 1MB，防止内存耗尽
- 请求超时时间 8 秒
