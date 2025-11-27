import { once } from 'node:events'
import { createServer as createHttpServer } from 'node:http'

import { createServerAdapter } from '@whatwg-node/server'
import { AutoRouter } from 'itty-router'

import { createServer } from '../src/server.js'

/** @import { IRequest, RequestHandler } from 'itty-router' */
/** @typedef {RequestHandler<IRequest, [{ req: Omit<import('node:http').IncomingMessage, 'socket'> & { socket: import('../src/secret-stream-socket.js').SecretStreamSocket } }]>} NodeRequestHandler */

/**
 * @param {import('node:test').TestContext} t
 * @param {[string, NodeRequestHandler, ...NodeRequestHandler[]][]} routes
 */
export async function createTestServer(t, routes) {
	const router = AutoRouter()
	const sockets = new Set()

	for (const [path, ...handlers] of routes) {
		router.get(path, ...handlers)
	}

	const httpServer = createHttpServer(
		{
			keepAliveTimeout: 0,
		},
		createServerAdapter(router.fetch),
	)
	const secretStreamServer = createServer(httpServer)

	secretStreamServer.on('connection', (socket) => {
		sockets.add(socket)
		socket.on('close', () => {
			sockets.delete(socket)
		})
	})

	t.after(async () => {
		httpServer.closeAllConnections()
		for (const socket of sockets) {
			socket.destroy()
		}

		return /** @type {Promise<void>} */ (
			new Promise((resolve, reject) => {
				secretStreamServer.close((err) => {
					if (err) reject(err)
					else resolve()
				})
			})
		)
	})

	return secretStreamServer
}

/**
 * @param {import("node:net").Server} server
 * @param {number} [port]
 * @return {Promise<number>}
 */
export async function listen(server, port = 0) {
	server.listen(port, '127.0.0.1')
	await once(server, 'listening')
	// @ts-expect-error
	return server.address().port
}
