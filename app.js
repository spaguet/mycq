import {
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
  nip04,
  nip19,
  SimplePool,
} from 'https://esm.sh/nostr-tools';

const PROFILE_KEY = 'mycq.profile.v1';
const CONTACTS_KEY = 'mycq.contacts.v1';
const MESSAGES_KEY = 'mycq.messages.v1';
const PROTOCOL = {
  AUTH_REQUEST: 'mycq.auth_request',
  AUTH_ACCEPT: 'mycq.auth_accept',
  PROFILE_UPDATE: 'mycq.profile_update',
};
const MYCQ_CONTACT_REQUEST_KIND = 9001;

const DEFAULT_RELAYS = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.primal.net',
  'wss://nostr.wine',
  'wss://nostr.mom',
  'wss://offchain.pub',
  'wss://relay.snort.social',
  'wss://nostr-pub.wellorder.net',
];

const state = {
  profile: loadJson(PROFILE_KEY, null),
  secretHex: null,
  contacts: loadJson(CONTACTS_KEY, []),
  messages: loadJson(MESSAGES_KEY, []),
  activeContact: null,
  pool: null,
  subscription: null,
  subscriptionFingerprint: '',
  syncTimer: null,
  relayStatus: 'offline',
  seenEventIds: new Set(loadJson(MESSAGES_KEY, []).map((message) => message.eventId).filter(Boolean)),
  mobileView: 'contacts',
};

const app = document.querySelector('#app');

window.addEventListener('DOMContentLoaded', () => {
  try {
    registerServiceWorker();
    migrateProfile();
    render();
  } catch (err) {
    renderFatalError(err);
  }
});

function render() {
  if (!state.profile) {
    renderOnboarding();
    return;
  }

  if (!state.secretHex) {
    renderLogin();
    return;
  }

  renderMessenger();
}

function renderOnboarding() {
  app.innerHTML = `
    <section class="auth-shell">
      <div class="auth-hero">
        <span class="flower auth-flower" aria-hidden="true"></span>
        <h1>MyCQ</h1>
        <p>Личный децентрализованный мессенджер с зашифрованными сообщениями и контактами через Nostr.</p>
      </div>
      <form class="auth-card setup-card" id="onboardingForm">
        <h2>Создать профиль</h2>
        <p>Ключ создается в браузере, шифруется паролем и остается только на этом устройстве.</p>
        <label class="field">
          Ник
          <input name="nickname" autocomplete="nickname" maxlength="32" required placeholder="Например, Tester">
        </label>
        <label class="field">
          Пароль для входа
          <input name="password" type="password" autocomplete="new-password" minlength="8" required placeholder="Минимум 8 символов">
        </label>
        <label class="field">
          Повтор пароля
          <input name="passwordRepeat" type="password" autocomplete="new-password" minlength="8" required>
        </label>
        <div class="notice">Сохраните backup-ключ после входа. Без него восстановить профиль невозможно.</div>
        <button class="classic-button" type="submit">Создать MyCQ</button>
        <button class="classic-button secondary" type="button" id="restoreButton">Восстановить из backup</button>
        <p class="error" id="setupError" hidden></p>
      </form>
    </section>
  `;

  document.querySelector('#onboardingForm').addEventListener('submit', handleOnboarding);
  document.querySelector('#restoreButton').addEventListener('click', handleRestoreFromBackup);
}

async function handleOnboarding(event) {
  event.preventDefault();

  const form = event.currentTarget;
  const error = document.querySelector('#setupError');
  const nickname = form.nickname.value.trim();
  const password = form.password.value;
  const passwordRepeat = form.passwordRepeat.value;

  error.hidden = true;

  if (password !== passwordRepeat) {
    showError(error, 'Пароли не совпадают.');
    return;
  }

  try {
    const secret = generateSecretKey();
    await saveProfileFromSecret(secret, nickname, password);
  } catch (err) {
    showError(error, 'Не удалось создать профиль: ' + getErrorMessage(err));
  }
}

function handleRestoreFromBackup() {
  closeRestoreModal();

  document.body.insertAdjacentHTML('beforeend', `
    <div class="settings-backdrop" id="restoreModal">
      <section class="settings-modal" role="dialog" aria-modal="true" aria-labelledby="restoreTitle">
        <header class="settings-header">
          <div>
            <h2 id="restoreTitle">Восстановить MyCQ</h2>
            <p>Вставьте backup-ключ nsec... и задайте новый локальный пароль.</p>
          </div>
          <button class="icon-button" type="button" id="closeRestoreButton">×</button>
        </header>
        <div class="settings-body">
          <label class="field">
            Backup-ключ
            <textarea class="share-uin" id="restoreKeyInput" placeholder="nsec..."></textarea>
          </label>
          <label class="field">
            Ник
            <input id="restoreNicknameInput" maxlength="32" placeholder="Tester">
          </label>
          <label class="field">
            Новый пароль
            <input id="restorePasswordInput" type="password" minlength="8" placeholder="Минимум 8 символов">
          </label>
          <p class="error" id="restoreError" hidden></p>
        </div>
        <footer class="settings-actions">
          <button class="classic-button" type="button" id="restoreSaveButton">Восстановить</button>
          <button class="classic-button secondary" type="button" id="restoreCancelButton">Отмена</button>
        </footer>
      </section>
    </div>
  `);

  document.querySelector('#closeRestoreButton').addEventListener('click', closeRestoreModal);
  document.querySelector('#restoreCancelButton').addEventListener('click', closeRestoreModal);
  document.querySelector('#restoreSaveButton').addEventListener('click', restoreFromModal);
  document.querySelector('#restoreKeyInput').focus();
}

function closeRestoreModal() {
  document.querySelector('#restoreModal')?.remove();
}

async function restoreFromModal() {
  const error = document.querySelector('#restoreError');
  const backupKey = document.querySelector('#restoreKeyInput').value.trim();
  const nickname = document.querySelector('#restoreNicknameInput').value.trim();
  const password = document.querySelector('#restorePasswordInput').value;

  error.hidden = true;

  if (!nickname) {
    showError(error, 'Введите ник.');
    return;
  }

  if (!password || password.length < 8) {
    showError(error, 'Пароль должен быть минимум 8 символов.');
    return;
  }

  try {
    const secret = parseSecretKey(backupKey);
    closeRestoreModal();
    await saveProfileFromSecret(secret, nickname, password);
  } catch (err) {
    showError(error, 'Не удалось восстановить профиль: ' + getErrorMessage(err));
  }
}

async function saveProfileFromSecret(secret, nickname, password) {
  const secretHex = bytesToHex(secret);
  const pubkey = getPublicKey(secret);
  const encrypted = await encryptText(secretHex, password);

  state.profile = {
    nickname,
    pubkey,
    npub: nip19.npubEncode(pubkey),
    encryptedSecret: encrypted,
    relays: DEFAULT_RELAYS,
    createdAt: new Date().toISOString(),
  };
  state.secretHex = secretHex;
  state.contacts = [];
  state.messages = [];
  state.activeContact = null;
  state.seenEventIds = new Set();

  saveJson(PROFILE_KEY, state.profile);
  saveJson(CONTACTS_KEY, state.contacts);
  saveJson(MESSAGES_KEY, state.messages);
  render();
  publishProfileMetadata().catch((err) => {
    console.warn('Failed to publish profile metadata:', err);
  });
}

