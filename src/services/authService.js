import { signInWithEmailAndPassword } from "firebase/auth";
import { auth } from "../firebase/firebaseConfig";

export function loginUser(email, password) {
  return signInWithEmailAndPassword(
    auth,
    email.trim(),
    password
  );
}