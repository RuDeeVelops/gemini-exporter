// Content script that extracts chat messages from Gemini
// Uses multiple strategies: Internal state > API interception > DOM parsing

// Global state for progress tracking
let isLoading = false;
let loadingProgress = { loaded: 0, status: 'idle' };
let interceptedData = [];

// ============================================
// STRATEGY 1: Extract from page's internal data
// ============================================

function extractFromInternalState() {
  console.log('[Gemini Exporter] Trying to extract from internal state...');
  
  // Look for data in common Google app patterns
  const dataLocations = [
    // Check for embedded JSON in script tags
    () => findEmbeddedJSON(),
    // Check window objects for conversation data
    () => findWindowData(),
    // Check for React fiber data
    () => findReactData(),
    // Check for Angular data
    () => findAngularData(),
  ];
  
  for (const finder of dataLocations) {
    try {
      const data = finder();
      if (data && data.length > 0) {
        console.log(`[Gemini Exporter] Found ${data.length} messages in internal state`);
        return data;
      }
    } catch (e) {
      console.log('[Gemini Exporter] Strategy failed:', e.message);
    }
  }
  
  return null;
}

// Find JSON data embedded in script tags (common in Google apps)
function findEmbeddedJSON() {
  const scripts = document.querySelectorAll('script:not([src])');
  const messages = [];
  
  for (const script of scripts) {
    const content = script.textContent || '';
    
    // Look for conversation-like data structures
    // Google often uses AF_initDataCallback or similar
    const patterns = [
      /AF_initDataCallback\(([\s\S]*?)\);/g,
      /window\['[\w]+'\]\s*=\s*(\{[\s\S]*?\});/g,
      /\["[\w]+",\s*(\[[\s\S]*?\])\]/g,
    ];
    
    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(content)) !== null) {
        try {
          const parsed = JSON.parse(match[1]);
          const extracted = extractMessagesFromObject(parsed);
          if (extracted.length > 0) {
            messages.push(...extracted);
          }
        } catch (e) {
          // Not valid JSON, continue
        }
      }
    }
    
    // Also try to find large JSON blobs that might contain conversations
    const jsonMatches = content.match(/\{[^{}]*"(?:content|text|message|query|response)"[^{}]*\}/g);
    if (jsonMatches) {
      for (const jsonStr of jsonMatches) {
        try {
          const obj = JSON.parse(jsonStr);
          if (obj.content || obj.text || obj.message) {
            messages.push({
              role: obj.role || (obj.isUser ? 'user' : 'assistant'),
              content: obj.content || obj.text || obj.message,
              raw: obj
            });
          }
        } catch (e) {
          // Continue
        }
      }
    }
  }
  
  return messages.length > 0 ? messages : null;
}

// Recursively extract messages from any object structure
function extractMessagesFromObject(obj, depth = 0) {
  const messages = [];
  if (depth > 10) return messages; // Prevent infinite recursion
  
  if (!obj || typeof obj !== 'object') return messages;
  
  // Check if this object looks like a message
  if (obj.content || obj.text || obj.message || obj.parts) {
    const content = obj.content || obj.text || obj.message || 
                   (Array.isArray(obj.parts) ? obj.parts.map(p => p.text || p).join('') : null);
    
    if (content && typeof content === 'string' && content.length > 5) {
      messages.push({
        role: obj.role || obj.author || (obj.isUser ? 'user' : 'assistant'),
        content: content,
        raw: obj
      });
    }
  }
  
  // Recurse into arrays and objects
  if (Array.isArray(obj)) {
    for (const item of obj) {
      messages.push(...extractMessagesFromObject(item, depth + 1));
    }
  } else {
    for (const key of Object.keys(obj)) {
      messages.push(...extractMessagesFromObject(obj[key], depth + 1));
    }
  }
  
  return messages;
}

