/**
 * Unit tests for ResourceTemplatePanel
 *
 * Verifies template variable parsing, URI construction, CompletionInput
 * rendering per variable, live URI preview, and read button behaviour.
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ResourceTemplatePanel } from "../../src/client/components/resources/ResourceTemplatePanel";
import type { ResourceTemplate } from "@modelcontextprotocol/sdk/types.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeTemplate(
  uriTemplate: string,
  name = "test-template"
): ResourceTemplate {
  return {
    uriTemplate,
    name,
    description: `Template for ${name}`,
    mimeType: undefined,
  } as ResourceTemplate;
}

const noSuggestions = async () => [];

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("ResourceTemplatePanel", () => {
  const onRead = vi.fn();
  const onFetchSuggestions = vi.fn().mockResolvedValue([]);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders template name and description", () => {
    const template = makeTemplate("file:///{path}", "file-reader");
    render(
      <ResourceTemplatePanel
        template={template}
        isConnected={true}
        onRead={onRead}
        onFetchSuggestions={noSuggestions}
      />
    );

    expect(screen.getByText("file-reader")).toBeInTheDocument();
    expect(
      screen.getByText(/Template for file-reader/i)
    ).toBeInTheDocument();
  });

  it("renders one input per template variable", () => {
    const template = makeTemplate("file:///{path}/to/{name}");
    render(
      <ResourceTemplatePanel
        template={template}
        isConnected={true}
        onRead={onRead}
        onFetchSuggestions={noSuggestions}
      />
    );

    expect(screen.getByTestId("template-var-path")).toBeInTheDocument();
    expect(screen.getByTestId("template-var-name")).toBeInTheDocument();
  });

  it("shows no-variables message when template has no {vars}", () => {
    const template = makeTemplate("file:///static/resource");
    render(
      <ResourceTemplatePanel
        template={template}
        isConnected={true}
        onRead={onRead}
        onFetchSuggestions={noSuggestions}
      />
    );

    expect(screen.getByText(/no variables/i)).toBeInTheDocument();
  });

  it("shows live URI preview that updates as user types", async () => {
    const template = makeTemplate("file:///{path}");
    render(
      <ResourceTemplatePanel
        template={template}
        isConnected={true}
        onRead={onRead}
        onFetchSuggestions={noSuggestions}
      />
    );

    const input = screen.getByTestId("template-var-path");
    fireEvent.change(input, { target: { value: "/home/user" } });

    await waitFor(() => {
      expect(screen.getByTestId("template-uri-preview")).toHaveTextContent(
        "file:////home/user"
      );
    });
  });

  it("calls onRead with the substituted URI when Read button clicked", async () => {
    const template = makeTemplate("file:///{path}");
    render(
      <ResourceTemplatePanel
        template={template}
        isConnected={true}
        onRead={onRead}
        onFetchSuggestions={noSuggestions}
      />
    );

    fireEvent.change(screen.getByTestId("template-var-path"), {
      target: { value: "/home/user/file.txt" },
    });

    fireEvent.click(
      screen.getByTestId("resource-template-read-button")
    );

    expect(onRead).toHaveBeenCalledWith("file:////home/user/file.txt");
  });

  it("disables Read button when not connected", () => {
    const template = makeTemplate("file:///{path}");
    render(
      <ResourceTemplatePanel
        template={template}
        isConnected={false}
        onRead={onRead}
        onFetchSuggestions={noSuggestions}
      />
    );

    expect(screen.getByTestId("resource-template-read-button")).toBeDisabled();
  });

  it("passes the correct templateUri and varName to onFetchSuggestions", async () => {
    const fetchSuggestions = vi.fn().mockResolvedValue(["/home", "/tmp"]);
    const template = makeTemplate("file:///{path}");
    render(
      <ResourceTemplatePanel
        template={template}
        isConnected={true}
        onRead={onRead}
        onFetchSuggestions={fetchSuggestions}
      />
    );

    const input = screen.getByTestId("template-var-path");
    fireEvent.change(input, { target: { value: "/ho" } });

    await waitFor(() => {
      expect(fetchSuggestions).toHaveBeenCalledWith(
        "file:///{path}",
        "path",
        "/ho"
      );
    });
  });

  it("handles RFC 6570 operator prefixes like {+var}", () => {
    const template = makeTemplate("file:///{+path}");
    render(
      <ResourceTemplatePanel
        template={template}
        isConnected={true}
        onRead={onRead}
        onFetchSuggestions={noSuggestions}
      />
    );

    // The variable should still be named "path"
    expect(screen.getByTestId("template-var-path")).toBeInTheDocument();
  });

  it("deduplicates repeated variables in the template", () => {
    const template = makeTemplate("https://api/{version}/items/{version}");
    render(
      <ResourceTemplatePanel
        template={template}
        isConnected={true}
        onRead={onRead}
        onFetchSuggestions={noSuggestions}
      />
    );

    // Should only have ONE input for {version}
    const inputs = screen.getAllByTestId("template-var-version");
    expect(inputs).toHaveLength(1);
  });
});
