// Quick diagnostic: test Google API permissions step by step
import { google } from 'googleapis';
import { readFileSync } from 'fs';

const credentials = JSON.parse(readFileSync('/home/Adebola/agent_works/Sheet_manager/credentials.json', 'utf8'));

console.log('📋 Credential details:');
console.log('   project_id:', credentials.project_id);
console.log('   client_email:', credentials.client_email);
console.log('   type:', credentials.type);
console.log('   token_uri:', credentials.token_uri);
console.log('');

const auth = new google.auth.GoogleAuth({
  credentials,
  scopes: [
    'https://www.googleapis.com/auth/spreadsheets',
    'https://www.googleapis.com/auth/drive',
  ],
});

async function test() {
  try {
    console.log('🔑 Step 1: Getting auth client...');
    const authClient = await auth.getClient();
    console.log('   ✅ Auth client created. Type:', authClient.constructor.name);
    
    // Test 1: Can we get an access token?
    console.log('\n🔑 Step 2: Getting access token...');
    const token = await authClient.getAccessToken();
    console.log('   ✅ Got access token (first 20 chars):', token?.token?.substring(0, 20) + '...');

    // Test 2: Try listing files via Drive (simple read)
    console.log('\n📂 Step 3: Testing Drive API (list files)...');
    const drive = google.drive({ version: 'v3', auth: authClient });
    try {
      const files = await drive.files.list({ pageSize: 1 });
      console.log('   ✅ Drive API works! Files found:', files.data.files?.length ?? 0);
    } catch (e) {
      console.log('   ❌ Drive API failed:', e.message);
      if (e.response) {
        console.log('   Details:', JSON.stringify(e.response.data, null, 2));
      }
    }

    // Test 3: Try creating a spreadsheet
    console.log('\n📊 Step 4: Testing Sheets API (create spreadsheet)...');
    const sheets = google.sheets({ version: 'v4', auth: authClient });
    try {
      const result = await sheets.spreadsheets.create({
        requestBody: {
          properties: { title: 'Test - Delete Me' },
        },
      });
      console.log('   ✅ Created spreadsheet! ID:', result.data.spreadsheetId);
      console.log('   URL: https://docs.google.com/spreadsheets/d/' + result.data.spreadsheetId);
    } catch (e) {
      console.log('   ❌ Sheets create failed:', e.message);
      if (e.response) {
        console.log('   Status:', e.response.status);
        console.log('   Details:', JSON.stringify(e.response.data, null, 2));
      }
    }

  } catch (e) {
    console.error('💥 Failed:', e.message);
    if (e.response) {
      console.error('Details:', JSON.stringify(e.response.data, null, 2));
    }
  }
}

test();