// Check window object for conversation data
function findWindowData() {
  const messages = [];
  
  // Common data storage patterns in Google apps
  const windowKeys = Object.keys(window).filter(key => {
    const lower = key.toLowerCase();
    return lower.includes('data') || lower.includes('state') || 
           lower.includes('store') || lower.includes('conversation') ||
           lower.includes('chat') || lower.includes('message');
  });
  
  for (const key of windowKeys) {
    try {
      const data = window[key];
      const extracted = extractMessagesFromObject(data);
      if (extracted.length > 0) {
        messages.push(...extracted);
      }
    } catch (e) {
      // Property access failed
    }
  }
  
  // Also check for __NEXT_DATA__, __NUXT__, etc.
  const knownStores = ['__NEXT_DATA__', '__NUXT__', '__initialState__', '__PRELOADED_STATE__'];
  for (const store of knownStores) {
    try {
      if (window[store]) {
        const extracted = extractMessagesFromObject(window[store]);
        messages.push(...extracted);
      }
    } catch (e) {
      // Continue
    }
  }
  
  return messages.length > 0 ? messages : null;
}

// Try to extract from React internal state
function findReactData() {
  const messages = [];
  
  // Find React root
  const root = document.getElementById('root') || document.getElementById('__next') || 
               document.querySelector('[data-reactroot]') || document.body;
  
  // Look for React fiber
  const fiberKey = Object.keys(root).find(key => key.startsWith('__reactFiber') || key.startsWith('__reactInternalInstance'));
  
  if (fiberKey) {
    try {
      let fiber = root[fiberKey];
      const visited = new Set();
      
      // Traverse fiber tree looking for conversation state
      const queue = [fiber];
      while (queue.length > 0 && visited.size < 1000) {
        const current = queue.shift();
        if (!current || visited.has(current)) continue;
        visited.add(current);
        
        // Check memoizedState and memoizedProps for conversation data
        if (current.memoizedState) {
          const extracted = extractMessagesFromObject(current.memoizedState);
          messages.push(...extracted);
        }
        if (current.memoizedProps) {
          const extracted = extractMessagesFromObject(current.memoizedProps);
          messages.push(...extracted);
        }
        
        // Continue traversing
        if (current.child) queue.push(current.child);
        if (current.sibling) queue.push(current.sibling);
        if (current.return) queue.push(current.return);
      }
    } catch (e) {
      console.log('[Gemini Exporter] React traversal error:', e.message);
    }
  }
  
  return messages.length > 0 ? messages : null;
}

// Try to extract from Angular state
function findAngularData() {
  const messages = [];
  
  // Angular often stores data in ng-* attributes or global angular object
  const ngElements = document.querySelectorAll('[ng-model], [ng-bind], [_ngcontent]');
  
  for (const el of ngElements) {
    try {
      // Try to get Angular scope
      const scope = window.angular?.element(el)?.scope?.();
      if (scope) {
        const extracted = extractMessagesFromObject(scope);
        messages.push(...extracted);
      }
    } catch (e) {
      // Continue
    }
  }
  
  return messages.length > 0 ? messages : null;
}

// ============================================
// STRATEGY 2: Intercept API calls
// ============================================