function renderLogin() {
  app.innerHTML = `
    <section class="auth-shell">
      <div class="auth-hero">
        <span class="flower auth-flower" aria-hidden="true"></span>
        <h1>MyCQ</h1>
        <p>Профиль хранится локально. Введите пароль, чтобы расшифровать ключ.</p>
      </div>
      <form class="auth-card setup-card" id="loginForm">
        <h2>С возвращением, ${escapeHtml(state.profile.nickname)}</h2>
        <label class="field">
          Пароль
          <input name="password" type="password" autocomplete="current-password" required autofocus>
        </label>
        <button class="classic-button" type="submit">Войти</button>
        <button class="classic-button secondary" type="button" id="resetButton">Сбросить профиль</button>
        <p class="error" id="loginError" hidden></p>
      </form>
    </section>
  `;

  document.querySelector('#loginForm').addEventListener('submit', handleLogin);
  document.querySelector('#resetButton').addEventListener('click', resetProfile);
}

async function handleLogin(event) {
  event.preventDefault();

  const error = document.querySelector('#loginError');
  error.hidden = true;

  try {
    state.secretHex = await decryptText(state.profile.encryptedSecret, event.currentTarget.password.value);
    render();
    publishProfileMetadata().catch((err) => {
      console.warn('Failed to publish profile metadata:', err);
    });
  } catch (err) {
    showError(error, 'Неверный пароль или поврежденный профиль.');
  }
}

function renderMessenger() {
  const isNarrowScreen = window.matchMedia('(max-width: 700px)').matches;
  const active = state.activeContact || (isNarrowScreen ? null : state.contacts[0]) || null;
  state.activeContact = active;
  const canChat = isAuthorizedContact(active);

  app.innerHTML = `
    <section class="mycq-window">
      <div class="messenger-layout mobile-${state.mobileView}">
        <aside class="contacts-panel">
          <div class="contacts-header">
            <div class="brand">
              <span class="flower brand-flower" aria-hidden="true"></span>
              <strong>MyCQ</strong>
            </div>
            <button class="primary-action" type="button" id="addContactButton">+ Добавить</button>
          </div>

          <div class="profile-card">
            <div class="mini-avatar">${escapeHtml(getInitials(state.profile.nickname))}</div>
            <div>
              <div class="profile-name">${escapeHtml(state.profile.nickname)}</div>
              <div class="status online">В сети</div>
            </div>
            <button class="profile-edit-button" type="button" id="editProfileButton" title="Изменить имя">✎</button>
          </div>

          <ul class="contact-list">
            ${renderContacts()}
          </ul>

          <div class="identity-box">
            <strong>Мой MyCQ UIN</strong>
            <div class="identity-line">${escapeHtml(state.profile.npub)}</div>
            <div class="dev-toolbar">
              <button class="classic-button small" type="button" id="shareContactButton">Поделиться</button>
              <button class="classic-button small secondary" type="button" id="syncButton">Синхр.</button>
              <button class="classic-button small secondary" type="button" id="settingsButton">Настройки</button>
              <button class="classic-button small secondary" type="button" id="lockButton">Выйти</button>
            </div>
          </div>
        </aside>

        <section class="chat-panel">
          <header class="chat-header">
            <div class="chat-identity">
              <button class="mobile-back-button" type="button" id="mobileBackButton">‹</button>
              <span class="flower chat-flower" aria-hidden="true"></span>
              <div>
                <h2 class="chat-title">${active ? escapeHtml(active.nickname) : 'Нет контакта'}</h2>
                <span class="relay-status" id="relayStatus">${active ? escapeHtml(getContactOnlineText(active)) : escapeHtml(getRelayStatusText())}</span>
              </div>
            </div>
            <div class="chat-actions">
              ${active ? '<button class="delete-contact-button" type="button" id="deleteContactButton">Удалить контакт</button>' : ''}
            </div>
          </header>

          <div class="message-history" id="messageHistory">
            ${renderMessages(active)}
          </div>

          <form class="composer" id="messageForm">
            <button class="composer-icon" type="button" data-smiley="☺">☺</button>
            <textarea class="message-input" name="message" rows="1" placeholder="${canChat ? 'Введите сообщение...' : 'Сначала авторизуйте контакт'}" ${canChat ? '' : 'disabled'}></textarea>
            <button class="send-button" type="submit" ${canChat ? '' : 'disabled'}>↗</button>
          </form>
        </section>
      </div>
    </section>
  `;

  document.querySelector('#addContactButton').addEventListener('click', addContact);
  document.querySelector('#shareContactButton').addEventListener('click', openShareContact);
  document.querySelector('#syncButton').addEventListener('click', syncNow);
  document.querySelector('#settingsButton').addEventListener('click', openSettings);
  document.querySelector('#lockButton').addEventListener('click', lockProfile);
  document.querySelector('#editProfileButton').addEventListener('click', editProfileName);
  const messageForm = document.querySelector('#messageForm');
  messageForm.addEventListener('submit', handleSendMessage);
  messageForm.message.addEventListener('keydown', handleMessageInputKeydown);

  document.querySelector('#deleteContactButton')?.addEventListener('click', deleteActiveContact);
  document.querySelector('#mobileBackButton')?.addEventListener('click', () => {
    state.mobileView = 'contacts';
    render();
  });

  document.querySelectorAll('.accept-contact-button').forEach((button) => {
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      acceptContact(button.dataset.pubkey);
    });
  });

  document.querySelectorAll('.request-contact-button').forEach((button) => {
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      resendContactRequest(button.dataset.pubkey);
    });
  });

  document.querySelectorAll('.contact-item').forEach((item) => {
    item.addEventListener('click', () => {
      state.activeContact = state.contacts.find((contact) => contact.pubkey === item.dataset.pubkey);
      state.mobileView = 'chat';
      render();
    });
    item.addEventListener('dblclick', () => {
      renameContact(item.dataset.pubkey);
    });
  });

  document.querySelectorAll('[data-smiley]').forEach((button) => {
    button.addEventListener('click', () => {
      const input = document.querySelector('.message-input');
      input.value = `${input.value}${button.dataset.smiley} `;
      input.focus();
    });
  });

  ensureNostrSync();
  scrollMessageHistoryToBottom();
}

