---
---

Remove the agent observability integration tests that query the live Langfuse
API. These tests gated CI on a third-party SaaS endpoint and live credentials,
and have been returning `403 Forbidden` from `cloud.langfuse.com`, reddening
canary. The remaining tests verify observability enable/disable behavior
locally without any network dependency. Test-only change, no release needed.
