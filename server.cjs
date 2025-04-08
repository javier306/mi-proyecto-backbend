require("dotenv").config();

const express = require("express");
const admin = require("firebase-admin");
const axios = require("axios");
const cloudinary = require("cloudinary").v2;
const cors = require("cors");
const bodyParser = require("body-parser");

// Inicialización de Express
const app = express();
app.use(cors());
app.use(bodyParser.json());

// Importa el archivo de credenciales
const serviceAccount = require("./red-social-viajes2-firebase-adminsdk-fbsvc-35fd2ed4ae.json");

// Inicialización del SDK de Firebase Admin
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: "https://red-social-viajes2.firebaseio.com",
});

const db = admin.firestore();

// Configuración de Cloudinary
cloudinary.config({
  cloud_name: "dwq7tkjng",
  api_key: "989747438324298",
  api_secret: "_Bjc7xpAn2rof5o0t0zg-NNWHLM",
});

// ========================================================
// Endpoint: Enviar solicitud de amistad (por username)
// ========================================================
app.post("/api/send-friend-request", async (req, res) => {
  const { senderId, receiverUsername } = req.body;
  if (!senderId || !receiverUsername) {
    return res.status(400).json({ message: "Los parámetros 'senderId' y 'receiverUsername' son requeridos" });
  }
  try {
    // Buscar el usuario receptor en Firestore por su username
    const userQuery = await db.collection("users").where("username", "==", receiverUsername).get();
    
    if (userQuery.empty) {
      return res.status(404).json({ message: "El usuario receptor no existe" });
    }

    const receiverId = userQuery.docs[0].id;

    // Crear solicitud de amistad en Firestore
    const friendRequestData = {
      senderId,
      receiverId,
      status: "pending",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    const friendRequestRef = await db.collection("friend_requests").add(friendRequestData);

    res.status(200).json({ message: "Solicitud de amistad enviada", requestId: friendRequestRef.id });
  } catch (error) {
    console.error("Error al enviar solicitud de amistad:", error.message);
    res.status(500).json({ message: "Error al enviar solicitud de amistad" });
  }
});

// ========================================================
// Endpoint: Obtener solicitudes de amistad pendientes (por username)
// ========================================================
app.get("/api/get-friend-requests", async (req, res) => {
  const { username } = req.query;
  if (!username) {
    return res.status(400).json({ message: "El parámetro 'username' es requerido" });
  }
  try {
    // Buscar el usuario por su username en Firestore
    const userQuery = await db.collection("users").where("username", "==", username).get();

    if (userQuery.empty) {
      return res.status(404).json({ message: "Usuario no encontrado." });
    }

    const userId = userQuery.docs[0].id;

    // Obtener solicitudes de amistad pendientes
    const requestsSnapshot = await db.collection("friend_requests")
      .where("receiverId", "==", userId)
      .where("status", "==", "pending")
      .get();

    // Enriquecer cada solicitud con el username del remitente
    const requests = await Promise.all(
      requestsSnapshot.docs.map(async (doc) => {
        const data = doc.data();
        const senderDoc = await db.collection("users").doc(data.senderId).get();
        const senderUsername = senderDoc.exists && senderDoc.data().username
          ? senderDoc.data().username
          : data.senderId;
        return { id: doc.id, senderUsername, ...data };
      })
    );

    res.status(200).json({ requests });
  } catch (error) {
    console.error("Error al obtener solicitudes de amistad:", error.message);
    res.status(500).json({ message: "Error al obtener solicitudes de amistad" });
  }
});

// ========================================================
// Endpoint: Obtener la lista de amigos (por username)
// ========================================================
app.get("/api/get-friends", async (req, res) => {
  const { username } = req.query;
  if (!username) {
    return res.status(400).json({ message: "El parámetro 'username' es requerido" });
  }
  try {
    // Buscar el usuario por username en Firestore
    const userQuery = await db.collection("users").where("username", "==", username).get();

    if (userQuery.empty) {
      return res.status(404).json({ message: "Usuario no encontrado." });
    }

    const userId = userQuery.docs[0].id;

    // Obtener lista de amigos desde Firestore
    const userDoc = await db.collection("users").doc(userId).get();
    const friends = userDoc.exists && userDoc.data().friends ? userDoc.data().friends : [];

    // Enriquecer la lista de amigos con id y username
    const enrichedFriends = await Promise.all(
      friends.map(async (friendId) => {
        const friendDoc = await db.collection("users").doc(friendId).get();
        return {
          id: friendDoc.id,
          username: friendDoc.exists && friendDoc.data().username ? friendDoc.data().username : friendId,
        };
      })
    );

    res.status(200).json({ friends: enrichedFriends });
  } catch (error) {
    console.error("Error al obtener amigos:", error.message);
    res.status(500).json({ message: "Error al obtener amigos" });
  }
});

// ========================================================
// Endpoint Unificado: Manejar solicitud de amistad (Aceptar o Rechazar)
// ========================================================
app.post("/api/handle-friend-request", async (req, res) => {
  const { requestId, action } = req.body;

  if (!requestId) {
    return res.status(400).json({ message: "El parámetro 'requestId' es requerido" });
  }
  if (!action || !["accept", "reject"].includes(action)) {
    return res.status(400).json({ message: "Acción inválida. Use 'accept' o 'reject'" });
  }

  try {
    const requestRef = db.collection("friend_requests").doc(requestId);
    const requestDoc = await requestRef.get();

    if (!requestDoc.exists) {
      return res.status(404).json({ message: "Solicitud no encontrada" });
    }

    if (action === "accept") {
      const { senderId, receiverId } = requestDoc.data();

      const senderRef = db.collection("users").doc(senderId);
      const receiverRef = db.collection("users").doc(receiverId);

      // Añadir cada usuario a la lista de amigos del otro
      await senderRef.update({
        friends: admin.firestore.FieldValue.arrayUnion(receiverId),
      });
      await receiverRef.update({
        friends: admin.firestore.FieldValue.arrayUnion(senderId),
      });

      // Eliminar la solicitud ya procesada
      await requestRef.delete();
      return res.status(200).json({ message: "Solicitud aceptada" });
    } else if (action === "reject") {
      await requestRef.delete();
      return res.status(200).json({ message: "Solicitud rechazada" });
    }
  } catch (error) {
    console.error("Error al procesar la solicitud de amistad:", error.message);
    res.status(500).json({ message: "Error al procesar la solicitud de amistad" });
  }
});

// ========================================================
// Nuevos Endpoints: Aceptar y Rechazar solicitud de amistad para el Frontend
// ========================================================
app.post("/api/accept-friend-request", async (req, res) => {
  const { requestId } = req.body;
  req.body.action = "accept";
  return app.handle("post", "/api/handle-friend-request")(req, res);
});

app.post("/api/reject-friend-request", async (req, res) => {
  const { requestId } = req.body;
  req.body.action = "reject";
  return app.handle("post", "/api/handle-friend-request")(req, res);
});

// ========================================================
// Endpoint: Eliminar imagen en Cloudinary
// ========================================================
app.post("/api/delete-image", async (req, res) => {
  const { public_id } = req.body;
  if (!public_id) {
    return res.status(400).json({ message: "El parámetro 'public_id' es requerido" });
  }
  try {
    await cloudinary.uploader.destroy(public_id);
    res.status(200).json({ message: "Imagen eliminada exitosamente" });
  } catch (error) {
    console.error("Error al eliminar imagen:", error.message);
    res.status(500).json({ message: "Error al eliminar la imagen" });
  }
});

// ========================================================
// Iniciar el servidor
// ========================================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor corriendo en el puerto ${PORT}`);
});
