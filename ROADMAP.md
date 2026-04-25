# Roadmap

What localclawd has today, and what it doesn't — yet.

---

## Shipped

| Feature                            | Notes                                                                  |
|------------------------------------|------------------------------------------------------------------------|
| TUI                                | multiline editing, slash-command autocomplete, streaming tool output   |
| Persistent project memory          | per-project state, key-file index, task history — auto-loaded at start |
| Self-curated memory lattice        | tag-scored recall across projects                                      |
| Telegram bridge                    | polling, interactive setup, voice-memo transcription                   |
| Slack bridge                       | polling, interactive setup, voice-memo transcription                   |
| Discord bridge                     | REST polling, interactive setup, voice-memo transcription              |
| Signal bridge                      | via `signal-cli`, shared `/stop /kill /status /schedules`              |
| Voice-memo transcription           | Whisper-compatible endpoint (OpenAI / Groq / any OSS variant)          |
| Trajectory compression             | `/compress-sessions` — condensed JSON for training data export         |
| Skill distillation                 | `/distill-skill` — proposes a reusable skill from the recent session   |
| Tailscale peers in setup           | `tailscale status` peers auto-listed in the endpoint picker            |
| Docker backend                     | `/docker-run <image> -- <cmd>` — ephemeral container, cwd bind-mounted |
| Singularity / Apptainer backend    | `/singularity-run <image> -- <cmd>` — HPC-friendly container runtime   |
| Modal backend                      | `/modal-run <module>::<func>` — serverless via the modal CLI           |
| Daytona backend                    | `/daytona-run <workspace> -- <cmd>` — wake-on-demand cloud workspaces  |
| Portable skills export/import      | `/skills-export` + `/skills-import` — markdown+frontmatter format      |
| Skill usage tracking               | `/skill-stats` — invocation counts + nudge to /distill-skill          |
| Skill notes (self-improvement v1)  | `/skill-note <skill> <lesson>` — appends to a per-skill notes file    |
| FTS5 session search                | Auto-uses BM25 when Node's `node:sqlite` is available (graceful fallback) |
| Reindex command                    | `/reindex-sessions` — refreshes the FTS5 index from summaries          |
| Windows host diagnostic            | `/windows-setup` — checks deps + persistent env-var hint               |
| Python RPC bridge                  | `/rpc` — local 127.0.0.1 HTTP server exposing read/write/edit/bash/grep |
| Scheduled automations              | `/schedule` with cron, `@daily`, `every Nm`, delivered to any bridge   |
| Session search                     | `/sessionsearch` — term-scored recall across all past conversations    |
| LLM session summarization          | `/summarize-sessions` — condense old sessions into a searchable index  |
| SSH backend                        | `/ssh` — run an agent loop on a remote machine                         |
| Subagent delegation                | Agent tool spawns isolated subagents in parallel                       |
| Keepgoing loop                     | `/keepgoing` autonomous multi-round work with stop signals             |
| Thinkharder pipeline               | `/thinkharder` 5-phase verification loop                               |
| Skills system                      | `/skills` create, load, invoke reusable capabilities                   |
| Skill self-improvement nudge       | after task completion, surface a suggestion to record a new skill      |
| Interactive setup                  | `/telegram /slack /discord` all use a 4-step wizard                    |
| `/stop /kill` from any bridge      | halt or terminate from any chat bridge                                 |
| Local-endpoint backends            | vLLM, Ollama, LM Studio, any OpenAI-compatible URL                     |
| No telemetry                       | analytics, feature flags, 1P event logging — all no-op                 |

## Roadmap

These are genuinely multi-turn work, external-service dependent, or both:

| Feature                            | Why it's not done yet                                                  |
|------------------------------------|------------------------------------------------------------------------|
| WhatsApp bridge                    | Requires Twilio (paid) or WhatsApp Web scraping (fragile, TOS risk)    |
| Honcho dialectic user modeling     | External service; data residency decisions pending                     |
| Deeper skill self-improvement loop | Notes exist; full self-rewrite needs invocation hooks not yet exposed  |
| Atropos RL environments            | Research-grade; batch trajectory generation pipeline                   |

---

Bridges use polling (not websockets/webhooks) — no public URL or gateway
connection required. If a feature here depends on an external account or paid
service, that's called out explicitly.
