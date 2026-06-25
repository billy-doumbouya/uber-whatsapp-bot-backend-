// services/orderService.js — migré MongoDB
const { orderDb, documentDb, conversationDb } = require('../lib/db');
const { Order, Document }   = require('../models');
const { createFolder, uploadJson, uploadFile, shareFolderPublic } = require('./driveService');
const { sendNotification }  = require('./notificationService');
const logger                = require('../utils/logger');

// ─────────────────────────────────────────────────────────────
//  Créer une commande depuis une conversation WhatsApp finalisée
// ─────────────────────────────────────────────────────────────
async function createOrderFromConversation(conv) {
  const data = typeof conv.data === 'string' ? JSON.parse(conv.data) : conv.data;

  const order = await orderDb.create({
    conversationId: conv.id,
    firstName: data.firstName || '',
    lastName:  data.lastName  || '',
    phone:     data.phone     || conv.phone,
    email:     data.email     || null,
    address:   data.address   || null,
    cardType:  data.cardType  || 'VISA_CLASSIC',
    extraData: data.extraData || {},
  });

  try {
    const folderName = `${data.lastName}_${data.firstName}_${order.id.slice(0, 8)}`;
    const folder = await createFolder(folderName);
    await shareFolderPublic(folder.id);

    const clientInfo = {
      id:                 order.id,
      nom:                data.lastName,
      prenom:             data.firstName,
      telephone_carte:    data.phone,
      telephone_whatsapp: conv.phone,
      email:              data.email,
      adresse:            data.address,
      type_carte:         data.cardType,
      date_commande:      new Date().toISOString(),
    };
    await uploadJson(folder.id, 'informations_client.json', clientInfo);

    await orderDb.update(order.id, {
      driveFolderId:  folder.id,
      driveFolderUrl: folder.webViewLink,
      status:         'PROCESSING',
    });

    order.driveFolderUrl = folder.webViewLink;
    order.driveFolderId  = folder.id;

    await sendNotification({
      subject:        `Nouvelle commande Visa - ${data.lastName} ${data.firstName}`,
      order:          { ...order, ...clientInfo },
      driveFolderUrl: folder.webViewLink,
    });

    logger.info({ orderId: order.id, folderId: folder.id }, 'Dossier Drive créé');
  } catch (err) {
    logger.error({ err, orderId: order.id }, 'Erreur création dossier Drive');
  }

  return order;
}

// ─────────────────────────────────────────────────────────────
//  Créer une commande depuis le formulaire web
// ─────────────────────────────────────────────────────────────
async function createOrderFromForm(formData, files) {
  let conversationId = null;
  if (formData.convId) {
    const conv = await conversationDb.findById(formData.convId);
    if (conv) conversationId = conv.id;
  }

  const order = await orderDb.create({
    conversationId,
    firstName: formData.firstName,
    lastName:  formData.lastName,
    phone:     formData.phone,
    email:     formData.email   || null,
    address:   formData.address || null,
    cardType:  formData.cardType || 'VISA_CLASSIC',
    extraData: {},
  });

  try {
    const folderName = `${formData.lastName}_${formData.firstName}_${order.id.slice(0, 8)}`;
    const folder = await createFolder(folderName);
    await shareFolderPublic(folder.id);

    await uploadJson(folder.id, 'informations_client.json', { ...formData, id: order.id });

    if (files && files.length > 0) {
      for (const file of files) {
        const driveFile = await uploadFile(folder.id, file.originalname, file.mimetype, file.buffer);
        await documentDb.create({
          orderId:     order.id,
          fileName:    file.originalname,
          mimeType:    file.mimetype,
          driveFileId: driveFile.id,
          source:      'FORM',
        });
      }
    }

    await orderDb.update(order.id, {
      driveFolderId:  folder.id,
      driveFolderUrl: folder.webViewLink,
      status:         'PROCESSING',
    });

    await sendNotification({
      subject:        `Nouvelle commande Visa (formulaire) - ${formData.lastName} ${formData.firstName}`,
      order:          { ...order, ...formData },
      driveFolderUrl: folder.webViewLink,
    });
  } catch (err) {
    logger.error({ err, orderId: order.id }, 'Erreur Drive (formulaire)');
  }

  return order;
}

// ─────────────────────────────────────────────────────────────
//  Lister les commandes avec pagination + recherche
//  Remplace les 3 turso.execute() par des requêtes Mongoose
// ─────────────────────────────────────────────────────────────
async function getOrders({ page = 1, limit = 20, status, search }) {
  const offset = (page - 1) * limit;

  // Construire le filtre MongoDB
  const filter = {};

  if (status) {
    filter.status = status;
  }

  if (search) {
    // Equivalent du LIKE %search% sur 4 champs
    const regex = { $regex: search, $options: 'i' };
    filter.$or = [
      { firstName: regex },
      { lastName:  regex },
      { phone:     regex },
      { email:     regex },
    ];
  }

  // count + orders en parallèle (équivalent du Promise.all Turso)
  const [total, orders] = await Promise.all([
    Order.countDocuments(filter),
    Order.find(filter)
      .sort({ createdAt: -1 })
      .skip(offset)
      .limit(limit)
      .lean(),
  ]);

  // Charger les documents de toutes les commandes en une seule requête
  // Equivalent du SELECT * FROM Document WHERE orderId IN (...)
  if (orders.length > 0) {
    const orderIds = orders.map(o => o.id);
    const docs = await Document.find({ orderId: { $in: orderIds } })
      .sort({ createdAt: 1 })
      .lean();

    const docsByOrder = {};
    for (const d of docs) {
      if (!docsByOrder[d.orderId]) docsByOrder[d.orderId] = [];
      docsByOrder[d.orderId].push(d);
    }
    for (const o of orders) {
      o.documents = docsByOrder[o.id] ?? [];
    }
  }

  return {
    orders,
    total,
    page,
    totalPages: Math.ceil(total / limit),
  };
}

// ─────────────────────────────────────────────────────────────
//  Mettre à jour le statut d'une commande
// ─────────────────────────────────────────────────────────────
async function updateOrderStatus(id, status) {
  return orderDb.updateStatus(id, status);
}

module.exports = {
  createOrderFromConversation,
  createOrderFromForm,
  getOrders,
  updateOrderStatus,
};
