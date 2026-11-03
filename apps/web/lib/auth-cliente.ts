"use client";

import { createAuthClient } from "better-auth/react";
import { twoFactorClient } from "better-auth/client/plugins";

/** Cliente do Better Auth no navegador; fala com /api/auth. */
export const authCliente = createAuthClient({ plugins: [twoFactorClient()] });
