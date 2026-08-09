const mongoose = require("mongoose");

const ensureCriticalIndexes = async () => {
  const modelLoaders = [
    () => require("../modules/employees/employee.model"),
    () => require("../modules/timesheets/timesheetAttendance.model"),
    () => require("../modules/leaves/leave.model"),
    () => require("../modules/timesheets/timesheet.model"),
    () => require("../modules/notifications/notification.model"),
    () => require("../modules/holidays/holiday.model")
  ];

  const models = modelLoaders.map((load) => load());
  const results = await Promise.allSettled(
    models.map((model) => model.createIndexes())
  );

  const failed = results
    .map((result, index) => ({ result, modelName: models[index]?.modelName || `model_${index}` }))
    .filter((item) => item.result.status === "rejected");

  if (failed.length) {
    let hardFailure = false;
    failed.forEach((item) => {
      const message = String(item.result.reason?.message || item.result.reason || "");
      const isDuplicateKeyBuildError = message.includes("E11000 duplicate key error");
      if (isDuplicateKeyBuildError) {
        console.warn(`⚠️ Index ensure skipped for ${item.modelName} due to duplicate legacy data: ${message}`);
      } else {
        hardFailure = true;
        console.error(`❌ Index ensure failed for ${item.modelName}:`, message);
      }
    });
    if (hardFailure) {
      throw new Error("One or more critical index creations failed");
    }
  }

  console.log(`✅ Critical Mongo indexes ensured for ${models.length} models`);
};

const connectDB = async () => {
  try {
    const mongoUri = process.env.MONGO_URI;

    if (!mongoUri) {
      throw new Error("MONGO_URI not defined in environment variables");
    }

    mongoose.set("strictQuery", true);

    const maxPoolSize = Number(process.env.MONGO_MAX_POOL_SIZE || 100);
    const minPoolSize = Number(process.env.MONGO_MIN_POOL_SIZE || 10);
    const serverSelectionTimeoutMS = Number(
      process.env.MONGO_SERVER_SELECTION_TIMEOUT_MS || 10000
    );
    const socketTimeoutMS = Number(process.env.MONGO_SOCKET_TIMEOUT_MS || 45000);

    await mongoose.connect(mongoUri, {
      maxPoolSize,
      minPoolSize,
      serverSelectionTimeoutMS,
      socketTimeoutMS,
      autoIndex: process.env.NODE_ENV !== "production"
    });

    console.log("✅ MongoDB connected");

    const shouldEnsureIndexes = String(process.env.MONGO_ENSURE_INDEXES_ON_BOOT || "true")
      .toLowerCase() !== "false";
    if (shouldEnsureIndexes) {
      await ensureCriticalIndexes();
    }
  } catch (err) {
    console.error("❌ MongoDB connection failed");
    console.error(err);
    process.exit(1);
  }
};

module.exports = connectDB;
