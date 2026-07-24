import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import { v4 as uuidv4 } from "uuid";
import routes from "./routes/index.js";
import { errorHandler } from "./middleware/errorHandler.js";

import swaggerUi from "swagger-ui-express";
import { swaggerSpec } from "./config/swagger.js";

const app = express();

const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10000, // Increased for load testing
  standardHeaders: true,
  legacyHeaders: false,
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100, // Still reasonably strict for auth
  message: "Too many attempts, please try again after 15 minutes",
  standardHeaders: true,
  legacyHeaders: false,
});

const integrationLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 10000, // High limit for the testing platform integration
  message: "Too many integration requests, applying backpressure",
  standardHeaders: true,
  legacyHeaders: false,
});

const arventiqLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 10000, // High limit — same rationale as integrationLimiter
  message: "Too many Arventiq requests, applying backpressure",
  standardHeaders: true,
  legacyHeaders: false,
});

app.use((req, res, next) => {
  req.id = req.headers["x-request-id"] || uuidv4();
  res.setHeader("x-request-id", req.id);
  console.log(`[REQ:${req.id}] 📥 Incoming request: ${req.method} , ${req.url}`);
  // console.log("👉 Headers:", req.headers.origin); // Less spammy logs
  if (req.body && Object.keys(req.body).length > 0) {
    // console.log("👉 Body:", req.body);
  }
  next();
});

const corsOptions = {
  origin: "*",
  optionsSuccessStatus: 200,
  credentials: true
};

app.use(cors(corsOptions));
app.use(express.json({ limit: "100kb" }));
app.use(express.urlencoded({ extended: true, limit: "100kb" }));

// Swagger Documentation
app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));

// Versioned Routes
app.use("/api/v1/auth", authLimiter);
app.use("/api/v1/integration", integrationLimiter);
app.use("/api/v1/arventiq", arventiqLimiter);
app.use("/api/v1", generalLimiter);
app.use("/api/v1", routes);

// Backward Compatibility / Default Prefix
app.use("/api", routes);

app.get("/", (req, res) => {
  res.json({
    message: "Assessment Microservice API",
    version: "1.0.0",
    docs: "/api-docs",
    v1: "/api/v1"
  });
});

app.use(errorHandler);

export default app;
