import Fastify from "fastify";

const fastify = Fastify({
  logger: true,
});

fastify.get("/health", async () => {
  return {
    ok: true,
    service: "rigweda-monitor-backend",
    timestamp: new Date().toISOString(),
  };
});

fastify.post("/echo", async (request, reply) => {
  const body = request.body ?? {};

  return reply.code(200).send({
    received: body,
  });
});

fastify.setNotFoundHandler(async (request, reply) => {
  return reply.code(404).send({
    error: "Not Found",
    path: request.url,
  });
});

const start = async () => {
  const port = Number(process.env.PORT || 3000);
  const host = process.env.HOST || "0.0.0.0";

  try {
    await fastify.listen({ port, host });
    fastify.log.info(`Server listening on http://${host}:${port}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
