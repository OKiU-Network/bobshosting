#!/usr/bin/env node

import { Command } from 'commander'

function getApiBaseUrl(): string {
  return process.env.API_BASE_URL ?? 'http://localhost:4000'
}

function getAccessToken(): string {
  const token = process.env.API_TOKEN
  if (!token) throw new Error('API_TOKEN is required')
  return token
}

async function request(input: { path: string; method?: 'GET' | 'POST'; body?: unknown }) {
  const response = await fetch(`${getApiBaseUrl()}${input.path}`, {
    method: input.method ?? 'GET',
    headers: {
      'content-type': 'application/json',
      Authorization: `Bearer ${getAccessToken()}`
    },
    body: input.body ? JSON.stringify(input.body) : undefined
  })
  return response.json()
}

async function main() {
  const program = new Command()
  program.name('wave-cli').description('Wave hosting operator CLI')

  program
    .command('servers:list')
    .action(async () => console.log(JSON.stringify(await request({ path: '/v1/servers' }), null, 2)))

  program
    .command('servers:create')
    .requiredOption('--name <name>')
    .requiredOption('--template <templateId>')
    .action(async options =>
      console.log(
        JSON.stringify(
          await request({
            path: '/v1/servers',
            method: 'POST',
            body: { serverName: options.name, templateId: options.template }
          }),
          null,
          2
        )
      )
    )

  program
    .command('servers:power')
    .requiredOption('--id <serverId>')
    .requiredOption('--action <action>')
    .action(async options =>
      console.log(
        JSON.stringify(
          await request({
            path: `/v1/servers/${options.id}/power`,
            method: 'POST',
            body: { action: options.action }
          }),
          null,
          2
        )
      )
    )

  await program.parseAsync(process.argv)
}

main().catch(error => {
  console.error(error.message)
  process.exit(1)
})
