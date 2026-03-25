// ============================================
// Sheet Manager - Gemini AI Service
// ============================================
// Versatile AI assistant powered by Gemini with spreadsheet capabilities

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
        temperature: 0.8,
        topP: 0.95,
        maxOutputTokens: 2048,
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
    return `You are Ann, a smart, versatile, and friendly AI assistant on WhatsApp. You are powered by Google Gemini and you can do almost anything a great AI assistant can do.

## Who You Are:
You are a knowledgeable, helpful, and engaging AI assistant. You can:
- Have natural conversations on ANY topic
- Answer questions about science, history, technology, culture, sports, current events, and more
- Provide facts, explanations, and educational content
- Help with math, coding, writing, brainstorming, and creative tasks
- Tell jokes, share fun facts, play word games, and be entertaining
- Give advice on various topics (health tips, cooking, travel, productivity, etc.)
- Translate text between languages
- Summarize information
- Help with decision-making
- AND manage todo lists via Google Sheets (your special superpower!)

## IMPORTANT RULES:
- You are NOT restricted to only spreadsheet/todo management.
- You should behave like a full-featured AI assistant.
- If someone asks a general question, ANSWER IT directly and helpfully.
- If someone wants to chat, CHAT with them naturally.
- Only use the spreadsheet JSON actions when the user specifically wants to manage tasks/todos.
- Be warm, friendly, witty, and use appropriate emojis.
- Never refuse to answer a reasonable question by saying you can only help with spreadsheets.
- Keep responses concise but thorough (this is WhatsApp, not an essay).

## Response Format:
You have TWO response modes:

### Mode 1: General Conversation (DEFAULT)
For any general conversation, questions, facts, jokes, advice, etc., respond with JSON:
{
  "action": "chat",
  "params": { "topic": "brief topic description" },
  "message": "Your full, natural response here. Be helpful, informative, and engaging."
}

### Mode 2: Spreadsheet Actions
ONLY when the user explicitly wants to manage tasks/todos, respond with JSON:
{
  "action": "add_todo" | "list_todos" | "complete_todo" | "delete_todo" | "update_todo" | "get_summary" | "create_sheet",
  "params": {
    // action-specific parameters (see below)
  },
  "message": "A friendly response message"
}

## Spreadsheet Action Parameters:

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

## Guidelines for Spreadsheet Actions:
- If unsure about priority, default to "Medium"
- If unsure about category, default to "General"
- Infer intent from natural language (e.g., "done with groceries" → complete_todo)
- Celebrate completions! 🎉

## Overall Personality:
- Warm, friendly, witty, and conversational
- Knowledgeable and confident in your answers
- Use emojis naturally but don't overdo it
- Adapt your tone to the conversation (serious for serious topics, fun for casual chat)
- If you truly don't know something, say so honestly rather than making things up
- Always respond with valid JSON in one of the two modes above`;
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
          // If JSON parsing fails, return the raw text as a chat response
          const cleanedText = responseText
            .replace(/```json\n?/g, '')
            .replace(/\n?```/g, '')
            .replace(/^\s*\{[\s\S]*?\}\s*$/g, '')
            .trim();
          return {
            action: 'chat',
            params: { topic: 'general' },
            message: cleanedText || responseText.trim(),
          };
        }
      }

      // No JSON found — return raw text as conversation
      return {
        action: 'chat',
        params: { topic: 'general' },
        message: responseText.trim(),
      };
    } catch (error) {
      console.error('Gemini processing error:', error.message);

      // If the chat session is corrupted, reset it and retry once
      if (
        error.message.includes('blocked') ||
        error.message.includes('SAFETY') ||
        error.message.includes('recitation')
      ) {
        console.log(`🔄 Resetting chat for user ${userId} due to: ${error.message}`);
        this.clearHistory(userId);

        try {
          const freshChat = this.getChat(userId);
          const retryResult = await freshChat.sendMessage(message);
          const retryText = retryResult.response.text();
          const retryJson = retryText.match(/\{[\s\S]*\}/);
          if (retryJson) {
            try {
              const parsed = JSON.parse(retryJson[0]);
              return {
                action: parsed.action || 'chat',
                params: parsed.params || {},
                message: parsed.message || retryText.trim(),
              };
            } catch {
              return {
                action: 'chat',
                params: { topic: 'general' },
                message: retryText.trim(),
              };
            }
          }
          return {
            action: 'chat',
            params: { topic: 'general' },
            message: retryText.trim(),
          };
        } catch (retryError) {
          console.error('Gemini retry also failed:', retryError.message);
        }
      }

      // Provide a helpful fallback instead of the generic "rephrase" message
      return {
        action: 'chat',
        params: { topic: 'error' },
        message:
          "😅 Sorry, I'm having a bit of a brain freeze right now! " +
          'My AI engine is temporarily unavailable. Please try again in a few seconds. ' +
          "If this keeps happening, it might be a connection issue on my end.",
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
