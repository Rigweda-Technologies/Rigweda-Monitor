const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const os = require("os");
const https = require("https");
const MonitorRelease = require("./monitorRelease.model");
const MonitorDeviceUpdate = require("./monitorDeviceUpdate.model");

function parseVersion(version) {
  return String(version || "0.0.0")
    .trim()
    .split(".")
    .map((part) => Number.parseInt(part, 10) || 0);
}

function compareVersions(left, right) {
  const a = parseVersion(left);
  const b = parseVersion(right);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const delta = (a[index] || 0) - (b[index] || 0);
    if (delta !== 0) return delta;
  }
  return 0;
}

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function ensurePositiveInt(value, fallback = 0) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function releaseSortRank(release) {
  const statusWeight = {
    active: 3,
    testing: 2,
    draft: 1,
    disabled: 0
  };

  return {
    status: statusWeight[String(release?.status || "draft")] || 0,
    createdAt: new Date(release?.createdAt || 0).getTime(),
    releasedAt: new Date(release?.releasedAt || 0).getTime()
  };
}

function sortReleasesDesc(a, b) {
  const versionDelta = compareVersions(b.version, a.version);
  if (versionDelta !== 0) return versionDelta;

  const aRank = releaseSortRank(a);
  const bRank = releaseSortRank(b);
  if (bRank.status !== aRank.status) return bRank.status - aRank.status;
  if (bRank.releasedAt !== aRank.releasedAt) return bRank.releasedAt - aRank.releasedAt;
  return bRank.createdAt - aRank.createdAt;
}

function isEligible(deviceId, release) {
  const rollout = Number.isFinite(release?.rolloutPercentage) ? release.rolloutPercentage : 100;
  if (rollout >= 100) return true;
  const digest = crypto.createHash("sha256").update(`${deviceId}:${release._id}`).digest("hex");
  return Number.parseInt(digest.slice(0, 8), 16) % 100 < rollout;
}

function resolveDownloadUrl(release) {
  return (
    release?.signedDownloadUrl ||
    process.env.MONITOR_RELEASE_SIGNED_URL ||
    process.env.MONITOR_UPDATE_DOWNLOAD_URL ||
    ""
  );
}

exports.listReleases = async () => {
  const items = await MonitorRelease.find().sort({ createdAt: -1, build: -1 }).lean();
  return items.sort(sortReleasesDesc);
};

exports.getLatestRelease = async ({ deviceId, appVersion }) => {
  const releases = await MonitorRelease.find({
    channel: "stable",
    status: { $in: ["testing", "active"] }
  })
    .sort({ createdAt: -1, build: -1 })
    .lean();

  const latestRelease = releases.sort(sortReleasesDesc)[0];

  if (!latestRelease) {
    return { updateAvailable: false, version: appVersion || "0.0.0" };
  }

  const shouldUpdate =
    compareVersions(latestRelease.version, appVersion || "0.0.0") > 0 &&
    isEligible(deviceId, latestRelease);

  if (!shouldUpdate) {
    return { updateAvailable: false, version: appVersion || latestRelease.version };
  }

  return {
    updateAvailable: true,
    version: latestRelease.version,
    build: latestRelease.build,
    mandatory: Boolean(latestRelease.mandatory),
    downloadUrl: resolveDownloadUrl(latestRelease),
    sha256: latestRelease.sha256,
    size: latestRelease.fileSize,
    releaseId: String(latestRelease._id),
    releasedAt: latestRelease.releasedAt
  };
};

