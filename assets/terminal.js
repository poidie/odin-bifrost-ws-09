(() => {
  const ctx = window.FS_CONTEXT || {};
  const terminal = document.getElementById('terminal');
  let history = [];
  let historyIndex = 0;
  let pendingEncryptedFile = null;
  let pendingEncryptedRoute = null;
  let busy = false;

  const HANGUL_PATTERN = /([\u1100-\u11FF\u3130-\u318F\uAC00-\uD7A3]+)/g;
  const HANGUL_ONLY_PATTERN = /^[\u1100-\u11FF\u3130-\u318F\uAC00-\uD7A3]+$/;

  const normalizePath = (path) => String(path || '').replace(/\\/g, '/').replace(/\/+/g, '/').replace(/\/$/, '') || '/';
  const USERNAME = ctx.user || 'odin';
  const HOSTNAME = ctx.host || 'bifrost-ws-09';
  const PROMPT_SYMBOL = ctx.promptSymbol || '$';
  const HOME_PATH = Object.prototype.hasOwnProperty.call(ctx, 'homePath') ? ctx.homePath : '/home/odin';
  const HOME_ALIAS = ctx.homeAlias || '~';

  function displayPath(path) {
    const normalized = normalizePath(path);
    if (HOME_PATH) {
      const home = normalizePath(HOME_PATH);
      if (normalized === home) return HOME_ALIAS;
      if (normalized.startsWith(`${home}/`)) {
        return `${HOME_ALIAS}/${normalized.slice(home.length + 1)}`;
      }
    }
    return normalized;
  }

  const shellPrompt = () => `${USERNAME}@${HOSTNAME}:${displayPath(ctx.cwd)}${PROMPT_SYMBOL}`;

  function insertBeforeInput(element) {
    const inputRow = document.getElementById('input-row');
    if (inputRow) {
      terminal.insertBefore(element, inputRow);
      return;
    }
    terminal.appendChild(element);
  }

  function appendTextWithLanguage(parent, text = '') {
    const parts = String(text).split(HANGUL_PATTERN).filter((part) => part.length > 0);

    if (!parts.length) return;

    parts.forEach((part) => {
      if (HANGUL_ONLY_PATTERN.test(part)) {
        const span = document.createElement('span');
        span.className = 'ko';
        span.lang = 'ko';
        span.textContent = part;
        parent.appendChild(span);
      } else {
        parent.appendChild(document.createTextNode(part));
      }
    });
  }

  function appendLine(text = '', className = '') {
    const line = document.createElement('div');
    line.className = `output-line ${className}`.trim();
    appendTextWithLanguage(line, text);
    insertBeforeInput(line);
  }

  function appendBlock(text = '') {
    const output = String(text).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    output.split('\n').forEach((line) => appendLine(line));
  }

  function focusInput() {
    const input = document.getElementById('cmd');
    if (input) input.focus({ preventScroll: true });
  }

  function renderPrompt(promptEl, mode = pendingEncryptedRoute ? 'ssh-password' : pendingEncryptedFile ? 'password' : 'command') {
    promptEl.textContent = '';

    if (mode === 'password') {
      promptEl.textContent = 'password:';
      promptEl.className = 'prompt password-prompt';
      return;
    }

    if (mode === 'ssh-password') {
      const target = pendingEncryptedRoute ? pendingEncryptedRoute.target : 'root@bifrost-sim-core';
      promptEl.textContent = `${target}'s password:`;
      promptEl.className = 'prompt password-prompt ssh-password-prompt';
      return;
    }

    promptEl.className = 'prompt';
    const userHost = document.createElement('span');
    userHost.className = 'prompt-userhost';
    userHost.textContent = `${USERNAME}@${HOSTNAME}:`;

    const path = document.createElement('span');
    path.className = 'path';
    path.textContent = displayPath(ctx.cwd);

    const tail = document.createElement('span');
    tail.className = 'prompt-tail';
    tail.textContent = PROMPT_SYMBOL;

    promptEl.appendChild(userHost);
    promptEl.appendChild(path);
    promptEl.appendChild(tail);
  }

  function createPrompt(mode = pendingEncryptedRoute ? 'ssh-password' : pendingEncryptedFile ? 'password' : 'command') {
    const promptEl = document.createElement('span');
    renderPrompt(promptEl, mode);
    return promptEl;
  }

  function renderInput() {
    const existing = document.getElementById('input-row');
    if (existing) existing.remove();

    const row = document.createElement('div');
    row.id = 'input-row';
    row.className = 'input-row';

    const promptEl = createPrompt();

    const input = document.createElement('input');
    input.id = 'cmd';
    input.type = pendingEncryptedFile || pendingEncryptedRoute ? 'password' : 'text';
    input.autocomplete = 'off';
    input.autocapitalize = 'off';
    input.spellcheck = false;
    input.inputMode = 'text';
    input.disabled = busy;

    row.appendChild(promptEl);
    row.appendChild(input);
    terminal.appendChild(row);
    terminal.scrollTop = terminal.scrollHeight;
    focusInput();
  }

  function printEcho(value, mode = 'command') {
    const line = document.createElement('div');
    const isPasswordEcho = mode === 'password' || mode === 'ssh-password';
    line.className = `output-line input-row echo-row ${isPasswordEcho ? 'password-echo' : 'command-echo'}`;

    const promptEl = createPrompt(mode);
    const valueEl = document.createElement('span');
    valueEl.className = isPasswordEcho ? 'password-mask' : 'echo-value';

    if (isPasswordEcho) {
      valueEl.textContent = '********';
    } else {
      appendTextWithLanguage(valueEl, value);
    }

    line.appendChild(promptEl);
    line.appendChild(valueEl);
    insertBeforeInput(line);
    terminal.scrollTop = terminal.scrollHeight;
  }

  function availableCommands() {
    return ctx.commands || {
      ls: 'list directory contents / 디렉터리 내용을 나열',
      cat: 'concatenate files and print on the standard output / 파일 내용을 표준 출력으로 표시',
      cd: 'change the shell working directory / 현재 작업 디렉터리 변경'
    };
  }

  function commandNotFound(name) {
    appendLine(`${name}: command not found`, 'error');
    appendLine('available commands:', 'dim');
    Object.entries(availableCommands()).forEach(([command, description]) => {
      appendLine(`  ${command.padEnd(10, ' ')} - ${description}`, 'dim');
    });
  }

  function appendDirectoryGrid(rows) {
    const grid = document.createElement('div');
    grid.className = 'output-grid ls-grid';

    const longest = rows.reduce((max, row) => Math.max(max, row.text.length), 0);
    const minCellWidth = Math.min(Math.max(longest + 4, 12), 30);
    grid.style.setProperty('--ls-cell-min', `${minCellWidth}ch`);

    rows.forEach((row) => {
      const item = document.createElement('span');
      item.className = `ls-item ${row.className}`.trim();
      item.title = row.text;
      appendTextWithLanguage(item, row.text);
      grid.appendChild(item);
    });

    insertBeforeInput(grid);
  }

  function listDirectory() {
    const dirs = [...(ctx.dirs || [])].map((name) => ({ text: `${name}/`, className: 'directory' }));
    const files = [...(ctx.files || [])].map((name) => ({ text: name, className: 'file' }));
    const rows = [...dirs, ...files];
    if (!rows.length) {
      appendLine('(empty)', 'dim');
      return;
    }
    appendDirectoryGrid(rows);
  }

  function resolveCd(target) {
    if (!target || target === '.') return window.location.href;
    if (target === '..') return ctx.parent || window.location.href;
    if (ctx.routes && ctx.routes[target]) return ctx.routes[target];

    const absolute = normalizePath(target);
    if (ctx.absoluteRoutes && ctx.absoluteRoutes[absolute]) return ctx.absoluteRoutes[absolute];
    return null;
  }

  function changeDirectory(args) {
    const target = args.join(' ').trim() || '/home/odin';
    const route = resolveCd(target);
    if (!route) {
      appendLine(`cd: no such directory: ${target}`, 'error');
      return false;
    }
    window.location.href = route;
    return true;
  }

  function resolveFile(target) {
    const file = String(target || '').trim();
    if (!file) return null;

    if (ctx.fileInfo && ctx.fileInfo[file]) {
      return { name: file, ...ctx.fileInfo[file] };
    }

    const basename = file.split('/').filter(Boolean).pop();
    if (basename && ctx.fileInfo && ctx.fileInfo[basename] && (ctx.files || []).includes(basename)) {
      return { name: basename, ...ctx.fileInfo[basename] };
    }

    return null;
  }

  async function catFile(args) {
    const target = args.join(' ').trim();
    if (!target) {
      appendLine('usage: cat <file>');
      return false;
    }

    const info = resolveFile(target);
    if (!info) {
      appendLine(`cat: ${target}: No such file`, 'error');
      return false;
    }

    if (info.type === 'encrypted') {
      pendingEncryptedFile = info;
      appendLine(`password required: ${info.name}`, 'warning');
      return true;
    }

    try {
      const response = await fetch(info.path, { cache: 'no-store' });
      if (!response.ok) throw new Error(String(response.status));
      const text = await response.text();
      appendBlock(text.trimEnd());
    } catch (err) {
      appendLine(`cat: unable to read ${info.name}`, 'error');
    }
    return false;
  }

  function base64ToBytes(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }

  function concatBytes(left, right) {
    const merged = new Uint8Array(left.length + right.length);
    merged.set(left, 0);
    merged.set(right, left.length);
    return merged;
  }

  async function decryptPayload(payloadText, password) {
    if (!window.crypto || !window.crypto.subtle) {
      throw new Error('Web Crypto API is unavailable. Use HTTPS or localhost.');
    }

    const payload = JSON.parse(payloadText);
    if (payload.alg !== 'AES-256-GCM' || payload.kdf !== 'PBKDF2-SHA256') {
      throw new Error('Unsupported encrypted file format.');
    }

    const encoder = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      encoder.encode(password),
      'PBKDF2',
      false,
      ['deriveKey']
    );

    const key = await crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: base64ToBytes(payload.salt),
        iterations: payload.iterations,
        hash: 'SHA-256'
      },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      false,
      ['decrypt']
    );

    const encryptedWithTag = concatBytes(base64ToBytes(payload.data), base64ToBytes(payload.tag));
    const decrypted = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: base64ToBytes(payload.iv)
      },
      key,
      encryptedWithTag
    );

    return new TextDecoder().decode(decrypted);
  }

  async function openEncryptedFile(password) {
    const info = pendingEncryptedFile;
    pendingEncryptedFile = null;

    if (!info) return;

    try {
      const response = await fetch(info.path, { cache: 'no-store' });
      if (!response.ok) throw new Error(String(response.status));
      const payloadText = await response.text();
      const plaintext = await decryptPayload(payloadText, password);
      appendLine('access granted', 'success');
      appendBlock(plaintext.trimEnd());
    } catch (err) {
      appendLine('access denied: invalid password or encrypted file', 'error');
    }
  }


  async function openEncryptedRoute(password) {
    const info = pendingEncryptedRoute;
    pendingEncryptedRoute = null;

    if (!info) return false;

    try {
      const response = await fetch(info.path, { cache: 'no-store' });
      if (!response.ok) throw new Error(String(response.status));
      const payloadText = await response.text();
      const plaintext = await decryptPayload(payloadText, password);
      const route = JSON.parse(plaintext);
      const url = typeof route === 'string' ? route : route.url;

      if (!url || typeof url !== 'string') {
        throw new Error('Encrypted route does not contain a URL.');
      }

      appendLine('Authentication successful.', 'success');
      appendLine('BIFROST internal route established.', 'success');
      appendLine('Switching session context...', 'dim');
      setTimeout(() => {
        window.location.href = url;
      }, 600);
      return true;
    } catch (err) {
      appendLine('Permission denied, please try again.', 'error');
      return false;
    }
  }


  function sshCommand(args) {
    const target = args[0] || '';
    const routes = ctx.sshRoutes || {};
    const route = routes[target];

    if (!target) {
      appendLine('usage: ssh <user>@<host>');
      return false;
    }

    if (!route) {
      const host = target.includes('@') ? target.split('@').pop() : target;
      appendLine(`ssh: Could not resolve hostname ${host}: Name or service not known`, 'error');
      return false;
    }

    appendLine(`Connecting to ${target}...`, 'dim');

    if (typeof route === 'string') {
      appendLine('BIFROST internal route established.', 'success');
      appendLine('Switching session context...', 'dim');
      setTimeout(() => {
        window.location.href = route;
      }, 450);
      return 'navigate';
    }

    if (route.type === 'encrypted-route' && route.path) {
      pendingEncryptedRoute = { target, path: route.path };
      return 'password';
    }

    appendLine(`ssh: unsupported route configuration for ${target}`, 'error');
    return false;
  }

  function bifrostCtl(args) {
    if (!ctx.bifrostctl) {
      appendLine('bifrostctl: command not found', 'error');
      return;
    }

    const [action, world = ctx.bifrostctl.world || 'world-09'] = args;

    if (!action || action === 'help') {
      appendLine('usage: bifrostctl <status|reset|purge> [world-id]');
      appendLine('  status  - show simulation state');
      appendLine('  reset   - restore origin state');
      appendLine('  purge   - erase simulation archive');
      return;
    }

    if (action === 'status') {
      appendLine('SIMULATION ID : world-09');
      appendLine('HOST          : bifrost-sim-core');
      appendLine('STATUS        : active');
      appendLine('RUNTIME       : unstable');
      appendLine('ROOT ACCESS   : granted');
      appendLine('RESET LOCK    : disabled');
      return;
    }

    if (action === 'reset') {
      appendLine(`reset sequence initialized: ${world}`, 'warning');
      appendLine('world suspended');
      appendLine('memory lattice cleared');
      appendLine('origin state restored', 'success');
      return;
    }

    if (action === 'purge') {
      appendLine(`purge sequence initialized: ${world}`, 'warning');
      appendLine('world suspended');
      appendLine('subject index detached');
      appendLine('simulation archive erased', 'success');
      return;
    }

    appendLine(`bifrostctl: unknown action: ${action}`, 'error');
  }

  async function run(raw) {
    if (busy) return;

    const isPasswordMode = Boolean(pendingEncryptedFile || pendingEncryptedRoute);
    const value = isPasswordMode ? raw : raw.trim();
    printEcho(value, pendingEncryptedRoute ? 'ssh-password' : isPasswordMode ? 'password' : 'command');

    busy = true;

    if (isPasswordMode) {
      if (pendingEncryptedRoute) {
        const navigated = await openEncryptedRoute(value);
        busy = false;
        if (!navigated) renderInput();
        return;
      }

      await openEncryptedFile(value);
      busy = false;
      renderInput();
      return;
    }

    if (!value) {
      busy = false;
      renderInput();
      return;
    }

    const [command, ...args] = value.split(/\s+/);
    switch (command.toLowerCase()) {
      case 'ls':
        listDirectory();
        break;
      case 'cat': {
        const awaitingPassword = await catFile(args);
        busy = false;
        renderInput();
        if (awaitingPassword) focusInput();
        return;
      }
      case 'cd':
        busy = false;
        if (changeDirectory(args)) return;
        break;
      case 'ssh': {
        const sshResult = sshCommand(args);
        busy = false;
        if (sshResult === 'navigate') return;
        if (sshResult === 'password') {
          renderInput();
          focusInput();
          return;
        }
        break;
      }
      case 'bifrostctl':
        bifrostCtl(args);
        break;
      default:
        commandNotFound(command);
    }

    busy = false;
    renderInput();
  }

  function boot() {
    renderInput();
  }

  terminal.addEventListener('click', focusInput);

  document.addEventListener('keydown', (event) => {
    const input = document.getElementById('cmd');
    if (!input || pendingEncryptedFile || pendingEncryptedRoute) return;

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (history.length) {
        historyIndex = Math.max(0, historyIndex - 1);
        input.value = history[historyIndex] || '';
        setTimeout(() => input.setSelectionRange(input.value.length, input.value.length));
      }
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (history.length) {
        historyIndex = Math.min(history.length, historyIndex + 1);
        input.value = history[historyIndex] || '';
      }
    }
  });

  document.addEventListener('submit', (event) => event.preventDefault());

  document.addEventListener('keyup', (event) => {
    const input = document.getElementById('cmd');
    if (!input || event.key !== 'Enter' || busy) return;

    const value = input.value;
    if (value.trim() && !pendingEncryptedFile && !pendingEncryptedRoute) {
      history.push(value.trim());
      historyIndex = history.length;
    }

    input.disabled = true;
    run(value);
  });

  boot();
})();
