const METRIC_PREFIX = "upanaya_api";
const { renderPayrollMetrics } = require("./payrollMetrics");

const state = {
  startedAt: Date.now(),
  totalRequests: 0,
  totalErrors: 0,
  inFlight: 0,
  requestsByRoute: new Map(),
  durationBucketsMs: [50, 100, 250, 500, 1000, 2500, 5000],
  durationCountsByRoute: new Map()
};

const objectIdRegex = /\b[a-f0-9]{24}\b/gi;
const numberRegex = /\b\d+\b/g;

const normalizePath = (path = "") =>
  String(path)
    .split("?")[0]
    .replace(objectIdRegex, ":id")
    .replace(numberRegex, ":num");

const routeKey = (req, statusCode) => {
  const path = normalizePath(req.originalUrl || req.path || "/");
  return `${req.method}|${path}|${statusCode}`;
};

const getDurationBucket = (durationMs) => {
  for (const bucket of state.durationBucketsMs) {
    if (durationMs <= bucket) return bucket;
  }
  return "+Inf";
};

const observeRequest = (req, statusCode, durationMs) => {
  state.totalRequests += 1;
  if (statusCode >= 500) {
    state.totalErrors += 1;
  }

  const key = routeKey(req, statusCode);
  state.requestsByRoute.set(key, (state.requestsByRoute.get(key) || 0) + 1);

  const bucket = getDurationBucket(durationMs);
  const bucketKey = `${req.method}|${normalizePath(req.originalUrl || req.path || "/")}|${bucket}`;
  state.durationCountsByRoute.set(
    bucketKey,
    (state.durationCountsByRoute.get(bucketKey) || 0) + 1
  );
};

const metricsMiddleware = (req, res, next) => {
  const start = process.hrtime.bigint();
  state.inFlight += 1;

  res.on("finish", () => {
    const end = process.hrtime.bigint();
    const durationMs = Number(end - start) / 1_000_000;
    state.inFlight = Math.max(0, state.inFlight - 1);
    observeRequest(req, res.statusCode, durationMs);
  });

  next();
};

const getMetricsSnapshot = () => ({
  uptimeSeconds: Math.floor((Date.now() - state.startedAt) / 1000),
  totalRequests: state.totalRequests,
  totalErrors: state.totalErrors,
  inFlight: state.inFlight
});

const metricsHandler = (req, res) => {
  const lines = [];
  lines.push(`# HELP ${METRIC_PREFIX}_requests_total Total HTTP requests`);
  lines.push(`# TYPE ${METRIC_PREFIX}_requests_total counter`);
  lines.push(`${METRIC_PREFIX}_requests_total ${state.totalRequests}`);

  lines.push(`# HELP ${METRIC_PREFIX}_errors_total Total HTTP 5xx responses`);
  lines.push(`# TYPE ${METRIC_PREFIX}_errors_total counter`);
  lines.push(`${METRIC_PREFIX}_errors_total ${state.totalErrors}`);

  lines.push(`# HELP ${METRIC_PREFIX}_in_flight Current in-flight HTTP requests`);
  lines.push(`# TYPE ${METRIC_PREFIX}_in_flight gauge`);
  lines.push(`${METRIC_PREFIX}_in_flight ${state.inFlight}`);

  lines.push(`# HELP ${METRIC_PREFIX}_uptime_seconds Process uptime seconds`);
  lines.push(`# TYPE ${METRIC_PREFIX}_uptime_seconds gauge`);
  lines.push(
    `${METRIC_PREFIX}_uptime_seconds ${Math.floor((Date.now() - state.startedAt) / 1000)}`
  );

  lines.push(`# HELP ${METRIC_PREFIX}_requests_by_route_total Route request counts`);
  lines.push(`# TYPE ${METRIC_PREFIX}_requests_by_route_total counter`);
  for (const [key, value] of state.requestsByRoute.entries()) {
    const [method, route, status] = key.split("|");
    lines.push(
      `${METRIC_PREFIX}_requests_by_route_total{method="${method}",route="${route}",status="${status}"} ${value}`
    );
  }

  lines.push(`# HELP ${METRIC_PREFIX}_duration_bucket Route duration bucket counts`);
  lines.push(`# TYPE ${METRIC_PREFIX}_duration_bucket counter`);
  for (const [key, value] of state.durationCountsByRoute.entries()) {
    const [method, route, le] = key.split("|");
    lines.push(
      `${METRIC_PREFIX}_duration_bucket{method="${method}",route="${route}",le="${le}"} ${value}`
    );
  }

  lines.push(...renderPayrollMetrics());

  res.setHeader("Content-Type", "text/plain; version=0.0.4; charset=utf-8");
  res.status(200).send(lines.join("\n"));
};

module.exports = {
  metricsMiddleware,
  metricsHandler,
  getMetricsSnapshot
};
