const screenshots = [];

export const screenshotModel = {
  async findAll() {
    return screenshots;
  },

  async create(record) {
    screenshots.push(record);
    return record;
  },
};
