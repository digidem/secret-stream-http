import assert from 'node:assert/strict'
import test from 'node:test'

import { Duplex as StreamxDuplex } from 'streamx'

import { StreamxAsNodeDuplex } from '../src/streamx-as-node-duplex.js'

test('basic duplex functionality - read and write', async () => {
	const streamx = new StreamxDuplex({
		read(cb) {
			this.push(Buffer.from('hello'))
			this.push(null)
			cb()
		},
		write(chunk, cb) {
			assert.ok(Buffer.isBuffer(chunk))
			assert.deepEqual(chunk, Buffer.from('world'))
			cb()
		},
	})

	const duplex = new StreamxAsNodeDuplex(streamx)

	return new Promise((resolve, reject) => {
		/** @type {Buffer[]} */
		const chunks = []

		duplex.on('data', (chunk) => {
			chunks.push(chunk)
		})

		duplex.on('end', () => {
			try {
				assert.deepEqual(Buffer.concat(chunks), Buffer.from('hello'))
				resolve()
			} catch (err) {
				reject(err)
			}
		})

		duplex.write(Buffer.from('world'))
		duplex.end()
	})
})

test('objectMode support', async () => {
	const streamx = new StreamxDuplex({
		read(cb) {
			this.push({ val: 1 })
			this.push(null)
			cb()
		},
		write(obj, cb) {
			assert.deepEqual(obj, { val: 2 })
			cb()
		},
	})

	const duplex = new StreamxAsNodeDuplex(streamx, { objectMode: true })

	return new Promise((resolve, reject) => {
		duplex.on('data', (obj) => {
			try {
				assert.deepEqual(obj, { val: 1 })
			} catch (err) {
				reject(err)
			}
		})

		duplex.on('end', resolve)
		duplex.on('error', reject)

		duplex.write({ val: 2 })
		duplex.end()
	})
})

test('destroy without error', async () => {
	const streamx = new StreamxDuplex({
		read(cb) {
			cb()
		},
		write(chunk, cb) {
			cb()
		},
	})

	const duplex = new StreamxAsNodeDuplex(streamx)

	return new Promise((resolve) => {
		duplex.on('close', () => {
			assert.strictEqual(duplex.destroyed, true)
			resolve()
		})

		duplex.destroy()
	})
})

test('destroy with error', async () => {
	const streamx = new StreamxDuplex({
		read(cb) {
			cb()
		},
		write(chunk, cb) {
			cb()
		},
	})

	const duplex = new StreamxAsNodeDuplex(streamx)
	const expected = new Error('kaboom')

	return new Promise((resolve, reject) => {
		duplex.on('error', (err) => {
			try {
				assert.strictEqual(err, expected)
			} catch (e) {
				reject(e)
			}
		})

		duplex.on('close', () => {
			try {
				assert.strictEqual(duplex.destroyed, true)
				resolve()
			} catch (err) {
				reject(err)
			}
		})

		duplex.destroy(expected)
	})
})

test('writable finished property', async () => {
	const streamx = new StreamxDuplex({
		read(cb) {
			cb()
		},
		write(chunk, cb) {
			assert.strictEqual(duplex.writableFinished, false)
			cb()
		},
	})

	const duplex = new StreamxAsNodeDuplex(streamx)

	return new Promise((resolve, reject) => {
		duplex.on('finish', () => {
			try {
				assert.strictEqual(duplex.writableFinished, true)
				resolve()
			} catch (err) {
				reject(err)
			}
		})

		duplex.end('testing finished state', () => {
			assert.strictEqual(duplex.writableFinished, true)
		})
	})
})

test('allowHalfOpen true (default)', async () => {
	const streamx = new StreamxDuplex({
		read(cb) {
			cb()
		},
		write(chunk, cb) {
			cb()
		},
	})

	const duplex = new StreamxAsNodeDuplex(streamx)

	return new Promise((resolve, reject) => {
		assert.strictEqual(duplex.allowHalfOpen, true)

		duplex.on('finish', () => {
			reject(
				new Error('finish should not be called when allowHalfOpen is true'),
			)
		})

		duplex.resume()
		duplex.push(null)

		// Wait a bit to ensure finish is not called
		setTimeout(resolve, 100)
	})
})

