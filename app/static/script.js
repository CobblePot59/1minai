let uploadedFiles = [];
let chatHistory = [];
let currentChatId = null;
let currentConversationId = null;
let abortController = null;

function generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = Math.random() * 16 | 0;
        return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
}

function setUserDisplay(name, avatarUrl) {
    const nameEl = document.getElementById('userName');
    const avatarEl = document.getElementById('userAvatar');
    nameEl.textContent = name || 'Utilisateur';
    if (avatarUrl) {
        avatarEl.style.backgroundImage = `url(${avatarUrl})`;
        avatarEl.style.backgroundSize = 'cover';
        avatarEl.textContent = '';
    } else {
        avatarEl.style.backgroundImage = '';
        avatarEl.textContent = (name || 'U').charAt(0).toUpperCase();
    }
}

async function loadUsername() {
    const cached = localStorage.getItem('userInfo');
    if (cached) {
        const u = JSON.parse(cached);
        if (u.userName) {
            setUserDisplay(u.userName, u.userAvatar);
            return;
        }
        localStorage.removeItem('userInfo');
    }
    try {
        const res = await fetch('/api/user-info');
        if (res.ok) {
            const u = await res.json();
            if (u.userName) {
                localStorage.setItem('userInfo', JSON.stringify(u));
                setUserDisplay(u.userName, u.userAvatar);
                return;
            }
        }
    } catch (_) {}
    setUserDisplay('Utilisateur', null);
}

function updateUserFromResponse(data) {
    const teamUser = data?.aiRecord?.teamUser;
    if (!teamUser?.userName) return;
    localStorage.setItem('userInfo', JSON.stringify(teamUser));
    setUserDisplay(teamUser.userName, teamUser.userAvatar);
}

function openSettings() {
    document.getElementById('settingsModal').classList.add('active');
}

function closeSettings() {
    document.getElementById('settingsModal').classList.remove('active');
    saveSettings();
}

function saveSettings() {
    try {
        const settings = {
            model: document.getElementById('modelSelect').value,
            webSearch: document.getElementById('webSearchCheckbox').checked,
            numOfSite: document.getElementById('numOfSite').value,
            maxWord: document.getElementById('maxWord').value
        };
        localStorage.setItem('appSettings', JSON.stringify(settings));
    } catch (_) {}
}

function loadSettings() {
    try {
        const saved = localStorage.getItem('appSettings');
        if (saved) {
            const s = JSON.parse(saved);
            document.getElementById('modelSelect').value = s.model || 'gpt-4o-mini';
            document.getElementById('webSearchCheckbox').checked = s.webSearch || false;
            document.getElementById('numOfSite').value = s.numOfSite || 1;
            document.getElementById('maxWord').value = s.maxWord || 500;
            toggleWebSearch();
        }
    } catch (_) {}
}

function toggleWebSearch() {
    const checked = document.getElementById('webSearchCheckbox').checked;
    document.getElementById('webSearchSettings').style.display = checked ? 'block' : 'none';
}

function handleKeydown(event) {
    if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        sendMessage();
    }
}

function setStreaming(active) {
    document.getElementById('sendIcon').style.display = active ? 'none' : '';
    document.getElementById('stopIcon').style.display = active ? '' : 'none';
    const btn = document.getElementById('sendBtn');
    btn.onclick = active ? stopMessage : sendMessage;
}

function stopMessage() {
    if (abortController) abortController.abort();
}

// Extensions treated as plain text and inlined into the prompt
const TEXT_EXTENSIONS = new Set([
    'txt','md','py','js','ts','jsx','tsx','html','css','scss','json','csv',
    'xml','yaml','yml','toml','sh','bash','sql','go','java','c','cpp','h',
    'hpp','cs','php','rb','swift','kt','rs','vue','svelte','r','env','cfg','ini','conf'
]);

function readFile(file) {
    return new Promise(resolve => {
        const ext = file.name.split('.').pop().toLowerCase();
        const asText = TEXT_EXTENSIONS.has(ext) || file.type.startsWith('text/');
        const reader = new FileReader();
        reader.onload = (e) => resolve({
            filename: file.name,
            type: file.type,
            isText: asText,
            content: asText ? e.target.result : null,
            dataUrl: asText ? null : e.target.result,
        });
        if (asText) reader.readAsText(file);
        else reader.readAsDataURL(file);
    });
}

function handleFileUpload(event) {
    Array.from(event.target.files).forEach(file => {
        readFile(file).then(f => {
            uploadedFiles.push(f);
            displayFilePreview();
        });
    });
    document.getElementById('fileInput').value = '';
}

