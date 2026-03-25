import { google } from 'googleapis';
import { readFileSync, existsSync } from 'fs';
import { config } from 'dotenv';

config();

class SheetsService {
  constructor() {
    this.sheets = null;
    this.drive = null;
    this.spreadsheetId = process.env.DEFAULT_SPREADSHEET_ID || null;
    this.auth = null;
  }

  /**
   * Initialize Google Sheets API with service account credentials
   */
  async initialize() {
    const credPath = process.env.GOOGLE_SHEETS_CREDENTIALS_PATH || './credentials.json';

    if (!existsSync(credPath)) {
      throw new Error(
        `❌ Google credentials file not found at "${credPath}"\n` +
        '   Download the JSON key from Google Cloud Console:\n' +
        '   IAM & Admin → Service Accounts → Your Account → Keys → Add Key\n'
      );
    }

    let credentials;
    try {
      credentials = JSON.parse(readFileSync(credPath, 'utf8'));
    } catch (parseErr) {
      throw new Error(
        `❌ credentials.json is not valid JSON. Make sure you downloaded\n` +
        `   the correct file from Google Cloud Console (JSON key, not P12).\n`
      );
    }

    // Quick sanity check on credentials structure
    if (!credentials.client_email || !credentials.private_key) {
      throw new Error(
        `❌ credentials.json is missing required fields (client_email or private_key).\n` +
        `   Make sure you downloaded the Service Account JSON key (not OAuth credentials).\n`
      );
    }

    console.log(`   Using service account: ${credentials.client_email}`);

    this.auth = new google.auth.GoogleAuth({
      credentials,
      scopes: [
        'https://www.googleapis.com/auth/spreadsheets',
        'https://www.googleapis.com/auth/drive',
      ],
    });

    const authClient = await this.auth.getClient();
    this.sheets = google.sheets({ version: 'v4', auth: authClient });
    this.drive = google.drive({ version: 'v3', auth: authClient });

    // Create default spreadsheet if none exists
    if (!this.spreadsheetId) {
      await this.createDefaultSpreadsheet();
    }

    console.log('✅ Google Sheets service initialized');
    return this;
  }

