import assert from 'node:assert/strict'
import { once } from 'node:events'
import { createServer as createTcpServer } from 'node:net'
import test from 'node:test'
import { setTimeout } from 'node:timers/promises'

import { fetch, setGlobalDispatcher, Agent } from 'secret-stream-http'
import { uint8ArrayToHex } from 'uint8array-extras'

import { createTestServer, listen } from './helpers.js'

test('can fetch from a secret-stream server', async (t) => {
	const server = await createTestServer(t, [
		['/hello', () => new Response('Hello, World!')],
	])

	const port = await listen(server)

	const response = await fetch(`http://127.0.0.1:${port}/hello`)
	assert.equal(response.status, 200)
	assert.equal(await response.text(), 'Hello, World!')
})

test('sequential fetches work correctly', async (t) => {
	let requestCount = 0
	let responseCount = 0
	const server = await createTestServer(t, [
		['/count', () => new Response(`Request ${++requestCount}`)],
	])

	const port = await listen(server)

	while (++responseCount <= 3) {
		const response = await fetch(`http://127.0.0.1:${port}/count`)
		assert.equal(response.status, 200)
		assert.equal(await response.text(), `Request ${responseCount}`)
	}
	assert.equal(requestCount, 3, 'Server received 3 requests')
})

test('parallel fetches work correctly', async (t) => {
	const server = await createTestServer(t, [
		[
			'/parallel',
			async (req) => {
				const url = new URL(req.url)
				await setTimeout(100) // delay to ensure parallelism
				const id = url.searchParams.get('id')
				if (!id) {
					throw new Error('Missing id parameter')
				}
				return +id
			},
		],
	])

	const port = await listen(server)

	const results = await Promise.all([
		fetch(`http://127.0.0.1:${port}/parallel?id=1`),
		fetch(`http://127.0.0.1:${port}/parallel?id=2`),
		fetch(`http://127.0.0.1:${port}/parallel?id=3`),
		fetch(`http://127.0.0.1:${port}/parallel?id=4`),
		fetch(`http://127.0.0.1:${port}/parallel?id=5`),
	])

	assert.equal(results.length, 5)
	for (let i = 0; i < results.length; i++) {
		assert.equal(results[i].status, 200)
		assert.equal(await results[i].json(), i + 1)
	}
})

test('keypair consistency - client uses same keypair across requests (default global dispatcher)', async (t) => {
	/** @type {string[]} */
	const clientPublicKeys = []

	const server = await createTestServer(t, [
		[
			'/pubkey',
			(req, context) => {
				const socket = context.req.socket
				const pubKey = socket.remotePublicKey?.toString('hex') || 'no-key'
				clientPublicKeys.push(pubKey)
			},
		],
	])

	const port = await listen(server)

	for (let i = 0; i < 100; i++) {
		await fetch(`http://127.0.0.1:${port}/pubkey`)
	}

	// All requests should use the same client keypair
	const uniqueKeys = new Set(clientPublicKeys)
	assert.equal(clientPublicKeys.length, 100, '100 requests were made')
	assert.equal(
		uniqueKeys.size,
		1,
		'Client should use the same keypair for all requests',
	)
})

test('can pass a custom agent per-fetch with custom keyPair', async (t) => {
	const keyPair1 = Agent.keyPair()
	const keyPair2 = Agent.keyPair()
	const agent1 = new Agent({ keyPair: keyPair1 })
	const agent2 = new Agent({ keyPair: keyPair2 })

	/** @type {string[]} */
	const clientPublicKeys = []

	const server = await createTestServer(t, [
		[
			'/pubkey',
			(req, context) => {
				const socket = context.req.socket
				const pubKey = socket.remotePublicKey?.toString('hex') || 'no-key'
				clientPublicKeys.push(pubKey)
			},
		],
	])

	const port = await listen(server)

	await fetch(`http://127.0.0.1:${port}/pubkey`, { dispatcher: agent1 })
	await fetch(`http://127.0.0.1:${port}/pubkey`, { dispatcher: agent2 })

	assert.deepEqual(
		clientPublicKeys,
		[uint8ArrayToHex(keyPair1.publicKey), uint8ArrayToHex(keyPair2.publicKey)],
		'Each fetch should use the correct client public key from its agent',
	)
})

