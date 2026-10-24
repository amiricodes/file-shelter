import { ObjectId } from "mongodb";
import { describe, expect, it } from "vitest";
import {
  buildCursorMatch,
  decodeCursor,
  encodeCursor,
  InvalidCursorError,
} from "../utils/paginationCursor.js";

function encodedPayload(payload) {
  return Buffer.from(JSON.stringify(payload)).toString("base64url");
}

describe("pagination cursor utility", () => {
  it("preserves the base64url format across an encode/decode round trip", () => {
    const item = {
      _id: new ObjectId("64b000000000000000000001"),
      updatedAt: new Date("2026-10-24T12:34:56.789Z"),
    };

    const encoded = encodeCursor(item);

    expect(encoded).toBe(
      encodedPayload({
        updatedAt: "2026-10-24T12:34:56.789Z",
        id: "64b000000000000000000001",
      }),
    );
    expect(decodeCursor(encoded)).toEqual({
      updatedAt: item.updatedAt,
      id: item._id,
    });
  });

  it.each([undefined, null, ""])(
    "treats an omitted cursor as empty",
    (value) => {
      expect(decodeCursor(value)).toBeNull();
    },
  );

  it("rejects malformed base64url", () => {
    expect(() => decodeCursor("not+a+base64url+cursor")).toThrow(
      InvalidCursorError,
    );
  });

  it("rejects malformed JSON", () => {
    expect(() => decodeCursor(Buffer.from("{").toString("base64url"))).toThrow(
      InvalidCursorError,
    );
  });

  it("rejects invalid timestamps", () => {
    expect(() =>
      decodeCursor(
        encodedPayload({
          updatedAt: "not-a-date",
          id: "64b000000000000000000001",
        }),
      ),
    ).toThrow(InvalidCursorError);
  });

  it("rejects invalid ObjectIds", () => {
    expect(() =>
      decodeCursor(
        encodedPayload({
          updatedAt: "2026-10-24T12:34:56.789Z",
          id: "not-an-object-id",
        }),
      ),
    ).toThrow(InvalidCursorError);
  });

  it("uses the ObjectId as the tiebreaker for equal timestamps", () => {
    const cursor = {
      updatedAt: new Date("2026-10-24T12:34:56.789Z"),
      id: new ObjectId("64b000000000000000000002"),
    };

    expect(buildCursorMatch(cursor)).toEqual({
      $or: [
        { updatedAt: { $lt: cursor.updatedAt } },
        { updatedAt: cursor.updatedAt, _id: { $lt: cursor.id } },
      ],
    });
  });
});
