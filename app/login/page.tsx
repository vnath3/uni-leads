import { Suspense } from "react";
import LoginClient from "./LoginClient";

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="card">
          <h1>Loading login...</h1>
          <p className="muted">Preparing authentication.</p>
        </div>
      }
    >
      <LoginClient />
    </Suspense>
  );
}
