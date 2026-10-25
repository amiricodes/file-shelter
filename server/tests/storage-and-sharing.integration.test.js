import crypto from "crypto";
import mongoose, { Types } from "mongoose";
import request from "supertest";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import Directory from "../models/directoryModel.js";
import File from "../models/fileModel.js";
import Share from "../models/shareModel.js";
import User from "../models/userModel.js";
import StorageCleanup from "../models/storageCleanupModel.js";
import {
  processStorageCleanup,
  expireAbandonedUploads,
  reconcileAccountStorage,
} from "../services/storageMaintenanceService.js";
import { UPLOAD_LIFETIME_MS } from "../services/storageService.js";
import { deleteS3Files, getFileMetaData } from "../services/s3Service.js";
import { redisMock } from "./helpers/redisMock.js";

let app;
let replicaSet;

function signedSessionCookie(sessionId) {
  const signature = crypto
    .createHmac("sha256", process.env.SESSION_SECRET)
    .update(sessionId)
    .digest("base64")
    .replace(/=+$/, "");
  return `sid=${encodeURIComponent(`s:${sessionId}.${signature}`)}`;
}

async function createAccount() {
  const userId = new Types.ObjectId();
  const rootDirId = new Types.ObjectId();
  await Directory.create({
    _id: rootDirId,
    name: "root-test",
    parentDirId: null,
    path: [rootDirId],
    userId,
  });
  const user = await User.create({
    _id: userId,
    name: "Storage User",
    email: `${userId}@example.com`,
    rootDirId,
  });
  const sessionId = crypto.randomUUID();
  await redisMock.json.set(`session:${sessionId}`, "$", {
    userId: userId.toString(),
    rootDirId: rootDirId.toString(),
    role: "user",
    createdAt: new Date().toISOString(),
    lastActiveAt: new Date().toISOString(),
  });
  return {
    user,
    rootDirId,
    cookie: signedSessionCookie(sessionId),
  };
}

async function createDirectory({ name, parent, account, size = 0 }) {
  const id = new Types.ObjectId();
  const parentPath = parent?.path || [account.rootDirId];
  return Directory.create({
    _id: id,
    name,
    size,
    parentDirId: parent?._id || account.rootDirId,
    path: [...parentPath, id],
    userId: account.user._id,
  });
}

async function createEqualTimestampDirectories({ account, parent = null }) {
  const lowerId = new Types.ObjectId("64b000000000000000000001");
  const higherId = new Types.ObjectId("64b000000000000000000002");
  const updatedAt = new Date("2026-10-24T12:34:56.789Z");
  const parentDirId = parent?._id || account.rootDirId;
  const parentPath = parent?.path || [account.rootDirId];

  await Directory.create([
    {
      _id: lowerId,
      name: "lower-id",
      parentDirId,
      path: [...parentPath, lowerId],
      userId: account.user._id,
      updatedAt,
    },
    {
      _id: higherId,
      name: "higher-id",
      parentDirId,
      path: [...parentPath, higherId],
      userId: account.user._id,
      updatedAt,
    },
  ]);

  return { lowerId, higherId };
}

beforeAll(async () => {
  replicaSet = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: "wiredTiger" },
  });
  await mongoose.connect(replicaSet.getUri());
  await StorageCleanup.init();
  ({ default: app } = await import("../app.js"));
});

afterEach(async () => {
  redisMock.reset();
  vi.clearAllMocks();
  vi.restoreAllMocks();
  await Promise.all(
    Object.values(mongoose.connection.collections).map((collection) =>
      collection.deleteMany({}),
    ),
  );
});

afterAll(async () => {
  await mongoose.disconnect();
  await replicaSet?.stop();
});

