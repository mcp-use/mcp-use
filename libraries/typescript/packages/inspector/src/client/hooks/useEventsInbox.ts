import { useCallback, useEffect, useRef, useState } from "react";
import type {
  EventsInbox,
  EventsInboxDelivery,
  EventsInboxFault,
  EventsInboxProfile,
  EventsInboxProvider,
} from "@/client/utils/events-inbox-provider";

/** State and actions of {@link useEventsInbox}. */
export interface UseEventsInboxResult {
  /** The inbox, once created. */
  inbox: EventsInbox | null;
  /** Deliveries received so far, oldest first. */
  deliveries: EventsInboxDelivery[];
  /** Last error from the provider. */
  error: string | null;
  /** Creates the inbox if there is none yet and returns it. */
  ensure: () => Promise<EventsInbox>;
  /** Sets or clears the fault preset. */
  setFault: (fault: EventsInboxFault | null) => Promise<void>;
  /** Sets the profile deliveries are checked against. */
  setProfile: (profile: EventsInboxProfile) => Promise<void>;
  /** Rotates the secret. */
  rotateSecret: () => Promise<void>;
  /** Empties the local delivery list. */
  clear: () => void;
}

/**
 * Owns one webhook inbox for the tab session and streams its deliveries.
 * A reconnecting stream resumes after the last seq seen, so nothing is lost
 * when the server answering the stream changes.
 *
 * @param provider - The inbox backend.
 * @param profile - Initial client profile.
 */
export function useEventsInbox(
  provider: EventsInboxProvider,
  profile: EventsInboxProfile
): UseEventsInboxResult {
  const [inbox, setInbox] = useState<EventsInbox | null>(null);
  const [deliveries, setDeliveries] = useState<EventsInboxDelivery[]>([]);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef<Promise<EventsInbox> | null>(null);
  const lastSeq = useRef<number | null>(null);

  const ensure = useCallback(async () => {
    if (inbox) return inbox;
    pending.current ??= provider.create(profile).then((created) => {
      setInbox(created);
      return created;
    });
    try {
      return await pending.current;
    } catch (e) {
      pending.current = null;
      setError((e as Error).message);
      throw e;
    }
  }, [inbox, provider, profile]);

  useEffect(() => {
    if (!inbox) return;
    return provider.subscribe(
      inbox,
      lastSeq.current,
      (delivery) => {
        if (lastSeq.current !== null && delivery.seq <= lastSeq.current) return;
        lastSeq.current = delivery.seq;
        setDeliveries((list) => [...list.slice(-499), delivery]);
      },
      (e) => setError(e.message)
    );
  }, [inbox, provider]);

  useEffect(
    () => () => {
      if (inbox) void provider.remove(inbox).catch(() => undefined);
    },
    [inbox, provider]
  );

  const patch = useCallback(
    async (p: Parameters<EventsInboxProvider["update"]>[1]) => {
      const current = await ensure();
      try {
        const updated = await provider.update(current, p);
        setInbox({ ...current, ...updated });
      } catch (e) {
        setError((e as Error).message);
      }
    },
    [ensure, provider]
  );

  return {
    inbox,
    deliveries,
    error,
    ensure,
    setFault: (fault) => patch({ fault }),
    setProfile: (p) => patch({ profile: p }),
    rotateSecret: () => patch({ rotateSecret: true }),
    clear: () => setDeliveries([]),
  };
}
