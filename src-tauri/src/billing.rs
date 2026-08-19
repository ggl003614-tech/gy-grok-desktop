use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{env, fs, path::PathBuf};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProductUsage {
    pub product: String,
    pub usage_percent: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountCredits {
    pub used_percent: f64,
    pub remaining_percent: f64,
    pub period_type: String,
    pub period_start: Option<String>,
    pub period_end: Option<String>,
    pub products: Vec<ProductUsage>,
    pub prepaid_dollars: Option<f64>,
    pub on_demand_used: Option<f64>,
    pub on_demand_cap: Option<f64>,
    pub subscription_tier: Option<String>,
    pub reset_available_count: u32,
    pub reset_token_id: Option<String>,
    pub reset_expires_at: Option<String>,
}

#[derive(Debug, Deserialize)]
struct BillingEnvelope {
    config: Option<BillingConfig>,
    #[serde(default, alias = "subscription_tier")]
    subscription_tier: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BillingConfig {
    current_period: Option<BillingPeriod>,
    credit_usage_percent: Option<f64>,
    on_demand_cap: Option<MoneyVal>,
    on_demand_used: Option<MoneyVal>,
    product_usage: Option<Vec<ProductUsageDto>>,
    prepaid_balance: Option<MoneyVal>,
    billing_period_start: Option<String>,
    billing_period_end: Option<String>,
}

#[derive(Debug, Deserialize)]
struct BillingPeriod {
    #[serde(rename = "type")]
    period_type: Option<String>,
    start: Option<String>,
    end: Option<String>,
}

#[derive(Debug, Deserialize)]
struct MoneyVal {
    val: Option<f64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProductUsageDto {
    product: Option<String>,
    usage_percent: Option<f64>,
}

pub fn parse_billing_config(value: &Value) -> Result<AccountCredits, String> {
    let envelope: BillingEnvelope = serde_json::from_value(value.clone())
        .map_err(|error| format!("无法解析账单数据：{error}"))?;
    let config = envelope
        .config
        .ok_or_else(|| "账单数据里没有 config".to_string())?;
    let used = config.credit_usage_percent.unwrap_or(0.0).clamp(0.0, 100.0);
    let period = config.current_period;
    let reset = parse_usage_reset(value);
    Ok(AccountCredits {
        used_percent: used,
        remaining_percent: (100.0 - used).clamp(0.0, 100.0),
        period_type: period
            .as_ref()
            .and_then(|item| item.period_type.clone())
            .unwrap_or_else(|| "USAGE_PERIOD_TYPE_WEEKLY".into()),
        period_start: period
            .as_ref()
            .and_then(|item| item.start.clone())
            .or(config.billing_period_start),
        period_end: period
            .as_ref()
            .and_then(|item| item.end.clone())
            .or(config.billing_period_end),
        products: config
            .product_usage
            .unwrap_or_default()
            .into_iter()
            .filter_map(|item| {
                Some(ProductUsage {
                    product: item.product?,
                    usage_percent: item.usage_percent?,
                })
            })
            .collect(),
        prepaid_dollars: config
            .prepaid_balance
            .and_then(|item| item.val)
            .map(|cents| cents / 100.0),
        on_demand_used: config.on_demand_used.and_then(|item| item.val),
        on_demand_cap: config.on_demand_cap.and_then(|item| item.val),
        subscription_tier: envelope.subscription_tier,
        reset_available_count: reset.reset_available_count,
        reset_token_id: reset.reset_token_id,
        reset_expires_at: reset.reset_expires_at,
    })
}

#[derive(Default)]
struct UsageResetInfo {
    reset_available_count: u32,
    reset_token_id: Option<String>,
    reset_expires_at: Option<String>,
}

fn parse_usage_reset(value: &Value) -> UsageResetInfo {
    let mut info = UsageResetInfo::default();
    collect_usage_reset(value, &mut info, 0, false);
    if info.reset_available_count == 0 && info.reset_token_id.is_some() {
        info.reset_available_count = 1;
    }
    info
}

fn collect_usage_reset(value: &Value, info: &mut UsageResetInfo, depth: u8, in_reset: bool) {
    if depth > 6 {
        return;
    }
    match value {
        Value::Object(map) => {
            let looks_like_reset = in_reset
                || map.keys().any(|key| {
                    let key = key.to_ascii_lowercase();
                    key.contains("reset") || key.contains("redeem")
                });
            if looks_like_reset {
                if let Some(count) = first_u32(
                    map,
                    &[
                        "availableCount",
                        "available_count",
                        "resetAvailableCount",
                        "reset_available_count",
                        "count",
                    ],
                ) {
                    info.reset_available_count = info.reset_available_count.max(count);
                }
                if info.reset_token_id.is_none() {
                    info.reset_token_id = first_string(
                        map,
                        &["tokenId", "token_id", "resetTokenId", "reset_token_id"],
                    );
                }
                if info.reset_expires_at.is_none() {
                    info.reset_expires_at =
                        first_string(map, &["expiry", "expiresAt", "expires_at", "expireAt"]);
                }
            }
            for child in map.values() {
                collect_usage_reset(child, info, depth + 1, looks_like_reset);
            }
        }
        Value::Array(items) => {
            for item in items.iter().take(24) {
                collect_usage_reset(item, info, depth + 1, in_reset);
            }
        }
        _ => {}
    }
}

fn first_string(map: &serde_json::Map<String, Value>, keys: &[&str]) -> Option<String> {
    keys.iter().find_map(|key| {
        map.get(*key)
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_owned)
    })
}

fn first_u32(map: &serde_json::Map<String, Value>, keys: &[&str]) -> Option<u32> {
    keys.iter().find_map(|key| {
        map.get(*key).and_then(|value| {
            value
                .as_u64()
                .or_else(|| value.as_i64().map(|n| n.max(0) as u64))
                .or_else(|| value.as_f64().map(|n| n.max(0.0) as u64))
                .map(|n| n as u32)
        })
    })
}

fn auth_path() -> Result<PathBuf, String> {
    let home = env::var_os("USERPROFILE")
        .or_else(|| env::var_os("HOME"))
        .ok_or_else(|| "找不到用户主目录".to_string())?;
    Ok(PathBuf::from(home).join(".grok").join("auth.json"))
}

fn extract_refresh_and_client(auth: &Value) -> Result<(String, String), String> {
    fn walk(value: &Value, client: &mut Option<String>, refresh: &mut Option<String>) {
        match value {
            Value::Object(map) => {
                for (key, child) in map {
                    if key.contains("auth.x.ai::") {
                        if let Some(id) = key.split("::").nth(1) {
                            let id = id.split('.').next().unwrap_or(id);
                            if !id.is_empty() {
                                *client = Some(id.to_string());
                            }
                        }
                    }
                    if key.eq_ignore_ascii_case("client_id") {
                        if let Some(text) = child.as_str().filter(|value| !value.is_empty()) {
                            *client = Some(text.to_string());
                        }
                    }
                    if key.eq_ignore_ascii_case("refresh_token") {
                        if let Some(text) = child.as_str().filter(|value| !value.is_empty()) {
                            *refresh = Some(text.to_string());
                        }
                    }
                    walk(child, client, refresh);
                }
            }
            Value::Array(items) => {
                for item in items.iter().take(8) {
                    walk(item, client, refresh);
                }
            }
            _ => {}
        }
    }
    let mut client = None;
    let mut refresh = None;
    walk(auth, &mut client, &mut refresh);
    Ok((
        refresh.ok_or_else(|| "本机 Grok 登录里没有 refresh_token，请先登录".to_string())?,
        client.ok_or_else(|| "本机 Grok 登录里没有 client_id，请先登录".to_string())?,
    ))
}

fn refresh_access_token(refresh_token: &str, client_id: &str) -> Result<String, String> {
    let response = ureq::post("https://auth.x.ai/oauth2/token")
        .set("User-Agent", "grok-desk")
        .send_form(&[
            ("grant_type", "refresh_token"),
            ("refresh_token", refresh_token),
            ("client_id", client_id),
        ])
        .map_err(|error| format!("刷新 Grok 登录失败：{error}"))?;
    let body: Value = response
        .into_json()
        .map_err(|error| format!("无法解析登录刷新结果：{error}"))?;
    body.get("access_token")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
        .ok_or_else(|| "Grok 登录刷新没有返回 access_token".into())
}

fn billing_url() -> String {
    let base = env::var("GROK_MODELS_BASE_URL")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| "https://cli-chat-proxy.grok.com/v1".into());
    format!("{}/billing?format=credits", base.trim_end_matches('/'))
}

fn fetch_billing_json(access_token: &str) -> Result<Value, String> {
    let response = ureq::get(&billing_url())
        .set("Authorization", &format!("Bearer {access_token}"))
        .set("x-grok-client-mode", "xai-grok-cli")
        .set("x-grok-client-version", "1.0.3")
        .set("User-Agent", "grok-desk")
        .call()
        .map_err(|error| format!("拉取 Grok 额度失败：{error}"))?;
    response
        .into_json()
        .map_err(|error| format!("无法解析 Grok 额度：{error}"))
}

fn fetch_credits_from_http() -> Result<AccountCredits, String> {
    let raw = fs::read_to_string(auth_path()?)
        .map_err(|_| "本机还没有 Grok 登录，请先连接账户".to_string())?;
    let auth: Value =
        serde_json::from_str(&raw).map_err(|error| format!("无法读取 Grok 登录：{error}"))?;
    let (refresh_token, client_id) = extract_refresh_and_client(&auth)?;
    let access_token = refresh_access_token(&refresh_token, &client_id)?;
    let payload = fetch_billing_json(&access_token)?;
    parse_billing_config(&payload)
}

#[tauri::command]
pub async fn fetch_account_credits() -> Result<AccountCredits, String> {
    match crate::cli::authenticated_acp_call("_x.ai/billing", serde_json::json!({})).await {
        Ok(payload) => parse_billing_config(&payload),
        Err(cli_error) => fetch_credits_from_http().map_err(|http_error| {
            format!("无法从 Grok CLI 读取额度：{cli_error}（备用接口：{http_error}）")
        }),
    }
}

#[tauri::command]
pub async fn redeem_usage_reset(token_id: Option<String>) -> Result<AccountCredits, String> {
    let token = token_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned);
    let params = match token.clone() {
        Some(token) => serde_json::json!({ "tokenId": token, "token_id": token }),
        None => serde_json::json!({}),
    };
    for method in [
        "_x.ai/usage-reset/redeem",
        "_x.ai/billing/reset",
        "x.ai/usage-reset/redeem",
    ] {
        if let Ok(payload) = crate::cli::authenticated_acp_call(method, params.clone()).await {
            if let Ok(credits) = parse_billing_config(&payload) {
                return Ok(credits);
            }
        }
    }
    redeem_usage_reset_http(token.as_deref())?;
    fetch_account_credits().await
}

