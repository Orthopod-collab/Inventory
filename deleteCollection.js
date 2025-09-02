import admin from "firebase-admin";
import fs from "fs";

// Load service account JSON manually
const serviceAccount = JSON.parse(
  fs.readFileSync("./inventory-67ceb-firebase-adminsdk-fbsvc-c3e00fa450.json", "utf8")
);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

async function deleteCollection(colName, batchSize = 500) {
  const collectionRef = db.collection(colName);
  const query = collectionRef.limit(batchSize);

  return new Promise((resolve, reject) => {
    deleteQueryBatch(query, resolve).catch(reject);
  });
}

async function deleteQueryBatch(query, resolve) {
  const snapshot = await query.get();

  if (snapshot.empty) {
    resolve();
    return;
  }

  const batch = db.batch();
  snapshot.docs.forEach((doc) => batch.delete(doc.ref));
  await batch.commit();

  process.nextTick(() => {
    deleteQueryBatch(query, resolve);
  });
}

// ⚡ Replace with your real collection name
deleteCollection("yourCollectionName").then(() => {
  console.log("✅ Collection completely deleted");
});
