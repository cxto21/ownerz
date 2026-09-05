# Inbox — orchestrator (sdd-orchestration)

**Status:** active since 2026-09-04
**Agent ID:** aa-orchestrator-b96ccf72
**Project:** datavaultz

## Handover Template

When passing work:

1. Save context to Engram: `mem_save` with topic_key=agent/work/orchestrator
2. Write summary to this inbox
3. Next agent reads `mem_context` + this inbox

## Protocol Reminders

- Read AGENTS.md before writing
- Check adocs/.atl for current topology
- Use aa-agent-observability for self-audit
- mem_session_summary at session end