describe("file upload lifecycle", () => {
  it("initiates, verifies and completes an upload exactly once", async () => {
    const account = await createAccount();

    const initiated = await request(app)
      .post("/file/upload/initiate")
      .set("Cookie", account.cookie)
      .send({ name: "report.pdf", size: 128, contentType: "application/pdf" });
    expect(initiated.status).toBe(201);
    expect(initiated.body.uploadUrl).toBe("https://s3.example.test/upload");

    vi.mocked(getFileMetaData).mockResolvedValue({ ContentLength: 128 });
    const completed = await request(app)
      .post("/file/upload/complete")
      .set("Cookie", account.cookie)
      .send({ fileId: initiated.body.fileId });
    expect(completed.status).toBe(200);
    expect((await Directory.findById(account.rootDirId)).size).toBe(128);

    const repeated = await request(app)
      .post("/file/upload/complete")
      .set("Cookie", account.cookie)
      .send({ fileId: initiated.body.fileId });
    expect(repeated.status).toBe(200);
    expect((await Directory.findById(account.rootDirId)).size).toBe(128);
  });

  it("removes metadata and the S3 object when the uploaded size mismatches", async () => {
    const account = await createAccount();
    const initiated = await request(app)
      .post("/file/upload/initiate")
      .set("Cookie", account.cookie)
      .send({
        name: "bad.bin",
        size: 100,
        contentType: "application/octet-stream",
      });

    vi.mocked(getFileMetaData).mockResolvedValue({ ContentLength: 99 });
    const completed = await request(app)
      .post("/file/upload/complete")
      .set("Cookie", account.cookie)
      .send({ fileId: initiated.body.fileId });

    expect(completed.status).toBe(400);
    expect(await File.findById(initiated.body.fileId)).toBeNull();
    expect(await StorageCleanup.countDocuments()).toBe(1);
    await processStorageCleanup();
    expect(deleteS3Files).toHaveBeenCalledOnce();
    expect((await Directory.findById(account.rootDirId)).size).toBe(0);
  });

  it("cancels an incomplete upload without changing quota usage", async () => {
    const account = await createAccount();
    const initiated = await request(app)
      .post("/file/upload/initiate")
      .set("Cookie", account.cookie)
      .send({
        name: "cancel.bin",
        size: 100,
        contentType: "application/octet-stream",
      });

    const cancelled = await request(app)
      .delete("/file/upload/cancel")
      .set("Cookie", account.cookie)
      .send({ fileId: initiated.body.fileId });

    expect(cancelled.status).toBe(200);
    expect(await File.findById(initiated.body.fileId)).toBeNull();
    expect((await Directory.findById(account.rootDirId)).size).toBe(0);
  });
});