exports.recordUpdateStatus = async (payload) => {
  const update = await MonitorDeviceUpdate.findOneAndUpdate(
    { deviceId: payload.deviceId, releaseId: payload.releaseId || null },
    {
      $set: {
        deviceId: payload.deviceId,
        employeeId: payload.employeeId || null,
        hostname: payload.hostname || null,
        currentVersion: payload.fromVersion || payload.currentVersion || null,
        targetVersion: payload.toVersion || payload.targetVersion || null,
        releaseId: payload.releaseId || null,
        updateStatus: payload.status,
        lastUpdateCheckAt: payload.timestamp ? new Date(payload.timestamp) : new Date(),
        updateStartedAt: payload.status === "INSTALLING" ? new Date(payload.timestamp || Date.now()) : undefined,
        lastUpdatedAt: payload.status === "UPDATED" ? new Date(payload.timestamp || Date.now()) : undefined,
        lastErrorCode: payload.errorCode || null,
        lastErrorMessage: payload.errorMessage || null
      },
      $inc: payload.status === "FAILED" ? { failureCount: 1 } : { failureCount: 0 }
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  return update;
};

function signR2Url({
  accountId,
  accessKeyId,
  secretAccessKey,
  bucket,
  objectKey,
  expiresInSeconds = 900,
  method = "GET"
}) {
  const host = `${bucket}.${accountId}.r2.cloudflarestorage.com`;
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  const credentialScope = `${dateStamp}/auto/s3/aws4_request`;
  const algorithm = "AWS4-HMAC-SHA256";
  const credential = `${accessKeyId}/${credentialScope}`;
  const canonicalUri = `/${objectKey.split("/").map(encodeURIComponent).join("/")}`;
  const canonicalQueryString = [
    `X-Amz-Algorithm=${encodeURIComponent(algorithm)}`,
    `X-Amz-Credential=${encodeURIComponent(credential)}`,
    `X-Amz-Date=${encodeURIComponent(amzDate)}`,
    `X-Amz-Expires=${expiresInSeconds}`,
    `X-Amz-SignedHeaders=host`
  ].join("&");
  const canonicalHeaders = `host:${host}\n`;
  const signedHeaders = "host";
  const payloadHash = "UNSIGNED-PAYLOAD";
  const canonicalRequest = [
    method,
    canonicalUri,
    canonicalQueryString,
    canonicalHeaders,
    signedHeaders,
    payloadHash
  ].join("\n");
  const stringToSign = [
    algorithm,
    amzDate,
    credentialScope,
    crypto.createHash("sha256").update(canonicalRequest).digest("hex")
  ].join("\n");
  const hmac = (key, data, encoding) => crypto.createHmac("sha256", key).update(data).digest(encoding);
  const kDate = hmac(`AWS4${secretAccessKey}`, dateStamp);
  const kRegion = hmac(kDate, "auto");
  const kService = hmac(kRegion, "s3");
  const kSigning = hmac(kService, "aws4_request");
  const signature = hmac(kSigning, stringToSign, "hex");
  return `https://${host}/${objectKey}?${canonicalQueryString}&X-Amz-Signature=${signature}`;
}

function putBufferToSignedUrl(url, buffer) {
  return new Promise((resolve, reject) => {
    const request = https.request(url, { method: "PUT", headers: { "Content-Length": buffer.length } }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        if (response.statusCode && response.statusCode >= 200 && response.statusCode < 300) {
          resolve(Buffer.concat(chunks).toString("utf8"));
          return;
        }
        reject(new Error(`R2 upload failed with status ${response.statusCode}`));
      });
    });
    request.on("error", reject);
    request.write(buffer);
    request.end();
  });
}

exports.createRelease = async (payload) => {
  const fileBuffer = payload.fileBase64 ? Buffer.from(String(payload.fileBase64).split(",").pop(), "base64") : null;
  if (!fileBuffer || !fileBuffer.length) {
    throw Object.assign(new Error("fileBase64 is required"), { code: 400 });
  }

  const version = String(payload.version || "").trim();
  if (!version) {
    throw Object.assign(new Error("version is required"), { code: 400 });
  }

  const build = ensurePositiveInt(payload.build, null);
  if (build === null) {
    throw Object.assign(new Error("build is required"), { code: 400 });
  }

  const bucket = String(process.env.R2_BUCKET_NAME || "rigweda-monitor-updates").trim();
  const accountId = String(process.env.CLOUDFLARE_ACCOUNT_ID || "").trim();
  const accessKeyId = String(process.env.R2_ACCESS_KEY_ID || "").trim();
  const secretAccessKey = String(process.env.R2_SECRET_ACCESS_KEY || "").trim();
  const useR2 = Boolean(bucket && accountId && accessKeyId && secretAccessKey);
  const fileSize = fileBuffer.length;
  const sha = sha256(fileBuffer);
  const objectKey = `stable/${version}/RigwedaMonitor-${version}.exe`;

  let signedDownloadUrl = "";
  if (useR2) {
    const uploadUrl = signR2Url({
      accountId,
      accessKeyId,
      secretAccessKey,
      bucket,
      objectKey,
      expiresInSeconds: ensurePositiveInt(process.env.MONITOR_UPDATE_URL_EXPIRES_SECONDS, 900),
      method: "PUT"
    });
    await putBufferToSignedUrl(uploadUrl, fileBuffer);
    signedDownloadUrl = signR2Url({
      accountId,
      accessKeyId,
      secretAccessKey,
      bucket,
      objectKey,
      expiresInSeconds: ensurePositiveInt(process.env.MONITOR_UPDATE_URL_EXPIRES_SECONDS, 900)
    });
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "rigweda-release-"));
  const tempFile = path.join(tempDir, `RigwedaMonitor-${version}.exe`);
  fs.writeFileSync(tempFile, fileBuffer);

  const release = await MonitorRelease.create({
    version,
    build,
    channel: payload.channel || "stable",
    r2ObjectKey: objectKey,
    sha256: payload.sha256 || sha,
    fileSize,
    mandatory: Boolean(payload.mandatory),
    status: payload.status || "draft",
    rolloutPercentage: ensurePositiveInt(payload.rolloutPercentage, 100),
    minimumSupportedVersion: payload.minimumSupportedVersion || "0.0.0",
    releasedAt:
      payload.releasedAt
        ? new Date(payload.releasedAt)
        : ["testing", "active"].includes(String(payload.status || "draft")) ? new Date() : null,
    signedDownloadUrl
  });

  fs.rmSync(tempDir, { recursive: true, force: true });
  return release.toObject();
};

exports.activateRelease = async ({ releaseId, status, rolloutPercentage }) => {
  const update = {};
  if (status) update.status = status;
  if (typeof rolloutPercentage !== "undefined") update.rolloutPercentage = ensurePositiveInt(rolloutPercentage, 100);
  if (["testing", "active"].includes(status) && !update.releasedAt) update.releasedAt = new Date();
  return MonitorRelease.findByIdAndUpdate(releaseId, { $set: update }, { new: true }).lean();
};
