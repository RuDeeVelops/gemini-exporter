// Content script that extracts chat messages from Gemini
// 
// IMPORTANT: Gemini uses LAZY LOADING. Old messages are NOT in memory.
// We MUST scroll to trigger fetching of older messages from the server.
// The API interception helps capture the FULL (untruncated) response data
// as it comes in during scrolling.

// Global state
let isLoading = false;
let interceptedMessages = new Map(); // Store intercepted full messages by content hash

// ============================================
// API INTERCEPTION - Captures FULL untruncated data as it's fetched
// ============================================

function setupAPIInterceptor() {
  console.log('[Gemini Exporter] Setting up API interceptor to capture full message data...');
  
  const originalFetch = window.fetch;
  
  window.fetch = async function(...args) {
    const response = await originalFetch.apply(this, args);
    
    try {
      const url = args[0]?.url || args[0];
      
      // Check if this is a conversation/chat API call
      if (typeof url === 'string' && 
          (url.includes('batchexecute') || url.includes('conversation') || 
           url.includes('chat') || url.includes('StreamGenerate'))) {
        
        const clone = response.clone();
        const text = await clone.text();
        
        // Parse and store full message content
        parseAndStoreMessages(text);
      }
    } catch (e) {
      // Continue silently
    }
    
    return response;
  };
  
  // Also intercept XHR
  const originalXHRSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function(...args) {
    this.addEventListener('load', function() {
      try {
        const url = this.responseURL || '';
        if (url.includes('batchexecute') || url.includes('conversation') || url.includes('chat')) {
          parseAndStoreMessages(this.responseText);
        }
      } catch (e) {}
    });
    return originalXHRSend.apply(this, args);
  };
}

// Parse API response and store full message content
function parseAndStoreMessages(responseText) {
  try {
    // Remove Google's XSSI prefix
    const clean = responseText.replace(/^\)\]\}'[\s\n]*/, '');
    
    // Find all text content in the response
    // Google's format is deeply nested arrays
    const textMatches = clean.match(/"([^"]{50,})"/g);
    
    if (textMatches) {
      for (const match of textMatches) {
        try {
          const text = JSON.parse(match);
          if (text && text.length > 50) {
            // Store with hash of first 100 chars as key
            const key = text.substring(0, 100);
            interceptedMessages.set(key, text);
          }
        } catch (e) {}
      }
    }
    
    console.log(`[Gemini Exporter] Intercepted messages cache size: ${interceptedMessages.size}`);
  } catch (e) {}
}

// Get full text if we have it cached (from API), otherwise return DOM text
function getFullMessageText(domText) {
  if (!domText) return domText;
  
  const key = domText.substring(0, 100);
  
  // Check if we have a longer version from API
  for (const [storedKey, fullText] of interceptedMessages) {
    if (storedKey.startsWith(key.substring(0, 50)) || key.startsWith(storedKey.substring(0, 50))) {
      if (fullText.length > domText.length) {
        console.log(`[Gemini Exporter] Using full API text (${fullText.length} chars) instead of truncated DOM (${domText.length} chars)`);
        return fullText;
      }
    }
  }
  
  return domText;
}

// Setup interceptor immediately
try {
  setupAPIInterceptor();
} catch (e) {
  console.log('[Gemini Exporter] Could not setup interceptor:', e.message);
}

// ============================================
// SCROLL-BASED LOADING - Required for lazy-loaded history
// ============================================

// Find the ACTUAL scrollable container (the one that holds messages)
function findScrollableContainer() {
  // Strategy 1: Find element with overflow-y scroll/auto that has significant scroll
  const allElements = document.querySelectorAll('*');
  let bestCandidate = null;
  let maxScrollHeight = 0;
  
  for (const el of allElements) {
    const style = window.getComputedStyle(el);
    const overflowY = style.overflowY;
    
    if ((overflowY === 'scroll' || overflowY === 'auto') && 
        el.scrollHeight > el.clientHeight + 100) {
      // This element is scrollable
      // Prefer elements with more content (larger scrollHeight)
      if (el.scrollHeight > maxScrollHeight) {
        maxScrollHeight = el.scrollHeight;
        bestCandidate = el;
      }
    }
  }
  
  if (bestCandidate) {
    console.log('[Gemini Exporter] Found scrollable container:', bestCandidate, 'scrollHeight:', maxScrollHeight);
    return bestCandidate;
  }
  
  // Fallback to document
  console.log('[Gemini Exporter] Using document.documentElement as fallback');
  return document.documentElement;
}

