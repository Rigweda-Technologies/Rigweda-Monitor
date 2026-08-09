const mongoose = require("mongoose");

const holidaySchema = new mongoose.Schema(
  {
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "organizations",
      required: true,
      index: true
    },

    name: {
      type: String,
      required: true,
      trim: true
    },

    date: {
      type: Date,
      required: true
    },

    year: {
      type: Number,
      required: true,
      index: true
    },

    status: {
      type: String,
      enum: ["active", "inactive"],
      default: "active"
    },

    isDeleted: {
      type: Boolean,
      default: false
    }
  },
  { timestamps: true }
);

holidaySchema.index(
  { organizationId: 1, date: 1, year: 1},
  { unique: true }
);

holidaySchema.pre(/^find/, function () {
  this.where({ isDeleted: false });
});

module.exports = mongoose.model("holidays", holidaySchema);
