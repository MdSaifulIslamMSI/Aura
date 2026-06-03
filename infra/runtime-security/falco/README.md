# Falco Runtime Notes

Use Falco to alert on unexpected shell execution, file writes in runtime containers, and network tools launched from the API container.

Keep rules in alert-only mode first. Blocking belongs in orchestrator policy after false-positive review.