// FORCE scroll to absolute top and load ALL history
async function forceLoadEntireHistory(sendProgress) {
  console.log('[Gemini Exporter] Starting to force load entire chat history...');
  
  const container = findScrollableContainer();
  if (!container) {
    throw new Error('Could not find chat container');
  }
  
  // Disable smooth scrolling for speed
  const originalBehavior = container.style.scrollBehavior;
  container.style.scrollBehavior = 'auto';
  
  // Get initial state
  let previousScrollTop = container.scrollTop;
  let previousScrollHeight = container.scrollHeight;
  let stuckCount = 0;
  let iteration = 0;
  const maxIterations = 500; // Safety limit - 500 scroll attempts
  
  sendProgress({ status: 'loading', message: 'Scrolling to load history...', iteration: 0 });
  
  // SCROLL UP AGGRESSIVELY until we hit the top
  while (iteration < maxIterations) {
    iteration++;
    
    // Jump to TOP
    container.scrollTop = 0;
    
    // Also try scrolling the main containers
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
    
    // Trigger scroll events manually to force lazy loading
    container.dispatchEvent(new Event('scroll', { bubbles: true }));
    
    // Wait for content to potentially load
    await wait(300);
    
    // Check if new content appeared (scrollHeight increased means new content at top)
    const currentScrollHeight = container.scrollHeight;
    const currentScrollTop = container.scrollTop;
    
    console.log(`[Gemini Exporter] Iteration ${iteration}: scrollHeight=${currentScrollHeight}, scrollTop=${currentScrollTop}`);
    
    // Send progress update
    if (iteration % 5 === 0) {
      sendProgress({ 
        status: 'loading', 
        message: `Loading history... (${iteration} iterations, ${Math.round(currentScrollHeight/1024)}KB loaded)`,
        iteration 
      });
    }
    
    // Check if we're stuck (no new content loading)
    if (currentScrollHeight === previousScrollHeight && currentScrollTop === 0) {
      stuckCount++;
      
      // Try harder - trigger multiple scroll events
      if (stuckCount < 3) {
        container.scrollTop = 100; // Scroll down a bit
        await wait(100);
        container.scrollTop = 0; // Then back to top
        container.dispatchEvent(new Event('scroll', { bubbles: true }));
        await wait(500);
      }
      
      // If stuck for 5 consecutive checks, we've likely loaded everything
      if (stuckCount >= 5) {
        console.log('[Gemini Exporter] Reached the top - no more content to load');
        break;
      }
    } else {
      stuckCount = 0;
      previousScrollHeight = currentScrollHeight;
    }
    
    previousScrollTop = currentScrollTop;
  }
  
  sendProgress({ status: 'loading', message: 'Verifying all content loaded...', iteration });
  
  // Final verification - scroll through entire chat to ensure everything is rendered
  const totalHeight = container.scrollHeight;
  const step = Math.max(500, container.clientHeight);
  
  for (let pos = 0; pos <= totalHeight; pos += step) {
    container.scrollTop = pos;
    await wait(100);
  }
  
  // EXPAND ALL TRUNCATED MESSAGES
  sendProgress({ status: 'expanding', message: 'Expanding all truncated messages...', iteration });
  await expandAllTruncatedMessages();
  
  // Go back to top for extraction
  container.scrollTop = 0;
  await wait(200);
  
  // Restore scroll behavior
  container.style.scrollBehavior = originalBehavior;
  
  console.log(`[Gemini Exporter] Finished loading. Final scrollHeight: ${container.scrollHeight}`);
  sendProgress({ status: 'extracting', message: 'Extracting messages...', iteration });
  
  return true;
}

