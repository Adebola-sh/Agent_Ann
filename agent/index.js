// ============================================
// Sheet Manager - Main Entry Point
// ============================================
// Bootstraps all services and starts the agent

import WhatsAppService from './whatsapp-service.js';
import GeminiService from './gemini-service.js';
import SheetsService from './sheets-service.js';
import MessageHandler from './message-handler.js';
import { config } from 'dotenv';
import { WebSocketServer } from 'ws';

config();

// ASCII Art Banner
console.log(`
╔══════════════════════════════════════════════════╗
║                                                  ║
║   📋  S H E E T   M A N A G E R  📋             ║
║                                                  ║
║   WhatsApp + Gemini AI + Google Sheets           ║
║   Todo List Management Bot                       ║
║                                                  ║
╚══════════════════════════════════════════════════╝
`);

// Global references for dashboard access
let whatsapp, gemini, sheets, handler;
let wsServer = null;
const dashboardClients = new Set();

/**
 * Broadcast a message to all connected dashboard clients
 */
function broadcastToDashboard(type, data) {
  const message = JSON.stringify({ type, data, timestamp: Date.now() });
  dashboardClients.forEach((client) => {
    if (client.readyState === 1) {
      client.send(message);
    }
  });
}

/**
 * Start the WebSocket server for real-time dashboard updates
 */
function startWebSocket(port) {
  wsServer = new WebSocketServer({ port: port + 1 });

  wsServer.on('connection', (ws) => {
    dashboardClients.add(ws);
    console.log('🖥️  Dashboard client connected');

    // Send current status
    ws.send(
      JSON.stringify({
        type: 'status',
        data: {
          whatsapp: whatsapp?.getStatus(),
          stats: handler?.getStats(),
        },
        timestamp: Date.now(),
      })
    );

    ws.on('close', () => {
      dashboardClients.delete(ws);
    });
  });

  console.log(`📡 WebSocket server running on port ${port + 1}`);
}

/**
 * Main bootstrap function
 */
async function main() {
  const dashboardPort = parseInt(process.env.DASHBOARD_PORT || '3847');

  try {
    // ── Step 1: Initialize Gemini AI ──
    console.log('\n🤖 Step 1/3: Initializing Gemini AI...');
    gemini = new GeminiService();
    await gemini.initialize();

    // ── Step 2: Initialize Google Sheets ──
    console.log('\n📊 Step 2/3: Initializing Google Sheets...');
    sheets = new SheetsService();
    await sheets.initialize();

    // ── Step 3: Initialize WhatsApp ──
    console.log('\n📱 Step 3/3: Initializing WhatsApp...');
    whatsapp = new WhatsAppService();

    // Create the message handler
    handler = new MessageHandler(whatsapp, gemini, sheets);

    // Wire up WhatsApp events
    whatsapp.on('qr', (qr) => {
      broadcastToDashboard('qr', { qr });
    });

    whatsapp.on('ready', (info) => {
      broadcastToDashboard('ready', info);
      console.log('\n🚀 Sheet Manager is fully operational!');
      console.log(`   📱 WhatsApp: Connected as ${info.name}`);
      console.log(`   🤖 AI: Gemini 2.0 Flash`);
      console.log(`   📊 Sheets: ${sheets.spreadsheetId}`);
      console.log(`   🖥️  Dashboard: http://localhost:${dashboardPort}`);
      console.log('\n   Send a WhatsApp message to get started!\n');
    });

    whatsapp.on('message', async (messageData) => {
      broadcastToDashboard('message', {
        sender: messageData.senderName,
        body: messageData.body.substring(0, 100),
        isGroup: messageData.isGroup,
      });

      await handler.handleMessage(messageData);

      // Send updated stats to dashboard
      broadcastToDashboard('stats', handler.getStats());
    });

    whatsapp.on('disconnected', (reason) => {
      broadcastToDashboard('disconnected', { reason });
    });

    // Start WebSocket for dashboard
    startWebSocket(dashboardPort);

    // Initialize WhatsApp (this will trigger QR code if needed)
    await whatsapp.initialize();
  } catch (error) {
    console.error('\n💥 Failed to start Sheet Manager:', error.message);
    console.error('\n📖 Troubleshooting:');
    console.error('   1. Check your .env file has all required keys');
    console.error('   2. Ensure credentials.json exists for Google Sheets');
    console.error('   3. Make sure you have a stable internet connection');
    console.error('   4. Run "npm run setup" for guided configuration\n');
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n\n🛑 Shutting down Sheet Manager...');

  if (whatsapp) {
    await whatsapp.destroy();
  }
  if (wsServer) {
    wsServer.close();
  }

  console.log('👋 Goodbye!\n');
  process.exit(0);
});

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', reason);
});

// Start the application
main();