function renderContacts() {
  if (state.contacts.length === 0) {
    return '<li class="empty-chat">Пока пусто. Нажмите +, чтобы добавить контакт.</li>';
  }

  return state.contacts.map((contact) => {
    const active = state.activeContact && state.activeContact.pubkey === contact.pubkey;
    const status = contact.status || 'Authorized';
    const isIncomingPending = status === 'Pending' && contact.requestDirection === 'incoming';
    const lastMessage = getLastMessageForContact(contact);

    return `
      <li class="contact-item ${active ? 'active' : ''}" data-pubkey="${escapeHtml(contact.pubkey)}">
        <div class="chat-avatar">${escapeHtml(getInitials(contact.nickname))}</div>
        <div class="contact-main">
          <div class="contact-line">
            <span class="contact-name">${escapeHtml(contact.nickname)}</span>
            <span class="contact-presence">${escapeHtml(getContactOnlineText(contact))}</span>
          </div>
          <div class="contact-preview">${escapeHtml(getContactPreview(contact, lastMessage))}</div>
          <span class="contact-actions">
            ${isIncomingPending ? `<button class="classic-button small accept-contact-button" type="button" data-pubkey="${escapeHtml(contact.pubkey)}">Принять</button>` : ''}
            ${['Pending', 'Request failed'].includes(status) && contact.requestDirection === 'outgoing' ? `<button class="classic-button small secondary request-contact-button" type="button" data-pubkey="${escapeHtml(contact.pubkey)}">Повторить</button>` : ''}
          </span>
        </div>
        ${isIncomingPending ? '<span class="unread-badge">1</span>' : ''}
      </li>
    `;
  }).join('');
}

function renderMessages(active) {
  if (!active) {
    return `
      <div class="empty-state">
        <span class="flower big-flower" aria-hidden="true"></span>
        <h3>Выберите чат</h3>
        <p>Добавьте контакт по MyCQ UIN или откройте существующий диалог.</p>
      </div>
    `;
  }

  const rows = state.messages.filter((message) => message.contactPubkey === active.pubkey);

  if (rows.length === 0) {
    if (!isAuthorizedContact(active)) {
      return `
        <div class="empty-state">
          <span class="flower big-flower" aria-hidden="true"></span>
          <h3>Ожидается авторизация</h3>
          <p>${active.requestDirection === 'incoming'
            ? 'Контакт просит авторизацию. Нажмите "Принять" в списке чатов.'
            : 'Запрос отправлен. Можно писать после подтверждения контакта.'}</p>
        </div>
      `;
    }

    return `
      <div class="empty-state">
        <span class="flower big-flower" aria-hidden="true"></span>
        <h3>Сегодня</h3>
        <p>Чат готов. Сообщения отправляются через Nostr relay как зашифрованные DM.</p>
      </div>
    `;
  }

  return rows.map((message) => `
    <div class="message-row ${message.direction === 'out' ? 'out' : 'in'}">
      <div class="message-bubble">
        ${message.direction === 'out' ? '' : `<span class="message-name">${escapeHtml(message.from)}</span>`}
        <span class="message-text">${escapeHtml(message.text)}</span>
        <span class="message-meta">
          ${new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          ${escapeHtml(getMessageStatusText(message.status))}
        </span>
      </div>
    </div>
  `).join('');
}

function getLastMessageForContact(contact) {
  return state.messages
    .filter((message) => message.contactPubkey === contact.pubkey)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0] || null;
}

function getContactPreview(contact, lastMessage) {
  if ((contact.status || 'Authorized') === 'Pending') {
    return contact.requestDirection === 'incoming'
      ? 'Запрос на добавление'
      : 'Ожидает подтверждения';
  }

  if (contact.status === 'Request failed') {
    return 'Запрос не отправился';
  }

  return lastMessage ? lastMessage.text : 'Нет сообщений';
}