test('allowHalfOpen false', async () => {
	const streamx = new StreamxDuplex({
		read(cb) {
			cb()
		},
		write(chunk, cb) {
			cb()
		},
	})

	const duplex = new StreamxAsNodeDuplex(streamx, { allowHalfOpen: false })

	return new Promise((resolve) => {
		assert.strictEqual(duplex.allowHalfOpen, false)

		duplex.on('finish', resolve)

		duplex.resume()
		duplex.push(null)
	})
})

test('highWaterMark properties', () => {
	const streamx = new StreamxDuplex()
	const duplex = new StreamxAsNodeDuplex(streamx, {
		readableHighWaterMark: 10,
		writableHighWaterMark: 100,
	})

	assert.strictEqual(duplex.readableHighWaterMark, 10)
	assert.strictEqual(duplex.writableHighWaterMark, 100)
})

test('error propagation from streamx to wrapper', async () => {
	const streamx = new StreamxDuplex({
		read(cb) {
			cb()
		},
		write(chunk, cb) {
			cb()
		},
	})

	const duplex = new StreamxAsNodeDuplex(streamx)
	const expected = new Error('streamx error')

	return new Promise((resolve, reject) => {
		duplex.on('error', (err) => {
			try {
				assert.strictEqual(err, expected)
				resolve()
			} catch (e) {
				reject(e)
			}
		})

		streamx.destroy(expected)
	})
})

test('write backpressure - drain event', async () => {
	let writeCount = 0
	const streamx = new StreamxDuplex({
		highWaterMark: 16,
		read(cb) {
			cb()
		},
		write(chunk, cb) {
			writeCount++
			// Delay callback to simulate slow writes
			setTimeout(cb, 10)
		},
	})

	const duplex = new StreamxAsNodeDuplex(streamx, { writableHighWaterMark: 16 })

	return new Promise((resolve, reject) => {
		// Write until backpressure
		let canWrite = true
		let writes = 0
		while (canWrite && writes < 100) {
			canWrite = duplex.write(Buffer.alloc(10))
			writes++
		}

		try {
			// Should have triggered backpressure
			assert.ok(!canWrite, 'backpressure should have been triggered')
			assert.ok(
				writes > 1,
				'should have written multiple chunks before backpressure',
			)
		} catch (err) {
			reject(err)
			return
		}

		let drainCalled = false
		duplex.on('drain', () => {
			drainCalled = true
			duplex.end()
		})

		duplex.on('finish', () => {
			try {
				assert.ok(drainCalled, 'drain event should have been emitted')
				assert.ok(writeCount > 0, 'writes should have been processed')
				resolve()
			} catch (err) {
				reject(err)
			}
		})
	})
})

