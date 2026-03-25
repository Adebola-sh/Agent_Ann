// ============================================
// Sheet Manager - Message Handler
// ============================================
// Orchestrates message processing: WhatsApp → Gemini → Sheets → Reply

import { config } from 'dotenv';

config();

class MessageHandler {
  /**
   * @param {import('./whatsapp-service.js').default} whatsapp
   * @param {import('./gemini-service.js').default} gemini
   * @param {import('./sheets-service.js').default} sheets
   */
  constructor(whatsapp, gemini, sheets) {
    this.whatsapp = whatsapp;
    this.gemini = gemini;
    this.sheets = sheets;
    this.messageCount = 0;
    this.recentActivity = [];
  }

  /**
   * Process an incoming message end-to-end
   */
  async handleMessage(messageData) {
    const { from, body, senderName, isGroup, groupName, type } = messageData;

    // Skip non-text messages for now
    if (type !== 'chat' || !body.trim()) {
      return;
    }

    // Skip group messages unless bot is mentioned (optional behavior)
    const botName = process.env.BOT_NAME || 'Ann';
    if (isGroup && !body.toLowerCase().includes(botName.toLowerCase())) {
      return;
    }

    this.messageCount++;

    try {
      // First pass: Send to Gemini without heavy sheets context
      // This makes general conversation fast and avoids Sheets errors
      let aiResponse = await this.gemini.processMessage(from, body);

      // If the AI determined this is a spreadsheet action, re-process with todos context
      const sheetActions = [
        'add_todo', 'list_todos', 'complete_todo',
        'delete_todo', 'update_todo', 'get_summary', 'create_sheet',
      ];

      if (sheetActions.includes(aiResponse.action)) {
        let todosContext = '';
        try {
          const summary = await this.sheets.getSummary();
          todosContext = JSON.stringify({
            active: summary.totalActive,
            completed: summary.totalCompleted,
            todos: summary.todos.map((t) => `${t.task} [${t.priority}]`),
          });
        } catch (err) {
          // Sheets might not be ready yet — proceed without context
          todosContext = '';
        }

        // Re-process with context if we have it (for better action accuracy)
        if (todosContext) {
          aiResponse = await this.gemini.processMessage(from, body, todosContext);
        }
      }

      // Execute the determined action
      const result = await this.executeAction(aiResponse, from);

      // Track recent activity
      this.recentActivity.unshift({
        timestamp: new Date().toISOString(),
        user: senderName,
        message: body.substring(0, 100),
        action: aiResponse.action,
        response: result.substring(0, 100),
      });

      // Keep only last 50 activities
      if (this.recentActivity.length > 50) {
        this.recentActivity = this.recentActivity.slice(0, 50);
      }

      // Send the response with typing indicator
      await this.whatsapp.sendWithTyping(from, result);
    } catch (error) {
      console.error('Error handling message:', error);
      await this.whatsapp.sendMessage(
        from,
        '⚠️ Oops! Something went wrong. Please try again in a moment.'
      );
    }
  }

