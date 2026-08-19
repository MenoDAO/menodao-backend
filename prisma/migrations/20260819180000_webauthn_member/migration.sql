-- Device passkeys for member login (public keys only)

ALTER TABLE "WebAuthnCredential" ADD COLUMN "memberId" TEXT;

CREATE INDEX "WebAuthnCredential_memberId_idx" ON "WebAuthnCredential"("memberId");

ALTER TABLE "WebAuthnCredential" ADD CONSTRAINT "WebAuthnCredential_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;