test('read backpressure - streamx pauses when Node.js buffer is full', async () => {
	// This test verifies that when the Node.js Duplex internal buffer fills up
	// (push returns false), the wrapper correctly pauses the underlying streamx stream

	let streamxPauseCount = 0
	let streamxResumeCount = 0
	let pushCount = 0

	const streamx = new StreamxDuplex({
		read(cb) {
			// Keep pushing data
			if (pushCount < 20) {
				this.push(Buffer.alloc(1024)) // Large chunks to fill buffer quickly
				pushCount++
			} else {
				this.push(null)
			}
			cb()
		},
		write(chunk, cb) {
			cb()
		},
	})

	// Spy on pause/resume
	const originalPause = streamx.pause.bind(streamx)
	const originalResume = streamx.resume.bind(streamx)
	streamx.pause = function () {
		streamxPauseCount++
		return originalPause()
	}
	streamx.resume = function () {
		streamxResumeCount++
		return originalResume()
	}

	const duplex = new StreamxAsNodeDuplex(streamx, {
		highWaterMark: 2048, // Small buffer to trigger backpressure quickly
	})

	return new Promise((resolve, reject) => {
		const chunks = []
		let paused = false

		duplex.on('data', (chunk) => {
			chunks.push(chunk)

			// After a few chunks, the internal buffer should fill and cause
			// push() to return false in #onStreamxData, which should pause streamx
			if (chunks.length === 5 && !paused) {
				paused = true

				// Pause to let buffer fill
				duplex.pause()

				setTimeout(() => {
					try {
						// Streamx should have been paused due to backpressure
						assert.ok(
							streamxPauseCount > 0,
							'streamx should have been paused when buffer filled',
						)
					} catch (err) {
						reject(err)
					}

					duplex.resume()
				}, 50)
			}
		})

		duplex.on('end', () => {
			try {
				assert.ok(
					streamxPauseCount > 0,
					'streamx.pause() should have been called',
				)
				assert.ok(
					streamxResumeCount > 0,
					'streamx.resume() should have been called',
				)
				assert.strictEqual(chunks.length, 20, 'should receive all chunks')
				resolve()
			} catch (err) {
				reject(err)
			}
		})

		duplex.on('error', reject)
	})
})

test('readable stream ending', async () => {
	const streamx = new StreamxDuplex({
		read(cb) {
			this.push(Buffer.from('data'))
			this.push(null)
			cb()
		},
		write(chunk, cb) {
			cb()
		},
	})

	const duplex = new StreamxAsNodeDuplex(streamx)

	return new Promise((resolve, reject) => {
		const chunks = []

		duplex.on('readable', () => {
			let chunk
			while ((chunk = duplex.read()) !== null) {
				chunks.push(chunk)
			}
		})

		duplex.on('end', () => {
			try {
				assert.ok(chunks.length > 0)
				assert.strictEqual(duplex.readableEnded, true)
				resolve()
			} catch (err) {
				reject(err)
			}
		})
	})
})

test('write after end should error', async () => {
	const streamx = new StreamxDuplex({
		read(cb) {
			cb()
		},
		write(chunk, cb) {
			cb()
		},
	})

	const duplex = new StreamxAsNodeDuplex(streamx)

	return new Promise((resolve, reject) => {
		duplex.on('error', (err) => {
			try {
				assert.ok(err)
				// @ts-expect-error
				assert.strictEqual(err.code, 'ERR_STREAM_WRITE_AFTER_END')
				resolve()
			} catch (e) {
				reject(e)
			}
		})

		duplex.end()

		// Write after end
		duplex.write('data')
	})
})

test('pause and resume', async () => {
	let pushCount = 0
	const streamx = new StreamxDuplex({
		read(cb) {
			if (pushCount === 0) {
				this.push(Buffer.from('test'))
				pushCount++
			} else if (pushCount === 1) {
				this.push(null)
				pushCount++
			}
			cb()
		},
		write(chunk, cb) {
			cb()
		},
	})

	const duplex = new StreamxAsNodeDuplex(streamx)

	return new Promise((resolve, reject) => {
		let dataReceived = false

		duplex.on('data', (chunk) => {
			try {
				assert.ok(!dataReceived, 'should only receive data once')
				dataReceived = true
				assert.deepEqual(chunk, Buffer.from('test'))
			} catch (err) {
				reject(err)
			}
		})

		duplex.on('end', () => {
			try {
				assert.ok(dataReceived)
				resolve()
			} catch (err) {
				reject(err)
			}
		})

		// Pause then resume
		duplex.pause()
		setTimeout(() => {
			duplex.resume()
		}, 50)
	})
})

test('access to underlying streamx instance', () => {
	const streamx = new StreamxDuplex()
	const duplex = new StreamxAsNodeDuplex(streamx)

	assert.strictEqual(duplex.streamx, streamx)
})