function displayFilePreview() {
    const preview = document.getElementById('imagePreview');
    preview.innerHTML = '';
    uploadedFiles.forEach((file, index) => {
        const item = document.createElement('div');
        item.className = 'preview-item';
        if (file.type.startsWith('image/')) {
            item.innerHTML = `
                <img src="${file.dataUrl}" alt="preview">
                <button class="preview-remove" onclick="removeFile(${index})">×</button>
            `;
        } else {
            item.innerHTML = `
                <div class="file-preview-icon">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                        <polyline points="14 2 14 8 20 8"></polyline>
                    </svg>
                    <span>${file.filename.length > 10 ? file.filename.substring(0, 10) + '...' : file.filename}</span>
                </div>
                <button class="preview-remove" onclick="removeFile(${index})">×</button>
            `;
        }
        preview.appendChild(item);
    });
}

function removeFile(index) {
    uploadedFiles.splice(index, 1);
    displayFilePreview();
}

async function sendMessage() {
    const promptInput = document.getElementById('promptInput');
    const prompt = promptInput.value.trim();
    if (!prompt) return;

    const model = document.getElementById('modelSelect').value;
    const webSearch = document.getElementById('webSearchCheckbox').checked;
    const numOfSite = parseInt(document.getElementById('numOfSite').value) || 1;
    const maxWord = parseInt(document.getElementById('maxWord').value) || 500;

    const filesToSend = [...uploadedFiles];
    addMessage(prompt, 'user', filesToSend);

    promptInput.value = '';
    promptInput.style.height = 'auto';
    uploadedFiles = [];
    displayFilePreview();
    addLoadingMessage();
    setStreaming(true);

    try {
        if (!currentConversationId) currentConversationId = generateUUID();

        const currentChat = chatHistory.find(c => c.id === currentChatId);
        const history = currentChat ? currentChat.messages.slice(-20) : [];

        const textFiles = filesToSend.filter(f => f.isText);
        const binaryFiles = filesToSend.filter(f => !f.isText);

        // Inline text file content directly into the prompt (API does not parse file attachments as text)
        const MAX_FILE_CHARS = 30000;
        let fullPrompt = prompt;
        if (textFiles.length > 0) {
            const blocks = textFiles.map(f => {
                const content = f.content.length > MAX_FILE_CHARS
                    ? f.content.substring(0, MAX_FILE_CHARS) + '\n[truncated]'
                    : f.content;
                return `\n\n--- ${f.filename} ---\n\`\`\`\n${content}\n\`\`\``;
            }).join('');
            fullPrompt = prompt + blocks;
        }

        const requestPayload = {
            prompt: fullPrompt,
            model,
            webSearch,
            numOfSite,
            maxWord,
            files: binaryFiles.map(f => ({ dataUrl: f.dataUrl, type: f.type, filename: f.filename })),
            conversationId: currentConversationId,
            history: history.map(m => ({ role: m.role, content: m.content }))
        };

        abortController = new AbortController();
        const response = await fetch('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestPayload),
            signal: abortController.signal
        });

        removeLoadingMessage();

        if (!response.ok) {
            const data = await response.json().catch(() => ({}));
            addMessage(data.error || 'Request failed', 'assistant');
            return;
        }

        const msgDiv = createStreamingMessage();
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let fullText = '';
        let buffer = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });

            // SSE events are separated by double newlines
            const events = buffer.split('\n\n');
            buffer = events.pop();

            for (const event of events) {
                const match = event.match(/^data:\s*(.+)$/m);
                if (!match) continue;
                const raw = match[1].trim();
                if (raw === '[DONE]') continue;
                try {
                    const parsed = JSON.parse(raw);
                    if (parsed.content !== undefined) {
                        fullText += parsed.content;
                        updateStreamingMessage(msgDiv, fullText);
                    } else if (parsed.aiRecord) {
                        updateUserFromResponse(parsed);
                    } else if (parsed.error) {
                        updateStreamingMessage(msgDiv, `Error: ${parsed.error}`);
                    }
                } catch (_) {}
            }
        }

        if (fullText) addToChatHistory(prompt, fullText, filesToSend);

    } catch (error) {
        removeLoadingMessage();
        if (error.name !== 'AbortError') {
            addMessage(`Error: ${error.message}`, 'assistant');
        }
    } finally {
        abortController = null;
        setStreaming(false);
    }
}

