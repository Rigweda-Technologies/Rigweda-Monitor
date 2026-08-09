const state = {
  compute: {
    total: 0,
    failed: 0,
    byMode: new Map(),
    durationBucketsMs: [250, 500, 1000, 2500, 5000, 10000, 30000],
    durationCounts: new Map()
  },
  idempotencyReplayByAction: new Map()
};

const normalizeMode = (mode) => String(mode || "sync");

const getDurationBucket = (durationMs) => {
  for (const bucket of state.compute.durationBucketsMs) {
    if (durationMs <= bucket) return String(bucket);
  }
  return "+Inf";
};

exports.observePayrollCompute = ({ outcome = "success", mode = "sync", durationMs = 0 }) => {
  state.compute.total += 1;
  if (outcome !== "success") {
    state.compute.failed += 1;
  }

  const normalizedMode = normalizeMode(mode);
  const modeKey = `${normalizedMode}|${outcome}`;
  state.compute.byMode.set(modeKey, (state.compute.byMode.get(modeKey) || 0) + 1);

  const bucket = getDurationBucket(Number(durationMs) || 0);
  const bucketKey = `${normalizedMode}|${outcome}|${bucket}`;
  state.compute.durationCounts.set(bucketKey, (state.compute.durationCounts.get(bucketKey) || 0) + 1);
};

exports.observePayrollIdempotencyReplay = (actionKey) => {
  const key = String(actionKey || "unknown");
  state.idempotencyReplayByAction.set(
    key,
    (state.idempotencyReplayByAction.get(key) || 0) + 1
  );
};

exports.renderPayrollMetrics = () => {
  const lines = [];
  const prefix = "upanaya_payroll";

  lines.push(`# HELP ${prefix}_compute_total Total payroll compute runs`);
  lines.push(`# TYPE ${prefix}_compute_total counter`);
  lines.push(`${prefix}_compute_total ${state.compute.total}`);

  lines.push(`# HELP ${prefix}_compute_failed_total Failed payroll compute runs`);
  lines.push(`# TYPE ${prefix}_compute_failed_total counter`);
  lines.push(`${prefix}_compute_failed_total ${state.compute.failed}`);

  lines.push(`# HELP ${prefix}_compute_by_mode_total Payroll compute by mode and outcome`);
  lines.push(`# TYPE ${prefix}_compute_by_mode_total counter`);
  for (const [key, value] of state.compute.byMode.entries()) {
    const [mode, outcome] = key.split("|");
    lines.push(`${prefix}_compute_by_mode_total{mode="${mode}",outcome="${outcome}"} ${value}`);
  }

  lines.push(`# HELP ${prefix}_compute_duration_bucket Payroll compute duration buckets`);
  lines.push(`# TYPE ${prefix}_compute_duration_bucket counter`);
  for (const [key, value] of state.compute.durationCounts.entries()) {
    const [mode, outcome, le] = key.split("|");
    lines.push(
      `${prefix}_compute_duration_bucket{mode="${mode}",outcome="${outcome}",le="${le}"} ${value}`
    );
  }

  lines.push(`# HELP ${prefix}_idempotency_replay_total Idempotent replay hits by action`);
  lines.push(`# TYPE ${prefix}_idempotency_replay_total counter`);
  for (const [action, value] of state.idempotencyReplayByAction.entries()) {
    lines.push(`${prefix}_idempotency_replay_total{action="${action}"} ${value}`);
  }

  return lines;
};