  /**
   * Execute an action based on AI response
   */
  async executeAction(aiResponse, from) {
    const { action, params, message } = aiResponse;

    try {
      switch (action) {
        case 'add_todo': {
          const todo = await this.sheets.addTodo({
            task: params.task,
            priority: params.priority || 'Medium',
            category: params.category || 'General',
            dueDate: params.dueDate || '',
          });
          return (
            `✅ *Task Added!*\n\n` +
            `📝 *${todo.task}*\n` +
            `🔖 Priority: ${this.getPriorityEmoji(todo.priority)} ${todo.priority}\n` +
            `📂 Category: ${todo.category}\n` +
            `🆔 ID: \`${todo.id}\`\n` +
            (todo.dueDate ? `📅 Due: ${todo.dueDate}\n` : '') +
            `\n${message}`
          );
        }

        case 'list_todos': {
          const todos = await this.sheets.getTodos();
          if (todos.length === 0) {
            return '📋 *Your todo list is empty!*\n\nNo tasks yet. Send me something like "Add buy groceries" to get started! 🚀';
          }

          let filtered = todos;
          if (params.filter && params.filter !== 'all') {
            filtered = todos.filter(
              (t) =>
                t.priority.toLowerCase() === params.filter.toLowerCase() ||
                t.category.toLowerCase() === params.filter.toLowerCase()
            );
          }

          let response = `📋 *Your Todo List* (${filtered.length} items)\n\n`;
          filtered.forEach((todo, i) => {
            response +=
              `${i + 1}. ${this.getPriorityEmoji(todo.priority)} *${todo.task}*\n` +
              `   📂 ${todo.category} | 📅 ${todo.created}${todo.dueDate ? ` → ${todo.dueDate}` : ''}\n\n`;
          });

          const highPriority = filtered.filter((t) => t.priority === 'High');
          if (highPriority.length > 0) {
            response += `\n⚡ *${highPriority.length} high-priority item(s) need attention!*`;
          }

          response += `\n\n${message}`;
          return response;
        }

        case 'complete_todo': {
          const completed = await this.sheets.completeTodo(params.identifier);
          if (!completed) {
            return `❓ I couldn't find a task matching "${params.identifier}". Try "show my todos" to see the full list.`;
          }
          return (
            `🎉 *Task Completed!*\n\n` +
            `✅ ~~${completed.task}~~\n` +
            `⏱️ Took: ${completed.duration}\n\n` +
            `Great job! Keep it up! 💪\n\n${message}`
          );
        }

        case 'delete_todo': {
          const deleted = await this.sheets.deleteTodo(params.identifier);
          if (!deleted) {
            return `❓ I couldn't find a task matching "${params.identifier}". Try "show my todos" to see the full list.`;
          }
          return `🗑️ *Task Deleted*\n\nRemoved: "${deleted.task}"\n\n${message}`;
        }

        case 'update_todo': {
          const updated = await this.sheets.updateTodo(
            params.identifier,
            params.updates
          );
          if (!updated) {
            return `❓ I couldn't find a task matching "${params.identifier}". Try "show my todos" to see the full list.`;
          }
          return (
            `✏️ *Task Updated!*\n\n` +
            `📝 *${updated.task}*\n` +
            `🔖 Priority: ${this.getPriorityEmoji(updated.priority)} ${updated.priority}\n` +
            `📂 Category: ${updated.category}\n\n` +
            `${message}`
          );
        }

        case 'get_summary': {
          const summary = await this.sheets.getSummary();
          return (
            `📊 *Todo Summary*\n\n` +
            `📋 Active tasks: *${summary.totalActive}*\n` +
            `✅ Completed: *${summary.totalCompleted}*\n\n` +
            `*By Priority:*\n` +
            `🔴 High: ${summary.byPriority.High || 0}\n` +
            `🟡 Medium: ${summary.byPriority.Medium || 0}\n` +
            `🟢 Low: ${summary.byPriority.Low || 0}\n\n` +
            `*By Category:*\n` +
            Object.entries(summary.byCategory)
              .map(([cat, count]) => `📂 ${cat}: ${count}`)
              .join('\n') +
            `\n\n🔗 *View your sheet:*\n${summary.spreadsheetUrl}\n\n${message}`
          );
        }

        case 'create_sheet': {
          await this.sheets.createSheet(params.name);
          return `📄 *New sheet created!*\n\nSheet "${params.name}" has been added to your spreadsheet.\n\n${message}`;
        }

        case 'chat':
        default:
          return message;
      }
    } catch (error) {
      console.error(`Error executing action "${action}":`, error);
      return `⚠️ I tried to ${action.replace('_', ' ')} but something went wrong. Please try again.\n\nError: ${error.message}`;
    }
  }

  /**
   * Get emoji for priority level
   */
  getPriorityEmoji(priority) {
    const emojis = { High: '🔴', Medium: '🟡', Low: '🟢' };
    return emojis[priority] || '⚪';
  }

  /**
   * Get stats for dashboard
   */
  getStats() {
    return {
      messagesProcessed: this.messageCount,
      recentActivity: this.recentActivity,
    };
  }
}

export default MessageHandler;
