require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { pool } = require("./src/db");
const webhooksRouter = require("./src/routes/webhooks");
const conversationsRouter = require("./src/routes/conversations");
const driversRouter = require("./src/routes/drivers");
const jobRequestsRouter = require("./src/routes/jobRequests");
const jobsRouter = require("./src/routes/jobs");
const incidentsRouter = require("./src/routes/incidents");
const statsRouter = require("./src/routes/stats");
const { startAutoClosureSweep } = require("./src/services/autoClosure");

const app = express();

app.use(cors());
app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.get("/health", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ status: "ok", database: "connected" });
  } catch (err) {
    res.status(500).json({ status: "error", database: err.message });
  }
});

app.use("/api/webhooks/whatsapp", webhooksRouter);
app.use("/api/conversations", conversationsRouter);
app.use("/api/drivers", driversRouter);
app.use("/api/job-requests", jobRequestsRouter);
app.use("/api/jobs", jobsRouter);
app.use("/api/incidents", incidentsRouter);
app.use("/api/stats", statsRouter);

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Backend listening on http://localhost:${PORT}`);
  console.log(
    `Webhook endpoint: ${process.env.WHATSAPP_PUBLIC_URL}/api/webhooks/whatsapp`,
  );
  startAutoClosureSweep();
});
