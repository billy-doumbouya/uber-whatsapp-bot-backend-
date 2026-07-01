// services/googleSync.js
//
// Synchronise chaque soumission de formulaire vers :
//   - Google Sheets : une ligne récapitulative par demande
//   - Google Drive : un sous-dossier par demande, contenant les documents joints
//
// Ne bloque jamais la réponse au client si Google est indisponible : toutes les
// erreurs sont catchées et loguées, jamais propagées vers la route appelante.

const { google } = require("googleapis");
const { Readable } = require("stream");

const oAuth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET
);
oAuth2Client.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });

const drive = google.drive({ version: "v3", auth: oAuth2Client });
const sheets = google.sheets({ version: "v4", auth: oAuth2Client });

const CARD_LABELS = {
  VISA_CLASSIC: "Visa Classic",
  VISA_GOLD: "Visa Gold",
  VISA_BUSINESS: "Visa Business",
};

function bufferToStream(buffer) {
  const stream = new Readable();
  stream.push(buffer);
  stream.push(null);
  return stream;
}

/**
 * @param {object} form  - { firstName, lastName, phone, email, address, cardType, convId }
 * @param {Array}  files - req.files (multer memoryStorage), chaque item a .buffer, .originalname, .mimetype
 * @param {string} orderId - id de la commande déjà créée en base (pour traçabilité dans la Sheet)
 */
async function syncSubmissionToGoogle(form, files = [], orderId = "") {
  try {
    const rootFolderId = process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID;
    const sheetId = process.env.GOOGLE_SHEET_ID;

    if (!rootFolderId || !sheetId) {
      console.warn("⚠️  GOOGLE_DRIVE_ROOT_FOLDER_ID ou GOOGLE_SHEET_ID manquant — sync Google ignorée.");
      return;
    }

    // 1. Créer un sous-dossier dédié à cette demande
    const folderName = `${form.lastName || "?"}_${form.firstName || "?"}_${Date.now()}`;
    const folder = await drive.files.create({
      requestBody: {
        name: folderName,
        mimeType: "application/vnd.google-apps.folder",
        parents: [rootFolderId],
      },
      fields: "id, webViewLink",
    });

    // 2. Uploader chaque document dans ce dossier
    for (const file of files) {
      await drive.files.create({
        requestBody: {
          name: file.originalname,
          parents: [folder.data.id],
        },
        media: {
          mimeType: file.mimetype,
          body: bufferToStream(file.buffer),
        },
      });
    }

    // 3. Ajouter la ligne récap dans la Sheet
    await sheets.spreadsheets.values.append({
      spreadsheetId: sheetId,
      range: "A:K",
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [
          [
            new Date().toISOString(),
            orderId || "",
            form.convId || "",
            form.lastName || "",
            form.firstName || "",
            form.phone || "",
            form.email || "",
            form.address || "",
            CARD_LABELS[form.cardType] || form.cardType || "",
            files.length,
            folder.data.webViewLink,
          ],
        ],
      },
    });

    console.log(`✅ Sync Google OK pour la demande de ${form.firstName} ${form.lastName}`);
  } catch (err) {
    // Erreur volontairement non propagée : la soumission ne doit jamais échouer
    // à cause d'un souci Google (quota, token expiré, réseau, etc.)
    console.error("❌ Erreur sync Google (non bloquante) :", err.message);
  }
}

module.exports = { syncSubmissionToGoogle };