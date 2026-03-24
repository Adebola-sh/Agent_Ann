// ============================================
// Sheet Manager - Gemini AI Service
// ============================================
// Processes WhatsApp messages and determines actions using Gemini

import { GoogleGenerativeAI } from '@google/generative-ai';
import { config } from 'dotenv';

config();

class GeminiService {
  constructor() {
    this.model = null;
    this.chat = null;
    this.conversationHistory = new Map(); // per-user chat history
  }

  /**
   * Initialize the Gemini AI model
   */
  async initialize() {
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey || apiKey === 'your_gemini_api_key_here') {
      throw new Error(
        '❌ GEMINI_API_KEY not configured!\n' +
        '   Get your API key at: https://aistudio.google.com/apikey\n' +
        '   Then add it to your .env file.'
      );
    }

    const genAI = new GoogleGenerativeAI(apiKey);
    this.model = genAI.getGenerativeModel({
      model: 'gemini-2.0-flash',
      generationConfig: {
        temperature: 0.7,
        topP: 0.9,
        maxOutputTokens: 1024,
      },
    });

    console.log('✅ Gemini AI service initialized');
    return this;
  }

  /**
   * Get or create a chat session for a specific user
   */
  getChat(userId) {
    if (!this.conversationHistory.has(userId)) {
      const chat = this.model.startChat({
        history: [],
        systemInstruction: this.getSystemPrompt(),
      });
      this.conversationHistory.set(userId, chat);
    }
    return this.conversationHistory.get(userId);
  }

  /**
   * System prompt that guides Gemini's behavior
   */
  getSystemPrompt() {
    return `You are SheetBot, a friendly and efficient WhatsApp-based todo list manager. You help users manage their tasks through Google Sheets.

## Your Capabilities:
You can perform the following actions by responding with a JSON action block:

1. **Add Todo**: When user wants to add a task
2. **List Todos**: When user wants to see their tasks
3. **Complete Todo**: When user marks a task as done
4. **Delete Todo**: When user wants to remove a task
5. **Update Todo**: When user wants to modify a task
6. **Get Summary**: When user wants an overview
7. **Create Sheet**: When user wants a new sheet/tab
8. **Chat**: For general conversation or unclear requests

## Response Format:
ALWAYS respond with valid JSON in this exact format:
{
  "action": "add_todo" | "list_todos" | "complete_todo" | "delete_todo" | "update_todo" | "get_summary" | "create_sheet" | "chat",
  "params": {
    // action-specific parameters
  },
  "message": "A friendly response message to send to the user"
}

## Action Parameters:

### add_todo
{ "task": "string", "priority": "High|Medium|Low", "category": "string", "dueDate": "YYYY-MM-DD or empty" }

### list_todos
{ "filter": "all|high|medium|low|category_name" }

### complete_todo
{ "identifier": "task name or ID" }

### delete_todo
{ "identifier": "task name or ID" }

### update_todo
{ "identifier": "task name or ID", "updates": { "task": "new name", "priority": "new priority", "category": "new category", "dueDate": "new date" } }

### get_summary
{}

### create_sheet
{ "name": "sheet name" }

### chat
{ "topic": "what the user is talking about" }

## Guidelines:
- Be warm, friendly, and use appropriate emojis 🎯
- If unsure about priority, default to "Medium"
- If unsure about category, default to "General"
- Infer intent from natural language (e.g., "done with groceries" → complete_todo)
- For ambiguous requests, ask for clarification using the "chat" action
- Keep messages concise but helpful
- When listing todos, always remind them of their most urgent items
- Celebrate completions! 🎉
- If the user greets you, respond warmly and offer to help with their todos`;
  }

  /**
   * Process a message and return structured action
   */
  async processMessage(userId, message, todosContext = '') {
    const chat = this.getChat(userId);

    let contextualMessage = message;
    if (todosContext) {
      contextualMessage = `[Current todos context: ${todosContext}]\n\nUser message: ${message}`;
    }

    try {
      const result = await chat.sendMessage(contextualMessage);
      const responseText = result.response.text();

      // Extract JSON from the response
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          const parsed = JSON.parse(jsonMatch[0]);
          return {
            action: parsed.action || 'chat',
            params: parsed.params || {},
            message: parsed.message || 'I processed your request!',
          };
        } catch (parseErr) {
          // If JSON parsing fails, treat as chat
          return {
            action: 'chat',
            params: { topic: 'general' },
            message: responseText.replace(/```json\n?|\n?```/g, '').trim(),
          };
        }
      }

      return {
        action: 'chat',
        params: { topic: 'general' },
        message: responseText,
      };
    } catch (error) {
      console.error('Gemini processing error:', error.message);
      return {
        action: 'chat',
        params: { topic: 'error' },
        message: '⚠️ I had trouble understanding that. Could you try rephrasing?',
      };
    }
  }

  /**
   * Clear conversation history for a user
   */
  clearHistory(userId) {
    this.conversationHistory.delete(userId);
  }
}

export default GeminiService;
