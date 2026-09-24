#!/usr/bin/env bash
# 仓库卫生检查。只依赖 bash、git 与 GNU grep；不写任何文件。
# 检查对象：已跟踪文件 + 未被忽略的未跟踪文件（即下一次 `git add -A` 会纳入的内容）。
set -euo pipefail

root=$(git rev-parse --show-toplevel)
cd "$root"

failures=0
fail() { printf 'FAIL  %s\n' "$1"; failures=$((failures + 1)); }
pass() { printf 'ok    %s\n' "$1"; }

mapfile -d '' files < <(git ls-files -z --cached --others --exclude-standard)
existing=()
for f in "${files[@]}"; do
  [[ -e $f ]] && existing+=("$f")
done

# 1. 必需文件
required=(README.md LICENSE AGENTS.md CLAUDE.md .gitignore .env.example docs/status.md docs/README.md)
missing=()
for f in "${required[@]}"; do
  [[ -f $f ]] || missing+=("$f")
done
if ((${#missing[@]})); then
  fail "缺少必需文件：${missing[*]}"
else
  pass "必需文件齐全"
fi

if git check-ignore -q .env.example; then
  fail ".env.example 被 .gitignore 忽略，应保持可提交"
else
  pass ".env.example 可提交"
fi

# 2. 不应进入版本库的路径
forbidden_re='^(temp/|\.vscode/|\.codex/|\.idea/|\.claude/settings\.local\.json$|node_modules/|(.*/)?__pycache__/|\.venv/|venv/)|(^|/)\.env$|(^|/)\.env\.'
bad=()
for f in "${existing[@]}"; do
  [[ $f =~ $forbidden_re ]] || continue
  [[ $f =~ (^|/)\.env\.example$ ]] && continue
  bad+=("$f")
done
mapfile -t tracked_ignored < <(git ls-files --cached --ignored --exclude-standard)
bad+=("${tracked_ignored[@]}")
if ((${#bad[@]})); then
  mapfile -t bad < <(printf '%s\n' "${bad[@]}" | sort -u)
  fail "以下路径不应进入版本库：$(printf '%s ' "${bad[@]}")"
else
  pass "没有禁止跟踪的路径"
fi

# 3. 疑似 secret
secret_re='sk-ant-[A-Za-z0-9_-]{20,}|sk-[A-Za-z0-9]{40,}|gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{40,}|AKIA[0-9A-Z]{16}|xox[abprs]-[A-Za-z0-9-]{10,}|-----BEGIN [A-Z ]*PRIVATE KEY-----'
if ((${#existing[@]})) && hits=$(grep -nIE -- "$secret_re" "${existing[@]}" 2>/dev/null | cut -c1-120); then
  fail "发现疑似 secret（只显示前 120 字符）："
  printf '      %s\n' "${hits//$'\n'/$'\n'      }"
else
  pass "未发现疑似 secret"
fi

# 4. Markdown 引用
# 4a. 相对链接 [text](path)，相对于所在文件解析。
# 4b. 反引号中的仓库根相对路径（docs/、scripts/、experiments/ 开头），跳过 <slug>、NNNN 等占位。
broken=()
for f in "${existing[@]}"; do
  [[ $f == *.md ]] || continue
  dir=$(dirname "$f")
  while IFS= read -r target; do
    target=${target%%#*}
    [[ -z $target || $target =~ ^[a-z]+: ]] && continue
    [[ -e "$dir/$target" ]] || broken+=("$f -> $target")
  done < <(grep -oE '\]\([^) ]+\)' "$f" | sed -E 's/^\]\((.*)\)$/\1/')
  while IFS= read -r target; do
    [[ $target =~ [\<\*]|NNNN|yyyy|YYYY ]] && continue
    [[ -e $target ]] || broken+=("$f -> $target")
  done < <(grep -oE '`(docs|scripts|experiments)/[^` ]*`' "$f" | tr -d '`')
done
if ((${#broken[@]})); then
  fail "失效的 Markdown 引用："
  printf '      %s\n' "${broken[@]}"
else
  pass "Markdown 引用均可解析"
fi

# 5. shell 脚本语法
bad_sh=()
for f in "${existing[@]}"; do
  [[ $f == *.sh ]] || continue
  bash -n "$f" 2>/dev/null || bad_sh+=("$f")
done
if ((${#bad_sh[@]})); then
  fail "shell 语法错误：${bad_sh[*]}"
else
  pass "shell 脚本语法正确"
fi

if ((failures)); then
  printf '\n%d 项检查失败。\n' "$failures"
  exit 1
fi
printf '\n全部检查通过。\n'