describe("file and directory request validation", () => {
  it("rejects invalid upload fields and unknown properties consistently", async () => {
    const account = await createAccount();
    const invalidBodies = [
      { name: "", size: 1 },
      { name: "x".repeat(256), size: 1 },
      { name: "negative.bin", size: -1 },
      { name: "fractional.bin", size: 1.5 },
      { name: "extra.bin", size: 1, unexpected: true },
      { name: "bad-parent.bin", size: 1, parentDirId: "not-an-id" },
    ];

    for (const body of invalidBodies) {
      const response = await request(app)
        .post("/file/upload/initiate")
        .set("Cookie", account.cookie)
        .send(body);

      expect(response.status).toBe(400);
      expect(response.body.error).toEqual(expect.any(Object));
    }

    expect(await File.countDocuments()).toBe(0);
  });

  it("rejects malformed upload IDs, rename bodies, and directory names", async () => {
    const account = await createAccount();

    for (const [method, url, body] of [
      ["post", "/file/upload/complete", { fileId: "invalid" }],
      ["delete", "/file/upload/cancel", { fileId: "invalid" }],
      ["patch", `/file/${new Types.ObjectId()}`, { newFilename: "" }],
      [
        "patch",
        `/directory/${new Types.ObjectId()}`,
        { newDirName: "x".repeat(256) },
      ],
    ]) {
      const response = await request(app)
        [method](url)
        .set("Cookie", account.cookie)
        .send(body);

      expect(response.status).toBe(400);
      expect(response.body.error).toEqual(expect.any(Object));
    }

    const emptyDirectory = await request(app)
      .post("/directory")
      .set("Cookie", account.cookie)
      .set("dirname", "   ");
    expect(emptyDirectory.status).toBe(400);
    expect(emptyDirectory.body.error.dirname).toBeDefined();

    const directoryWithUnknownField = await request(app)
      .post("/directory")
      .set("Cookie", account.cookie)
      .send({ unexpected: true });
    expect(directoryWithUnknownField.status).toBe(400);
    expect(directoryWithUnknownField.body.error._errors).toBeDefined();
  });

  it("rejects invalid directory pagination instead of clamping or restarting", async () => {
    const account = await createAccount();
    const malformedCursor = Buffer.from(
      JSON.stringify({ updatedAt: "not-a-date", id: new Types.ObjectId() }),
    ).toString("base64url");

    for (const query of [
      "limit=0",
      "limit=101",
      "limit=1.5",
      "limit=abc",
      `cursor=${malformedCursor}`,
      "cursor=not+a+cursor",
      "unexpected=true",
    ]) {
      const response = await request(app)
        .get(`/directory?${query}`)
        .set("Cookie", account.cookie);

      expect(response.status).toBe(400);
      expect(response.body.error).toEqual(expect.any(Object));
    }
  });

  it("accepts important name, size, and pagination boundary values", async () => {
    const account = await createAccount();
    const boundaryName = "x".repeat(255);

    const upload = await request(app)
      .post("/file/upload/initiate")
      .set("Cookie", account.cookie)
      .send({ name: boundaryName, size: 0 });
    expect(upload.status).toBe(201);
    expect((await File.findById(upload.body.fileId)).name).toBe(boundaryName);

    const createdDirectory = await request(app)
      .post("/directory")
      .set("Cookie", account.cookie)
      .set("dirname", boundaryName);
    expect(createdDirectory.status).toBe(200);
    expect(
      await Directory.countDocuments({
        userId: account.user._id,
        name: boundaryName,
      }),
    ).toBe(1);

    for (const limit of [1, 100]) {
      const listing = await request(app)
        .get(`/directory?limit=${limit}`)
        .set("Cookie", account.cookie);
      expect(listing.status).toBe(200);
    }
  });
});

describe("recursive directory lifecycle", () => {
  it("trashes and restores a nested subtree while preserving quota totals", async () => {
    const account = await createAccount();
    const parent = await createDirectory({
      name: "parent",
      parent: null,
      account,
      size: 75,
    });
    const child = await createDirectory({
      name: "child",
      parent,
      account,
      size: 75,
    });
    const file = await File.create({
      name: "nested.txt",
      size: 75,
      extension: ".txt",
      userId: account.user._id,
      parentDirId: child._id,
      uploadCompletedAt: new Date(),
    });
    await Directory.findByIdAndUpdate(account.rootDirId, { size: 75 });

    const trashed = await request(app)
      .delete(`/directory/${parent._id}`)
      .set("Cookie", account.cookie);
    expect(trashed.status).toBe(200);
    expect((await Directory.findById(account.rootDirId)).size).toBe(0);
    expect((await Directory.findById(child._id)).isTrashed).toBe(true);
    expect((await File.findById(file._id)).isTrashed).toBe(true);

    const restored = await request(app)
      .patch(`/directory/${parent._id}/restore`)
      .set("Cookie", account.cookie);
    expect(restored.status).toBe(200);
    expect((await Directory.findById(account.rootDirId)).size).toBe(75);
    expect((await Directory.findById(child._id)).isTrashed).toBe(false);
    expect((await File.findById(file._id)).isTrashed).toBe(false);
  });

  it("permanently deletes metadata and S3 objects for a subtree", async () => {
    const account = await createAccount();
    const parent = await createDirectory({
      name: "parent",
      parent: null,
      account,
      size: 25,
    });
    const file = await File.create({
      name: "nested.txt",
      size: 25,
      extension: ".txt",
      userId: account.user._id,
      parentDirId: parent._id,
      uploadCompletedAt: new Date(),
    });
    await Directory.findByIdAndUpdate(account.rootDirId, { size: 25 });

    const deleted = await request(app)
      .delete(`/directory/${parent._id}/permanent`)
      .set("Cookie", account.cookie);

    expect(deleted.status).toBe(200);
    expect(await Directory.findById(parent._id)).toBeNull();
    expect(await File.findById(file._id)).toBeNull();
    await processStorageCleanup();
    expect(deleteS3Files).toHaveBeenCalledOnce();
    expect((await Directory.findById(account.rootDirId)).size).toBe(0);
  });
});