  /**
   * Create the default todo list spreadsheet
   */
  async createDefaultSpreadsheet() {
    const response = await this.sheets.spreadsheets.create({
      requestBody: {
        properties: {
          title: '📋 SheetBot - Todo List Manager',
        },
        sheets: [
          {
            properties: {
              title: 'Todos',
              gridProperties: { frozenRowCount: 1 },
            },
          },
          {
            properties: {
              title: 'Completed',
              gridProperties: { frozenRowCount: 1 },
            },
          },
          {
            properties: {
              title: 'Activity Log',
              gridProperties: { frozenRowCount: 1 },
            },
          },
        ],
      },
    });

    this.spreadsheetId = response.data.spreadsheetId;
    console.log(`📊 Created spreadsheet: ${this.spreadsheetId}`);

    // Set up headers
    await this.sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: this.spreadsheetId,
      requestBody: {
        data: [
          {
            range: 'Todos!A1:F1',
            values: [['ID', 'Task', 'Priority', 'Category', 'Created', 'Due Date']],
          },
          {
            range: 'Completed!A1:G1',
            values: [['ID', 'Task', 'Priority', 'Category', 'Created', 'Completed', 'Duration']],
          },
          {
            range: 'Activity Log!A1:D1',
            values: [['Timestamp', 'Action', 'Details', 'User']],
          },
        ],
        valueInputOption: 'RAW',
      },
    });

    // Apply formatting to headers
    await this.formatHeaders();

    return this.spreadsheetId;
  }

  /**
   * Format the header row with styling
   */
  async formatHeaders() {
    const sheetIds = await this.getSheetIds();

    const requests = sheetIds.map((sheetId) => ({
      repeatCell: {
        range: {
          sheetId,
          startRowIndex: 0,
          endRowIndex: 1,
        },
        cell: {
          userEnteredFormat: {
            backgroundColor: { red: 0.15, green: 0.15, blue: 0.22 },
            textFormat: {
              foregroundColor: { red: 0.9, green: 0.75, blue: 0.3 },
              bold: true,
              fontSize: 11,
            },
            horizontalAlignment: 'CENTER',
          },
        },
        fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)',
      },
    }));

    await this.sheets.spreadsheets.batchUpdate({
      spreadsheetId: this.spreadsheetId,
      requestBody: { requests },
    });
  }

  /**
   * Get all sheet IDs in the spreadsheet
   */
  async getSheetIds() {
    const response = await this.sheets.spreadsheets.get({
      spreadsheetId: this.spreadsheetId,
    });
    return response.data.sheets.map((s) => s.properties.sheetId);
  }

  /**
   * Add a new todo item
   */
  async addTodo({ task, priority = 'Medium', category = 'General', dueDate = '' }) {
    const id = `TODO-${Date.now().toString(36).toUpperCase()}`;
    const created = new Date().toISOString().split('T')[0];

    await this.sheets.spreadsheets.values.append({
      spreadsheetId: this.spreadsheetId,
      range: 'Todos!A:F',
      valueInputOption: 'RAW',
      requestBody: {
        values: [[id, task, priority, category, created, dueDate]],
      },
    });

    await this.logActivity('ADD', `Added todo: "${task}" [${priority}]`);

    return { id, task, priority, category, created, dueDate };
  }

  /**
   * Get all active todos
   */
  async getTodos() {
    const response = await this.sheets.spreadsheets.values.get({
      spreadsheetId: this.spreadsheetId,
      range: 'Todos!A2:F',
    });

    const rows = response.data.values || [];
    return rows.map((row) => ({
      id: row[0],
      task: row[1],
      priority: row[2] || 'Medium',
      category: row[3] || 'General',
      created: row[4],
      dueDate: row[5] || '',
    }));
  }

  /**
   * Get all completed todos
   */
  async getCompleted() {
    const response = await this.sheets.spreadsheets.values.get({
      spreadsheetId: this.spreadsheetId,
      range: 'Completed!A2:G',
    });

    const rows = response.data.values || [];
    return rows.map((row) => ({
      id: row[0],
      task: row[1],
      priority: row[2],
      category: row[3],
      created: row[4],
      completed: row[5],
      duration: row[6],
    }));
  }

  /**
   * Mark a todo as complete (move from Todos to Completed sheet)
   */
  async completeTodo(identifier) {
    const todos = await this.getTodos();
    const index = todos.findIndex(
      (t) =>
        t.id === identifier ||
        t.task.toLowerCase().includes(identifier.toLowerCase())
    );

    if (index === -1) {
      return null;
    }

    const todo = todos[index];
    const completedDate = new Date().toISOString().split('T')[0];
    const createdDate = new Date(todo.created);
    const completedDateObj = new Date(completedDate);
    const durationDays = Math.ceil((completedDateObj - createdDate) / (1000 * 60 * 60 * 24));

    // Add to Completed sheet
    await this.sheets.spreadsheets.values.append({
      spreadsheetId: this.spreadsheetId,
      range: 'Completed!A:G',
      valueInputOption: 'RAW',
      requestBody: {
        values: [[
          todo.id, todo.task, todo.priority, todo.category,
          todo.created, completedDate, `${durationDays} days`
        ]],
      },
    });

    // Remove from Todos sheet (row index + 2 for header offset)
    await this.deleteRow('Todos', index + 1);

    await this.logActivity('COMPLETE', `Completed: "${todo.task}"`);

    return { ...todo, completed: completedDate, duration: `${durationDays} days` };
  }

  /**
   * Delete a todo item
   */
  async deleteTodo(identifier) {
    const todos = await this.getTodos();
    const index = todos.findIndex(
      (t) =>
        t.id === identifier ||
        t.task.toLowerCase().includes(identifier.toLowerCase())
    );

    if (index === -1) {
      return null;
    }

    const todo = todos[index];
    await this.deleteRow('Todos', index + 1);
    await this.logActivity('DELETE', `Deleted: "${todo.task}"`);

    return todo;
  }

  /**
   * Update a todo item's properties
   */
  async updateTodo(identifier, updates) {
    const todos = await this.getTodos();
    const index = todos.findIndex(
      (t) =>
        t.id === identifier ||
        t.task.toLowerCase().includes(identifier.toLowerCase())
    );

    if (index === -1) {
      return null;
    }

    const todo = { ...todos[index], ...updates };
    const rowIndex = index + 2; // 1-based + header

    await this.sheets.spreadsheets.values.update({
      spreadsheetId: this.spreadsheetId,
      range: `Todos!A${rowIndex}:F${rowIndex}`,
      valueInputOption: 'RAW',
      requestBody: {
        values: [[todo.id, todo.task, todo.priority, todo.category, todo.created, todo.dueDate]],
      },
    });

    await this.logActivity('UPDATE', `Updated: "${todo.task}" → ${JSON.stringify(updates)}`);

    return todo;
  }

  /**
   * Delete a row from a specific sheet
   */
  async deleteRow(sheetName, rowIndex) {
    const sheetIds = await this.getSheetIds();
    const spreadsheet = await this.sheets.spreadsheets.get({
      spreadsheetId: this.spreadsheetId,
    });

    const sheet = spreadsheet.data.sheets.find(
      (s) => s.properties.title === sheetName
    );

    if (!sheet) return;

    await this.sheets.spreadsheets.batchUpdate({
      spreadsheetId: this.spreadsheetId,
      requestBody: {
        requests: [
          {
            deleteDimension: {
              range: {
                sheetId: sheet.properties.sheetId,
                dimension: 'ROWS',
                startIndex: rowIndex,
                endIndex: rowIndex + 1,
              },
            },
          },
        ],
      },
    });
  }

  /**
   * Log an activity to the Activity Log sheet
   */
  async logActivity(action, details, user = 'WhatsApp') {
    const timestamp = new Date().toISOString();

    await this.sheets.spreadsheets.values.append({
      spreadsheetId: this.spreadsheetId,
      range: 'Activity Log!A:D',
      valueInputOption: 'RAW',
      requestBody: {
        values: [[timestamp, action, details, user]],
      },
    });
  }

  /**
   * Get a summary of all todos (for AI context)
   */
  async getSummary() {
    const todos = await this.getTodos();
    const completed = await this.getCompleted();

    const byPriority = { High: 0, Medium: 0, Low: 0 };
    const byCategory = {};

    todos.forEach((t) => {
      byPriority[t.priority] = (byPriority[t.priority] || 0) + 1;
      byCategory[t.category] = (byCategory[t.category] || 0) + 1;
    });

    return {
      totalActive: todos.length,
      totalCompleted: completed.length,
      byPriority,
      byCategory,
      todos,
      spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${this.spreadsheetId}/edit`,
    };
  }

  /**
   * Create a custom named sheet/spreadsheet
   */
  async createSheet(name) {
    await this.sheets.spreadsheets.batchUpdate({
      spreadsheetId: this.spreadsheetId,
      requestBody: {
        requests: [
          {
            addSheet: {
              properties: { title: name },
            },
          },
        ],
      },
    });

    await this.logActivity('CREATE_SHEET', `Created new sheet: "${name}"`);
    return name;
  }
}

export default SheetsService;
