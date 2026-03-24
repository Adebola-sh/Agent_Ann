// ============================================
// Sheet Manager - WhatsApp Service
// ============================================
// Connects to WhatsApp and handles message routing

import pkg from 'whatsapp-web.js';
const { Client, LocalAuth } = pkg;
import qrcode from 'qrcode-terminal';
import { config } from 'dotenv';
import { EventEmitter } from 'events';

config();

class WhatsAppService extends EventEmitter {
  constructor() {
    super();
    this.client = null;
    this.isReady = false;
    this.qrCode = null;
    this.connectionInfo = null;
  }

  /**
   * Initialize and start the WhatsApp client
   */
  async initialize() {
    this.client = new Client({
      authStrategy: new LocalAuth({ dataPath: './.wwebjs_auth' }),
      puppeteer: {
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--disable-gpu',
        ],
      },
    });

    this.setupEventListeners();

    console.log('🔄 Initializing WhatsApp client...');
    await this.client.initialize();

    return this;
  }

  /**
   * Set up WhatsApp event listeners
   */
  setupEventListeners() {
    // QR Code generation for authentication
    this.client.on('qr', (qr) => {
      this.qrCode = qr;
      console.log('\n📱 Scan this QR code with WhatsApp:');
      console.log('   Open WhatsApp → Settings → Linked Devices → Link a Device\n');
      qrcode.generate(qr, { small: true });
      this.emit('qr', qr);
    });

    // Client is authenticated
    this.client.on('authenticated', () => {
      console.log('🔐 WhatsApp authenticated successfully');
      this.emit('authenticated');
    });

    // Client passthrough ready
    this.client.on('ready', () => {
      this.isReady = true;
      const info = this.client.info;
      this.connectionInfo = {
        name: info.pushname,
        number: info.wid.user,
        platform: info.platform,
      };
      console.log(`✅ WhatsApp ready! Connected as: ${info.pushname} (${info.wid.user})`);
      this.emit('ready', this.connectionInfo);
    });

    // Handle incoming messages
    this.client.on('message', async (message) => {
      // Ignore status updates and group messages (optional — can    be enabled)
      if (message.isStatus) return;

      const contact = await message.getContact();
      const chat = await message.getChat();

      const messageData = {
        id: message.id._serialized,
        from: message.from,
        body: message.body,
        timestamp: message.timestamp,
        isGroup: chat.isGroup,
        groupName: chat.isGroup ? chat.name : null,
        senderName: contact.pushname || contact.name || 'Unknown',
        senderNumber: contact.number,
        hasMedia: message.hasMedia,
        type: message.type,
      };

      console.log(
        `📩 ${messageData.senderName}: "${messageData.body.substring(0, 50)}${messageData.body.length > 50 ? '...' : ''}"`
      );

      this.emit('message', messageData);
    });

    // Handle disconnections
    this.client.on('disconnected', (reason) => {
      this.isReady = false;
      console.log('❌ WhatsApp disconnected:', reason);
      this.emit('disconnected', reason);
    });

    // Handle auth failure
    this.client.on('auth_failure', (error) => {
      console.error('🔒 Auth failure:', error);
      this.emit('auth_failure', error);
    });
  }

  /**
   * Send a text message
   */
  async sendMessage(to, text) {
    if (!this.isReady) {
      throw new Error('WhatsApp client is not ready');
    }

    try {
      await this.client.sendMessage(to, text);
      console.log(`📤 Sent to ${to}: "${text.substring(0, 50)}..."`);
      return true;
    } catch (error) {
      console.error(`Failed to send message to ${to}:`, error.message);
      return false;
    }
  }

  /**
   * Send a message with typing indicator
   */
  async sendWithTyping(to, text, typingDuration = 1500) {
    if (!this.isReady) {
      throw new Error('WhatsApp client is not ready');
    }

    try {
      const chat = await this.client.getChatById(to);
      await chat.sendStateTyping();
      await new Promise((resolve) => setTimeout(resolve, typingDuration));
      await chat.clearState();
      await this.client.sendMessage(to, text);
      return true;
    } catch (error) {
      console.error(`Failed to send with typing to ${to}:`, error.message);
      // Fallback to direct send
      return this.sendMessage(to, text);
    }
  }

  /**
   * Get connection status
   */
  getStatus() {
    return {
      isReady: this.isReady,
      info: this.connectionInfo,
      qrCode: this.qrCode,
    };
  }

  /**
   * Destroy the client
   */
  async destroy() {
    if (this.client) {
      await this.client.destroy();
    }
  }
}

export default WhatsAppService;
