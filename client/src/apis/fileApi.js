import { parseApiResponse } from "./apiResponse";

const BASE_URL = import.meta.env.VITE_BACKEND_BASE_URI;

/**
 * Delete a file
 */
export async function deleteFile(id) {
  const response = await fetch(`${BASE_URL}/file/${id}`, {
    method: "DELETE",
    credentials: "include",
  });

  return parseApiResponse(response);
}

/**
 * Rename a file
 */
export async function renameFile(id, newFilename) {
  const response = await fetch(`${BASE_URL}/file/${id}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ newFilename }),
    credentials: "include",
  });

  return parseApiResponse(response);
}

/**
 * Get signed url from s3
 */

export async function uploadInitiate(file) {
  const response = await fetch(`${BASE_URL}/file/upload/initiate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(file),
    credentials: "include",
  });

  return parseApiResponse(response);
}

export async function uploadComplete(fileId) {
  const response = await fetch(`${BASE_URL}/file/upload/complete`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ fileId }),
    credentials: "include",
  });

  return parseApiResponse(response);
}

export async function uploadCancel(fileId) {
  const response = await fetch(`${BASE_URL}/file/upload/cancel`, {
    method: "DELETE",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ fileId }),
    credentials: "include",
  });

  return parseApiResponse(response);
}
