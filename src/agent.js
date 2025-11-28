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

const kSecretStreamAgent = Symbol.for('secret-stream-agent')

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

	/**
	 * @param {any} instance
	 * @override
	 */
	static [Symbol.hasInstance](instance) {
		return instance && instance[kSecretStreamAgent] === true
	}

	[kSecretStreamAgent]() {
		return true
	}

	/** @type {import('undici').buildConnector.connector} */
	#connect({ hostname, port }, callback) {
		const socket = connect({ host: hostname, port: port ? +port : 80 }, () => {
			const secretStream = new SecretStream(true, socket, {
				keyPair: this.#keyPair,
			})
			const secretSocket = new SecretStreamSocket(secretStream)

			/** @param {Error} err */
			const onError = (err) => {
				console.error(err)
				secretStream.removeListener('open', onOpen)
				callback(err, null)
			}

			const onOpen = () => {
				secretStream.removeListener('error', onError)
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
			secretStream.once('open', onOpen)
		})
	}
}
