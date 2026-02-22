import express from "express";
import { previewWrapper } from "../controllers/preview.controller.js";

const router = express.Router();

router.post("/", previewWrapper);

export default router;
