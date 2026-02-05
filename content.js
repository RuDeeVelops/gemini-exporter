// Content script that extracts chat messages instantly from Gemini
// This bypasses the need to scroll and wait for content to load

// Extract all chat messages from the DOM
function extractChatMessages() {
  const messages = [];
  
  // Gemini uses specific selectors for chat messages
  // Look for message containers in the chat
  const messageContainers = document.querySelectorAll('message-content, .model-response-text, .user-query, [data-message-author-role]');
  
  if (messageContainers.length === 0) {
    // Try alternative selectors
    const alternativeContainers = document.querySelectorAll('.conversation-container message, .query-container, .response-container');
    
    if (alternativeContainers.length > 0) {
      alternativeContainers.forEach(container => {
        extractMessageFromContainer(container, messages);
      });
    } else {
      // Fallback: try to find all text content in chat area
      const chatArea = document.querySelector('main, .chat-history, .conversation');
      if (chatArea) {
        // Get all potential message elements
        const allElements = chatArea.querySelectorAll('div[class*="message"], div[class*="query"], div[class*="response"]');
        allElements.forEach(el => {
          extractMessageFromContainer(el, messages);
        });
      }
    }
  } else {
    messageContainers.forEach(container => {
      extractMessageFromContainer(container, messages);
    });
  }
  
  return messages;
}

function extractMessageFromContainer(container, messages) {
  // Determine the role (user or assistant)
  const role = determineRole(container);
  
  // Extract text content
  const textContent = extractText(container);
  
  if (textContent && textContent.trim()) {
    messages.push({
      role: role,
      content: textContent.trim(),
      timestamp: new Date().toISOString()
    });
  }
}

function determineRole(element) {
  const elementText = element.outerHTML.toLowerCase();
  const classList = element.className.toLowerCase();
  const roleAttr = element.getAttribute('data-message-author-role');
  
  if (roleAttr === 'user' || classList.includes('user') || elementText.includes('user-query')) {
    return 'user';
  } else if (roleAttr === 'model' || roleAttr === 'assistant' || classList.includes('model') || classList.includes('response')) {
    return 'assistant';
  }
  
  // Try to determine by parent or sibling elements
  const parent = element.parentElement;
  if (parent) {
    const parentClass = parent.className.toLowerCase();
    if (parentClass.includes('user')) return 'user';
    if (parentClass.includes('model') || parentClass.includes('assistant')) return 'assistant';
  }
  
  return 'assistant'; // Default to assistant
}

function extractText(element) {
  // Clone the element to avoid modifying the original
  const clone = element.cloneNode(true);
  
  // Remove script and style elements
  const scriptsAndStyles = clone.querySelectorAll('script, style');
  scriptsAndStyles.forEach(el => el.remove());
  
  // Get text content
  let text = clone.textContent || clone.innerText || '';
  
  // Clean up whitespace
  text = text.replace(/\s+/g, ' ').trim();
  
  return text;
}

// Get chat title
function getChatTitle() {
  // Try to find the chat title in various possible locations
  const titleSelectors = [
    '.chat-title',
    '[data-test-id="chat-title"]',
    'h1',
    '.conversation-title',
    'header h1',
    'header h2'
  ];
  
  for (const selector of titleSelectors) {
    const titleElement = document.querySelector(selector);
    if (titleElement && titleElement.textContent.trim()) {
      return titleElement.textContent.trim();
    }
  }
  
  return 'Gemini Chat Export';
}

// Listen for messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'extractChat') {
    try {
      const messages = extractChatMessages();
      const title = getChatTitle();
      
      sendResponse({
        success: true,
        data: {
          title: title,
          messages: messages,
          exportDate: new Date().toISOString(),
          messageCount: messages.length
        }
      });
    } catch (error) {
      sendResponse({
        success: false,
        error: error.message
      });
    }
  }
  return true; // Keep the message channel open for async response
});

// Alternative extraction method using MutationObserver for dynamic content
let cachedMessages = [];

function observeChat() {
  const chatContainer = document.querySelector('main, .chat-history, .conversation');
  
  if (chatContainer) {
    const observer = new MutationObserver(() => {
      cachedMessages = extractChatMessages();
    });
    
    observer.observe(chatContainer, {
      childList: true,
      subtree: true
    });
  }
}

// Start observing when page loads
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', observeChat);
} else {
  observeChat();
}