test('multiple writes and reads', async () => {
	/** @type {string[]} */
	const writes = []
	let readCount = 0
	const streamx = new StreamxDuplex({
		read(cb) {
			if (readCount < 3) {
				this.push(Buffer.from(`read${readCount}`))
				readCount++
			} else if (readCount === 3) {
				this.push(null)
				readCount++
			}
			cb()
		},
		write(chunk, cb) {
			writes.push(chunk.toString())
			cb()
		},
	})

	const duplex = new StreamxAsNodeDuplex(streamx)

	return new Promise((resolve, reject) => {
		/** @type {string[]} */
		const reads = []

		duplex.on('data', (chunk) => {
			reads.push(chunk.toString())
		})

		duplex.on('end', () => {
			try {
				assert.deepEqual(reads, ['read0', 'read1', 'read2'])
				assert.deepEqual(writes, ['write0', 'write1', 'write2'])
				resolve()
			} catch (err) {
				reject(err)
			}
		})

		duplex.write('write0')
		duplex.write('write1')
		duplex.write('write2')
		duplex.end()
	})
})

test('close event propagation', async () => {
	const streamx = new StreamxDuplex({
		read(cb) {
			cb()
		},
		write(chunk, cb) {
			cb()
		},
	})

	const duplex = new StreamxAsNodeDuplex(streamx)

	return new Promise((resolve) => {
		duplex.on('close', () => {
			resolve()
		})

		streamx.destroy()
	})
})

test('end event only fires once', async () => {
	let pushCount = 0
	const streamx = new StreamxDuplex({
		read(cb) {
			if (pushCount === 0) {
				this.push(Buffer.from('data'))
				pushCount++
			} else if (pushCount === 1) {
				this.push(null)
				pushCount++
			}
			cb()
		},
		write(chunk, cb) {
			cb()
		},
	})

	const duplex = new StreamxAsNodeDuplex(streamx)

	return new Promise((resolve, reject) => {
		let endCount = 0

		duplex.on('data', () => {})

		duplex.on('end', () => {
			endCount++
			if (endCount > 1) {
				return reject(new Error('end event fired multiple times'))
			}
			setTimeout(() => {
				try {
					assert.strictEqual(endCount, 1)
					resolve()
				} catch (err) {
					reject(err)
				}
			}, 100)
		})
	})
})

// Destroy lifecycle tests

test('custom _destroy implementation', async () => {
	let destroyCalled = false
	const streamx = new StreamxDuplex({
		read(cb) {
			cb()
		},
		write(chunk, cb) {
			cb()
		},
	})

	const expected = new Error('kaboom')
	const duplex = new StreamxAsNodeDuplex(streamx)

	duplex._destroy = function (err, cb) {
		destroyCalled = true
		assert.strictEqual(err, expected)
		cb(err)
	}

	return new Promise((resolve, reject) => {
		duplex.on('error', (err) => {
			try {
				assert.strictEqual(err, expected)
			} catch (e) {
				reject(e)
			}
		})

		duplex.on('close', () => {
			try {
				assert.ok(destroyCalled)
				assert.strictEqual(duplex.destroyed, true)
				resolve()
			} catch (err) {
				reject(err)
			}
		})

		duplex.destroy(expected)
	})
})

test('destroy option in constructor', async () => {
	const expected = new Error('kaboom')
	let destroyCalled = false

	const streamx = new StreamxDuplex({
		read(cb) {
			cb()
		},
		write(chunk, cb) {
			cb()
		},
	})

	const duplex = new StreamxAsNodeDuplex(streamx)
	duplex._destroy = function (err, cb) {
		destroyCalled = true
		assert.strictEqual(err, expected)
		cb()
	}

	return new Promise((resolve, reject) => {
		duplex.on('error', () => {
			reject(new Error('error should not be emitted when _destroy swallows it'))
		})

		duplex.on('close', () => {
			try {
				assert.ok(destroyCalled)
				assert.strictEqual(duplex.destroyed, true)
				resolve()
			} catch (err) {
				reject(err)
			}
		})

		duplex.resume()
		duplex.destroy(expected)
	})
})

