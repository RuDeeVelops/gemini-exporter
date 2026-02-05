# Gemini Chat Exporter 💬

A powerful browser extension that **completely exports** your Gemini chat conversations by automatically loading the entire chat history.

## ✨ Features

- **📜 Complete History Export**: Automatically loads and exports your ENTIRE chat history from the beginning
- **🤫 Silent Loading**: Intelligently loads all messages without manual scrolling
- **📄 Multiple Formats**: Export as Text, JSON, or Markdown
- **🎯 Smart Extraction**: Advanced DOM parsing to capture all messages accurately
- **🎨 Beautiful UI**: Clean, modern interface with gradient design
- **🔒 Privacy First**: All processing happens locally in your browser
- **🚀 Zero Configuration**: Just install and use

## 📦 Installation

### Chrome/Edge/Brave

1. Download or clone this repository
2. Open your browser and navigate to:
   - Chrome: `chrome://extensions/`
   - Edge: `edge://extensions/`
   - Brave: `brave://extensions/`
3. Enable "Developer mode" (toggle in the top right)
4. Click "Load unpacked"
5. Select the `gemini-exporter` folder
6. The extension is now installed! 🎉

### Firefox

1. Download or clone this repository
2. Open Firefox and navigate to `about:debugging#/runtime/this-firefox`
3. Click "Load Temporary Add-on"
4. Select the `manifest.json` file from the `gemini-exporter` folder
5. The extension is now installed! 🎉

## 🚀 Usage

1. Open a chat conversation on [Gemini](https://gemini.google.com/)
2. Click the Gemini Exporter extension icon in your browser toolbar
3. The extension will automatically load your **entire chat history** (this may take a moment for very long conversations)
4. Once loaded, choose your preferred export format:
   - **📄 Text**: Clean, readable plain text format
   - **📋 JSON**: Structured data format for programmatic use
   - **📝 Markdown**: Formatted text with headers and separators
5. Your complete chat history will be downloaded automatically!

## 🔧 How It Works

This extension uses an intelligent multi-phase approach to ensure complete chat export:

1. **Smart Container Detection**: Automatically finds the scrollable chat container
2. **History Loading**: Programmatically scrolls through the chat to load all messages from the very beginning
3. **Content Extraction**: Uses advanced DOM parsing to extract all messages with proper role attribution
4. **Deduplication**: Intelligently removes duplicate messages that may appear during loading
5. **Export**: Formats and downloads your complete chat history



1. **Instantly scan** the entire chat DOM tree
2. **Extract all messages** without triggering any scroll events
3. **Parse content** from existing HTML elements
4. **Format and download** in your chosen format

This approach is:
- ⚡ **Much faster** - No waiting for content to load
- 🎯 **More reliable** - Doesn't depend on scroll events
- 💪 **More efficient** - Uses less CPU and memory

## 📋 Export Formats

### Text Format
```
Chat Title
==========

Exported: [Date and Time]
Total Messages: [Count]

──────────────────────────────────────────────────

[You]:
Your message here...

──────────────────────────────────────────────────

[Gemini]:
Gemini's response here...
```

### JSON Format
```json
{
  "title": "Chat Title",
  "exportDate": "2026-02-05T12:00:00.000Z",
  "messageCount": 10,
  "messages": [
    {
      "role": "user",
      "content": "Your message...",
      "timestamp": "2026-02-05T12:00:00.000Z"
    }
  ]
}
```

### Markdown Format
```markdown
# Chat Title

**Exported:** [Date and Time]
**Total Messages:** [Count]

---

## 👤 You

Your message here...

---

## 🤖 Gemini

Gemini's response here...
```

## 🛠️ Technical Details

- **Manifest Version**: 3
- **Permissions**: `activeTab`, `scripting`
- **Supported Sites**: `https://gemini.google.com/*`
- **Content Script**: Injected at `document_idle`
- **Browser Support**: Chrome, Edge, Brave, Firefox (with minor adjustments)

## 🔍 Architecture

```
┌─────────────────┐
│   Popup UI      │  (popup.html/js)
│   - Export      │
│   - Formats     │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Content Script  │  (content.js)
│   - DOM Parse   │
│   - Extract     │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Gemini Page    │
│   - Chat DOM    │
└─────────────────┘
```

## 🤝 Contributing

Contributions are welcome! Feel free to:
- Report bugs
- Suggest new features
- Submit pull requests
- Improve documentation

## 📄 License

MIT License - feel free to use and modify as needed!

## ⚠️ Disclaimer

This is an unofficial tool and is not affiliated with, endorsed by, or connected to Google or Gemini in any way. Use at your own discretion.

## 🐛 Troubleshooting

### Extension not working?
1. Make sure you're on a Gemini chat page (`gemini.google.com`)
2. Refresh the page after installing the extension
3. Check browser console for any error messages

### No messages extracted?
1. Ensure the chat has fully loaded
2. Try refreshing the page
3. Check if Gemini has updated their DOM structure (report as an issue)

### Export file not downloading?
1. Check your browser's download settings
2. Ensure pop-ups are not blocked
3. Try a different export format

## 🆕 What's New

### Version 1.0.0
- Initial release
- Instant export functionality
- Support for Text, JSON, and Markdown formats
- Beautiful gradient UI
- Direct DOM access for fast extraction

## 💡 Future Enhancements

- [ ] Export with code syntax highlighting
- [ ] Batch export multiple chats
- [ ] Cloud backup integration
- [ ] Custom format templates
- [ ] Search within exported chats
- [ ] Export conversation images

---

Made with ❤️ for the Gemini community