function getContactTime(lastMessage, contact) {
  const sourceDate = lastMessage ? lastMessage.createdAt : contact.addedAt;

  if (!sourceDate) {
    return '';
  }

  return new Date(sourceDate).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function getContactOnlineText(contact) {
  if (!contact) {
    return 'Не в сети';
  }

  if (!isAuthorizedContact(contact)) {
    return 'Ожидает авторизации';
  }

  return 'В сети';
}

function deleteActiveContact() {
  if (!state.activeContact) {
    return;
  }

  const confirmed = confirm(`Удалить контакт ${state.activeContact.nickname}? История сообщений останется локально.`);

  if (!confirmed) {
    return;
  }

  const deletedPubkey = state.activeContact.pubkey;
  state.contacts = state.contacts.filter((contact) => contact.pubkey !== deletedPubkey);
  state.activeContact = state.contacts[0] || null;
  saveJson(CONTACTS_KEY, state.contacts);
  restartNostrSync();
  render();
}

function getInitials(value) {
  const text = String(value || 'MyCQ').trim();
  const words = text.split(/\s+/).filter(Boolean);

  if (words.length > 1) {
    return `${words[0][0]}${words[1][0]}`.toUpperCase();
  }

  return text.slice(0, 2).toUpperCase();
}

function addContact() {
  closeAddContactModal();

  document.body.insertAdjacentHTML('beforeend', `
    <div class="settings-backdrop" id="addContactModal">
      <section class="settings-modal" role="dialog" aria-modal="true" aria-labelledby="addContactTitle">
        <header class="settings-header">
          <div>
            <h2 id="addContactTitle">Добавить контакт</h2>
            <p>Вставьте MyCQ UIN контакта или импортируйте файл контакта.</p>
          </div>
          <button class="icon-button" type="button" id="closeAddContactButton">×</button>
        </header>

        <div class="settings-body">
          <label class="field">
            MyCQ UIN
            <input id="contactUinInput" placeholder="npub..." autocomplete="off">
          </label>
          <label class="field">
            Имя контакта
            <input id="contactNicknameInput" maxlength="32" placeholder="Например, Денис">
          </label>
          <label class="field">
            Импорт из файла контакта
            <input id="contactFileInput" type="file" accept=".txt,text/plain">
          </label>
          <p class="error" id="addContactError" hidden></p>
        </div>

        <footer class="settings-actions">
          <button class="classic-button" type="button" id="saveContactButton">Добавить</button>
          <button class="classic-button secondary" type="button" id="cancelAddContactButton">Отмена</button>
        </footer>
      </section>
    </div>
  `);

  document.querySelector('#closeAddContactButton').addEventListener('click', closeAddContactModal);
  document.querySelector('#cancelAddContactButton').addEventListener('click', closeAddContactModal);
  document.querySelector('#addContactModal').addEventListener('click', (event) => {
    if (event.target.id === 'addContactModal') {
      closeAddContactModal();
    }
  });
  document.querySelector('#saveContactButton').addEventListener('click', saveContactFromModal);
  document.querySelector('#contactFileInput').addEventListener('change', importContactFile);
  document.querySelector('#contactUinInput').focus();
}

function closeAddContactModal() {
  document.querySelector('#addContactModal')?.remove();
}

function openShareContact() {
  closeShareContactModal();

  document.body.insertAdjacentHTML('beforeend', `
    <div class="settings-backdrop" id="shareContactModal">
      <section class="settings-modal" role="dialog" aria-modal="true" aria-labelledby="shareContactTitle">
        <header class="settings-header">
          <div>
            <h2 id="shareContactTitle">Поделиться контактом</h2>
            <p>Передайте этот UIN человеку, который хочет добавить вас в MyCQ.</p>
          </div>
          <button class="icon-button" type="button" id="closeShareContactButton">×</button>
        </header>

        <div class="settings-body">
          <label class="field">
            Мой MyCQ UIN
            <textarea class="share-uin" id="shareUinText" readonly>${escapeHtml(state.profile.npub)}</textarea>
          </label>
          <div class="notice">
            Это публичный адрес, не приватный ключ. Его можно отправлять друзьям. Backup-ключ nsec... никому не отправляйте.
          </div>
        </div>

        <footer class="settings-actions">
          <button class="classic-button" type="button" id="copyUinButton">Копировать</button>
          <button class="classic-button secondary" type="button" id="nativeShareButton">Поделиться</button>
          <button class="classic-button secondary" type="button" id="downloadContactButton">Сохранить файл</button>
        </footer>
      </section>
    </div>
  `);

  document.querySelector('#closeShareContactButton').addEventListener('click', closeShareContactModal);
  document.querySelector('#shareContactModal').addEventListener('click', (event) => {
    if (event.target.id === 'shareContactModal') {
      closeShareContactModal();
    }
  });
  document.querySelector('#copyUinButton').addEventListener('click', copyOwnUin);
  document.querySelector('#nativeShareButton').addEventListener('click', nativeShareOwnUin);
  document.querySelector('#downloadContactButton').addEventListener('click', downloadOwnContactCard);
}

function closeShareContactModal() {
  document.querySelector('#shareContactModal')?.remove();
}

async function copyOwnUin() {
  await navigator.clipboard.writeText(state.profile.npub);
  alert('MyCQ UIN скопирован.');
}

async function nativeShareOwnUin() {
  const text = `Добавь меня в MyCQ:\n${state.profile.npub}`;

  if (navigator.share) {
    await navigator.share({
      title: 'MyCQ контакт',
      text,
    });
    return;
  }

  await navigator.clipboard.writeText(text);
  alert('Системный share недоступен. Контакт скопирован в буфер.');
}

function downloadOwnContactCard() {
  const content = [
    'MyCQ contact',
    `Nickname: ${state.profile.nickname}`,
    `UIN: ${state.profile.npub}`,
  ].join('\n');
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `mycq-${state.profile.nickname || 'contact'}.txt`;
  link.click();
  URL.revokeObjectURL(url);
}

async function saveContactFromModal() {
  const error = document.querySelector('#addContactError');
  const rawUin = document.querySelector('#contactUinInput').value.trim();
  const nickname = document.querySelector('#contactNicknameInput').value.trim() || 'Contact';

  error.hidden = true;

  const parsed = parsePublicKey(rawUin);

  if (!parsed) {
    showError(error, 'Не удалось распознать UIN. Нужен npub... или 64-символьный hex pubkey.');
    return;
  }

  if (parsed === state.profile.pubkey) {
    showError(error, 'Нельзя добавить самого себя в контакты.');
    return;
  }

  if (state.contacts.some((contact) => contact.pubkey === parsed)) {
    showError(error, 'Этот контакт уже добавлен.');
    return;
  }

  state.contacts.push({
    nickname,
    pubkey: parsed,
    npub: nip19.npubEncode(parsed),
    status: 'Pending',
    requestDirection: 'outgoing',
    nicknameSource: 'manual',
    color: '#c31e1e',
    addedAt: new Date().toISOString(),
  });

  saveJson(CONTACTS_KEY, state.contacts);
  state.activeContact = state.contacts[state.contacts.length - 1];
  restartNostrSync();
  render();
  fetchContactProfiles([parsed]).catch((err) => {
    console.warn('Failed to fetch contact profile:', err);
  });
  closeAddContactModal();
  await sendContactRequest(parsed);
}

async function importContactFile(event) {
  const file = event.currentTarget.files && event.currentTarget.files[0];

  if (!file) {
    return;
  }

  const text = await file.text();
  const uinMatch = text.match(/UIN:\s*(npub[0-9a-z]+)/i);
  const nicknameMatch = text.match(/Nickname:\s*(.+)/i);

  if (uinMatch) {
    document.querySelector('#contactUinInput').value = uinMatch[1].trim();
  }

  if (nicknameMatch && !document.querySelector('#contactNicknameInput').value.trim()) {
    document.querySelector('#contactNicknameInput').value = nicknameMatch[1].trim();
  }
}

async function acceptContact(pubkey) {
  const contact = state.contacts.find((item) => item.pubkey === pubkey);

  if (!contact) {
    return;
  }

  contact.status = 'Authorized';
  contact.requestDirection = 'accepted';
  contact.authorizedAt = new Date().toISOString();
  saveJson(CONTACTS_KEY, state.contacts);
  restartNostrSync();
  render();

  try {
    await sendProtocolMessage(pubkey, {
      type: PROTOCOL.AUTH_ACCEPT,
      nickname: state.profile.nickname,
      pubkey: state.profile.pubkey,
      npub: state.profile.npub,
      ntfyTopic: getOwnNotificationTopic(),
      createdAt: new Date().toISOString(),
    });
    setRelayStatus('online');
  } catch (err) {
    setRelayStatus('auth accept error: ' + getErrorMessage(err));
  }
}

async function resendContactRequest(pubkey) {
  await sendContactRequest(pubkey);
}

async function sendContactRequest(pubkey) {
  const contact = state.contacts.find((item) => item.pubkey === pubkey);
  setRelayStatus('sending request');

  if (contact) {
    contact.status = 'Pending';
    contact.requestDirection = 'outgoing';
    saveJson(CONTACTS_KEY, state.contacts);
    render();
  }

  try {
    await publishContactRequest(pubkey);
    await sendProtocolMessage(pubkey, {
      type: PROTOCOL.AUTH_REQUEST,
      nickname: state.profile.nickname,
      pubkey: state.profile.pubkey,
      npub: state.profile.npub,
      ntfyTopic: getOwnNotificationTopic(),
      createdAt: new Date().toISOString(),
    });
    setRelayStatus('online');
  } catch (err) {
    if (contact) {
      contact.status = 'Request failed';
      saveJson(CONTACTS_KEY, state.contacts);
      render();
    }
    setRelayStatus('request error: ' + getErrorMessage(err));
  }
}

async function handleSendMessage(event) {
  event.preventDefault();

  const form = event.currentTarget;
  const text = event.currentTarget.message.value.trim();

  if (!text || !state.activeContact) {
    return;
  }

  if (!isAuthorizedContact(state.activeContact)) {
    alert('Сначала нужно авторизовать контакт.');
    return;
  }

  form.message.value = '';
  setRelayStatus('sending');

  const message = {
    id: crypto.randomUUID(),
    contactPubkey: state.activeContact.pubkey,
    direction: 'out',
    from: state.profile.nickname,
    text,
    createdAt: new Date().toISOString(),
    status: 'sending',
  };

  state.messages.push(message);
  saveJson(MESSAGES_KEY, state.messages);
  render();

  try {
    const event = await createEncryptedDirectMessage(state.activeContact.pubkey, text);
    await publishEvent(event);

    message.eventId = event.id;
    message.status = 'sent';
    state.seenEventIds.add(event.id);
    saveJson(MESSAGES_KEY, state.messages);
    notifyContact(state.activeContact).catch((err) => {
      console.warn('ntfy notification failed:', err);
    });
    setRelayStatus('online');
    render();
  } catch (err) {
    message.status = 'failed';
    saveJson(MESSAGES_KEY, state.messages);
    setRelayStatus('error: ' + getErrorMessage(err));
    render();
  }
}

function handleMessageInputKeydown(event) {
  if (event.key !== 'Enter' || event.shiftKey || event.ctrlKey || event.altKey || event.metaKey) {
    return;
  }

  event.preventDefault();
  event.currentTarget.form.requestSubmit();
}

function scrollMessageHistoryToBottom() {
  const history = document.querySelector('#messageHistory');

  if (!history) {
    return;
  }

  window.requestAnimationFrame(() => {
    history.scrollTop = history.scrollHeight;
  });
}

async function editProfileName() {
  const nickname = prompt('Введите новое имя профиля MyCQ.', state.profile.nickname);

  if (nickname === null) {
    return;
  }

  const nextNickname = nickname.trim();

  if (!nextNickname) {
    alert('Имя профиля не может быть пустым.');
    return;
  }

  state.profile.nickname = nextNickname;
  saveJson(PROFILE_KEY, state.profile);
  render();

  try {
    await publishProfileMetadata();
    await sendProfileUpdateToAuthorizedContacts();
    setRelayStatus('online');
  } catch (err) {
    setRelayStatus('profile update error: ' + getErrorMessage(err));
  }
}

function renameContact(pubkey) {
  const contact = state.contacts.find((item) => item.pubkey === pubkey);

  if (!contact) {
    return;
  }

  const nickname = prompt('Локальное имя контакта.', contact.nickname);

  if (nickname === null) {
    return;
  }

  const nextNickname = nickname.trim();

  if (!nextNickname) {
    alert('Имя контакта не может быть пустым.');
    return;
  }

  contact.nickname = nextNickname;
  contact.nicknameSource = 'manual';
  saveJson(CONTACTS_KEY, state.contacts);
  render();
}

async function openSettings() {
  closeSettingsModal();

  document.body.insertAdjacentHTML('beforeend', `
    <div class="settings-backdrop" id="settingsModal">
      <section class="settings-modal" role="dialog" aria-modal="true" aria-labelledby="settingsTitle">
        <header class="settings-header">
          <div>
            <h2 id="settingsTitle">Настройки MyCQ</h2>
            <p>Профиль, уведомления и служебные действия.</p>
          </div>
          <button class="icon-button" type="button" id="closeSettingsButton">×</button>
        </header>

        <div class="settings-body">
          <label class="field">
            Имя профиля
            <input id="settingsNickname" maxlength="32" value="${escapeHtml(state.profile.nickname)}">
          </label>

          <label class="field">
            MyCQ UIN
            <input readonly value="${escapeHtml(state.profile.npub)}">
          </label>

          <label class="field">
            ntfy topic
            <input id="settingsNtfyTopic" value="${escapeHtml(getOwnNotificationTopic())}" placeholder="mycq-...">
          </label>

          <div class="notice">
            Topic нужен для push-уведомлений. В приложении ntfy на телефоне подпишитесь на такой же topic.
          </div>
        </div>

        <footer class="settings-actions">
          <button class="classic-button" type="button" id="saveSettingsButton">Сохранить</button>
          <button class="classic-button secondary" type="button" id="testNtfyButton">Тест ntfy</button>
          <button class="classic-button secondary" type="button" id="settingsBackupButton">Backup</button>
          <button class="classic-button secondary" type="button" id="settingsSyncButton">Sync</button>
        </footer>
      </section>
    </div>
  `);

  document.querySelector('#closeSettingsButton').addEventListener('click', closeSettingsModal);
  document.querySelector('#settingsModal').addEventListener('click', (event) => {
    if (event.target.id === 'settingsModal') {
      closeSettingsModal();
    }
  });
  document.querySelector('#saveSettingsButton').addEventListener('click', saveSettingsFromModal);
  document.querySelector('#testNtfyButton').addEventListener('click', testSettingsNtfy);
  document.querySelector('#settingsBackupButton').addEventListener('click', showBackup);
  document.querySelector('#settingsSyncButton').addEventListener('click', syncNow);
  document.querySelector('#settingsNickname').focus();
}

function closeSettingsModal() {
  document.querySelector('#settingsModal')?.remove();
}

async function saveSettingsFromModal() {
  const nickname = document.querySelector('#settingsNickname').value.trim();
  const ntfyTopic = normalizeNtfyTopic(document.querySelector('#settingsNtfyTopic').value);

  if (!nickname) {
    alert('Имя профиля не может быть пустым.');
    return;
  }

  state.profile.nickname = nickname;
  state.profile.ntfyTopic = ntfyTopic;
  state.profile.ntfyEnabled = Boolean(ntfyTopic);
  saveJson(PROFILE_KEY, state.profile);

  try {
    await publishProfileMetadata();
    await sendProfileUpdateToAuthorizedContacts();
    setRelayStatus('online');
  } catch (err) {
    setRelayStatus('settings update error: ' + getErrorMessage(err));
  }

  closeSettingsModal();
  render();
}

async function testSettingsNtfy() {
  const topic = normalizeNtfyTopic(document.querySelector('#settingsNtfyTopic').value);

  if (!topic) {
    alert('Сначала укажите ntfy topic.');
    return;
  }

  try {
    await sendNtfyNotification(topic, 'Тестовое уведомление MyCQ');
    alert('Тестовое уведомление отправлено.');
  } catch (err) {
    alert('Тестовое уведомление не отправилось: ' + getErrorMessage(err));
  }
}

function showBackup() {
  const nsec = nip19.nsecEncode(hexToBytes(state.secretHex));

  alert(
    'Сохраните резервный ключ в надежном месте. Его можно вставить на первом экране MyCQ через "Восстановить из backup". Любой, у кого он есть, сможет читать и писать от вашего имени.\n\n' +
    nsec
  );
}

function lockProfile() {
  stopNostrSync();
  state.secretHex = null;
  render();
}

async function configureNotifications() {
  const currentTopic = state.profile.ntfyTopic || generateNtfyTopic();
  const topic = prompt(
    'Topic для ntfy.sh. Установите приложение ntfy на телефон и подпишитесь на этот topic. Оставьте пустым, чтобы отключить уведомления.',
    currentTopic
  );

  if (topic === null) {
    return;
  }

  const normalizedTopic = normalizeNtfyTopic(topic);
  state.profile.ntfyTopic = normalizedTopic;
  state.profile.ntfyEnabled = Boolean(normalizedTopic);
  saveJson(PROFILE_KEY, state.profile);
  render();

  if (normalizedTopic) {
    let testResult = 'Тестовое уведомление отправлено.';

    try {
      await sendNtfyNotification(normalizedTopic, 'Тестовое уведомление MyCQ');
    } catch (err) {
      testResult = 'Тестовое уведомление не отправилось: ' + getErrorMessage(err);
    }

    await sendProfileUpdateToAuthorizedContacts();
    alert(
      'Уведомления включены.\n\n' +
      '1. Установите ntfy на телефон.\n' +
      '2. Подпишитесь на topic:\n' +
      normalizedTopic + '\n\n' +
      'Проверка в браузере:\n' +
      `https://ntfy.sh/${normalizedTopic}\n\n` +
      testResult + '\n\n' +
      'Если вы подписались на телефоне после этого окна, нажмите Notify еще раз для повторного теста.'
    );
  }
}

function resetProfile() {
  const confirmed = confirm('Удалить локальный профиль MyCQ с этого устройства? Если нет backup-ключа, аккаунт будет потерян.');

  if (!confirmed) {
    return;
  }

  localStorage.removeItem(PROFILE_KEY);
  localStorage.removeItem(CONTACTS_KEY);
  localStorage.removeItem(MESSAGES_KEY);
  state.profile = null;
  state.secretHex = null;
  state.contacts = [];
  state.messages = [];
  state.activeContact = null;
  render();
}

function ensureNostrSync() {
  if (!state.profile || !state.secretHex) {
    setRelayStatus('offline');
    return;
  }

  const fingerprint = [
    state.profile.pubkey,
    ...state.contacts.map((contact) => contact.pubkey).sort(),
  ].join(':');

  if (state.subscription && state.subscriptionFingerprint === fingerprint) {
    return;
  }

  stopNostrSync();
  state.subscriptionFingerprint = fingerprint;
  state.pool = new SimplePool();
  setRelayStatus('connecting');

  const since = Math.floor(Date.now() / 1000) - 60 * 60 * 24 * 14;
  const contactPubkeys = state.contacts.map((contact) => contact.pubkey);
  const filters = [
    {
      kinds: [4, MYCQ_CONTACT_REQUEST_KIND],
      '#p': [state.profile.pubkey],
      since,
    },
  ];

  if (contactPubkeys.length > 0) {
    filters.push({
      kinds: [4],
      authors: [state.profile.pubkey],
      '#p': contactPubkeys,
      since,
    });
  }

  try {
    state.subscription = state.pool.subscribeMany(
      state.profile.relays,
      filters,
      {
        onevent: handleNostrEvent,
        oneose: () => setRelayStatus('online'),
      }
    );
    fetchRecentMessages();
    state.syncTimer = window.setInterval(fetchRecentMessages, 15000);
  } catch (err) {
    setRelayStatus('error: ' + getErrorMessage(err));
  }
}

function restartNostrSync() {
  state.subscriptionFingerprint = '';
  stopNostrSync();
}

function stopNostrSync() {
  if (state.syncTimer) {
    window.clearInterval(state.syncTimer);
  }

  if (state.subscription && typeof state.subscription.close === 'function') {
    state.subscription.close();
  }

  if (state.pool && typeof state.pool.close === 'function') {
    state.pool.close(state.profile ? state.profile.relays : []);
  }

  state.subscription = null;
  state.pool = null;
  state.syncTimer = null;
}

async function syncNow() {
  if (!state.secretHex) {
    return;
  }

  if (!state.pool) {
    restartNostrSync();
    ensureNostrSync();
    return;
  }

  await fetchRecentMessages();
}

async function fetchRecentMessages() {
  if (!state.pool || !state.profile) {
    return;
  }

  if (typeof state.pool.querySync !== 'function') {
    return;
  }

  setRelayStatus('syncing');
  await fetchContactProfiles();

  const since = Math.floor(Date.now() / 1000) - 60 * 60 * 24 * 14;
  const contactPubkeys = state.contacts.map((contact) => contact.pubkey);
  const filters = [
    {
      kinds: [4, MYCQ_CONTACT_REQUEST_KIND],
      '#p': [state.profile.pubkey],
      since,
    },
  ];

  if (contactPubkeys.length > 0) {
    filters.push({
      kinds: [4],
      authors: [state.profile.pubkey],
      '#p': contactPubkeys,
      since,
    });
  }

  try {
    const batches = await Promise.all(filters.map((filter) => (
      state.pool.querySync(state.profile.relays, filter, { maxWait: 5000 })
    )));
    const events = batches.flat();

    for (const event of events) {
      await handleNostrEvent(event);
    }

    setRelayStatus('online');
  } catch (err) {
    setRelayStatus('sync error: ' + getErrorMessage(err));
  }
}

async function handleNostrEvent(event) {
  if (!event || state.seenEventIds.has(event.id)) {
    return;
  }

  if (event.kind === MYCQ_CONTACT_REQUEST_KIND) {
    handlePublicContactRequest(event);
    state.seenEventIds.add(event.id);
    return;
  }

  const peerPubkey = event.pubkey === state.profile.pubkey
    ? getFirstPTag(event)
    : event.pubkey;

  try {
    const text = await nip04.decrypt(hexToBytes(state.secretHex), peerPubkey, event.content);
    const protocolMessage = parseProtocolMessage(text);

    if (protocolMessage) {
      state.seenEventIds.add(event.id);

      if (event.pubkey !== state.profile.pubkey) {
        handleProtocolMessage(protocolMessage, peerPubkey, event);
      }

      return;
    }

    const contact = state.contacts.find((item) => item.pubkey === peerPubkey);

    if (!contact || !isAuthorizedContact(contact)) {
      return;
    }

    state.seenEventIds.add(event.id);
    state.messages.push({
      id: event.id,
      eventId: event.id,
      contactPubkey: contact.pubkey,
      direction: event.pubkey === state.profile.pubkey ? 'out' : 'in',
      from: event.pubkey === state.profile.pubkey ? state.profile.nickname : contact.nickname,
      text,
      createdAt: new Date(event.created_at * 1000).toISOString(),
      status: 'received',
    });

    state.messages.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    saveJson(MESSAGES_KEY, state.messages);
    render();
  } catch (err) {
    console.warn('Failed to decrypt Nostr DM:', err);
  }
}

function handleProtocolMessage(message, peerPubkey, event) {
  if (message.type === PROTOCOL.AUTH_REQUEST) {
    upsertContact({
      nickname: message.nickname || 'Contact',
      pubkey: peerPubkey,
      npub: nip19.npubEncode(peerPubkey),
      notificationTopic: normalizeNtfyTopic(message.ntfyTopic || ''),
      status: 'Pending',
      requestDirection: 'incoming',
      color: '#c31e1e',
      addedAt: new Date(event.created_at * 1000).toISOString(),
    });
    return;
  }

  if (message.type === PROTOCOL.AUTH_ACCEPT) {
    upsertContact({
      nickname: message.nickname || 'Contact',
      pubkey: peerPubkey,
      npub: nip19.npubEncode(peerPubkey),
      notificationTopic: normalizeNtfyTopic(message.ntfyTopic || ''),
      status: 'Authorized',
      requestDirection: 'accepted',
      color: '#c31e1e',
      addedAt: new Date(event.created_at * 1000).toISOString(),
      authorizedAt: new Date(event.created_at * 1000).toISOString(),
    });
    sendProfileUpdate(peerPubkey).catch((err) => {
      console.warn('Failed to send profile update:', err);
    });
    return;
  }

  if (message.type === PROTOCOL.PROFILE_UPDATE) {
    upsertContact({
      nickname: message.nickname || 'Contact',
      pubkey: peerPubkey,
      npub: nip19.npubEncode(peerPubkey),
      notificationTopic: normalizeNtfyTopic(message.ntfyTopic || ''),
      status: 'Authorized',
      requestDirection: 'accepted',
      color: '#c31e1e',
      addedAt: new Date(event.created_at * 1000).toISOString(),
    });
  }
}

function handlePublicContactRequest(event) {
  if (event.pubkey === state.profile.pubkey || !eventTagsPubkey(event, state.profile.pubkey)) {
    return;
  }

  const message = parseProtocolMessage(event.content);

  if (!message || message.type !== PROTOCOL.AUTH_REQUEST) {
    return;
  }

  upsertContact({
    nickname: message.nickname || 'Contact',
    pubkey: event.pubkey,
    npub: nip19.npubEncode(event.pubkey),
    status: 'Pending',
    requestDirection: 'incoming',
    color: '#c31e1e',
    addedAt: new Date(event.created_at * 1000).toISOString(),
  });
}

function parseProtocolMessage(text) {
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed.type === 'string' && parsed.type.startsWith('mycq.')
      ? parsed
      : null;
  } catch (err) {
    return null;
  }
}

