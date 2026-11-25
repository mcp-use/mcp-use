/**
 * The scenario catalog E0-E21 (PLAN.md §18.8.4). `local` says whether the row
 * runs under `E2E_TARGET=local` (§18.8.9); `platform` rows report
 * `platform-pending` on Manufact until WP-P1...WP-P11 are deployed on the dev space.
 * `implemented: false` rows are registered as skipped with a TODO(events) reason.
 */
export type Tag = "S" | "N" | "W" | "P" | "H";

export interface ScenarioRow {
  id: string;
  title: string;
  tags: readonly Tag[];
  local: boolean;
  implemented: boolean;
  /** Why a row is not runnable yet, shown as the skip reason. */
  pending?: string;
}

const ENGINE =
  "TODO(events): needs the server Events engine (WP-23..WP-26) on feat/mcp-events";

export const SCENARIOS: readonly ScenarioRow[] = [
  {
    id: "E0",
    title: "Deploy and identity",
    tags: ["S"],
    local: true,
    implemented: true,
  },
  {
    id: "E1",
    title: "Handshake, capabilities, pass-through",
    tags: ["S"],
    local: true,
    implemented: true,
  },
  {
    id: "E2",
    title: "Webhook, SEP",
    tags: ["S"],
    local: true,
    implemented: false,
    pending: ENGINE,
  },
  {
    id: "E3",
    title: "Webhook, ChatGPT dialect",
    tags: ["S"],
    local: true,
    implemented: false,
    pending: ENGINE,
  },
  {
    id: "E4",
    title: "Poll",
    tags: ["S"],
    local: true,
    implemented: false,
    pending: ENGINE,
  },
  {
    id: "E5",
    title: "Stream through the gateway",
    tags: ["S", "N", "P"],
    local: true,
    implemented: false,
    pending: ENGINE,
  },
  {
    id: "E6",
    title: "Replay",
    tags: ["N"],
    local: true,
    implemented: false,
    pending: ENGINE,
  },
  {
    id: "E7",
    title: "Redeploy continuity",
    tags: ["N"],
    local: true,
    implemented: false,
    pending: ENGINE,
  },
  {
    id: "E8",
    title: "SDK-upgrade continuity",
    tags: ["S", "N"],
    local: true,
    implemented: false,
    pending: `${ENGINE}; needs two variant bundles (E2E_FIXTURE_DIR_B)`,
  },
  {
    id: "E9",
    title: "Rollback dormancy",
    tags: ["N", "P"],
    local: false,
    implemented: false,
    pending:
      "TODO(events): production main under the prod-role lock; termination leg runs in catalog-lifecycle.test.ts",
  },
  {
    id: "E10",
    title: "Branch and preview isolation",
    tags: ["N"],
    local: true,
    implemented: false,
    pending: ENGINE,
  },
  {
    id: "E11",
    title: "Slug and domain",
    tags: ["N"],
    local: false,
    implemented: false,
    pending: "Manufact only (slug rename)",
  },
  {
    id: "E12",
    title: "Sleep and wake",
    tags: ["N", "P"],
    local: true,
    implemented: false,
    pending: `${ENGINE}; runWakeLoop`,
  },
  {
    id: "E13",
    title: "Tick and multiple instances",
    tags: ["N", "P"],
    local: true,
    implemented: false,
    pending: ENGINE,
  },
  {
    id: "E14",
    title: "Gateway secret redaction",
    tags: ["S", "N", "P"],
    local: true,
    implemented: true,
  },
  {
    id: "E15",
    title: "Egress",
    tags: ["N", "P"],
    local: true,
    implemented: false,
    pending: `${ENGINE}; createTestEgressProxy`,
  },
  {
    id: "E16",
    title: "Teardown and decommission",
    tags: ["N", "P"],
    local: true,
    implemented: false,
    pending: ENGINE,
  },
  {
    id: "E17",
    title: "Cloud surfaces and CLI contract",
    tags: ["N"],
    local: true,
    implemented: false,
    pending: "TODO(events): needs `mcp-use events` (WP-35)",
  },
  {
    id: "E18",
    title: "External-URL server",
    tags: ["N"],
    local: true,
    implemented: false,
    pending:
      "TODO(events): needs the deploy --external-url --server fix and the tunnel",
  },
  {
    id: "E19",
    title: "Catalog diff at deploy",
    tags: ["N"],
    local: true,
    implemented: false,
    pending: "TODO(events): needs the manifest catalog diff (WP-34)",
  },
  {
    id: "E20",
    title: "Live ChatGPT smoke",
    tags: ["H", "W"],
    local: false,
    implemented: false,
    pending: "Human run (§18.6 runbook)",
  },
  {
    id: "E21",
    title: "Inspector end to end",
    tags: ["N"],
    local: true,
    implemented: false,
    pending:
      "TODO(events): needs the Inspector Events tab (WP-33) and Playwright",
  },
];
