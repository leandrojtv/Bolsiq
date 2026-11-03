-- Schema app: tabelas do Better Auth (ADR 0010).
--
-- Gerado com getMigrations() de better-auth 1.7.11 a partir de criarAuth()
-- (src/config.ts), com o plugin twoFactor, e qualificado com o schema. Mudar
-- plugin ou versao exige gerar de novo e criar uma migration nova.

CREATE SCHEMA IF NOT EXISTS app;
--> statement-breakpoint
CREATE TABLE app."user" ("id" text not null primary key, "name" text not null, "email" text not null unique, "emailVerified" boolean not null, "image" text, "createdAt" timestamptz default CURRENT_TIMESTAMP not null, "updatedAt" timestamptz default CURRENT_TIMESTAMP not null, "twoFactorEnabled" boolean);
--> statement-breakpoint
CREATE TABLE app."session" ("id" text not null primary key, "expiresAt" timestamptz not null, "token" text not null unique, "createdAt" timestamptz default CURRENT_TIMESTAMP not null, "updatedAt" timestamptz not null, "ipAddress" text, "userAgent" text, "userId" text not null references app."user" ("id") on delete cascade);
--> statement-breakpoint
CREATE TABLE app."account" ("id" text not null primary key, "accountId" text not null, "providerId" text not null, "userId" text not null references app."user" ("id") on delete cascade, "accessToken" text, "refreshToken" text, "idToken" text, "accessTokenExpiresAt" timestamptz, "refreshTokenExpiresAt" timestamptz, "scope" text, "password" text, "createdAt" timestamptz default CURRENT_TIMESTAMP not null, "updatedAt" timestamptz not null);
--> statement-breakpoint
CREATE TABLE app."verification" ("id" text not null primary key, "identifier" text not null, "value" text not null, "expiresAt" timestamptz not null, "createdAt" timestamptz default CURRENT_TIMESTAMP not null, "updatedAt" timestamptz default CURRENT_TIMESTAMP not null);
--> statement-breakpoint
CREATE TABLE app."twoFactor" ("id" text not null primary key, "secret" text not null, "backupCodes" text not null, "userId" text not null references app."user" ("id") on delete cascade, "verified" boolean, "failedVerificationCount" integer, "lockedUntil" timestamptz);
--> statement-breakpoint
create index "session_userId_idx" on app."session" ("userId");
--> statement-breakpoint
create index "account_userId_idx" on app."account" ("userId");
--> statement-breakpoint
create index "verification_identifier_idx" on app."verification" ("identifier");
--> statement-breakpoint
create index "twoFactor_secret_idx" on app."twoFactor" ("secret");
--> statement-breakpoint
create index "twoFactor_userId_idx" on app."twoFactor" ("userId");
