const BASE_URL = import.meta.env.VITE_BACKEND_BASE_URI;

/**
 * Utility: handle fetch errors
 */
async function handleFetchErrors(response) {
  if (!response.ok) {
    let errMsg = `Request failed with status ${response.status}`;
    try {
      const data = await response.json();
      if (data.error) errMsg = data.error;
    } catch {
      // If JSON parsing fails, default errMsg stays
    }
    throw new Error(errMsg);
  }
  return response;
}

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

  if (response.status === 401) {
    throw new Error("Unauthorized");
  }

  await handleFetchErrors(response);
  const data = await response.json();

  return data;
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

  await handleFetchErrors(response);
  const data = await response.json();

  return data;
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

  await handleFetchErrors(response);
  const data = await response.json();

  return data;
}

/**
 * Delete a directory
 */
export async function deleteDirectory(id) {
  const response = await fetch(`${BASE_URL}/directory/${id}`, {
    method: "DELETE",
    credentials: "include",
  });

  await handleFetchErrors(response);
  const data = await response.json();

  return data;
}