// EXPAND ALL TRUNCATED/COLLAPSED MESSAGES
async function expandAllTruncatedMessages() {
  console.log('[Gemini Exporter] Looking for truncated messages to expand...');
  
  // Common patterns for "show more" / "expand" buttons in Gemini
  const expandSelectors = [
    // Text-based buttons
    'button:not([disabled])',
    '[role="button"]',
    '[class*="expand"]',
    '[class*="show-more"]',
    '[class*="see-more"]',
    '[class*="read-more"]',
    '[class*="truncat"]',
    '[aria-expanded="false"]',
    // Material design expand icons
    '[class*="expand_more"]',
    '[class*="unfold"]',
    // Generic clickable elements that might expand content
    '[data-action*="expand"]',
    '[data-test-id*="expand"]',
    '[data-test-id*="show"]'
  ];
  
  let totalExpanded = 0;
  let passCount = 0;
  const maxPasses = 5; // Multiple passes in case expanding reveals more content
  
  while (passCount < maxPasses) {
    passCount++;
    let expandedThisPass = 0;
    
    for (const selector of expandSelectors) {
      try {
        const elements = document.querySelectorAll(selector);
        
        for (const el of elements) {
          // Check if this looks like an expand button
          const text = (el.textContent || '').toLowerCase();
          const ariaLabel = (el.getAttribute('aria-label') || '').toLowerCase();
          const title = (el.getAttribute('title') || '').toLowerCase();
          const className = (el.className || '').toLowerCase();
          
          const isExpandButton = 
            text.includes('show more') ||
            text.includes('see more') ||
            text.includes('read more') ||
            text.includes('expand') ||
            text.includes('view more') ||
            text.includes('more') && text.length < 20 ||
            text.includes('...') && text.length < 10 ||
            ariaLabel.includes('expand') ||
            ariaLabel.includes('show more') ||
            title.includes('expand') ||
            title.includes('show') ||
            className.includes('expand') ||
            className.includes('truncat') ||
            className.includes('collapsed') ||
            el.getAttribute('aria-expanded') === 'false';
          
          if (isExpandButton && el.offsetParent !== null) { // Check if visible
            try {
              console.log(`[Gemini Exporter] Clicking expand button: "${text.substring(0, 30)}"`);
              el.click();
              expandedThisPass++;
              totalExpanded++;
              await wait(150); // Wait for expansion animation
            } catch (e) {
              // Click failed, continue
            }
          }
        }
      } catch (e) {
        // Selector failed, continue
      }
    }
    
    // Also try to find and click any elements with "..." that might be truncation indicators
    const allElements = document.querySelectorAll('span, div, p');
    for (const el of allElements) {
      const text = el.textContent || '';
      // Look for truncation patterns
      if (text.endsWith('...') || text.endsWith('… ') || text.includes('Show more')) {
        // Check if there's a clickable parent or sibling
        const clickableParent = el.closest('button, [role="button"], [onclick], [class*="click"]');
        if (clickableParent && clickableParent.offsetParent !== null) {
          try {
            clickableParent.click();
            expandedThisPass++;
            totalExpanded++;
            await wait(150);
          } catch (e) {
            // Continue
          }
        }
      }
    }
    
    console.log(`[Gemini Exporter] Pass ${passCount}: expanded ${expandedThisPass} elements`);
    
    // If nothing was expanded this pass, we're done
    if (expandedThisPass === 0) {
      break;
    }
    
    // Wait for DOM to update
    await wait(300);
  }
  
  console.log(`[Gemini Exporter] Total expanded: ${totalExpanded} truncated messages`);
  return totalExpanded;
}

