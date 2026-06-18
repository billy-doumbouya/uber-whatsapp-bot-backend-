const nodemailer = require('nodemailer');
const logger = require('../utils/logger');

function getTransporter() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: false,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
}

async function sendNotification({ subject, order, driveFolderUrl }) {
  if (!process.env.SMTP_USER || !process.env.NOTIFY_EMAIL) {
    logger.warn('Email non configuré, notification ignorée');
    return;
  }

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background: #1a56db; color: white; padding: 20px; border-radius: 8px 8px 0 0;">
        <h1 style="margin: 0; font-size: 20px;">🏦 UBA - Nouvelle Commande Visa</h1>
      </div>
      <div style="background: #f9fafb; padding: 24px; border: 1px solid #e5e7eb;">
        <h2 style="color: #1f2937; margin-top: 0;">Informations Client</h2>
        <table style="width: 100%; border-collapse: collapse;">
          <tr style="border-bottom: 1px solid #e5e7eb;">
            <td style="padding: 10px; color: #6b7280; width: 40%;">Nom complet</td>
            <td style="padding: 10px; font-weight: bold;">${order.lastName} ${order.firstName}</td>
          </tr>
          <tr style="border-bottom: 1px solid #e5e7eb;">
            <td style="padding: 10px; color: #6b7280;">Téléphone carte</td>
            <td style="padding: 10px;">${order.phone || order.telephone_carte || '-'}</td>
          </tr>
          <tr style="border-bottom: 1px solid #e5e7eb;">
            <td style="padding: 10px; color: #6b7280;">Email</td>
            <td style="padding: 10px;">${order.email || '-'}</td>
          </tr>
          <tr style="border-bottom: 1px solid #e5e7eb;">
            <td style="padding: 10px; color: #6b7280;">Adresse</td>
            <td style="padding: 10px;">${order.address || '-'}</td>
          </tr>
          <tr style="border-bottom: 1px solid #e5e7eb;">
            <td style="padding: 10px; color: #6b7280;">Type de carte</td>
            <td style="padding: 10px; font-weight: bold; color: #1a56db;">${order.cardType}</td>
          </tr>
          <tr>
            <td style="padding: 10px; color: #6b7280;">Date commande</td>
            <td style="padding: 10px;">${new Date().toLocaleString('fr-FR')}</td>
          </tr>
        </table>

        ${driveFolderUrl ? `
        <div style="margin-top: 24px; padding: 16px; background: #eff6ff; border-radius: 8px; border: 1px solid #bfdbfe;">
          <p style="margin: 0 0 8px 0; font-weight: bold; color: #1e40af;">📁 Dossier Google Drive</p>
          <a href="${driveFolderUrl}" style="color: #1a56db; word-break: break-all;">${driveFolderUrl}</a>
        </div>
        ` : ''}

        <div style="margin-top: 24px; padding: 16px; background: #f0fdf4; border-radius: 8px; border: 1px solid #bbf7d0;">
          <p style="margin: 0; color: #166534;">✅ Un nouveau dossier a été créé automatiquement dans Google Drive.</p>
        </div>
      </div>
      <div style="background: #f3f4f6; padding: 16px; text-align: center; border-radius: 0 0 8px 8px; color: #6b7280; font-size: 12px;">
        UBA WhatsApp Bot - Message automatique
      </div>
    </div>
  `;

  try {
    await getTransporter().sendMail({
      from: process.env.NOTIFY_FROM || `UBA Bot <${process.env.SMTP_USER}>`,
      to: process.env.NOTIFY_EMAIL,
      subject,
      html,
    });
    logger.info({ to: process.env.NOTIFY_EMAIL, subject }, 'Notification email envoyée');
  } catch (err) {
    logger.error({ err }, 'Erreur envoi notification email');
  }
}

module.exports = { sendNotification };
