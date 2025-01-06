const express = require("express");
const fs = require("fs");
const grpc = require("@grpc/grpc-js");
const protoLoader = require("@grpc/proto-loader");
const WebSocket = require("ws");
const fetch = require("node-fetch");

const loaderOptions = {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
};

class VoltageWebhookService {
  constructor(host, macaroonPath, protoPath) {
    this.subscriptions = new Map();
    this.setupLndClient(host, macaroonPath, protoPath);
    this.setupWebSocket();
  }

  setupLndClient(host, macaroonPath, protoPath) {
    // Set required environment variable
    process.env.GRPC_SSL_CIPHER_SUITES = "HIGH+ECDSA";

    // Read and set up macaroon
    const macaroon = fs.readFileSync(macaroonPath).toString("hex");
    const metadata = new grpc.Metadata();
    metadata.add("macaroon", macaroon);
    const macaroonCreds = grpc.credentials.createFromMetadataGenerator(
      (_, callback) => callback(null, metadata),
    );

    // Set up credentials
    const sslCreds = grpc.credentials.createSsl();
    const credentials = grpc.credentials.combineChannelCredentials(
      sslCreds,
      macaroonCreds,
    );

    // Load proto and create client
    const packageDefinition = protoLoader.loadSync(protoPath, loaderOptions);
    const lnrpc = grpc.loadPackageDefinition(packageDefinition).lnrpc;
    this.client = new lnrpc.Lightning(host, credentials);

    this.startInvoiceSubscription();
  }

  setupWebSocket() {
    this.wss = new WebSocket.Server({ port: 8080 });
    console.log("WebSocket server started on port 8080");

    this.wss.on("connection", (ws) => {
      console.log("New WebSocket client connected");
      ws.send(JSON.stringify({ type: "CONNECTED" }));
    });
  }

  startInvoiceSubscription() {
    const stream = this.client.subscribeInvoices({});

    stream.on("data", (invoice) => {
      console.log("Received invoice update:", invoice);

      const event = {
        type: invoice.settled ? "INVOICE_PAID" : "INVOICE_EXPIRED",
        invoiceId: invoice.r_hash.toString("hex"),
        amount: invoice.value,
        memo: invoice.memo,
        settled: invoice.settled,
        settleDate: invoice.settle_date,
        creationDate: invoice.creation_date,
      };

      // Notify webhook endpoints
      this.notifySubscribers(event.invoiceId, event);
    });

    stream.on("error", (error) => {
      console.error("Invoice subscription error:", error);
      // Implement retry logic
      setTimeout(() => this.startInvoiceSubscription(), 5000);
    });
  }

  async notifySubscribers(invoiceId, event) {
    const subscribers = this.subscriptions.get(invoiceId) || [];
    console.log("Current subscriptions:", this.subscriptions);
    console.log(
      `Attempting to notify ${subscribers.length} subscribers for invoice ${invoiceId}`,
    );

    for (const sub of subscribers) {
      console.log(
        `Sending webhook to ${sub.endpoint} for invoice ${invoiceId}`,
      );
      try {
        const response = await fetch(sub.endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(event),
          timeout: 10000, // 10 second timeout
        });

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        console.log(`Successfully sent webhook to ${sub.endpoint}:`, {
          status: response.status,
          event: event,
        });
      } catch (error) {
        console.error(`Failed to notify webhook ${sub.endpoint}:`, {
          error: error.message,
          event: event,
        });
      }
    }

    // Notify WebSocket clients
    const connectedClients = Array.from(this.wss.clients).filter(
      (client) => client.readyState === WebSocket.OPEN,
    );
    console.log(`Sending to ${connectedClients.length} WebSocket clients`);

    connectedClients.forEach((client) => {
      try {
        client.send(JSON.stringify(event));
      } catch (err) {
        console.error("WebSocket send error:", err);
      }
    });
  }

  subscribeToInvoice(invoiceId, webhookEndpoint) {
    if (!this.subscriptions.has(invoiceId)) {
      this.subscriptions.set(invoiceId, []);
    }

    this.subscriptions.get(invoiceId).push({
      invoiceId,
      endpoint: webhookEndpoint,
    });

    console.log("Updated subscriptions:", {
      invoiceId,
      endpoint: webhookEndpoint,
      allSubscriptions: Object.fromEntries(this.subscriptions),
    });

    return {
      success: true,
      subscriptionCount: this.subscriptions.get(invoiceId).length,
    };
  }
}

// Create Express server
const app = express();
app.use(express.json());

// Initialize the webhook service
const webhookService = new VoltageWebhookService(
  "your-node.voltageapp.io:10009",
  "/home/runner/lnd-invoices-webhook-proxy/admin.macaroon",
  "/home/runner/lnd-invoices-webhook-proxy/lightning.proto",
);

// Endpoint to register webhooks
app.post("/subscribe", (req, res) => {
  const { invoiceId, webhookEndpoint } = req.body;
  
  if (!invoiceId || !webhookEndpoint) {
    return res.status(400).json({
      success: false,
      error: "Missing required fields",
    });
  }

  try {
    new URL(webhookEndpoint); // Validate URL format
  } catch (e) {
    return res.status(400).json({
      success: false,
      error: "Invalid webhook URL",
    });
  }

  console.log("Subscribing to invoice:", {
    invoiceId,
    webhookEndpoint,
    currentSubscriptions: webhookService.subscriptions.size,
  });

  const result = webhookService.subscribeToInvoice(invoiceId, webhookEndpoint);
  res.json(result);
});

// Create test invoice endpoint
app.post("/create-invoice", (req, res) => {
  const { amount, memo } = req.body;
  webhookService.client.addInvoice(
    {
      value: amount,
      memo: memo || "Test invoice",
    },
    (err, response) => {
      if (err) {
        res.status(500).json({ error: err.message });
      } else {
        res.json({
          paymentRequest: response.payment_request,
          rHash: response.r_hash.toString("hex"),
        });
      }
    },
  );
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Webhook service listening on port ${PORT}`);
});