fn redeem_usage_reset_http(token_id: Option<&str>) -> Result<(), String> {
    let raw = fs::read_to_string(auth_path()?)
        .map_err(|_| "本机还没有 Grok 登录，请先连接账户".to_string())?;
    let auth: Value =
        serde_json::from_str(&raw).map_err(|error| format!("无法读取 Grok 登录：{error}"))?;
    let (refresh_token, client_id) = extract_refresh_and_client(&auth)?;
    let access_token = refresh_access_token(&refresh_token, &client_id)?;
    let body = match token_id {
        Some(token) => serde_json::json!({ "tokenId": token, "token_id": token }),
        None => serde_json::json!({}),
    };
    let payload = serde_json::to_string(&body).unwrap_or_else(|_| "{}".into());
    let mut last_error = "没有可用的用量重置接口".to_string();
    for path in [
        "/billing/usage-reset/redeem",
        "/usage-reset/redeem",
        "/billing/reset",
    ] {
        match post_billing_json(&access_token, path, &payload) {
            Ok(_) => return Ok(()),
            Err(error) => last_error = error,
        }
    }
    Err(last_error)
}

fn post_billing_json(access_token: &str, path: &str, payload: &str) -> Result<Value, String> {
    let base = env::var("GROK_MODELS_BASE_URL")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| "https://cli-chat-proxy.grok.com/v1".into());
    let url = format!("{}{path}", base.trim_end_matches('/'));
    let response = ureq::post(&url)
        .set("Authorization", &format!("Bearer {access_token}"))
        .set("x-grok-client-mode", "xai-grok-cli")
        .set("x-grok-client-version", "1.0.3")
        .set("User-Agent", "grok-desk")
        .set("Content-Type", "application/json")
        .send_string(payload)
        .map_err(|error| format!("兑换用量重置失败：{error}"))?;
    if response.status() >= 400 {
        return Err(format!("兑换用量重置失败：HTTP {}", response.status()));
    }
    response
        .into_json()
        .or_else(|_| Ok(serde_json::json!({ "ok": true })))
}

