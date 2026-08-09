// const logger = require("../logger/logger");

module.exports = (req, res, next) => {
  const start = Date.now();

  // Optional: keep console log only in dev
  if (process.env.NODE_ENV !== "production") {
    console.log(
      `[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`
    );
  }

  res.on("finish", () => {
    // logger.info("HTTP Request", {
    //   method: req.method,
    //   url: req.originalUrl,
    //   statusCode: res.statusCode,
    //   durationMs: Date.now() - start,
    //   userId: req.user?._id || null,
    //   ip: req.ip,
    //   userAgent: req.headers["user-agent"]
    // });
  });

  next();
};
