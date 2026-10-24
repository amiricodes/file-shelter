import { parseApiResponse } from "./apiResponse";

const BASE_URL = import.meta.env.VITE_BACKEND_BASE_URI;

/**
 * Fetch directory contents and items
 */
export async function getDirectoryItems(
  dirId,
  { cursor, limit = 100, signal } = {},
) {
  const params = new URLSearchParams({ limit: String(limit) });
  if (cursor) params.set("cursor", cursor);

  const response = await fetch(`${BASE_URL}/directory/${dirId || ""}?${params}`, {
    credentials: "include",
    signal,
  });

  return parseApiResponse(response);
}

/**
 * Create a new directory
 */
export async function createDirectory(dirId, dirName) {
  const response = await fetch(`${BASE_URL}/directory/${dirId || ""}`, {
    method: "POST",
    headers: {
      dirname: dirName,
    },
    credentials: "include",
  });

  return parseApiResponse(response);
}

/**
 * Rename a directory
 */
export async function renameDirectory(id, newDirName) {
  const response = await fetch(`${BASE_URL}/directory/${id}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ newDirName }),
    credentials: "include",
  });

  return parseApiResponse(response);
}

/**
 * Delete a directory
 */
export async function deleteDirectory(id) {
  const response = await fetch(`${BASE_URL}/directory/${id}`, {
    method: "DELETE",
    credentials: "include",
  });

  return parseApiResponse(response);
}
