import { initializeApp, getApps } from 'firebase/app';
import { 
  getFirestore, 
  doc, 
  collection, 
  setDoc, 
  getDoc, 
  getDocs, 
  updateDoc, 
  deleteDoc, 
  query, 
  where,
  orderBy,
  limit,
  getCountFromServer
} from 'firebase/firestore';
import crypto from 'crypto';

// Define the core server secret token used for secure Attribute-Based Access Control (ABAC) in security rules
const SYSTEM_SECRET = 'SERVER_SECRET_ee62ff41-5153-437f-b485-66227c47d53d';

import rawConfig from '../firebase-applet-config';

export const firebaseConfig = {
  projectId: process.env.FIREBASE_PROJECT_ID || rawConfig.projectId,
  appId: process.env.FIREBASE_APP_ID || rawConfig.appId,
  apiKey: process.env.FIREBASE_API_KEY || rawConfig.apiKey,
  authDomain: process.env.FIREBASE_AUTH_DOMAIN || rawConfig.authDomain,
  firestoreDatabaseId: process.env.FIREBASE_FIRESTORE_DATABASE_ID || rawConfig.firestoreDatabaseId,
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET || rawConfig.storageBucket,
  messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID || rawConfig.messagingSenderId,
  measurementId: process.env.FIREBASE_MEASUREMENT_ID || rawConfig.measurementId,
};

export const isFirebaseConfigured = () => {
  // Support manual disabling of Firebase via environment variable
  if (process.env.DISABLE_FIREBASE === 'true') {
    return false;
  }
  // Disable Firebase client SDK on Vercel to prevent connection hangs/timeouts,
  // unless explicitly enabled via environment variable.
  if (process.env.VERCEL) {
    return process.env.ENABLE_FIREBASE === 'true';
  }
  return !!(firebaseConfig && firebaseConfig.projectId);
};

// Initialize Web Firebase App on the Server lazily
let app: any;
let firestoreInstance: any;

const getFirestoreDb = () => {
  if (!isFirebaseConfigured()) {
    return null;
  }
  if (firestoreInstance) {
    return firestoreInstance;
  }
  try {
    if (getApps().length === 0) {
      app = initializeApp(firebaseConfig);
      console.log("[Firebase Server] Initialized Web client SDK instance on Node server.");
    } else {
      app = getApps()[0];
    }
    firestoreInstance = getFirestore(app, firebaseConfig.firestoreDatabaseId);
    console.log(`[Firebase Server] Initialized Firestore Instance for DB: ${firebaseConfig.firestoreDatabaseId || '(default)'}`);
    return firestoreInstance;
  } catch (e: any) {
    console.error("[Firebase Server] Failed to initialize Firebase/Firestore:", e.message);
    return null;
  }
};

// Shim to mimic firebase-admin API using the standard client SDK
class DocRef {
  private colName: string;
  private docId: string;

  constructor(colName: string, docId?: string) {
    this.colName = colName;
    this.docId = docId || crypto.randomUUID();
  }

  get id() {
    return this.docId;
  }

  async set(data: any) {
    const dbInstance = getFirestoreDb();
    if (!dbInstance) throw new Error("Firestore is not initialized");
    const dRef = doc(dbInstance, this.colName, this.docId);
    // Automatically inject system_secret to align with secure Firestore rules
    await setDoc(dRef, { 
      ...data, 
      system_secret: SYSTEM_SECRET 
    });
  }

  async update(data: any) {
    const dbInstance = getFirestoreDb();
    if (!dbInstance) throw new Error("Firestore is not initialized");
    const dRef = doc(dbInstance, this.colName, this.docId);
    // Explicitly update while preserving or enforcing the secret key validation
    await updateDoc(dRef, { 
      ...data, 
      system_secret: SYSTEM_SECRET 
    });
  }

  async get() {
    const dbInstance = getFirestoreDb();
    if (!dbInstance) throw new Error("Firestore is not initialized");
    const dRef = doc(dbInstance, this.colName, this.docId);
    const snap = await getDoc(dRef);
    return {
      id: snap.id,
      exists: snap.exists(),
      data: () => snap.data()
    };
  }

  async delete() {
    const dbInstance = getFirestoreDb();
    if (!dbInstance) throw new Error("Firestore is not initialized");
    const dRef = doc(dbInstance, this.colName, this.docId);
    await deleteDoc(dRef);
  }
}

