# Technical Requirements: BIM-AI Agent Integration (APS & Ollama)

This document outlines the essential skills and architectural components required to upgrade the current chatbot into a functional **BIM-AI Agent** capable of controlling the APS Viewer, analyzing issues, and retrieving company standards.

---

## 1. Contextual Awareness (The "Eyes")
*The ability for the AI to perceive the current state of the BIM model and dashboard.*

### Required Skills & Technologies:
* **APS Viewer API (Metadata Extraction):** Skill in using `viewer.model.getBulkProperties` and `viewer.search` to extract real-time model data (filenames, categories, element counts).
* **Context Injection Harness:** Development of a middleware that captures the viewer's state and injects it into the AI's **System Prompt** automatically upon model load or user query.
* **State Tracking:** Monitoring dashboard variables (chart data, project progress) to provide summaries of visualized information.

---

## 2. Actionable Intelligence (The "Hands")
*The ability to translate natural language into physical software commands.*

### Required Skills & Technologies:
* **Function Calling / Tool Use Design:** Engineering the LLM to output structured **JSON schemas** instead of plain text when a command is detected.
* **Action Dispatcher (Interceptor):** Implementing a JavaScript-based interceptor in `ai-panel.js` to parse JSON outputs and trigger `viewer.select()`, `viewer.hide()`, or `viewer.setView()` methods.
* **Spatial Reasoning:** Converting AI-generated instructions into specific coordinates or `dbIds` for precise navigation within the 3D environment.

---

## 3. Knowledge & Information Retrieval (The "Brain")
*The ability to answer specialized questions using company-specific data and APIs.*

### Required Skills & Technologies:
* **RAG (Retrieval-Augmented Generation):** Building a vector database for company **Quantity Take-off Standards** to allow the AI to search and cite internal documents.
* **APS Issues API Integration:** Authenticating and fetching real-time data from the **Autodesk Construction Cloud (ACC) Issues API** to answer status-related queries.
* **Data Aggregation:** Logic to count, filter, and categorize files or issues based on specific metadata (e.g., status, type, date).

---

## 4. Local LLM Infrastructure & Security
*Optimizing performance for a local environment using Ollama.*

### Required Skills & Technologies:
* **Ollama API Orchestration:** Managing the connection between the web backend and the Ollama server, ensuring stable streaming and prompt handling.
* **Resource Optimization:** Implementing **Asynchronous processing** (Web Workers/requestIdleCallback) to prevent the UI from freezing during heavy model data extraction.
* **Guardrail Engineering:** Setting up validation layers to ensure the AI does not leak internal data or execute unauthorized commands.

---

## 5. Harness Engineering Architecture
*The structural framework connecting all components.*

| Layer | Responsibility | Key Implementation |
| :--- | :--- | :--- |
| **Context Harness** | Feeds Viewer/Issue data to AI | Automatic metadata-to-prompt injection |
| **Action Harness** | Executes Viewer commands | JSON-to-API Command Dispatcher |
| **Validation Harness** | Checks data accuracy | Real-time "Ground Truth" verification |
