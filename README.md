# LND Invoice Webhook Service

This service enables webhook notifications for Lightning Network (LND) invoice events. It bridges LND's subscription-based system with a webhook architecture, allowing you to receive notifications when invoices are paid or expire. The service also provides WebSocket support for real-time updates in frontend applications.

## Quick Start

1. Install dependencies:
```bash
npm install express @grpc/grpc-js @grpc/proto-loader ws node-fetch
```

2. Configure your environment:
   - Place your `lightning.proto` file in your project directory
   - Add your LND node's `admin.macaroon` file to your project
   - Update the service initialization with your LND node details:
   ```javascript
   const webhookService = new VoltageWebhookService(
     "your-node.voltageapp.io:10009",
     "/path/to/admin.macaroon",
     "/path/to/lightning.proto"
   );
   ```

3. Run the service:
```bash
node index.js
```

## Usage Example

1. Create a new invoice:
```bash
curl -X POST http://your-service-url/create-invoice \
  -H "Content-Type: application/json" \
  -d '{
    "amount": 1000,
    "memo": "Test payment"
  }'
```

Response:
```json
{
  "paymentRequest": "lnbc...",
  "rHash": "invoice_hash_here"
}
```

2. Subscribe to invoice updates:
```bash
curl -X POST http://your-service-url/subscribe \
  -H "Content-Type: application/json" \
  -d '{
    "invoiceId": "invoice_hash_from_step_1",
    "webhookEndpoint": "https://your-webhook-endpoint.com/hook"
  }'
```

3. Receive webhook notifications when the invoice is paid or expires:
```json
{
  "type": "INVOICE_PAID",
  "invoiceId": "invoice_hash",
  "amount": "1000",
  "memo": "Test payment",
  "settled": true,
  "settleDate": "1234567890",
  "creationDate": "1234567890"
}
```

## Real-time Updates via WebSocket

Connect to the WebSocket server to receive real-time updates:

```javascript
const ws = new WebSocket('ws://your-service-url:8080');

ws.onmessage = (event) => {
  const invoiceEvent = JSON.parse(event.data);
  console.log('Received invoice event:', invoiceEvent);
};
```

## Service Features

The service provides several key capabilities:

1. Invoice Creation: Generate new Lightning Network invoices through a simple API endpoint.

2. Webhook Notifications: Receive HTTP POST notifications when invoices are paid or expire.

3. WebSocket Support: Get real-time updates through WebSocket connections.

4. Automatic Reconnection: The service automatically reconnects to LND if the connection is lost.

5. Error Handling: Comprehensive error handling and logging for debugging.

## API Reference

### Create Invoice
- **Endpoint**: POST `/create-invoice`
- **Body**:
  ```json
  {
    "amount": number,  // Amount in satoshis
    "memo": string    // Optional memo
  }
  ```

### Subscribe to Invoice Updates
- **Endpoint**: POST `/subscribe`
- **Body**:
  ```json
  {
    "invoiceId": string,    // Invoice hash
    "webhookEndpoint": string  // Your webhook URL
  }
  ```

## Event Types

The service emits two types of events:

1. `INVOICE_PAID`: When an invoice is settled successfully
2. `INVOICE_EXPIRED`: When an invoice expires or is canceled

## Development and Testing

For testing webhooks locally:

1. Use a service like webhook.site to get a temporary webhook endpoint
2. Create a test invoice and subscribe to updates
3. Monitor the service logs for detailed information about webhook delivery
4. Check webhook.site for received notifications

## Troubleshooting

Common issues and solutions:

1. Connection Errors: Verify your LND node address and credentials
2. Webhook Failures: Ensure your webhook endpoint is accessible and responds within 10 seconds
3. Missing Updates: Check the service logs for subscription status and event processing

## Security Considerations

1. Store macaroon and TLS credentials securely
2. Use HTTPS for webhook endpoints in production
3. Implement authentication for the API endpoints
4. Monitor webhook delivery failures
5. Consider implementing webhook signing for security