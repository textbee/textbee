// Code samples for the API guide.
//
// Every snippet is generated from the user's real device id, so what they copy
// is runnable after pasting one API key. The previous guide always printed
// YOUR_DEVICE_ID, which meant nothing on the page could be run as-is.

// Match the deployment used by the dashboard, including self-hosted instances.
export const API_BASE_URL = (
  process.env.NEXT_PUBLIC_API_BASE_URL || 'https://api.textbee.dev/api/v1'
).replace(/\/+$/, '')

export type LanguageId =
  | 'curl'
  | 'node'
  | 'python'
  | 'php'
  | 'go'
  | 'sdk'
  | 'python-sdk'

// cURL stays first and stays the default. The SDKs are an extra option for
// JavaScript and Python users, not a replacement for the REST examples.
export const LANGUAGES: { id: LanguageId; label: string; highlight: string }[] =
  [
    { id: 'curl', label: 'cURL', highlight: 'bash' },
    { id: 'node', label: 'Node.js', highlight: 'javascript' },
    { id: 'python', label: 'Python', highlight: 'python' },
    { id: 'php', label: 'PHP', highlight: 'php' },
    { id: 'go', label: 'Go', highlight: 'go' },
    { id: 'sdk', label: 'JS SDK', highlight: 'javascript' },
    { id: 'python-sdk', label: 'Python SDK', highlight: 'python' },
  ]

export type EndpointId =
  | 'send-sms'
  | 'send-bulk'
  | 'received'
  | 'message-status'

export type Endpoint = {
  id: EndpointId
  title: string
  blurb: string
  method: 'GET' | 'POST'
  path: string
  samples: Record<LanguageId, string>
  response: string
}

const PLACEHOLDER_DEVICE = 'YOUR_DEVICE_ID'

// The send endpoints take deviceId as an optional body field, so the samples
// have two variants: with a real id, and without one. When deviceId is omitted,
// the API sends from the account's default device, or otherwise the enabled
// device with the most recent heartbeat. Both are built from this single set of
// fragments so they cannot drift apart.
const deviceIdField = (deviceId?: string) => ({
  curl: deviceId ? `\n    "deviceId": "${deviceId}",` : '',
  node: deviceId ? `\n      deviceId: '${deviceId}',` : '',
  python: deviceId ? `\n        'deviceId': '${deviceId}',` : '',
  php: deviceId ? `\n        'deviceId' => '${deviceId}',` : '',
  go: deviceId ? `"deviceId":"${deviceId}",` : '',
  sdk: deviceId ? `\n  deviceId: '${deviceId}',` : '',
  pythonSdk: deviceId ? `\n    device_id='${deviceId}',` : '',
})

/** Package the SDK samples install, surfaced by the package manager picker. */
export const SDK_PACKAGE = '@textbee/sdk'

// Client setup shared by every SDK sample. The install command is deliberately
// not here: it is rendered by the package manager picker above the code, so the
// copy button hands back runnable code and nothing else.
const SDK_SETUP = `import { Textbee } from '@textbee/sdk'

const textbee = new Textbee({
  apiKey: process.env.TEXTBEE_API_KEY,
  baseUrl: '${API_BASE_URL}',
})`

/** Package the Python SDK samples install. */
export const PYTHON_SDK_PACKAGE = 'textbee'

const PYTHON_SDK_SETUP = `import os

from textbee import Textbee

textbee = Textbee(
    api_key=os.environ['TEXTBEE_API_KEY'],
    base_url='${API_BASE_URL}',
)`