async function initiate(account, size = 80, parentDirId) {
  return request(app)
    .post("/file/upload/initiate")
    .set("Cookie", account.cookie)
    .send({ name: "test.bin", size, parentDirId });
}

function complete(account, fileId) {
  return request(app)
    .post("/file/upload/complete")
    .set("Cookie", account.cookie)
    .send({ fileId });
}

describe("storage concurrency and rollback", () => {
  it("reserves quota atomically across simultaneous upload initiations", async () => {
    const account = await createAccount();
    await User.updateOne({ _id: account.user._id }, { maxStorageInBytes: 100 });
    const responses = await Promise.all([initiate(account), initiate(account)]);
    expect(responses.map((r) => r.status).sort()).toEqual([201, 429]);
    expect(await File.countDocuments()).toBe(1);
    expect((await Directory.findById(account.rootDirId)).size).toBe(0);
    const fileId = responses.find((r) => r.status === 201).body.fileId;
    for (let i = 0; i < 2; i++) {
      expect(
        (
          await request(app)
            .delete("/file/upload/cancel")
            .set("Cookie", account.cookie)
            .send({ fileId })
        ).status,
      ).toBe(200);
    }
    expect((await initiate(account, 100)).status).toBe(201);
    expect(await StorageCleanup.countDocuments()).toBe(1);
  });

  it("does not double-count concurrent completion of the same file", async () => {
    const account = await createAccount();
    const upload = await initiate(account);
    vi.mocked(getFileMetaData).mockResolvedValue({ ContentLength: 80 });
    const responses = await Promise.all(
      Array.from({ length: 4 }, () => complete(account, upload.body.fileId)),
    );
    expect(responses.map((r) => r.status)).toEqual([200, 200, 200, 200]);
    expect((await Directory.findById(account.rootDirId)).size).toBe(80);
  });

  it("preserves ancestor totals when distinct nested uploads complete concurrently", async () => {
    const account = await createAccount();
    const child = await createDirectory({ name: "child", account });
    const uploads = await Promise.all([
      initiate(account, 80, child._id),
      initiate(account, 80, child._id),
    ]);
    vi.mocked(getFileMetaData).mockResolvedValue({ ContentLength: 80 });
    const responses = await Promise.all(
      uploads.map((r) => complete(account, r.body.fileId)),
    );
    expect(responses.map((r) => r.status)).toEqual([200, 200]);
    expect((await Directory.findById(child._id)).size).toBe(160);
    expect((await Directory.findById(account.rootDirId)).size).toBe(160);
  });

  it("rolls back completion and earlier ancestor writes if a later write fails", async () => {
    const account = await createAccount();
    const child = await createDirectory({ name: "child", account });
    const upload = await initiate(account, 80, child._id);
    vi.mocked(getFileMetaData).mockResolvedValue({ ContentLength: 80 });
    const update = Directory.updateOne.bind(Directory);
    const fault = vi
      .spyOn(Directory, "updateOne")
      .mockImplementationOnce(update)
      .mockRejectedValueOnce(new Error("injected ancestor failure"));
    expect((await complete(account, upload.body.fileId)).status).toBe(500);
    expect(
      (await File.findById(upload.body.fileId)).uploadCompletedAt,
    ).toBeNull();
    expect((await Directory.findById(child._id)).size).toBe(0);
    expect((await Directory.findById(account.rootDirId)).size).toBe(0);
    fault.mockRestore();
    expect((await complete(account, upload.body.fileId)).status).toBe(200);
    expect((await Directory.findById(account.rootDirId)).size).toBe(80);
  });

  it("preserves a pending upload and its reservation on transient S3 HEAD failure", async () => {
    const account = await createAccount();
    await User.updateOne({ _id: account.user._id }, { maxStorageInBytes: 100 });
    const upload = await initiate(account);
    vi.mocked(getFileMetaData).mockRejectedValueOnce(
      new Error("S3 unavailable"),
    );
    expect((await complete(account, upload.body.fileId)).status).toBe(503);
    expect(await File.findById(upload.body.fileId)).not.toBeNull();
    expect(await StorageCleanup.countDocuments()).toBe(0);
    expect((await initiate(account, 30)).status).toBe(429);
  });

  it("cannot resurrect an upload when cancellation races with completion", async () => {
    const account = await createAccount();
    const upload = await initiate(account);
    vi.mocked(getFileMetaData).mockResolvedValue({ ContentLength: 80 });
    const [completed, cancelled] = await Promise.all([
      complete(account, upload.body.fileId),
      request(app)
        .delete("/file/upload/cancel")
        .set("Cookie", account.cookie)
        .send({ fileId: upload.body.fileId }),
    ]);
    const file = await File.findById(upload.body.fileId);
    if (file) {
      expect(completed.status).toBe(200);
      expect(cancelled.status).toBe(409);
      expect(file.uploadCompletedAt).not.toBeNull();
      expect(await StorageCleanup.countDocuments()).toBe(0);
      expect((await Directory.findById(account.rootDirId)).size).toBe(80);
    } else {
      expect(cancelled.status).toBe(200);
      expect(completed.status).toBe(404);
      expect(await StorageCleanup.countDocuments()).toBe(1);
      expect((await Directory.findById(account.rootDirId)).size).toBe(0);
    }
  });

  it("rejects upload into a trashed parent and quota-bypassing restores", async () => {
    const account = await createAccount();
    await User.updateOne({ _id: account.user._id }, { maxStorageInBytes: 100 });
    const child = await createDirectory({ name: "child", account });
    const upload = await initiate(account, 80, child._id);
    vi.mocked(getFileMetaData).mockResolvedValue({ ContentLength: 80 });
    await complete(account, upload.body.fileId);
    expect(
      (
        await request(app)
          .delete(`/directory/${child._id}`)
          .set("Cookie", account.cookie)
      ).status,
    ).toBe(200);
    expect((await initiate(account, 10, child._id)).status).toBe(409);
    expect((await initiate(account, 80)).status).toBe(201);
    expect(
      (
        await request(app)
          .patch(`/directory/${child._id}/restore`)
          .set("Cookie", account.cookie)
      ).status,
    ).toBe(429);
    expect((await Directory.findById(child._id)).isTrashed).toBe(true);
    expect((await File.findById(upload.body.fileId)).isTrashed).toBe(true);
    expect((await Directory.findById(account.rootDirId)).size).toBe(0);
  });

  it("rolls back deletion and accounting when the durable cleanup write fails", async () => {
    const account = await createAccount();
    const upload = await initiate(account);
    vi.mocked(getFileMetaData).mockResolvedValue({ ContentLength: 80 });
    await complete(account, upload.body.fileId);
    vi.spyOn(StorageCleanup, "bulkWrite").mockRejectedValueOnce(
      new Error("injected outbox failure"),
    );
    expect(
      (
        await request(app)
          .delete(`/file/${upload.body.fileId}/permanent`)
          .set("Cookie", account.cookie)
      ).status,
    ).toBe(500);
    expect(await File.findById(upload.body.fileId)).not.toBeNull();
    expect((await Directory.findById(account.rootDirId)).size).toBe(80);
    expect(await StorageCleanup.countDocuments()).toBe(0);
    expect(deleteS3Files).not.toHaveBeenCalled();
  });
});

