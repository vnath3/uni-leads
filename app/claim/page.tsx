import { Suspense } from "react";
import ClaimClient from "./ClaimClient";

export default function ClaimInvitePage() {
  return (
    <Suspense
      fallback={
        <div className="card">
          <h1>Claim invite</h1>
          <p className="muted">Loading invite details...</p>
        </div>
      }
    >
      <ClaimClient />
    </Suspense>
  );
}
