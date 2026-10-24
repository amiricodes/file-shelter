import { Types } from "mongoose";
import { describe, expect, it } from "vitest";
import {
  createDirectorySchema,
  directoryListingQuerySchema,
  MAX_DIRECTORY_PAGE_SIZE,
} from "../validators/directoryValidators.js";
import {
  MAX_ITEM_NAME_LENGTH,
  renameFileSchema,
  uploadCompleteSchema,
  uploadInitiateSchema,
} from "../validators/fileValidators.js";

function cursor(payload) {
  return Buffer.from(JSON.stringify(payload)).toString("base64url");
}

describe("file request schemas", () => {
  it("normalizes valid input at supported boundaries", () => {
    expect(
      uploadInitiateSchema.parse({
        name: ` ${"x".repeat(MAX_ITEM_NAME_LENGTH)} `,
        size: "0",
        contentType: "",
      }),
    ).toEqual({
      name: "x".repeat(MAX_ITEM_NAME_LENGTH),
      size: 0,
    });
  });

  it.each([
    { name: "", size: 0 },
    { name: "x".repeat(MAX_ITEM_NAME_LENGTH + 1), size: 0 },
    { name: "file", size: -1 },
    { name: "file", size: 1.5 },
    { name: "file", size: "1e3" },
    { name: "file", size: "0x10" },
    { name: "file", size: Number.MAX_SAFE_INTEGER + 1 },
    { name: "file", size: 1, unknown: true },
  ])("rejects invalid upload input %#", (input) => {
    expect(uploadInitiateSchema.safeParse(input).success).toBe(false);
  });

  it("requires exact object IDs and strict rename objects", () => {
    expect(
      uploadCompleteSchema.safeParse({
        fileId: new Types.ObjectId().toString(),
      }).success,
    ).toBe(true);
    expect(uploadCompleteSchema.safeParse({ fileId: "invalid" }).success).toBe(
      false,
    );
    expect(
      renameFileSchema.safeParse({ newFilename: "valid", extra: true }).success,
    ).toBe(false);
  });
});

describe("directory listing query schema", () => {
  it("defaults a missing directory name and rejects unknown creation fields", () => {
    expect(createDirectorySchema.parse({})).toEqual({ dirname: "New Folder" });
    expect(createDirectorySchema.safeParse({ unexpected: true }).success).toBe(
      false,
    );
  });

  it.each([1, MAX_DIRECTORY_PAGE_SIZE])(
    "accepts the page-size boundary %i",
    (limit) => {
      expect(
        directoryListingQuerySchema.parse({ limit: String(limit) }).limit,
      ).toBe(limit);
    },
  );

  it.each(["0", String(MAX_DIRECTORY_PAGE_SIZE + 1), "1.5", "abc"])(
    "rejects invalid page size %s",
    (limit) => {
      expect(directoryListingQuerySchema.safeParse({ limit }).success).toBe(
        false,
      );
    },
  );

  it("decodes a valid cursor and rejects malformed cursor shapes", () => {
    const id = new Types.ObjectId().toString();
    const updatedAt = "2026-10-24T12:34:56.789Z";
    const parsedCursor = directoryListingQuerySchema.parse({
      cursor: cursor({ updatedAt, id }),
    }).cursor;
    expect(parsedCursor.updatedAt).toEqual(new Date(updatedAt));
    expect(parsedCursor.id.toString()).toBe(id);

    for (const value of [
      "not+a+cursor",
      cursor({ updatedAt: "not-a-date", id }),
      cursor({ updatedAt, id: "invalid" }),
      cursor({ updatedAt, id, extra: true }),
    ]) {
      expect(
        directoryListingQuerySchema.safeParse({ cursor: value }).success,
      ).toBe(false);
    }
  });
});