function upsertContact(nextContact) {
  if (nextContact.pubkey === state.profile.pubkey) {
    return;
  }

  const existing = state.contacts.find((contact) => contact.pubkey === nextContact.pubkey);

  if (existing) {
    const existingNicknameIsManual = existing.nicknameSource === 'manual';
    const existingIsAuthorized = isAuthorizedContact(existing);
    const nextIsPending = nextContact.status === 'Pending';

    if (existingIsAuthorized && nextIsPending) {
      nextContact = {
        ...nextContact,
        status: existing.status,
        requestDirection: existing.requestDirection || 'accepted',
        authorizedAt: existing.authorizedAt,
      };
    }

    Object.assign(existing, {
      ...nextContact,
      nickname: existingNicknameIsManual ? existing.nickname : (nextContact.nickname || existing.nickname),
      nicknameSource: existingNicknameIsManual ? 'manual' : (nextContact.nicknameSource || existing.nicknameSource),
      addedAt: existing.addedAt || nextContact.addedAt,
    });
  } else {
    state.contacts.push(nextContact);
  }

  saveJson(CONTACTS_KEY, state.contacts);
  state.activeContact = state.activeContact || nextContact;
  restartNostrSync();
  render();
}

async function createEncryptedDirectMessage(receiverPubkey, text) {
  const secret = hexToBytes(state.secretHex);
  const encrypted = await nip04.encrypt(secret, receiverPubkey, text);

  return finalizeEvent(
    {
      kind: 4,
      created_at: Math.floor(Date.now() / 1000),
      tags: [['p', receiverPubkey]],
      content: encrypted,
    },
    secret
  );
}

