// Node 20+. Run behind an HTTPS reverse proxy that forwards the session path.
// APPLE_PAY_MERCHANT_ID: Sandbox Merchant ID.
// APPLE_PAY_IDENTITY_CERT and APPLE_PAY_IDENTITY_KEY: paths to private server-side PEM files.
// APPLE_PAY_ORIGIN: exact checkout origin, defaults to the GitHub Pages origin.
// APPLE_PAY_DISPLAY_NAME: merchant name shown by Apple, defaults to iiko by CoinPay.
// Endpoint: POST /apple-pay/session. Use its public HTTPS URL as appleConfig.sessionUrl.

import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { request } from 'node:https';

const origin = new URL(process.env.APPLE_PAY_ORIGIN || 'https://zaurnatok.github.io');
const merchantIdentifier = process.env.APPLE_PAY_MERCHANT_ID;
const certPath = process.env.APPLE_PAY_IDENTITY_CERT;
const keyPath = process.env.APPLE_PAY_IDENTITY_KEY;
if (!merchantIdentifier || !certPath || !keyPath || origin.protocol !== 'https:') {
  throw new Error('Configure the Sandbox Merchant ID, identity PEM files and HTTPS checkout origin');
}
const cert = readFileSync(certPath);
const key = readFileSync(keyPath);
const appleSandbox = 'https://apple-pay-gateway-cert.apple.com/paymentservices/paymentSession';
const sessionData = JSON.stringify({
  merchantIdentifier,
  displayName: process.env.APPLE_PAY_DISPLAY_NAME || 'iiko by CoinPay',
  initiative: 'web',
  initiativeContext: origin.hostname
});

function merchantSession() {
  return new Promise((resolve, reject) => {
    const serverRequest = request(appleSandbox, {
      method: 'POST', cert, key, minVersion: 'TLSv1.2',
      headers: {'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(sessionData)}
    }, apple => {
      if (apple.statusCode !== 200) {
        apple.resume();
        reject(new Error('Apple Sandbox rejected validation: ' + apple.statusCode));
        return;
      }
      let body = '';
      apple.setEncoding('utf8');
      apple.on('data', chunk => {
        body += chunk;
        if (body.length > 128000) apple.destroy(new Error('Unexpected response size'));
      });
      apple.on('end', () => {
        try { resolve(JSON.parse(body)); } catch (error) { reject(error); }
      });
      apple.on('error', reject);
    });
    serverRequest.setTimeout(10000, () => serverRequest.destroy(new Error('Apple Sandbox timeout')));
    serverRequest.on('error', reject);
    serverRequest.end(sessionData);
  });
}

createServer(async (client, response) => {
  if (client.url !== '/apple-pay/session' || client.method !== 'POST') {
    response.writeHead(404).end();
    return;
  }
  if (client.headers.origin !== origin.origin) {
    response.writeHead(403).end();
    return;
  }
  response.setHeader('Access-Control-Allow-Origin', origin.origin);
  response.setHeader('Vary', 'Origin');
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Content-Type', 'application/json');
  if (client.headers['transfer-encoding'] || Number(client.headers['content-length'] || 0) !== 0) {
    response.writeHead(400).end(JSON.stringify({error:'Request body is not supported'}));
    return;
  }
  try {
    response.end(JSON.stringify(await merchantSession()));
  } catch (error) {
    console.error(error.message);
    response.writeHead(502).end(JSON.stringify({error:'Sandbox merchant validation failed'}));
  }
}).listen(Number(process.env.PORT || 8080), '127.0.0.1');
