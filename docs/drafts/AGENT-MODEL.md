# Agent model guidance

Agent ReAct (`runAgentTask`) needs a model with **stable tool calling**.

## Recommended

- Dedicated **agent** slot in Settings → Model (not the companion chat model).
- Prefer instruction-tuned chat models that emit tool calls reliably (e.g. Qwen3 Instruct / similar).
- Avoid **Reasoning Distilled** / heavy chain-of-thought models for the agent loop — they add latency and often skip or mangle tools.

## Companion vs agent

| Slot | Role |
|------|------|
| Chat / companion | Fast dialogue — tools usually off on trivial turns |
| Agent | Multi-step ReAct + tools + workspace |

## Optional deep verify

`LIA_AGENT_DEEP_VERIFY=1` — reserved for heavier post-edit checks (not required for DoD). Default path uses lightweight grounded checks (exists, non-empty, round-trip, JSON parse).
