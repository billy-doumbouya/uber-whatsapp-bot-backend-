const { prisma } = require("../utils/database");
const {
  createFolder,
  uploadJson,
  uploadFile,
  shareFolderPublic,
} = require("./driveService");
const { sendNotification } = require("./notificationService");
const logger = require("../utils/logger");

// Créer une commande depuis une conversation WhatsApp finalisée
async function createOrderFromConversation(conv) {
  const data = JSON.parse(conv.data);

  // 1. Créer la commande en base
  const order = await prisma.order.create({
    data: {
      conversationId: conv.id,
      firstName: data.firstName || "",
      lastName: data.lastName || "",
      phone: data.phone || conv.phone,
      email: data.email || null,
      address: data.address || null,
      cardType: data.cardType || "VISA_CLASSIC",
      extraData: JSON.stringify(data.extraData || {}),
      status: "PENDING",
    },
  });

  // 2. Créer le dossier Google Drive
  try {
    const folderName = `${data.lastName}_${data.firstName}_${order.id.slice(0, 8)}`;
    const folder = await createFolder(folderName);
    await shareFolderPublic(folder.id);

    // 3. Uploader les données textuelles
    const clientInfo = {
      id: order.id,
      nom: data.lastName,
      prenom: data.firstName,
      telephone_carte: data.phone,
      telephone_whatsapp: conv.phone,
      email: data.email,
      adresse: data.address,
      type_carte: data.cardType,
      date_commande: new Date().toISOString(),
    };
    await uploadJson(folder.id, "informations_client.json", clientInfo);

    // 4. Mettre à jour la commande avec le lien Drive
    await prisma.order.update({
      where: { id: order.id },
      data: {
        driveFolderId: folder.id,
        driveFolderUrl: folder.webViewLink,
        status: "PROCESSING",
      },
    });

    order.driveFolderUrl = folder.webViewLink;
    order.driveFolderId = folder.id;

    // 5. Envoyer la notification à l'agence
    await sendNotification({
      subject: `Nouvelle commande Visa - ${data.lastName} ${data.firstName}`,
      order: { ...order, ...clientInfo },
      driveFolderUrl: folder.webViewLink,
    });

    logger.info(
      { orderId: order.id, folderId: folder.id },
      "Dossier Drive créé",
    );
  } catch (err) {
    logger.error({ err, orderId: order.id }, "Erreur création dossier Drive");
    // Ne pas bloquer : la commande est créée même si Drive échoue
  }

  return order;
}

// Créer une commande depuis le formulaire web
async function createOrderFromForm(formData, files) {
  // Trouver la conversation liée si un convId est fourni
  let conversationId = null;
  if (formData.convId) {
    const conv = await prisma.conversation.findUnique({
      where: { id: formData.convId },
    });
    if (conv) conversationId = conv.id;
  }

  const order = await prisma.order.create({
    data: {
      conversationId,
      firstName: formData.firstName,
      lastName: formData.lastName,
      phone: formData.phone,
      email: formData.email || null,
      address: formData.address || null,
      cardType: formData.cardType || "VISA_CLASSIC",
      extraData: JSON.stringify({}),
      status: "PENDING",
    },
  });

  // Créer dossier Drive et uploader les fichiers
  try {
    const folderName = `${formData.lastName}_${formData.firstName}_${order.id.slice(0, 8)}`;
    const folder = await createFolder(folderName);
    await shareFolderPublic(folder.id);

    await uploadJson(folder.id, "informations_client.json", {
      ...formData,
      id: order.id,
    });

    // Uploader les fichiers joints
    if (files && files.length > 0) {
      for (const file of files) {
        const driveFile = await uploadFile(
          folder.id,
          file.originalname,
          file.mimetype,
          file.buffer,
        );
        await prisma.document.create({
          data: {
            orderId: order.id,
            fileName: file.originalname,
            mimeType: file.mimetype,
            driveFileId: driveFile.id,
            source: "FORM",
          },
        });
      }
    }

    await prisma.order.update({
      where: { id: order.id },
      data: {
        driveFolderId: folder.id,
        driveFolderUrl: folder.webViewLink,
        status: "PROCESSING",
      },
    });

    await sendNotification({
      subject: `Nouvelle commande Visa (formulaire) - ${formData.lastName} ${formData.firstName}`,
      order: { ...order, ...formData },
      driveFolderUrl: folder.webViewLink,
    });
  } catch (err) {
    logger.error({ err, orderId: order.id }, "Erreur Drive (formulaire)");
  }

  return order;
}

// Lister les commandes avec pagination
async function getOrders({ page = 1, limit = 20, status, search }) {
  const where = {};
  if (status) where.status = status;
  if (search) {
    where.OR = [
      { firstName: { contains: search } },
      { lastName: { contains: search } },
      { phone: { contains: search } },
      { email: { contains: search } },
    ];
  }

  const [orders, total] = await Promise.all([
    prisma.order.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
      include: { documents: true },
    }),
    prisma.order.count({ where }),
  ]);

  return { orders, total, page, totalPages: Math.ceil(total / limit) };
}

async function updateOrderStatus(id, status) {
  return prisma.order.update({ where: { id }, data: { status } });
}

module.exports = {
  createOrderFromConversation,
  createOrderFromForm,
  getOrders,
  updateOrderStatus,
};
