// scripts/get-refresh-token.js
//
// Usage :
//   1. Place le fichier "client_secret.json" (téléchargé depuis Google Cloud) dans ce même dossier "scripts/"
//   2. npm install googleapis   (si pas déjà installé dans le projet)
//   3. node scripts/get-refresh-token.js
//   4. Ouvre l'URL affichée dans ton navigateur, connecte-toi avec le compte ADMIN
//      (celui dont le Drive doit recevoir les données), autorise l'accès
//   5. Google te redirige vers une page qui va probablement afficher une erreur
//      "impossible d'accéder à ce site" — C'EST NORMAL. Regarde l'URL dans la barre
//      d'adresse de ton navigateur, elle contient "?code=XXXXX..." — copie tout ce qui
//      suit "code=" jusqu'au prochain "&" (ou jusqu'à la fin s'il n'y a pas de "&")
//   6. Colle ce code dans le terminal quand demandé
//   7. Le script affiche ton REFRESH_TOKEN — copie-le dans ton fichier .env backend

const { google } = require("googleapis");
const readline = require("readline");
const path = require("path");
const fs = require("fs");

const CREDENTIALS_PATH = path.join(__dirname, "client_secret.json");

if (!fs.existsSync(CREDENTIALS_PATH)) {
  console.error(
    "❌ Fichier introuvable : scripts/client_secret.json\n" +
    "   Place le JSON téléchargé depuis Google Cloud dans ce dossier, avec exactement ce nom."
  );
  process.exit(1);
}

const raw = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, "utf8"));
// Le JSON Google a une clé "installed" pour les apps de type "Desktop app"
const creds = raw.installed || raw.web;

if (!creds) {
  console.error("❌ Format du client_secret.json inattendu.");
  process.exit(1);
}

const { client_id, client_secret, redirect_uris } = creds;

// Pour une "Desktop app", Google fournit généralement redirect_uris incluant
// "urn:ietf:wg:oauth:2.0:oob" (flow manuel) OU "http://localhost". On force le flow manuel
// qui fonctionne dans tous les cas sans avoir besoin d'un serveur local.
const REDIRECT_URI = "urn:ietf:wg:oauth:2.0:oob";

const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, REDIRECT_URI);

const SCOPES = [
  "https://www.googleapis.com/auth/drive.file",
  "https://www.googleapis.com/auth/spreadsheets",
];

const authUrl = oAuth2Client.generateAuthUrl({
  access_type: "offline", // indispensable pour obtenir un refresh_token
  scope: SCOPES,
  prompt: "consent", // force Google à toujours renvoyer un refresh_token, même en re-run
});

console.log("\n=== Étape 1 ===");
console.log("Ouvre cette URL dans ton navigateur, connecte-toi avec le compte ADMIN :\n");
console.log(authUrl);
console.log("\n=== Étape 2 ===");
console.log("Après autorisation, Google affiche un CODE directement à l'écran (pas de redirection cassée).");
console.log("Copie ce code et colle-le ci-dessous.\n");

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

rl.question("Colle le code ici : ", async (code) => {
  try {
    const { tokens } = await oAuth2Client.getToken(code.trim());
    console.log("\n✅ Succès ! Voici tes tokens :\n");
    console.log("GOOGLE_CLIENT_ID=" + client_id);
    console.log("GOOGLE_CLIENT_SECRET=" + client_secret);
    console.log("GOOGLE_REFRESH_TOKEN=" + tokens.refresh_token);
    console.log("\n👉 Copie ces 3 lignes dans le fichier .env de ton backend.");

    if (!tokens.refresh_token) {
      console.log(
        "\n⚠️  Aucun refresh_token reçu. Cause fréquente : tu avais déjà autorisé cette app avant.\n" +
        "   Va sur https://myaccount.google.com/permissions, révoque l'accès à l'app, puis relance ce script."
      );
    }
  } catch (err) {
    console.error("\n❌ Erreur lors de l'échange du code :", err.message);
  } finally {
    rl.close();
  }
});