import { connect } from 'node:net'

import SecretStream from '@hyperswarm/secret-stream'
import { Agent as UndiciAgent } from 'undici'

import { SecretStreamSocket } from './secret-stream-socket.js'

/**
 * @typedef {object} KeyPair
 * @property {Buffer} publicKey
 * @property {Buffer} secretKey
 */

/**
 * @typedef {Omit<UndiciAgent.Options, 'connect'> & { keyPair?: KeyPair, remotePublicKey?: Buffer }} SecretStreamAgentOptions
 */

export class Agent extends UndiciAgent {
	#keyPair
	#remotePublicKey

	static keyPair = SecretStream.keyPair

	/**
	 * @param {SecretStreamAgentOptions} [options]
	 */
	constructor({
		keyPair = Agent.keyPair(),
		remotePublicKey,
		...agentOptions
	} = {}) {
		super({
			...agentOptions,
			connect: (options, callback) => this.#connect(options, callback),
		})
		this.#keyPair = keyPair
		this.#remotePublicKey = remotePublicKey
	}

	/** @type {import('undici').buildConnector.connector} */
	#connect({ hostname, port }, cb) {
		const callback = callbackOnce(cb)
		const socket = connect({ host: hostname, port: port ? +port : 80 }, () => {
			const secretStream = new SecretStream(true, socket, {
				keyPair: this.#keyPair,
			})
			const secretSocket = new SecretStreamSocket(secretStream)

			/** @param {Error} err */
			const onError = (err) => {
				secretStream.removeListener('open', onOpen)
				callback(err, null)
			}

			const onClose = () => {
				secretStream.removeListener('open', onOpen)
				callback(new Error('Socket closed before handshake completed'), null)
			}

			const onOpen = () => {
				secretStream.removeListener('error', onError)
				socket.removeListener('error', onError)
				secretSocket.removeListener('error', onError)
				socket.removeListener('close', onClose)
				if (!secretStream.remotePublicKey) {
					secretStream.destroy()
					callback(new Error('Remote public key is missing'), null)
				} else if (
					this.#remotePublicKey &&
					!this.#remotePublicKey.equals(secretStream.remotePublicKey)
				) {
					secretStream.destroy()
					callback(
						new Error('Remote public key does not match expected key'),
						null,
					)
				} else {
					// @ts-expect-error - not a socket, but close enough
					callback(null, secretSocket)
				}
			}

			secretStream.once('error', onError)
			socket.once('error', onError)
			secretSocket.once('error', onError)
			// If we close before open or error, treat as error
			socket.once('close', onClose)
			secretStream.once('open', onOpen)
		})
	}
}

/**
 * @template {(...args: any[]) => void} T
 * @param {T} callback
 * @returns {T} A wrapped version of the callback that only allows a single call
 */
function callbackOnce(callback) {
	let called = false
	// @ts-expect-error
	return function (...args) {
		if (called) return
		called = true
		callback(...args)
	}
}