async function sendProtocolMessage(receiverPubkey, message) {
  const event = await createEncryptedDirectMessage(receiverPubkey, JSON.stringify(message));
  await publishEvent(event);
  state.seenEventIds.add(event.id);
}

async function sendProfileUpdate(receiverPubkey) {
  await sendProtocolMessage(receiverPubkey, {
    type: PROTOCOL.PROFILE_UPDATE,
    nickname: state.profile.nickname,
    pubkey: state.profile.pubkey,
    npub: state.profile.npub,
    ntfyTopic: getOwnNotificationTopic(),
    createdAt: new Date().toISOString(),
  });
}

async function sendProfileUpdateToAuthorizedContacts() {
  const authorizedContacts = state.contacts.filter(isAuthorizedContact);

  await Promise.allSettled(
    authorizedContacts.map((contact) => sendProfileUpdate(contact.pubkey))
  );
}

async function publishContactRequest(receiverPubkey) {
  const event = finalizeEvent(
    {
      kind: MYCQ_CONTACT_REQUEST_KIND,
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ['p', receiverPubkey],
        ['client', 'MyCQ'],
      ],
      content: JSON.stringify({
        type: PROTOCOL.AUTH_REQUEST,
        nickname: state.profile.nickname,
        pubkey: state.profile.pubkey,
        npub: state.profile.npub,
        createdAt: new Date().toISOString(),
      }),
    },
    hexToBytes(state.secretHex)
  );

  await publishEvent(event);
  state.seenEventIds.add(event.id);
}