#[cfg(test)]
mod tests {
    use super::parse_billing_config;
    use serde_json::json;

    #[test]
    fn parses_weekly_credit_remaining() {
        let value = json!({
            "config": {
                "currentPeriod": {
                    "type": "USAGE_PERIOD_TYPE_WEEKLY",
                    "start": "2026-08-09T16:01:29Z",
                    "end": "2026-08-16T16:01:29Z"
                },
                "creditUsagePercent": 38.0,
                "productUsage": [
                    {"product": "GrokBuild", "usagePercent": 36.0},
                    {"product": "GrokChat", "usagePercent": 2.0}
                ],
                "prepaidBalance": {"val": 10000}
            }
        });
        let credits = parse_billing_config(&value).unwrap();
        assert_eq!(credits.used_percent, 38.0);
        assert_eq!(credits.remaining_percent, 62.0);
        assert_eq!(credits.products[0].product, "GrokBuild");
        assert_eq!(credits.prepaid_dollars, Some(100.0));
        assert_eq!(credits.reset_available_count, 0);
    }

    #[test]
    fn parses_cli_billing_shape() {
        let value = json!({
            "config": {
                "creditUsagePercent": 40.0,
                "currentPeriod": {
                    "type": "USAGE_PERIOD_TYPE_WEEKLY",
                    "start": "2026-08-09T16:01:29Z",
                    "end": "2026-08-16T16:01:29Z"
                },
                "prepaidBalance": {"val": 10000}
            },
            "subscription_tier": "SuperGrok"
        });
        let credits = parse_billing_config(&value).unwrap();
        assert_eq!(credits.remaining_percent, 60.0);
        assert_eq!(credits.subscription_tier.as_deref(), Some("SuperGrok"));
    }

    #[test]
    fn parses_one_time_usage_reset_token() {
        let value = json!({
            "config": {
                "creditUsagePercent": 80.0,
                "usageReset": {
                    "availableCount": 1,
                    "expiry": "2026-09-15T00:00:00Z",
                    "tokens": [{ "tokenId": "reset-4.6-launch", "expiry": "2026-09-15T00:00:00Z" }]
                }
            }
        });
        let credits = parse_billing_config(&value).unwrap();
        assert_eq!(credits.reset_available_count, 1);
        assert_eq!(credits.reset_token_id.as_deref(), Some("reset-4.6-launch"));
        assert_eq!(
            credits.reset_expires_at.as_deref(),
            Some("2026-09-15T00:00:00Z")
        );
    }
}
