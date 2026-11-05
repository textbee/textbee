'use client'

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Code } from '@/components/ui/code'
import { AlertCircle } from 'lucide-react'

const message_received_payload = {
  smsId: 'smsId',
  sender: '+123456789',
  message: 'message',
  receivedAt: '2025-10-05T13:00:35.208Z',
  deviceId: 'deviceId',
  webhookSubscriptionId: 'webhookSubscriptionId',
  webhookEvent: 'MESSAGE_RECEIVED',
}
const message_send_template = {
  smsId: 'smsId',
  smsBatchId: "smsBatchId",
  message: 'message',
  status: "delivered",
  recipient: "+123456789",
  deviceId: 'deviceId',
  webhookSubscriptionId: 'webhookSubscriptionId',
}

const sms_delivered_payload = {
  ...message_send_template,
  sentAt: "2025-10-05T13:00:35.208Z",
  deliveredAt: '2025-10-05T13:00:35.208Z',
  webhookEvent: 'MESSAGE_DELIVERED',
}
const sms_sent_payload = {
  ...message_send_template,
  status: "sent",
  webhookEvent: 'MESSAGE_SENT',
}

const sms_sent_failed = {
  ...message_send_template,
  status: "failed",
  errorCode: "ErorCode",
  errorMessage: "Error",
  failedAt: "2025-10-05T13:00:35.208Z",
  webhookEvent: 'MESSAGE_FAILED',
}

const VERIFICATION_CODE = `
// Node.js (Express). Verify against the raw request body, not re-serialized JSON.
const crypto = require('crypto');
const express = require('express');

const app = express();
const WEBHOOK_SECRET = process.env.TEXTBEE_WEBHOOK_SECRET;
const TOLERANCE_SECONDS = 300;

function verifyTextbeeSignature(rawBody, header, secret) {
  if (!header) return false;
  const parts = Object.fromEntries(header.split(',').map((p) => p.trim().split('=')));
  const t = Number(parts.t);
  if (!Number.isFinite(t) || Math.abs(Date.now() / 1000 - t) > TOLERANCE_SECONDS) return false;
  const expected = crypto.createHmac('sha256', secret).update(\`\${t}.\${rawBody}\`).digest('hex');
  const given = String(parts.v1 || '');
  return given.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected));
}

app.post('/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  const rawBody = req.body.toString('utf8');
  if (!verifyTextbeeSignature(rawBody, req.headers['x-textbee-signature'], WEBHOOK_SECRET)) {
    return res.status(401).json({ error: 'Invalid signature' });
  }
  const event = JSON.parse(rawBody);
  // Use event.idempotencyKey to skip duplicates from retries.
  res.status(200).send('OK');
});
`

const PYTHON_CODE = `
# Python (Flask). Verify against the raw request body.
import hashlib
import hmac
import os
import time
from flask import Flask, request

app = Flask(__name__)
WEBHOOK_SECRET = os.environ["TEXTBEE_WEBHOOK_SECRET"]
TOLERANCE_SECONDS = 300

def verify_textbee_signature(raw_body: bytes, header: str, secret: str) -> bool:
    if not header:
        return False
    parts = dict(p.strip().split("=", 1) for p in header.split(",") if "=" in p)
    try:
        t = int(parts["t"])
    except (KeyError, ValueError):
        return False
    if abs(time.time() - t) > TOLERANCE_SECONDS:
        return False
    signed = f"{t}.".encode() + raw_body
    expected = hmac.new(secret.encode(), signed, hashlib.sha256).hexdigest()
    return hmac.compare_digest(parts.get("v1", ""), expected)

@app.route("/webhook", methods=["POST"])
def webhook():
    if not verify_textbee_signature(request.get_data(), request.headers.get("X-Textbee-Signature"), WEBHOOK_SECRET):
        return "Invalid signature", 401
    event = request.get_json()
    # Use event["idempotencyKey"] to skip duplicates from retries.
    return "OK", 200
`