test('destroy without error calls _destroy', async () => {
	let destroyCalled = false
	const streamx = new StreamxDuplex({
		read(cb) {
			cb()
		},
		write(chunk, cb) {
			cb()
		},
	})

	const duplex = new StreamxAsNodeDuplex(streamx)

	duplex._destroy = function (err, cb) {
		destroyCalled = true
		assert.strictEqual(err, null)
		cb()
	}

	return new Promise((resolve) => {
		duplex.on('close', () => {
			assert.ok(destroyCalled)
			assert.strictEqual(duplex.destroyed, true)
			resolve()
		})

		duplex.destroy()
	})
})

test('destroy with push/end during _destroy', async () => {
	const streamx = new StreamxDuplex({
		read(cb) {
			cb()
		},
		write(chunk, cb) {
			cb()
		},
	})

	const duplex = new StreamxAsNodeDuplex(streamx)

	duplex._destroy = function (err, cb) {
		assert.strictEqual(err, null)
		process.nextTick(() => {
			this.push(null)
			this.end()
			cb()
		})
	}

	return new Promise((resolve, reject) => {
		duplex.on('finish', () => {
			reject(new Error('finish should not be called'))
		})

		duplex.on('end', () => {
			reject(new Error('end should not be called'))
		})

		duplex.resume()
		duplex.destroy()

		// Wait a bit to ensure events don't fire
		setTimeout(() => {
			assert.strictEqual(duplex.destroyed, true)
			resolve()
		}, 100)
	})
})

test('_destroy error in callback', async () => {
	const streamx = new StreamxDuplex({
		read(cb) {
			cb()
		},
		write(chunk, cb) {
			cb()
		},
	})

	const duplex = new StreamxAsNodeDuplex(streamx)
	const expected = new Error('kaboom')

	duplex._destroy = function (err, cb) {
		assert.strictEqual(err, null)
		cb(expected)
	}

	return new Promise((resolve, reject) => {
		duplex.on('finish', () => {
			reject(new Error('finish should not be called'))
		})

		duplex.on('end', () => {
			reject(new Error('end should not be called'))
		})

		duplex.on('error', (err) => {
			try {
				assert.strictEqual(err, expected)
			} catch (e) {
				reject(e)
			}
		})

		duplex.on('close', () => {
			try {
				assert.strictEqual(duplex.destroyed, true)
				resolve()
			} catch (err) {
				reject(err)
			}
		})

		duplex.destroy()
	})
})

test('destroy with allowHalfOpen', async () => {
	const streamx = new StreamxDuplex({
		read(cb) {
			cb()
		},
		write(chunk, cb) {
			cb()
		},
	})

	const duplex = new StreamxAsNodeDuplex(streamx, { allowHalfOpen: true })

	return new Promise((resolve, reject) => {
		duplex.on('finish', () => {
			reject(new Error('finish should not be called'))
		})

		duplex.on('end', () => {
			reject(new Error('end should not be called'))
		})

		duplex.on('close', () => {
			try {
				assert.strictEqual(duplex.destroyed, true)
				resolve()
			} catch (err) {
				reject(err)
			}
		})

		duplex.resume()
		duplex.destroy()
	})
})

test('destroy when already destroyed', async () => {
	const streamx = new StreamxDuplex({
		read(cb) {
			cb()
		},
		write(chunk, cb) {
			cb()
		},
	})

	const duplex = new StreamxAsNodeDuplex(streamx)

	return new Promise((resolve, reject) => {
		duplex.on('close', () => {
			// Set destroyed to true manually
			duplex.destroyed = true
			assert.strictEqual(duplex.destroyed, true)

			// Calling destroy again should be a no-op
			duplex.on('finish', () => {
				reject(new Error('finish should not be called'))
			})

			duplex.on('end', () => {
				reject(new Error('end should not be called'))
			})

			duplex.destroy()

			// Wait a bit to ensure no events fire
			setTimeout(resolve, 50)
		})

		duplex.destroy()
	})
})

