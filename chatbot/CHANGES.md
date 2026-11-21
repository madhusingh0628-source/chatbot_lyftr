# Changes: bug fixes and UI/UX overhaul

Backend tests: **68 passing** (63 existing + 5 new). The frontend was checked end to end in a browser against
the real backend with a mocked LLM (no API keys used): chat, cache hits, failover simulation, the 503 error
and Retry, Stop, reopening chats from history, delete, file drag and drop, dark mode and the phone layout.

---

## Part 1: Bugs fixed

### Backend
| # | Bug | Fix |
|---|---|---|
| 1 | `python-dotenv` was imported by `config.py` but missing from `requirements.txt`, so on a fresh install `.env` was **silently ignored** | Added to requirements |
| 2 | SQLite connections were never closed (`with sqlite3.connect()` only commits), which leaked handles and kept the DB file locked on Windows | `_connect` now always closes; WAL mode enabled |
| 3 | Importing `app.main` created `./app.db` as a side effect, which is why stray `app.db` files sit in the repo root and `backend/` | App is created lazily; `uvicorn app.main:app` still works |
| 4 | Two requests for the same session (double click, two tabs) could both read the same stale history and interleave | Per-session lock |
| 5 | The **entire** history was sent on every request, so long chats eventually overflowed the model's context | `MAX_HISTORY_MESSAGES` window (default 100), always starting on a user turn; full history still stored |
| 6 | A provider response without `usage` crashed with `AttributeError`, giving a 500 | Token counts default to 0 |
| 7 | `system_prompt` had no length limit | Max 4000 characters (422 if exceeded) |
| 8 | Any `data:image/...` was accepted (SVG, etc.) and then rejected by the provider | Only PNG/JPEG/GIF/WebP, and the base64 is validated |
| 9 | An operator-precedence trap in the `blank_prompt_is_none` one-liner | Rewritten explicitly |
| 10 | The LLM timeout was hard-coded to 30 s | `LLM_TIMEOUT` env var |
| 11 | `ENABLE_FAILURE_SIMULATION` only accepted exactly `true` | Also accepts `1` and `yes` |
| 12 | There was no way to delete a conversation | New `DELETE /sessions/{id}` |
| 13 | The history endpoint didn't return the saved system prompt, so reopening a chat lost its persona in the UI | Returns `system_prompt` and per-message `created_at` |
| 14 | One corrupt metadata row would 500 the whole history | Skipped gracefully |
| 15 | With no keys configured, the 503 just said "all providers unavailable" | The message now says no keys are configured; logs say so too |
| 16 | A CORS preflight was sent before every chat message | `max_age=600` |
| 17 | `/health` didn't tell the UI whether failure simulation was enabled | Adds `failure_simulation` and `database_ok` |
| 18 | nginx: no gzip, `index.html` could be cached (stale deploys), no security headers | All three fixed |

