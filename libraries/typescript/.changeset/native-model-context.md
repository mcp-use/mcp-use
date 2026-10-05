---
"mcp-use": minor
---

Add useModelContext for keyed native text, image, resource-link, and embedded-resource attachments, with automatic activation and internal capability checks. Named content types expose friendly presentation on both input and restored output; imageFromUrl handles image conversion separately. Definite delivery failures retain selection for the next valid mutation, while uncertain writes remain blocked without a public retry control. Legacy-only views retain their transport; native activation preserves visible projections and rejects unsafe handoff from model-visible widget persistence.