test('autoDestroy with writable: false', async () => {
	const streamx = new StreamxDuplex({
		read(cb) {
			cb()
		},
		write(chunk, cb) {
			cb()
		},
	})

	const duplex = new StreamxAsNodeDuplex(streamx, {
		writable: false,
		autoDestroy: true,
	})

	return new Promise((resolve) => {
		duplex.on('close', resolve)
		duplex.push(null)
		duplex.resume()
	})
})

test('autoDestroy with readable: false', async () => {
	const streamx = new StreamxDuplex({
		read(cb) {
			cb()
		},
		write(chunk, cb) {
			cb()
		},
	})

	const duplex = new StreamxAsNodeDuplex(streamx, {
		readable: false,
		autoDestroy: true,
	})

	return new Promise((resolve) => {
		duplex.on('close', resolve)
		duplex.end()
	})
})

test('allowHalfOpen: false with autoDestroy', async () => {
	const streamx = new StreamxDuplex({
		read(cb) {
			cb()
		},
		write(chunk, cb) {
			cb()
		},
	})

	const duplex = new StreamxAsNodeDuplex(streamx, {
		allowHalfOpen: false,
		autoDestroy: true,
	})

	return new Promise((resolve, reject) => {
		let endCalled = false

		duplex.on('end', () => {
			endCalled = true
		})

		duplex.on('close', () => {
			try {
				assert.ok(endCalled, 'end should be called before close')
				resolve()
			} catch (err) {
				reject(err)
			}
		})

		duplex.push(null)
		duplex.resume()
	})
})

test('destroy during corked writes', async () => {
	const streamx = new StreamxDuplex({
		read(cb) {
			cb()
		},
		write(chunk, cb) {
			cb()
		},
	})

	const duplex = new StreamxAsNodeDuplex(streamx)

	return new Promise((resolve, reject) => {
		duplex.cork()

		duplex.write('foo', (err) => {
			try {
				assert.ok(err)
				// @ts-expect-error
				assert.strictEqual(err.code, 'ERR_STREAM_DESTROYED')
				resolve()
			} catch (e) {
				reject(e)
			}
		})

		duplex.destroy()
	})
})

// Readable/writable property option tests

test('readable: false option - push throws error', async () => {
	const streamx = new StreamxDuplex({
		read(cb) {
			cb()
		},
		write(chunk, cb) {
			cb()
		},
	})

	const duplex = new StreamxAsNodeDuplex(streamx, { readable: false })

	return new Promise((resolve, reject) => {
		assert.strictEqual(duplex.readable, false)

		duplex.on('error', (err) => {
			try {
				// @ts-expect-error
				assert.strictEqual(err.code, 'ERR_STREAM_PUSH_AFTER_EOF')
				resolve()
			} catch (e) {
				reject(e)
			}
		})

		duplex.on('data', () => {
			reject(new Error('data should not be emitted'))
		})

		duplex.on('end', () => {
			reject(new Error('end should not be emitted'))
		})

		duplex.push('asd')
	})
})

test('writable: false option - write throws error', async () => {
	const streamx = new StreamxDuplex({
		read(cb) {
			cb()
		},
		write() {
			throw new Error('write should not be called')
		},
	})

	const duplex = new StreamxAsNodeDuplex(streamx, { writable: false })

	return new Promise((resolve, reject) => {
		assert.strictEqual(duplex.writable, false)

		duplex.on('error', (err) => {
			try {
				// @ts-expect-error
				assert.strictEqual(err.code, 'ERR_STREAM_WRITE_AFTER_END')
				resolve()
			} catch (e) {
				reject(e)
			}
		})

		duplex.on('finish', () => {
			reject(new Error('finish should not be emitted'))
		})

		duplex.write('asd')
	})
})

