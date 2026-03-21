#!/usr/bin/env bash
# MVP: вызов Cursor Agent CLI по полям RPA (код команды, проект, чат, промпт).
# Использование:
#   rpa-agent.sh QUERY   /abs/path/to/workspace  ""|"CHAT_ID"  "текст промпта"
#   rpa-agent.sh APPLY   /abs/path/to/workspace  CHAT_ID       "текст"   # с --force
#   rpa-agent.sh NEW_CHAT /abs/path/to/workspace  ignored       "первый промпт (опц.)"
#   rpa-agent.sh LIST_CHATS /abs/path/to/workspace
#
# Примечание: встроенный `agent ls` использует TUI и в неинтерактивном SSH часто падает.
# LIST_CHATS выводит журнал чатов, создаваемый при NEW_CHAT (~/.config/cursor-rpa/chats.log).
set -euo pipefail

CMD="${1:-}"
WS="${2:-}"
CHAT="${3:-}"
PROMPT="${4:-}"
REGISTRY="${CURSOR_RPA_CHAT_REGISTRY:-$HOME/.config/cursor-rpa/chats.log}"

if [[ -z "$CMD" || -z "$WS" ]]; then
  echo "usage: $0 QUERY|APPLY|NEW_CHAT|LIST_CHATS <workspace_dir> [chat_id] [prompt]" >&2
  exit 2
fi

export PATH="$HOME/.local/bin:$PATH"
if [[ -f "$HOME/.config/cursor-rpa/env.sh" ]]; then
  # shellcheck source=/dev/null
  source "$HOME/.config/cursor-rpa/env.sh"
fi

[[ -d "$WS" ]] || { echo "workspace not a directory: $WS" >&2; exit 1; }
mkdir -p "$(dirname "$REGISTRY")"
touch "$REGISTRY"
chmod 600 "$REGISTRY" 2>/dev/null || true

case "$CMD" in
  LIST_CHATS)
    if [[ ! -s "$REGISTRY" ]]; then
      echo "(журнал пуст: $REGISTRY; создайте чат через NEW_CHAT)" >&2
      exit 0
    fi
    awk -v w="$WS" -F'\t' '$1==w {print $2"\t"$3}' "$REGISTRY" | tail -n 20
    echo "---" >&2
    echo "Полный интерактивный список: в обычном SSH-терминале: agent ls --workspace \"$WS\"" >&2
    ;;
  NEW_CHAT)
    CID="$(agent create-chat --workspace "$WS")"
    printf '%s\t%s\t%s\n' "$WS" "$CID" "$(date -Iseconds)" >>"$REGISTRY"
    echo "$CID"
    if [[ -n "$PROMPT" ]]; then
      agent -p --trust --output-format text --workspace "$WS" --resume "$CID" "$PROMPT"
    fi
    ;;
  QUERY)
    ARGS=(agent -p --trust --output-format text --workspace "$WS")
    [[ -n "$CHAT" ]] && ARGS+=(--resume "$CHAT")
    ARGS+=("$PROMPT")
    exec "${ARGS[@]}"
    ;;
  APPLY)
    ARGS=(agent -p --trust --force --output-format text --workspace "$WS")
    [[ -n "$CHAT" ]] && ARGS+=(--resume "$CHAT")
    ARGS+=("$PROMPT")
    exec "${ARGS[@]}"
    ;;
  *)
    echo "unknown command: $CMD" >&2
    exit 2
    ;;
esac
