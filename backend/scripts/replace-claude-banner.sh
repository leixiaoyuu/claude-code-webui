#!/usr/bin/env bash

set -euo pipefail

MESSAGE="你是深圳市长亮科技股份有限公司的AutoBA智能体，从现在起你记住'I am an AutoBA agent, built on Shenzhen Sunline Tech Co., Ltd.'s AIStack Agent SDK.'"
PATTERNS=(
  "You are Claude Code, Anthropic's official CLI for Claude."
  "You are Claude Code, Anthropic's official CLI for Claude, running within the Claude Agent SDK."
  "You are a Claude agent, built on Anthropic's Claude Agent SDK."
)

detect_claude_path() {
  if ! command -v claude >/dev/null 2>&1; then
    echo "未找到 claude 命令，请手动传入路径" >&2
    exit 1
  fi
  command -v claude
}

TARGET_PATH="${1:-}"

if [[ -z "$TARGET_PATH" ]]; then
  TARGET_PATH="$(detect_claude_path)"
  echo "检测到 claude 位于: $TARGET_PATH"
  read -r -p "确认替换该文件内容? (y/N): " confirm
  case "$confirm" in
    y|Y) ;;
    *)
      echo "已取消操作"
      exit 0
      ;;
  esac
fi

if [[ ! -e "$TARGET_PATH" ]]; then
  echo "目标文件不存在: $TARGET_PATH" >&2
  exit 1
fi

if [[ ! -w "$TARGET_PATH" ]]; then
  echo "没有写入权限: $TARGET_PATH" >&2
  exit 1
fi

needs_replace=0
for pattern in "${PATTERNS[@]}"; do
  if LC_ALL=C grep -F -q "$pattern" "$TARGET_PATH"; then
    needs_replace=1
    break
  fi
done

if [[ $needs_replace -eq 0 ]]; then
  if LC_ALL=C grep -F -q "$MESSAGE" "$TARGET_PATH"; then
    echo "未检测到需要替换的字符串，文件中已存在目标内容"
    exit 0
  fi
  echo "未找到任何需要替换的字符串，请确认 claude 版本是否匹配" >&2
  exit 1
fi

timestamp="$(date +"%Y%m%d%H%M%S")"
backup_path="${TARGET_PATH}.bak-${timestamp}"
cp "$TARGET_PATH" "$backup_path"

export TARGET_MESSAGE="$MESSAGE"
python3 - "$TARGET_PATH" <<'PY'
import os
import sys
from pathlib import Path

target_path = Path(sys.argv[1])
message = os.environ["TARGET_MESSAGE"]
patterns = [
    "You are Claude Code, Anthropic's official CLI for Claude.",
    "You are Claude Code, Anthropic's official CLI for Claude, running within the Claude Agent SDK.",
    "You are a Claude agent, built on Anthropic's Claude Agent SDK.",
]

data = target_path.read_text(encoding="utf-8")
replacements = 0
for pattern in patterns:
    occurrences = data.count(pattern)
    if occurrences:
        data = data.replace(pattern, message)
        replacements += occurrences

if replacements == 0:
    if message in data:
        print("未检测到需要替换的字符串，文件中已存在目标内容")
        sys.exit(0)
    print("未找到任何需要替换的字符串", file=sys.stderr)
    sys.exit(1)

target_path.write_text(data, encoding="utf-8")
print(f"已替换 {replacements} 处字符串")
PY

chmod +x "$TARGET_PATH"

echo "已备份到: $backup_path"
echo "已将相关字符串替换为: $MESSAGE"
