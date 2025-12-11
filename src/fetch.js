import { fetch as undiciFetch } from 'undici'

import { getGlobalDispatcher } from './global.js'

/** @type {typeof undiciFetch} */
export function fetch(url, options) {
	return undiciFetch(url, {
		dispatcher: getGlobalDispatcher(),
		// override the dispatcher per-request if needed
		...options,
	})
}
