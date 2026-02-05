// Content script that extracts chat messages from Gemini
// This loads the entire chat history before extraction

// Find the scrollable chat container
function findChatContainer() {
  // Try multiple possible selectors for Gemini's chat container
  const selectors = [
    '[role="main"]',
    'main',
    '.conversation-container',
    '.chat-history',
    '[class*="conversation"]',
    '[class*="chat-content"]'
  ];
  
  for (const selector of selectors) {
    const element = document.querySelector(selector);
    if (element && element.scrollHeight > element.clientHeight) {
      return element;
    }
  }
  
  // Fallback: find any scrollable element in the page
  const allElements = document.querySelectorAll('*');
  for (const el of allElements) {
    if (el.scrollHeight > el.clientHeight && el.scrollHeight > 1000) {
      return el;
    }
  }
  
  return document.documentElement;
}

// Load the entire chat history by scrolling
async function loadEntireChatHistory() {
  const container = findChatContainer();
  if (!container) {
    console.warn('Could not find chat container');
    return false;
  }
  
  const originalScrollTop = container.scrollTop;
  const originalScrollBehavior = container.style.scrollBehavior;
  
  // Disable smooth scrolling for faster loading
  container.style.scrollBehavior = 'auto';
  
  // Phase 1: Jump to the very top to load the oldest messages
  container.scrollTop = 0;
  await wait(1000); // Initial wait for first messages to load
  
  let previousHeight = container.scrollHeight;
  let stableCount = 0;
  let heightCheckAttempts = 0;
  const maxHeightChecks = 5;
  
  // Wait for the top messages to fully load
  while (heightCheckAttempts < maxHeightChecks) {
    await wait(400);
    const currentHeight = container.scrollHeight;
    
    if (currentHeight === previousHeight) {
      stableCount++;
      if (stableCount >= 2) break; // Height stable, content loaded
    } else {
      stableCount = 0;
      previousHeight = currentHeight;
    }
    
    heightCheckAttempts++;
  }
  
  // Phase 2: Intelligently scroll through the content
  const totalHeight = container.scrollHeight;
  const viewportHeight = container.clientHeight;
  const numSteps = Math.max(10, Math.min(30, Math.ceil(totalHeight / (viewportHeight * 2))));
  const stepSize = totalHeight / numSteps;
  
  for (let i = 0; i < numSteps; i++) {
    const targetScroll = Math.min(stepSize * (i + 1), totalHeight);
    container.scrollTop = targetScroll;
    
    // Dynamic wait time based on position
    const waitTime = i < 3 ? 400 : 200; // Wait longer for initial messages
    await wait(waitTime);
    
    // Check if we've reached the end
    if (container.scrollTop + container.clientHeight >= container.scrollHeight - 50) {
      break;
    }
  }
  
  // Phase 3: Ensure we're at the absolute bottom
  container.scrollTop = container.scrollHeight;
  await wait(500);
  
  // Restore original scroll behavior
  container.style.scrollBehavior = originalScrollBehavior;
  
  return true;
}

// Count messages currently in the DOM
function countCurrentMessages() {
  const messageSelectors = [
    'message-content',
    '[data-message-author-role]',
    '.model-response-text',
    '.user-query'
  ];
  
  let count = 0;
  for (const selector of messageSelectors) {
    const elements = document.querySelectorAll(selector);
    if (elements.length > count) {
      count = elements.length;
    }
  }
  
  return count;
}

// Helper function to wait
function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Extract all chat messages from the DOM (after history is loaded)
function extractChatMessages() {
  const messages = [];
  const seenContents = new Set(); // To deduplicate
  
  // Strategy 1: Look for specific message container patterns
  const chatContainer = document.querySelector('main, [role="main"], .conversation-container');
  
  if (!chatContainer) {
    console.warn('Could not find chat container');
    return messages;
  }
  
  // Try to find message containers with known patterns
  // Gemini typically uses specific data attributes or classes
  const messageSelectors = [
    '[data-message-author-role]',
    'message-content',
    '.message-content',
    '[class*="message-"]',
    '[class*="query"]',
    '[class*="response"]'
  ];
  
  let foundMessages = [];
  for (const selector of messageSelectors) {
    const elements = chatContainer.querySelectorAll(selector);
    if (elements.length > 0) {
      foundMessages = Array.from(elements);
      break;
    }
  }
  
  // Process found message containers
  if (foundMessages.length > 0) {
    foundMessages.forEach(el => {
      const role = determineRole(el);
      const textContent = extractText(el);
      
      if (textContent && textContent.length > 10) {
        const contentKey = textContent.substring(0, 150);
        if (!seenContents.has(contentKey) && isValidMessage(el, textContent)) {
          seenContents.add(contentKey);
          messages.push({
            role: role,
            content: textContent.trim(),
            timestamp: new Date().toISOString()
          });
        }
      }
    });
  } else {
    // Strategy 2: Find message-like containers based on structure
    // Look for direct children or specific depth elements
    const potentialContainers = chatContainer.querySelectorAll('div[class], div[data-test-id]');
    
    // Filter to likely message containers (not too nested, has substantial content)
    const likelyMessages = Array.from(potentialContainers).filter(el => {
      const depth = getElementDepth(el, chatContainer);
      const textLength = (el.textContent || '').trim().length;
      const hasChildren = el.children.length > 0;
      
      // Message containers are usually at a specific depth and have reasonable content
      return depth >= 2 && depth <= 6 && textLength > 50 && textLength < 50000;
    });
    
    // Sort by position in DOM to maintain order
    likelyMessages.sort((a, b) => {
      return a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
    });
    
    // Process each potential message
    for (const el of likelyMessages) {
      const textContent = extractText(el);
      
      if (textContent && textContent.length > 10) {
        const contentKey = textContent.substring(0, 150);
        
        // Check if this is not a subset of an already seen message
        let isSubset = false;
        for (const seen of seenContents) {
          if (seen.includes(contentKey) || contentKey.includes(seen)) {
            isSubset = true;
            break;
          }
        }
        
        if (!isSubset && isValidMessage(el, textContent)) {
          seenContents.add(contentKey);
          const role = determineRole(el);
          messages.push({
            role: role,
            content: textContent.trim(),
            timestamp: new Date().toISOString()
          });
        }
      }
    }
  }
  
  return deduplicateAndSortMessages(messages);
}

