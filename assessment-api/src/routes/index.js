import express from "express";
import problemsRoutes from "./problems.routes.js";
import submissionsRoutes from "./submissions.routes.js";
import previewRoutes from "./preview.routes.js";
import authRoutes from "./auth.routes.js";

const router = express.Router();

router.use("/problems", problemsRoutes);
router.use("/submissions", submissionsRoutes);
router.use("/preview", previewRoutes);
router.use("/auth", authRoutes);

export default router;
