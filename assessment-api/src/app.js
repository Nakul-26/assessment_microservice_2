import express from "express";
import cors from "cors";
import routes from "./routes/index.js";
import { errorHandler } from "./middleware/errorHandler.js";

const app = express();

app.use((req, res, next) => {
  console.log(`📥 Incoming request: ${req.method} , ${req.url}`);
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

const corsOptions = {
  origin: "*",
  optionsSuccessStatus: 200,
  credentials: true
};

app.use(cors(corsOptions));
app.use(express.json());

app.use("/api", routes);
app.get("/", (req, res) => {
  res.send("API is working 2");
});

app.use(errorHandler);

export default app;
