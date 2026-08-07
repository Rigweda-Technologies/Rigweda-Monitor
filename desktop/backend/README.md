# Rigweda Monitor Backend

Minimal Fastify API sample.

## Endpoints

- `GET /health`
- `POST /echo`

## Run

```bash
npm install
npm run dev
```

## Example

```bash
curl http://localhost:3000/health
curl -X POST http://localhost:3000/echo \
  -H "content-type: application/json" \
  -d '{"message":"hello"}'
```