test('can pass a remotePublicKey to the agent to verify server identity', async (t) => {
	const server = await createTestServer(t, [
		['/identity', () => new Response('Verified')],
	])

	const otherServer = await createTestServer(t, [
		['/identity', () => new Response('Verified')],
	])

	const port1 = await listen(server)
	const port2 = await listen(otherServer)

	const agent = new Agent({
		remotePublicKey: server.publicKey,
	})

	const response = await fetch(`http://127.0.0.1:${port1}/identity`, {
		dispatcher: agent,
	})
	assert.equal(response.status, 200)
	assert.equal(await response.text(), 'Verified')
	// Now try to connect to the other server with a different public key
	await assert.rejects(
		async () => {
			await fetch(`http://127.0.0.1:${port2}/identity`, {
				dispatcher: agent,
			})
		},
		(err) =>
			// @ts-expect-error
			err.cause.message === 'Remote public key does not match expected key',
		'Should reject connection to server with unexpected public key',
	)
})

test('Keys can be Uint8Arrays', async (t) => {
	const keyPair = Agent.keyPair()
	const keyPairAsUint8 = {
		publicKey: new Uint8Array(keyPair.publicKey),
		secretKey: new Uint8Array(keyPair.secretKey),
	}
	const server = await createTestServer(
		t,
		[['/identity', () => new Response('Verified')]],
		{ keyPair: keyPairAsUint8 },
	)

	const otherServer = await createTestServer(t, [
		['/identity', () => new Response('Verified')],
	])

	const port1 = await listen(server)
	const port2 = await listen(otherServer)

	const agent = new Agent({
		remotePublicKey: keyPairAsUint8.publicKey,
	})

	const response = await fetch(`http://127.0.0.1:${port1}/identity`, {
		dispatcher: agent,
	})
	assert.equal(response.status, 200)
	assert.equal(await response.text(), 'Verified')
	// Now try to connect to the other server with a different public key
	await assert.rejects(
		async () => {
			await fetch(`http://127.0.0.1:${port2}/identity`, {
				dispatcher: agent,
			})
		},
		(err) =>
			// @ts-expect-error
			err.cause.message === 'Remote public key does not match expected key',
		'Should reject connection to server with unexpected public key',
	)
})

test('can set a custom global dispatcher with a custom keyPair', async (t) => {
	const keyPair = Agent.keyPair()
	const agent = new Agent({ keyPair })
	setGlobalDispatcher(agent)
	const clientPublicKeys = new Set()

	const server = await createTestServer(t, [
		[
			'/pubkey',
			(req, context) => {
				const socket = context.req.socket
				clientPublicKeys.add(
					socket.remotePublicKey?.toString('hex') || 'no-key',
				)
			},
		],
	])

	const port = await listen(server)
	for (let i = 0; i < 10; i++) {
		await fetch(`http://127.0.0.1:${port}/pubkey`)
	}

	assert.equal(
		clientPublicKeys.size,
		1,
		'All requests should use the same client public key from the global agent',
	)
	assert.equal(
		clientPublicKeys.has(uint8ArrayToHex(keyPair.publicKey)),
		true,
		"Client public key should match the custom keyPair's public key",
	)
})

test('throws on disconnect during handshake', async () => {
	const server = createTcpServer((socket) => {
		socket.destroy()
	})
	const port = await listen(server)

	await assert.rejects(async () => {
		await fetch(`http://127.0.0.1:${port}/`)
	}, 'Should reject connection to non-secret-stream server')

	server.close()
	await once(server, 'close')
})
