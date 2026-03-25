// ============================================
// Ann AI Assistant - Dashboard Frontend
// ============================================
// Real-time dashboard: WebSocket, stats, activity feed, QR display

(function () {
  'use strict';

  // ── Configuration ──
  const WS_PORT = parseInt(location.port || '3847') + 1;
  const WS_URL = `ws://${location.hostname}:${WS_PORT}`;
  const RECONNECT_INTERVAL = 3000;

  // ── DOM Elements ──
  const $ = (id) => document.getElementById(id);
  const statusBadge = $('statusBadge');
  const statusText = $('statusText');
  const statMessages = $('statMessages');
  const statActive = $('statActive');
  const statCompleted = $('statCompleted');
  const statUptime = $('statUptime');
  const activityFeed = $('activityFeed');
  const activityCount = $('activityCount');
  const qrSection = $('qrSection');
  const connectionInfo = $('connectionInfo');
  const infoName = $('infoName');
  const infoNumber = $('infoNumber');
  const infoPlatform = $('infoPlatform');
  const infoConnectedSince = $('infoConnectedSince');
  const toastContainer = $('toastContainer');
  const particlesContainer = $('particles');

  // ── State ──
  let ws = null;
  let startTime = Date.now();
  let uptimeTimer = null;
  let activities = [];

  // ── WebSocket Connection ──
  function connect() {
    setStatus('connecting', 'Connecting...');

    try {
      ws = new WebSocket(WS_URL);
    } catch (err) {
      setStatus('disconnected', 'Connection Failed');
      scheduleReconnect();
      return;
    }

    ws.onopen = () => {
      setStatus('connecting', 'Waiting for agent...');
      showToast('📡', 'Connected to dashboard server');
    };

    ws.onmessage = (event) => {
      try {
        const { type, data, timestamp } = JSON.parse(event.data);
        handleMessage(type, data, timestamp);
      } catch (err) {
        console.error('Failed to parse WebSocket message:', err);
      }
    };

    ws.onclose = () => {
      setStatus('disconnected', 'Disconnected');
      scheduleReconnect();
    };

    ws.onerror = () => {
      // onclose will fire after this
    };
  }

  function scheduleReconnect() {
    setTimeout(connect, RECONNECT_INTERVAL);
  }

  // ── Message Handlers ──
  function handleMessage(type, data) {
    switch (type) {
      case 'status':
        handleStatusUpdate(data);
        break;
      case 'qr':
        handleQR(data);
        break;
      case 'ready':
        handleReady(data);
        break;
      case 'message':
        handleIncomingMessage(data);
        break;
      case 'stats':
        handleStats(data);
        break;
      case 'disconnected':
        handleDisconnected(data);
        break;
    }
  }

  function handleStatusUpdate(data) {
    if (data.whatsapp && data.whatsapp.isReady) {
      setStatus('connected', 'Connected');
      if (data.whatsapp.info) {
        showConnectionInfo(data.whatsapp.info);
      }
    } else if (data.whatsapp && data.whatsapp.qrCode) {
      setStatus('connecting', 'Scan QR Code');
      renderQR(data.whatsapp.qrCode);
    }

    if (data.stats) {
      handleStats(data.stats);
    }
  }

  function handleQR(data) {
    setStatus('connecting', 'Scan QR Code');
    renderQR(data.qr);
    showToast('📱', 'QR code ready — scan with WhatsApp');
  }

  function handleReady(data) {
    setStatus('connected', 'Connected');
    startTime = Date.now();
    showConnectionInfo(data);
    showToast('✅', `Connected as ${data.name}`);
  }

  function handleIncomingMessage(data) {
    addActivity({
      user: data.sender,
      message: data.body,
      action: data.isGroup ? 'group' : 'chat',
      timestamp: new Date().toISOString(),
    });
  }

  function handleStats(data) {
    if (data.messagesProcessed !== undefined) {
      animateCounter(statMessages, data.messagesProcessed);
    }
    if (data.recentActivity) {
      data.recentActivity.slice(0, 20).forEach((item) => {
        addActivity(item, true);
      });
    }
  }

  function handleDisconnected(data) {
    setStatus('disconnected', 'Disconnected');
    qrSection.style.display = '';
    connectionInfo.style.display = 'none';
    showToast('❌', `WhatsApp disconnected: ${data.reason || 'unknown'}`);
  }

  // ── Status Badge ──
  function setStatus(state, text) {
    statusBadge.className = `status-badge ${state}`;
    statusText.textContent = text;
  }

  // ── QR Code Rendering ──
  function renderQR(qrData) {
    qrSection.innerHTML = `
      <div style="font-size: 48px; margin-bottom: 16px;">📱</div>
      <h3 style="margin-bottom: 8px;">Scan QR Code</h3>
      <p class="qr-instructions" style="margin-bottom: 16px;">
        Open WhatsApp → Settings → Linked Devices → Link a Device
      </p>
      <div class="qr-container">
        <canvas id="qrCanvas"></canvas>
      </div>
    `;
    qrSection.style.display = '';
    connectionInfo.style.display = 'none';

    // Render QR code to canvas
    const canvas = document.getElementById('qrCanvas');
    if (canvas && qrData) {
      drawQR(canvas, qrData);
    }
  }

  /**
   * Simple QR-string-to-canvas renderer.
   * Uses a basic approach: renders each module as a filled rect.
   * For proper QR rendering, we generate from the raw data.
   */
  function drawQR(canvas, data) {
    // Since we receive the QR as a string, we'll use a simple
    // text-based display if canvas QR library isn't available
    const parent = canvas.parentElement;

    // Create a text-based QR display as fallback
    const pre = document.createElement('pre');
    pre.style.cssText = `
      font-family: monospace;
      font-size: 5px;
      line-height: 5px;
      letter-spacing: 1px;
      color: #000;
      background: #fff;
      padding: 10px;
      display: inline-block;
      white-space: pre;
    `;

    // Convert QR string data to block characters for display
    // The qrcode-terminal library outputs text; we replicate that
    const lines = data.split ? data.split('') : [];
    if (typeof data === 'string' && data.length > 10) {
      // Try to render as image using an inline QR approach
      const img = document.createElement('img');
      img.src = `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(data)}`;
      img.alt = 'WhatsApp QR Code';
      img.style.cssText = 'width: 250px; height: 250px; display: block;';
      img.onerror = () => {
        // Fallback: just show instructions
        parent.innerHTML = `
          <p style="color: #333; font-size: 14px; padding: 20px;">
            QR code generated — check your terminal to scan it.
          </p>
        `;
      };
      parent.innerHTML = '';
      parent.appendChild(img);
    }
  }

  function showConnectionInfo(info) {
    qrSection.style.display = 'none';
    connectionInfo.style.display = '';
    infoName.textContent = info.name || '—';
    infoNumber.textContent = info.number || '—';
    infoPlatform.textContent = info.platform || '—';
    infoConnectedSince.textContent = new Date().toLocaleTimeString();
  }

  // ── Activity Feed ──
  function addActivity(item, silent) {
    // Avoid duplicates
    const key = `${item.user}-${item.message}-${item.action}`;
    if (activities.includes(key)) return;
    activities.push(key);
    if (activities.length > 100) activities = activities.slice(-50);

    const actionClass = getActionClass(item.action);
    const actionLabel = getActionLabel(item.action);
    const initials = getInitials(item.user || 'U');
    const timeAgo = formatTimeAgo(item.timestamp);

    const el = document.createElement('div');
    el.className = 'activity-item';
    el.style.animation = silent ? 'none' : 'slideIn 0.3s ease';
    el.innerHTML = `
      <div class="activity-avatar">${initials}</div>
      <div class="activity-content">
        <div class="activity-user">${escapeHTML(item.user || 'Unknown')}</div>
        <div class="activity-message">${escapeHTML(item.message || '')}</div>
        <span class="activity-action ${actionClass}">${actionLabel}</span>
      </div>
      <span class="activity-time">${timeAgo}</span>
    `;

    // Remove empty state if present
    const emptyState = activityFeed.querySelector('.empty-state');
    if (emptyState) emptyState.remove();

    // Add to top
    activityFeed.prepend(el);

    // Limit to 50 items in DOM
    while (activityFeed.children.length > 50) {
      activityFeed.removeChild(activityFeed.lastChild);
    }

    activityCount.textContent = `${activityFeed.children.length} events`;
  }

  function getActionClass(action) {
    const map = {
      add_todo: 'add',
      complete_todo: 'complete',
      delete_todo: 'delete',
      chat: 'chat',
      list_todos: 'chat',
      get_summary: 'chat',
      update_todo: 'add',
      create_sheet: 'add',
      group: 'chat',
    };
    return map[action] || 'chat';
  }

  function getActionLabel(action) {
    const map = {
      add_todo: 'ADD',
      complete_todo: 'DONE',
      delete_todo: 'DEL',
      chat: 'CHAT',
      list_todos: 'LIST',
      get_summary: 'STATS',
      update_todo: 'EDIT',
      create_sheet: 'SHEET',
      group: 'GROUP',
    };
    return map[action] || action.toUpperCase();
  }

  // ── Counter Animation ──
  function animateCounter(el, target) {
    const current = parseInt(el.textContent) || 0;
    if (current === target) return;

    const duration = 500;
    const steps = 20;
    const increment = (target - current) / steps;
    let step = 0;

    const timer = setInterval(() => {
      step++;
      if (step >= steps) {
        el.textContent = target;
        clearInterval(timer);
      } else {
        el.textContent = Math.round(current + increment * step);
      }
    }, duration / steps);
  }

  // ── Uptime Timer ──
  function startUptimeTimer() {
    uptimeTimer = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const minutes = Math.floor(elapsed / 60000);
      const hours = Math.floor(minutes / 60);

      if (hours > 0) {
        statUptime.textContent = `${hours}h ${minutes % 60}m`;
      } else {
        statUptime.textContent = `${minutes}m`;
      }
    }, 10000); // Update every 10s
  }

  // ── Toast Notifications ──
  function showToast(icon, message) {
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.innerHTML = `<span>${icon}</span><span>${escapeHTML(message)}</span>`;
    toastContainer.appendChild(toast);

    // Auto-remove after animation
    setTimeout(() => {
      if (toast.parentNode) toast.remove();
    }, 4000);
  }

  // ── Floating Particles ──
  function createParticles() {
    const count = 25;
    const colors = [
      'var(--accent-gold)',
      'var(--accent-blue)',
      'var(--accent-purple)',
      'var(--accent-green)',
    ];

    for (let i = 0; i < count; i++) {
      const particle = document.createElement('div');
      particle.className = 'particle';
      particle.style.left = `${Math.random() * 100}%`;
      particle.style.animationDuration = `${15 + Math.random() * 20}s`;
      particle.style.animationDelay = `${Math.random() * 15}s`;
      particle.style.width = `${1 + Math.random() * 3}px`;
      particle.style.height = particle.style.width;
      particle.style.background = colors[Math.floor(Math.random() * colors.length)];
      particle.style.opacity = `${0.1 + Math.random() * 0.3}`;
      particlesContainer.appendChild(particle);
    }
  }

  // ── Helpers ──
  function getInitials(name) {
    return name
      .split(' ')
      .map((w) => w[0])
      .join('')
      .substring(0, 2)
      .toUpperCase();
  }

  function formatTimeAgo(timestamp) {
    if (!timestamp) return '';
    const diff = Date.now() - new Date(timestamp).getTime();
    const seconds = Math.floor(diff / 1000);
    if (seconds < 60) return 'just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  }

  function escapeHTML(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // ── Initialize ──
  function init() {
    createParticles();
    startUptimeTimer();
    connect();
  }

  // Start when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
