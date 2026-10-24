import { parseApiResponse } from "./apiResponse";

const BASE_URL = import.meta.env.VITE_BACKEND_BASE_URI;

const TRASH_ITEM_TYPES = {
  file: "file",
  directory: "directory",
};

function getEndpointByType(type) {
  if (!TRASH_ITEM_TYPES[type]) {
    throw new Error(`Unsupported trash item type: ${type}`);
  }

  return TRASH_ITEM_TYPES[type];
}

export async function getTrashItems() {
  const response = await fetch(`${BASE_URL}/trash`, {
    credentials: "include",
  });

  return parseApiResponse(response, "Failed to fetch trash items");
}

export async function restoreTrashItem(type, id) {
  const endpoint = getEndpointByType(type);

  const response = await fetch(`${BASE_URL}/${endpoint}/${id}/restore`, {
    method: "PATCH",
    credentials: "include",
  });

  return parseApiResponse(response, "Failed to restore item");
}

export async function permanentlyDeleteTrashItem(type, id) {
  const endpoint = getEndpointByType(type);

  const response = await fetch(`${BASE_URL}/${endpoint}/${id}/permanent`, {
    method: "DELETE",
    credentials: "include",
  });

  return parseApiResponse(response, "Failed to permanently delete item");
}

export async function emptyTrash() {
  const response = await fetch(`${BASE_URL}/trash`, {
    method: "DELETE",
    credentials: "include",
  });

  return parseApiResponse(response, "Failed to empty trash");
}

export async function restoreFile(id) {
  return restoreTrashItem("file", id);
}

export async function permanentlyDeleteFile(id) {
  return permanentlyDeleteTrashItem("file", id);
}