export function buildEndpoints(deviceId?: string): Endpoint[] {
  const id = deviceId || PLACEHOLDER_DEVICE
  const device = deviceIdField(deviceId)

  return [
    {
      id: 'send-sms',
      title: 'Send an SMS',
      blurb: 'Send one message to one or more recipients.',
      method: 'POST',
      path: '/gateway/send-sms',
      samples: {
        curl: `curl -X POST "${API_BASE_URL}/gateway/send-sms" \\
  -H "x-api-key: $TEXTBEE_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{${device.curl}
    "recipients": ["+14155550101"],
    "message": "Hello from textbee"
  }'`,
        node: `const res = await fetch(
  '${API_BASE_URL}/gateway/send-sms',
  {
    method: 'POST',
    headers: {
      'x-api-key': process.env.TEXTBEE_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({${device.node}
      recipients: ['+14155550101'],
      message: 'Hello from textbee',
    }),
  }
)

console.log(await res.json())`,
        python: `import os, requests

res = requests.post(
    '${API_BASE_URL}/gateway/send-sms',
    headers={'x-api-key': os.environ['TEXTBEE_API_KEY']},
    json={${device.python}
        'recipients': ['+14155550101'],
        'message': 'Hello from textbee',
    },
)

print(res.json())`,
        php: `<?php
$ch = curl_init('${API_BASE_URL}/gateway/send-sms');

curl_setopt_array($ch, [
    CURLOPT_POST => true,
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_HTTPHEADER => [
        'x-api-key: ' . getenv('TEXTBEE_API_KEY'),
        'Content-Type: application/json',
    ],
    CURLOPT_POSTFIELDS => json_encode([${device.php}
        'recipients' => ['+14155550101'],
        'message' => 'Hello from textbee',
    ]),
]);

echo curl_exec($ch);`,
        go: `package main

import (
	"bytes"
	"fmt"
	"io"
	"net/http"
	"os"
)

func main() {
	body := []byte(\`{${device.go}"recipients":["+14155550101"],"message":"Hello from textbee"}\`)

	req, _ := http.NewRequest("POST",
		"${API_BASE_URL}/gateway/send-sms",
		bytes.NewBuffer(body))
	req.Header.Set("x-api-key", os.Getenv("TEXTBEE_API_KEY"))
	req.Header.Set("Content-Type", "application/json")

	res, err := http.DefaultClient.Do(req)
	if err != nil {
		panic(err)
	}
	defer res.Body.Close()

	out, _ := io.ReadAll(res.Body)
	fmt.Println(string(out))
}`,
        sdk: `${SDK_SETUP}

const result = await textbee.sendSms({${device.sdk}
  recipients: ['+14155550101'],
  message: 'Hello from textbee',
})

console.log(result)`,
        'python-sdk': `${PYTHON_SDK_SETUP}

result = textbee.send_sms(${device.pythonSdk}
    recipients=['+14155550101'],
    message='Hello from textbee',
)

print(result)`,
      },
      response: `{
  "data": {
    "success": true,
    "message": "Message queued for delivery",
    "smsBatchId": "665f1c2a9b1e4a0012ab34cd"
  }
}`,
    },
    {
      id: 'send-bulk',
      title: 'Send messages in bulk',
      blurb: 'Send different messages to different recipients in one request.',
      method: 'POST',
      path: '/gateway/send-bulk-sms',
      samples: {
        curl: `curl -X POST "${API_BASE_URL}/gateway/send-bulk-sms" \\
  -H "x-api-key: $TEXTBEE_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{${device.curl}
    "messages": [
      { "recipients": ["+14155550101"], "message": "Hi Alice" },
      { "recipients": ["+16475550187"], "message": "Hi Bob" }
    ]
  }'`,
        node: `const res = await fetch(
  '${API_BASE_URL}/gateway/send-bulk-sms',
  {
    method: 'POST',
    headers: {
      'x-api-key': process.env.TEXTBEE_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({${device.node}
      messages: [
        { recipients: ['+14155550101'], message: 'Hi Alice' },
        { recipients: ['+16475550187'], message: 'Hi Bob' },
      ],
    }),
  }
)

console.log(await res.json())`,
        python: `import os, requests

res = requests.post(
    '${API_BASE_URL}/gateway/send-bulk-sms',
    headers={'x-api-key': os.environ['TEXTBEE_API_KEY']},
    json={${device.python}
        'messages': [
            {'recipients': ['+14155550101'], 'message': 'Hi Alice'},
            {'recipients': ['+16475550187'], 'message': 'Hi Bob'},
        ],
    },
)

print(res.json())`,
        php: `<?php
$ch = curl_init('${API_BASE_URL}/gateway/send-bulk-sms');

curl_setopt_array($ch, [
    CURLOPT_POST => true,
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_HTTPHEADER => [
        'x-api-key: ' . getenv('TEXTBEE_API_KEY'),
        'Content-Type: application/json',
    ],
    CURLOPT_POSTFIELDS => json_encode([${device.php}
        'messages' => [
            ['recipients' => ['+14155550101'], 'message' => 'Hi Alice'],
            ['recipients' => ['+16475550187'], 'message' => 'Hi Bob'],
        ],
    ]),
]);

echo curl_exec($ch);`,
        go: `package main

import (
	"bytes"
	"fmt"
	"io"
	"net/http"
	"os"
)

func main() {
	body := []byte(\`{${device.go}"messages":[
		{"recipients":["+14155550101"],"message":"Hi Alice"},
		{"recipients":["+16475550187"],"message":"Hi Bob"}
	]}\`)

	req, _ := http.NewRequest("POST",
		"${API_BASE_URL}/gateway/send-bulk-sms",
		bytes.NewBuffer(body))
	req.Header.Set("x-api-key", os.Getenv("TEXTBEE_API_KEY"))
	req.Header.Set("Content-Type", "application/json")

	res, _ := http.DefaultClient.Do(req)
	defer res.Body.Close()

	out, _ := io.ReadAll(res.Body)
	fmt.Println(string(out))
}`,
        // Bulk send is the one endpoint here with no SDK method yet, so the
        // SDK tabs stay on the REST call rather than pretending otherwise.
        sdk: `// Bulk send is not in @textbee/sdk yet. Use the REST API for now.
const res = await fetch(
  '${API_BASE_URL}/gateway/send-bulk-sms',
  {
    method: 'POST',
    headers: {
      'x-api-key': process.env.TEXTBEE_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({${device.node}
      messages: [
        { recipients: ['+14155550101'], message: 'Hi Alice' },
        { recipients: ['+16475550187'], message: 'Hi Bob' },
      ],
    }),
  }
)

console.log(await res.json())`,
        'python-sdk': `# Bulk send is not in the textbee Python SDK yet. This uses the REST API
# with requests (pip install requests).
import os, requests

res = requests.post(
    '${API_BASE_URL}/gateway/send-bulk-sms',
    headers={'x-api-key': os.environ['TEXTBEE_API_KEY']},
    json={${device.python}
        'messages': [
            {'recipients': ['+14155550101'], 'message': 'Hi Alice'},
            {'recipients': ['+16475550187'], 'message': 'Hi Bob'},
        ],
    },
)

print(res.json())`,
      },
      response: `{
  "data": {
    "success": true,
    "smsBatchId": "665f1c2a9b1e4a0012ab34cd",
    "recipientCount": 2
  }
}`,
    },
    {
      id: 'received',
      title: 'Read received messages',
      blurb:
        'Poll for SMS your devices have received, across the whole account. Add order=asc and follow meta.nextCursor to read every message exactly once.',
      method: 'GET',
      path: '/gateway/messages?direction=received',
      samples: {
        curl: `curl "${API_BASE_URL}/gateway/messages?direction=received" \\
  -H "x-api-key: $TEXTBEE_API_KEY"`,
        node: `const res = await fetch(
  '${API_BASE_URL}/gateway/messages?direction=received',
  { headers: { 'x-api-key': process.env.TEXTBEE_API_KEY } }
)

console.log(await res.json())`,
        python: `import os, requests

res = requests.get(
    '${API_BASE_URL}/gateway/messages',
    headers={'x-api-key': os.environ['TEXTBEE_API_KEY']},
    params={'direction': 'received'},
)

print(res.json())`,
        php: `<?php
$ch = curl_init('${API_BASE_URL}/gateway/messages?direction=received');

curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_HTTPHEADER => ['x-api-key: ' . getenv('TEXTBEE_API_KEY')],
]);

echo curl_exec($ch);`,
        go: `package main

import (
	"fmt"
	"io"
	"net/http"
	"os"
)

func main() {
	req, _ := http.NewRequest("GET",
		"${API_BASE_URL}/gateway/messages?direction=received", nil)
	req.Header.Set("x-api-key", os.Getenv("TEXTBEE_API_KEY"))

	res, _ := http.DefaultClient.Do(req)
	defer res.Body.Close()

	out, _ := io.ReadAll(res.Body)
	fmt.Println(string(out))
}`,
        sdk: `${SDK_SETUP}

const { data, meta } = await textbee.getMessages({
  direction: 'received',
  page: 1,
  limit: 20,
})

console.log(data, meta)

// Or drain every match, following the cursor for you
for await (const message of textbee.iterateMessages({
  direction: 'received',
  order: 'asc',
})) {
  console.log(message.sender, message.message)
}`,
        'python-sdk': `${PYTHON_SDK_SETUP}

page = textbee.get_messages(direction='received', page=1, limit=20)

print(page['data'], page['meta'])

# Or drain every match, following the cursor for you
for message in textbee.iterate_messages(direction='received', order='asc'):
    print(message.get('sender'), message['message'])`,
      },
      response: `{
  "data": [
    {
      "_id": "665f1c2a9b1e4a0012ab34ce",
      "sender": "+14155550101",
      "message": "Reply from a customer",
      "direction": "received",
      "status": "received",
      "receivedAt": "2026-07-18T09:14:22.000Z"
    }
  ],
  "meta": { "page": 1, "limit": 50, "total": 1, "totalPages": 1 }
}`,
    },
    {
      id: 'message-status',
      title: 'Check message history',
      blurb:
        'List messages across your account with their delivery status. Optional filters: deviceIds, smsBatchId, direction, status, search, from/to, order. Use cursor instead of page to poll without duplicates.',
      method: 'GET',
      path: '/gateway/messages',
      samples: {
        curl: `curl "${API_BASE_URL}/gateway/messages?page=1&limit=20" \\
  -H "x-api-key: $TEXTBEE_API_KEY"

# Which recipients of a batch failed, using the smsBatchId a send returns
curl "${API_BASE_URL}/gateway/messages?smsBatchId=YOUR_BATCH_ID&status=failed" \\
  -H "x-api-key: $TEXTBEE_API_KEY"`,
        node: `const url = new URL('${API_BASE_URL}/gateway/messages')
url.searchParams.set('page', '1')
url.searchParams.set('limit', '20')

const res = await fetch(url, {
  headers: { 'x-api-key': process.env.TEXTBEE_API_KEY },
})

console.log(await res.json())`,
        python: `import os, requests

res = requests.get(
    '${API_BASE_URL}/gateway/messages',
    headers={'x-api-key': os.environ['TEXTBEE_API_KEY']},
    params={'page': 1, 'limit': 20},
)

print(res.json())`,
        php: `<?php
$url = '${API_BASE_URL}/gateway/messages?page=1&limit=20';
$ch = curl_init($url);

curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_HTTPHEADER => ['x-api-key: ' . getenv('TEXTBEE_API_KEY')],
]);

echo curl_exec($ch);`,
        go: `package main

import (
	"fmt"
	"io"
	"net/http"
	"os"
)

func main() {
	req, _ := http.NewRequest("GET",
		"${API_BASE_URL}/gateway/messages?page=1&limit=20", nil)
	req.Header.Set("x-api-key", os.Getenv("TEXTBEE_API_KEY"))

	res, _ := http.DefaultClient.Do(req)
	defer res.Body.Close()

	out, _ := io.ReadAll(res.Body)
	fmt.Println(string(out))
}`,
        sdk: `${SDK_SETUP}

const { data, meta } = await textbee.getMessages({
  page: 1,
  limit: 20,
})

console.log(data, meta)

// Narrow to one device, or to the recipients of a batch that failed
await textbee.getMessages({ deviceIds: ['${id}'] })
await textbee.getMessages({ smsBatchId: 'YOUR_BATCH_ID', status: 'failed' })`,
        'python-sdk': `${PYTHON_SDK_SETUP}

page = textbee.get_messages(page=1, limit=20)

print(page['data'], page['meta'])

# Narrow to one device, or to the recipients of a batch that failed
textbee.get_messages(device_ids=['${id}'])
textbee.get_messages(sms_batch_id='YOUR_BATCH_ID', status='failed')`,
      },
      // Status values match the SMS schema: pending, dispatched, sent,
      // delivered, failed, unknown, received.
      response: `{
  "data": [
    {
      "_id": "665f1c2a9b1e4a0012ab34cd",
      "recipient": "+14155550101",
      "message": "Hello from textbee",
      "direction": "sent",
      "status": "delivered",
      "requestedAt": "2026-07-18T09:12:00.000Z",
      "sentAt": "2026-07-18T09:12:03.000Z",
      "deliveredAt": "2026-07-18T09:12:07.000Z"
    }
  ],
  "meta": { "page": 1, "limit": 20, "total": 1, "totalPages": 1 }
}`,
    },
  ]
}
