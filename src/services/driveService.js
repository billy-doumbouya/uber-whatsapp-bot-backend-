const { google } = require('googleapis');
const logger = require('../utils/logger');

function getDriveClient() {
  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: process.env.GOOGLE_CLIENT_EMAIL,
      private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    },
    scopes: ['https://www.googleapis.com/auth/drive'],
  });
  return google.drive({ version: 'v3', auth });
}

// Créer un dossier dans Google Drive
async function createFolder(name, parentId) {
  const drive = getDriveClient();
  const res = await drive.files.create({
    requestBody: {
      name,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [parentId || process.env.GOOGLE_DRIVE_FOLDER_ID],
    },
    fields: 'id, webViewLink',
  });
  return res.data;
}

// Uploader un fichier dans un dossier
async function uploadFile(folderId, fileName, mimeType, buffer) {
  const drive = getDriveClient();
  const { Readable } = require('stream');
  const stream = Readable.from(buffer);

  const res = await drive.files.create({
    requestBody: {
      name: fileName,
      parents: [folderId],
    },
    media: {
      mimeType,
      body: stream,
    },
    fields: 'id, webViewLink',
  });
  return res.data;
}

// Uploader du texte JSON comme fichier dans Drive
async function uploadJson(folderId, fileName, data) {
  const buffer = Buffer.from(JSON.stringify(data, null, 2), 'utf-8');
  return uploadFile(folderId, fileName, 'application/json', buffer);
}

// Partager un dossier (lecture pour tous avec le lien)
async function shareFolderPublic(folderId) {
  const drive = getDriveClient();
  await drive.permissions.create({
    fileId: folderId,
    requestBody: {
      role: 'reader',
      type: 'anyone',
    },
  });
}

module.exports = { createFolder, uploadFile, uploadJson, shareFolderPublic };
