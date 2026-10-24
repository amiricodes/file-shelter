import express from "express";
import validateIdMiddleware from "../middlewares/validateIdMiddleware.js";
import validateRequest from "../middlewares/validateRequestMiddleware.js";
import {
  createDirectorySchema,
  directoryListingQuerySchema,
  renameDirectorySchema,
} from "../validators/directoryValidators.js";

import {
  createDirectory,
  getDirectory,
  renameDirectory,
  trashDirectory,
  restoreDirectory,
  permanentlyDeleteDirectory,
} from "../controllers/directoryController.js";

const router = express.Router();

router.param("parentDirId", validateIdMiddleware);
router.param("id", validateIdMiddleware);

// Read
router.get(
  "/:id?",
  validateRequest(directoryListingQuerySchema, { source: "query" }),
  getDirectory,
);

router.post(
  "/:parentDirId?",
  validateRequest(createDirectorySchema, {
    source: "directory",
    select: (req) => ({
      ...(req.body || {}),
      dirname: req.get("dirname") ?? req.body?.dirname,
    }),
  }),
  createDirectory,
);

router.patch("/:id", validateRequest(renameDirectorySchema), renameDirectory);

router.delete("/:id", trashDirectory);
router.delete("/:id/permanent", permanentlyDeleteDirectory);
router.patch("/:id/restore", restoreDirectory);

export default router;