class QueryBuilder {
  private colName: string;
  private conditions: any[] = [];

  constructor(colName: string) {
    this.colName = colName;
  }

  where(field: string, op: any, value: any) {
    this.conditions.push(where(field, op, value));
    return this;
  }

  doc(docId?: string) {
    return new DocRef(this.colName, docId);
  }

  async get() {
    const dbInstance = getFirestoreDb();
    if (!dbInstance) throw new Error("Firestore is not initialized");
    const colRef = collection(dbInstance, this.colName);
    // Ensure the system_secret validation is passed by explicitly appending the filter
    const securityQuery = query(colRef, where('system_secret', '==', SYSTEM_SECRET), ...this.conditions);
    const snap = await getDocs(securityQuery);
    return {
      docs: snap.docs.map(d => ({
        id: d.id,
        data: () => d.data()
      }))
    };
  }

  async count() {
    const dbInstance = getFirestoreDb();
    if (!dbInstance) throw new Error("Firestore is not initialized");
    const colRef = collection(dbInstance, this.colName);
    // Ensure the system_secret validation is passed by explicitly appending the filter
    const securityQuery = query(colRef, where('system_secret', '==', SYSTEM_SECRET), ...this.conditions);
    const snapshot = await getCountFromServer(securityQuery);
    return snapshot.data().count;
  }
}

class CollectionBuilder {
  collection(collectionName: string) {
    return new QueryBuilder(collectionName);
  }
}

export const db = new CollectionBuilder();

export const performAutoCleanup = async () => {
  if (!isFirebaseConfigured()) return;
  const dbInstance = getFirestoreDb();
  if (!dbInstance) return;

  try {
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const thirtyDaysAgoISO = thirtyDaysAgo.toISOString();

    console.log(`[Firebase Auto-Cleanup] Starting cleanup routine. Threshold date: ${thirtyDaysAgoISO}`);

    // 1. Delete resumes older than 30 days
    const resumesCol = collection(dbInstance, 'resumes');
    const oldResumesQuery = query(
      resumesCol, 
      where('system_secret', '==', SYSTEM_SECRET),
      where('created_at', '<', thirtyDaysAgoISO)
    );
    const oldResumesSnap = await getDocs(oldResumesQuery);
    
    let deletedCount = 0;
    for (const d of oldResumesSnap.docs) {
      await deleteDoc(d.ref);
      deletedCount++;
    }
    if (deletedCount > 0) {
      console.log(`[Firebase Auto-Cleanup] Deleted ${deletedCount} resumes older than 30 days.`);
    }

    // 2. Delete activity logs older than 30 days
    const logsCol = collection(dbInstance, 'activity_logs');
    const oldLogsQuery = query(
      logsCol, 
      where('system_secret', '==', SYSTEM_SECRET),
      where('created_at', '<', thirtyDaysAgoISO)
    );
    const oldLogsSnap = await getDocs(oldLogsQuery);
    
    let deletedLogsCount = 0;
    for (const d of oldLogsSnap.docs) {
      await deleteDoc(d.ref);
      deletedLogsCount++;
    }
    if (deletedLogsCount > 0) {
      console.log(`[Firebase Auto-Cleanup] Deleted ${deletedLogsCount} activity logs older than 30 days.`);
    }

    // 3. Keep at most 500 resumes (Quantity-based capping)
    // Filter by system_secret first to pass rules, then sort in-memory to prevent requiring composite index
    const capQuery = query(resumesCol, where('system_secret', '==', SYSTEM_SECRET));
    const capSnap = await getDocs(capQuery);
    
    if (capSnap.docs.length > 500) {
      // Sort in-memory descending by created_at
      const sortedDocs = [...capSnap.docs].sort((a, b) => {
        const tA = a.data().created_at || '';
        const tB = b.data().created_at || '';
        return tB.localeCompare(tA);
      });
      
      const docsToDelete = sortedDocs.slice(500);
      console.log(`[Firebase Auto-Cleanup] Resumes count (${capSnap.docs.length}) exceeds 500 limit. Deleting ${docsToDelete.length} oldest resumes.`);
      for (const d of docsToDelete) {
        await deleteDoc(d.ref);
      }
    }
    console.log(`[Firebase Auto-Cleanup] Routine completed successfully.`);
  } catch (error: any) {
    console.error(`[Firebase Auto-Cleanup] Error during routine:`, error.message);
  }
};
