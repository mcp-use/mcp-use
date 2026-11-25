#!/usr/bin/env node
// One-time maintainer setup of long-lived e2e resources (PLAN.md §18.8.2-3):
// R1 `ev-e2e-recv`, R3 egress probe, `ev-e2e-app`, `ev-e2e-ext`.
//
// TODO(events): needs the e2e org and secrets (H2, H6). Until then this prints
// the steps instead of running them; the maintainer runs them by hand.
const steps = [
  "mcp-use servers create ev-e2e-app (managed upload server, production branch main)",
  "mcp-use deploy e2e/manufact/receiver --server ev-e2e-recv --env E2E_RECEIVER_TOKEN --env E2E_RECEIVER_STORE_URL --env E2E_RECEIVER_STORE_TOKEN",
  "wrangler deploy e2e/manufact/egress-probe (records CF-Connecting-IP per bucket)",
  "mcp-use servers create ev-e2e-ext (external-URL registration, E18)",
];
console.log(JSON.stringify({ execute: false, steps }, null, 2));
process.exitCode = 2;
