# secret-stream-http

An HTTP client and server built on top of
[@hyperswarm/secret-stream](https://github.com/holepunchto/hyperswarm-secret-stream)
for end-to-end encrypted HTTP communication over TCP.

## Features

- **End-to-end encryption** - All HTTP traffic is encrypted using Hyperswarm's
  SecretStream protocol
- **Identity verification** - Cryptographic verification of server identity via
  public keys
- **Drop-in replacement** - Compatible with standard `fetch()` API and HTTP
  servers
- **Custom key pairs** - Support for persistent client identities across
  requests
- **Connection pooling** - Built on Undici for efficient connection management

## Installation

```bash
npm install secret-stream-http
```

## Usage

### Basic Client

```javascript
import { fetch } from 'secret-stream-http'

const response = await fetch('http://localhost:3000/hello')
console.log(await response.text())
```

The `fetch()` function works just like the standard Fetch API but automatically
encrypts all communication using SecretStream.

### Basic Server

```javascript
import { createServer as createHttpServer } from 'node:http'

import { createServer } from 'secret-stream-http'

// Create your HTTP handler
const httpServer = createHttpServer((req, res) => {
	res.writeHead(200, { 'Content-Type': 'text/plain' })
	res.end('Hello, World!')
})

// Wrap it with SecretStream encryption
const server = createServer(httpServer)

server.listen(3000, () => {
	console.log('Server listening on port 3000')
	console.log('Server public key:', server.publicKey.toString('hex'))
})
```

### Custom Client Key Pairs

By default, a global agent with a random key pair is used. You can provide
custom key pairs for persistent client identities:

```javascript
import { fetch, Agent } from 'secret-stream-http'

// Generate a key pair
const keyPair = Agent.keyPair()

// Create an agent with the key pair
const agent = new Agent({ keyPair })

// Use per-request
const response = await fetch('http://localhost:3000/', {
	dispatcher: agent,
})
```

### Setting a Global Dispatcher

```javascript
import { setGlobalDispatcher, Agent } from 'secret-stream-http'

const keyPair = Agent.keyPair()
const agent = new Agent({ keyPair })

setGlobalDispatcher(agent)

// All subsequent fetch calls will use this agent
await fetch('http://localhost:3000/')
```

### Server Identity Verification

Verify that you're connecting to the expected server by pinning its public key:

```javascript
import { Agent } from 'secret-stream-http'

// Get the server's public key (e.g., from server.publicKey)
const serverPublicKey = Buffer.from('...', 'hex')

const agent = new Agent({
	remotePublicKey: serverPublicKey,
})

// This will only succeed if connected to the server with matching public key
const response = await fetch('http://localhost:3000/', {
	dispatcher: agent,
})
```

Attempting to connect to a server with a different public key will result in an
error:

```
Error: Remote public key does not match expected key
```

### Custom Server Key Pairs

Generate and reuse server key pairs for persistent server identities:

```javascript
import { createServer, Agent } from 'secret-stream-http'

const keyPair = Agent.keyPair()

const server = createServer(httpServer, { keyPair })

console.log('Public key:', server.publicKey.toString('hex'))
```

### Accessing Client Public Key on Server

Access the client's public key in your server handlers:

```javascript
import { createServer } from 'node:http'

const httpServer = createServer((req, res) => {
	const clientPublicKey = req.socket.remotePublicKey

	console.log('Client public key:', clientPublicKey.toString('hex'))

	res.writeHead(200, { 'Content-Type': 'text/plain' })
	res.end('Authenticated')
})
```

## API

### Client API

#### `fetch(url, options?)`

Standard Fetch API with automatic SecretStream encryption. The `dispatcher`
option can be used to specify a custom agent.

#### `Agent(options?)`

Creates a new HTTP agent for encrypted connections.

Options:

- `keyPair?: { publicKey: Buffer, secretKey: Buffer }` - Key pair for client
  identity (generated if not provided)
- `remotePublicKey?: Buffer` - Expected server public key for identity
  verification
- All other [Undici Agent options](https://undici.nodejs.org/#/docs/api/Agent)

#### `Agent.keyPair()`

Static method to generate a new cryptographic key pair.

#### `setGlobalDispatcher(agent)`

Set the default agent used by all `fetch()` calls.

#### `getGlobalDispatcher()`

Get the current global dispatcher.

### Server API

#### `createServer(httpServer, options?)`

Wraps an HTTP server with SecretStream encryption.

Parameters:

- `httpServer` - Node.js HTTP server instance
- `options.keyPair?` - Server key pair (generated if not provided)

Returns: TCP server with `publicKey` property

The returned server is a standard Node.js TCP server. Call `.listen()` to start
accepting connections.

## How It Works

1. **Client side**: The `Agent` creates a TCP connection and wraps it with
   Hyperswarm's SecretStream for encryption before making HTTP requests.

2. **Server side**: The TCP server accepts connections, wraps each socket with
   SecretStream, and forwards the decrypted stream to the HTTP server.

3. **Encryption**: All HTTP traffic (including headers and body) is encrypted
   end-to-end using the Noise protocol via SecretStream.

4. **Authentication**: Public keys are exchanged during the SecretStream
   handshake, allowing both parties to verify each other's identity.

## License

MIT License. See `LICENSE` file for details.
