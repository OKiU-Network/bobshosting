import 'dotenv/config'
import Fastify from 'fastify'
import cors from '@fastify/cors'
import jwt from '@fastify/jwt'
import { v1Routes } from './routes/v1.js'

async function buildServer() {
  const app = Fastify({ logger: true })

  await app.register(cors, { origin: true })
  await app.register(jwt, { secret: process.env.JWT_SECRET ?? 'change-me' })
  await app.register(v1Routes)

  return app
}

async function startServer() {
  const app = await buildServer()
  const port = Number(process.env.API_PORT ?? 4000)
  const host = process.env.API_HOST ?? '0.0.0.0'
  await app.listen({ port, host })
}

startServer().catch(error => {
  console.error(error)
  process.exit(1)
})
