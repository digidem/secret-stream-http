import { Duplex as NodeDuplex } from 'node:stream'

import { Duplex as StreamxDuplex } from 'streamx'

// The types for node:stream Duplex seem incorrect, they are missing the readable and writable options
/** @typedef {import('node:stream').DuplexOptions & { readable?: boolean, writable?: boolean }} DuplexOptions */

/**
 * A compatibility layer for a Streamx Duplex to work like a standard Node Duplex.
 *
 * @template {StreamxDuplex} [T=StreamxDuplex]
 */
export class StreamxAsNodeDuplex extends NodeDuplex {
	#streamx
	#isReading = false

	// Bound event listeners, so they can be removed on close
	/** @param {Error} err */
	#onStreamxError = (err) => this.destroy(err)
	#onStreamxClose = () => this.destroy()
	#onStreamxEnd = () => {
		if (this.readableEnded) return
		this.push(null)
	}
	/** @param {any} data */
	#onStreamxData = (data) => {
		if (!this.push(data)) {
			this.#streamx.pause()
		}
	}

	/**
	 * @param {T} streamxDuplex
	 * @param {DuplexOptions} [opts]
	 */
	constructor(streamxDuplex, opts) {
		super(opts)
		this.#streamx = streamxDuplex

		this.#streamx.on('error', this.#onStreamxError)
		this.#streamx.on('close', this.#onStreamxClose)
		this.#streamx.on('end', this.#onStreamxEnd)
		// "close" always fires, so we use it to cleanup listeners
		this.once('close', () => this.#removeEventListeners())
	}

	/** @returns {T} */
	get streamx() {
		return this.#streamx
	}

	#removeEventListeners() {
		this.#streamx.off('error', this.#onStreamxError)
		this.#streamx.off('close', this.#onStreamxClose)
		this.#streamx.off('end', this.#onStreamxEnd)
		this.#streamx.off('data', this.#onStreamxData)
	}

	/**
	 * @override
	 */
	_read() {
		if (!this.#isReading) {
			this.#isReading = true
			this.#streamx.on('data', this.#onStreamxData)
		}
		if (
			StreamxDuplex.isPaused(
				// @ts-expect-error - the streamx types are incorrect
				this.#streamx,
			)
		) {
			this.#streamx.resume()
		}
	}

	/**
	 * @override
	 * Override pause to also pause the underlying streamx stream.
	 * This ensures backpressure is properly communicated to streamx.
	 */
	pause() {
		const result = super.pause()
		if (
			this.#isReading &&
			!StreamxDuplex.isPaused(
				// @ts-expect-error - the streamx types are incorrect
				this.#streamx,
			)
		) {
			this.#streamx.pause()
		}
		return result
	}

	/**
	 * @override
	 * Override resume to also resume the underlying streamx stream
	 */
	resume() {
		const result = super.resume()
		// Only resume if we've started reading and streamx is currently paused
		if (
			this.#isReading &&
			StreamxDuplex.isPaused(
				// @ts-expect-error - the streamx types are incorrect
				this.#streamx,
			)
		) {
			this.#streamx.resume()
		}
		return result
	}

	/**
	 * @override
	 * @param {Buffer|string} chunk
	 * @param {string} encoding
	 * @param {() => void} callback
	 */
	_write(chunk, encoding, callback) {
		const canWrite = this.#streamx.write(chunk)
		if (canWrite) {
			process.nextTick(callback)
		} else {
			this.#streamx.once('drain', callback)
		}
	}

	/**
	 * @override
	 * @param {(error?: Error | null) => void} callback
	 */
	_final(callback) {
		// @ts-expect-error - streamx.ended is not in types
		if (this.#streamx.ended || this.#streamx.destroying) {
			return process.nextTick(callback)
		}

		// After calling streamx.end(), it could error and not finish, so we need to
		// attach listeners for both the 'finish' and 'error' events.
		let called = false
		const onFinish = () => {
			if (called) return
			called = true
			this.#streamx.off('error', onError)
			callback()
		}

		/** @param {Error} err */
		const onError = (err) => {
			if (called) return
			called = true
			this.#streamx.off('finish', onFinish)
			callback(err)
		}

		this.#streamx.once('finish', onFinish)
		this.#streamx.once('error', onError)
		this.#streamx.end()
	}

	/**
	 * @override
	 * @param {Error | null} err
	 * @param {(error?: Error | null) => void} callback
	 */
	_destroy(err, callback) {
		if (this.#streamx.destroyed) {
			return process.nextTick(callback, err)
		}
		// Ensure that any error from streamx being destroyed is propogated to the
		// callback here. This will also pass through the err passed to _destoy if
		// it is set.
		/** @param {Error} streamxError */
		const onError = (streamxError) => {
			err = streamxError
		}
		this.#streamx.on('error', onError)
		this.#streamx.once('close', () => {
			this.#streamx.off('error', onError)
			callback(err)
		})
		this.#streamx.destroy(err)
	}
}
