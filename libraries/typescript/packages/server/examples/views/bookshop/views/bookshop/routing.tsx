import { useEffect, useRef, type ReactNode } from "react";
import { useDeepLink } from "mcp-use/react";
import { MemoryRouter, useLocation, useNavigate } from "react-router";
import { appPath } from "./route.js";

/** Keep app navigation in memory; the initial host link wins over the tool route. */
export function BookshopRouter({
  initialRoute,
  children,
}: {
  /** Fallback route supplied by the opening tool. */
  initialRoute: string;
  /** The Bookshop screens, kept mounted across data refreshes. */
  children: ReactNode;
}) {
  const { url: hostUrl } = useDeepLink();
  return (
    <MemoryRouter initialEntries={[appPath(hostUrl ?? initialRoute)]}>
      <IncomingLink hostUrl={hostUrl} />
      {children}
    </MemoryRouter>
  );
}

function IncomingLink({ hostUrl }: { hostUrl: string | undefined }) {
  const navigate = useNavigate();
  const previousHostUrl = useRef(hostUrl);
  useEffect(() => {
    // Local navigation can change navigate's identity. Do not reapply an old link.
    if (hostUrl === previousHostUrl.current) return;
    previousHostUrl.current = hostUrl;
    if (hostUrl !== undefined) navigate(appPath(hostUrl), { replace: true });
  }, [hostUrl, navigate]);
  return null;
}

/** Recover from unknown routes or catalog IDs without losing the current query. */
export function MissingPage({
  title = "Page not found",
}: {
  /** Heading describing the missing route or book. */
  title?: string;
}) {
  const navigate = useNavigate();
  const { search } = useLocation();
  return (
    <>
      <div className="page-heading">
        <h1>{title}</h1>
      </div>
      <section className="empty">
        <h2>That page isn’t on the shelf</h2>
        <p>Browse the library to find your next story.</p>
        <button onClick={() => navigate({ pathname: "/books", search })}>
          Browse books
        </button>
      </section>
    </>
  );
}
