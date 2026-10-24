import { parseApiResponse } from "./apiResponse";

const BASE_URL = import.meta.env.VITE_BACKEND_BASE_URI;

/**
 * Get or create the share link for a file/directory.
 */
export async function createShare(resourceType, resourceId) {
  const response = await fetch(`${BASE_URL}/share`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ resourceType, resourceId }),
    credentials: "include",
  });

  const data = await parseApiResponse(response);

  return data.share;
}

/**
 * Update share settings (accessType, allowedEmails, expiresAt).
 */
export async function updateShare(shareId, settings) {
  const response = await fetch(`${BASE_URL}/share/${shareId}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(settings),
    credentials: "include",
  });

  const data = await parseApiResponse(response);

  return data.share;
}

/**
 * Revoke a share link.
 */
export async function revokeShare(shareId) {
  const response = await fetch(`${BASE_URL}/share/${shareId}`, {
    method: "DELETE",
    credentials: "include",
  });

  return parseApiResponse(response);
}

/**
 * Public: fetch shared item metadata / folder listing. No auth required —
 * cookies ride along automatically so restricted links can recognize the visitor.
 */
export async function getSharedItem(token, { dir, cursor, limit } = {}) {
  const params = new URLSearchParams();
  if (dir) params.set("dir", dir);
  if (cursor) params.set("cursor", cursor);
  if (limit) params.set("limit", String(limit));

  const queryString = params.toString();
  const response = await fetch(
    `${BASE_URL}/public/share/${token}${queryString ? `?${queryString}` : ""}`,
    { credentials: "include" },
  );

  return parseApiResponse(response);
}
