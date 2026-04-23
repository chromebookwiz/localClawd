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
| Voice-memo transcription           | Whisper-compatible endpoint (OpenAI / Groq / any OSS variant)          |
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
| Signal bridge                      | Requires `signal-cli` daemon installed on the host                     |
| Docker backend                     | Container image + lifecycle glue; substantial work                     |
| Daytona backend                    | Needs a Daytona account; serverless-persistent envs                    |
| Modal backend                      | Needs a Modal account; wake-on-demand GPU sandboxes                    |
| Singularity backend                | HPC-focused container runtime; low demand                              |
| FTS5 session search upgrade        | Depends on stable `node:sqlite`; current term-scored search works      |
| Honcho dialectic user modeling     | External service; data residency decisions pending                     |
| agentskills.io open-standard compat | Spec still evolving; local skills format is the source of truth today |
| Atropos RL environments            | Research-grade; batch trajectory generation pipeline                   |
| Trajectory compression             | Pending Atropos                                                        |
| Python RPC tool bridge             | Local socket server for out-of-band tool calls                         |

---

Bridges use polling (not websockets/webhooks) — no public URL or gateway
connection required. If a feature here depends on an external account or paid
service, that's called out explicitly.
