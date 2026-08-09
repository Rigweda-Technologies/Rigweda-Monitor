const IORedis = require("ioredis");
const { Queue } = require("bullmq");
const { JOB_QUEUE_NAME } = require("./queue.constants");

let connection;
let queue;

const getQueueConnection = () => {
  if (connection) {
    return connection;
  }

  if (!process.env.REDIS_URL) {
    throw new Error("REDIS_URL is required for BullMQ job queue");
  }

  connection = new IORedis(process.env.REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    connectTimeout: Number(process.env.REDIS_CONNECT_TIMEOUT_MS || 10000)
  });

  connection.on("error", (error) => {
    console.error("❌ BullMQ Redis error:", error?.message || error);
  });

  return connection;
};

const getJobQueue = () => {
  if (queue) {
    return queue;
  }

  queue = new Queue(JOB_QUEUE_NAME, {
    connection: getQueueConnection(),
    defaultJobOptions: {
      removeOnComplete: 500,
      removeOnFail: 1000
    }
  });

  return queue;
};

module.exports = {
  getQueueConnection,
  getJobQueue
};
