const requiredEnv = ["JWT_ACCESS_SECRET", "RIGWEDA_API_BASE_URL", "CLOUDINARY_CLOUD_NAME", "CLOUDINARY_API_KEY", "CLOUDINARY_API_SECRET"];

export const validateEnv = () => {
  const missing = requiredEnv.filter((key) => !String(process.env[key] || "").trim());

  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  }
};

export const getEnv = () => ({
  jwtAccessSecret: process.env.JWT_ACCESS_SECRET,
  rigwedaApiBaseUrl: String(process.env.RIGWEDA_API_BASE_URL || "").replace(/\/+$/, ""),
  cloudinaryCloudName: process.env.CLOUDINARY_CLOUD_NAME,
  cloudinaryApiKey: process.env.CLOUDINARY_API_KEY,
  cloudinaryApiSecret: process.env.CLOUDINARY_API_SECRET,
  port: Number(process.env.PORT || 3000),
  host: process.env.HOST || "0.0.0.0",
});