async function publishProfileMetadata() {
  if (!state.profile || !state.secretHex) {
    return;
  }

  const metadata = {
    name: state.profile.nickname,
    display_name: state.profile.nickname,
    about: 'MyCQ user',
    picture: '',
  };

  const event = finalizeEvent(
    {
      kind: 0,
      created_at: Math.floor(Date.now() / 1000),
      tags: [['client', 'MyCQ']],
      content: JSON.stringify(metadata),
    },
    hexToBytes(state.secretHex)
  );

  await publishEvent(event);
}

async function fetchContactProfiles(pubkeys = state.contacts.map((contact) => contact.pubkey)) {
  const uniquePubkeys = [...new Set(pubkeys)].filter(Boolean);

  if (!state.profile || uniquePubkeys.length === 0) {
    return;
  }

  if (!state.pool) {
    state.pool = new SimplePool();
  }

  if (typeof state.pool.querySync !== 'function') {
    return;
  }

  const events = await state.pool.querySync(
    state.profile.relays,
    {
      kinds: [0],
      authors: uniquePubkeys,
      limit: uniquePubkeys.length,
    },
    { maxWait: 4000 }
  );

  const newestByAuthor = new Map();
  events.forEach((event) => {
    const previous = newestByAuthor.get(event.pubkey);

    if (!previous || event.created_at > previous.created_at) {
      newestByAuthor.set(event.pubkey, event);
    }
  });

  let changed = false;

  newestByAuthor.forEach((event, pubkey) => {
    const contact = state.contacts.find((item) => item.pubkey === pubkey);

    if (!contact || contact.nicknameSource === 'manual') {
      return;
    }

    const metadata = parseProfileMetadata(event.content);
    const nextName = metadata.display_name || metadata.name;

    if (nextName && nextName !== contact.nickname) {
      contact.nickname = nextName;
      contact.nicknameSource = 'nostr';
      changed = true;
    }
  });

  if (changed) {
    saveJson(CONTACTS_KEY, state.contacts);
    render();
  }
}

function parseProfileMetadata(content) {
  try {
    const metadata = JSON.parse(content);

    return metadata && typeof metadata === 'object' ? metadata : {};
  } catch (err) {
    return {};
  }
}