function setupFetchInterceptor() {
  console.log('[Gemini Exporter] Setting up fetch interceptor...');
  
  // Store original fetch
  const originalFetch = window.fetch;
  
  window.fetch = async function(...args) {
    const response = await originalFetch.apply(this, args);
    
    // Clone response so we can read it
    const clone = response.clone();
    
    try {
      const url = args[0]?.url || args[0];
      
      // Check if this might be a conversation API call
      if (typeof url === 'string' && 
          (url.includes('conversation') || url.includes('chat') || 
           url.includes('batchexecute') || url.includes('generate'))) {
        
        const text = await clone.text();
        
        // Try to parse and extract messages
        try {
          // Google APIs often return data in a weird format
          // Try multiple parsing strategies
          let data;
          
          // Remove XSSI prevention prefix if present
          const cleanText = text.replace(/^\)\]\}'/, '');
          
          try {
            data = JSON.parse(cleanText);
          } catch {
            // Try to find JSON in the response
            const jsonMatch = cleanText.match(/\[[\s\S]*\]/);
            if (jsonMatch) {
              data = JSON.parse(jsonMatch[0]);
            }
          }
          
          if (data) {
            const extracted = extractMessagesFromObject(data);
            if (extracted.length > 0) {
              console.log(`[Gemini Exporter] Intercepted ${extracted.length} messages from API`);
              interceptedData.push(...extracted);
            }
          }
        } catch (e) {
          // Parse failed, continue
        }
      }
    } catch (e) {
      // Clone/read failed, continue
    }
    
    return response;
  };
  
  // Also intercept XHR
  const originalXHROpen = XMLHttpRequest.prototype.open;
  const originalXHRSend = XMLHttpRequest.prototype.send;
  
  XMLHttpRequest.prototype.open = function(method, url, ...rest) {
    this._url = url;
    return originalXHROpen.apply(this, [method, url, ...rest]);
  };
  
  XMLHttpRequest.prototype.send = function(...args) {
    this.addEventListener('load', function() {
      try {
        if (this._url && 
            (this._url.includes('conversation') || this._url.includes('chat') ||
             this._url.includes('batchexecute') || this._url.includes('generate'))) {
          
          const text = this.responseText;
          const cleanText = text.replace(/^\)\]\}'/, '');
          
          try {
            const data = JSON.parse(cleanText);
            const extracted = extractMessagesFromObject(data);
            if (extracted.length > 0) {
              console.log(`[Gemini Exporter] Intercepted ${extracted.length} messages from XHR`);
              interceptedData.push(...extracted);
            }
          } catch (e) {
            // Continue
          }
        }
      } catch (e) {
        // Continue
      }
    });
    
    return originalXHRSend.apply(this, args);
  };
}

// Setup interceptor on load
try {
  setupFetchInterceptor();
} catch (e) {
  console.log('[Gemini Exporter] Could not setup interceptor:', e.message);
}

// ============================================
// STRATEGY 3: Fallback to DOM + scroll (original method)
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
        
        let messages = [];
        
        // ======== STRATEGY 1: Try internal state extraction first (FAST) ========
        sendProgress({ status: 'loading', message: '🔍 Analyzing page data structures...' });
        console.log('[Gemini Exporter] === TRYING STRATEGY 1: Internal State ===');
        
        const internalMessages = extractFromInternalState();
        if (internalMessages && internalMessages.length > 5) {
          console.log(`[Gemini Exporter] SUCCESS! Found ${internalMessages.length} messages in internal state`);
          messages = internalMessages;
        }
        
        // ======== STRATEGY 2: Check intercepted API data ========
        if (messages.length === 0 && interceptedData.length > 0) {
          console.log('[Gemini Exporter] === TRYING STRATEGY 2: Intercepted Data ===');
          sendProgress({ status: 'loading', message: '📡 Using intercepted API data...' });
          messages = deduplicateMessages(interceptedData);
          console.log(`[Gemini Exporter] Found ${messages.length} messages from intercepted data`);
        }
        
        // ======== STRATEGY 3: Fallback to DOM scraping with scroll (SLOW but reliable) ========
        if (messages.length === 0) {
          console.log('[Gemini Exporter] === TRYING STRATEGY 3: DOM Scraping ===');
          sendProgress({ status: 'loading', message: '📜 Falling back to DOM extraction...' });
          
          // Force load entire history by scrolling
          await forceLoadEntireHistory(sendProgress);
          
          // Expand truncated messages
          sendProgress({ status: 'expanding', message: '📖 Expanding all truncated messages...' });
          await expandAllTruncatedMessages();
          
          // Extract from DOM
          messages = extractChatMessages();
        }
        
        // Deduplicate and clean messages
        messages = deduplicateMessages(messages);
        const title = getChatTitle();
        
        console.log(`[Gemini Exporter] ✅ Final result: ${messages.length} messages extracted`);
        
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
