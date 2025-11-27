import { createServer as createTcpServer } from 'node:net'

import SecretStream from '@hyperswarm/secret-stream'

import { SecretStreamSocket } from './secret-stream-socket.js'

/**
 * Creates a TCP server that wraps incoming connections with an encrypted
 * SecretStream, and forwards them to the provided HTTP server.
 *
 * @param {import("node:http").Server} httpServer
 * @param {object} [options]
 * @param {import("./agent.js").KeyPair} [options.keyPair] Key pair to use for the server's SecretStream connections. If not provided, a new random key pair will be generated.
 * @return {import("node:net").Server & { publicKey: import("./agent.js").KeyPair["publicKey"] }} Returns the created TCP server. Listen on it to accept connections.
 */
export function createServer(
	httpServer,
	{ keyPair = SecretStream.keyPair() } = {},
) {
	const server = createTcpServer()
	server.on('connection', (socket) => {
		const secretStream = new SecretStream(false, socket, { keyPair })
		const secretSocket = new SecretStreamSocket(secretStream)
		httpServer.emit('connection', secretSocket)
	})
	Object.defineProperty(server, 'publicKey', {
		value: keyPair.publicKey,
		writable: false,
		enumerable: true,
		configurable: false,
	})
	// @ts-expect-error - augmenting server type
	return server
}
