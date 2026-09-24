# SnapDeploy AI — Controlled Beta Tester Guide

Welcome to the SnapDeploy AI controlled beta! This guide contains everything you need to know to test the application, verify its features, and provide helpful feedback.

---

## 1. What SnapDeploy AI Is

SnapDeploy AI is an in-browser development workspace that uses Google Gemini AI to transform plain-English descriptions into complete, runnable full-stack React and TypeScript web applications. 

Inside SnapDeploy AI, you can:
- **Build**: Generate complete multi-file web applications from a simple description.
- **Preview**: Run and interact with the generated application instantly inside your browser without installing Node.js or local developer tools.
- **Edit**: Modify code in an integrated code editor or prompt the AI to make visual changes.
- **Debug**: Automatically diagnose and repair syntax or runtime errors with self-healing AI patches.
- **Export**: Download your entire project as a clean, production-ready `.zip` archive ready to run locally or deploy anywhere.

> [!NOTE]
> **Controlled Beta Status**: This application is currently in an early, controlled testing phase with a select group of 5–10 invited testers. We are testing reliability, usability, and core functionality before opening wider access.

---

## 2. Live Application URL

You can access the live beta application at:

**[https://snapdeploy-ai.onrender.com](https://snapdeploy-ai.onrender.com)**

No account registration, login credentials, or credit card is required.

---

## 3. Beta Expectations & System Requirements

- **Supported Browsers**: Please use a modern desktop Chromium-based browser:
  - **Google Chrome** (recommended, version 120+)
  - **Microsoft Edge** (version 120+)
  - **Brave Browser**
  *(Note: The in-browser execution sandbox relies on modern browser isolation features called `SharedArrayBuffer`, which are fully supported on desktop Chromium browsers).*
- **AI Generation Time**: Synthesizing a complete, multi-file application with full TypeScript types and Tailwind CSS typically takes **20 to 45 seconds**. Please allow the generation progress screen to finish.
- **Render Free-Tier Server Cold Starts**:
  - The backend server is hosted on Render's free tier. When the application receives no traffic for 15 minutes, the server temporarily goes to sleep to conserve resources.
  - Waking the server up on your first visit takes **30 to 50 seconds**.
  - **Do NOT interpret a 30–50 second loading delay on your first visit as an application crash or failure.** Once the server wakes up, all subsequent page loads, health checks, and interactions respond quickly.

---

## 4. IMPORTANT: Data Privacy & Security Rules

> [!CAUTION]
> **STRICT PROHIBITION — DO NOT ENTER REAL SECRETS OR SENSITIVE DATA**
> To safeguard your privacy and maintain security, testers are **strictly prohibited** from entering, pasting, or uploading any of the following:
> - Real API keys, personal access tokens, or webhooks (e.g. OpenAI, AWS, GitHub, Stripe).
> - Passwords, PINs, or private authentication credentials.
> - Personally Identifiable Information (PII) such as real names, phone numbers, home addresses, government ID numbers, or financial details.
> - Private, proprietary, or copyrighted source code you do not have permission to share.
> - Confidential business records, financial spreadsheets, or customer data.
> - Non-text binary files (e.g., compiled `.exe` files, archives, or disk images).

All projects you create run client-side in your own browser's storage. Never use real secrets during beta testing.

---

## 5. Recommended Testing Session

- **Session Duration**: Approximately **20 to 30 minutes**.
- **Scope**: One focused test session per tester covering the 10 journeys outlined below.
- This structured format ensures all core features are exercised while keeping server load predictable.

---

## 6. Tester Journeys (Step-by-Step Instructions)

Please work through the following 10 test journeys in order:

### Journey A: Simple AI Application Generation
1. On the home page, locate the prompt input box on the **Build** screen.
2. Enter the prompt:  
   `"Minimalist counter button in React with Tailwind CSS"`
3. Click **Generate** (or press Enter).
4. **Observe**: The generation modal should appear, show progress while synthesizing files, and automatically load your new project into the editor and live preview pane.
5. **Verify**: Click the counter button inside the preview pane to confirm the count increments smoothly.

### Journey B: Complex AI Application Generation
1. Click **New Project** in the navigation bar to start a fresh project.
2. Enter the prompt:  
   `"Kanban board with To-Do, In-Progress, and Done columns, drag-and-drop cards, and local storage"`
3. Click **Generate**.
4. **Observe**: The AI will generate 10–13 project files, setup dependencies, and launch the preview.
5. **Verify**: Add a new task card in the "To-Do" column. Confirm that the card appears and stays in place.

### Journey C: Editing an Existing Generated App
1. With your Kanban board open, switch to the **Edit** tab or use the AI chat / visual edit panel.
2. Enter the edit instruction:  
   `"Change background to slate-900, text to white, and add a reset button"`
3. Submit the edit.
4. **Observe**: The editor updates the files, and the preview pane hot-reloads the changes without rebuilding the entire project from scratch.
5. **Verify**: Check that the background is dark and the reset button works.

### Journey D: RUN / Live Preview Interaction
1. In the preview pane, test the responsive controls (desktop view, mobile view, tablet view).
2. Open the drawer or terminal panel at the bottom of the workspace.
3. **Verify**: The preview adjusts cleanly to different dimensions, buttons remain clickable, and no `SharedArrayBuffer` error appears in your browser console.

### Journey E: DEBUG / Self-Healing Test
1. Click on the **Code** tab to open the Monaco code editor.
2. In the file explorer, select `src/App.tsx`.
3. Intentionally introduce a simple syntax typo (for example, add the line `const brokenVariable = ;` inside the component).
4. Observe the red error banner that appears in the preview pane.
5. Click the **Diagnose & Repair** button on the error banner.
6. **Observe**: SnapDeploy AI's diagnostic service analyzes the TypeScript error and presents a proposed unified diff fix.
7. Click **Apply Patch**.
8. **Verify**: The code editor automatically applies the fix, the error banner clears, and the live preview recovers.

### Journey F: SHIP / Deployment UI Inspection
1. Click the **Ship** or **Deploy** button in the header toolbar.
2. **Observe**: The deployment modal opens and displays the deployment checklist, build settings, and target options (e.g. Netlify, Vercel, Docker).
3. **Verify**: The UI renders cleanly and all checklist items are displayed.
4. *(Note: Do NOT enter real API keys or attempt a paid external deployment; this test is to verify the deployment review interface only).*

### Journey G: ZIP Export
1. Click **Export ZIP** in the top navigation bar or press `Ctrl + K` (`Cmd + K` on Mac) and select **Export Project as ZIP**.
2. **Observe**: Your browser will immediately download a `.zip` archive named after your project.
3. Open your computer's downloads folder and extract the `.zip` archive.
4. **Verify**: Confirm that the extracted folder contains `package.json`, `src/App.tsx`, and a truthful `README.md` explaining how to run the project.

### Journey H: Multi-Project Isolation
1. Return to the home screen and create another project with prompt:  
   `"Pomodoro timer with audio chime"`
2. Wait for generation to complete.
3. Use the project switcher in the header to switch back and forth between your Kanban board and your Pomodoro timer.
4. **Verify**: The files, code, and preview of Project 1 and Project 2 remain completely separate and do not overwrite each other.

### Journey I: Browser Refresh Persistence
1. While viewing one of your projects, press `F5` or click your browser's Refresh button.
2. **Observe**: The page reloads and restores your workspace.
3. **Verify**: Confirm that your project files, edits, and active tabs are fully preserved from your browser's local storage.

### Journey J: Graceful Error Recovery
1. Try submitting an empty prompt (only spaces) on the Build screen.
2. Next, try pasting a massive block of text exceeding 10,000 characters into the prompt box.
3. **Observe**: The application rejects the invalid input with a clean warning message (e.g., `Prompt must be a non-empty string` or `Prompt exceeds maximum length of 10,000 characters`).
4. **Verify**: The application does not freeze, crash, or enter an error loop. Clear the text box and verify you can immediately enter a normal prompt.

---

## 7. What Counts as Success

A testing session is considered successful when:
- [x] Simple and complex applications generate without getting permanently stuck.
- [x] All generated files appear in the file tree.
- [x] The live preview loads and responds to your clicks.
- [x] Code edits or visual changes update the live preview.
- [x] Self-healing repair successfully fixes an intentional code syntax error.
- [x] Exporting a `.zip` file downloads a clean, working project archive to your computer.
- [x] Refreshing your browser preserves your project files without loss.
- [x] The application operates without fatal white-screen freezes or unhandled crashes.

---

## 8. What To Do When Something Fails

If you encounter an issue during testing:
1. **First-Load Slowdown**: If the page takes 30–50 seconds to respond on your first visit, wait a moment. The free-tier server is simply spinning up from sleep.
2. **Temporary AI Demand Spike**: On rare occasions, Google Gemini returns a temporary high-demand message. Wait 10–15 seconds and try clicking the button once more.
3. **Capture the Error**: If an error banner appears, note the exact error text.
4. **Copy the Request ID**: If an error message displays a `Request ID` (e.g. `99053a71-854f-44de-bed7-17d6ff21b3cd`), please copy it.
5. **Take a Screenshot**: Capture a screenshot showing the error message and the screen state.
6. **Note Browser Details**: Check your browser name and version (e.g. Chrome 129 on Windows 11).
7. **Do NOT Hammer the Service**: Please avoid clicking repeatedly or refreshing rapidly if an action is processing.

---

## 9. Beta Feedback Template

Please copy and fill out this template for your testing report:

```markdown
### SnapDeploy AI — Beta Tester Report

1. **Tester ID / Name**: [ e.g. Tester-1 ]
2. **Date & Time (UTC)**: [ YYYY-MM-DD HH:MM UTC ]
3. **Browser & OS**: [ e.g. Chrome 129 on Windows 11 / Edge 128 on macOS ]
4. **Primary Goal**: [ What app did you try to build? ]
5. **Exact Prompt Used**:
   > [ Insert prompt text here ]
6. **Observed Outcome**:
   - [ ] Full Success (Generated, previewed, and worked cleanly)
   - [ ] Partial Success (Generated, but needed minor repairs)
   - [ ] Failed (Encountered error or preview did not render)
7. **Error Message (if any)**: `[ Paste exact error text ]`
8. **Request ID (`X-Request-Id`)**: `[ Paste UUID if visible ]`
9. **Severity Assessment**:
   - [ ] Low (Cosmetic glitch, workflow completed)
   - [ ] Medium (Feature failed, but retry or workaround worked)
   - [ ] Critical (Application completely blocked, could not continue)
10. **Able to Continue Testing?**: [ Yes / No ]
11. **Screenshots / Observations**: [ Add any additional notes or screenshots ]
```

---

## 10. Tester Boundaries

As an invited beta tester, please observe the following boundaries:
- **Rate Limits**: The system allows up to 30 requests per minute per IP address. Please do not run automated scripts or spam buttons.
- **Daily Quotas**: The system enforces a daily limit of 1,000 AI requests across the entire platform. Please do not run repetitive infinite loops.
- **Security**: Do not attempt penetration testing, vulnerability scanning, or denial-of-service attacks.
- **No Secrets**: Never test with real business credentials or confidential files.

---

## 11. Known Limitations

Please keep these known architecture characteristics in mind:
- **Render Free Tier Cold Starts**: Containers sleep after 15 minutes of inactivity; waking up takes 30–50 seconds.
- **Process-Local Quotas**: Daily quota counters reset at 00:00 UTC and upon container restarts.
- **Browser-Local Storage**: Your projects are saved in your browser's IndexedDB. Clearing your browser cookies/storage will erase your local projects unless you have exported them as a `.zip`.
- **No Multi-Device Cloud Sync**: Projects created on your laptop will not automatically appear on your desktop without exporting and re-importing.
- **Upstream AI Availability**: Google Gemini may intermittently throttle or reject requests during peak regional demand periods.

---

## 12. How to Report a Critical Problem

If you encounter a critical issue that blocks testing completely (e.g. persistent white screen, permanent rate limiting, or inability to load the site):
1. Note the exact UTC timestamp.
2. Record the exact action you were taking when the failure occurred.
3. Copy the Request ID (`X-Request-Id`) from the error modal or DevTools network tab if available.
4. Take a screenshot of the browser window (including DevTools console if possible).
5. Submit the report directly to the test coordinator using the Feedback Template above.

---

## Operator Notes — Do Not Modify

*This section is intended for the system operator administering the controlled beta.*

### Mandatory Pre-Session Operator Checklist
Before starting any tester cohort session, verify that the following checks pass on the live deployment:
1. `GET https://snapdeploy-ai.onrender.com/api/health/liveness` returns `HTTP 200` (`status: "ok"`).
2. `GET https://snapdeploy-ai.onrender.com/api/health/readiness` returns `HTTP 200` (`checks.aiProvider: "configured"`).
3. `GET https://snapdeploy-ai.onrender.com/api/ai/status` confirms:
   - `configured: true`
   - `dailyQuota.remaining >= 900`
   - `latency.sampleCount` is reporting valid metrics.
4. Render Dashboard confirms Web Service status is **Live** with zero deployment errors.

### Operational Hold Conditions (Immediately Pause Beta)
The operator must pause the beta and halt sending tester invitations if any of the following occur:
- **Daily Quota Depletion**: `dailyQuota.remaining` drops below 100 before the end of the testing window.
- **Repeated 5xx Server Crashes**: Unhandled server errors appear repeatedly in Render logs that are not caused by upstream Gemini availability.
- **Data Isolation Breach**: Any report indicating a tester was able to view or access another tester's project data.
- **Systemic WebContainer Failure**: Cross-origin isolation headers (`COOP`/`COEP`) fail to inject, causing `SharedArrayBuffer` errors across all testers.