export function WebhookDocs() {
  return (
    <Accordion type='multiple' className='w-full space-y-3 sm:space-y-4'>
      <AccordionItem value='delivery' className='frame border rounded-lg bg-card'>
        <AccordionTrigger className='px-3 sm:px-4 hover:no-underline [&[data-state=open]>div]:bg-muted'>
          <div className='flex items-center gap-2 py-2 -my-2 px-2 rounded-md'>
            <AlertCircle className='h-4 w-4' />
            <span className='text-sm sm:text-base'>Webhook Delivery Information</span>
          </div>
        </AccordionTrigger>
        <AccordionContent className='px-3 sm:px-4 pb-4'>
          <div className='space-y-2 mt-2 text-sm text-muted-foreground'>
            <p>
              When a new SMS is received or SMS status is updated, we&apos;ll send a POST request to your
              webhook URL with the event data. Your endpoint should:
            </p>
            <ul className='list-disc pl-6 space-y-1'>
              <li>Accept POST requests</li>
              <li>Return a 2XX status code to acknowledge receipt</li>
              <li>Process the request within 10 seconds</li>
            </ul>
            <p className='mt-2'>
              If we don&apos;t receive a successful response, we&apos;ll retry the
              delivery at increasing intervals: 3 minutes, 5 minutes, 30 minutes,
              1 hour, 6 hours, 1 day, 3 days, 7 days, 30 days.
            </p>
          </div>
        </AccordionContent>
      </AccordionItem>

      <AccordionItem value='implementation' className='frame border rounded-lg bg-card'>
        <AccordionTrigger className='px-4 hover:no-underline [&[data-state=open]>div]:bg-muted'>
          <div className='flex items-center gap-2 py-2 -my-2 px-2 rounded-md'>
            <AlertCircle className='h-4 w-4' />
            <span>Security & Implementation Guide</span>
          </div>
        </AccordionTrigger>
        <AccordionContent className='px-4 pb-4'>
          <Tabs defaultValue='overview' className='w-full mt-4'>
            <TabsList>
              <TabsTrigger value='overview'>Overview</TabsTrigger>
              <TabsTrigger value='payload'>Payload</TabsTrigger>
              <TabsTrigger value='verification'>Verification</TabsTrigger>
            </TabsList>

            <TabsContent value='overview'>
              <div className='space-y-2 mt-4 text-sm text-muted-foreground'>
                <p>Each webhook request includes:</p>
                <ul className='list-disc pl-6 space-y-1'>
                  <li>Payload in JSON format</li>
                  <li>
                    <code>X-Textbee-Signature</code>:{' '}
                    <code>{'t=<unix seconds>,v1=<signature>'}</code>, where the
                    signature is the hex HMAC-SHA256 of{' '}
                    <code>{'<t>.<raw body>'}</code> with your signing secret
                  </li>
                  <li>
                    Reject the request if <code>t</code> is more than 5 minutes
                    from your server time. This stops replayed requests.
                  </li>
                  <li>
                    <code>X-Signature</code>: the older format, the hex
                    HMAC-SHA256 of the raw body. It is still sent for existing
                    integrations, but it does not protect against replays.
                  </li>
                </ul>
              </div>
            </TabsContent>

            <TabsContent value='payload'>
              <div className='space-y-4 mt-4'>
                <h4 className='text-sm font-medium'>Sample Payload</h4>
                <Tabs defaultValue='message_received'>

                <TabsList>
                  <TabsTrigger value='message_received'>Message Received</TabsTrigger>
                  <TabsTrigger value='message_sent'>Message Sent</TabsTrigger>
                  <TabsTrigger value='message_delivered'>Message Delivered</TabsTrigger>
                  <TabsTrigger value='message_failed'>Message Failed</TabsTrigger>
                </TabsList>
                <TabsContent value='message_received'>
                  <Code>{JSON.stringify(message_received_payload, null, 2)}</Code>
                </TabsContent>
                <TabsContent value='message_sent'>
                  <Code>{JSON.stringify(sms_sent_payload, null, 2)}</Code>
                </TabsContent>
                <TabsContent value='message_delivered'>
                  <Code>{JSON.stringify(sms_delivered_payload, null, 2)}</Code>
                </TabsContent>
                <TabsContent value='message_failed'>
                  <Code>{JSON.stringify(sms_sent_failed, null, 2)}</Code>
                </TabsContent>
                </Tabs>
                <p className='text-xs text-muted-foreground'>
                  Any event can also include <code>simUsed</code>, the SIM
                  that sent or received the message, for example{' '}
                  <code>
                    {'"simUsed": { "subscriptionId": 19, "slotIndex": 1, "carrierName": "Example Mobile", "displayName": "Work", "countryIso": "us", "mcc": "310", "mnc": "260" }'}
                  </code>
                  . It is present only when the textbee app on the phone
                  reports the SIM, and each field inside it is optional.
                </p>
              </div>
            </TabsContent>

            <TabsContent value='verification'>
              <div className='space-y-4 mt-4'>
                <Tabs defaultValue='node'>
                  <TabsList>
                    <TabsTrigger value='node'>Node.js</TabsTrigger>
                    <TabsTrigger value='python'>Python</TabsTrigger>
                  </TabsList>

                  <TabsContent value='node'>
                    <Code>{VERIFICATION_CODE}</Code>
                  </TabsContent>

                  <TabsContent value='python'>
                    <Code>{PYTHON_CODE}</Code>
                  </TabsContent>
                </Tabs>
              </div>
            </TabsContent>
          </Tabs>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  )
}