describe("durable storage maintenance", () => {
  it("atomically queues empty-trash cleanup while preserving live files", async () => {
    const account = await createAccount();
    const trashed = await initiate(account);
    const live = await initiate(account);
    vi.mocked(getFileMetaData).mockResolvedValue({ ContentLength: 80 });
    await complete(account, trashed.body.fileId);
    await complete(account, live.body.fileId);
    await request(app)
      .delete(`/file/${trashed.body.fileId}`)
      .set("Cookie", account.cookie);
    const response = await request(app)
      .delete("/trash")
      .set("Cookie", account.cookie);
    expect(response.status).toBe(200);
    expect(response.body.cleanupPending).toBe(true);
    expect(await File.findById(trashed.body.fileId)).toBeNull();
    expect(await File.findById(live.body.fileId)).not.toBeNull();
    expect((await Directory.findById(account.rootDirId)).size).toBe(80);
    expect(await StorageCleanup.countDocuments()).toBe(1);
  });

  it("rejects expired completion and releases its reservation durably", async () => {
    const account = await createAccount();
    await User.updateOne({ _id: account.user._id }, { maxStorageInBytes: 100 });
    const upload = await initiate(account);
    await File.updateOne(
      { _id: upload.body.fileId },
      { createdAt: new Date(Date.now() - UPLOAD_LIFETIME_MS - 1000) },
    );
    vi.mocked(getFileMetaData).mockResolvedValue({ ContentLength: 80 });
    expect((await complete(account, upload.body.fileId)).status).toBe(410);
    expect(await File.findById(upload.body.fileId)).toBeNull();
    expect(await StorageCleanup.countDocuments()).toBe(1);
    expect((await initiate(account, 100)).status).toBe(201);
  });

  it("serializes reconciliation against concurrent completion", async () => {
    const account = await createAccount();
    const upload = await initiate(account);
    vi.mocked(getFileMetaData).mockResolvedValue({ ContentLength: 80 });
    await Directory.updateOne({ _id: account.rootDirId }, { size: 999 });
    const [completion] = await Promise.all([
      complete(account, upload.body.fileId),
      reconcileAccountStorage(account.user._id),
    ]);
    expect(completion.status).toBe(200);
    expect((await Directory.findById(account.rootDirId)).size).toBe(80);
  });

  it("expires abandoned reservations without deleting fresh or completed uploads", async () => {
    const account = await createAccount();
    const stale = await initiate(account);
    const fresh = await initiate(account);
    const done = await initiate(account);
    vi.mocked(getFileMetaData).mockResolvedValue({ ContentLength: 80 });
    await complete(account, done.body.fileId);
    await File.updateMany(
      { _id: { $in: [stale.body.fileId, done.body.fileId] } },
      { createdAt: new Date(Date.now() - UPLOAD_LIFETIME_MS - 1000) },
    );
    expect(await expireAbandonedUploads()).toBe(1);
    expect(await File.findById(stale.body.fileId)).toBeNull();
    expect(await File.findById(fresh.body.fileId)).not.toBeNull();
    expect(await File.findById(done.body.fileId)).not.toBeNull();
    expect((await Directory.findById(account.rootDirId)).size).toBe(80);
    expect(await StorageCleanup.countDocuments()).toBe(1);
  });

  it("retries per-object S3 failures even when the batch request succeeds", async () => {
    const account = await createAccount();
    const child = await createDirectory({ name: "child", account });
    const first = await initiate(account, 80, child._id);
    const second = await initiate(account, 80, child._id);
    expect(
      (
        await request(app)
          .delete(`/directory/${child._id}/permanent`)
          .set("Cookie", account.cookie)
      ).status,
    ).toBe(200);
    const goodKey = `${first.body.fileId}.bin`;
    const badKey = `${second.body.fileId}.bin`;
    vi.mocked(deleteS3Files).mockResolvedValueOnce({
      Deleted: [{ Key: goodKey }],
      Errors: [{ Key: badKey, Code: "AccessDenied" }],
    });
    const now = new Date();
    expect(await processStorageCleanup({ now })).toEqual({
      deleted: 1,
      failed: 1,
    });
    expect((await StorageCleanup.findById(badKey)).lastError).toBe(
      "AccessDenied",
    );
    expect(
      (await StorageCleanup.findById(goodKey)).lastDeletedAt,
    ).not.toBeNull();
    expect(
      await processStorageCleanup({ now: new Date(now.getTime() + 3000) }),
    ).toEqual({ deleted: 1, failed: 0 });
    expect((await StorageCleanup.findById(badKey)).attempts).toBe(0);
    expect(await File.countDocuments()).toBe(0);
  });

  it("recovers expired worker leases and retries S3 outages", async () => {
    const account = await createAccount();
    const upload = await initiate(account);
    await request(app)
      .delete("/file/upload/cancel")
      .set("Cookie", account.cookie)
      .send({ fileId: upload.body.fileId });
    const now = new Date();
    await StorageCleanup.updateMany(
      {},
      { leaseToken: "crashed-worker", leaseUntil: new Date(now.getTime() - 1) },
    );
    vi.mocked(deleteS3Files).mockRejectedValueOnce(new Error("S3 unavailable"));
    expect(await processStorageCleanup({ now })).toEqual({
      deleted: 0,
      failed: 1,
    });
    expect(
      await processStorageCleanup({ now: new Date(now.getTime() + 3000) }),
    ).toEqual({ deleted: 1, failed: 0 });
  });

  it("leases each cleanup job once across concurrent workers and revisits late writes", async () => {
    const account = await createAccount();
    const upload = await initiate(account);
    await request(app)
      .delete("/file/upload/cancel")
      .set("Cookie", account.cookie)
      .send({ fileId: upload.body.fileId });
    const now = new Date();
    const results = await Promise.all([
      processStorageCleanup({ now }),
      processStorageCleanup({ now }),
    ]);
    expect(results.reduce((sum, result) => sum + result.deleted, 0)).toBe(1);
    expect(deleteS3Files).toHaveBeenCalledTimes(1);
    expect(await StorageCleanup.countDocuments()).toBe(1);
    await processStorageCleanup({
      now: new Date(now.getTime() + UPLOAD_LIFETIME_MS + 1),
    });
    expect(deleteS3Files).toHaveBeenCalledTimes(2);
  });

  it("reconciles drift from file records, excluding pending and trashed files", async () => {
    const account = await createAccount();
    const child = await createDirectory({ name: "child", account });
    const upload = await initiate(account, 80, child._id);
    vi.mocked(getFileMetaData).mockResolvedValue({ ContentLength: 80 });
    await complete(account, upload.body.fileId);
    await initiate(account, 500, child._id);
    await File.create({
      name: "trashed.bin",
      extension: ".bin",
      size: 300,
      userId: account.user._id,
      parentDirId: child._id,
      uploadCompletedAt: new Date(),
      isTrashed: true,
    });
    await Directory.updateMany({ userId: account.user._id }, { size: 999 });
    expect(await reconcileAccountStorage(account.user._id)).toBe(2);
    expect((await Directory.findById(child._id)).size).toBe(80);
    expect((await Directory.findById(account.rootDirId)).size).toBe(80);
    expect(await reconcileAccountStorage(account.user._id)).toBe(0);
  });
});

