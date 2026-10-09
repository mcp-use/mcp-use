// @vitest-environment happy-dom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { HostFileHandle } from "mcp-use/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NoteEditor } from "../views/note-file/editor.js";

const mock = vi.hoisted(() => ({ file: {} as HostFileHandle }));
vi.mock("mcp-use/react", () => ({ useHostFile: () => mock.file }));

function snapshot(text = "Initial text", etag = "base-v1") {
  return { uri: "host-resource://demo", text, writable: true, etag };
}

beforeEach(() => {
  mock.file = {
    status: "ready",
    file: { name: "demo.md", resourceUri: "host-resource://demo" },
    data: snapshot(),
    canWrite: true,
    isRefreshing: false,
    isSubscribed: true,
    refresh: vi.fn(async () => {
      if (!mock.file.data) throw new Error("No mock data");
      return mock.file.data;
    }),
    write: vi.fn(async () => ({ outcome: "saved" as const, etag: "saved-v2" })),
  };
});
afterEach(cleanup);

describe("Note editor with a mocked host-file hook (not native desktop E2E)", () => {
  it("saves with the draft's explicit base ETag and adopts the saved token", async () => {
    render(<NoteEditor />);
    const textarea = await screen.findByLabelText("Markdown text");
    fireEvent.change(textarea, { target: { value: "Edited" } });
    fireEvent.click(screen.getByRole("button", { name: "Save", exact: true }));
    await screen.findByText("Saved.");
    expect(mock.file.write).toHaveBeenCalledWith(
      { text: "Edited" },
      { ifMatch: "base-v1" }
    );
    fireEvent.change(textarea, { target: { value: "Next edit" } });
    fireEvent.click(screen.getByRole("button", { name: "Save", exact: true }));
    await waitFor(() =>
      expect(mock.file.write).toHaveBeenLastCalledWith(
        { text: "Next edit" },
        { ifMatch: "saved-v2" }
      )
    );
  });

  it("retains the local draft and original ETag across an external update and conflict", async () => {
    const view = render(<NoteEditor />);
    const textarea = (await screen.findByLabelText(
      "Markdown text"
    )) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "Local draft" } });
    mock.file.data = snapshot("External edit", "external-v2");
    mock.file.write = vi.fn(async () => ({
      outcome: "conflict",
      etag: "external-v2",
    }));
    view.rerender(<NoteEditor />);
    expect(textarea.value).toBe("Local draft");
    fireEvent.click(screen.getByRole("button", { name: "Save", exact: true }));
    await screen.findByText(/Conflict: the file changed/);
    expect(mock.file.write).toHaveBeenCalledWith(
      { text: "Local draft" },
      { ifMatch: "base-v1" }
    );
    expect(textarea.value).toBe("Local draft");
    expect(
      (
        screen.getByRole("button", {
          name: "Save",
          exact: true,
        }) as HTMLButtonElement
      ).disabled
    ).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Check latest" }));
    await screen.findByText(/Checked the latest file/);
    expect(textarea.value).toBe("Local draft");
    fireEvent.click(
      screen.getByRole("button", { name: "Reload and discard draft" })
    );
    await screen.findByText(/Reloaded the current file/);
    expect(textarea.value).toBe("External edit");
    fireEvent.change(textarea, { target: { value: "Reviewed edit" } });
    mock.file.write = vi.fn(async () => ({
      outcome: "saved",
      etag: "saved-v3",
    }));
    fireEvent.click(screen.getByRole("button", { name: "Save", exact: true }));
    await waitFor(() =>
      expect(mock.file.write).toHaveBeenLastCalledWith(
        { text: "Reviewed edit" },
        { ifMatch: "external-v2" }
      )
    );
  });

  it("keeps the draft after too-large and failed refresh outcomes", async () => {
    mock.file.write = vi.fn(async () => ({
      outcome: "too-large",
      maxBytes: 16,
    }));
    render(<NoteEditor />);
    const textarea = (await screen.findByLabelText(
      "Markdown text"
    )) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "Keep this local draft" } });
    fireEvent.click(screen.getByRole("button", { name: "Save", exact: true }));
    await screen.findByText(/host limit is 16 bytes/);
    expect(textarea.value).toBe("Keep this local draft");
    mock.file.refresh = vi.fn(async () => {
      throw new Error("Read failed");
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Reload and discard draft" })
    );
    await screen.findByText("Read failed");
    expect(textarea.value).toBe("Keep this local draft");
  });

  it.each(["permission", "etag"])(
    "disables editing and saving without %s",
    async (missing) => {
      mock.file.canWrite = false;
      mock.file.data =
        missing === "permission"
          ? { ...snapshot(), writable: false }
          : {
              uri: "host-resource://demo",
              text: "Initial text",
              writable: true,
            };
      render(<NoteEditor />);
      const textarea = (await screen.findByLabelText(
        "Markdown text"
      )) as HTMLTextAreaElement;
      expect(textarea.readOnly).toBe(true);
      expect(
        (
          screen.getByRole("button", {
            name: "Save",
            exact: true,
          }) as HTMLButtonElement
        ).disabled
      ).toBe(true);
      expect(mock.file.write).not.toHaveBeenCalled();
    }
  );

  it("shows unsupported and binary-host states clearly", () => {
    mock.file.status = "unsupported";
    delete mock.file.data;
    const view = render(<NoteEditor />);
    expect(screen.getByText(/Host file editing is unavailable/)).toBeDefined();
    mock.file.status = "ready";
    mock.file.data = {
      uri: "host-resource://demo",
      blob: "YWJj",
      writable: false,
    };
    view.rerender(<NoteEditor />);
    expect(screen.getByRole("alert").textContent).toContain("binary contents");
    expect(screen.queryByRole("textbox")).toBeNull();
  });
});
