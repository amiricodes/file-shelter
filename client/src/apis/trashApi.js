const BASE_URL = import.meta.env.VITE_BACKEND_BASE_URI;

const TRASH_ITEM_TYPES = {
  file: "file",
  directory: "directory",
};

async function handleFetchErrors(response, fallbackMessage) {
  if (!response.ok) {
    let errMsg =
      fallbackMessage || `Request failed with status ${response.status}`;
    try {
      const data = await response.json();
      if (data.error) errMsg = data.error;
    } catch {
      // Keep fallback error if response body is not JSON.
    }
    throw new Error(errMsg);
  }

  return response;
}

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

  await handleFetchErrors(response, "Failed to fetch trash items");
  return response.json();
}

export async function restoreTrashItem(type, id) {
  const endpoint = getEndpointByType(type);

  const response = await fetch(`${BASE_URL}/${endpoint}/${id}/restore`, {
    method: "PATCH",
    credentials: "include",
  });

  await handleFetchErrors(response, "Failed to restore item");
  return response.json();
}

export async function permanentlyDeleteTrashItem(type, id) {
  const endpoint = getEndpointByType(type);

  const response = await fetch(`${BASE_URL}/${endpoint}/${id}/permanent`, {
    method: "DELETE",
    credentials: "include",
  });

  await handleFetchErrors(response, "Failed to permanently delete item");
  return response.json();
}

export async function emptyTrash() {
  const response = await fetch(`${BASE_URL}/trash`, {
    method: "DELETE",
    credentials: "include",
  });

  await handleFetchErrors(response, "Failed to empty trash");
  return response.json();
}

export async function restoreFile(id) {
  return restoreTrashItem("file", id);
}

export async function permanentlyDeleteFile(id) {
  return permanentlyDeleteTrashItem("file", id);
}
