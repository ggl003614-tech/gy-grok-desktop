export type ConnectorKind = "official-web" | "http";

export interface CatalogConnector {
  id: string;
  name: string;
  detail: string;
  kind: ConnectorKind;
  url: string;
}

export const OFFICIAL_CONNECTORS_URL = "https://grok.com/connectors";

export const CATALOG_CONNECTORS: CatalogConnector[] = [
  {
    id: "gmail",
    name: "Gmail 与日历",
    detail: "官方连接器，在 grok.com 授权 Google",
    kind: "official-web",
    url: OFFICIAL_CONNECTORS_URL,
  },
  {
    id: "google-drive",
    name: "Google Drive",
    detail: "官方连接器，文档、表格与幻灯片",
    kind: "official-web",
    url: OFFICIAL_CONNECTORS_URL,
  },
  {
    id: "github",
    name: "GitHub",
    detail: "仓库、Issue 与 PR",
    kind: "http",
    url: "https://api.githubcopilot.com/mcp/",
  },
  {
    id: "linear",
    name: "Linear",
    detail: "官方 HTTP MCP，登录后即可用",
    kind: "http",
    url: "https://mcp.linear.app/mcp",
  },
  {
    id: "notion",
    name: "Notion",
    detail: "官方 HTTP MCP，页面与数据库",
    kind: "http",
    url: "https://mcp.notion.com/mcp",
  },
  {
    id: "sentry",
    name: "Sentry",
    detail: "官方 HTTP MCP，错误与项目",
    kind: "http",
    url: "https://mcp.sentry.dev/mcp",
  },
];