### Frontend
| # | Bug | Fix |
|---|---|---|
| 19 | Clicking a suggestion **didn't save the chat to history** | All sends go through one path |
| 20 | "Ask again" re-sent whatever images were *currently pending in the composer* | Resends the original payload |
| 21 | "Ask again" on a message with attached files dropped the file contents; on an image-only message it errored "Please type a message first" | Resends the original payload |
| 22 | Chats were saved to history **before** the reply succeeded, so failed chats appeared in history and 404'd when opened | Saved only after success; 404 chats are cleaned up |
| 23 | A chat's title became `--- file: x.py ---` when a file was attached | Title comes from the typed text or the file name |
| 24 | **Enter bypassed the length check** (the button was disabled, Enter still sent, backend returned 422) | Blocked, with a message |
| 25 | Enter during IME composition (Chinese/Japanese/Korean input) sent the message | Ignored while composing |
| 26 | **Multi-line user messages lost their line breaks** | `white-space: pre-wrap` |
| 27 | Ordered lists separated by blank lines (very common in LLM output) rendered as "1. 1. 1." | Markdown renderer rewritten |
| 28 | Code blocks lost the first line's indentation (`.trim()`) | Only trailing whitespace is trimmed |
| 29 | Inline code had the wrong background in *system* dark mode | Uses a theme token |
| 30 | A backend with no keys was shown as "offline" | Shown as "Degraded", with the reason |
| 31 | Auto-read used a random id, so that reply's Stop button never appeared | Uses the message id |
| 32 | New chat didn't reset the speaking state, so the button stayed stuck on ■ | `speaker.stop()` |
| 33 | Dropping several images at once silently ignored the 3-image limit (stale closure) | Counted correctly, with a message for skipped files |
| 34 | **Transparent PNGs turned black** when converted to JPEG | White background painted first |
| 35 | An unguarded `localStorage` read could white-screen the app in strict privacy modes | Safe storage wrapper |
| 36 | Session ids weren't URL-encoded in requests | `encodeURIComponent` |
| 37 | Opening a chat showed the "typing" indicator | Skeleton loader instead |
| 38 | Errors when opening a chat used a blocking `alert()` | Toasts |
| 39 | Auto-scroll yanked you to the bottom while you were reading older messages | Follows only when you're already at the bottom |
| 40 | The drop overlay flickered or got stuck over child elements, and appeared when dragging plain text | Drag counter; file drags only |
| 41 | The textarea didn't resize after dictation filled it | Resizes on every value change |
| 42 | The counter used UTF-16 length, but the backend counts code points (emoji were over-counted) | Counts code points |
| 43 | Copy buttons said "Copied" even when the clipboard was blocked (plain-http origins) | Real result, with a fallback method |
| 44 | Requests had no timeout and couldn't be cancelled | Stop button, Esc and timeouts |
| 45 | A reply could land in the wrong chat if you switched chats mid-request | Guarded |
| 46 | The failover controls were shown even when the server ignores the header | Hidden, with an explanation |
| 47 | Pasted non-image files were ignored | Any supported file can be pasted |
| 48 | Microphone errors (permission blocked) failed silently | Friendly messages |
| 49 | Read-aloud spoke Markdown symbols and whole code blocks | Speaks clean text |
| 50 | "Please type a message first" errors piled up in the chat log | Composer shake; the send button is disabled when empty |
| 51 | Retry left the old error bubble in place | Removed on retry |
| 52 | Light-theme flash on load in dark mode | Theme applied before first paint |
| 53 | The failover path could show wrong or negative key numbers (`\|\| 2` fallback) | Fixed |

---

## Part 2: UI/UX improvements (120)

### Layout and navigation
1. Persistent **sidebar** with chat history (replaces the modal drawer)
2. Collapsible sidebar, remembered between visits (`Ctrl/⌘+B`)
3. Off-canvas drawer with a backdrop on tablets and phones
4. Chats grouped: Pinned / Today / Yesterday / Previous 7 days / Previous 30 days / Older
5. **Search** chats (`Ctrl/⌘+K`)
6. Relative times ("5 min ago")
7. **Pin** chats to the top
8. **Rename** chats (pencil or double-click; Enter saves, Esc cancels)
9. **Delete** chats (server and list) with an inline two-step confirm that expires on its own
10. Active chat highlighted (`aria-current`)
11. "Loading…" state on the chat being opened
12. Skeleton placeholder while a chat loads
13. History limit raised from 25 to 50; pinned chats are never evicted
14. Chats that no longer exist are removed automatically, with an explanation
15. Top bar shows the current chat's title
16. Browser tab title follows the chat
17. Session stats card in the sidebar: replies, cache hits with hit rate %, tokens, average live and cache latency
18. Session id is click-to-copy; the backend URL moved out of the header
19. New-chat button in the sidebar, plus in the top bar when the sidebar is hidden

### Empty state
20. Hero with logo and greeting
21. Suggestion **cards** with icons and titles (2 columns, 1 on phones)
22. A fourth suggestion (brainstorm)
23. Capability hints (voice, files, images, read aloud)
24. Warning in the empty state when the backend is down

### Messages
25. Assistant avatar; replies render full-width, without a box, for readability
26. Redesigned user bubbles (gradient, tail corner, shadow)
27. Timestamps on every message (hover for the full date)
28. Action row per message on hover/focus (always visible on touch screens)
29. Copy a user message
30. **Edit**: load a sent message (with its attachments) back into the composer
31. "Ask again" (regenerate) on the latest reply
32. Read-aloud toggle with an active state
33. Click a sent image to open it full-size in a **lightbox**
34. Attached files shown as expandable chips (name, size, content preview)
35. Chats loaded from history show file chips instead of raw `--- file ---` text
36. "N images (not stored)" placeholder for images in history
37. Typing indicator with a "Thinking" label and elapsed seconds
38. "Still working…" hint after 15 s that explains how to cancel
39. "Simulating failover" label during a simulation
40. Error messages with an icon plus **Retry** and **Dismiss**
41. "Stopped" notice row
42. Entrance animations; the cache glow plays only for new replies, not when history loads

### Response metadata
43. Metadata shown as tidy chips
44. LIVE / CACHE badges with icons and explanatory tooltips
45. Mini latency bar colored by speed (fast / ok / slow)
46. Tokens shown as `in → out`
47. Correct plural for "fallback(s)"
48. Labelled failover path with the failed keys struck through
49. Setting to hide response details

