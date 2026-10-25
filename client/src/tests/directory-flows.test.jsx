import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import DirectoryView from "../pages/DirectoryView";
import useFileUpload from "../hooks/useFileUpload";
import { UPLOAD_RECOVERY_KEY, UPLOAD_RECOVERY_MAX_AGE_MS } from "../hooks/uploadRecovery";

// Exercise the real page, API functions and upload UI. Only network boundaries
// are replaced; an S3 transfer and an API acknowledgement are separate events.
class UploadRequest extends EventTarget {
  static instances = [];
  upload = new EventTarget();
  status = 0;
  open = vi.fn();
  send = vi.fn();
  abort = vi.fn(() => this.dispatchEvent(new Event("abort")));
  constructor() {
    super();
    UploadRequest.instances.push(this);
  }
  finish(status = 200) {
    this.status = status;
    this.dispatchEvent(new Event("load"));
  }
}

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { "Content-Type": "application/json" },
});
let completeResponse;
let initiateResponse;
let cancelResponse;
let directoryResponse;
let completed;
let fetchMock;

beforeEach(() => {
  sessionStorage.clear();
  UploadRequest.instances = [];
  completed = false;
  completeResponse = () => { completed = true; return json({ message: "Upload Complete" }); };
  initiateResponse = () => json({ fileId: "file-1", uploadUrl: "https://s3.example.test/object" }, 201);
  cancelResponse = () => json({ cleanupPending: true });
  directoryResponse = () => json({ items: completed ? [{ id: "file-1", name: "report.txt", size: 5, isDirectory: false }] : [], nextCursor: null });
  fetchMock = vi.fn(async (url, options) => {
    const path = new URL(url).pathname;
    expect(options.credentials).toBe("include");
    if (path === "/user") return json({ name: "Reviewer", email: "reviewer@example.test", role: "user", usedStorage: completed ? 5 : 0, maxStorage: 100 });
    if (path.startsWith("/directory/")) return directoryResponse(url);
    if (path === "/file/upload/initiate") return initiateResponse();
    if (path === "/file/upload/complete") return completeResponse();
    if (path === "/file/upload/cancel") return cancelResponse();
    throw new Error(`Unexpected request: ${path}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("XMLHttpRequest", UploadRequest);
});

function renderDrive() {
  return render(
    <MemoryRouter initialEntries={["/app"]}>
      <Routes>
        <Route path="/app" element={<DirectoryView />} />
        <Route path="/login" element={<h1>Sign in</h1>} />
      </Routes>
    </MemoryRouter>,
  );
}

async function openDrive() {
  const user = userEvent.setup();
  renderDrive();
  await screen.findByText(/This folder is empty/);
  return user;
}

function storeRecovery(overrides = {}) {
  sessionStorage.setItem(UPLOAD_RECOVERY_KEY, JSON.stringify({
    version: 1,
    owner: "reviewer@example.test",
    fileId: "file-1",
    name: "report.txt",
    createdAt: Date.now(),
    ...overrides,
  }));
}

async function selectFile(user) {
  await user.upload(screen.getByLabelText("Choose file to upload"), new File(["hello"], "report.txt", { type: "text/plain" }));
  await waitFor(() => expect(UploadRequest.instances).toHaveLength(1));
  return UploadRequest.instances[0];
}

const requestsFor = (path) => fetchMock.mock.calls.filter(([url]) => new URL(url).pathname === path);

describe("drive critical flows", () => {
  it("refreshes the current folder callback if navigation occurs during a transfer", async () => {
    const previousFolder = vi.fn();
    const currentFolder = vi.fn();
    const { result, rerender } = renderHook(({ onSettled }) => useFileUpload({ accountId: "reviewer@example.test", onSettled, onUnauthorized: vi.fn() }), {
      initialProps: { onSettled: previousFolder },
    });
    let uploadPromise;
    act(() => { uploadPromise = result.current.start(new File(["hello"], "report.txt")); });
    await waitFor(() => expect(UploadRequest.instances).toHaveLength(1));
    rerender({ onSettled: currentFolder });
    await act(async () => { UploadRequest.instances[0].finish(); await uploadPromise; });
    expect(previousFolder).not.toHaveBeenCalled();
    expect(currentFolder).toHaveBeenCalledTimes(1);
  });

  it("recovers completion after reload without initiating or transferring again", async () => {
    storeRecovery();
    const user = await openDrive();
    expect(await screen.findByText(/Upload was interrupted/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Retry completion" }));

    await waitFor(() => expect(screen.queryByRole("region", { name: "Upload status" })).not.toBeInTheDocument());
    expect(requestsFor("/file/upload/initiate")).toHaveLength(0);
    expect(requestsFor("/file/upload/complete")[0][1].body).toBe(JSON.stringify({ fileId: "file-1" }));
    expect(UploadRequest.instances).toHaveLength(0);
    expect(sessionStorage.getItem(UPLOAD_RECOVERY_KEY)).toBeNull();
  });

  it("offers cancellation after a reload interrupts the transfer", async () => {
    const user = userEvent.setup();
    const firstView = renderDrive();
    await screen.findByText(/This folder is empty/);
    const xhr = await selectFile(user);

    const recovery = JSON.parse(sessionStorage.getItem(UPLOAD_RECOVERY_KEY));
    expect(recovery).toMatchObject({ owner: "reviewer@example.test", fileId: "file-1", name: "report.txt" });
    expect(recovery).not.toHaveProperty("uploadUrl");
    expect(recovery).not.toHaveProperty("file");

    firstView.unmount();
    expect(xhr.abort).toHaveBeenCalledTimes(1);
    renderDrive();
    await screen.findByText(/Upload was interrupted/);
    await user.click(screen.getByRole("button", { name: "Cancel upload" }));

    await waitFor(() => expect(screen.queryByRole("region", { name: "Upload status" })).not.toBeInTheDocument());
    expect(requestsFor("/file/upload/initiate")).toHaveLength(1);
    expect(UploadRequest.instances).toHaveLength(1);
    expect(requestsFor("/file/upload/cancel")[0][1].body).toBe(JSON.stringify({ fileId: "file-1" }));
    expect(sessionStorage.getItem(UPLOAD_RECOVERY_KEY)).toBeNull();
  });

  it.each([
    ["malformed", "{not-json"],
    ["stale", JSON.stringify({ version: 1, owner: "reviewer@example.test", fileId: "file-1", name: "report.txt", createdAt: Date.now() - UPLOAD_RECOVERY_MAX_AGE_MS })],
    ["another account", JSON.stringify({ version: 1, owner: "someone-else@example.test", fileId: "private-file", name: "private.txt", createdAt: Date.now() })],
  ])("discards %s recovery state safely", async (_label, value) => {
    sessionStorage.setItem(UPLOAD_RECOVERY_KEY, value);
    await openDrive();

    expect(screen.queryByRole("region", { name: "Upload status" })).not.toBeInTheDocument();
    expect(sessionStorage.getItem(UPLOAD_RECOVERY_KEY)).toBeNull();
    expect(requestsFor("/file/upload/complete")).toHaveLength(0);
    expect(requestsFor("/file/upload/cancel")).toHaveLength(0);
  });

  it("transfers bytes, confirms completion, then refreshes the file listing and storage", async () => {
    const xhr = await selectFile(await openDrive());
    expect(xhr.open).toHaveBeenCalledWith("PUT", "https://s3.example.test/object");
    expect(xhr.send.mock.calls[0][0]).toBeInstanceOf(File);
    expect(requestsFor("/file/upload/complete")).toHaveLength(0);
    act(() => xhr.upload.dispatchEvent(new ProgressEvent("progress", { lengthComputable: true, loaded: 3, total: 5 })));
    expect(screen.getByRole("progressbar")).toHaveAttribute("value", "60");
    act(() => xhr.finish(204));
    await waitFor(() => expect(screen.queryByRole("region", { name: "Upload status" })).not.toBeInTheDocument());
    await screen.findByText("report.txt");
    expect(requestsFor("/file/upload/complete")[0][1].body).toBe(JSON.stringify({ fileId: "file-1" }));
    expect(requestsFor("/directory/").length).toBeGreaterThan(1);
    expect(requestsFor("/user").length).toBeGreaterThan(2);
  });

  it("retries a failed completion with the same reservation and without another PUT", async () => {
    const user = await openDrive();
    completeResponse = () => json({ error: "S3 verification unavailable; retry completion" }, 503);
    const xhr = await selectFile(user);
    act(() => xhr.finish());
    expect(await screen.findByRole("alert")).toHaveTextContent("S3 verification unavailable");
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    completeResponse = () => { completed = true; return json({ message: "Upload Complete" }); };
    await user.click(screen.getByRole("button", { name: "Retry completion" }));
    await waitFor(() => expect(screen.queryByRole("region", { name: "Upload status" })).not.toBeInTheDocument());
    expect(requestsFor("/file/upload/initiate")).toHaveLength(1);
    expect(UploadRequest.instances).toHaveLength(1);
    expect(requestsFor("/file/upload/complete").map(([, options]) => JSON.parse(options.body))).toEqual([{ fileId: "file-1" }, { fileId: "file-1" }]);
    await screen.findByText("report.txt");
  });

  it("recovers when the server committed completion but its response was lost", async () => {
    const user = await openDrive();
    completeResponse = () => { completed = true; throw new TypeError("Failed to fetch"); };
    const xhr = await selectFile(user);
    act(() => xhr.finish());
    await screen.findByRole("button", { name: "Retry completion" });
    completeResponse = () => json({ message: "Upload Complete" });
    await user.click(screen.getByRole("button", { name: "Retry completion" }));
    await waitFor(() => expect(screen.queryByRole("region", { name: "Upload status" })).not.toBeInTheDocument());
    expect(requestsFor("/file/upload/initiate")).toHaveLength(1);
    await screen.findByText("report.txt");
  });

  it("retains completion retry when cancellation discovers an already-completed file", async () => {
    const user = await openDrive();
    completeResponse = () => { completed = true; throw new TypeError("Failed to fetch"); };
    const xhr = await selectFile(user);
    act(() => xhr.finish());
    await screen.findByRole("button", { name: "Retry completion" });
    cancelResponse = () => json({ error: "Completed uploads cannot be cancelled" }, 409);
    await user.click(screen.getByRole("button", { name: "Cancel upload" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Completed uploads cannot be cancelled");
    completeResponse = () => json({ message: "Upload Complete" });
    await user.click(screen.getByRole("button", { name: "Retry completion" }));
    await screen.findByText("report.txt");
    expect(requestsFor("/file/upload/initiate")).toHaveLength(1);
  });

  it("sends only one retry while completion acknowledgement is pending", async () => {
    const user = await openDrive();
    completeResponse = () => json({ error: "Retry completion" }, 503);
    const xhr = await selectFile(user);
    act(() => xhr.finish());
    const retry = await screen.findByRole("button", { name: "Retry completion" });
    let acknowledge;
    completeResponse = () => new Promise((resolve) => { acknowledge = resolve; });
    fireEvent.click(retry);
    fireEvent.click(retry);
    expect(requestsFor("/file/upload/complete")).toHaveLength(2);
    expect(screen.queryByRole("button", { name: "Cancel upload" })).not.toBeInTheDocument();
    await act(async () => acknowledge(json({ message: "Upload Complete" })));
  });

  it.each(["error", "timeout", 403])("surfaces transfer failure (%s) and cancels the reserved file", async (failure) => {
    const user = await openDrive();
    const xhr = await selectFile(user);
    act(() => typeof failure === "number" ? xhr.finish(failure) : xhr.dispatchEvent(new Event(failure)));
    await screen.findByRole("alert");
    expect(requestsFor("/file/upload/complete")).toHaveLength(0);
    await user.click(screen.getByRole("button", { name: "Cancel upload" }));
    await waitFor(() => expect(screen.queryByRole("region", { name: "Upload status" })).not.toBeInTheDocument());
    expect(requestsFor("/file/upload/cancel")[0][1]).toMatchObject({ method: "DELETE", body: JSON.stringify({ fileId: "file-1" }) });
  });

  it("aborts a transfer and waits for cancellation acknowledgement before clearing the attempt", async () => {
    const user = await openDrive();
    const xhr = await selectFile(user);
    let acknowledge;
    cancelResponse = () => new Promise((resolve) => { acknowledge = resolve; });
    await user.click(screen.getByRole("button", { name: "Cancel upload" }));
    expect(xhr.abort).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Cancelling upload…")).toBeInTheDocument();
    expect(requestsFor("/file/upload/complete")).toHaveLength(0);
    await act(async () => acknowledge(json({ cleanupPending: true })));
    expect(screen.queryByRole("region", { name: "Upload status" })).not.toBeInTheDocument();
  });

  it("keeps a failed cancellation visible and allows cancellation to be retried", async () => {
    const user = await openDrive();
    await selectFile(user);
    cancelResponse = () => json({ error: "Please retry cancellation" }, 503);
    await user.click(screen.getByRole("button", { name: "Cancel upload" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Please retry cancellation");
    cancelResponse = () => json({ cleanupPending: true });
    await user.click(screen.getByRole("button", { name: "Cancel upload" }));
    await waitFor(() => expect(screen.queryByRole("region", { name: "Upload status" })).not.toBeInTheDocument());
    expect(requestsFor("/file/upload/cancel")).toHaveLength(2);
  });

  it("rejects quota admission before sending bytes and permits a fresh attempt after dismissal", async () => {
    const user = await openDrive();
    initiateResponse = () => json({ error: "Storage quota exceeded (including pending uploads)" }, 429);
    await user.upload(screen.getByLabelText("Choose file to upload"), new File(["hello"], "report.txt"));
    expect(await screen.findByRole("alert")).toHaveTextContent("Storage quota exceeded");
    expect(UploadRequest.instances).toHaveLength(0);
    await user.click(screen.getByRole("button", { name: "Dismiss" }));
    initiateResponse = () => json({ fileId: "file-1", uploadUrl: "https://s3.example.test/object" }, 201);
    await selectFile(user);
  });

  it("blocks duplicate selection while initiation is awaiting the server", async () => {
    const user = await openDrive();
    let respond;
    initiateResponse = () => new Promise((resolve) => { respond = resolve; });
    const input = screen.getByLabelText("Choose file to upload");
    const file = new File(["hello"], "report.txt");
    fireEvent.change(input, { target: { files: [file] } });
    fireEvent.change(input, { target: { files: [file] } });
    expect(requestsFor("/file/upload/initiate")).toHaveLength(1);
    await act(async () => respond(json({ fileId: "file-1", uploadUrl: "https://s3.example.test/object" }, 201)));
    expect(UploadRequest.instances).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: "Cancel upload" }));
  });

  it.each([400, 404, 410])("does not offer completion retry after terminal HTTP %s", async (status) => {
    completeResponse = () => json({ error: "Upload is no longer valid" }, status);
    const xhr = await selectFile(await openDrive());
    act(() => xhr.finish());
    await screen.findByRole("button", { name: "Dismiss" });
    expect(screen.queryByRole("button", { name: "Retry completion" })).not.toBeInTheDocument();
    expect(sessionStorage.getItem(UPLOAD_RECOVERY_KEY)).toBeNull();
  });

  it("redirects an expired upload session to login", async () => {
    initiateResponse = () => json({ error: "Not logged!" }, 401);
    const user = await openDrive();
    await user.upload(screen.getByLabelText("Choose file to upload"), new File(["hello"], "report.txt"));
    await screen.findByRole("heading", { name: "Sign in" });
    expect(UploadRequest.instances).toHaveLength(0);
  });

  it("redirects an expired directory session to login", async () => {
    directoryResponse = () => json({ error: "Not logged!" }, 401);
    render(<MemoryRouter initialEntries={["/app"]}><Routes><Route path="/app" element={<DirectoryView />} /><Route path="/login" element={<h1>Sign in</h1>} /></Routes></MemoryRouter>);
    await screen.findByRole("heading", { name: "Sign in" });
  });

  it("appends a cursor page without dropping the first page", async () => {
    directoryResponse = (url) => json({
      items: [{ id: new URL(url).searchParams.has("cursor") ? "second" : "first", name: new URL(url).searchParams.has("cursor") ? "second.txt" : "first.txt", isDirectory: false }],
      nextCursor: new URL(url).searchParams.has("cursor") ? null : "opaque-cursor",
    });
    const user = userEvent.setup();
    render(<MemoryRouter><DirectoryView /></MemoryRouter>);
    await screen.findByText("first.txt");
    await user.click(screen.getByRole("button", { name: "Load more" }));
    await screen.findByText("second.txt");
    expect(screen.getByText("first.txt")).toBeInTheDocument();
    expect(new URL(requestsFor("/directory/")[1][0]).searchParams.get("cursor")).toBe("opaque-cursor");
    expect(screen.queryByRole("button", { name: "Load more" })).not.toBeInTheDocument();
  });
});
