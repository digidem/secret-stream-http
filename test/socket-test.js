import assert from 'node:assert/strict'
import { createServer as createHttpServer } from 'node:http'
import test from 'node:test'

import { fetch } from 'secret-stream-http'

import { createServer } from '../src/server.js'
import { listen } from './helpers.js'

test('check req.socket has expected properties', async (t) => {
	const httpServer = createHttpServer((req, res) => {
		const socket =
			/** @type {import("../src/secret-stream-socket.js").SecretStreamSocket} */ (
				/** @type {unknown} */
				(req.socket)
			)
		const remotePublicKey = socket.remotePublicKey?.toString('hex')
		const localPublicKey = socket.publicKey?.toString('hex')
		const handshakeHash = socket.handshakeHash?.toString('hex')
		res.writeHead(200, { 'Content-Type': 'application/json' })
		res.end(JSON.stringify({ remotePublicKey, localPublicKey, handshakeHash }))
	})
	const secretStreamServer = createServer(httpServer)
	const sockets = new Set()
	secretStreamServer.on('connection', (socket) => {
		sockets.add(socket)
		socket.on('close', () => {
			sockets.delete(socket)
		})
	})

	t.after(() => {
		sockets.forEach((socket) => socket.destroy())
		httpServer.close()
		secretStreamServer.close()
	})

	const port = await listen(secretStreamServer)
	const response = await fetch(`http://localhost:${port}/check`)
	assert.equal(response.status, 200, 'Response status is 200')
	/** @type {any} */
	const data = await response.json()
	assert.ok(data.remotePublicKey, 'remotePublicKey is present')
	assert.ok(data.localPublicKey, 'localPublicKey is present')
	assert.ok(data.handshakeHash, 'handshakeHash is present')
})
