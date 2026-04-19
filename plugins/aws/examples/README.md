# AWS Plugin Examples

These examples are meant to make the plugin feel immediately usable for a wide
range of teams. Each playbook gives you:

- a common workload or operating scenario
- the AWS services usually involved
- the plugin skills that matter first
- copy-paste prompts to start a high-signal conversation with Codex

## Start With The Closest Match

- `global-web-platform.md`: customer-facing application stack with delivery, security, data, and scaling concerns
- `secure-serverless-api.md`: API-first backend with Lambda, API Gateway, Cognito, and managed state
- `data-lake-analytics.md`: ingestion, lake, warehouse, analytics, and schema management flow
- `incident-response.md`: production debugging and containment under time pressure
- `migration-modernization.md`: migration planning, sequencing, cutover, and rollback strategy
- `prompt-library.md`: reusable prompts when you already know the problem shape

## Suggested First Commands

- Use `/aws:solution-map` when you are not sure which services or skills to start with.
- Use `/aws:architecture-review` when you already have a target design and want the tradeoffs called out.
- Use `/aws:security-review` when the question is really about exposure, secrets, access, or blast radius.
- Use `/aws:doctor` if the AWS plugin itself is not behaving as expected on the machine.
