// ============================================
// Ann AI Assistant - Dashboard Server
// ============================================
// Express server serving the monitoring dashboard

import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { config } from 'dotenv';

config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = parseInt(process.env.DASHBOARD_PORT || '3847');

// Serve static files
app.use(express.static(join(__dirname, 'public')));

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

app.listen(PORT, () => {
  console.log(`\n🖥️  Dashboard running at http://localhost:${PORT}`);
  console.log(`📡 WebSocket at ws://localhost:${PORT + 1}\n`);
});

export default app;
