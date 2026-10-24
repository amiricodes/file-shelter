import express from "express";
import validateIdMiddleware from "../middlewares/validateIdMiddleware.js";
import validateRequest from "../middlewares/validateRequestMiddleware.js";
import {
  renameFileSchema,
  uploadCancelSchema,
  uploadCompleteSchema,
  uploadInitiateSchema,
} from "../validators/fileValidators.js";

import {
  getFile,
  renameFile,
  trashFile,
  restoreFile,
  permanentlyDeleteFile,
  uploadInitiate,
  uploadComplete,
  uploadCancel,
} from "../controllers/fileController.js";

const router = express.Router();
router.param("id", validateIdMiddleware);

router.post(
  "/upload/initiate",
  validateRequest(uploadInitiateSchema),
  uploadInitiate,
);
router.post(
  "/upload/complete",
  validateRequest(uploadCompleteSchema),
  uploadComplete,
);
router.delete(
  "/upload/cancel",
  validateRequest(uploadCancelSchema),
  uploadCancel,
);

router.get("/:id", getFile);

router.patch("/:id", validateRequest(renameFileSchema), renameFile);

router.delete("/:id", trashFile);
router.delete("/:id/permanent", permanentlyDeleteFile);
router.patch("/:id/restore", restoreFile);

export default router;
