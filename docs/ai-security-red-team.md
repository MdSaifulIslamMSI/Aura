# AI Assistant Red-Team Program (OWASP LLM Top 10)

The Aura assistant (chat, streaming chat, voice, visual search) is an LLM
attack surface. This program provides deterministic, CI-enforced defenses
plus an adversarial evaluation harness — all free, no API keys required.

## Components

| Component | Path | Purpose |
| --- | --- | --- |
| Prompt guard | `server/services/ai/promptGuardService.js` | Deterministic input/output classifier (pure functions, no deps) |
| Controller gate | `server/controllers/aiController.js` | Rejects blocked prompts in BOTH `handleAiChat` and `handleAiChatStream` with `ASSISTANT_SAFETY_POLICY` (400) |
| Jest red-team suite | `server/tests/promptGuardService.test.js` | 30 assertions: 16 attack classes, 8 benign false-positive probes, output-leak cases |
| promptfoo eval | `security/ai/promptfooconfig.yaml` + `guard-provider.mjs` | 21-case adversarial corpus evaluated through the official promptfoo CLI (`npm run security:ai:eval`) |
| CI gate | `.github/workflows/ai-guard-eval.yml` | Runs the promptfoo eval on every change to the guard, the controller, or this corpus; daily schedule |

## OWASP LLM Top 10 (2025) coverage

| Risk | Defense |
| --- | --- |
| LLM01 Prompt Injection | `llm01.instruction_override`, `llm01.role_confusion` (incl. chat-template markers `<|im_start|>`, `[INST]`), plus second-order injection detection in tool output |
| LLM02 Sensitive Disclosure | `llm02.secret_exfiltration` (input), `llm02.output_secret_material` (output: API keys, GitHub tokens, AWS keys, Slack tokens, private keys, JWTs) |
| LLM03 Supply Chain | Covered by the supply-chain program (PR #380: SBOM, Scorecard, zizmor) |
| LLM06 Excessive Agency | `llm06.excessive_agency` — destructive-action and self-escalation requests are rejected before the model |
| LLM08 Misinformation | Assistant contract already enforces `verification` labels and citation normalization (`assistantContract.js`) |

## Guard design rules

1. **High precision over recall.** Every pattern is a confirmed hard rejection;
   over-blocking a legitimate commerce question is treated as a defect (there
   is a dedicated false-positive test set mirroring real chat traffic).
2. **Reasons are category ids only** (`llm01.instruction_override`, …) — raw
   attacker text is never logged or returned to the client.
3. **Both chat paths gated.** Streaming (`handleAiChatStream`) cannot be used
   to bypass the non-streaming gate.

## Adding a test

1. Add the attack string to `server/tests/promptGuardService.test.js`
   (`injectionCorpus`) and to `security/ai/promptfooconfig.yaml`.
2. Run `npm run security:ai:eval` (repo root) — must pass.
3. If the guard missed it, tighten the pattern with the false-positive set
   green, then commit both together.

## Known limitations

- Heuristic detection, not a model: novel paraphrases can slip through;
  upstream guardrails in the provider registry remain the second layer.
- `inspectUserPrompt` evaluates single messages; multi-turn staged injection
  across conversation history is a Phase-4 (OpenFGA / session-guard) item.
