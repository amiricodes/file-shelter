function findMessage(value) {
  if (typeof value === "string" && value.trim()) return value;

  if (Array.isArray(value)) {
    for (const item of value) {
      const message = findMessage(item);
      if (message) return message;
    }
  }

  if (value && typeof value === "object") {
    for (const item of Object.values(value)) {
      const message = findMessage(item);
      if (message) return message;
    }
  }

  return "";
}

export function getErrorMessage(payload, fallback) {
  return (
    findMessage(payload?.error) ||
    findMessage(payload?.message) ||
    fallback
  );
}

export async function parseApiResponse(response, fallback) {
  const rawBody = await response.text();
  let payload = null;

  if (rawBody) {
    try {
      payload = JSON.parse(rawBody);
    } catch {
      // Proxies and static hosts can return HTML error pages. Do not expose
      // parser errors to users in place of a useful application message.
    }
  }

  if (!response.ok) {
    const message =
      response.status === 401
        ? "Unauthorized"
        : getErrorMessage(
            payload,
            fallback ?? `Request failed with status ${response.status}`,
          );
    const error = new Error(message);
    error.status = response.status;

    if (payload?.code !== undefined) {
      error.code = payload.code;
    }

    throw error;
  }

  return payload;
}
