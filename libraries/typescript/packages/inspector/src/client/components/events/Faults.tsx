import type { EventsInboxFault } from "@/client/utils/events-inbox-provider";

const FAULTS: Array<{ value: EventsInboxFault["type"] | ""; label: string }> = [
  { value: "", label: "200 (no fault)" },
  { value: "status-500", label: "500" },
  { value: "status-410", label: "410 Gone" },
  { value: "status-413", label: "413 Too large" },
  { value: "redirect-307", label: "307 redirect" },
  { value: "timeout", label: "Timeout" },
  { value: "slow-ack", label: "Slow ack" },
  { value: "pending-503", label: "503 while pending" },
  { value: "bad-challenge", label: "Bad challenge" },
  { value: "echo-body", label: "Echo whole body" },
];

/** Props of {@link Faults}. */
export interface FaultsProps {
  fault: EventsInboxFault | null;
  onChange: (fault: EventsInboxFault | null) => void;
}

/**
 * The inbox's webhook fault preset ("inbox responds").
 *
 * TODO(events): stream fault presets (drop after N frames, stall reading,
 * delay `active`) need the proxy side, which is not built yet.
 */
export function Faults({ fault, onChange }: FaultsProps) {
  return (
    <label className="flex items-center gap-2 text-xs">
      inbox responds
      <select
        aria-label="Inbox fault preset"
        className="rounded border border-border bg-background px-1 py-0.5"
        value={fault?.type ?? ""}
        onChange={(e) =>
          onChange(
            e.target.value
              ? { type: e.target.value as EventsInboxFault["type"] }
              : null
          )
        }
      >
        {FAULTS.map((f) => (
          <option key={f.value} value={f.value}>
            {f.label}
          </option>
        ))}
      </select>
    </label>
  );
}