### Markdown rendering
50. Links (http/https/mailto only; open in a new tab with `noopener`)
51. Bare URLs become links
52. **Tables** with column alignment, zebra rows and horizontal scroll
53. Blockquotes
54. Horizontal rules
55. Strikethrough
56. Nested lists
57. Ordered lists keep their start numbers
58. Headings h1–h6 with a correct page hierarchy
59. Bold/italic nesting, underscore emphasis, fewer false italics (`2 * 3 * 4`)
60. Multi-line paragraphs keep their line breaks
61. Unclosed code fences still render as code; `~~~` fences supported
62. Code block header shows the language and line count
63. **Wrap** toggle for long code lines
64. Copy code with success/failure feedback and a fallback method
65. Code blocks are keyboard-scrollable

### Composer
66. Card-style composer with a toolbar
67. Grows with content up to 220 px, then scrolls
68. Icon send button, disabled while empty
69. **Stop** button while a reply is coming (Esc also works)
70. Character counter appears only near the limit, with an inline over-limit explanation
71. Shake plus a toast instead of an error in the chat log
72. Hint row with styled `<kbd>` keys
73. Option: Enter sends, or `Ctrl/⌘+Enter` sends
74. ↑ in an empty box recalls your last message
75. Attachment chips with thumbnail, name, type and size; image preview; remove button
76. Duplicate text-file detection
77. Many more text/code types (toml, ini, kt, cs, rb, php, swift, ps1, …)
78. Binary files rejected with a clear message
79. Clear errors for unsupported files (toasts, not chat errors)
80. Paste any supported file, not just images
81. Drop overlay card with clear instructions
82. "Instructions" chip shows the active persona and opens settings
83. Offline banner above the composer
84. Failover-simulation banner with a **Cancel** button
85. Focus returns to the composer after a reply, a new chat or closing settings (skipped on touch so the keyboard doesn't pop up)
86. Mic button pressed state and pulse

### Settings
87. Settings in an accessible **modal** (Esc, focus trap, focus restore, backdrop click)
88. Shown as a bottom sheet on phones
89. Presets as toggle chips with an active state; new "Teacher" preset
90. System prompt character counter and Clear button
91. Segmented failure-mode control with a per-mode explanation
92. Explains when simulation is disabled on the server
93. Theme picker (System / Light / Dark) with icons
94. Toggles shown as switches with descriptions
95. Preferences persisted (auto-read, details, Enter-to-send, sidebar)
96. Keyboard shortcut reference
97. "Delete all chats" with a click-twice confirm

### Global
98. Keyboard shortcuts: `Ctrl/⌘+Shift+O` new chat, `Ctrl/⌘+K` search, `Ctrl/⌘+B` sidebar, `/` focus composer, `Esc` stop/close
99. Toast notifications (success/error/info): deduplicated, auto-dismissed, dismissable
100. **Export** a conversation as Markdown
101. Health pill: Online / Degraded / Offline / Connecting, with a tooltip (key count, cache)
102. Health polling pauses in hidden tabs and re-checks on focus, on network changes and after a failed request
103. Floating "jump to latest" button
104. Smart auto-scroll
105. New design-token system; consistent SVG icons instead of OS-dependent emoji
106. Proper dark palette, `theme-color` meta and `color-scheme` for native controls
107. No theme flash on load
108. Favicon and meta description
109. Theme-aware thin scrollbars
110. Visible `:focus-visible` rings everywhere
111. "Skip to message box" link
112. `role="log"` + `aria-live` on the chat; labels on every icon button; screen-reader label on the textarea
113. Larger touch targets on touch screens
114. `100dvh` and safe-area insets for mobile browsers
115. Respects `prefers-reduced-motion`; supports `forced-colors` (Windows high contrast)
116. Long words and URLs wrap instead of overflowing
117. Lightbox for attached images (composer and sent messages)
118. Collapsed sidebar is removed from the tab order and screen readers (`inert`)
119. Tabular numbers in stats and metadata
120. React `StrictMode` enabled

---

## Not changed (worth knowing)
- `frontend/dist/` is an old build output. Docker rebuilds it, but if you serve it directly run `npm run build` again.
- `app.db` files in the repo root and `backend/` were created by the old import-time bug. They may contain your chats, so I left them alone. Delete them if you don't need them.
- Real API keys are in `chatbot/.env` and `chatbot/backend/.env`. They're git-ignored, but this folder isn't a git repo yet, so take care if you zip or share it.
- Failure simulation still defaults to `true` in `docker-compose.yml` (useful for the demo). Turn it off for a public deployment.