function addMessage(content, role, files = []) {
    const messagesContainer = document.getElementById('chatMessages');
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${role}`;

    let attachmentsHtml = '';
    if (files.length > 0) {
        attachmentsHtml = '<div class="message-images">';
        files.forEach(file => {
            const isImage = typeof file === 'string' || (file.type && file.type.startsWith('image/'));
            const src = typeof file === 'string' ? file : file.dataUrl;
            if (isImage) {
                attachmentsHtml += `<img src="${src}" class="message-image" alt="image">`;
            } else {
                attachmentsHtml += `<div class="message-file-chip">${file.filename}</div>`;
            }
        });
        attachmentsHtml += '</div>';
    }

    const renderedContent = role === 'assistant'
        ? marked.parse(content)
        : content.replace(/\n/g, '<br>');

    messageDiv.innerHTML = `
        <div class="message-content ${role === 'assistant' ? 'markdown' : ''}">
            ${renderedContent}
            ${attachmentsHtml}
        </div>
    `;

    messagesContainer.appendChild(messageDiv);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function createStreamingMessage() {
    const messagesContainer = document.getElementById('chatMessages');
    const messageDiv = document.createElement('div');
    messageDiv.className = 'message assistant';
    messageDiv.innerHTML = '<div class="message-content markdown"></div>';
    messagesContainer.appendChild(messageDiv);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
    return messageDiv;
}

function updateStreamingMessage(msgDiv, text) {
    msgDiv.querySelector('.message-content').innerHTML = marked.parse(text);
    const messagesContainer = document.getElementById('chatMessages');
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function addLoadingMessage() {
    const messagesContainer = document.getElementById('chatMessages');
    const loadingDiv = document.createElement('div');
    loadingDiv.className = 'message assistant';
    loadingDiv.id = 'loadingMessage';
    loadingDiv.innerHTML = `
        <div class="message-content loading">
            <div class="loading-dot"></div>
            <div class="loading-dot"></div>
            <div class="loading-dot"></div>
        </div>
    `;
    messagesContainer.appendChild(loadingDiv);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function removeLoadingMessage() {
    const loading = document.getElementById('loadingMessage');
    if (loading) loading.remove();
}

function addToChatHistory(prompt, response, files = []) {
    if (!currentChatId) currentChatId = 'chat-' + Date.now();

    if (!chatHistory.find(c => c.id === currentChatId)) {
        chatHistory.unshift({
            id: currentChatId,
            conversationId: currentConversationId,
            title: prompt.substring(0, 50) + (prompt.length > 50 ? '...' : ''),
            messages: []
        });
    }

    const chat = chatHistory.find(c => c.id === currentChatId);
    chat.messages.push({ role: 'user', content: prompt, images: files });
    chat.messages.push({ role: 'assistant', content: response, images: [] });

    displayChatHistory();
    saveChatHistoryToLocalStorage();
}

function displayChatHistory() {
    const chatList = document.getElementById('chatList');
    chatList.innerHTML = '';
    chatHistory.forEach(chat => {
        const item = document.createElement('div');
        item.className = `chat-item ${chat.id === currentChatId ? 'active' : ''}`;
        item.innerHTML = `
            <div class="chat-item-text" onclick="loadChat('${chat.id}')">${chat.title}</div>
            <button class="chat-item-delete" onclick="deleteChat('${chat.id}')">×</button>
        `;
        chatList.appendChild(item);
    });
}

function loadChat(chatId) {
    currentChatId = chatId;
    const chat = chatHistory.find(c => c.id === chatId);
    currentConversationId = chat?.conversationId || generateUUID();
    document.getElementById('chatMessages').innerHTML = '';
    if (chat) {
        chat.messages.forEach(msg => addMessage(msg.content, msg.role, msg.images || []));
    }
    displayChatHistory();
}

function deleteChat(chatId) {
    chatHistory = chatHistory.filter(c => c.id !== chatId);
    saveChatHistoryToLocalStorage();
    if (currentChatId === chatId) newChat();
    else displayChatHistory();
}

function newChat() {
    currentChatId = null;
    currentConversationId = generateUUID();
    document.getElementById('chatMessages').innerHTML = '';
    uploadedFiles = [];
    displayFilePreview();
    displayChatHistory();
    document.getElementById('promptInput').focus();
}

function saveChatHistoryToLocalStorage() {
    try {
        localStorage.setItem('chatHistory', JSON.stringify(chatHistory));
    } catch (_) {}
}

function loadChatHistoryFromLocalStorage() {
    try {
        const saved = localStorage.getItem('chatHistory');
        if (saved) {
            chatHistory = JSON.parse(saved);
            displayChatHistory();
        }
    } catch (_) {}
}

function initDragAndDrop() {
    const mainContent = document.getElementById('mainContent');
    const overlay = document.getElementById('dragOverlay');
    let dragCounter = 0;

    mainContent.addEventListener('dragenter', (e) => {
        e.preventDefault();
        dragCounter++;
        overlay.classList.add('active');
    });

    mainContent.addEventListener('dragleave', () => {
        if (--dragCounter === 0) overlay.classList.remove('active');
    });

    mainContent.addEventListener('dragover', (e) => e.preventDefault());

    mainContent.addEventListener('drop', (e) => {
        e.preventDefault();
        dragCounter = 0;
        overlay.classList.remove('active');
        Array.from(e.dataTransfer.files).forEach(file => {
            readFile(file).then(f => {
                uploadedFiles.push(f);
                displayFilePreview();
            });
        });
    });
}

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('promptInput').focus();
    loadSettings();
    loadChatHistoryFromLocalStorage();
    loadUsername();
    initDragAndDrop();
});