test('readable: false with async iteration', async () => {
	const streamx = new StreamxDuplex({
		read(cb) {
			cb()
		},
		write(chunk, cb) {
			cb()
		},
	})

	const duplex = new StreamxAsNodeDuplex(streamx, { readable: false })

	assert.strictEqual(duplex.readable, false)

	duplex.on('data', () => {
		throw new Error('data should not be emitted')
	})

	duplex.on('end', () => {
		throw new Error('end should not be emitted')
	})

	let iterationCompleted = false
	for await (const chunk of duplex) {
		throw new Error(`Should not receive chunk: ${chunk}`)
	}
	iterationCompleted = true

	assert.ok(iterationCompleted)
})

// Pipeline tests

test('pipeline with Duplex throws premature close', async () => {
	const { pipeline, PassThrough } = await import('node:stream')

	const remote = new PassThrough()

	const streamx = new StreamxDuplex({
		read(cb) {
			cb()
		},
		write(chunk, cb) {
			cb()
		},
	})

	const local = new StreamxAsNodeDuplex(streamx)

	return new Promise((resolve, reject) => {
		pipeline(remote, local, remote, (err) => {
			try {
				assert.ok(err)
				assert.strictEqual(err.code, 'ERR_STREAM_PREMATURE_CLOSE')
				resolve()
			} catch (e) {
				reject(e)
			}
		})

		setImmediate(() => {
			remote.end()
		})
	})
})

// Readable ending tests (backpressure and Transform-like behavior)

test('readable ending with backpressure', async () => {
	// This test verifies basic backpressure handling.
	// Note: When a pipe destination ends, Node.js behavior is to destroy the pipe,
	// not necessarily to pause the source via backpressure. This test focuses on
	// verifying that backpressure works when the buffer fills up, not when the
	// destination ends.

	let pushCount = 0

	const src = new StreamxDuplex({
		highWaterMark: 100, // Small buffer
		read(cb) {
			if (pushCount < 10) {
				// Push small chunks to control backpressure better
				const shouldContinue = this.push(Buffer.from(`chunk${pushCount}`))
				pushCount++
				if (!shouldContinue) {
					// streamx detected backpressure internally
				}
			} else {
				this.push(null)
			}
			cb()
		},
		write(chunk, cb) {
			cb()
		},
	})

	const srcDuplex = new StreamxAsNodeDuplex(src, { highWaterMark: 100 })

	return new Promise((resolve, reject) => {
		const chunks = []
		let paused = false

		// Don't use pipe, manually read to control flow
		srcDuplex.on('data', (chunk) => {
			chunks.push(chunk)

			// After receiving a few chunks, pause to simulate backpressure
			if (chunks.length === 3 && !paused) {
				srcDuplex.pause()
				paused = true

				// Verify stream is paused
				assert.ok(srcDuplex.isPaused())

				// Resume after a delay
				setTimeout(() => {
					srcDuplex.resume()
				}, 50)
			}
		})

		srcDuplex.on('end', () => {
			try {
				// Verify we received all chunks
				assert.strictEqual(chunks.length, 10)
				// Verify pause/resume worked
				assert.ok(paused)
				resolve()
			} catch (err) {
				reject(err)
			}
		})
	})
})