// Wait helper
function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Extract all chat messages from the DOM (after history is loaded)
function extractChatMessages() {
  console.log('[Gemini Exporter] Starting message extraction...');
  
  const messages = [];
  const seenContents = new Set();
  
  // STRATEGY 1: Look for turns/conversation containers
  // These are the main message wrappers in Gemini
  const turnSelectors = [
    '[data-message-author-role]',
    '.conversation-turn',
    '[class*="turn-"]',
    '[class*="message-wrapper"]',
    'model-response',
    'user-query'
  ];
  
  for (const selector of turnSelectors) {
    const elements = document.querySelectorAll(selector);
    console.log(`[Gemini Exporter] Trying selector "${selector}": found ${elements.length} elements`);
    
    if (elements.length > 0) {
      elements.forEach((el, idx) => {
        const role = determineRole(el);
        const text = extractText(el);
        
        if (text && text.length > 5) {
          const key = text.substring(0, 200);
          if (!seenContents.has(key)) {
            seenContents.add(key);
            messages.push({
              role: role,
              content: text.trim(),
              index: idx,
              timestamp: new Date().toISOString()
            });
          }
        }
      });
      
      if (messages.length > 0) {
        console.log(`[Gemini Exporter] Strategy 1 found ${messages.length} messages with selector "${selector}"`);
        return messages;
      }
    }
  }
  
  // STRATEGY 2: Look for any element with text that looks like a conversation
  console.log('[Gemini Exporter] Strategy 1 failed, trying Strategy 2...');
  
  // Find the main content area
  const mainAreas = document.querySelectorAll('main, [role="main"], [class*="chat"], [class*="conversation"]');
  
  for (const main of mainAreas) {
    // Get all text-bearing elements at a reasonable depth
    const textElements = main.querySelectorAll('p, div, span, pre, code');
    
    const textContents = [];
    textElements.forEach(el => {
      const text = el.textContent?.trim() || '';
      // Only consider substantial text blocks
      if (text.length > 20 && text.length < 100000) {
        // Check this isn't a container of other text elements
        const childText = Array.from(el.children)
          .map(c => c.textContent?.trim() || '')
          .join('');
        
        // If element's text is mostly from children, skip (it's a container)
        if (childText.length < text.length * 0.8) {
          textContents.push({
            element: el,
            text: text,
            depth: getElementDepth(el, main)
          });
        }
      }
    });
    
    // Group by content to find unique messages
    const uniqueTexts = new Map();
    textContents.forEach(item => {
      const key = item.text.substring(0, 200);
      if (!uniqueTexts.has(key)) {
        uniqueTexts.set(key, item);
      }
    });
    
    uniqueTexts.forEach((item, key) => {
      if (!seenContents.has(key) && isValidMessage(item.element, item.text)) {
        seenContents.add(key);
        messages.push({
          role: determineRole(item.element),
          content: item.text,
          timestamp: new Date().toISOString()
        });
      }
    });
    
    if (messages.length > 0) {
      console.log(`[Gemini Exporter] Strategy 2 found ${messages.length} messages`);
      break;
    }
  }
  
  // STRATEGY 3: Last resort - grab everything that looks like text
  if (messages.length === 0) {
    console.log('[Gemini Exporter] Strategy 2 failed, trying Strategy 3...');
    
    const bodyText = document.body.innerText;
    const lines = bodyText.split('\n').filter(l => l.trim().length > 20);
    
    lines.forEach((line, idx) => {
      const trimmed = line.trim();
      if (trimmed.length > 20 && !seenContents.has(trimmed.substring(0, 200))) {
        seenContents.add(trimmed.substring(0, 200));
        messages.push({
          role: idx % 2 === 0 ? 'user' : 'assistant',
          content: trimmed,
          timestamp: new Date().toISOString()
        });
      }
    });
  }
  
  console.log(`[Gemini Exporter] Total messages extracted: ${messages.length}`);
  return messages;
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
    // Handle async operation with progress updates
    (async () => {
      try {
        // Progress callback - sends updates to popup
        const sendProgress = (progress) => {
          try {
            chrome.runtime.sendMessage({ action: 'progress', ...progress });
          } catch (e) {
            // Popup might be closed, ignore
          }
        };
        
        // ============================================================
        // IMPORTANT: Gemini uses LAZY LOADING
        // Old messages are NOT in memory - we MUST scroll to fetch them
        // The API interceptor captures FULL untruncated data as it loads
        // ============================================================
        
        console.log('[Gemini Exporter] Starting full history export...');
        console.log('[Gemini Exporter] Note: Scrolling is REQUIRED to fetch lazy-loaded messages');
        
        // STEP 1: Scroll to load ALL history from server
        sendProgress({ status: 'loading', message: '📜 Scrolling to load full history (required for lazy-loaded content)...' });
        await forceLoadEntireHistory(sendProgress);
        
        // STEP 2: Expand any truncated messages in DOM
        sendProgress({ status: 'expanding', message: '📖 Expanding truncated messages...' });
        await expandAllTruncatedMessages();
        
        // STEP 3: Extract from DOM
        sendProgress({ status: 'extracting', message: '📤 Extracting messages...' });
        let messages = extractChatMessages();
        
        // STEP 4: Enhance with full text from API interception (if available)
        // The API interceptor may have captured full untruncated versions
        messages = messages.map(msg => {
          const fullText = getFullMessageText(msg.content);
          return { ...msg, content: fullText };
        });
        
        // Deduplicate
        messages = deduplicateMessages(messages);
        const title = getChatTitle();
        
        console.log(`[Gemini Exporter] ✅ Extracted ${messages.length} messages`);
        console.log(`[Gemini Exporter] API cache had ${interceptedMessages.size} full-text entries`);
        
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
        console.error('[Gemini Exporter] Error:', error);
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

// Deduplicate messages based on content
function deduplicateMessages(messages) {
  const seen = new Set();
  const unique = [];
  
  for (const msg of messages) {
    const content = (msg.content || '').trim();
    if (content.length < 5) continue;
    
    // Use first 200 chars as key to handle minor differences
    const key = content.substring(0, 200);
    if (!seen.has(key)) {
      seen.add(key);
      unique.push({
        role: msg.role || 'assistant',
        content: content,
        timestamp: msg.timestamp || new Date().toISOString()
      });
    }
  }
  
  return unique;
}

// Log when content script loads
console.log('[Gemini Exporter] Content script loaded on:', window.location.href);
console.log('[Gemini Exporter] Fetch/XHR interceptors active. API responses will be captured.');