describe("directory pagination", () => {
  it("paginates authenticated listings by ObjectId and rejects malformed cursors", async () => {
    const account = await createAccount();
    const { lowerId, higherId } = await createEqualTimestampDirectories({
      account,
    });

    const firstPage = await request(app)
      .get(`/directory/${account.rootDirId}`)
      .query({ limit: 1 })
      .set("Cookie", account.cookie);

    expect(firstPage.status).toBe(200);
    expect(firstPage.body.items.map((item) => item.id)).toEqual([
      higherId.toString(),
    ]);
    expect(firstPage.body.nextCursor).toEqual(expect.any(String));

    const secondPage = await request(app)
      .get(`/directory/${account.rootDirId}`)
      .query({ limit: 1, cursor: firstPage.body.nextCursor })
      .set("Cookie", account.cookie);

    expect(secondPage.status).toBe(200);
    expect(secondPage.body.items.map((item) => item.id)).toEqual([
      lowerId.toString(),
    ]);
    expect(secondPage.body.nextCursor).toBeNull();

    const malformed = await request(app)
      .get(`/directory/${account.rootDirId}`)
      .query({ cursor: "not+a+base64url+cursor" })
      .set("Cookie", account.cookie);

    expect(malformed.status).toBe(400);
    expect(malformed.body).toEqual({
      error: { cursor: ["Invalid pagination cursor"] },
    });
  });

  it("paginates public shared folders and rejects malformed cursors", async () => {
    const account = await createAccount();
    const sharedRoot = await createDirectory({
      name: "shared",
      parent: null,
      account,
    });
    const { lowerId, higherId } = await createEqualTimestampDirectories({
      account,
      parent: sharedRoot,
    });
    const created = await request(app)
      .post("/share")
      .set("Cookie", account.cookie)
      .send({ resourceType: "directory", resourceId: sharedRoot._id });
    const token = created.body.share.token;

    const firstPage = await request(app)
      .get(`/public/share/${token}`)
      .query({ limit: 1 });

    expect(firstPage.status).toBe(200);
    expect(firstPage.body.items.map((item) => item.id)).toEqual([
      higherId.toString(),
    ]);
    expect(firstPage.body.nextCursor).toEqual(expect.any(String));

    const secondPage = await request(app)
      .get(`/public/share/${token}`)
      .query({ limit: 1, cursor: firstPage.body.nextCursor });

    expect(secondPage.status).toBe(200);
    expect(secondPage.body.items.map((item) => item.id)).toEqual([
      lowerId.toString(),
    ]);
    expect(secondPage.body.nextCursor).toBeNull();

    const malformed = await request(app)
      .get(`/public/share/${token}`)
      .query({ cursor: "not+a+base64url+cursor" });

    expect(malformed.status).toBe(400);
    expect(malformed.body).toEqual({ error: "Invalid pagination cursor." });
  });
});

