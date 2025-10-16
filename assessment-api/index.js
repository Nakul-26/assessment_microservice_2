// server.js
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { MongoClient, ServerApiVersion } from "mongodb";
import API from "./routes/api.js"; // ensure correct relative path
import mongoose from "mongoose";

dotenv.config();
const app = express();

// --- MongoDB Client ---
// Use provided MONGO_URI or default to the docker-compose service name so it works inside Codespaces
const uri = process.env.MONGO_URI || 'mongodb://mongo:27017';

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function connectDB() {
  try {
    await client.connect();
    await client.db("admin").command({ ping: 1 });
    console.log("✅ Connected to MongoDB via MongoClient");
  } catch (err) {
    console.error("❌ MongoDB connection error:", err);
  }
}
connectDB();

// --- Middleware ---
const corsOptions = {
  origin: "*",
  optionsSuccessStatus: 200,
  credentials: true
};
app.use(cors(corsOptions));
app.use(express.json());


mongoose.connect(uri, {
  dbName: 'assessment_db',
  serverSelectionTimeoutMS: 20000 // Increase timeout for stability
})
    .then(() => {
        console.log("✅ Connected to MongoDB via Mongoose");
    })
    .catch((err) => {
        console.error("❌ Mongoose connection error:", err);
    });


// Logging middleware
app.use((req, res, next) => {
  console.log(`📥 Incoming request: ${req.method} ${req.url}`);
  console.log("👉 Headers:", req.headers.origin);
  if (req.body && Object.keys(req.body).length > 0) {
    console.log("👉 Body:", req.body);
  }
  console.log("👉 Query:", req.query);
  console.log("👉 Params:", req.params);
  console.log("👉 IP:", req.ip);
  console.log("⏰ Time:", new Date().toISOString());
  next();
});

// --- Routes ---
app.use("/api", API);
app.get("/", (req, res) => {
  res.send("API is working 2");
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (err) => {
  console.log(`Error: ${err && err.message ? err.message : err}`);
  // Close server & exit process
  if (typeof server !== 'undefined') {
    server.close(() => process.exit(1));
  } else {
    process.exit(1);
  }
});

// --- Start Server ---
const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));