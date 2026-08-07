const express = require("express");

const createHealthRouter = ({ pool, startedAt }) => {
  const router = express.Router();
  router.get("/health", (_req, res) => res.json({
    success: true,
    data: { status: "ok", uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000) }
  }));
  router.get("/ready", async (_req, res) => {
    if (!pool) return res.json({ success: true, data: { status: "ready", database: "test-bypass" } });
    try {
      await pool.query("SELECT 1");
      return res.json({ success: true, data: { status: "ready", database: "up" } });
    } catch {
      return res.status(503).json({ success: false, error: { code: "NOT_READY", message: "Database unavailable." } });
    }
  });
  return router;
};

module.exports = { createHealthRouter };