// Get the depth of an element relative to a container
function getElementDepth(element, container) {
  let depth = 0;
  let current = element;
  while (current && current !== container && depth < 20) {
    depth++;
    current = current.parentElement;
  }
  return depth;
}

// Check if a div contains a valid message
function isValidMessage(div, textContent) {
  // Filter out UI elements, buttons, headers, etc.
  const invalidPatterns = [
    /^(share|copy|edit|regenerate|thumb|like|dislike)$/i,
    /^[\s\n]*$/,
    /^loading/i,
    /^\.\.\.$/
  ];
  
  for (const pattern of invalidPatterns) {
    if (pattern.test(textContent.trim())) {
      return false;
    }
  }
  
  // Must have reasonable length
  if (textContent.length < 10) return false;
  
  // Should not be a button or link text
  const tagName = div.tagName.toLowerCase();
  if (tagName === 'button' || tagName === 'a') return false;
  
  return true;
}

// Deduplicate and sort messages
function deduplicateAndSortMessages(messages) {
  // Remove duplicates based on content similarity
  const unique = [];
  const seen = new Set();
  
  for (const msg of messages) {
    const key = `${msg.role}:${msg.content.substring(0, 150)}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(msg);
    }
  }
  
  return unique;
}

function extractMessageFromContainer(container, messages, seenContents) {
  // Determine the role (user or assistant)
  const role = determineRole(container);
  
  // Extract text content
  const textContent = extractText(container);
  
  if (textContent && textContent.trim()) {
    // Deduplicate based on content
    const contentKey = `${role}:${textContent.trim()}`;
    if (!seenContents.has(contentKey)) {
      seenContents.add(contentKey);
      messages.push({
        role: role,
        content: textContent.trim(),
        timestamp: new Date().toISOString()
      });
    }
  }
}

function determineRole(element) {
  // Check data attributes first (most reliable)
  const roleAttr = element.getAttribute('data-message-author-role');
  if (roleAttr === 'user') return 'user';
  if (roleAttr === 'model' || roleAttr === 'assistant') return 'assistant';
  
  // Check for data-test-id or similar attributes
  const testId = element.getAttribute('data-test-id') || '';
  if (testId.includes('user')) return 'user';
  if (testId.includes('model') || testId.includes('assistant')) return 'assistant';
  
  // Check classes
  const classList = element.className.toLowerCase();
  if (classList.includes('user-query') || classList.includes('user-message')) return 'user';
  if (classList.includes('model-response') || classList.includes('assistant-message')) return 'assistant';
  
  // Check parent and grandparent elements
  let parent = element.parentElement;
  for (let i = 0; i < 3 && parent; i++) {
    const parentClass = parent.className.toLowerCase();
    const parentRole = parent.getAttribute('data-message-author-role');
    
    if (parentRole === 'user' || parentClass.includes('user')) return 'user';
    if (parentRole === 'model' || parentRole === 'assistant' || parentClass.includes('model') || parentClass.includes('assistant')) return 'assistant';
    
    parent = parent.parentElement;
  }
  
  // Check siblings for context
  const prevSibling = element.previousElementSibling;
  const nextSibling = element.nextElementSibling;
  
  // Gemini often uses alternating patterns
  if (prevSibling) {
    const prevRole = prevSibling.getAttribute('data-message-author-role');
    if (prevRole === 'user') return 'assistant';
    if (prevRole === 'model' || prevRole === 'assistant') return 'user';
  }
  
  // Check for typical user message indicators (shorter, questions, etc.)
  const textContent = element.textContent || '';
  if (textContent.length < 200 && (textContent.includes('?') || textContent.startsWith('Can you') || textContent.startsWith('Please'))) {
    return 'user';
  }
  
  // Default to assistant for longer responses
  return 'assistant';
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
    // Handle async operation
    (async () => {
      try {
        // First, load the entire chat history by scrolling
        await loadEntireChatHistory();
        
        // Then extract all messages
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
    })();
    
    return true; // Keep the message channel open for async response
  }
  return true;
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
