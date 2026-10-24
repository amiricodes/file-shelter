import { describe, expect, it, vi } from "vitest";
import { parseApiResponse } from "../apis/apiResponse";

const jsonResponse = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

describe("parseApiResponse", () => {
  it("extracts a message from nested validation errors", async () => {
    const response = jsonResponse(
      { error: { email: ["Invalid email address"] } },
      400,
    );

    await expect(parseApiResponse(response, "Validation failed")).rejects.toMatchObject({
      message: "Invalid email address",
      status: 400,
    });
  });

  it("uses the fallback for non-JSON proxy errors", async () => {
    const response = new Response("<html>Bad gateway</html>", {
      status: 502,
      headers: { "Content-Type": "text/html" },
    });

    await expect(parseApiResponse(response, "Service unavailable")).rejects.toMatchObject({
      message: "Service unavailable",
      status: 502,
    });
  });

  it("preserves unauthorized-session behavior and the HTTP status", async () => {
    const response = jsonResponse({ error: "Not logged!" }, 401);

    await expect(parseApiResponse(response)).rejects.toMatchObject({
      message: "Unauthorized",
      status: 401,
    });
  });

  it("retains application error codes", async () => {
    const response = jsonResponse(
      {
        error: "UPI subscriptions cannot be upgraded",
        code: "UPI_UPGRADE_NOT_SUPPORTED",
      },
      409,
    );

    await expect(parseApiResponse(response)).rejects.toMatchObject({
      message: "UPI subscriptions cannot be upgraded",
      status: 409,
      code: "UPI_UPGRADE_NOT_SUPPORTED",
    });
  });

  it("returns successful JSON responses", async () => {
    const payload = { items: [{ id: "file-1" }] };

    await expect(parseApiResponse(jsonResponse(payload))).resolves.toEqual(payload);
  });

  it("returns null for successful empty responses", async () => {
    const response = new Response(null, { status: 204 });

    await expect(parseApiResponse(response)).resolves.toBeNull();
  });

  it("reads the response body exactly once", async () => {
    const response = {
      ok: false,
      status: 500,
      text: vi.fn().mockResolvedValue('{"error":"Server error"}'),
    };

    await expect(parseApiResponse(response)).rejects.toMatchObject({
      message: "Server error",
      status: 500,
    });
    expect(response.text).toHaveBeenCalledOnce();
  });
});
