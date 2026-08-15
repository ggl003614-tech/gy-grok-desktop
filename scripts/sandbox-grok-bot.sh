#!/usr/bin/env bash
# Fresh-machine smoke test for Grok Bot's Linux VM.
# This does NOT run GY Grok (Windows / WebView2 / Tauri).
# It answers: can a blank Linux user get the official Grok CLI,
# and does that CLI need a hidden localhost service?
set -euo pipefail

ROOT="${TMPDIR:-/tmp}/gy-grok-bot-sandbox-$$"
HOME_DIR="$ROOT/home"
REPORT="$ROOT/report.json"
mkdir -p "$HOME_DIR"
export HOME="$HOME_DIR"
export XDG_CONFIG_HOME="$HOME_DIR/.config"
export XDG_CACHE_HOME="$HOME_DIR/.cache"
unset GROK_BIN || true

ok=0
warn=0
: >"$ROOT/findings.jsonl"

add() {
  local sev="$1" title="$2" detail="${3:-}"
  printf '%s\t%s\t%s\n' "$sev" "$title" "$detail" >>"$ROOT/findings.jsonl"
  if [ "$sev" = ok ]; then ok=$((ok+1)); printf '[OK]   %s\n' "$title"
  elif [ "$sev" = warn ]; then warn=$((warn+1)); printf '[WARN] %s\n' "$title"
  else printf '[INFO] %s\n' "$title"
  fi
  [ -n "$detail" ] && printf '       %s\n' "$detail"
}

port_18765_listening() {
  if command -v ss >/dev/null 2>&1; then
    ss -ltn 2>/dev/null | grep -q ':18765'
    return $?
  fi
  if command -v netstat >/dev/null 2>&1; then
    netstat -ltn 2>/dev/null | grep -q ':18765'
    return $?
  fi
  # 18765 == 0x4945
  grep -q ':4945 ' /proc/net/tcp /proc/net/tcp6 2>/dev/null
}

uname_s="$(uname -s 2>/dev/null || echo unknown)"
uname_m="$(uname -m 2>/dev/null || echo unknown)"
printf 'GY Grok · Grok Bot Linux 沙箱\n主机 %s %s\n空白 HOME %s\n\n' "$uname_s" "$uname_m" "$HOME_DIR"

if [ "$uname_s" != Linux ]; then
  add warn "这不是 Linux" "Grok Bot 的虚拟机才是目标。当前是 $uname_s。"
fi

case "$uname_m" in
  x86_64|amd64) plat=linux-x86_64 ;;
  aarch64|arm64) plat=linux-aarch64 ;;
  *) plat="" ;;
esac

if [ -z "$plat" ]; then
  add warn "不认识的 CPU" "$uname_m"
  plat=linux-x86_64
else
  add ok "识别到 Linux 架构" "$plat"
fi

if command -v wine >/dev/null 2>&1; then
  add info "这台机器有 Wine" "不要用来跑 GY Grok。桌面客户端依赖 WebView2 / ConPTY，Wine 过不了。"
else
  add ok "没有 Wine，正好" "我们本来就不该在 Linux 上跑 grok-desk.exe。"
fi

if port_18765_listening; then
  add warn "本机已经有人占着 18765" "GY Grok 的电脑控制才会监听这个口。Linux CLI 不需要它。"
else
  add ok "127.0.0.1:18765 没有在听" "说明官方 CLI 不靠 GY Grok 在背后开的那个本机端口。"
fi

version=""
for url in "https://x.ai/cli/stable" "https://storage.googleapis.com/grok-build-public-artifacts/cli/stable"; do
  if version="$(curl -fsSL --max-time 20 "$url" | tr -d '[:space:]')"; then
    if printf '%s' "$version" | grep -q '^[0-9]'; then
      add ok "官方 CLI 通道可达" "$url → $version"
      break
    fi
  fi
  version=""
done
if [ -z "$version" ]; then
  add warn "官方 CLI 通道连不上" "新用户自动安装会失败。"
fi

bin=""
if [ -n "$version" ]; then
  artifact="https://x.ai/cli/grok-${version}-${plat}"
  dest="$HOME_DIR/.grok/bin/grok"
  mkdir -p "$(dirname "$dest")"
  if curl -fL --max-time 300 -o "$dest" "$artifact"; then
    chmod +x "$dest"
    size="$(wc -c < "$dest" | tr -d ' ')"
    if [ "$size" -gt 10000000 ]; then
      add ok "官方 Linux CLI 已下到空白 HOME" "$dest · ${size} bytes"
      bin="$dest"
    else
      add warn "下载文件小得不像正式包" "$size bytes from $artifact"
    fi
  else
    add warn "下载官方 Linux CLI 失败" "$artifact"
  fi
fi

if [ -n "$bin" ]; then
  if out="$("$bin" version 2>&1)"; then
    add ok "空白用户能跑 grok version" "$(printf '%s' "$out" | tr '\n' ' ' | cut -c1-200)"
  else
    add warn "grok version 失败" "$(printf '%s' "$out" | tr '\n' ' ' | cut -c1-200)"
  fi

  # ACP initialize: a brand-new machine should have no cached_token.
  init_out="$ROOT/init.jsonl"
  printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":1,"clientCapabilities":{}}}' \
    | timeout 25 "$bin" agent stdio >"$init_out" 2>"$ROOT/init.err" || true
  if grep -q '"result"' "$init_out" 2>/dev/null; then
    if grep -q 'cached_token' "$init_out"; then
      add warn "干净 HOME 里居然已有 cached_token" "这台 Linux 可能不是空白机。"
    else
      add ok "ACP initialize 成功，且没有现成登录" "新用户接下来要走官方登录。这是预期。"
    fi
  else
    add info "ACP initialize 没有完整结果" "$(tr '\n' ' ' < "$ROOT/init.err" | cut -c1-200)"
  fi
fi

add info "这份脚本测不到的东西" "GY Grok 窗口、WebView2、ConPTY、桌面电脑控制。那些只能在 Windows 上测。"

python3 - "$ROOT/findings.jsonl" "$REPORT" "$uname_s" "$uname_m" "$plat" "$HOME_DIR" "$ok" "$warn" <<'PY'
import json, sys
path, report, uname_s, uname_m, plat, home, ok, warn = sys.argv[1:9]
findings = []
try:
    for line in open(path, encoding="utf-8"):
        parts = line.rstrip("\n").split("\t", 2)
        if len(parts) < 2:
            continue
        findings.append({"severity": parts[0], "title": parts[1], "detail": parts[2] if len(parts) > 2 else ""})
except FileNotFoundError:
    pass
payload = {
    "host": {"sys": uname_s, "machine": uname_m, "platform": plat},
    "home": home,
    "ok": int(ok),
    "warn": int(warn),
    "findings": findings,
}
open(report, "w", encoding="utf-8").write(json.dumps(payload, ensure_ascii=False, indent=2) + "\n")
print("\n报告:", report)
print(json.dumps(payload, ensure_ascii=False, indent=2))
PY

[ "$warn" -eq 0 ] || exit 1