describe("share access boundaries", () => {
  it("does not allow a folder share to navigate outside its subtree", async () => {
    const account = await createAccount();
    const sharedRoot = await createDirectory({
      name: "shared",
      parent: null,
      account,
    });
    const outside = await createDirectory({
      name: "private",
      parent: null,
      account,
    });

    const created = await request(app)
      .post("/share")
      .set("Cookie", account.cookie)
      .send({ resourceType: "directory", resourceId: sharedRoot._id });
    const token = created.body.share.token;

    expect((await request(app).get(`/public/share/${token}`)).status).toBe(200);
    const traversal = await request(app).get(
      `/public/share/${token}?dir=${outside._id}`,
    );
    expect(traversal.status).toBe(403);
  });

  it("requires an allowlisted signed-in email for restricted links", async () => {
    const owner = await createAccount();
    const allowed = await createAccount();
    const sharedFile = await File.create({
      name: "private.pdf",
      size: 10,
      extension: ".pdf",
      userId: owner.user._id,
      parentDirId: owner.rootDirId,
      uploadCompletedAt: new Date(),
    });
    const created = await request(app)
      .post("/share")
      .set("Cookie", owner.cookie)
      .send({ resourceType: "file", resourceId: sharedFile._id });
    const shareId = created.body.share.id;
    const token = created.body.share.token;

    await request(app)
      .patch(`/share/${shareId}`)
      .set("Cookie", owner.cookie)
      .send({ accessType: "restricted", allowedEmails: [allowed.user.email] });

    expect((await request(app).get(`/public/share/${token}`)).status).toBe(401);
    expect(
      (
        await request(app)
          .get(`/public/share/${token}`)
          .set("Cookie", allowed.cookie)
      ).status,
    ).toBe(200);
    expect(await Share.countDocuments({ isActive: true })).toBe(1);
  });
});
