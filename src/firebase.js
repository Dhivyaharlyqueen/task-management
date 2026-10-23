import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyByIooSQDBwUmJceG_WbyRl-hdofHjv31g",
  authDomain: "employee-task-management-6af36.firebaseapp.com",
  projectId: "employee-task-management-6af36",
  storageBucket: "employee-task-management-6af36.firebasestorage.app",
  messagingSenderId: "850176797977",
  appId: "1:850176797977:web:2bb2e4cea800f28eea2988",
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
