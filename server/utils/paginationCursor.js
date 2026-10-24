import { ObjectId } from "mongodb";

const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;
const OBJECT_ID_PATTERN = /^[a-f\d]{24}$/i;

export class InvalidCursorError extends Error {
  constructor() {
    super("Invalid pagination cursor.");
    this.name = "InvalidCursorError";
    this.status = 400;
  }
}

export function encodeCursor(item) {
  if (!item?.updatedAt || !item?._id) return null;

  return Buffer.from(
    JSON.stringify({
      updatedAt: item.updatedAt.toISOString(),
      id: String(item._id),
    }),
  ).toString("base64url");
}

export function decodeCursor(value) {
  if (value === undefined || value === null || value === "") return null;

  try {
    if (typeof value !== "string" || !BASE64URL_PATTERN.test(value)) {
      throw new InvalidCursorError();
    }

    const decoded = Buffer.from(value, "base64url").toString("utf8");
    if (Buffer.from(decoded, "utf8").toString("base64url") !== value) {
      throw new InvalidCursorError();
    }

    const payload = JSON.parse(decoded);
    if (
      typeof payload?.updatedAt !== "string" ||
      typeof payload?.id !== "string" ||
      !OBJECT_ID_PATTERN.test(payload.id) ||
      !ObjectId.isValid(payload.id)
    ) {
      throw new InvalidCursorError();
    }

    const updatedAt = new Date(payload.updatedAt);
    if (
      Number.isNaN(updatedAt.getTime()) ||
      updatedAt.toISOString() !== payload.updatedAt
    ) {
      throw new InvalidCursorError();
    }

    return { updatedAt, id: new ObjectId(payload.id) };
  } catch (error) {
    if (error instanceof InvalidCursorError) throw error;
    throw new InvalidCursorError();
  }
}

export function buildCursorMatch(cursor) {
  if (!cursor) return {};

  return {
    $or: [
      { updatedAt: { $lt: cursor.updatedAt } },
      { updatedAt: cursor.updatedAt, _id: { $lt: cursor.id } },
    ],
  };
}
