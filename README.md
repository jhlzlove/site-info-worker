# Site Info Worker

一个基于 Cloudflare Worker 的站点元数据提取服务。通过传入目标 URL，自动抓取页面 HTML 并解析出标题、描述和站点图标，以 JSON 格式返回。

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

### 1. 安装依赖

```bash
npm install
```

### 2. 配置环境变量

在 `wrangler.jsonc` 中修改以下变量：

| 变量 | 说明 | 示例 |
|------|------|------|
| `HOSTS` | 允许调用本服务的 Referer 域名列表（逗号分隔） | `"example.com,blog.example.com"` |
| `ALLOW_EMPTY_REFERER` | 是否允许无 Referer 的请求 | `"false"` |

### 3. 部署到 Cloudflare

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
