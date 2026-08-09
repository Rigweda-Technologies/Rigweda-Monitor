const admin = require("firebase-admin");

let firebaseApp = null;

const sanitizePrivateKey = (value = "") => String(value).replace(/\\n/g, "\n").trim();

const resolveServiceAccount = () => {
  const rawJson = String(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || "").trim();
  if (rawJson) {
    const parsed = JSON.parse(rawJson);
    if (parsed.private_key) {
      parsed.private_key = sanitizePrivateKey(parsed.private_key);
    }
    return parsed;
  }

  const projectId = String(process.env.FIREBASE_PROJECT_ID || "").trim();
  const clientEmail = String(process.env.FIREBASE_CLIENT_EMAIL || "").trim();
  const privateKey = sanitizePrivateKey(process.env.FIREBASE_PRIVATE_KEY || "");

  if (!projectId || !clientEmail || !privateKey) {
    return null;
  }

  return {
    project_id: projectId,
    client_email: clientEmail,
    private_key: privateKey
  };
};

const isConfigured = () => Boolean(resolveServiceAccount());

const getFirebaseApp = () => {
  if (firebaseApp) return firebaseApp;

  const serviceAccount = resolveServiceAccount();
  if (!serviceAccount) {
    return null;
  }

  firebaseApp = admin.apps[0] || admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });

  return firebaseApp;
};

const toStringMap = (payload = {}) =>
  Object.fromEntries(
    Object.entries(payload)
      .filter(([, value]) => value !== undefined && value !== null)
      .map(([key, value]) => [key, typeof value === "string" ? value : JSON.stringify(value)])
  );

const sendPushNotification = async ({
  tokens = [],
  title,
  message,
  data = {}
}) => {
  const uniqueTokens = Array.from(
    new Set(tokens.map((token) => String(token || "").trim()).filter(Boolean))
  );

  if (!uniqueTokens.length) {
    return { skipped: true, reason: "no_tokens" };
  }

  if (!isConfigured()) {
    return { skipped: true, reason: "fcm_not_configured" };
  }

  const app = getFirebaseApp();
  if (!app) {
    return { skipped: true, reason: "fcm_not_initialized" };
  }

  const response = await admin.messaging(app).sendEachForMulticast({
    tokens: uniqueTokens,
    notification: {
      title: String(title || "").trim(),
      body: String(message || "").trim()
    },
    data: toStringMap(data),
    android: {
      priority: "high",
      notification: {
        channelId: process.env.FCM_ANDROID_CHANNEL_ID || "upanaya-notifications",
        sound: "default"
      }
    },
    apns: {
      payload: {
        aps: {
          sound: "default"
        }
      }
    }
  });

  const invalidTokens = [];
  response.responses.forEach((result, index) => {
    if (result.success) return;
    const code = result.error?.code;
    if (
      code === "messaging/registration-token-not-registered" ||
      code === "messaging/invalid-registration-token"
    ) {
      invalidTokens.push(uniqueTokens[index]);
    }
  });

  return {
    ok: response.successCount > 0,
    successCount: response.successCount,
    failureCount: response.failureCount,
    invalidTokens
  };
};

module.exports = {
  isConfigured,
  sendPushNotification
};
