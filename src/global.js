import { Agent } from './agent.js'

// We include a version number for the Dispatcher API. In case of breaking changes,
// this version number must be increased to avoid conflicts.
const globalDispatcher = Symbol.for('secretStream.globalDispatcher.1')

if (getGlobalDispatcher() === undefined) {
	setGlobalDispatcher(new Agent())
}

/**
 * @param {Agent} agent
 */
export function setGlobalDispatcher(agent) {
	if (!agent || typeof agent.dispatch !== 'function') {
		throw new Error('Argument agent must implement SecretStreamAgent')
	}
	Object.defineProperty(globalThis, globalDispatcher, {
		value: agent,
		writable: true,
		enumerable: false,
		configurable: false,
	})
}

export function getGlobalDispatcher() {
	// @ts-ignore
	return globalThis[globalDispatcher]
}