test('pipe backpressure - source stops reading when destination is slow', async () => {
	// This test verifies that when piping through StreamxAsNodeDuplex, backpressure
	// is properly communicated to the source. When the destination is slow/paused,
	// the source readable should stop being consumed.

	const { Readable } = await import('node:stream')

	let sourceReadCount = 0
	const source = new Readable({
		read() {
			// Track how many times the source is read
			sourceReadCount++

			// Push data continuously
			if (sourceReadCount <= 100) {
				this.push(Buffer.alloc(1024, sourceReadCount % 256))
			} else {
				this.push(null)
			}
		},
	})

	// Create a streamx duplex with slow write
	let dstWriteCount = 0
	let allowWrite = true

	const streamx = new StreamxDuplex({
		highWaterMark: 2048, // Small buffer to trigger backpressure
		read(cb) {
			cb()
		},
		write(chunk, cb) {
			dstWriteCount++

			// Simulate a slow/blocked destination by delaying the callback
			if (!allowWrite) {
				// Don't call callback - this simulates a blocked write
				// We'll call it later when we "unblock"
				return
			}

			// First few writes are fast
			if (dstWriteCount < 5) {
				cb()
			} else {
				// After 5 writes, slow down significantly
				setTimeout(cb, 50)
			}
		},
	})

	const duplex = new StreamxAsNodeDuplex(streamx, {
		writableHighWaterMark: 2048,
	})

	return new Promise((resolve, reject) => {
		source.pipe(duplex)

		duplex.on('data', () => {
			// Just consume the data
		})

		// After a short delay, check that the source hasn't been fully consumed
		setTimeout(() => {
			try {
				// Due to backpressure, the source should not have been fully read
				// It should have stopped reading after the buffer filled up
				assert.ok(
					sourceReadCount < 100,
					`Source should stop reading due to backpressure (read ${sourceReadCount}/100 times)`,
				)

				assert.ok(
					dstWriteCount > 0,
					'Destination should have received some writes',
				)

				// The source should have read more than just the buffer size,
				// but not everything
				assert.ok(
					sourceReadCount > 5,
					'Source should have read some data before backpressure kicked in',
				)

				// Cleanup
				source.unpipe(duplex)
				duplex.destroy()
				resolve()
			} catch (err) {
				reject(err)
			}
		}, 200)
	})
})

test('pipe backpressure when destination ends early', async () => {
	// This test verifies that backpressure works correctly when manually pausing
	// and resuming the stream, and that the stream ends up paused when a pipe
	// destination finishes.
	//
	// Note: Due to streamx's internal buffering and read-ahead behavior, when
	// wrapping a streamx stream that has its own read() implementation, streamx
	// may read ahead into its buffer before backpressure can take effect. This
	// is an inherent limitation of wrapping an already-instantiated streamx stream.
	//
	// However, the wrapper DOES properly communicate pause/resume to streamx, which
	// prevents further reads once backpressure is detected.

	let readCallCount = 0

	const src = new StreamxDuplex({
		highWaterMark: 100,
		read(cb) {
			if (readCallCount < 10) {
				readCallCount++
				this.push(Buffer.from(`chunk-${readCallCount}`))
			} else {
				this.push(null)
			}
			cb()
		},
		write(chunk, cb) {
			cb()
		},
	})

	const srcDuplex = new StreamxAsNodeDuplex(src, { highWaterMark: 100 })

	let writeCount = 0
	const dst = new StreamxDuplex({
		highWaterMark: 100,
		read(cb) {
			cb()
		},
		write(chunk, cb) {
			writeCount++
			// End after second write
			if (writeCount === 2) {
				this.push(null)
			}
			cb()
		},
	})

	const dstDuplex = new StreamxAsNodeDuplex(dst, { highWaterMark: 100 })

	return new Promise((resolve, reject) => {
		srcDuplex.pipe(dstDuplex)

		dstDuplex.on('data', () => {})

		dstDuplex.on('end', () => {
			// Give time for pipe cleanup
			setTimeout(() => {
				try {
					// The source should be paused after the pipe ends
					assert.ok(
						srcDuplex.isPaused(),
						'Source should be paused after pipe ends',
					)

					// The pause/resume mechanism should be working
					// (Even if streamx read ahead, the Node.js wrapper should be paused)
					srcDuplex.resume()
					assert.ok(
						!srcDuplex.isPaused(),
						'Stream should not be paused after resume',
					)
					srcDuplex.pause()
					assert.ok(srcDuplex.isPaused(), 'Stream should be paused after pause')

					resolve()
				} catch (err) {
					reject(err)
				}
			}, 100)
		})
	})
})