async function publishEvent(event) {
  if (!state.pool) {
    state.pool = new SimplePool();
  }

  const result = state.pool.publish(state.profile.relays, event);
  const promises = Array.isArray(result) ? result : [result];

  if (promises.length === 0) {
    throw new Error('No publish promises returned by relay pool.');
  }

  const settled = await Promise.allSettled(
    promises.map((promise) => withTimeout(Promise.resolve(promise), 8000))
  );
  const successCount = settled.filter((item) => item.status === 'fulfilled').length;

  if (successCount === 0) {
    const reason = settled.find((item) => item.status === 'rejected');
    throw new Error(reason ? getErrorMessage(reason.reason) : 'All relays rejected the message.');
  }

  return successCount;
}

function getFirstPTag(event) {
  const tag = event.tags.find((item) => item[0] === 'p' && item[1]);
  return tag ? tag[1] : null;
}

function eventTagsPubkey(event, pubkey) {
  return event.tags.some((item) => item[0] === 'p' && item[1] === pubkey);
}

function setRelayStatus(status) {
  state.relayStatus = status;
  const node = document.querySelector('#relayStatus');

  if (node) {
    node.textContent = getRelayStatusText();
  }
}

function getRelayStatusText() {
  const statusMap = {
    offline: 'Relay: offline',
    connecting: 'Relay: connecting...',
    online: 'Relay: online',
    sending: 'Relay: sending...',
    syncing: 'Relay: syncing...',
    'waiting for contacts': 'Relay: waiting for contacts',
  };

  return statusMap[state.relayStatus] || `Relay: ${state.relayStatus}`;
}

function getMessageStatusText(status) {
  const statusMap = {
    sending: 'отправка...',
    sent: 'отправлено',
    failed: 'ошибка',
    received: '',
    'local-demo': 'локально',
  };

  return statusMap[status] || '';
}

async function notifyContact(contact) {
  if (!contact || !contact.notificationTopic) {
    return;
  }

  const topic = normalizeNtfyTopic(contact.notificationTopic);

  if (!topic) {
    return;
  }

  await sendNtfyNotification(topic, `Новое сообщение MyCQ от ${state.profile.nickname}`);
}

async function sendNtfyNotification(topic, text) {
  const url = new URL(`https://ntfy.sh/${encodeURIComponent(topic)}`);
  url.searchParams.set('title', 'MyCQ');
  url.searchParams.set('tags', 'incoming_envelope');
  url.searchParams.set('priority', 'default');

  const response = await fetch(url.toString(), {
    method: 'POST',
    body: text,
  });

  if (!response.ok) {
    throw new Error(`ntfy HTTP ${response.status}`);
  }
}

function isAuthorizedContact(contact) {
  return Boolean(contact) && (contact.status || 'Authorized') === 'Authorized';
}

function getOwnNotificationTopic() {
  return state.profile && state.profile.ntfyEnabled
    ? normalizeNtfyTopic(state.profile.ntfyTopic || '')
    : '';
}

function getNotificationStatusText() {
  const topic = getOwnNotificationTopic();
  return topic ? `ntfy.sh/${topic}` : 'off';
}

function generateNtfyTopic() {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return `mycq-${bytesToHex(bytes)}`;
}

function normalizeNtfyTopic(value) {
  return String(value || '')
    .trim()
    .replace(/^https?:\/\/ntfy\.sh\//i, '')
    .replace(/[^a-zA-Z0-9_-]/g, '')
    .slice(0, 96);
}

function getContactStatusText(contact) {
  const npub = contact.npub || nip19.npubEncode(contact.pubkey);
  const notify = contact.notificationTopic ? ' · notify' : '';

  if ((contact.status || 'Authorized') === 'Authorized') {
    return `Authorized${notify} · ${npub}`;
  }

  if (contact.status === 'Request failed') {
    return `Request failed · ${npub}`;
  }

  if (contact.requestDirection === 'incoming') {
    return `Pending request · ${npub}`;
  }

  return `Pending · ${npub}`;
}

function migrateProfile() {
  if (!state.profile) {
    return;
  }

  const currentRelays = Array.isArray(state.profile.relays) ? state.profile.relays : [];
  const mergedRelays = [...new Set([...currentRelays, ...DEFAULT_RELAYS])];

  if (mergedRelays.length !== currentRelays.length) {
    state.profile.relays = mergedRelays;
    saveJson(PROFILE_KEY, state.profile);
  }

  let contactsChanged = false;
  state.contacts.forEach((contact) => {
    if (!contact.status) {
      contact.status = 'Authorized';
      contactsChanged = true;
    }

    if (!contact.npub) {
      contact.npub = nip19.npubEncode(contact.pubkey);
      contactsChanged = true;
    }

    if (!contact.nicknameSource) {
      contact.nicknameSource = 'manual';
      contactsChanged = true;
    }
  });

  if (contactsChanged) {
    saveJson(CONTACTS_KEY, state.contacts);
  }
}

function withTimeout(promise, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      reject(new Error('Relay timeout.'));
    }, timeoutMs);

    promise
      .then(resolve)
      .catch(reject)
      .finally(() => window.clearTimeout(timer));
  });
}

function parsePublicKey(value) {
  if (/^[0-9a-f]{64}$/i.test(value)) {
    return value.toLowerCase();
  }

  try {
    const decoded = nip19.decode(value);
    return decoded.type === 'npub' ? decoded.data : null;
  } catch (err) {
    return null;
  }
}

function parseSecretKey(value) {
  const trimmed = String(value || '').trim();

  if (/^[0-9a-f]{64}$/i.test(trimmed)) {
    return hexToBytes(trimmed);
  }

  const decoded = nip19.decode(trimmed);

  if (decoded.type !== 'nsec') {
    throw new Error('Ожидался ключ формата nsec...');
  }

  return decoded.data;
}

async function encryptText(text, password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveAesKey(password, salt);
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(text)
  );

  return {
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
  };
}

async function decryptText(encrypted, password) {
  const salt = base64ToBytes(encrypted.salt);
  const iv = base64ToBytes(encrypted.iv);
  const ciphertext = base64ToBytes(encrypted.ciphertext);
  const key = await deriveAesKey(password, salt);
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);

  return new TextDecoder().decode(plaintext);
}

async function deriveAesKey(password, salt) {
  const passwordKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveKey']
  );

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt,
      iterations: 210000,
      hash: 'SHA-256',
    },
    passwordKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

function bytesToHex(bytes) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);

  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }

  return bytes;
}

function bytesToBase64(bytes) {
  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

function base64ToBytes(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }

  return bytes;
}

function loadJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (err) {
    return fallback;
  }
}

function saveJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function showError(node, text) {
  node.textContent = text;
  node.hidden = false;
}

function getErrorMessage(err) {
  return err && err.message ? err.message : String(err);
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) {
    return;
  }

  navigator.serviceWorker.register('sw.js').catch((err) => {
    console.warn('Service worker registration failed:', err);
  });
}
