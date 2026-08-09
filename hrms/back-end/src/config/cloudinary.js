const { v2: cloudinary } = require("cloudinary");

let configured = false;

const getCredentials = () => ({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

const hasCloudinaryCredentials = () => {
  const creds = getCredentials();
  return Boolean(creds.cloud_name && creds.api_key && creds.api_secret);
};

const ensureCloudinaryConfigured = () => {
  if (!hasCloudinaryCredentials()) {
    throw new Error("Cloudinary credentials are missing. Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET.");
  }

  if (configured) return;
  cloudinary.config({
    secure: true,
    ...getCredentials()
  });
  configured = true;
};

const uploadDataUri = async (dataUri, options = {}) => {
  ensureCloudinaryConfigured();
  return cloudinary.uploader.upload(dataUri, {
    resource_type: "auto",
    ...options
  });
};

const buildAuthenticatedUrl = (publicId, options = {}) => {
  ensureCloudinaryConfigured();
  const expiresAt = Math.floor(Date.now() / 1000) + Number(options.expiresInSeconds || 600);
  return cloudinary.url(publicId, {
    resource_type: options.resourceType || "auto",
    type: "authenticated",
    secure: true,
    sign_url: true,
    expires_at: expiresAt,
    flags: options.flags
  });
};

const deleteAsset = async (publicId, options = {}) => {
  ensureCloudinaryConfigured();
  return cloudinary.uploader.destroy(publicId, {
    resource_type: options.resourceType || "auto",
    type: options.type || "authenticated"
  });
};

module.exports = {
  hasCloudinaryCredentials,
  ensureCloudinaryConfigured,
  uploadDataUri,
  buildAuthenticatedUrl,
  deleteAsset
};
