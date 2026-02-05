// Popup script for handling export actions

let chatData = null;
let progressInterval = null;

// Show status message
function showStatus(message, type = 'info') {
  const statusDiv = document.getElementById('status');
  statusDiv.textContent = message;
  statusDiv.className = type;
  statusDiv.style.display = 'block';
  
  // Hide after 5 seconds for success messages
  if (type === 'success') {
    setTimeout(() => {
      statusDiv.style.display = 'none';
    }, 5000);
  }
}

// Update progress display
function updateProgress(message) {
  const statusDiv = document.getElementById('status');
  statusDiv.textContent = message;
  statusDiv.className = 'info';
  statusDiv.style.display = 'block';
  
  // Also update the message count area with animation
  const countDiv = document.getElementById('messageCount');
  countDiv.textContent = message;
}

// Show/hide loader
function toggleLoader(show) {
  document.getElementById('loader').style.display = show ? 'block' : 'none';
}

// Listen for progress messages from content script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'progress') {
    let message = request.message || `Loading... (${request.iteration || 0} iterations)`;
    
    // Add emoji based on status
    if (request.status === 'loading') {
      message = '🔄 ' + message;
    } else if (request.status === 'expanding') {
      message = '📖 ' + message;
    } else if (request.status === 'extracting') {
      message = '📤 ' + message;
    }
    
    updateProgress(message);
  }
});

// Extract chat data from the active tab
async function extractChatData() {
  toggleLoader(true);
  chatData = null;
  
  showStatus('🔄 FORCE loading entire chat history from the beginning...', 'info');
  document.getElementById('messageCount').textContent = 'Scrolling to load ALL messages...';
  
  // Animated progress indicator
  let dots = 0;
  progressInterval = setInterval(() => {
    dots = (dots + 1) % 4;
    const dotStr = '.'.repeat(dots);
    const currentStatus = document.getElementById('status').textContent;
    if (currentStatus.startsWith('🔄')) {
      // Keep the animation going
    }
  }, 500);
  
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    // Validate that the URL is actually from gemini.google.com domain
    const url = new URL(tab.url);
    if (url.hostname !== 'gemini.google.com') {
      throw new Error('Please navigate to a Gemini chat page first');
    }
    
    showStatus('🔄 Scrolling to top to load oldest messages...', 'info');
    
    const response = await chrome.tabs.sendMessage(tab.id, { action: 'extractChat' });
    
    if (response.success) {
      chatData = response.data;
      document.getElementById('messageCount').textContent = 
        `✅ Found ${chatData.messageCount} messages ready to export!`;
      showStatus(`✅ SUCCESS! Loaded ${chatData.messageCount} messages from entire chat history!`, 'success');
      return chatData;
    } else {
      throw new Error(response.error || 'Failed to extract chat data');
    }
  } catch (error) {
    showStatus(`❌ Error: ${error.message}`, 'error');
    document.getElementById('messageCount').textContent = 'Error loading chat';
    console.error('Extraction error:', error);
    return null;
  } finally {
    clearInterval(progressInterval);
    toggleLoader(false);
  }
}

// Format chat as text
function formatAsText(data) {
  let text = `${data.title}\n`;
  text += `${'='.repeat(data.title.length)}\n\n`;
  text += `Exported: ${new Date(data.exportDate).toLocaleString()}\n`;
  text += `Total Messages: ${data.messageCount}\n\n`;
  text += '─'.repeat(50) + '\n\n';
  
  data.messages.forEach((msg, index) => {
    const role = msg.role === 'user' ? 'You' : 'Gemini';
    text += `[${role}]:\n${msg.content}\n\n`;
    
    if (index < data.messages.length - 1) {
      text += '─'.repeat(50) + '\n\n';
    }
  });
  
  return text;
}

// Format chat as JSON
function formatAsJSON(data) {
  return JSON.stringify(data, null, 2);
}

// Format chat as Markdown
function formatAsMarkdown(data) {
  let md = `# ${data.title}\n\n`;
  md += `**Exported:** ${new Date(data.exportDate).toLocaleString()}  \n`;
  md += `**Total Messages:** ${data.messageCount}\n\n`;
  md += '---\n\n';
  
  data.messages.forEach((msg, index) => {
    const role = msg.role === 'user' ? '👤 You' : '🤖 Gemini';
    md += `## ${role}\n\n`;
    md += `${msg.content}\n\n`;
    
    if (index < data.messages.length - 1) {
      md += '---\n\n';
    }
  });
  
  return md;
}

// Download file
function downloadFile(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// Generate safe filename
function generateFilename(title, extension) {
  const safeTitle = title.replace(/[^a-z0-9]/gi, '_').toLowerCase();
  const timestamp = new Date().toISOString().split('T')[0];
  return `${safeTitle}_${timestamp}.${extension}`;
}

// Export handlers
async function exportAsText() {
  if (!chatData) {
    chatData = await extractChatData();
    if (!chatData) return;
  }
  
  const content = formatAsText(chatData);
  const filename = generateFilename(chatData.title, 'txt');
  downloadFile(content, filename, 'text/plain');
  showStatus('✅ Exported as Text successfully!', 'success');
}

async function exportAsJSON() {
  if (!chatData) {
    chatData = await extractChatData();
    if (!chatData) return;
  }
  
  const content = formatAsJSON(chatData);
  const filename = generateFilename(chatData.title, 'json');
  downloadFile(content, filename, 'application/json');
  showStatus('✅ Exported as JSON successfully!', 'success');
}

async function exportAsMarkdown() {
  if (!chatData) {
    chatData = await extractChatData();
    if (!chatData) return;
  }
  
  const content = formatAsMarkdown(chatData);
  const filename = generateFilename(chatData.title, 'md');
  downloadFile(content, filename, 'text/markdown');
  showStatus('✅ Exported as Markdown successfully!', 'success');
}

// Event listeners
document.getElementById('exportTxt').addEventListener('click', exportAsText);
document.getElementById('exportJson').addEventListener('click', exportAsJSON);
document.getElementById('exportMarkdown').addEventListener('click', exportAsMarkdown);

// Auto-extract chat data when popup opens
window.addEventListener('load', () => {
  extractChatData();
});
