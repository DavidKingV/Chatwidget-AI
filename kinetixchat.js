/*!
 * KinetixChat - Embedded n8n chat widget
 * Vanilla JS, Shadow DOM isolated, WordPress-friendly.
 *
 * Two ways to mount:
 *
 * 1) Auto-init via data attributes (preferred for WordPress):
 *    <div data-kinetix-chat
 *         data-webhook-url="https://n8n.example.com/webhook/..."
 *         data-brand-name="Alexandra"
 *         data-primary-color="#0f766e"
 *         data-welcome-message="Hola, ..."></div>
 *
 * 2) Programmatic init:
 *    <div id="chat"></div>
 *    <script>KinetixChat.init({ target: '#chat', webhookUrl: '...' });</script>
 */
(function (global) {
  'use strict';

  var BASE_STORAGE_KEY = 'kinetix-chat';
  var REQUEST_TIMEOUT_MS = 60000;

  var DEFAULTS = {
    target: null,
    webhookUrl: '',
    route: '',
    brand: {
      name: 'Asistente',
      avatarUrl: '',
      statusText: 'En línea',
      footerText: ''
    },
    ui: {
      primaryColor: '#0f766e',
      userBubbleColor: '#1f2937',
      userBubbleTextColor: '#ffffff',
      botBubbleColor: '#ffffff',
      botBubbleTextColor: '#1f2937',
      backgroundColor: '#fafafa',
      fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
      placeholder: 'Escribe tu mensaje...',
      welcomeMessage: '¡Hola! ¿En qué puedo ayudarte?'
    },
    i18n: {
      clearConversation: 'Borrar conversación',
      confirmClear: '¿Borrar toda la conversación?',
      confirmYes: 'Sí, borrar',
      confirmNo: 'Cancelar',
      errorMessage: 'No pude conectar con el asistente. Intenta de nuevo.',
      todayLabel: 'Hoy',
      typingLabel: 'escribiendo...'
    },
    privacy: {
      enabled: true,
      url: '',
      title: 'Antes de comenzar',
      text: 'Este asistente es una guía orientativa. No reemplaza la consulta con un profesional de la salud. Su propósito es ayudarte a describir tu caso para que recibas la atención adecuada en la clínica.',
      linkLabel: 'Leer aviso de privacidad',
      acceptLabel: 'Acepto y continúo'
    }
  };

  // ---------- utils ----------
  function uuid() {
    if (global.crypto && typeof global.crypto.randomUUID === 'function') {
      return global.crypto.randomUUID();
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0;
      var v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  // djb2-style hash → short stable suffix for storage key namespacing
  function shortHash(str) {
    var h = 5381;
    for (var i = 0; i < str.length; i++) {
      h = ((h << 5) + h + str.charCodeAt(i)) | 0;
    }
    return (h >>> 0).toString(36);
  }

  function deepMerge(target, source) {
    var out = {};
    var key;
    for (key in target) out[key] = target[key];
    if (!source) return out;
    for (key in source) {
      if (
        source[key] &&
        typeof source[key] === 'object' &&
        !Array.isArray(source[key])
      ) {
        out[key] = deepMerge(target[key] || {}, source[key]);
      } else if (source[key] !== undefined && source[key] !== null && source[key] !== '') {
        out[key] = source[key];
      }
    }
    return out;
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function formatText(str) {
    var safe = escapeHtml(str).replace(/\n/g, '<br>');
    return safe.replace(
      /(https?:\/\/[^\s<]+)/g,
      '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>'
    );
  }

  // Insert an <img> inside a circular avatar container. On load error, restore
  // the provided fallback (text or HTML). Keeps Instagram-style cropping via
  // object-fit:cover in CSS.
  function setAvatarImage(container, url, fallbackText, fallbackHtml) {
    if (!url) {
      if (fallbackText) container.textContent = fallbackText;
      else if (fallbackHtml) container.innerHTML = fallbackHtml;
      return;
    }
    var img = document.createElement('img');
    img.className = 'kxc-avatar-img';
    img.src = url;
    img.alt = fallbackText || '';
    img.loading = 'lazy';
    img.decoding = 'async';
    img.referrerPolicy = 'no-referrer';
    img.addEventListener('error', function () {
      container.innerHTML = '';
      if (fallbackText) container.textContent = fallbackText;
      else if (fallbackHtml) container.innerHTML = fallbackHtml;
    });
    container.appendChild(img);
  }

  function formatTime(ts) {
    var d = new Date(ts);
    var h = d.getHours();
    var m = d.getMinutes();
    var ampm = h >= 12 ? 'PM' : 'AM';
    h = h % 12;
    if (h === 0) h = 12;
    return h + ':' + (m < 10 ? '0' + m : m) + ' ' + ampm;
  }

  // ---------- styles (injected into each shadow root) ----------
  var STYLES =
    /* host reset: make widget fill its container, isolate from theme */
    ':host{all:initial;display:block;width:100%;height:100%;contain:content}' +
    '*,*::before,*::after{box-sizing:border-box}' +
    '.kxc-root{width:100%;height:100%;display:flex;flex-direction:column;' +
    'font-family:var(--kxc-font);background:var(--kxc-bg);color:#1f2937;' +
    'border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;position:relative;' +
    'min-height:400px;line-height:1.45;font-size:14px}' +

    /* header */
    '.kxc-header{display:flex;align-items:center;gap:12px;padding:14px 16px;' +
    'background:#fff;border-bottom:1px solid #eef0f2;flex-shrink:0}' +
    '.kxc-avatar{width:36px;height:36px;border-radius:50%;background:#e5e7eb;' +
    'flex-shrink:0;display:flex;align-items:center;justify-content:center;' +
    'color:#6b7280;font-weight:600;overflow:hidden;' +
    'box-shadow:inset 0 0 0 1px rgba(0,0,0,.06)}' +
    '.kxc-avatar-img{width:100%;height:100%;object-fit:cover;object-position:center;' +
    'display:block;border:0}' +
    '.kxc-brand{flex:1;min-width:0}' +
    '.kxc-brand-name{font-weight:600;font-size:14px;color:#111827;' +
    'white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
    '.kxc-status{font-size:12px;color:#10b981;display:flex;align-items:center;gap:5px}' +
    '.kxc-status::before{content:"";width:7px;height:7px;border-radius:50%;background:#10b981}' +
    '.kxc-menu-btn{background:none;border:none;cursor:pointer;padding:6px;' +
    'border-radius:6px;color:#6b7280;display:flex;align-items:center;justify-content:center}' +
    '.kxc-menu-btn:hover{background:#f3f4f6;color:#111827}' +

    /* menu dropdown */
    '.kxc-menu{position:absolute;top:56px;right:12px;background:#fff;' +
    'border:1px solid #e5e7eb;border-radius:8px;box-shadow:0 10px 25px rgba(0,0,0,.08);' +
    'min-width:200px;z-index:10;overflow:hidden}' +
    '.kxc-menu-item{display:block;width:100%;padding:10px 14px;background:none;border:none;' +
    'text-align:left;font-size:14px;cursor:pointer;color:#374151;font-family:inherit}' +
    '.kxc-menu-item:hover{background:#f9fafb}' +
    '.kxc-confirm{padding:14px}' +
    '.kxc-confirm-text{font-size:14px;color:#374151;margin-bottom:10px}' +
    '.kxc-confirm-actions{display:flex;gap:8px}' +
    '.kxc-btn{padding:7px 12px;border-radius:6px;border:none;font-size:13px;' +
    'cursor:pointer;font-family:inherit;font-weight:500}' +
    '.kxc-btn-primary{background:#dc2626;color:#fff}' +
    '.kxc-btn-primary:hover{background:#b91c1c}' +
    '.kxc-btn-secondary{background:#f3f4f6;color:#374151}' +
    '.kxc-btn-secondary:hover{background:#e5e7eb}' +

    /* messages */
    '.kxc-messages{flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:14px;' +
    'scroll-behavior:smooth}' +
    '.kxc-date-pill{align-self:center;background:#fff;border:1px solid #eef0f2;' +
    'border-radius:999px;padding:4px 12px;font-size:12px;color:#6b7280}' +
    '.kxc-msg{display:flex;gap:8px;max-width:85%;align-items:flex-end}' +
    '.kxc-msg-bot{align-self:flex-start}' +
    '.kxc-msg-user{align-self:flex-end;flex-direction:row-reverse}' +
    '.kxc-msg-avatar{width:28px;height:28px;border-radius:50%;background:#d1fae5;' +
    'flex-shrink:0;display:flex;align-items:center;justify-content:center;' +
    'color:#0f766e;overflow:hidden;box-shadow:inset 0 0 0 1px rgba(0,0,0,.05)}' +
    '.kxc-msg-user .kxc-msg-avatar{background:#e5e7eb;color:#6b7280}' +
    '.kxc-bubble{padding:10px 14px;border-radius:14px;word-wrap:break-word;' +
    'overflow-wrap:break-word;white-space:normal}' +
    '.kxc-msg-bot .kxc-bubble{background:var(--kxc-bot-bg);color:var(--kxc-bot-fg);' +
    'border:1px solid #eef0f2;border-bottom-left-radius:4px}' +
    '.kxc-msg-user .kxc-bubble{background:var(--kxc-user-bg);color:var(--kxc-user-fg);' +
    'border-bottom-right-radius:4px}' +
    '.kxc-bubble a{color:inherit;text-decoration:underline}' +

    /* typing indicator */
    '.kxc-typing{display:flex;gap:4px;padding:4px 0}' +
    '.kxc-typing span{width:7px;height:7px;border-radius:50%;background:#9ca3af;' +
    'animation:kxc-bounce 1.4s infinite ease-in-out both}' +
    '.kxc-typing span:nth-child(1){animation-delay:-.32s}' +
    '.kxc-typing span:nth-child(2){animation-delay:-.16s}' +
    '@keyframes kxc-bounce{0%,80%,100%{transform:scale(.6);opacity:.5}' +
    '40%{transform:scale(1);opacity:1}}' +

    /* input */
    '.kxc-input-wrap{padding:12px 14px 6px;background:#fff;border-top:1px solid #eef0f2;flex-shrink:0}' +
    '.kxc-input-row{display:flex;align-items:flex-end;gap:8px;background:#f9fafb;' +
    'border:1px solid #e5e7eb;border-radius:24px;padding:6px 6px 6px 16px;' +
    'transition:border-color .15s}' +
    '.kxc-input-row:focus-within{border-color:var(--kxc-primary)}' +
    '.kxc-textarea{flex:1;border:none;outline:none;resize:none;background:transparent;' +
    'font-family:inherit;font-size:14px;line-height:1.4;color:#111827;padding:8px 0;' +
    'max-height:120px;overflow-y:auto}' +
    '.kxc-textarea::placeholder{color:#9ca3af}' +
    '.kxc-send{width:36px;height:36px;border-radius:50%;border:none;cursor:pointer;' +
    'background:var(--kxc-primary);color:#fff;display:flex;align-items:center;' +
    'justify-content:center;flex-shrink:0;transition:opacity .15s}' +
    '.kxc-send:disabled{opacity:.4;cursor:not-allowed}' +
    '.kxc-send:not(:disabled):hover{filter:brightness(1.1)}' +
    '.kxc-footer{padding:8px 14px 10px;background:#fff;text-align:center;' +
    'font-size:11px;color:#9ca3af}' +

    /* scrollbar */
    '.kxc-messages::-webkit-scrollbar{width:6px}' +
    '.kxc-messages::-webkit-scrollbar-thumb{background:#d1d5db;border-radius:3px}' +
    '.kxc-messages::-webkit-scrollbar-thumb:hover{background:#9ca3af}' +

    /* disabled textarea */
    '.kxc-textarea:disabled{cursor:not-allowed;opacity:.6;background:transparent}' +

    /* privacy overlay */
    '.kxc-privacy-overlay{position:absolute;inset:0;background:rgba(15,23,42,.55);' +
    'display:flex;align-items:center;justify-content:center;padding:20px;z-index:20;' +
    '-webkit-backdrop-filter:blur(2px);backdrop-filter:blur(2px)}' +
    '.kxc-privacy-box{background:#fff;border-radius:12px;padding:22px 22px 20px;' +
    'max-width:360px;width:100%;box-shadow:0 20px 40px rgba(0,0,0,.18);' +
    'display:flex;flex-direction:column;gap:10px}' +
    '.kxc-privacy-title{font-size:16px;font-weight:600;color:#111827;margin:0}' +
    '.kxc-privacy-text{font-size:13px;line-height:1.5;color:#4b5563;margin:0}' +
    '.kxc-privacy-link{display:inline-block;font-size:13px;color:var(--kxc-primary);' +
    'text-decoration:underline;margin:4px 0 8px;font-weight:500}' +
    '.kxc-privacy-link:hover{filter:brightness(.9)}' +
    '.kxc-privacy-accept{width:100%;padding:11px 14px;border:none;border-radius:8px;' +
    'background:var(--kxc-primary);color:#fff;font-size:14px;font-weight:600;' +
    'cursor:pointer;font-family:inherit;margin-top:4px}' +
    '.kxc-privacy-accept:hover{filter:brightness(1.08)}' +
    '.kxc-privacy-accept:focus{outline:2px solid var(--kxc-primary);outline-offset:2px}';

  // ---------- instance ----------
  function KinetixChatInstance(config) {
    this.config = config;
    this.state = null;
    this.dom = {};
    this.isWaiting = false;
    this.menuOpen = false;
    this.storageKey =
      BASE_STORAGE_KEY + '-' + shortHash(String(config.webhookUrl || 'default'));
    this.privacyAccepted = false;
    this.privacyStorageKey =
      BASE_STORAGE_KEY + '-privacy-' + shortHash(String(config.webhookUrl || 'default'));
  }

  KinetixChatInstance.prototype.mount = function () {
    var container =
      typeof this.config.target === 'string'
        ? document.querySelector(this.config.target)
        : this.config.target;
    if (!container) {
      if (global.console) console.error('[KinetixChat] target not found:', this.config.target);
      return;
    }

    // Shadow DOM for full isolation against host theme (e.g. WordPress).
    var shadow;
    if (container.shadowRoot) {
      shadow = container.shadowRoot;
      shadow.innerHTML = '';
    } else if (container.attachShadow) {
      shadow = container.attachShadow({ mode: 'open' });
    } else {
      // Fallback: no shadow DOM support (very old browsers). Mount in light DOM.
      container.innerHTML = '';
      shadow = container;
    }
    this.dom.shadow = shadow;
    this.dom.host = container;

    // Style element inside the shadow root.
    var style = document.createElement('style');
    style.textContent = STYLES;
    shadow.appendChild(style);

    var root = document.createElement('div');
    root.className = 'kxc-root';
    var ui = this.config.ui;
    root.style.setProperty('--kxc-primary', ui.primaryColor);
    root.style.setProperty('--kxc-user-bg', ui.userBubbleColor);
    root.style.setProperty('--kxc-user-fg', ui.userBubbleTextColor);
    root.style.setProperty('--kxc-bot-bg', ui.botBubbleColor);
    root.style.setProperty('--kxc-bot-fg', ui.botBubbleTextColor);
    root.style.setProperty('--kxc-bg', ui.backgroundColor);
    root.style.setProperty('--kxc-font', ui.fontFamily);

    root.appendChild(this.buildHeader());
    var messages = document.createElement('div');
    messages.className = 'kxc-messages';
    this.dom.messages = messages;
    root.appendChild(messages);
    root.appendChild(this.buildInput());
    if (this.config.brand.footerText) {
      var footer = document.createElement('div');
      footer.className = 'kxc-footer';
      footer.textContent = this.config.brand.footerText;
      root.appendChild(footer);
    }

    shadow.appendChild(root);
    this.dom.root = root;

    this.loadPrivacyAccepted();
    this.loadState();
    this.render();

    if (!this.privacyAccepted) {
      this.buildPrivacyOverlay();
    }

    // Close menu when clicking anywhere outside it.
    // Inside shadow DOM, events are retargeted at the host on the document, so
    // composedPath() is required to know what was actually clicked.
    var self = this;
    this._outsideClick = function (e) {
      if (!self.menuOpen || !self.dom.menu) return;
      var path = typeof e.composedPath === 'function' ? e.composedPath() : [];
      if (path.indexOf(self.dom.menu) !== -1) return;
      if (path.indexOf(self.dom.menuBtn) !== -1) return;
      self.closeMenu();
    };
    document.addEventListener('click', this._outsideClick);
  };

  KinetixChatInstance.prototype.buildHeader = function () {
    var brand = this.config.brand;
    var header = document.createElement('div');
    header.className = 'kxc-header';

    var avatar = document.createElement('div');
    avatar.className = 'kxc-avatar';
    var initial = (brand.name || '?').charAt(0).toUpperCase();
    setAvatarImage(avatar, brand.avatarUrl, initial, null);

    var info = document.createElement('div');
    info.className = 'kxc-brand';
    var name = document.createElement('div');
    name.className = 'kxc-brand-name';
    name.textContent = brand.name;
    var status = document.createElement('div');
    status.className = 'kxc-status';
    status.textContent = brand.statusText;
    info.appendChild(name);
    info.appendChild(status);

    var menuBtn = document.createElement('button');
    menuBtn.className = 'kxc-menu-btn';
    menuBtn.setAttribute('aria-label', 'Menú');
    menuBtn.innerHTML =
      '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">' +
      '<circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/>' +
      '</svg>';
    var self = this;
    menuBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      self.toggleMenu();
    });
    this.dom.menuBtn = menuBtn;

    header.appendChild(avatar);
    header.appendChild(info);
    header.appendChild(menuBtn);
    return header;
  };

  KinetixChatInstance.prototype.buildInput = function () {
    var ui = this.config.ui;
    var wrap = document.createElement('div');
    wrap.className = 'kxc-input-wrap';

    var row = document.createElement('div');
    row.className = 'kxc-input-row';

    var textarea = document.createElement('textarea');
    textarea.className = 'kxc-textarea';
    textarea.rows = 1;
    textarea.placeholder = ui.placeholder;

    var sendBtn = document.createElement('button');
    sendBtn.className = 'kxc-send';
    sendBtn.setAttribute('aria-label', 'Enviar');
    sendBtn.disabled = true;
    sendBtn.innerHTML =
      '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"' +
      ' stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">' +
      '<line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>' +
      '</svg>';

    var self = this;
    textarea.addEventListener('input', function () {
      textarea.style.height = 'auto';
      textarea.style.height = Math.min(textarea.scrollHeight, 120) + 'px';
      sendBtn.disabled = !textarea.value.trim() || self.isWaiting;
    });
    textarea.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        self.handleSend();
      }
    });
    sendBtn.addEventListener('click', function () {
      self.handleSend();
    });

    row.appendChild(textarea);
    row.appendChild(sendBtn);
    wrap.appendChild(row);

    this.dom.textarea = textarea;
    this.dom.sendBtn = sendBtn;
    return wrap;
  };

  // ---------- menu ----------
  KinetixChatInstance.prototype.toggleMenu = function () {
    if (this.menuOpen) this.closeMenu();
    else this.openMenu();
  };

  KinetixChatInstance.prototype.openMenu = function () {
    this.menuOpen = true;
    var menu = document.createElement('div');
    menu.className = 'kxc-menu';
    menu.addEventListener('click', function (e) {
      e.stopPropagation();
    });
    var item = document.createElement('button');
    item.className = 'kxc-menu-item';
    item.textContent = this.config.i18n.clearConversation;
    var self = this;
    item.addEventListener('click', function (e) {
      e.stopPropagation();
      self.showConfirm();
    });
    menu.appendChild(item);
    this.dom.root.appendChild(menu);
    this.dom.menu = menu;
  };

  KinetixChatInstance.prototype.closeMenu = function () {
    this.menuOpen = false;
    if (this.dom.menu) {
      this.dom.menu.remove();
      this.dom.menu = null;
    }
  };

  KinetixChatInstance.prototype.showConfirm = function () {
    if (!this.dom.menu) return;
    var i18n = this.config.i18n;
    this.dom.menu.innerHTML = '';
    var box = document.createElement('div');
    box.className = 'kxc-confirm';
    var text = document.createElement('div');
    text.className = 'kxc-confirm-text';
    text.textContent = i18n.confirmClear;
    var actions = document.createElement('div');
    actions.className = 'kxc-confirm-actions';
    var no = document.createElement('button');
    no.className = 'kxc-btn kxc-btn-secondary';
    no.textContent = i18n.confirmNo;
    var yes = document.createElement('button');
    yes.className = 'kxc-btn kxc-btn-primary';
    yes.textContent = i18n.confirmYes;
    var self = this;
    no.addEventListener('click', function () {
      self.closeMenu();
    });
    yes.addEventListener('click', function () {
      self.clearConversation();
      self.closeMenu();
    });
    actions.appendChild(no);
    actions.appendChild(yes);
    box.appendChild(text);
    box.appendChild(actions);
    this.dom.menu.appendChild(box);
  };

  // ---------- privacy ----------
  KinetixChatInstance.prototype.loadPrivacyAccepted = function () {
    var cfg = this.config.privacy || {};
    if (cfg.enabled === false || cfg.enabled === 'false') {
      this.privacyAccepted = true;
      return;
    }
    try {
      this.privacyAccepted = localStorage.getItem(this.privacyStorageKey) === '1';
    } catch (e) {
      // localStorage unavailable (private mode etc.) — show banner each load
      this.privacyAccepted = false;
    }
  };

  KinetixChatInstance.prototype.savePrivacyAccepted = function () {
    try {
      localStorage.setItem(this.privacyStorageKey, '1');
    } catch (e) {
      // ignore
    }
  };

  KinetixChatInstance.prototype.buildPrivacyOverlay = function () {
    var cfg = this.config.privacy || {};
    var self = this;

    if (this.dom.textarea) this.dom.textarea.disabled = true;
    if (this.dom.sendBtn) this.dom.sendBtn.disabled = true;

    var overlay = document.createElement('div');
    overlay.className = 'kxc-privacy-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'kxc-privacy-title');

    var box = document.createElement('div');
    box.className = 'kxc-privacy-box';

    var title = document.createElement('h2');
    title.className = 'kxc-privacy-title';
    title.id = 'kxc-privacy-title';
    title.textContent = cfg.title;
    box.appendChild(title);

    var text = document.createElement('p');
    text.className = 'kxc-privacy-text';
    text.textContent = cfg.text;
    box.appendChild(text);

    if (cfg.url) {
      var link = document.createElement('a');
      link.className = 'kxc-privacy-link';
      link.href = cfg.url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = cfg.linkLabel;
      box.appendChild(link);
    }

    var acceptBtn = document.createElement('button');
    acceptBtn.className = 'kxc-privacy-accept';
    acceptBtn.type = 'button';
    acceptBtn.textContent = cfg.acceptLabel;
    acceptBtn.addEventListener('click', function () {
      self.privacyAccepted = true;
      self.savePrivacyAccepted();
      if (self.dom.privacyOverlay) {
        self.dom.privacyOverlay.remove();
        self.dom.privacyOverlay = null;
      }
      if (self.dom.textarea) {
        self.dom.textarea.disabled = false;
        self.dom.textarea.focus();
      }
      // sendBtn stays disabled until there's text (existing input handler logic)
    });
    box.appendChild(acceptBtn);

    overlay.appendChild(box);
    this.dom.root.appendChild(overlay);
    this.dom.privacyOverlay = overlay;

    // Move focus into the dialog for keyboard users / screen readers
    setTimeout(function () { acceptBtn.focus(); }, 0);
  };

  // ---------- state ----------
  KinetixChatInstance.prototype.loadState = function () {
    var raw = null;
    try {
      raw = sessionStorage.getItem(this.storageKey);
    } catch (e) {
      // sessionStorage unavailable (private mode etc.) — operate in-memory only
    }
    if (raw) {
      try {
        this.state = JSON.parse(raw);
        if (!this.state || !this.state.sessionId || !Array.isArray(this.state.messages)) {
          this.state = null;
        }
      } catch (e) {
        this.state = null;
      }
    }
    if (!this.state) {
      this.state = {
        sessionId: uuid(),
        messages: [],
        startedAt: Date.now()
      };
      if (this.config.ui.welcomeMessage) {
        this.state.messages.push({
          role: 'bot',
          text: this.config.ui.welcomeMessage,
          ts: Date.now()
        });
      }
      this.saveState();
    }
  };

  KinetixChatInstance.prototype.saveState = function () {
    try {
      sessionStorage.setItem(this.storageKey, JSON.stringify(this.state));
    } catch (e) {
      // ignore
    }
  };

  KinetixChatInstance.prototype.clearConversation = function () {
    try {
      sessionStorage.removeItem(this.storageKey);
    } catch (e) {
      // ignore
    }
    this.state = null;
    this.loadState();
    this.render();
  };

  // ---------- render ----------
  KinetixChatInstance.prototype.render = function () {
    var box = this.dom.messages;
    box.innerHTML = '';
    this.dom.typingEl = null;

    if (this.state.messages.length > 0) {
      var pill = document.createElement('div');
      pill.className = 'kxc-date-pill';
      pill.textContent =
        this.config.i18n.todayLabel + ', ' + formatTime(this.state.startedAt);
      box.appendChild(pill);
    }

    for (var i = 0; i < this.state.messages.length; i++) {
      box.appendChild(this.buildMessageEl(this.state.messages[i]));
    }
    this.scrollToBottom();
  };

  KinetixChatInstance.prototype.buildMessageEl = function (msg) {
    var wrap = document.createElement('div');
    wrap.className = 'kxc-msg kxc-msg-' + msg.role;
    var avatar = document.createElement('div');
    avatar.className = 'kxc-msg-avatar';
    var botSvg =
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">' +
      '<path d="M12 2a2 2 0 012 2v1h4a2 2 0 012 2v3h1a1 1 0 010 2h-1v4a2 2 0 01-2 2H6a2 2 0 01-2-2v-4H3a1 1 0 010-2h1V7a2 2 0 012-2h4V4a2 2 0 012-2zM9 12a1.5 1.5 0 100 3 1.5 1.5 0 000-3zm6 0a1.5 1.5 0 100 3 1.5 1.5 0 000-3z"/>' +
      '</svg>';
    var userSvg =
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">' +
      '<path d="M12 12a5 5 0 100-10 5 5 0 000 10zm0 2c-4 0-8 2-8 6v1h16v-1c0-4-4-6-8-6z"/>' +
      '</svg>';
    if (msg.role === 'bot') {
      setAvatarImage(avatar, this.config.brand.avatarUrl, null, botSvg);
    } else {
      avatar.innerHTML = userSvg;
    }
    var bubble = document.createElement('div');
    bubble.className = 'kxc-bubble';
    bubble.innerHTML = formatText(msg.text);
    wrap.appendChild(avatar);
    wrap.appendChild(bubble);
    return wrap;
  };

  KinetixChatInstance.prototype.appendMessage = function (msg) {
    if (this.state.messages.length === 0) {
      var pill = document.createElement('div');
      pill.className = 'kxc-date-pill';
      pill.textContent =
        this.config.i18n.todayLabel + ', ' + formatTime(msg.ts);
      this.dom.messages.appendChild(pill);
    }
    this.state.messages.push(msg);
    this.dom.messages.appendChild(this.buildMessageEl(msg));
    this.saveState();
    this.scrollToBottom();
  };

  KinetixChatInstance.prototype.scrollToBottom = function () {
    var box = this.dom.messages;
    requestAnimationFrame(function () {
      box.scrollTop = box.scrollHeight;
    });
  };

  // ---------- typing indicator ----------
  KinetixChatInstance.prototype.showTyping = function () {
    if (this.dom.typingEl) return;
    var wrap = document.createElement('div');
    wrap.className = 'kxc-msg kxc-msg-bot';
    var avatar = document.createElement('div');
    avatar.className = 'kxc-msg-avatar';
    var typingSvg =
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">' +
      '<path d="M12 2a2 2 0 012 2v1h4a2 2 0 012 2v3h1a1 1 0 010 2h-1v4a2 2 0 01-2 2H6a2 2 0 01-2-2v-4H3a1 1 0 010-2h1V7a2 2 0 012-2h4V4a2 2 0 012-2zM9 12a1.5 1.5 0 100 3 1.5 1.5 0 000-3zm6 0a1.5 1.5 0 100 3 1.5 1.5 0 000-3z"/>' +
      '</svg>';
    setAvatarImage(avatar, this.config.brand.avatarUrl, null, typingSvg);
    var bubble = document.createElement('div');
    bubble.className = 'kxc-bubble';
    bubble.setAttribute('aria-label', this.config.i18n.typingLabel);
    var typing = document.createElement('div');
    typing.className = 'kxc-typing';
    typing.innerHTML = '<span></span><span></span><span></span>';
    bubble.appendChild(typing);
    wrap.appendChild(avatar);
    wrap.appendChild(bubble);
    this.dom.messages.appendChild(wrap);
    this.dom.typingEl = wrap;
    this.scrollToBottom();
  };

  KinetixChatInstance.prototype.hideTyping = function () {
    if (this.dom.typingEl) {
      this.dom.typingEl.remove();
      this.dom.typingEl = null;
    }
  };

  // ---------- send / receive ----------
  KinetixChatInstance.prototype.handleSend = function () {
    if (!this.privacyAccepted) return;
    if (this.isWaiting) return;
    var text = this.dom.textarea.value.trim();
    if (!text) return;
    this.dom.textarea.value = '';
    this.dom.textarea.style.height = 'auto';
    this.dom.sendBtn.disabled = true;
    this.appendMessage({ role: 'user', text: text, ts: Date.now() });
    this.sendToWebhook(text);
  };

  KinetixChatInstance.prototype.sendToWebhook = function (text) {
    var self = this;
    if (!this.config.webhookUrl) {
      this.appendMessage({
        role: 'bot',
        text: '[KinetixChat] webhookUrl no configurado.',
        ts: Date.now()
      });
      return;
    }
    this.isWaiting = true;
    this.showTyping();

    var controller =
      typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timeoutId = setTimeout(function () {
      if (controller) controller.abort();
    }, REQUEST_TIMEOUT_MS);

    var payload = {
      action: 'sendMessage',
      sessionId: this.state.sessionId,
      route: this.config.route || '',
      chatInput: text,
      metadata: { userId: '' }
    };

    fetch(this.config.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller ? controller.signal : undefined
    })
      .then(function (res) {
        clearTimeout(timeoutId);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function (data) {
        var output;
        if (Array.isArray(data)) {
          output = data[0] && (data[0].output || data[0].text || data[0].message);
        } else if (data && typeof data === 'object') {
          output = data.output || data.text || data.message || data.response;
        } else if (typeof data === 'string') {
          output = data;
        }
        if (!output) output = '...';
        self.hideTyping();
        self.appendMessage({ role: 'bot', text: String(output), ts: Date.now() });
      })
      .catch(function (err) {
        clearTimeout(timeoutId);
        self.hideTyping();
        self.appendMessage({
          role: 'bot',
          text: self.config.i18n.errorMessage,
          ts: Date.now()
        });
        if (global.console && console.error) {
          console.error('[KinetixChat] webhook error:', err);
        }
      })
      .then(function () {
        self.isWaiting = false;
        self.dom.sendBtn.disabled = !self.dom.textarea.value.trim();
      });
  };

  // ---------- data-attribute → config mapping ----------
  // Map each data-* attribute name to a (group, key) inside DEFAULTS.
  var ATTR_MAP = {
    'webhook-url':           ['', 'webhookUrl'],
    'route':                 ['', 'route'],
    'brand-name':            ['brand', 'name'],
    'brand-avatar':          ['brand', 'avatarUrl'],
    'brand-status':          ['brand', 'statusText'],
    'footer-text':           ['brand', 'footerText'],
    'primary-color':         ['ui', 'primaryColor'],
    'user-bubble-color':     ['ui', 'userBubbleColor'],
    'user-bubble-text-color':['ui', 'userBubbleTextColor'],
    'bot-bubble-color':      ['ui', 'botBubbleColor'],
    'bot-bubble-text-color': ['ui', 'botBubbleTextColor'],
    'background-color':      ['ui', 'backgroundColor'],
    'font-family':           ['ui', 'fontFamily'],
    'placeholder':           ['ui', 'placeholder'],
    'welcome-message':       ['ui', 'welcomeMessage'],
    'clear-label':           ['i18n', 'clearConversation'],
    'confirm-text':          ['i18n', 'confirmClear'],
    'confirm-yes':           ['i18n', 'confirmYes'],
    'confirm-no':            ['i18n', 'confirmNo'],
    'error-message':         ['i18n', 'errorMessage'],
    'today-label':           ['i18n', 'todayLabel'],
    'typing-label':          ['i18n', 'typingLabel'],
    'privacy-enabled':       ['privacy', 'enabled'],
    'privacy-url':           ['privacy', 'url'],
    'privacy-title':         ['privacy', 'title'],
    'privacy-text':          ['privacy', 'text'],
    'privacy-link-label':    ['privacy', 'linkLabel'],
    'privacy-accept-label':  ['privacy', 'acceptLabel']
  };

  function configFromElement(el) {
    var cfg = {};
    for (var attr in ATTR_MAP) {
      var val = el.getAttribute('data-' + attr);
      if (val === null || val === '') continue;
      var dest = ATTR_MAP[attr];
      var group = dest[0];
      var key = dest[1];
      if (group === '') {
        cfg[key] = val;
      } else {
        if (!cfg[group]) cfg[group] = {};
        cfg[group][key] = val;
      }
    }
    return cfg;
  }

  // ---------- public API ----------
  var mountedHosts = new WeakSet();

  function mountInstance(target, userConfig) {
    var config = deepMerge(DEFAULTS, userConfig || {});
    config.target = target;
    var instance = new KinetixChatInstance(config);
    instance.mount();
    if (instance.dom && instance.dom.host) {
      mountedHosts.add(instance.dom.host);
    }
    return {
      clear: function () { instance.clearConversation(); },
      destroy: function () {
        if (instance._outsideClick) {
          document.removeEventListener('click', instance._outsideClick);
        }
        if (instance.dom.shadow && instance.dom.shadow !== instance.dom.host) {
          // can't detach shadow root; just empty it
          instance.dom.shadow.innerHTML = '';
        } else if (instance.dom.host) {
          instance.dom.host.innerHTML = '';
        }
      }
    };
  }

  function autoInit() {
    var nodes = document.querySelectorAll('[data-kinetix-chat]');
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if (mountedHosts.has(el)) continue;
      mountInstance(el, configFromElement(el));
    }
  }

  var KinetixChat = {
    init: function (userConfig) {
      userConfig = userConfig || {};
      var target = userConfig.target;
      if (!target) {
        if (global.console) console.error('[KinetixChat] init requires a target');
        return null;
      }
      var resolved =
        typeof target === 'string' ? document.querySelector(target) : target;
      if (!resolved) {
        if (global.console) console.error('[KinetixChat] target not found:', target);
        return null;
      }
      return mountInstance(resolved, userConfig);
    },
    autoInit: autoInit
  };

  global.KinetixChat = KinetixChat;

  // Auto-init on DOM ready (covers async/defer script loading too).
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', autoInit);
  } else {
    autoInit();
  }
})(typeof window !== 'undefined' ? window : this);
