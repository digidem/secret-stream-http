import { StreamxAsNodeDuplex } from './streamx-as-node-duplex.js'

/** @import {Socket} from 'node:net' */
/** @import SecretStream from '@hyperswarm/secret-stream' */

const EXPOSED_SECRET_STREAM_PROPS = /** @type {const} */ ([
	'publicKey',
	'remotePublicKey',
	'handshakeHash',
])

const DELEGATED_CHAINABLE_SOCKET_METHODS =
	/** @type {const} @satisfies {Array<Exclude<NonNullable<{ [K in keyof Socket]: Socket[K] extends (...args: any[]) => Socket ? K : never }[keyof Socket]>, keyof import('stream').Duplex>>} */ ([
		'setTimeout',
		'resetAndDestroy',
		'setNoDelay',
		'setKeepAlive',
		'ref',
		'unref',
	])

const DELEGATED_PROPS = /** @type {const} @satisfies {Array<keyof Socket>} */ ([
	'bytesRead',
	'bytesWritten',
])

/**
 * @typedef {SecretStreamSocketImpl &
 *   Pick<SecretStream, typeof EXPOSED_SECRET_STREAM_PROPS[number]> &
 *   Pick<Socket, typeof DELEGATED_PROPS[number]> &
 *   Pick<Socket, typeof DELEGATED_CHAINABLE_SOCKET_METHODS[number]>
 * } SecretStreamSocket
 */

/**
 * A compatibility layer for SecretStream to work like a standard Node Socket.
 * Requires SecretStream running over a socket, because it delegates to the
 * underlying socket.
 *
 * SecretStream does implement a `setKeepAlive` and `setTimeout`, but these
 * operate at a stream layer, vs. the Node Socket versions of these methods
 * which operate at the TCP layer. When used with a node server and for http
 * requests, it's the TCP layer that we want to use for timeout and keepAlive.
 *
 * @extends {StreamxAsNodeDuplex<SecretStream<Socket>>}
 * @implements {SecretStreamSocket}
 */
// @ts-expect-error - Properties are dynamically added via Object.definedProperty
export class SecretStreamSocketImpl extends StreamxAsNodeDuplex {
	/**
	 * @param {SecretStream<Socket>} secretStream
	 * @param {import('stream').DuplexOptions} [opts]
	 */
	constructor(secretStream, opts) {
		super(secretStream, opts)

		for (const prop of EXPOSED_SECRET_STREAM_PROPS) {
			Object.defineProperty(this, prop, {
				get: () => this.streamx[prop],
			})
		}

		for (const method of DELEGATED_CHAINABLE_SOCKET_METHODS) {
			Object.defineProperty(this, method, {
				/** @param {any[]} args */
				value: (...args) => {
					// @ts-expect-error - Dynamic method delegation with varying signatures
					this.streamx.rawStream[method](...args)
					return this
				},
				writable: true,
				configurable: true,
				enumerable: false,
			})
		}

		for (const prop of DELEGATED_PROPS) {
			Object.defineProperty(this, prop, {
				get: () => this.streamx.rawStream[prop],
			})
		}
	}

	get connecting() {
		return this.streamx.rawStream && !this.streamx.handshakeHash
	}

	get pending() {
		return !this.streamx.rawStream
	}

	get readyState() {
		if (this.connecting) return 'opening'
		return 'open'
	}

	/** @type {Socket['destroySoon']} */
	destroySoon() {
		this.streamx.rawStream.destroySoon()
	}
}

export const SecretStreamSocket =
	/** @type {new (secretStream: SecretStream<import('node:net').Socket>, opts?: import('stream').DuplexOptions) => SecretStreamSocket} */ (
		/** @type {unknown} */
		(SecretStreamSocketImpl)
	)
