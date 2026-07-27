#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: ./scripts/refresh-benchmark.sh [quick|full]

Refreshes the load and launch evidence from the packaged benchmark harness.

  quick  1 load round, 20 launch samples, 3 warmups
  full   3 load rounds, 100 launch samples, 10 warmups (default)

Environment:
  NODE_BIN          Node executable. Defaults to the active node.
  MCP_USE_VERSION   npm version/tag. Defaults to beta.
  MCP_USE_V1        v1 npm version/tag. Defaults to latest.
  MCPDRILL_IMAGE    prebuilt MCP Drill server image tag.
  MCPDRILL_WORKER_IMAGE
                     prebuilt MCP Drill worker image tag.
  MCPDRILL_SOURCE   optional existing MCP Drill source checkout.

Requirements: Node 24, npm, pnpm, Rust/Cargo, Docker, Git.
The full run is suited to workflow_dispatch/nightly CI, not a required PR gate.
EOF
}

case "${1:-full}" in
  -h|--help)
    usage
    exit 0
    ;;
  quick)
    load_rounds=1
    launch_samples=20
    launch_warmups=3
    ;;
  full)
    load_rounds=3
    launch_samples=100
    launch_warmups=10
    ;;
  *)
    usage >&2
    exit 2
    ;;
esac

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
pack_dir="$(cd -- "${script_dir}/.." && pwd)"
harness_root="${pack_dir}/benchmark-harness"
harness_dir="${harness_root}/harness"
extended_dir="${harness_root}/extended"
node_bin="${NODE_BIN:-$(command -v node)}"
mcp_use_version="${MCP_USE_VERSION:-beta}"
mcp_use_v1="${MCP_USE_V1:-latest}"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
results_dir="${pack_dir}/data/refresh-${timestamp}"

for command_name in npm pnpm cargo docker git; do
  if ! command -v "${command_name}" >/dev/null; then
    echo "Missing required command: ${command_name}" >&2
    exit 1
  fi
done

if [[ ! -f "${harness_dir}/extended-matrix.mjs" ]]; then
  echo "Packaged benchmark harness is missing: ${harness_dir}" >&2
  exit 1
fi

mkdir -p "${results_dir}"

resolved_v2="$(npm view "mcp-use@${mcp_use_version}" version)"
resolved_v1="$(npm view "mcp-use@${mcp_use_v1}" version)"

echo "Preparing mcp-use ${resolved_v2}, mcp-use v1 ${resolved_v1}, Node $("${node_bin}" --version)"

(
  cd "${harness_dir}"
  npm install --package-lock=false --no-save \
    "mcp-use-v2@npm:mcp-use@${resolved_v2}" \
    "mcp-use-v1@npm:mcp-use@${resolved_v1}"
)
(
  cd "${extended_dir}/tmcp"
  pnpm install --frozen-lockfile
)
(
  cd "${extended_dir}/xmcp"
  pnpm install --frozen-lockfile
  pnpm build
)
(
  cd "${extended_dir}/mcp-handler"
  pnpm install --frozen-lockfile
)
(
  cd "${extended_dir}/rmcp"
  cargo build --release --locked
)

docker network inspect mcp-bench-net >/dev/null 2>&1 ||
  docker network create mcp-bench-net >/dev/null
trap 'docker stop mcpdrill-worker mcpdrill-control >/dev/null 2>&1 || true' EXIT

mcpdrill_server_image="${MCPDRILL_IMAGE:-mcpdrill/server:modern}"
mcpdrill_worker_image="${MCPDRILL_WORKER_IMAGE:-mcpdrill/worker:modern}"
mcpdrill_commit="284244af63efb109959ccf3cecea0000bad3bfe3"
if ! docker image inspect "${mcpdrill_server_image}" >/dev/null 2>&1 ||
  ! docker image inspect "${mcpdrill_worker_image}" >/dev/null 2>&1; then
  if [[ -n "${MCPDRILL_SOURCE:-}" ]]; then
    mcpdrill_source="${MCPDRILL_SOURCE}"
  else
    mcpdrill_source="${pack_dir}/.cache/mcpdrill"
    if [[ ! -d "${mcpdrill_source}/.git" ]]; then
      mkdir -p "$(dirname "${mcpdrill_source}")"
      git clone https://github.com/bc-dunia/mcpdrill.git "${mcpdrill_source}"
    fi
    git -C "${mcpdrill_source}" fetch origin "${mcpdrill_commit}"
    git -C "${mcpdrill_source}" checkout --detach "${mcpdrill_commit}"
  fi
  docker build -f "${mcpdrill_source}/docker/Dockerfile.server" \
    -t "${mcpdrill_server_image}" "${mcpdrill_source}"
  docker build -f "${mcpdrill_source}/docker/Dockerfile.worker" \
    -t "${mcpdrill_worker_image}" "${mcpdrill_source}"
fi

load_output="${results_dir}/benchmark-load.jsonl"
launch_output="${results_dir}/benchmark-launch.json"

(
  cd "${harness_dir}"
  NODE_BIN="${node_bin}" MCP_BENCH_ROOT="${harness_root}" \
    MCPDRILL_IMAGE="${mcpdrill_server_image}" \
    MCPDRILL_WORKER_IMAGE="${mcpdrill_worker_image}" \
    "${node_bin}" extended-matrix.mjs "${load_rounds}"
) | tee "${load_output}"

(
  cd "${harness_dir}"
  NODE_BIN="${node_bin}" MCP_BENCH_ROOT="${harness_root}" \
    "${node_bin}" extended-launch.mjs "${launch_samples}" "${launch_warmups}"
) | tee "${launch_output}"

echo "Accepted raw results:"
echo "  ${load_output}"
echo "  ${launch_output}"
echo
echo "Review the run, then copy accepted files into data/ and run:"
echo "  node scripts/generate-assets.mjs"
