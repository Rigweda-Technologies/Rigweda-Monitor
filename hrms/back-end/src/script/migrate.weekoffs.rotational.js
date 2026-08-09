require("dotenv").config();

const mongoose = require("mongoose");

const COLLECTION_NAME = "week_off";
const NEW_INDEX_NAME = "organizationId_1_shiftId_1";

const toKeyPart = (value) => {
  if (!value) return "default";
  return String(value);
};

const normalizeShiftId = (value) => {
  if (!value) return null;
  return value;
};

const isOldOrgUniqueIndex = (idx) => {
  if (!idx || !idx.unique || !idx.key) return false;
  const keys = Object.keys(idx.key);
  return keys.length === 1 && keys[0] === "organizationId" && idx.key.organizationId === 1;
};

(async () => {
  try {
    if (!process.env.MONGO_URI) {
      throw new Error("MONGO_URI not found in environment variables");
    }

    await mongoose.connect(process.env.MONGO_URI);
    console.log("✅ MongoDB connected");

    const collection = mongoose.connection.collection(COLLECTION_NAME);

    // 1) Ensure old docs have explicit shiftId field (default config = null)
    const normalizeRes = await collection.updateMany(
      { shiftId: { $exists: false } },
      { $set: { shiftId: null } }
    );
    console.log(`ℹ️ Normalized shiftId on ${normalizeRes.modifiedCount || 0} records`);

    // 2) De-duplicate org+shift configs if any, keep newest record
    const all = await collection.find({}).sort({ updatedAt: -1, createdAt: -1, _id: -1 }).toArray();
    const seen = new Set();
    const duplicateIds = [];

    for (const doc of all) {
      const key = `${toKeyPart(doc.organizationId)}::${toKeyPart(normalizeShiftId(doc.shiftId))}`;
      if (seen.has(key)) {
        duplicateIds.push(doc._id);
      } else {
        seen.add(key);
      }
    }

    if (duplicateIds.length > 0) {
      const deleteRes = await collection.deleteMany({ _id: { $in: duplicateIds } });
      console.log(`ℹ️ Removed ${deleteRes.deletedCount || 0} duplicate week off records`);
    } else {
      console.log("ℹ️ No duplicate week off records found");
    }

    // 3) Drop old unique index on organizationId (if present)
    const indexes = await collection.indexes();
    for (const idx of indexes) {
      if (isOldOrgUniqueIndex(idx)) {
        await collection.dropIndex(idx.name);
        console.log(`ℹ️ Dropped old index: ${idx.name}`);
      }
    }

    // 4) Create new unique index for rotational configs
    await collection.createIndex(
      { organizationId: 1, shiftId: 1 },
      { unique: true, name: NEW_INDEX_NAME }
    );
    console.log(`✅ Ensured index: ${NEW_INDEX_NAME}`);

    console.log("🎉 Week off rotational migration completed");
    process.exit(0);
  } catch (err) {
    console.error("❌ Migration failed:", err);
    process.exit(1);
  }
})();
